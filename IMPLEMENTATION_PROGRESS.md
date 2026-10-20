# 구현 진행 상태

마지막 갱신: 2026-10-18

## 실행 기준

- 범위 A00~A11. B 배포/C 멀티플레이 제외. 최종 고정 HTML·GAME_SPEC·SYSTEM_SPEC 준수.
- 작업 브랜치 codex/single-device, 시작 HEAD ecdb904. 사용자 제공 AGENTS 지침 적용 (실제 AGENTS.md 없음).
- 기본 sandbox shell/Node 도구는 U: 볼륨 오류. 승인된 별도 실행 경로 사용.
- Ruling: 기존 확정 계획을 그대로 실행하며 재기획·단계별 승인 대기는 생략한다. 진행 기록은 이 파일을 사용한다.
- A01→A02/03→A04→A05~08→A09 인터페이스: 표시 props / 순수 상태 전환 / 저장 후 확정 controller / UI draft / PWA 복원 순서. 저장 권한은 게임 undo 외부, H와 B 분리.

## 단계

| 작업 | 상태 | 검증 |
|---|---|---|
| A00 | 완료 | npm ci, typecheck/lint/build, 설정 RED→GREEN |
| A01 | 완료 | 최종 유효 CSS/props 표시, 2~9명/320~430px 좌표·겹침 검사 |
| A02 | 완료 | D01~D12/B01~B23·설정·턴·최소레이즈 |
| A03 | 완료 | P01~P07/W01~W10·취소·다음 핸드·우승·중단 |
| A04 | 완료 (첫 형식 범위) | 실제 IndexedDB 10 E2E PASS, 순번·64결과·권한·rollback·versionchange |
| A05 | 완료 | 준비·유효 설정·IME·삽입 드래그·인수 취소 |
| A06 | 완료 | H+d, 추가액 차감, CALL 초안 무시, 오류 재시도 |
| A07 | 완료 | 전체 스트리트·공개 잠금·side/tie/모순·다음 핸드/최종 우승 |
| A08 | 완료 | 기록·예약·홈·중단·새게임 확인/재사용 |
| A09 | 완료 | 프로덕션 PWA·offline·업데이트·준비 실패 6 E2E PASS |
| A10 | 자동 검증 완료 | npm ci→typecheck→lint→단위109→build→E2E172 전부 PASS. 실기기 미검증 |
| A11 | 완료 | README·실기기 체크리스트·검증/제약·로컬 인계 문서 작성 |
| B/C | 제외 | 멀티플레이·배포·프로비저닝 실행하지 않음 |

## 남은 확인

A00~A11 단일 기기 구현과 자동 검증을 마쳤다. 멀티플레이·실제 배포는 제외했다. 실기기 목록은 frontend/DEVICE_CHECKS.md. schema1만 존재하므로 실제 향후 DB 버전 업그레이드의 blocked 대기/migration은 이후 검증한다.

## 단계별 실행 기록

### A00 완료 / A01 표시 기준 확보

- A00: Node/npm 확인, codex/single-device 생성, npm ci PASS, typecheck/lint/build PASS, 설정 14건 RED→GREEN. 의존성 중복 설치 ENOTEMPTY/누락 파일은 npm ci로 해결.
- A01: 승인 HTML을 Chromium으로 직접 열고 치수·색·화면 확인. 역사별 CSS 대신 최종 유효 규칙만 옮김. test:e2e -- e2e/design.spec.ts --project=chromium: 32 PASS (4 너비 × 2~9명, 각 4단계, 최대 금액/10자 이름).
- A01 최초 실행 실패: 테스트용 컴포넌트 미구현, 이후 브라우저 미설치. Chromium/WebKit 설치 후 PASS. 제품 빌드에 표시 fixture 포함하지 않음.
- 시안 전용 상단 30px 설정줄은 제품에서 제외한다. 카드/테이블 비교 시 이 오프셋을 제거한다. 실기기 아직 미검증.
- 다음: A02 순수 규칙과 D/B 전체 사례.

### A02 검증

- 설정/위치/베팅 50 PASS (D01~D12/B01~B23 포함), 입력 불변·성공 전환 칩 불변식 검사. typecheck PASS.
- 검증용 inspect-approved.mjs의 ESLint 환경 오류를 TypeScript 도구로 정리 후 재검증. 엔진 게임 규칙과 무관한 도구 파일 오류도 숨기지 않음.
- A03에서 마지막 폴드 자동 정산·팟·승자 일관성·생명주기를 연결한다. A02의 베팅/공개 테스트는 전부 통과한 상태.

### A03 완료 (엔진)

- P01~P07/W01~W10 RED 확인 후 GREEN. 총 71개 고유 규칙 테스트 PASS, typecheck/lint PASS.
- 마지막 폴드: 미콜 반환→전체 팟 지급→탈락/다음 핸드 원자 전환. WIN과 최종1명 종료 구분. 공개 잠금·한 번 취소·예약 보존 검증.
- 초기 테스트 helper가 test 파일을 import하여 36건 중복 실행한 것을 분리. 현재 71은 중복 없는 수치.
- 다음 A04: IndexedDB와 화면 세대/순번/64개 결과, 손상·실패 복원.

### A04 검증

- 저장/controller 단위 6개 PASS, 누적 전체 77 PASS, typecheck PASS.
- 실제 IndexedDB Chromium/WebKit 6개 E2E PASS: L01 기록 쓰기 실패 전체 rollback, L02 동일 요청 재전송, L04 새게임 교체 실패 원본/기록 보존, L03/X03 두 탭 저장·인수 순서, L05 공개 잠금, L06 알 수 없는 형식 차단.
- L08 오프라인은 A09 산출물을 필요로 하므로 A09에서 통합 검증. L09 유효 설정/잘못된 초안은 A05 UI 검증으로 연결.
- Ruling: schemaVersion1만 존재하여 가상의 0→1 migration/upgrade blocked 상태를 만들지 않는다. 실제 versionchange 연결 무효화와 안내는 검증하고, 향후 실제 DB 업그레이드의 blocked 대기는 별도 검증으로 남긴다.
- 다음 A05 홈/준비/삽입 드래그/시작 연결.

### A05 기초 흐름 검증

- Chromium/WebKit 준비 E2E 6 PASS: 유효 설정 저장·무효 초안 복원(L09), 이름/인원/첫D, 드래그 삽입·영역밖 취소.
- WebKit에서 연속 편집 시 변경 누락 RED 재현. 저장 중 fieldset 잠금으로 수정, 같은 테스트 양쪽 GREEN. 키보드 삽입 이동 제공.
- typecheck PASS. IME/권한 변경 중 드래그/설정 저장 실패 추가 통합 사례는 A10에서도 확인한다.
- 다음 A06 두 줄 베팅 실제 연결 (H+d와 확정 잔액 분리).

### A06 연결 검증

- Chromium/WebKit 4 E2E PASS: H+d 초안/C/BET 추가액 차감, CALL의 초안 무시, UNDO, 실제 이벤트 저장 용량 실패 시 확정잔액 유지와 동일 요청 재시도.
- typecheck PASS. H20의 다음 스트리트 +60 사례는 A07 공개 진행과 함께 검증한다.
- 다음 A07 공개 잠금/테이블 승자 선택/사이드 팟/다음 핸드.

### A07 완료 검증

- 전체 단위 78 PASS, typecheck/lint PASS. A07 E2E: 전체 스트리트/H20+60=80/WIN 다음 핸드·HU runout/정산 실패/최종 우승 4 PASS, 사이드팟/모순/동률/초안 폐기 2 PASS (Chromium/WebKit).
- 팟별 지급·남는5칩 수령자·최종 잔액은 중앙 팟 상세로 제공, 카드 H는 유지. 단독 자격은 자동 선택이며 미리 지급하지 않음.
- WebKit 사이드팟 초기 FAIL 원인: 테스트가 공개 tx 완료 전에 카드를 눌러 선택을 놓침. WIN 표시를 기다리는 사용자 흐름으로 수정 후 양쪽 PASS. 규칙 기대값은 변경하지 않음.
- A08 관리자 메뉴/기록/중단 진행.

### A08 완료 검증

- Chromium/WebKit 관리자 E2E 2 PASS. 블라인드 예약은 현핸드 유지·다음 핸드1회, 마지막fold 확인 취소·확정, 기록·중단 보존/복원, 새 토너먼트 최초설정 재사용.
- 기록은 현재 토너먼트 50건씩 조회. 중단은 정상 우승과 구별. 시안 강제 진행/예시 초기화 없음.
- 업데이트 항목의 실제 내용은 A09에서 연결한다. 오프라인도 A09 검증 대상.

### A09 완료 검증

