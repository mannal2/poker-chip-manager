# 저장 무한 대기·복구 버튼 무반응 조사

## 범위와 결론

- 사용자 보고: 갤럭시 S23의 설치된 PWA에서 준비 이름 수정 후 저장 대기, 새 토너먼트 복구도 진행 불가. 일반 브라우저에서는 정상. 앱 전환/키보드 닫힘 여부는 불확실.
- 바이인은 보류. 이번 작업은 원인 조사이며 제품 코드·사용자 저장 데이터·배포 설정을 변경하지 않았다.
- 배포 HTML의 main-DRr3kgqy.js SHA-256은 로컬 production 빌드와 일치했다. 설치된 S23 PWA가 사용하는 SW/JS 버전은 기기에서 확인하지 못했다.
- **저장 완료 알림이 전달되지 않는 조건에서 무한 대기와 복구 교착을 재현했다.** 최초 알림 누락을 실제 S23에서 유발한 원인은 미확정이며 Android/Chrome 자체 결함으로 단정하지 않는다.

## 확인된 결함

### 일반 저장·조작권·초기화의 완료 제한 없음

repository.ts:218의 dispatch,166의 takeControl,191의 initialize는 IndexedDB 요청/트랜잭션 완료를 제한 없이 기다린다. 연결 시의8초 제한은 이미 열린 연결의 저장 완료 대기에 적용되지 않는다.

이름 수정은 SETUP_UPDATE → LocalController.retry → LocalRepository.dispatch를 거친다. 완료 알림이 없으면 controller.running과 LocalApp.lock이 finally까지 도달하지 못한다. UI는 saving 상태이며 게임 시작은 저장 대기 안내, 일반 메뉴의 새 토너먼트는 조용히 반환한다.

### 복구 UI도 기존 저장 잠금에 막힘

LocalApp.tsx:183의 restartAfterFailure는 lock.current가 true이면 확인창을 띄우기도 전에 반환한다. LocalController.restart:45 역시 기존 running이 true이면 거절한다.

저장 응답 대기 중 DB 연결 종료가 알려지면 restoreError 화면은 나타날 수 있지만 기존 작업은 정리되지 않는다. 따라서 복구 화면의 새 토너먼트 버튼도 실행되지 않는다. 일반 메뉴 newGame:306은 lock 또는 pending이면 반환한다.

### 읽기 제한 이후 정리에서 다시 무한 대기 가능

LocalRepository.load에는8초 제한과 abort가 있지만 catch에서 다시 await tx.done.catch(...)(121행)을 수행한다. 이미 완료된 트랜잭션의 완료 알림만 누락되었거나 abort 결과마저 전달되지 않으면 타임아웃 후에도 반환하지 않는다.

controller.refresh의 별도8초 제한으로 복원 오류 화면이 나타날 수는 있으나 하위 작업이 정리된다는 뜻은 아니다. restart의 catch는 void tx.done.catch(...)를 사용하여 이 특정 재대기 결함이 없다. dispatch/takeControl/initialize에도 제한 없는 정리 대기가 있다.

### 앱 복귀 시 잠긴 작업의 재검증 생략

LocalApp.tsx:156의 resume은 lock 또는 pending이면 반환한다. 정상적인 짧은 저장 중 재연결을 피하려는 보호지만 저장이 끝나지 않으면 회복도 생략된다. 복귀가 최초 원인이라는 증거는 아니며 이미 멈춘 상태에서 회복하지 못하는 증폭 조건이다.

## 재현과 검증

사용자 브라우저와 분리한 Playwright 컨텍스트에서 native IndexedDB 저장은 실제 수행하고 완료 알림 전달만 보류했다. 연결 종료는 close 이벤트를 명시적으로 주입했다. 실제 Android 앱 정지/OS 키보드/저장 장치 실패를 재현한 것은 아니다.

