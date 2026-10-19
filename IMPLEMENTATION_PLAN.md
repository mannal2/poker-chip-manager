# Poker Chip Manager — 전체 구현 계획

> **For agentic workers:** 사용 가능한 경우 `superpowers:executing-plans`를 읽고 이 계획을 작업 단위로 실행한다. 계획 작성 대화에서는 구현을 시작하지 않았으며, 2026-10-18 사용자 구현 요청에 따라 A00~A11을 실행했다. 멀티플레이·외부 배포는 실행하지 않는다. 실제 검증 상태는 IMPLEMENTATION_PROGRESS.md를 따른다. 체크박스는 실제 검증 후 갱신한다.

**작성일:** 2026-10-18
**Goal:** 최종 프로토타입 디자인을 유지하면서 실제 게임에 사용할 수 있는 단일 기기 PWA를 완성하고, 이후 같은 규칙의 멀티플레이와 독립 자동 배포로 확장한다.
**Architecture:** 순수 TypeScript 규칙 → IndexedDB 원자적 저장을 담당하는 진행 처리 → React 화면으로 책임을 나눈다. 확정 상태는 저장 성공 후 표시한다. 후속 Java 서버도 같은 JSON 규칙 사례를 사용하되 TS 소스나 범용 게임 런타임을 공유하지 않는다.
**Tech Stack:** React·TypeScript·Vite·useReducer/필요한 Context·idb·vite-plugin-pwa·Vitest·Playwright. 후속 Java/Spring Boot/Spring Security/HttpSession·REST/raw WebSocket·Docker Compose/Nginx/GitHub Actions/private GHCR/Oracle A1.
**Spec:** [PLANNING](PLANNING.md), [GAME_SPEC](GAME_SPEC.md), [SYSTEM_SPEC](SYSTEM_SPEC.md), [UX_SPEC](UX_SPEC.md), [TECH_DECISIONS](TECH_DECISIONS.md), [DEPLOYMENT_SPEC](DEPLOYMENT_SPEC.md).
**디자인:** [DESIGN_BASELINE](DESIGN_BASELINE.md), [최종 고정 시안](prototype/approved-2026-10-18/index.html).

## 1. 다음 대화의 실행 범위와 현재 상태

**처음 실행할 범위는 A00~A11 단일 기기 모드다.** B는 첫 배포, C는 단일 기기 실사용 검증 이후 멀티플레이 로드맵이다. 단일 기기 완료 전에 서버·게임방을 만들지 않는다. 테스트를 마지막까지 미루지 않는다.

계획 작성 당시에는 제품 소스·package.json·자동 테스트가 없었다. 현재 frontend/와 shared/game-fixtures/에 단일 기기 구현·검증을 추가했다. 시작 HEAD는 ecdb904이고 작업 브랜치는 codex/single-device다. `prototype/`은 변경하지 않은 디자인 기준이다. 배포 워크플로는 B 범위로 남긴다. `.local/`의 OCI 재시도·키·자격 증명에는 접근하거나 변경하지 않는다. 서버 확보·도메인 구매·프로세스 상태는 확인하지 않았다.

과거 문서의 시안01~03, 별도 핸드 종료 화면·금액 입력칸·현재 라운드 납부액 표시 등은 최신 승인으로 대체됐다. 디자인은 DESIGN_BASELINE과 UX_SPEC8절 및 최종 정산 조정, 계산은 GAME_SPEC이 기준이다. 시안에서 생략한 규칙을 제품에서도 생략하지 않는다. 명백한 이력 차이는 최신 결정으로 해소하고 실제 규칙 모순·정책 변경만 묶어 질문한다.

## 2. Global Constraints