- production generateSW 빌드, Chromium/WebKit PWA E2E 6 PASS: /local/ 전용scope·캐시 제외, 오프라인 새로고침/이어하기/콜, 새 SW 대기·진행중 강제reload금지·중단 후 수동 적용, precache 실패 표시.
- 발견/수정: 중첩 SW의 상대 precache URL을 절대경로로 지정; revision 쿼리 포함 캐시 확인; 빠른 SW 업데이트를 외부 업데이트로 분류하는 라이브러리 동작 때문에 수동 적용은 해당 waiting worker의 activated를 확인해 요청 창만 reload.
- 설치 실패 검사는 잘못된 자산이 preview fallback 200으로 반환되는 경우와 실제 네트워크 실패를 구분해 후자로 재현. 실패 검사를 생략하거나 PASS로 재사용하지 않음.
- 다음 A10 통합·전체 인원/뷰포트 시각 비교·규칙/저장 경계 추가 감사. 실제 모바일 하드웨어는 아직 접근하지 않음.

### A10 통합 감사 진행

- 순수/저장 107 PASS, typecheck/lint PASS. 결정적 2~9인 ×8 토너먼트 종료·성공 전환 총량·입력 불변 검사.
- 공통 schema/settings/positions/betting/pots/settlement/lifecycle JSON과 실행 테스트 완비. D01~D12/B01~B23/P01~P07/W01~W10 및 생명주기 사례 사용.
- 실제 IndexedDB 10 E2E PASS (Chromium/WebKit): 65건 후 결과 만료 재실행 차단, 기록 50+15 페이지, versionchange 구 연결 차단 추가.
- IME/설정 저장 실패/인수 중 드래그 취소 4 E2E PASS, 올인·폴드 역할 배지 2 PASS, 놓친 알림 뒤 새게임 삭제확인 2 PASS.
- 발견/수정: 인원 재추가 ID 충돌, BET/RAISE 명령 구분, 손상 복원 검증 누락, 새게임 삭제확인 경쟁조건.
- 승인 HTML SHA256 DCB12611FAFAC9DF7E5AE8FD4D8AC78117C2DB94FCC1E86F5504070A2ABC5A92 유지. 동일 Chromium 320/390×2/6/9×4단계 이미지 24 PASS, 차이 허용 0.2%. fieldset 기본 좌우2px 차이 수정. 승인 이미지는 덮어쓰지 않음.
- 최초 전체 체인의 시각 FAIL은 비교용 fixture의 준비/공개/자격 누락을 드러냈으며 실제 표시 컴포넌트/데이터로 수정 후 재검증. 실패한 체인을 완료로 세지 않음.
- 전체 자동 검사 및 독립 최종 코드 검토 진행 중. A11 README/DEVICE_CHECKS 초안 작성. 실제 휴대폰은 미검증.

### 독립 최종 검토 및 수정

- requesting-code-review에 따른 읽기 전용 독립 검토: Critical 0, Important 3. 재검토 반복 없이 회귀 RED→GREEN으로 확인.
- Final: fixed 인수 중 응답/pending 경쟁 — 저장 선행·인수 선행 두 controller 테스트 RED→GREEN, lease 상실 상태를 저장 오류/ready로 오표시하지 않음.
- Final: fixed 이전 베팅 초안 부활 — tournament/lease 세대에 초안 연결, 두 탭 및 홈→인수 브라우저 회귀 RED→GREEN.
- Final: fixed 이전 준비 금액 덮어쓰기 — 확정 숫자/권한 경계에서 준비 입력 재초기화, 두 탭 1500 설정 보존 회귀 RED→GREEN. 정상 무효 입력 초안은 유지.
- Final: Ruling: SB 없음 표시 누락은 명세에 필요한 운영 상태 안내로 판단해 Important로 처리. 중앙 팟 문구에 표시하며 역할/테이블 좌표는 유지. 회귀 RED 확인 후 양 브라우저 GREEN.
- 진행 표의 오래된 상태는 이 상단 표로 정리. 미룬 minor 없음.
- Final: Ruling: 검토자가 결과 판정을 보류한 픽셀/전체 브라우저 검사는 실제 자동 결과로만 판정한다. 하드웨어/iOS·Android 설치/실제 IME·회전·물리장치 영구보존은 보장하지 않고 미검증으로 명시한다. 존재하지 않는 구형 migration과 범위 밖 멀티플레이/배포는 만들지 않는다. 공식 대회 규칙 전체의 별도 해석 대신 승인 GAME_SPEC을 구현 기준으로 사용한다.

- 최종 시각 회귀 추가 기록: 정산 선택 카드의 font-weight 750 누락 수정. 실제 클릭된 원본만 hover된 조건 차이를 제거하고 양쪽 hover 상태를 동일하게 맞춤. 승인 원본/PNG와 0.2% 기준은 유지. 동일 Chromium/WebKit의 320/390×2/6/9×5상태 이미지 비교 60 PASS.

### 최종 자동 검증 — 2026-10-18

- npm --prefix frontend ci: PASS (잠금 파일 재설치).
- npm --prefix frontend run typecheck: PASS.
- npm --prefix frontend run lint: PASS.
- npm --prefix frontend test -- --run: 8 files / 109 tests PASS.
- npm --prefix frontend run build: PASS.
- npm --prefix frontend run test:e2e -- --max-failures=1: Chromium/WebKit 합계 172 PASS (4.1m). 스킵·실패 0.
- 포함: 64개 전 인원/너비 레이아웃, 60개 승인 HTML 비교(선택 포함), 게임/관리/저장/PWA·리뷰 회귀. 원본 HTML SHA256 유지.
- 수정 뒤 실패한 검사나 기능 placeholder를 남기지 않았다. 초기/중간 FAIL 원인과 RED→GREEN은 위 실행 기록을 유지한다.
- 남은 미검증: 실제 iPhone Safari/Android Chrome 및 설치 앱, 실제 IME·터치·회전; 향후 실제 DB 형식 변경 시 migration/upgrade blocked. OS/물리장치 영구 보존은 보장하지 않음. 자세한 기기 체크리스트: frontend/DEVICE_CHECKS.md.
- 인계: README.md 실행·테스트·오프라인 준비·저장소 삭제 시 소실·업데이트 안내. codex/single-device 작업 상태 유지, 자동 commit/push/merge/배포 없음. .local/프로비저닝에 접근·변경하지 않음.

### 로컬 인계 확인

- 테스트 전용 entry가 없는 일반 production 빌드 재실행 PASS (dist/e2e 없음).
- http://127.0.0.1:4173/local/ 로컬 미리보기 실행. 실제 Chromium 390×844: 오프라인 준비 완료→새 토너먼트→게임 시작 P15→CALL P25, 행동자1명, pageerror0 PASS.
- 캡처: frontend/test-results/production-game-390.png (생성 검증 자료, Git 제외).
- 최종 브랜치 codex/single-device 유지. 실제 모바일/설치 검증 외 미구현 기능·알려진 재현 버그 없음. B/C는 요청에 따라 제외.


### 준비 화면 변경 — 2026-10-18 (완료)

- 최신 요청: 기본 2인 P1/P2, 중앙 −/명수/+, 최근 추가 참가자 삭제, P3 삭제 후 재추가 P3. 중앙 명수 아래 ↻로 화면 기준 한 자리 이동. 카드 단일 클릭 D, 더블 클릭 이름, 길게 눌러 삽입 이동. 참가자·좌석/화면 기준 메뉴 제거.
- Ruling: 인원 기반 기본 이름이 기존 변경 이름과 중복되면 이름 중복 금지 정책을 유지하며 해당 이름 변경 안내 후 추가를 거절한다. 임의로 번호를 건너뛰거나 기존 이름을 덮지 않는다.
- Ruling: 구형 준비 저장에는 추가 이력이 없으므로 기존 배열 순서로 최초 추가 순서를 복원한다. 새 이력은 이름/좌석과 독립적으로 저장한다. 진행 중 토너먼트는 인원/이름을 초기화하지 않는다.
- Task 1 complete: 기본값/딜러 미선택/추가 이력 단위 테스트 3 RED→GREEN. 전체 단위 112 PASS, typecheck PASS. 기존 저장 테스트는 시작 전 딜러 선택이 된 명시적 fixture로 변경.
- Task 2 complete: 신규 준비 UI 회귀 Chromium/WebKit 6 PASS. 최신 참가자 드래그 후 복원·삭제·번호 재사용, 제한 2/9, 단일/더블 클릭 분리, D 유지, 아래 이동 좌표, 회전 위치 검증.
- Task 3 진행: 320px 중앙 버튼 겹침 RED 재현 후 중앙 행 폭/위치 조정. 전체 기존 브라우저 회귀와 실제 production 화면 확인은 아직 미완료.
- 원인: 드래그 확정 시 기존 화면 기준 참가자의 새 인덱스를 viewSeat에 넣어 자동 회전. 드래그는 viewSeat 인덱스를 유지하고 명시적 ↻만 기준을 바꾸도록 수정.

