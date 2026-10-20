# 저장 무한 대기·복구 버튼 무반응 해결 기록

- 작성일: 2026-10-20
- 현재 단계: **저장소·복구·앱 복귀 수정 완료 / 전체 회귀·독립 리뷰 진행**
- 기록 순서: 결함 현상 → 원인 찾기·해당 코드 이해 → 해결방법 구상 → 해결.

## 1. 결함 현상

- 사용자 보고: 갤럭시 S23의 설치된 PWA에서 준비 이름 수정 후 저장 대기, 새 토너먼트 복구도 진행 불가. 일반 브라우저에서는 정상. 앱 전환/키보드 닫힘 여부는 불확실.
- 바이인은 보류. 최초 조사 단계에서는 제품 코드·사용자 저장 데이터·배포 설정을 변경하지 않았다. 이후 사용자의 수정 요청에 따른 변경은 4절에 기록한다.
- 배포 HTML의 main-DRr3kgqy.js SHA-256은 로컬 production 빌드와 일치했다. 설치된 S23 PWA가 사용하는 SW/JS 버전은 기기에서 확인하지 못했다.
- **저장 완료 알림이 전달되지 않는 조건에서 무한 대기와 복구 교착을 재현했다.** 최초 알림 누락을 실제 S23에서 유발한 원인은 미확정이며 Android/Chrome 자체 결함으로 단정하지 않는다.

## 2. 원인 찾기 — 해당 코드 이해

### 2.1 해당 코드와 저장 흐름

이름 수정의 흐름은 다음과 같다.

`InlineName.save → LocalApp.saveSettings/run → LocalController.dispatch/retry → LocalRepository.dispatch → IndexedDB 완료 → 잠금 해제/UI 갱신`

| 코드 | 역할 | 이번 결함과의 연결 |
|---|---|---|
| `frontend/src/ui/InlineName.tsx` | 이름 입력 완료 시 저장 요청 | 이름 변경이 일반 저장 경로를 시작함 |
| `frontend/src/app/LocalApp.tsx` | saving 표시, 조작 잠금, 복구 화면, 앱 복귀 처리 | 완료되지 않은 작업이 UI 조작과 복구를 막음 |
| `frontend/src/local/controller.ts` | 실행 중 요청·순번·조작권 관리 | running/pending이 남으면 재시작이 거절됨 |
| `frontend/src/local/repository.ts` | 게임·기록·조작권을 원자적으로 저장 | 완료 알림 대기와 오류 정리의 무한 대기 지점 |
| `frontend/src/local/storageDeadline.ts` | 제한 시간 후 오류 반환 및 취소 호출 | 연결/복원 제한만으로 일반 저장과 후속 정리까지 보호되지 않음 |

아래 행 번호는 조사 시점 제품 코드 기준이다. 수정 후에는 변경 파일과 커밋을 4절에 남긴다.

### 2.2 코드에서 확인한 결함

#### 일반 저장·조작권·초기화의 완료 제한 없음

repository.ts:218의 dispatch,166의 takeControl,191의 initialize는 IndexedDB 요청/트랜잭션 완료를 제한 없이 기다린다. 연결 시의8초 제한은 이미 열린 연결의 저장 완료 대기에 적용되지 않는다.

이름 수정은 SETUP_UPDATE → LocalController.retry → LocalRepository.dispatch를 거친다. 완료 알림이 없으면 controller.running과 LocalApp.lock이 finally까지 도달하지 못한다. UI는 saving 상태이며 게임 시작은 저장 대기 안내, 일반 메뉴의 새 토너먼트는 조용히 반환한다.

#### 복구 UI도 기존 저장 잠금에 막힘

LocalApp.tsx:183의 restartAfterFailure는 lock.current가 true이면 확인창을 띄우기도 전에 반환한다. LocalController.restart:45 역시 기존 running이 true이면 거절한다.

저장 응답 대기 중 DB 연결 종료가 알려지면 restoreError 화면은 나타날 수 있지만 기존 작업은 정리되지 않는다. 따라서 복구 화면의 새 토너먼트 버튼도 실행되지 않는다. 일반 메뉴 newGame:306은 lock 또는 pending이면 반환한다.

#### 읽기 제한 이후 정리에서 다시 무한 대기 가능

LocalRepository.load에는8초 제한과 abort가 있지만 catch에서 다시 await tx.done.catch(...)(121행)을 수행한다. 이미 완료된 트랜잭션의 완료 알림만 누락되었거나 abort 결과마저 전달되지 않으면 타임아웃 후에도 반환하지 않는다.

controller.refresh의 별도8초 제한으로 복원 오류 화면이 나타날 수는 있으나 하위 작업이 정리된다는 뜻은 아니다. restart의 catch는 void tx.done.catch(...)를 사용하여 이 특정 재대기 결함이 없다. dispatch/takeControl/initialize에도 제한 없는 정리 대기가 있다.

#### 앱 복귀 시 잠긴 작업의 재검증 생략