- 2~9명, 단일 테이블 노리밋 토너먼트, 실물 카드·수동 승자. 카드 배분·족보 평가 없음.
- 기본 시작 칩1,000, SB5/BB10, 최소 단위5, 칩 버튼5/10/50/100. 앤티·재참가·진행 중 신규 참가 없음.
- 시작 칩·SB·BB 각각 최대1,000,000, 양의5배수, `0 < SB < BB <= 시작 칩`. SB:BB 비율1:2를 강제하지 않음.
- 이름 trim 후1~10자, 한글·영문·숫자·내부 공백, 대소문자 무시 중복 금지. 준비 중에만 수정. ID와 이름 분리.
- 정확한 정수·쉼표 표시, 부동소수 칩 계산·K/M 축약 금지. 무음·무진동·단일 녹색 테마.
- 카드 왼쪽은 **현재 핸드 순납부 H + 미확정 추가액 d**, 오른쪽은 **확정 잔액 S**. C는 d만0, BET은 d만 차감. 콜·최소 레이즈는 현재 스트리트 납부 B로 계산.
- `ΣS + P = 시작 총량`, 정산 전 `P = ΣH`. 미콜 반환은 H/B/P에서 빼므로 누적 표시가 반환까지 무시하고 증가만 한다는 의미는 아님.
- WIN은 지급·탈락·다음 핸드 초기화·블라인드 납부를 한 확정 변경으로 처리. 최종1명은 다음 핸드·차감 없이 종료.
- 마지막 한 행동만 취소. 공개 확정·정산 이후 취소 금지. 핸드를 끝내는 마지막 폴드는 실행 전 확인.
- 저장 성공 전 확정 표시 금지. 자동 저장·새로고침 복원·한 화면 조작·오프라인 필수.
- PWA scope/start_url은 `/local/`. `/online/`·API·WS는 캐시하지 않음. 모드 전환은 문서 탐색.
- 시안 전환·가상 다음 라운드·예시 초기화·안내만 뜨는 폴드를 제품에 넣지 않음.
- 새 상태 관리·UI 키트·드래그 라이브러리는 임의 추가하지 않음. 필요한 선택은 비교 후 기술/코드 구조만 TECH_DECISIONS에 기록.
- 구현 완료와 실기기·배포 완료를 구분. 공개 push·도메인 구매·서버 재시작·기존 게임 삭제는 해당 시점의 사용자 권한 범위를 확인.

## 3. Review Focus

| 위험 | 소유 작업과 검증 |
|---|---|
| 누적80을 추가80으로 제출 | A06: 확정20+50+10→80 표시, BET은60 차감, C→20 |
| 저장 완료 응답 유실 후 재시도하여 이중 지급·핸드 중복 시작 | A04/A07: 동일 요청 재시도, 지급·블라인드 납부 각각1회 |
| 라운드·공개·새로고침이 H 또는 잠금을 초기화 | A02/A04/A07: B만0/H유지, 공개 저장 후 복원은 취소 불가 |
| 드래그·한글 입력 중 실패/다른 화면 인수 | A04/A05: 마지막 유효 설정 보존, 임시 순서 취소, 이전 세대 쓰기 거절 |
| 9인·긴 이름·큰 숫자에서 겹침/잘림/화면별 테이블 변형 | A01/A06/A10: 전 인원2~9, 너비320/360/390/430, 단계별 동일 좌표 |

## 4. 파일 책임과 공용 인터페이스

아래는 **생성 예정 경로**다. npm을 초기 실행안으로 사용하고 패키지 관리자·호환 버전은 A00에서 확인해 잠금 파일로 고정한다. 버전 정보는 구현 시 공식 문서로 확인하며 현재 계획에서 특정 최신 버전을 단정하지 않는다.

```text
frontend/
  package.json, package-lock.json, vite.config.ts, tsconfig.json
  index.html, local/index.html, online/index.html
  src/app/{LocalApp.tsx,appReducer.ts,LocalGameContext.tsx}
  src/game/{types.ts,settings.ts,transition.ts,actions.ts,turns.ts,
            positions.ts,pots.ts,settlement.ts,invariants.ts}
  src/local/{database.ts,repository.ts,controller.ts,restore.ts}
  src/ui/{Table.tsx,PlayerCard.tsx,BetControls.tsx,SetupPanel.tsx,
          RevealPanel.tsx,SettlementPanel.tsx,ManagerMenu.tsx,
          HistoryPanel.tsx,LocalHome.tsx,StatusNotice.tsx}
  src/ui/{tokens.css,table.css,controls.css,useSeatDrag.ts}
  src/pwa/{register.ts,UpdateNotice.tsx}
  tests/game/{fixtures.test.ts,settings.test.ts,invariants.test.ts}
  tests/local/{controller.test.ts,restore.test.ts}
  e2e/{design.spec.ts,game.spec.ts,storage.spec.ts,pwa.spec.ts}
  playwright.config.ts
shared/game-fixtures/{schema.json,settings.json,positions.json,
                      betting.json,pots.json,settlement.json,lifecycle.json}
.github/workflows/frontend-ci.yml
IMPLEMENTATION_PROGRESS.md
```