- Task 3: 320/390px 전 인원 중앙 버튼 겹침 검사 PASS. 첫 전체 E2E는 69 PASS 뒤 side pot 이동 클릭 가로막힘으로 FAIL(미통과를 완료 처리하지 않음). 중앙 영역과 팟 이동의 겹침 확인 후 회전 양옆에 팟 이동을 배치하고 회귀 RED→GREEN.
- Final review: requesting-code-review 독립 읽기 전용 검토에서 Important(P2) 2개 확인. 느린 더블클릭(300ms)이 D 선택으로 처리됨, 350ms 전 15px 이동 취소가 D 선택으로 처리됨. 두 경우 재현 후 회귀 추가, 두 번째 누름에서 단일 탭 타이머 취소 및 이동 취소 클릭 억제로 수정. 별도 minor/보류 판정 없음.
- Final: Ruling: 첫 클릭은 500ms 동안 더블 탭 여부를 판별하고 두 번째 누름 중에는 첫 클릭을 확정하지 않는다. 약간의 D 선택 지연은 이름 변경 시 D가 바뀌는 오작동을 피하기 위한 비용이다.
- 추가 변경: 시점 변경 시 진행 중 드래그/클릭 초안 취소. 사이드 팟 번호는 중앙 문구, 이동 화살표는 ↻ 양쪽으로 배치해 카드·버튼을 가로막지 않음.
- 최종 전체 검사는 수정 후 재실행 예정. 실제 터치 하드웨어는 계속 미검증이며 브라우저 터치 에뮬레이션을 별도로 확인한다.

- 추가 시스템 취소 회귀 RED: 두 번째 누름에서 타이머가 중지된 뒤 pointercancel이 오면 더블탭 후보가 남아 다음 단일 탭이 이름 창을 열었다. pointercancel에서 후보/타이머를 함께 지우도록 수정, 최종 코드 검사는 이 수정까지 포함해 재실행한다.


### 준비 화면 변경 최종 검증

- 마지막 pointercancel 회귀 GREEN: 최종 일반 빌드에서도 시스템 취소 후 다음 단일 탭은 이름 창 대신 D 선택. 전체 검사는 해당 수정 전 실행을 중단하고 최종 소스로 처음부터 다시 실행했다.
- npm --prefix frontend run typecheck: PASS.
- npm --prefix frontend run lint: PASS.
- npm --prefix frontend test -- --run: 9 files / 112 tests PASS.
- npm --prefix frontend run test:e2e -- --max-failures=1: Chromium/WebKit 188 PASS, 5.3분, skip/fail 0. 최종 로그 frontend/verification-setup-final.log (검증 산출물, Git 제외).
- 포함: 기존 게임·저장·PWA·64개 배치·60개 원본 비교 + 준비 조작/중앙 버튼 겹침/느린 더블클릭/짧은 이동 취소/시스템 취소/터치 에뮬레이션 16개. 새 중앙 UI는 실제 앱 2/4/9인 화면으로 별도 확인했다. 원본 HTML SHA256 DCB12611FAFAC9DF7E5AE8FD4D8AC78117C2DB94FCC1E86F5504070A2ABC5A92 유지.
- npm --prefix frontend run build: 일반 production PASS, dist/e2e 없음. localhost:4173/local/ 일반 미리보기 실행 중.
- 일반 production Chromium 390×844 검증 PASS: 오프라인 준비 완료→P1/P2→P3 추가/삭제/재추가→더블클릭 이름 변경→카드 D→↻→게임 시작(P15/행동자1), pageerror 0. 캡처 frontend/test-results/production-setup-390-2.png.
- 사용자 진행 데이터는 격리된 브라우저 테스트로 보호했다. 새 토너먼트만 2인/P1/P2로 초기화하며 이어하기 명단은 보존한다.
- README/UX_SPEC/DESIGN_BASELINE/PLANNING/SYSTEM_SPEC에 최신 준비 동작·저장 호환성 기록. 기존 .local/·외부 배포·멀티플레이·commit/push/merge는 변경하지 않음.
- 남은 검증 제한: 실제 iPhone/Android 하드웨어, 설치 앱, 실제 IME/터치/회전은 미검증. 자동 브라우저 터치 에뮬레이션 통과와 구분한다. 미룬 minor/알려진 재현 실패 없음.


### 앱 홈·직접 조작·자동 진행 — 2026-10-18 (완료)

- 승인 범위: /local/ 앱 전체 홈(단일 기기/멀티 준비 중/앱 업데이트), 저장 게임 자동 진입, 충돌 때만 이 창 조작 안내. 게임 메뉴는 앱 홈으로/새 토너먼트. 중단·게임 내 업데이트·기록·블라인드 메뉴 제거.
- 상단 HAND 기록, 경기 중 SB/BB 예약, 상하 간격 6~8px. 예약은 현재값 옆 연한 → 다음값, 다음 핸드 적용 후 제거.
- 준비의 이름줄 클릭 직접 편집, 카드 나머지 클릭 즉시 D(500ms 지연 제거), 입력 중 드래그/D 차단. 명수와 −/+ 중심 정렬, 카드 회전 시계 방향.
- 베팅 완료는 자동 다음 스트리트/승자 선택. 전환은 마지막 행동과 원자 저장, 그 전 취소 잠금. 구형 공개 중간 상태는 저장 명령으로 정규화해 복원. 기존 칩·사이드 팟·되돌리기·권한·오프라인 보존.
- 업데이트는 홈에서 저장 완료 시 적용 가능(준비/진행 게임 존재 자체로 차단하지 않음), DB 보존. 단계별 검증 후 계속 진행하며 전체 회귀/일반 빌드/화면 확인을 끝에 수행.

- Task 1 complete: 자동 진행 3 RED→GREEN, 전체 단위 115 PASS. 기존 B13/B23·lifecycle 사례와 취소 기대값을 승인된 자동 전환/잠금으로 갱신했다. 구형 단계는 RESUME_FLOW로 원자적으로 복원하고 중복 적용을 거절한다.
- Task 2/3: 새 앱 홈/상단 예약/자동 진행/인라인 이름/D 즉시/중앙 정렬/시계 회전 6개 Chromium/WebKit PASS. 자동 전환 tx 실패·재시도·구형 저장·실제 창 충돌의 추가 사례 Chromium 6 PASS.
- 기존 E2E의 카드 중앙 클릭이 새 이름 편집 영역에 걸리는 기대값 실패를 확인했다. D는 카드 본체, 이름은 이름줄로 테스트 조작을 명시적으로 분리하며 저장/게임 검증을 유지한다. 테스트를 스킵하지 않는다.
- Ruling: 승인된 상단 높이52→60/줄 간격2→8 변경은 원본 전체 이미지 일치 대상에서 제외하고, 상단을 자른 동일 테이블·하단 영역을 원래0.2% 기준으로 비교한다. 새 상단/중앙 UI는 실제 제품 흐름·배치 검사로 검증한다. 고정 HTML 원본은 수정하지 않는다.
- 최종 독립 검토(app_flow_review) 진행 중. 주요 Chromium 회귀, 전 브라우저 전체 검사, 일반 production 확인은 미완료.

- 주요 Chromium 회귀 37 PASS 뒤 PWA 검사 1 FAIL: 이미 홈 뒤에 보이던 모드 버튼을 재실행 완료로 간주한 테스트 대기 조건이 원인. 실제 timeOrigin 변경(문서 재실행)을 기다리도록 수정하고 재검증한다.

- Final review: 독립 검토 Important(P2) 2개. (1) 인라인 이름 편집 중 시작이 초안을 버림 (2) controlLost를 저장 중으로 간주해 홈 이동 차단. 각각 실제 브라우저 재현 후 회귀 추가. 임시 재현 서버가 이미 종료되어 ERR_CONNECTION_REFUSED가 난 첫 실행은 제품 실패 재현으로 취급하지 않고 정식 테스트 서버에서 재현했다.
- Final: Ruling: 입력 초안을 숨겨서 시작하지 않도록 이름 편집 중 시작은 입력 완료 안내 후 보류한다. Enter/바깥 탭으로 편집을 완료한 뒤 시작한다. 자동 저장+게임 시작의 별도 큐를 만들지 않는 최소 처리이며 한 번의 입력 완료 동작이 필요하다.
- controlLost에서 저장 요청이 없으면 앱 홈으로 이동하고 ready로 복귀하도록 수정. 저장/결과 불명 요청이 남은 경우 홈·업데이트 차단은 유지한다.

- 전체 검사 첫 실행은 Chromium91 PASS 뒤 아래 드래그 회귀1 FAIL. 빠른 인원 변경 직후 boundingBox로 읽은 좌표를 애니메이션 중 바로 누르는 수동 pointer 테스트가 간헐 실패(격리 반복8회 중1회)함을 확인. D/이름 영역 분리 후 본체를 누르도록 변경한 테스트에 요소 안정성 대기가 필요했다. drag helper에서 Playwright hover의 stable/actionability 확인 후 좌표를 읽도록 수정하고 반복·전체 재검증한다. 제품 회전 계산·저장 확인을 건너뛰지 않는다.
- 실제390px 앱 홈/4인 준비/블라인드5/10→10/20 연한 예약/자동 FLOP 캡처 및 pageerror0 확인. 변경 상단·중앙 정렬을 이미지로 확인했다. 최종 일반 빌드에서도 다시 확인 예정.
- 독립 검토2개 회귀 Chromium/WebKit4 PASS. 최종 전체 재실행은 테스트 안정성 보완까지 포함한다.