LocalApp.tsx:156의 resume은 lock 또는 pending이면 반환한다. 정상적인 짧은 저장 중 재연결을 피하려는 보호지만 저장이 끝나지 않으면 회복도 생략된다. 복귀가 최초 원인이라는 증거는 아니며 이미 멈춘 상태에서 회복하지 못하는 증폭 조건이다.

### 2.3 가설 검증과 재현 결과

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

### 2.4 공식 동작 참고

- [MDN IDBDatabase.close](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/close): close는 진행 중 트랜잭션을 즉시 취소/완료시키는 것이 아니다.
- [Chrome Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api): frozen 상태에서는 작업 실행이 중지될 수 있고 연결 정리/재개 처리가 필요하다. 이번 S23의 최초 원인이 freeze라는 증거는 아니다.

## 3. 해결방법 구상

아래는 아직 적용하지 않은 수정 방향과 지켜야 할 조건이다. 실제 선택과 변경 내용은 4절에 기록한다.

1. 연결 이후 모든 저장·초기화·조작권 작업도 제한 시간 안에 반환시킨다. 오류 정리에서 완료 이벤트를 무제한 재대기하지 않는다.
2. 시간 초과를 저장 실패로 단정하지 않는다. 요청ID/순번을 보존하고 같은 요청으로 재시도하여 중복 베팅/블라인드/지급을 막는다.
3. 타임아웃/명시적 복구 시 이전 작업과 연결을 정리한다. close만 호출하거나 Promise.race만 추가해 미완료 트랜잭션과 늦은 응답을 방치하지 않는다.
4. 확인한 새 토너먼트 복구는 기존 잠금을 안전하게 대체해야 한다. 작업 토큰/세대로 이전 응답이 새 게임을 덮어쓰지 못하게 하고 원자 교체 실패 시 기존 게임·기록·조작권을 보존한다.
5. 복귀 시 미확정 작업도 유한 시간 안에 재검증한다. 정상 저장 중복 실행과 무한 잠금을 함께 방지한다.
6. 이름 저장, 저장 후 응답만 유실, 저장 전 정지, abort 알림 유실, 앱 복귀, 새 토너먼트 실패/성공, 복구 후 늦은 완료를 정식 회귀로 검증한다.

## 4. 해결

**상태: 수정 진행 중.** 아래 작업은 실제 검증한 범위만 완료로 표시한다.

| 작업 | 상태 | 완료 확인 기준 |
|---|---|---|
| 저장·초기화·조작권 및 오류 정리 대기 제한 | 완료(작업 1) | 완료/중단 알림이 없어도 유한 시간 안에 복구 가능한 상태로 전환 |
| 미확정 요청 재시도 | 완료(작업 1) | 요청 ID를 유지하고 베팅·블라인드·지급이 중복 반영되지 않음 |
| 명시적 새 토너먼트 복구 | 완료(작업 2) | 오래된 작업 잠금을 대체하고, 교체 실패 시 기존 저장 보존 |
| 앱 복귀·늦은 응답 처리 | 완료(작업 2) | 미확정 작업을 재검증하고 이전 응답이 복구 후 상태를 덮지 않음 |
| 회귀·실기기 확인 | 미착수 | 재현 조건에서 정상 복구, 기존 게임·저장 테스트 통과, S23 확인 결과 구분 |

각 수정 작업은 다음 순서로 이 절에 누적 기록한다.

1. 수정 전 실패 재현: 시나리오, 기대 결과와 실제 결과.
2. 실제 수정: 바꾼 코드, 선택한 이유와 절충.
3. 수정 후 검증: 실행 명령, 통과·실패 수, 미검증 항목.
4. 작업 커밋: 관련 변경을 검증한 뒤 커밋 ID 기록.

기존 진단의 통과를 버그 수정 완료로 표시하지 않는다. 자동화된 완료 알림 유실 모사와 실제 S23 PWA 검증을 구분한다.

### 작업 1 — 저장소 대기 제한과 안전한 재시도

- 수정 전: 기존 단위134 PASS. 새 무응답 회귀9개 중7개 실패(초기 abort 재현은 딜러 미선택 때문에 실제 쓰기 전 거절되어 테스트 자체를 보완). 수정 전 코드로 abort 유실 회귀를 다시 실행해 UNKNOWN 대신 pending인 실패를 별도 확인했다.
- 수정: repository의 공통 트랜잭션 경로에서 연결을 포함한8초 제한, 활성 작업 취소, 실제 tx.abort, 정리 중 재대기 제거를 적용. 재연결/닫기 시 기존 작업의 논리 대기도 즉시 취소하고 늦은 연결 완료가 새 트랜잭션을 만들지 못하게 차단. 기록/조작권 읽기도 같은 제한 적용.
- 절충: 반복된6개 작업의 제한·취소 처리를 공통 메서드에 모았다. 요청 순번/중복 판정·원자 저장 로직 및 저장 형식은 유지. 시간 초과는 UNKNOWN으로 반환하여 controller가 원래 요청을 보존한다.
- 검증: 저장 전/후 알림 유실에서8초 후 UNKNOWN, 동일 ID 재시도로 핸드 시작/블라인드1회, 늦은 이벤트 전달 뒤에도 POT15 유지. 읽기/초기화/조작권/재시작/기록과 abort 알림 유실 포함9개 회귀 PASS, 전체 단위143 PASS. production build/typecheck 및 src/e2e/tests lint PASS. 기존 실제 IndexedDB·저장 대기 표시·태블릿 복구20 PASS.
- 검증 도중 새 테스트의 EventListener 타입 오류로 build 실패를 확인하고 보완 후 다시 통과했다. 최초 루트 디렉터리 npm 실행은 package.json 부재로 실패하여 frontend에서 기준134 PASS를 다시 실행했다.
- 근거: verification-storage-fix-repository-red.log, verification-storage-fix-abort-red.log, verification-storage-fix-repository-browser.log. 복구 UI의 오래된 잠금 대체는 다음 작업이며 아직 해결 완료로 표시하지 않는다.