작은 함수마다 파일을 쪼개지 않는다. 위 파일 안에서 같은 책임을 묶는다. 타입/함수명은 초기 구현 계약이며 일관성 있는 변경이 필요하면 관련 테스트·문서를 함께 수정한다.

| API | 입출력·책임 |
|---|---|
| `validateSettings(input: SetupInput): SettingsValidation` | 필드별 오류 또는 정규화된 설정 |
| `createTournament(settings: GameSettings, context: TransitionContext): GameState` | 검증된 설정으로 준비 상태 생성 |
| `transition(state: GameState, command: GameCommand, context: TransitionContext): TransitionResult` | 성공은 새 상태+추가 이벤트, 실패는errorCode. 입력 상태 변경 금지 |
| `getLegalActions(state: GameState): LegalActions` | actor, callAdditional, minRaiseAdditional, maxAdditional, 각 행동 가능 여부/이유 |
| `buildPots(state: GameState): Pot[]` | 반환 처리된 H로 금액·자격 계산. 표시 묶음으로 분배 경계를 없애지 않음 |
| `previewSettlement(state: GameState, winners: WinnerSelection): SettlementPreview` | 전 팟 선택·동률 일관성, 지급/남는 칩/최종 잔액 미리보기 |
| `assertInvariants(state: GameState): void` | 총량·비음수 정수5배수·유일한 행동자·P/H 검증 |
| `repository.load(): Promise<StoredGame \| null>` | slot/control 및 기록 경계 읽기 |
| `controller.dispatch(command: GameCommand): Promise<DispatchResult>` | 같은 요청 식별 유지, 최신 저장 상태로 검증→계산→원자적 저장 |
| `controller.takeControl(screenId: string): Promise<ControlLease>` | 트랜잭션에서 화면 소유·세대 인수 |
| `repository.readEvents(tournamentId: string, afterSequence: number, limit: number): Promise<GameEvent[]>` | 현재 토너먼트 기록 페이지 조회 |

`GameState`는 GAME_SPEC2절의 tournamentId/version/status/settings/initialTotal/seats/players/hand/pendingBlinds/undo를 포함한다. hand는 handId/number/street/phase/buttonSeat/sbSeat/bbSeat/actorId, B/H, W/R, 행동 이력·응답 필요자·공개 경계를 담는다. undo는 게임 영역 직전 상태이며 저장 권한 세대·이벤트 목록을 되돌리지 않는다.

`TransitionContext`로 새 ID·기록 시각을 전달하고 순수 함수 안에서 Date.now/random을 호출하지 않는다. `GameCommand`는 SETUP_UPDATE/START_TOURNAMENT/CHECK/CALL/BET/RAISE/FOLD/ALL_IN/UNDO/BEGIN_REVEAL/ADVANCE_STREET/SETTLE_HAND/SCHEDULE_BLINDS/ABORT. BET 버튼의 실제 명령 종류는 LegalActions로 결정한다.

`DispatchResult`는 APPLIED/REJECTED/UNKNOWN, requestId·결과 버전·최신 확정 상태·이유를 구분한다. appReducer는 loading/ready/saving/storageError/controlLost/restoreError를 관리하며 DB·엔진 부수 효과는 reducer 밖에 둔다. draftAmount·다이얼로그·알림은 UI 상태이며 게임 상태에 저장하지 않는다.

## 5. A — 단일 기기 실행 작업

의미 있는 규칙/저장 테스트는 실패 확인→최소 구현→PASS 순서로 진행한다. 단순 스타일 수정에 구현을 복제한 단위 테스트를 추가하지 말고 브라우저로 검증한다. 완료한 작업은 IMPLEMENTATION_PROGRESS에 검증 명령과 함께 기록한다.

### A00. 실행 환경과 검증 가능한 기본 구성

**Files:** frontend/package.json·lock·Vite/TS/Playwright 설정, app/LocalApp.tsx, tests/game/settings.test.ts, IMPLEMENTATION_PROGRESS.md.
**Consumes:** 문서·고정 시안. **Produces:** 실행 가능한 `/local/`와 공통 검사 명령.

- [x] 실제 cwd·AGENTS·git 상태·Node 확인. untracked 문서 삭제·전체 일괄add 금지. HEAD가 없는데 worktree를 강제로 만들지 않는다.
- [x] 승인된 기술의 호환 버전으로 최소 구성. 버전·구조 선택 이유는 TECH_DECISIONS에 기록한다.
- [x] `npm --prefix frontend run dev -- --host 127.0.0.1`, `typecheck`, `lint`, `test`, `build`, `test:e2e` 스크립트 정의. npm ci로 재현 가능하게 한다.
- [x] root는 모드 입구, local은 구현 대상, online은 미제공 안내만 둔다. 실제 온라인 기능처럼 보이는 목업은 배포하지 않는다.
- [x] typecheck/lint/build와 첫 설정 테스트 실행 결과를 기록한다. 아직 없는 기능을 완료로 표시하지 않는다.