- 최종 전체 재실행: Chromium102 PASS, WebKit40 PASS 후 첫 원본 비교 FAIL. WebKit PNG가 deviceScaleFactor2(폭640px)인데 승인 상단52/60 CSS px를 물리픽셀로 자르던 검사 오류였다. header crop에 devicePixelRatio를 곱하도록 보완한다. 원본/임계값/제품 코드는 변경하지 않는다. Chromium(DPR1)의 검증 결과와 별도로 WebKit102 전체 및 Chromium 원본 비교30을 재검증한다.
- 아래 드래그 반복: Chromium5/WebKit5 총10 PASS. 이전 실패는 이동 중 좌표에서 pointerdown이 이름 버튼에 들어간 이벤트 추적으로 확인했으며 stable 대기 보완 후 통과.

- Task 2/3 완료 검증: 홈/상단·예약/직접 이름/즉시 D/시계 회전/자동 진행 및 저장 실패·구형 저장·창 충돌·리뷰 회귀를 추가했다. 타입·린트 PASS, 단위10 files/115 PASS. Chromium 전체102 PASS(204 실행 중 앞 프로젝트). WebKit은 캡처 배율을 보완한 최종102 전체 재실행 중이다.
- Final review gate: 독립 검토 Important2개 모두 회귀 RED→GREEN(Chromium/WebKit4 PASS). 별도 미룬 minor 없음. 제품 소스는 이후 변경하지 않았고 수동 pointer 안정성 및 PNG CSS→물리픽셀 변환만 테스트에서 보완했다.


### 앱 홈·자동 진행 최종 검증 — 2026-10-18

- 모든 승인 항목 구현 완료. 앱 전체 홈/모드·업데이트, 자동 생성·복원과 실제 창 충돌 안내, 게임 메뉴2개, HAND 기록/SB·BB 예약/연한 예약값, 공개 화면 없는 자동 진행, 인라인 이름/즉시 D/중앙 정렬/시계 회전.
- typecheck PASS, lint PASS, 단위10 files/115 PASS. 일반 production build PASS, dist/e2e 없음.
- 고유 브라우저 회귀204개 검증 완료: Chromium 전체102 PASS(verification-app-final.log의 첫 프로젝트), WebKit 전체102 PASS/4.0m(verification-app-webkit.log, exit0). 첫 전체 실행의 WebKit 캡처 단위 FAIL은 해당102개 전체 재실행으로 해소했다. 최종 보완한 crop로 Chromium 원본 비교30개 추가 PASS(verification-app-comparison.log, exit0). 실패/중단 로그는 위 이력으로 보존하며 PASS로 바꾸지 않는다.
- 아래 드래그 반복 Chromium5/WebKit5 총10 PASS. 독립 검토 Important2개는 각각 RED→GREEN, 양 브라우저4 PASS. 별도 미룬 minor/알려진 재현 실패 없음.
- 원본 비교는 승인 변경 헤더 제외/물리 배율 적용, 원래0.2% 허용치 유지. 승인 원본 SHA256 DCB12611FAFAC9DF7E5AE8FD4D8AC78117C2DB94FCC1E86F5504070A2ABC5A92 유지. 새 상단·중앙·홈은 실제 제품 화면으로 확인.
- 일반 production Chromium390×844 PASS: /→/local/ 앱 홈→오프라인 준비 완료→자동2인→4인/직접 이름/D/시계 회전→블라인드예약5/10→10/20→자동FLOP→HAND 기록→홈·새로고침·복원, pageerror0. 사용자 브라우저 데이터와 분리된 컨텍스트 사용.
- 캡처: frontend/test-results/production-app-home-390.png, production-app-setup-390.png, production-app-blinds-390.png (검증 산출물, Git 제외). 로컬 일반 preview http://127.0.0.1:4173/local/ 실행 중.
- README/START_HERE/IMPLEMENTATION_PLAN/UX_SPEC/GAME_SPEC/SYSTEM_SPEC/DESIGN_BASELINE/PLANNING/DEVICE_CHECKS 갱신. 최신 절이 이전 수동 공개/더블클릭/업데이트 종료 제한을 대체한다.
- 실제 iPhone/Android 하드웨어·설치 앱·실제 IME·터치·회전은 미검증(자동 터치 에뮬레이션과 구분). 멀티플레이 실제 구현·배포·commit/push/merge는 실행하지 않았고 .local/에 접근하지 않음.


### 원형 드래그·기록·창 조작 수정 — 2026-10-18 완료

- 승인 범위: 원형 경계 삽입/이름 글자만 편집/준비 전용 회전/오래된 순 기록과 역순 버튼/기록·블라인드·메뉴 바깥 닫기/가로 블라인드 입력.
- 원인: 고정 좌석 인덱스에 선형 splice하면서 원형 처음·끝을 넘는 이동이 모든 카드를 밀었다. 기본/회전 후 실제 브라우저 재현 완료.
- Step 1 원형 삽입 → verify: 인접 경계의 비대상 카드 고정, 2~9인 전체 방향·회전·복원.
- Step 2 이름/회전/창/블라인드 → verify: 글자 밖 클릭·드래그, 단계별 회전 숨김, 내부 클릭 유지·외부 닫기·입력 취소.
- Step 3 기록 → verify: 오래된/최신 정렬, 페이지 경계/취소/반환/분할 지급, 기술 기록 미노출.
- 기존 codex/single-device에서 이어서 진행. 최종 시안 원본 유지, 멀티플레이·배포 제외.

- 초기 RED: interaction-revision Chromium4개 모두 기존 동작 때문에 FAIL. 신규 단위2파일은 미구현 모듈로 FAIL 후 구현, 원형/기록4개 PASS.
- 1차 GREEN: 신규 Chromium4 PASS. typecheck/lint PASS, 전체 단위119 PASS.
- 확장 targeted 검사: 원형·이름/창·gap·2~9인·기록 페이지 회귀는 통과하며 진행. 기존3인 테스트의 선형 이동 기대값1개 FAIL 확인 후 전체 검사 중단, 원형 최단구간 결과로 갱신 예정.
- 독립 검토 interaction_review: Important2개 확인(이름 CSS 공통 reset 누락/0칩 지급자 표시). 회귀를 추가해 RED 확인 후 수정한다.
- Ruling: 기록은 원본을100건 단위로 읽고 취소를 반영한 후50행씩 표시한다. 역순에서도 페이지 경계를 넘는 취소·핸드 묶음을 정확히 처리하는 최소 구현이며, 아주 긴 토너먼트에서는 초기 조회 시간·메모리가 기록량에 비례한다. 저장 형식이나 원본 이벤트는 변경하지 않는다.

- 독립 검토 Important2개 수정 완료: 실제 이름 버튼44px→기존23px reset 복구, 0원 패자/탈락 수령자 필터. 각각 회귀 RED 확인(verification-name-style-red.log, verification-history-zero-red.log), 수정 후 단위120 PASS/타입·린트 PASS.
- 영향 범위 양 브라우저60 PASS(verification-interaction-targeted-final.log). 기존3인 기대값은 원형 최단구간 순서로 수정, 최신 추가 참가자 삭제/P3재사용 검증은 유지했다.
- 긴 드래그 추가 경계: P1→P6→P5→P4 연속 이동 중 처음 배열로 매번 재계산하여 반대편에서 방향이 뒤집히는 FAIL을 별도 격리 브라우저로 확인(verification-drag-path-red.log). 현재 미리보기 순서에 이어서 삽입하도록 두 줄 보완하고 회귀 추가.
- 최종 전체 Chromium/WebKit232개 실행 중. 초기60 PASS만으로 최종 완료를 주장하지 않는다.

- 전체232개 첫 실행: Chromium116 PASS, WebKit115 PASS/1 FAIL(카드 사이 미리보기 즉시 읽기). 합계231 PASS/1 FAIL, verification-interaction-full.log 보존.
- WebKit 반복 추적5회에서1회 immediate가 중간 포인터(235,281)를 읽고80ms뒤 최종(334,175) 및 P6→아래 삽입으로 갱신됨을 확인(verification-webkit-gap-trace.log). 제품 계산 변경 없이 기대 배치까지 expect.poll로 기다리도록 검사 보완. 고정 sleep으로 통과시키지 않음.
- 보완 후 카드 사이/반대편 연속 드래그를 양 브라우저 각5회(총20개) 반복한 뒤 WebKit116 전체 재실행. 원본 이미지·허용치 유지.
- 추가 단위: 2~9인 모든 출발·도착·화면 기준과 모든 틈의 이웃 관계 검증. 최종 단위12 files/121 PASS, typecheck/lint PASS.