- 작업1 커밋:83039b4.

### 작업 2 — 잠긴 화면 복구·앱 복귀·무효 연결 재시도

- 수정 전: 저장소 수정만 적용한 상태에서 UI 회귀5개 중4개 실패. 복구 확인/메뉴 재시작/교체 실패 후 복원/저장 중 resume에 대한 RED를 확인했다.
- 수정: 확인한 강제 새 토너먼트는 React key로 LocalGame 실행 상태를 교체한다. 이전 effect 정리에서 미완료 저장을 취소하고 연결을 닫으며, 새 controller/repository가 원자 재시작을 수행한다. 오래된 running/lock을 공유하지 않고 이전 UI 콜백도 새 화면을 갱신하지 못한다. 일반 메뉴도 저장 중/미확정 상태이면 같은 확인 경로를 사용한다.
- Ruling: controller 전체에 작업 토큰을 추가하는 대신 명시적 파괴 복구의 화면/저장 실행 문맥을 교체한다 — 기존 reducer/요청 보존 경로의 변경을 줄이기 위함 — 확인한 복구에서는 입력 초안 등 임시 UI가 초기화되고 기존 복구 정책대로 기본 P1/P2·1000/5/10으로 새 게임이 생성된다. 정상 메뉴 새 토너먼트 경로는 기존 설정 정책을 유지한다.
- 수정: 저장 중 resume을 버리지 않고 예약했다가 작업 완료 또는8초 제한 후 재연결/복원한다. 미확정 요청은 유지하여 같은 ID로 재시도한다. 컴포넌트 정리 시 예약을 지워 이전 화면이 새 연결을 다시 열지 못하게 한다.
- 추가 원인: 연결 종료 뒤 UNKNOWN 재시도가 invalid 연결을 계속 재사용하는 RED1을 별도로 확인했다. 재시도 버튼은 repository.reconnect 후 원래 요청으로 확인하도록1줄 보완했다.
- 검증: 새 브라우저 회귀12 PASS(각 브라우저6개), 기존 앱 흐름/태블릿 복구 포함34 PASS. 복구 취소 보존/즉시 새 게임/늦은 응답 무시, 실패한 교체의 slot·events·control 전체 snapshot 보존, 다시 시도로 원본 이름 복원, resume 재검증, 무효 연결 재시도 확인. 단위143 PASS/typecheck/lint PASS.
- 근거: verification-storage-fix-ui-{red,green,final}.log 및 verification-storage-fix-retry-red.log. 최종 전체 회귀와 실제 S23 검증은 아직 완료로 기록하지 않는다.

- 작업2 커밋:af83427.

### 추가 검증 — 진행 중 트랜잭션 원자 취소

- slot 쓰기와 events 변경 이후, native 요청을 이어 트랜잭션을 실제로 활성 상태에 둔 채 완료를 보류했다.8초 제한이 tx.abort를 수행하여 게임 상태·기록·조작권 전체가 이전 snapshot으로 rollback됨을 확인했다.
- 동일 pending 요청 재시도 후 HAND_START1개/POT15, 뒤늦은 기존 요청 이벤트도 중복 반영하지 않음을 확인했다. 단순한 완료 응답 지연과 실제 미완료 트랜잭션을 구분하여 검증했다.
- 각 메서드의 완료 알림 유실 테스트는 단순히 반환하는 것뿐 아니라 제한 오류로 반환하는지 확인하도록 강화. 전체 단위144 PASS/typecheck/lint PASS. 이 검사는 fake-indexeddb의 트랜잭션 모사이며 실제 OS 저장 장치 장애 검증은 아니다.

- 검증 기록 정정: 추가 부분 쓰기 테스트의 최초 단위144/typecheck는 통과했으나 lint는 no-this-alias로 실패했다. 해당 출력을 확인하기 전에2f48ba0 커밋 및 lint PASS 기록을 진행한 실행 실수를 인정하고 정정한다. 테스트의 this 별칭을 lexical callback으로 바꾼 뒤 전체 단위144/typecheck/lint를 다시 실행하여 모두 PASS 확인. 제품 코드는 영향 없음.