### A01. 최종 디자인을 React 표시 기준으로 먼저 고정

**Files:** ui/Table·PlayerCard·BetControls, tokens.css/table.css/controls.css, e2e/design.spec.ts.
**Consumes:** DESIGN_BASELINE·읽기 전용 표시 fixture. **Produces:** props 기반 Table/PlayerCard/BetControls.

- [x] 최종 HTML의 computed style·기준 이미지를 보고 색·크기·간격을 옮긴다. 역사별 CSS 전부와 시안 script를 통째로 복사하지 않는다.
- [x] 고정 테이블, 이름+숫자2칸, D/SB/BB, 현재 차례, 두 줄 버튼, 메뉴, 선택 인원+WIN을 표시한다. 상태 변경을 가짜로 연결하지 않는다.
- [x] 같은 Chromium/390×844·320×568에서2/6/9인 기준과 나란히 비교한다. 추가 UI가 없는 기본 게임 화면은 재디자인하지 않는다.
- [x] `npm --prefix frontend run test:e2e -- e2e/design.spec.ts`: 단계별 테이블x/y/width/height 동일, 카드 겹침0, 가로 넘침0. 이 기준을 확보한 뒤 실제 상태를 연결한다.

### A02. 설정·상태·핸드 시작·턴·베팅 규칙