#### 최종 검증 결과

- 승인 항목 모두 구현 완료. 원형 처음·끝/긴 연속 이동에서 현재 미리보기의 짧은 구간만 밀며 지정한 카드 사이에 삽입, 이름 글자만 편집/나머지 카드 D·드래그, 준비 전용 회전, 시간순 기록/전체 역순 전환/핸드 묶음/기술 기록·취소 행동·0원 수령 숨김, 세 창 바깥 닫기, SB/BB 가로 내부 라벨·예약만.
- 최종 typecheck PASS, lint PASS, 단위12 files/121 PASS(verification-interaction-unit.log).
- 고유 브라우저 회귀232개 PASS: Chromium116(verification-interaction-full.log의 첫 프로젝트) + 최종 WebKit116/5.6m/exit0(verification-interaction-webkit-final.log). 첫 전체의 WebKit1 FAIL은 위 이벤트 처리 시점 추적으로 확인하고 최종116개 전체 재실행으로 해소. 원래 실패 로그 보존.
- 드래그 틈 삽입·반대편 연속 경로 양 브라우저 각5회 총20 PASS(verification-interaction-repeat.log). 앞선 영향 범위60 PASS와 구분한다.
- 독립 리뷰 Important2개 모두 RED→GREEN 및 실제 일반 빌드 화면 확인 완료. 별도 미룬 minor 없음. 기록 전체 조회 비용의 Ruling은 위와 같이 유지한다.
- 일반 production build PASS, dist/e2e 없음. 격리 Chromium390×844: 6인 원형 드래그/P2위치고정/이름 편집→2인 변경/이름줄 빈 공간 D→시작/회전없음→가로블라인드예약→8행동 자동진행/승자선택 회전없음→WIN/다음블라인드→시간순·최신순 기록→320px/터치 바깥 닫기 PASS, pageerror0(verification-interaction-production.log).
- 일반 빌드 캡처4장 직접 확인: frontend/test-results/production-interaction-setup-390.png, production-interaction-blinds-390.png, production-interaction-history-390.png, production-interaction-history-320.png.
- 승인 원본 SHA256 DCB12611FAFAC9DF7E5AE8FD4D8AC78117C2DB94FCC1E86F5504070A2ABC5A92 유지, 양 브라우저 원본 비교 임계값0.2% 유지.
- README/START_HERE/IMPLEMENTATION_PLAN/UX_SPEC/DESIGN_BASELINE/PLANNING 갱신. 일반 preview http://127.0.0.1:4173/local/ 실행 중.
- 실제 휴대폰 하드웨어·설치 PWA·실제 IME/터치는 별도 검증 필요. 멀티플레이/배포/commit/push/merge 제외, .local/ 접근 없음.


### 팟 합치기·단계 기록·전환 강조 — 2026-10-18 완료

- 승인 계획 실행: ① 같은 승자 자격의 납부 구간 합치기 → verify: 5/10/10 폴드25팟·실제올인·동률/잔여칩·반환. ② HAND/프리플랍~쇼다운을 시간순 행으로 만들고 전체 역순 → verify: 페이지 경계·취소·폴드종료·조기올인. ③ 단계 글자만 금색/1.1배/약0.5초 강조 → verify: 실제 전환만1회·첫복원/일반행동 재생안함·reduced-motion.
- 가정: 제안①의 은은한 글자 강조를 선택한다. 게임 화면 숫자·카드·테이블 크기는 유지. 저장 스키마와 원본 이벤트는 변경하지 않는다.
- 원인 재현: 콜/체크3인 각10은30한팟 정상. SB5폴드+나머지각10은 잘못15/10으로 갈라짐. 같은 승자 자격 구간을 합쳐야함.

- RED: 신규 팟2/단계기록2 총4 FAIL 및 애니메이션 브라우저1 FAIL 확인. 각 실패 로그 보존.
- 팟 수정 후 기존P06의60/80 기대값만 FAIL: 자격자가 같은 두 층이므로 새 실제 팟140 하나로 fixture의 amounts/eligible와 expectedStateSubset을 함께 수정했다. 미콜40/지급140/총180의 장부 기대는 유지. 이후 정산24 PASS.
- 단계 기록5 PASS, 최종 단위125 PASS/typecheck·lint PASS. 독립 리뷰 stage_pot_review Important/Critical 없음, 팟·기록29개 독립 PASS.
- Chromium 주요 회귀34 PASS, WebKit 주요 회귀 진행 중. 아직 최종 완료 아님.
- 명세의 이전 동일자격층 ID 유지 지침은 승인된 팟 오류 수정에 맞춰 실제 팟 확정 전 합치기로 정정. 명시적으로 주어진 별도 팟의 분배 계약(W10)은 그대로 유지한다.

- 주요 브라우저68개 모두 PASS(verification-stages-targeted.log, Chromium34+WebKit34). 실제 단계·HAND전체역순·페이지 경계·폴드 단일25팟·기존 실제사이드팟·초기/복원 효과생략·동작줄이기 확인.
- 나머지 회귀 첫 실행에서 대기 화면 원본 비교6개 FAIL 확인 후 중단(verification-stages-regression.log). diff가 중앙 TABLE/명수에만 집중: 빈 단계 span의 inline-block이 줄 높이를 만들어 중앙을 이동시킴. `.stage-label:not(:empty)`로 비어 있지 않은 단계 글자에만 적용하도록 수정. 원본·이미지 허용치 변경 없음.
- 보완한 일반배치/시안비교·앱흐름·PWA·준비·저장172개 재실행 중(verification-stages-regression-final.log).


#### 단계 기록·팟 수정 최종 검증

- 승인 항목 구현 완료: 프리플랍/플랍/턴/리버/쇼다운 또는 폴드 핸드 종료를 실제 이벤트로 표시. HAND와 단계도 시간순 행에 포함하여 전체 역순에서 HAND가 각 핸드 아래로 이동. 50행 더 보기에서도 표제 중복 없음. 취소된 행동/기술 이벤트/0원 수령 숨김 유지.
- 단계 글자만520ms 금색·1.1배 강조, 실제 전환/새 핸드만1회. 최초 표시/새로고침 복원/같은 단계 조작 생략, reduced-motion 생략. 비어 있는 준비 단계 줄에는 inline-block을 적용하지 않아 기존 중앙 위치 유지.
- 같은 수령 자격의 납부층을 합쳐 올인 없는 SB폴드5+10+10을25 한 팟으로 정산. 실제 올인 자격 경계와 여러 팟의 승자 선택은 유지. 같은 자격층의 동률 잔여칩 중복 배정도 방지. 단일 팟은 POT로 표시.
- typecheck PASS, lint PASS, 전체 단위12 files/125 PASS(verification-stages-unit.log). 독립 stage_pot_review Important/Critical 없음, 정산/기록29개 독립 PASS. 미룬 결함 없음.
- 고유 브라우저240개 PASS: 관련68개/4.3m(verification-stages-targeted.log, Chromium34+WebKit34) + 나머지172개/4.0m(verification-stages-regression-final.log, Chromium86+WebKit86). 중복 없는 전체 테스트 파일 범위를 검증. 초기 실패와 중단 로그는 보존하며 PASS로 바꾸지 않음.
- 승인 원본 이미지 비교 양 브라우저 전체 PASS, 허용치0.2% 유지. 원본 HTML SHA256 DCB12611FAFAC9DF7E5AE8FD4D8AC78117C2DB94FCC1E86F5504070A2ABC5A92 유지.
- 일반 production build PASS/dist/e2e 없음. 격리 Chromium390×844/320×568: 강조 효과 색 rgb(219,190,127)/scale1.08291 중 팟 숫자 bbox 완전 동일, 4스트리트→정산→단계기록/전체역순/HAND맨아래, 3인 SB폴드25단일팟, HU 마지막폴드 핸드종료/미콜5반환/쇼다운없음 PASS, pageerror0(verification-stages-production.log).
- 캡처4장 직접 확인: frontend/test-results/production-stage-highlight-390.png, production-stages-history-390.png, production-stages-reversed-footer-320.png, production-fold-single-pot-390.png.
- GAME_SPEC의 동일자격층 유지 지침/P06 fixture, UX_SPEC, README, START_HERE, IMPLEMENTATION_PLAN, DESIGN_BASELINE, PLANNING 갱신. 원본 이벤트·저장 스키마 변경 없음.
- 일반 preview http://127.0.0.1:4173/local/ 실행 중. 실제 휴대폰 하드웨어·설치 앱·실제 IME/터치 검증은 별도이며 자동 브라우저 검사와 구분한다. 멀티플레이/배포/commit/push/merge 미실행, .local/ 접근 없음.


### 텍스트 선택 차단·강조 효과 보강 — 2026-10-18 완료