| 시나리오 | 결과 |
|---|---|
| 이름 저장 완료 알림 보류 후 모사 시간60초 진행 | saving 유지, 게임 시작 불가, resume으로 회복 안 됨 |
| 위 조건에서 연결 종료 알림, 복구 화면 새 토너먼트 클릭 | 확인창 호출0회, 복구 화면 유지 |
| 기존 창 대기 중 같은 저장소를 새 창에서 열고 조작권 인수 | 저장된 새 이름 복원, 게임 시작/POT15 정상, 기존 창만 saving |
| repository.load 완료 알림 보류 후 모사 시간60초 | 8초 제한이 있어도 반환 안 됨 |
| takeControl/initialize 완료 알림 보류 후60초 | 반환 안 됨 |
| restart 완료 알림 보류 후60초 | 제한 시간 오류 반환: 위 메서드와 차이 확인 |

- Chromium/WebKit 각3개, 총6개 진단 통과: frontend/verification-storage-investigation-all.log.
- fake-indexeddb로 실제 저장소 소스의4개 메서드 비교, 진단4개 통과: frontend/verification-storage-deadlines.log.
- 기존 단위14 files/134 통과. 결함이 수정됐다는 뜻이 아니라 기존 검증에서 영구 무응답 조건이 빠졌음을 확인했다.
- 최초 진단2건은 Playwright가 aria-disabled 버튼 클릭을 자동 대기하여30초 제한에 걸렸다. 자동 대기 없이 실제 클릭을 전달하도록 도구를 보완한 뒤4개, 새 창 시나리오를 추가하여6개를 재검증했다. 제품 수정으로 오인하지 않는다.
- 로컬 진단 도구는 ignored .cache/storage-investigation.config.ts, .cache/storage-investigation.spec.ts, .cache/storage-investigation-vitest.config.ts, .cache/storage-investigation.test.ts에 있다.

frontend에서 재실행:

```powershell
npx playwright test --config .cache/storage-investigation.config.ts
npx vitest run --config .cache/storage-investigation-vitest.config.ts
```

진단 테스트는 **현재 결함의 존재를 확인하는 도구**이며 수정 후 통과해야 할 정식 회귀 테스트와 별개다. 수정 시 원하는 복구 결과를 검증하는 회귀로 전환해야 한다.

## 수정에 필요한 조건

1. 연결 이후 모든 저장·초기화·조작권 작업도 제한 시간 안에 반환시킨다. 오류 정리에서 완료 이벤트를 무제한 재대기하지 않는다.
2. 시간 초과를 저장 실패로 단정하지 않는다. 요청ID/순번을 보존하고 같은 요청으로 재시도하여 중복 베팅/블라인드/지급을 막는다.
3. 타임아웃/명시적 복구 시 이전 작업과 연결을 정리한다. close만 호출하거나 Promise.race만 추가해 미완료 트랜잭션과 늦은 응답을 방치하지 않는다.
4. 확인한 새 토너먼트 복구는 기존 잠금을 안전하게 대체해야 한다. 작업 토큰/세대로 이전 응답이 새 게임을 덮어쓰지 못하게 하고 원자 교체 실패 시 기존 게임·기록·조작권을 보존한다.
5. 복귀 시 미확정 작업도 유한 시간 안에 재검증한다. 정상 저장 중복 실행과 무한 잠금을 함께 방지한다.
6. 이름 저장, 저장 후 응답만 유실, 저장 전 정지, abort 알림 유실, 앱 복귀, 새 토너먼트 실패/성공, 복구 후 늦은 완료를 정식 회귀로 검증한다.

## 공식 동작 참고

- [MDN IDBDatabase.close](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/close): close는 진행 중 트랜잭션을 즉시 취소/완료시키는 것이 아니다.
- [Chrome Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api): frozen 상태에서는 작업 실행이 중지될 수 있고 연결 정리/재개 처리가 필요하다. 이번 S23의 최초 원인이 freeze라는 증거는 아니다.