**Files:** game/types/settings/transition/actions/turns/positions/invariants.ts, fixtures/schema·settings·positions·betting.json, tests/game/*.
**Consumes:** GameSettings/Command. **Produces:** createTournament/transition/getLegalActions/assertInvariants.

- [x] JSON schema: id, description, initialState, commands, context, expectedStateSubset, expectedError, expectedEvents. 기대값은 규칙·수작업으로 작성하고 구현 출력에서 생성하지 않는다.
- [x] 설정 경계 테스트:2/9명 허용,1/10명 거절;1000/5/10 허용;시작5/BB10·SB10/BB10·12칩 거절. 이름 중복·공백·한글 조합 입력을 검증한다.
- [x] GAME_SPEC D01~D12/B01~B23을 JSON으로 옮겨 실패를 확인한 뒤 작은 묶음별 구현. BB 옵션, HU 순서, 짧은 BB, 누적 짧은 올인, 체크 후 재레이즈 권리를 포함한다.
- [x] 화면의 게임 시작1회로 START_TOURNAMENT→첫 블라인드 납부까지 한 번 확정한다. 내부 단계는 분리하되 별도 첫 핸드 버튼을 만들지 않는다.
- [x] 금액 일치만으로 베팅 종료하지 않는다. fold/all-in은 행동에서 제외하고 전원all-in에 불필요한 체크를 요구하지 않는다.
- [x] `npm --prefix frontend run test -- --run tests/game`와 typecheck. 모든 성공 전환의 총량·입력 불변성을 검증한다.

### A03. 반환·팟·정산·취소·종료

**Files:** game/pots/settlement/transition.ts, fixtures/pots·settlement·lifecycle.json, tests/game/fixtures.test.ts.
**Consumes:** A02 상태. **Produces:** buildPots/previewSettlement 및 나머지 게임 명령.

- [x] P01~P07/W01~W10의 실패 테스트를 작성한다. H=[150,100,50]은50반환 후pots=[150,100];15를2명이 나누면10/5;두 팟 각15는 팟별 처리 후20/10.
- [x] 동률 그룹·승패 모순, 폴드자 제외, 단독 자격 자동 선택 및 최종 확정 전 지급 없음 구현.
- [x] UNDO는 직전 B/H/S/W/R/응답자/권리/반환을 복원하고 취소 기록을 추가. 연속 취소 불가, 새 행동 후 다시1회 가능.
- [x] BEGIN_REVEAL 이후 취소 거절. 일반 스트리트 전환은B만0/H·P유지. 쇼다운 공개는 바로 승자 입력, 일반 플랍/턴 공개까지 정산으로 보내지 않는다.
- [x] SETTLE_HAND는 지급→탈락→종료 또는 다음 핸드를1전환으로 처리. 데드 버튼/HU·예약 소진·짧은 블라인드·마지막 폴드 자동 정산 포함.
- [x] 테스트:6명×1000 총량6000 유지, 다음 핸드P15/H는 새 블라인드만,1명 남으면 다음 핸드 없음. ABORT는S/P/기록 보존·재개/지급 불가.
- [x] 전체game 테스트 PASS. 까다로운 fixture를 삭제하거나 기대값을 엔진 결과로 바꿔 통과시키지 않는다.

### A04. IndexedDB·원자 저장·화면 권한

**Files:** local/database/repository/controller/restore.ts, tests/local/*, e2e/storage.spec.ts.
**Consumes:** A02/A03 순수 전환. **Produces:** controller.dispatch/takeControl, repository.load/readEvents.

- [x] schemaVersion1, slot/events/control, rulesVersion 분리. 알 수 없는 형식은 원본 보존·쓰기 차단. 존재하지 않는 구버전용 가짜 migration은 만들지 않는다.
- [x] readwrite tx에서 최신 상태/권한→계산→상태·기록·결과 저장→tx 완료. 내부에서 confirm/fetch/timer 대기 금지.
- [x] 화면당 미확정1요청, 세대별sequence/highWatermark/최근64결과. 오래된 결과를 지워도 과거 순번 재실행 금지.
- [x] SYSTEM_SPEC L01~L09와 X01/X03의 로컬 범위를 실제 브라우저에서 검증. 두 탭 동시 입력/인수의 두 실행 순서 모두 확인.
- [ ] 저장 실패·완료 응답 불명·용량 부족·upgrade blocked·손상 상태를 재현. **첫 형식 검증:** 저장 실패/응답 유실/Quota/손상은 PASS. 실제 존재하지 않는 구형 DB가 v1 업그레이드를 막는 조건은 N/A로 남기며, 실제 versionchange 연결 종료·쓰기 차단은 PASS. 이전 확정 상태 유지, 재시도 시 중복 지급/다음 핸드 이중 생성 없음.
- [x] 새 게임의 이전 기록 삭제+새 준비 저장을1tx로 처리. 홈 이동은 저장 완료 대기만 하고 삭제하지 않는다.
- [x] `test -- --run tests/local`, `test:e2e -- e2e/storage.spec.ts`. 모의DB 테스트만으로 IndexedDB 검증 완료라 하지 않는다.

### A05. 홈·준비·좌석 드래그

**Files:** ui/LocalHome/SetupPanel/useSeatDrag/ManagerMenu, app/LocalApp/appReducer/LocalGameContext, e2e/game.spec.ts.
**Consumes:** 설정 검증·controller. **Produces:** 저장된 준비 상태와 시작 명령.

- [x] 이름·인원·시작 칩·SB/BB·첫D·화면 기준 좌석을 연결. 시안에 없는 이름/인원 편집은 준비 전용 메뉴·다이얼로그에 넣고 테이블/두 줄 조작을 새로 디자인하지 않는다.
- [x] Pointer Events를 초기 후보로 검토한다. 추가 라이브러리는 스크롤/접근성 등 실질적 필요가 있을 때 대안 비교 후 선택. 시안의350ms 길게 누르기를 기준으로 한다.
- [x] 드래그 중 삽입 프리뷰→놓으면 확정·저장. swap금지. 영역 밖/pointercancel은 원복. IME미확정·빈칸을 저장된 유효 설정에 섞지 않는다.
- [x] 시작 시 재검증·블라인드 납부 저장, 완료 후 게임 진입. 연타로 중복 시작하지 않는다.
- [x] 이어하기·새 토너먼트 삭제 확인·이름/좌석/최초 설정 재사용. 직전 잔액이나 마지막 블라인드를 기본값으로 재사용하지 않는다.
- [x] 저장 실패·권한 인수 중 드래그 취소/옛 화면 거절과2~9명 긴 이름을E2E 검증.

### A06. 두 줄 베팅과 카드 H+d 연결

**Files:** ui/BetControls/PlayerCard/Table/StatusNotice, app/reducer/context, e2e/game.spec.ts.
**Consumes:** LegalActions·controller·확정 상태. **Produces:** draftAmount와 합법 명령.

- [x] draftAmount는useState/초기0. 카드 왼쪽H+d, 오른쪽S. 칩 버튼은draft만 수정, 잔액 초과 거절. 올인은S를draft에 채우고BET까지 미확정.
- [x] 검증 예: H20에서50·10 선택→80, 오른쪽 잔액 불변, C→20, BET→60만 차감. H20/B0 플랍에서+10은H30/B10으로 확정.
- [x] CALL은draft를 무시하고callAdditional만 제출,0이면CHECK. BET은LegalActions로BET/RAISE/ALL_IN 판단. H+d를additional로 보내지 않는다.
- [x] 저장 중 중복 조작 차단, 성공 후 다음 차례, 실패는 고정 오류·재시도. draft는차례/취소/스트리트/새로고침/권한 변경 때0.
- [x] 불가 버튼은 탭하면 이유가 잠시 보이고 명령은 안 보낸다. aria-disabled와 실행 차단을 함께 적용. 마지막fold는확인 후 실제 엔진 처리.
- [x] typecheck/lint/단위/E2E로 저장 전에 잔액이 바뀌지 않는지 확인.

### A07. 공개·카드 승자 선택·다음 핸드

**Files:** ui/RevealPanel/SettlementPanel/Table, game/transition, e2e/game.spec.ts.
**Consumes:** phase·Pot[]·previewSettlement·controller. **Produces:** 공개/정산명령과승자draft.

- [x] `카드 공개` 저장 완료 후 취소 잠금. 쇼다운은중간버튼없이정산,일반플랍/턴/리버는공개후다음스트리트시작. 실물 공개 감지를 가정하지 않는다.
- [x] 자격 있는 테이블 카드만 복수 선택. 배경·테두리만 강조,체크동그라미금지. 선택인원은WIN직상단중앙,하단메인팟숫자재추가금지.
- [x] 사이드팟은중앙팟이름/금액+이전·다음전환으로선택. 고정테이블유지,전팟선택·모순검증후WIN. 단독자격은자동선택.
- [x] 상세 지급 미리보기는 중앙 팟을 눌러 여는 시트로 제공하는 구현안. 카드H를지급예상액으로덮지않는다. 빠진 화면도기존색·메뉴패턴을사용.
- [x] WIN저장성공→다음핸드. 기존요청재전송도1회. 승자draft는새로고침때폐기. 최종1명은토너먼트종료.
- [x] 동률·side·모순거절·올인runout·최종fold확인취소·우승·연타·저장실패 E2E.

### A08. 관리자 메뉴·기록·종료/중단

**Files:** ui/ManagerMenu/HistoryPanel/LocalHome/StatusNotice, local/repository, e2e/game.spec.ts.
**Consumes:** 전체현재토너먼트기록·controller. **Produces:** 허용된관리행동.

- [x] 우상단메뉴에기록/다음핸드블라인드예약/화면기준좌석/홈/새토너먼트/중단/업데이트를연결. 준비중에만이름·좌석·첫D편집.
- [x] ‘다음 라운드 · 시안 체험’, ‘카드 공개 화면 · 시안 체험’,예시리셋제거. 제품진행은게임상태로만결정.
- [x] 핸드·행동·취소·반환·지급·탈락·예약·중단기록페이지조회. 취소로그는추가,과거삭제금지. 과거토너먼트아카이브/CSV제외.
- [x] 중단확인→S/P/기록보존·진행불가,정상종료와구분. 새게임삭제확인취소시원본유지.
- [x] 블라인드예약은현핸드금액불변/다음에1회적용. 스택부족은짧은블라인드처리.

### A09. PWA·오프라인·업데이트

**Files:** vite.config.ts, local/index.html, src/pwa/*, e2e/pwa.spec.ts.
**Consumes:** 로컬전체흐름·restore. **Produces:** /local/전용설치형PWA.

- [x] vite-plugin-pwa생성방식/prompt업데이트/로컬입구·의존자산precache. 오프라인준비성공과실패구분.
- [x] /local/홈→이어하기오프라인검증. root/online문서탐색,online/API는캐시제외.
- [x] 진행중skipWaiting/강제reload금지. 종료/중단후수동적용. 모든창종료후새코드로시작하면schema/rules호환검증후복원.
- [x] production build에서offline새로고침,구버전→신버전,형식동일/규칙의미변경,알수없는형식,변환실패원본보존을검증.
- [x] `npm --prefix frontend run build`, `test:e2e -- e2e/pwa.spec.ts`. dev서버실행만으로완료라하지않는다.

### A10. 통합검증·디자인회귀·실기기

**Files:** e2e/*, IMPLEMENTATION_PROGRESS.md, 생성할frontend/DEVICE_CHECKS.md.
**Consumes:** A00~A09. **Produces:** 단일기기검증보고.

- [x] npm ci→typecheck→lint→`test -- --run`→build→test:e2e. Chromium/WebKit,미실행은미검증표시.
- [x] 2/6/9명뿐아니라3/4/5/7/8명,10자이름·최대금액·모든단계·선택상태·줄바꿈/터치영역확인.
- [x] 정상전체스트리트→정산→다음핸드,짧은올인/side/tie,HU전환,취소,저장재시도,다른화면인수,offline재실행완주.
- [x] 동일뷰포트·데이터·브라우저로고정본과이미지비교. 실패이미지에맞춰기준PNG를갱신해통과시키지않는다. 의도한기능추가차이는설명.
- [x] 가능한실기기iPhoneSafari/AndroidChrome·설치PWA검증과실제버전기록. 접근불가면사용자검증항목을전달하고미검증으로남긴다.

### A11. 단일 기기 완료 인계

- [x] 미구현·알려진버그·미검증정리. 실제게임용으로쓸수없는placeholder를남기고완료라하지않는다.
- [x] README에설치/실행/테스트/저장소삭제시소실/오프라인준비/업데이트안내. 결과는진척,기술선택은TECH_DECISIONS로구분.
- [x] 로컬리뷰가능한결과·실행방법제시. 공개push·실서버반영을자동시작하지않는다. 다음B,실사용검증이후C.

## 6. B — 첫 배포·자동화

DEPLOYMENT_SPEC을실행기준으로삼는다. 서버·도메인이없어도CI/컨테이너준비까지진행할수있다. 비용·무료한도·패키지정보는실행시공식문서확인.

| Task | 생성할 파일/영역 | 완료 조건 |
|---|---|---|
| B01 | .github/workflows/frontend-ci.yml | PR/main에서A10자동검사,fixture변경도검사,실패시이미지게시/배포차단 |
| B02 | frontend/Dockerfile, infra/poker/compose.yaml, infra/frontend/nginx.conf | ARM64이미지·SPA/asset/PWA경로·digest고정·대상아키텍처실행 |
| B03 | infra/edge/compose.yaml, nginx.conf, Certbot설정, infra/README.md | 분리Compose/network·DNS/HTTPS,실제자원확인후허용범위만적용 |
| B04 | .github/workflows/frontend-release.yml, infra/scripts/deploy-frontend.sh | main검사→privateGHCR→VM잠금/버전확인→서비스교체→120초health→실패복구 |
| B05 | 릴리스manifest·운영절차 | 현재/직전정상/보류보호,옛hash자산유지,다른React독립,VM정지중CI성공/배포실패·수동재실행 |

각B단계시작시실제코드기준으로실행체크리스트를진척문서에만든다. 아직없는backend를형식적으로띄우지않는다. 메모리게임보호gate는C에서구현한다. 배포가열린PWA를강제업데이트하거나단말저장게임을삭제하지않는지검증한다.

## 7. C — 멀티플레이 후속 로드맵

단일기기실사용검증후착수한다. 각항목시작때현행SYSTEM_SPEC/공통fixture/코드를읽고상세실행절차를작성한다. 지금부터사용하지않는Java클래스·프레임워크를생성하지않는다.

| Task | 구현 영역 | 의존·완료 조건 |
|---|---|---|
| C01 | backend 순수game | A02/A03의동일JSON전부일치. Java빌드/테스트도구는비교후기록 |
| C02 | backend room | 메모리최대10방,코드/등록/삭제원자성,방별잠금,tournamentId/version,동시정산1회 |
| C03 | backend security/api | T56/T57,CSRF/Origin/HttpOnly,본인/방장권한,세대/순번/중복/HTTP계약 |
| C04 | backend realtime | 구독-snapshot누락없음,15/45초생존,다중화면집계,옛socket/version무해,느린큐상한 |
| C05 | room·frontend online 복구 | 대기방5초,진행60초방장모집/첫승인,복귀권한정책,이전인증폐기,이름신청+특정승인 |
| C06 | frontend online·공통ui | 디자인재사용,본인차례입력,권한메뉴,단절차단·최신상태재개,SW비제어 |
| C07 | 같은방재준비·수명 | 초기설정복원·새tournamentId·옛명령거절,단절자새5초,전원offline30분삭제 |
| C08 | backend 배포·부하 | 진행중보류,시작gate원자성,VM잠금/메타데이터/불명시차단유지,호환·복구,M/X/O시험 |

서버검증전예측잔액을확정표시하지않는다. DB/Redis/다중Spring/STOMP/로그인을추가하지않는다. 서버재시작시소실은허용하지만정상배포로진행게임을없애지않는다. 관리기능은UI숨김뿐아니라서버권한검사를한다.

## 8. 요구사항 매핑·진척 관리

| 요구군 | 담당 |
|---|---|
| 이름/금액/인원/좌석/첫D/화면기준 | A02/A05 |
| 베팅/턴/올인/위치 | A02 |
| 반환/팟/동률/취소/탈락/정산/종료 | A03/A07 |
| H+d/두줄버튼/메뉴/디자인 | A01/A06/A07/A08/A10 |
| 저장/실패/복원/다중화면/기록 | A04/A08 |
| PWA/업데이트/실기기 | A09/A10 |
| 독립배포/CI/복구 | B01~B05/C08 |
| 온라인/재접속/방장/방수명 | C01~C08 |

진척에는 `작업 / 변경 / 검증 명령과 결과 / 미검증 / 다음 작업`을 남긴다. 실패를남기고다음단계로가면독립진행가능한이유를적는다. 컨텍스트부족으로멈출때파일·테스트상태를인계하며완료라고하지않는다.

2026-10-18 A00~A11 구현과 자동 검사 완료: typecheck/lint/build, 단위109·Chromium/WebKit172 PASS. 실기기는 DEVICE_CHECKS의 미검증 목록을 따른다. 배포는 미실행이다. 고정 시안과 제품을 직접 비교했으며 프로토타입 검증 결과를 제품 테스트로 대신하지 않았다.


## 2026-10-18 후속 승인 변경 — 앱 홈·직접 조작·자동 진행

A00~A11 이후 사용자 승인 변경은 UX_SPEC/GAME_SPEC의 최신 절 및 IMPLEMENTATION_PROGRESS의 해당 실행 기록을 따른다. /local/ 앱 홈에 모드 선택·업데이트, 게임 메뉴는 앱 홈으로/새 토너먼트. HAND 기록·SB/BB 예약 직접 진입, 예약값 표시, 이름줄 직접 편집·즉시 D·중앙 정렬·시계 회전. 공개/스트리트 시작 중간 화면을 제거하고 마지막 응답에서 다음 단계까지 원자 저장한다. 새 코드와 구형 공개 상태 복원을 모두 검증한다. 기존 시안에서 승인 변경 영역 외 카드/테이블/하단은 유지한다. 멀티플레이·배포는 여전히 제외한다.


### 후속 승인 UI 수정 — 2026-10-18

원형 드래그 전체 회전 원인 수정, 이름 글자만 편집, 준비 전용 회전, 시간순 기록·역순 버튼·기술 기록 숨김/취소 반영, 기록·블라인드·메뉴 바깥 닫기, 가로 블라인드 입력을 적용한다. 최신 UX_SPEC 및 IMPLEMENTATION_PROGRESS가 요구와 실행·검증의 기준이다. 기존 게임 규칙·원본 시안·저장 형식·멀티플레이/배포 범위는 유지한다.


### 단계 기록·팟 오류 수정 — 2026-10-18 최신 승인

HAND와 단계 이름도 기록 행으로 포함해 역순에서 HAND가 해당 핸드의 맨 아래에 온다. 실제 프리플랍/플랍/턴/리버/쇼다운을 표시하고 폴드 종료는 핸드 종료로 구분한다. 단계 글자만520ms 금색·1.1배 강조 후 원상복귀하며 초기 표시/복원·같은 단계 재조작에는 재생하지 않고 동작 줄이기를 존중한다. 폴드 납부 높이 차이로 나눈 같은 수령 자격의 층은 실제 팟 확정 전에 합치며 진짜 올인 자격 경계는 보존한다. 한 팟은 POT/여러 팟만 MAIN·SIDE POT. 원본 HTML·저장 형식·원본 이벤트는 유지하며 검증 상태는 IMPLEMENTATION_PROGRESS 최신 절을 따른다.

- [x] 2026-10-18 승인 업데이트 안내: 홈 클릭 즉시 확인/설치 완료 대기/실패 재시도/바깥 닫기/적용 중 닫기 차단. 첫 설치 실패 복구·오프라인 재시작·게임 보존 포함. 최종 관련 브라우저30/전체 단위130 PASS, 실행 기록은 IMPLEMENTATION_PROGRESS 참조.