- 가정: 일반 페이지/창의 드래그 텍스트 선택은 차단하고 이름·숫자 입력의 선택/편집은 유지한다. 단계는 기존520ms 유지, 최대 확대1.1→1.22/굵기750로 보강 후 원래 굵기·색·크기로 복귀한다.
- Step 1 선택 CSS → verify: 실제 홈/기록 창 드래그 선택 없음, 설정/이름 입력 전체선택·편집 유지.
- Step 2 강조 keyframes → verify: 최대 확대/굵기 증가·종료 복원, 기존 단계1회/복원생략/reduced-motion 회귀.

- 신규 회귀2개 RED 확인(홈 텍스트 선택 발생/강조 scale1.08291), 구현 후 첫 양 브라우저12개 중11 PASS/Chromium 모달 선택1 FAIL. 본문 none에 비해 native DIALOG/P는 computed user-select:text로 재설정됨을 실측했다. body와 dialog 모두 none을 명시하고 입력 text 예외는 유지한다. 초기 실패 로그 보존.
- 최종 양 브라우저12 PASS/48.4s(verification-selection-final.log). 홈·기록 창의 실제 드래그 선택 차단/설정 및 이름 전체 선택·편집/확대와 굵기 복귀/단계1회/복원생략/reduced-motion 검증. typecheck·lint PASS, 일반 production build PASS/dist/e2e 없음. 이전 전체 단위125/브라우저240 결과와 이번 관련12개를 구분한다.
- 독립 selection_emphasis_review 정적 검토 Important/Critical 없음. 입력 예외·효과 복귀·이전 애니메이션 취소 확인. 브라우저에서 발견한 native dialog 스타일은 별도 회귀로 수정했다.
- 일반 빌드 실제 확인 PASS/pageerror0: 단계 강조130ms에서 scale1.18241/font-weight690, 팟 숫자 bbox 완전 동일. 효과 캡처 직접 확인. 모달 SB 전체선택/10입력/BB20예약도 성공. 기존 단계기록/역순·폴드단일팟/핸드종료도 함께 확인(verification-selection-production.log).
- 최대강조는1.22/굵기750, 기간520ms, 시작/끝은 실제 기존 굵기·색·크기다. 일반 화면과 창의 선택만 차단하며 input/textarea/contenteditable은 편집 선택을 유지한다. 사용자 브라우저 저장·시안 원본·게임 규칙 미변경. 일반 preview http://127.0.0.1:4173/local/ 실행 중.


### 앱 업데이트 자동 확인·안내 정리 — 2026-10-18 완료

- /local/ 홈·단일 기기 오프라인 캐시 유지, /online/·API·WS 캐시 제외 유지. 멀티 구현·배포 제외.
- Step 1 확인 상태 구분 → verify: 설치 중 최신 오판 방지/새버전/최신/오프라인 실패/닫기·재시도·시간 초과.
- Step 2 창/홈 문구 정리 → verify: 클릭 즉시 확인, 확인버튼·닫기버튼 없음/바깥 닫기, 적용 중 닫기·중복 방지.
- Step 3 실제 SW 업데이트 → verify: 새 버전 준비 후 적용·재시작·저장 게임 보존, 오프라인 재개와 캐시 범위 유지.
- 정상 오프라인 상태 문구는 숨기고 캐시 저장 실패만 홈에 친숙한 문구로 알린다.

- 구현: 자동 확인 상태/설치 완료 대기/오프라인 실패/시간 초과/늦은 응답 무시, 새 버전 적용 전 저장 검증, 적용 중 닫기·중복 차단. 일반 상태 문구·별도 확인·닫기 버튼 제거.
- 실패 기록 보존: 초기 UI/오프라인 재시도/적용 타이밍 회귀 실패 후 수정. Playwright waitForFunction의 async predicate가 즉시 truthy가 되어 설치 전 오프라인으로 전환하던 테스트를 expect.poll로 바로잡았다.
- 실제 WebKit 첫 설치 실패 복구에서 활성 워커는 있으나 shell 캐시가 없는 문제 재현(verification-update-cache-trace*.log). 실패한 첫 설치의 부분 캐시가 재사용되는 것이 원인으로, 캐시 삭제 단일 가설 검증 PASS 후 활성/설치/대기 워커와 controller가 없을 때 해당 /local/ precache만 삭제하도록 수정. 복구 후 실제 오프라인 새로고침 검증 추가. IndexedDB 미변경.

- 최종 검증: 전체 단위13 files/130 PASS(verification-update-unit-final.log), 관련 브라우저30 PASS/1.3m(Chromium15+WebKit15, verification-update-targeted-pass.log). 첫 설치 실패 복구 후 실제 오프라인 새로고침도 양쪽 PASS. 초기 실패 로그는 그대로 보존한다.
- typecheck PASS. 기본 lint는 이전 .cache 진단 스크립트5개 전역 변수 경고로 FAIL; 생성된 일회성 .cache만 제외한 `npm run lint -- --ignore-pattern '.cache/**'`로 앱 소스·테스트 lint PASS. 소스 검사 규칙·기존 진단 스크립트는 바꾸지 않았다.
- 독립 auto_update_review 정적 검토 Important/Critical 없음. 이후 추가된 첫 설치 복구는 실제 실패→단일 캐시 정리 가설 PASS→양 브라우저 재검증으로 확인했다.
- 일반 production build PASS/dist/e2e 없음(verification-update-build.log). 격리 Chromium390×844/320×568 실제 홈·즉시 확인·최신·바깥 닫기·오프라인 실패·온라인 재시도 PASS/pageerror0(verification-update-production.log). production-update-home-390.png/current-390.png/error-320.png 캡처, 최신/실패 창 직접 확인.
- README/UX_SPEC 최신 안내 반영. 일반 preview http://127.0.0.1:4173/local/ 실행 중. 사용자 저장소·시안 원본 변경 없음. 멀티플레이·배포·commit/push/merge 미실행. 실제 휴대폰 설치 앱 검증은 별도다.


### 기록 제목·메뉴 홈 정렬 — 2026-10-18 완료

- 가정: 기록 제목과 정렬 버튼은 같은 행에서 세로 중심을 맞추고, 메뉴 홈 버튼은 기존 동작을 유지하며 글자만 가운데 둔다.
- Step 1 기록 제목/정렬 버튼 한 행 → verify: 390/320px 겹침 없음·세로 중심 일치·정렬 기능 유지.
- Step 2 메뉴 홈 문구/가운데 정렬 → verify: 홈 이동 후 저장 상태 복원·메뉴 글자 가운데.
- Dialog는 기록 창에서만 기본 제목을 숨기고 기록 패널의 제목을 표시한다. 다른 창 구조와 게임 로직은 유지한다. 관련 기존 테스트의 버튼 이름을 갱신한다.

- 결과: 제목 왼쪽/정렬 버튼 오른쪽 같은 행에서 세로 중심 정렬. 제목은320px에서16px/390px에서19px로 겹침 방지. 관리 메뉴 홈 문구 및 가운데 정렬, 기존 콜백 유지.
- typecheck PASS, 소스·테스트 lint PASS(기존 생성 .cache 제외). 관련 브라우저30 PASS/1.8m(Chromium15+WebKit15, verification-header-menu.log): 기록 전체 역순/HAND 위치/홈 복원/기존 단계 효과·편집 유지. 일반 build PASS/dist/e2e 없음.
- 일반 빌드390/320 실제 검사 PASS: 제목·정렬 버튼 중심 차이 모두0px, 가로 겹침 없음, 정렬 전환/홈 가운데/게임 팟15 복원/pageerror0(verification-header-menu-production.log). 첫 개별 bbox 측정에서320px 중심차이21.5px FAIL이 발생해 같은 레이아웃 시점에서 두 치수를 함께 poll하도록 진단 스크립트를 보완한 뒤 재검증 PASS. 제품 코드는 추가 변경하지 않았다. production-header-320.png 및 production-menu-320.png 직접 확인.
- 독립 header_menu_review Important/Critical 없음. 기록 창만 기본 제목 숨김, 접근성 이름·다른 창 제목 유지 확인.
- preview http://127.0.0.1:4173/local/ 실행 중. 멀티플레이·배포·저장 스키마·게임 로직 미변경.


### 태블릿 PWA 복구·터치·화면 맞춤 — 2026-10-19 완료

- 브랜치 codex/tablet-pwa-recovery, origin/main(154daa4) 기준. 기존 auto-deploy 커밋은 포함하지 않는다. 작업 트리 깨끗한 상태에서 분기.
- 최신 승인: 기본 화면 스크롤 금지, 핸드 기록 창은 기존 내부 스크롤/더 보기 유지. 사용 가능한 너비와 높이에 맞춰 구성요소를 함께 축소·확대, 가로는 높이에 필요한 너비만 쓰고 중앙 배치. 실패 복구는 다시 시도/새 토너먼트 시작 두 선택지, 교체 확인·쓰기 성공 전 기존 저장 보존.
- Step 1 저장 복귀 → verify: 무응답 제한/재시도/손상 저장 명시적 교체·실패 rollback/늦은 응답 무시/다른 창 권한 보존. 완료 시 커밋.
- Step 2 터치 → verify: 카드 contextmenu 차단/이름 입력 예외/실제 touch 드래그/취소 상태 복구. 완료 시 커밋.
- Step 3 화면 맞춤 → verify: 휴대폰/태블릿 세로·가로, 2~9인/창/입력/베팅/승자에서 스크롤 없음·겹침 없음·좌표 일치. 완료 시 커밋.
- 기준선 단위13 files/130 PASS(verification-tablet-baseline.log). 갤럭시탭 S7 Chrome PWA 실제 복귀 원인은 원격 기기 로그 없이 확정하지 않으며 자동 검사와 실기기 검증을 구분한다. 배포/PR/merge/push는 이번 작업에서 하지 않는다.

#### Step 1 저장 복귀 완료

- 연결/읽기/복원/명시적 새 저장8초 제한, 타임아웃 시 읽기 트랜잭션 취소. 늦은 연결은 닫고 이전 복원은 세대 비교로 무시. visible/pageshow/resume에서 재연결·상태/조작권 검증. 저장 중/결과 불명 요청은 자동 재실행하지 않는다.
- 복원 실패 전용 화면에 다시 시도/새 토너먼트 시작. 교체 확인 후 slot/events/control 한 트랜잭션으로 새 게임·새 세대 확정, 실패 rollback. 슬롯 읽기·검증 실패 상태에서도 쓰기가 가능하면 명시적 교체 가능.
- 새 단위3개 RED 확인 후 전체14 files/133 PASS(verification-tablet-recovery-unit.log). 타입 테스트 코드 오류와 권한 탐색까지 차단했던 초기 다중창 테스트 실패는 수정하고 숨기지 않음. 기존 앱흐름/실제저장26개 PASS(verification-tablet-recovery-browser.log), 보완 복귀·교체8개 양 브라우저 PASS(verification-tablet-recovery-final.log). 고유 관련34개 PASS.
- 루트 브랜치는 origin/main 기준. 사용자 요청에 따라 Step 1 완료 상태를 별도 커밋한다.

#### Step 2 터치 드래그 검증

- 카드 contextmenu만 취소하고 입력/textarea/contenteditable은 제외. WebKit callout도 카드에서 막고 이름 입력은 default 유지. primary 포인터만 처리하며 touch/pen은 누르기 전 이동 임계값을 넘으면 취소 대신 드래그 시작, mouse는 기존 길게 누르기 유지.
- 새 검사2개 수정 전 RED(verification-tablet-touch-red.log). 처음 pointerdown 전체 취소는 WebKit 탭을 막아 제거하고 contextmenu 차단으로 범위를 좁혔다.
- 기존 Chromium 반대편 드래그 검사는 수정 전 훅에서도 FAIL(verification-tablet-mouse-baseline.log). 인원 추가 직후 카드 transition 중간 좌표를 목적지로 저장하던 경합. 해당 검사에서 실제 카드 애니메이션 완료를 기다린 후 같은 기대 순서를 검증하도록 보완. 제품의 마우스 삽입 규칙은 변경하지 않았다.
- 최신 사용자 정정: 기본 화면은 스크롤 금지, 핸드 기록 창은 기존 스크롤/더 보기 유지. 기록 페이지 전환 계획은 취소하고 구현하지 않는다.

- Step 2 완료: 타입·소스/테스트 lint PASS, 양 브라우저47 PASS/2.3m(verification-tablet-touch-green.log). CDP 실제 터치1개는 Chromium에서 실행 PASS하며 WebKit에는 CDP가 없어1개 명시적 skip, WebKit 탭/편집/contextmenu/마우스 회귀는 별도 PASS. 각 단계 검증 후 두 번째 커밋.

#### Step 3 화면 맞춤 구현·검증

- body/root 스크롤 잠금. 공통 CSS 길이 단위와 실제 viewport/내용 ResizeObserver로 기본 화면·비기록 창 전체를 맞춤. transform으로 전체 앱을 확대하지 않으므로 포인터 좌표계 유지. 정상320/390은 기존 치수 유지, 태블릿 확대, 짧은 가로는 높이에 필요한 폭만 중앙 배치.
- scrollable Dialog 예외는 기록에만 적용하여 내부 스크롤/더 보기/정렬 유지. 페이지 분할 코드 미구현. 기록120행 검사에서 실제 내부 scrollTop>0/문서 scrollY=0도 추가 검증.
- 짧은844×390 기본 화면의 넘침 RED 확인(verification-tablet-layout-red.log). 초기 viewport 검사에서 준비 중 비활성 블라인드를 누르던 테스트/복수 textbox 선택 오류를 수정 후, 양 브라우저20 PASS/1.2m(verification-tablet-layout-final.log). 320×568/390×844/800×1280/1280×800/844×390/667×375/320×240, 2~9인·메뉴·블라인드·기록·이름·베팅·승자 검증. 기록만 스크롤 예외.
- 전체 단위14 files/133 PASS(verification-tablet-unit-final.log). 최종 전체 브라우저 회귀와 일반 빌드 검증 진행 중. 독립 tablet_final_review Important/Critical 없음(읽기 전용 정적 검토, 실제 기기 동작은 별도).

#### 최종 검증·완료

- 추가 발견/수정: Table 숫자 맞춤이11px를 강제로 재지정해 태블릿 이름22.5641px/숫자11px가 되는 RED 재현(verification-tablet-number-red.log). 같은 CSS 단위를 사용하고 Table ResizeObserver에서 재맞춤하도록 수정. 기본 금액 숫자/이름 크기 일치와9,000,000 스트레스 원본 비교를 함께 PASS.
- 첫 전체 실행은228 PASS/3 FAIL/55 미실행(verification-tablet-full-first.log): 이름 높이23px 고정 기대 양 브라우저2건은 반응형 이름줄 높이 일치 검사로 갱신. CDP 동결 시도는 실제 freeze/resume 이벤트를 발생시키지 않음(trace=[]/visible 유지) 확인 후 테스트 환경 한계로 구분하고 실제 resume 핸들러 이벤트·연결 재개/게임 보존을 양 브라우저에서 직접 검증. 실제 갤럭시탭 OS 앱 전환을 자동 검사했다고 주장하지 않는다. 부분 실행은 PASS로 둔갑시키지 않는다.
- 최종 고유 브라우저285 PASS/1 skip: SW 파일을 변경하지 않는 독립 검사271 PASS/4.0m(verification-tablet-regression-pass.log, workers3) + PWA14 PASS/39.6s(verification-tablet-pwa-final.log, workers1). 전체 테스트 파일/양 브라우저 범위를 검증했다. skip1은 WebKit에 없는 Chrome CDP 실제 touch이며 Chromium에서 실행 PASS. 기록 실제 scrollTop>0/문서 scrollY=0, 손상 읽기/교체 확인·취소·쓰기 실패 원본 보존/권한 복귀/resume/실제 touch 및 기존 전체 게임 포함.
- 최종 전체 단위14 files/133 PASS(verification-tablet-unit-final.log), typecheck·소스/테스트 lint PASS(.cache 생성 진단 파일만 제외), 일반 production build PASS/dist/e2e 없음(verification-tablet-build.log). 승인 원본 SHA256 DCB12611FAFAC9DF7E5AE8FD4D8AC78117C2DB94FCC1E86F5504070A2ABC5A92, 이미지 비교60개/기존0.2% 허용치 유지.
- 일반 빌드 실측(verification-tablet-production.log): 800×1280 앱799.984×1143.094/글자·숫자22.5641px, 1280×800 앱557.141×796.078/15.7143px, 844×390 앱271.594×388.063/7.66071px. 모두 페이지 scroll=[0,0]. 9인36행동→승자→HAND02→기록 내부 스크롤→읽기 실패 두 버튼→재시도로 같은 HAND02/POT15 복원 PASS/pageerror0.
- production-tablet-setup-800-1280.png/setup-1280-800.png/settlement-1280.png/history-scroll-1280.png/recovery-1280.png 직접 확인. computed font-family도 기존 system-ui/-apple-system/Segoe UI/sans-serif 유지 확인.
- 독립 tablet_final_review Important/Critical 없음. 이후 추가 숫자 보완은 RED→GREEN 및 전체 회귀로 검증. 미뤄둔 제품 결함 없음. 실제 갤럭시탭S7 설치 앱의 OS 메뉴·전환·실제 키보드 검증은 배포 후 별도로 확인할 항목이다.
- UX_SPEC/SYSTEM_SPEC/DESIGN_BASELINE/START_HERE/README 동기화. 사용자가 요청한 세 번째 작업 커밋 후 브랜치를 남긴다. preview http://127.0.0.1:4173/local/ 실행 중. 서버 배포/PR 생성/push/merge 미실행.

## 2026-10-20 모바일 터치·깜빡임 수정

- 진행 규칙: 앞으로 작업 하나가 완료될 때마다 관련 검증 후 로컬 커밋한다. AGENTS.md에 영구 기록. 기존 codex/tablet-pwa-recovery 브랜치 유지, 배포/push/PR 제외.
- 계획: (1) 기본 터치 강조 제거 → 실제 탭·키보드 동작 검사. (2) 반응형 단위 오차 반복 계산 제거 → 유휴·클릭·회전 시 안정화와 화면 포함 검사. (3) 저장 중 불필요한 밝기 변화 제거 → 실제 지연 저장/연타/오류 검사. 기본 화면 스크롤 금지, 핸드 기록 내부 스크롤 유지.
- 작업 1 완료: root에 투명 tap-highlight 설정. 기존 focus-visible/입력 편집/카드 터치 동작 유지.
- 검증: Chrome 기본 파란값으로 회귀 RED → 수정 후 터치 브라우저 5 PASS/1 skip, 전체 단위 133 PASS. WebKit 데스크탑은 해당 속성 미지원(계산값 빈 문자열)이므로 지원 브라우저만 색상 검사, 실제 탭·편집·키보드는 양쪽 실행. skip은 기존 WebKit CDP touch 미지원. 최초 테스트 타입 오류와 WebKit 미지원 기대 실패를 수정 후 재검증했으며 제품 결함으로 숨기지 않음. 로그: verification-touch-highlight-{red,green,unit}.log.
- 작업 2 완료: useScreenFit의 CSSOM 소수점 반올림 차이를 0.0001 CSS 단위 이하에서 무시. 실제 viewport 변경·컨텐츠 크기 감지는 유지하며 동일 viewport/창 위치도 중복 기록하지 않음. 극소 오차만 무시하므로 최대 화면 크기 오차는 0.1px 미만 수준이며 기존 1px 포함 검사 유지.
- 검증: 유휴 15프레임 동안 style 변경 15회로 RED → 유휴/클릭/가로전환/메뉴창에서 반복 변경 0회 GREEN(양 브라우저). 기존 320×240~1280×800, 2~9인·입력·베팅·승자·창 포함 레이아웃 22 PASS, 전체 단위 133 PASS. 로그: verification-fit-stability-{red,green,unit}.log.
- 작업 3 완료: 저장 중 aria-busy 구간에서만 임시 비활성 버튼/입력/회전의 투명도 변화를 억제. 저장 잠금·disabled/aria-disabled·성공 전 기존 상태·오류/재시도는 그대로 유지. 인원 2/9 제한, 취소 불가, 칩 부족, BET 입력 불가는 data-unavailable로 구분해 원래 흐린 표시 유지.
- 검증: 실제 IndexedDB 완료 응답 보류에서 setup/betting 투명도 변경 RED2 → 양 브라우저 실제 탭·밝기 유지·연타 차단·성공 후 새로고침 상태 보존 4 PASS. 베팅은 시작 칩50으로 불가 칩 버튼도 함께 검사. 최초 보류 테스트는 WebKit에서 완료 이벤트가 release보다 늦게 오는 경우를 놓쳐 2 FAIL/나머지32 PASS였으며, release 후 도착 이벤트도 즉시 전달하도록 테스트만 보완 후 재실행 PASS. 테스트 작성 시 타입/린트 오류도 수정 후 재검증. 로그: verification-saving-appearance-{red,green,final,unit}.log.
- 최종 검증: 전체 비PWA 브라우저 279 PASS/1 skip (4.1m, verification-touch-flicker-regression.log), 전체 단위14 files/133 PASS (verification-touch-flicker-unit-final.log), src/e2e/tests ESLint PASS, production build/typecheck PASS (verification-touch-flicker-build.log). skip은 기존 WebKit CDP touch 미지원이며 Chrome에서 실제 touch PASS. 디자인 원본 비교·기록 내부 스크롤·기본 화면 스크롤 금지·드래그·설정·게임·저장 오류·복구 모두 회귀 범위에 포함. 기존 PWA SW 변경 검사는 이번 범위에 변경이 없어 분리·미실행; PWA 전체 재검증을 주장하지 않음.
- 실행 계획 스킬의 독립 read-only 최종 리뷰 touch_flicker_review: actionable bug 없음. 실제 Galaxy Tab Chrome/PWA 합성 깜빡임·네이티브 터치 렌더링은 하드웨어 없으므로 판단 범위 밖으로 명시; 실기기에서 제거됐다고 단정하지 않는다.
- 로컬 production 빌드 갱신/dist/e2e 없음, http://127.0.0.1:4173/local/ HTTP200 확인. 배포/push/PR/merge 미실행. 브라우저 기존 SW는 앱 업데이트 적용 후 최신 UI를 확인할 수 있다.

## 2026-10-20 입력 배율·키보드·카드 누름 개선

- 승인 계획: (1) 폰트 유지한 입력 자동 확대 제한 → 진입 viewport/실제 폰트 확인. (2) 앱 확대 제스처 제한 → 기록 스크롤/편집 유지. (3) 키보드 중 UI 배율 유지·가린 입력 이동 → 회전/닫기 복귀. (4) 누름 즉시·350ms 준비 효과 → 취소/이동/딜러/이름 회귀. 각 작업 검증 후 개별 커밋. 실제 iPhone/Android 키보드 검증은 자동 데스크톱 검사와 구분.
- 최신 origin/main(145ae70)에 기존 태블릿·자동 배포 작업 병합 확인 후 codex/input-viewport-feedback 분기. 멀티플레이 구현·배포/push/PR은 범위 밖.
- 작업 1: 세 진입 HTML의 initial/minimum/maximum-scale=1, user-scalable=no 적용. 미구현 online은 동일 진입 정책만 적용하며 기능 추가 없음. 입력 글자 크기는 변경하지 않음.
- 검증: 기존 확대 제한 없음 RED, 실제 /local 진입이 별도 HTML임을 브라우저 검사에서 발견해 해당 파일까지 수정. 종료된 로컬 preview를 재시작 후 Chromium/WebKit 모바일 에뮬레이션에서 viewport 설정·시작칩12px/이름입력11px 유지 PASS. 전체 단위133 PASS, production build와 세 진입 HTML 검사 PASS. verification-focus-limit-{build,unit}.log. iPhone OS 입력 포커스 확대 차단을 실기기 검증했다고 주장하지 않음.
- 작업 2 완료: CSS pan-x/pan-y로 확대 제스처를 제한하되 스크롤은 허용, 기록 창은 pan-y 유지. 페이지 수명 동안 Ctrl+휠/확대 단축키와 Safari gesturestart/change만 억제. 일반 휠·touchmove·복사·AltGr·문자 편집은 건드리지 않음. 브라우저 메뉴/OS 접근성 확대의 완전 차단은 범위 밖.
- 검증: 기존 확대 이벤트 미차단 RED → 양 브라우저 편집/키보드 및 기존 실제 터치·기록/원형 드래그 35 PASS/1 기존 WebKit CDP skip. Chrome 실제 CDP touch pinch 후 scale=1 PASS. 전체 단위133 PASS. verification-zoom-policy-{red,green,unit}.log. viewport만으로 Safari 핀치가 막힌다고 주장하지 않음.
- 작업 3 완료: 보이는 영역(키보드 제외)과 전체 레이아웃 영역을 구분하고, 입력 중 키보드가 덮는 높이 감소에는 직전 디자인 viewport 유지. main/팝업이 같은 기준을 공유하며, 포커스가 없어져도 키보드 닫힘 전에는 축소하지 않는다. 폭 변경은 새 레이아웃 높이로 재계산, 일반 창 크기 변경은 기존 맞춤 유지. 가려진 준비 입력 그룹/이름 카드만 translate로 이동 후 복귀. 폰트/드래그 좌표 계산 단위 미변경. 기록 창 높이는 실제 보이는 높이를 사용해 내부 스크롤 유지.
- 검증: 기존 키보드 영역 모사에서 이름11px→5.89286px 등 RED3 → 양 브라우저 키보드 모사6 PASS/기존 레이아웃22 PASS, 전체 단위133 PASS, lint PASS. 최초 회전 모사 WebKit1 FAIL/27 PASS는 visualViewport getter 덮어쓰기 후 에뮬레이터의 native resize 알림 생략을 실측(실제 innerWidth844/root390, 명시 resize 후 root844)한 뒤 테스트에서 resize를 전달해 재검증 PASS. verification-keyboard-layout-{red,green,final,unit}.log.
- 키보드 가림 중에는 모든 UI를 동시에 보이게 축소하지 않고 편집 영역 노출을 우선한다. 이 검사는 실제 소프트 키보드가 아니라 visualViewport 감소를 모사한 앱 로직 검사이며 iPhone/Android OS 키보드 실측으로 보고하지 않는다.
