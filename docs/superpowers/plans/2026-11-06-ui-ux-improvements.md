# UI/UX 개선 수정 계획

작성일: 2026-11-06
상태: 계획만 수립함. 코드는 아직 수정하지 않았다.

## 배경과 방법

프런트엔드를 세 영역으로 나누어 읽기 전용으로 분석했다.

- 게임 화면 공통 영역: `features/gameplay/`
- 진입·로컬·PWA·공통 UI: `app/`, `features/local-game/`, `features/pwa/`, `shared/`
- 온라인 모드: `features/online-game/`

분석 기준은 [UX_SPEC.md](../../../UX_SPEC.md), [DESIGN_BASELINE.md](../../../DESIGN_BASELINE.md), [SINGLE_DEVICE_MODE.md](../../../SINGLE_DEVICE_MODE.md), [MULTIPLAYER_MODE.md](../../../MULTIPLAYER_MODE.md)이다.
스펙에 승인된 의도(확대 차단, 홈 자동 복원, 바깥 탭으로 창 닫기, 확인창 없는 무르기 등)는 문제로 보지 않았다.
우선순위 높음 항목의 근거는 코드에서 다시 확인했다. 브라우저 실측은 하지 않았으므로 "추정"으로 표시한 항목은 구현 전에 실기기에서 확인한다.

표기:

- 크기: S(반나절 이하), M(1일 안팎), L(그 이상)
- **승인 필요**: 승인된 디자인·스펙을 바꾸므로 구현 전에 사용자 확인이 필요하다.

## 1단계: 실수와 막다른 화면 방지 (우선순위 높음)

되돌릴 수 없는 결과나 사용자가 빠져나갈 수 없는 상황을 먼저 고친다.

| # | 문제 | 수정 방향 | 주요 파일 | 크기 | 테스트 |
|---|---|---|---|---|---|
| 1-1 | 준비 화면 숫자 입력에서 Enter/완료를 누르면 바로 게임이 시작된다 | 입력칸의 Enter는 `blur()`로 저장만 하고, 시작은 "게임 시작" 버튼으로만 한다 | `gameplay/components/SetupPanel.tsx` | S | `e2e/setup.spec.ts` |
| 1-2 | 온라인 비호환(incompatible) 화면에 새로고침 수단이 없어 설치 앱에서 갇힌다 | 새로고침 버튼을 추가하고, revoked에는 권한 해제 이유를 덧붙인다 | `online-game/components/OnlineFatal.tsx` | S | `e2e/online/update-notice.spec.ts`, OnlineFatal 렌더 테스트 신설 |
| 1-3 | 초대 링크(`?code=`)로 들어와도 주요 버튼이 "방 만들기"라 엉뚱한 방을 만들 수 있다 | 코드가 있으면 "방 참가"를 primary로 올리고 "새 방 만들기"는 보조 버튼으로 내린다. `<form>`으로 감싸고 입력칸에 `maxLength`·`autoComplete="off"`를 준다. 시작된 방 참가 실패(NOT_WAITING)에는 복구 안내를 붙인다 | `online-game/components/OnlineEntry.tsx`, `gameplay/model/errorMessages.ts` | M | `tests/online-game/onlineEntry.test.tsx`, `e2e/online/entry.spec.ts` |
| 1-4 | 방장의 복구 승인 창이 이름만 보여 주고, 승인이 확인 없이 즉시 실행된다 (UX_SPEC 51 불일치) | 신청 시각·만료 시각·짧은 구분값을 표시하고, 승인 전에 "이전 기기는 사용할 수 없게 됩니다" 확인을 한 번 거친다 | `online-game/components/HostRequests.tsx`, `styles/online.css` | M | `tests/online-game/hostRequests.test.tsx`, `e2e/online/recovery.spec.ts` |
| 1-5 | 복구 신청자의 대기 화면에 취소·남은 시간·안내가 없다 | 대기 화면에 안내 문구, 남은 시간, 1-4와 같은 구분값, "신청 취소" 버튼을 둔다. 컨트롤러에 폴링 중단 후 입장 화면으로 돌아가는 메서드를 추가한다 | `OnlineEntry.tsx`, `session/onlineController.ts`, `session/recoveryPoller.ts` | M | 위와 같음 |
| 1-6 | 로컬의 데이터 삭제 확인이 브라우저 기본 `window.confirm`이고, 메뉴의 "새 토너먼트"가 "홈"과 같은 모양이다 | 공용 `ConfirmDialog`를 만들어 `ask`를 Promise로 구현한다. 버튼은 "삭제하고 새로 시작"(위험 색)과 "취소"(기본 포커스)로 한다. 메뉴에서 위험 항목을 간격과 색으로 분리한다 | `local-game/LocalGamePage.tsx`, `local-game/components/ManagerMenu.tsx`, `shared/ui/ConfirmDialog.tsx`(신규), `base.css` | M | `e2e/manager.spec.ts`, `e2e/local-navigation.spec.ts`, `e2e/restart/` (`page.on('dialog')` 처리 변경) |

1-6에서 만드는 `ConfirmDialog`는 온라인 관리 확인창(3-6)에서도 재사용한다.

## 2단계: 반응 없는 버튼과 사라지는 안내 (공통 피드백)

세 영역에서 같은 원인이 반복해서 발견되었다. 공통 부품을 한 번 고치면 여러 화면이 함께 개선된다.

| # | 문제 | 수정 방향 | 주요 파일 | 크기 | 테스트 |
|---|---|---|---|---|---|
| 2-1 | `button:disabled` 스타일이 없어 비활성 버튼이 활성 버튼과 똑같이 보인다 (온라인 CSS에만 규칙이 있음) | `base.css`에 `button:disabled` 흐림 규칙을 추가하고, 저장 중 모양 유지 예외와 맞춘다 | `shared/styles/base.css` | S | `e2e/saving-appearance.spec.ts`, `e2e/pwa.spec.ts` |
| 2-2 | 네이티브 `disabled`라 눌러도 이유가 나오지 않는 버튼이 있다 (UX_SPEC 35 불일치): 로컬 업데이트 버튼, 헤더 블라인드 버튼, 콜 0일 때의 폴드, 온라인 새 버전 버튼 | `aria-disabled`로 바꾸고 누르면 이유를 토스트로 알린다. 폴드는 명령을 보내지 않고 "체크할 수 있을 때는 폴드할 수 없습니다."만 알린다 | `pwa/UpdateNotice.tsx`, `usePwaPresentation.ts`, `gameplay/components/GameHeader.tsx`, `GameScreen.tsx`, `BetControls.tsx`, `useBettingDraft.ts`, `online-game/OnlineApp.tsx` | S | `e2e/fold-guard.spec.ts`, `e2e/startup-update.spec.ts`, `e2e/online/update-notice.spec.ts` |
| 2-3 | 토스트가 하단 BET/CLEAR 줄을 가리고, 모달이 열려 있으면 모달 뒤에 깔린다. 한 칸이라 덮어써지고 2.4초에 사라지며, `role="status"`가 매번 새로 삽입되어 화면 리더가 놓칠 수 있다 | 라이브 영역을 항상 렌더하고 내용만 바꾼다. 위치를 하단 조작부 위로 옮기고 `popover`(top layer)로 띄운다. 행동 알림은 짧은 큐와 길이 비례 표시 시간(3.5~5초)을 쓴다 | `shared/hooks/useToast.ts`, `base.css`, `LocalGamePage.tsx`, `online-game/RoomPage.tsx` | M | `e2e/press-feedback.spec.ts`, `e2e/input-boundaries.spec.ts`, `tests/online-game/roomManagement.test.tsx` |
| 2-4 | 대화상자를 닫으면 포커스가 원래 버튼으로 돌아가지 않는다 (추정: `close()` 없이 언마운트) | 열 때 활성 요소를 저장하고, 정리 함수에서 `close()` 후 복원한다. 제목은 `aria-labelledby`로 연결한다 | `shared/ui/Dialog.tsx` | S | `e2e/manager.spec.ts`에 포커스 단언 추가 |
| 2-5 | 로컬 수동 "앱 업데이트" 창에 닫기 버튼이 없다 | `applying`이 아닌 모든 상태에서 "닫기"(available이면 "나중에")를 표시한다 | `pwa/UpdateNotice.tsx` | S | `e2e/pwa.spec.ts` |
| 2-6 | 무르기 후 무엇이 취소됐는지 알려주지 않는다 (로컬은 기존 안내까지 지움) | 직전 이벤트를 기록 문구로 만들어 "P3 콜 20을 취소했습니다"를 알린다. 버튼에 `aria-label="직전 행동 취소"`를 준다 | `GameScreen.tsx`, `model/history.ts`, `LocalGamePage.tsx` | S~M | `e2e/single-undo.spec.ts` |

## 3단계: 정산·온라인 진행의 명확성

| # | 문제 | 수정 방향 | 주요 파일 | 크기 | 테스트 |
|---|---|---|---|---|---|
| 3-1 | 사이드 팟 정산에서 자격 없는 좌석이 눈으로 구분되지 않는다 | 정산 중 `!eligible` 좌석에 `ineligible` 클래스(약한 흐림, 점선 테두리)와 aria-label 문구를 추가한다 | `PlayerSeat.tsx`, `table.css` | S | `e2e/game.spec.ts`, `tests/gameplay/tableView.test.ts` |
| 3-2 | 여러 팟 정산에서 ‹ › 버튼이 16×32u로 작고, 남은 팟을 알 수 없다 | 버튼을 44u로 키우고 팟 번호 글자를 12u 이상으로 올린다. WIN을 눌렀을 때 미선택 팟이 있으면 그 팟으로 이동하고 이름을 알린다 | `Table.tsx`, `table.css`, `useSettlementSelection.ts`, `errorMessages.ts` | M | `e2e/game.spec.ts`, `e2e/centered-pot.spec.ts` |
| 3-3 | 연결 배너가 기기 오프라인·서버 끊김·동기화를 같은 "재연결 중"으로 보여 주고 잠금 이유를 설명하지 않는다 | 세 상태로 나눠 문구를 다르게 하고, 동기화는 짧게 지연 표시해 깜빡임을 막는다 | `ConnectionBanner.tsx`, `RoomPage.tsx` | S~M | `e2e/online/reconnect.spec.ts` |
| 3-4 | 결과 불명 요청의 "재시도" 버튼이 중복 베팅 걱정을 만든다 | 버튼을 "결과 확인"으로 바꾸고 "두 번 처리되지 않습니다"를 안내한다. 제한 상태는 카운트다운을 표시한다 | `session/onlineController.ts`, `RoomPage.tsx` | S | `e2e/online/reconnect.spec.ts`, `tests/online-game/onlineController.test.ts` |
| 3-5 | 대기방 참가자에게도 "게임 시작" 버튼이 보이고 대기 안내가 없다 | 참가자에게는 "방장이 게임을 시작하면 진행됩니다 · N명 참가 중"을 보여 주고, 방장에게는 모자란 시작 조건을 미리 표시한다 | `model/onlineNotices.ts`, `GameScreen.tsx` | S~M | `tests/online-game/onlineNotices.test.ts`, `e2e/online/waiting-room.spec.ts` |
| 3-6 | 온라인 관리 확인창의 실행 버튼이 모두 "확인"이고, "방장 맡기"는 맥락 설명과 확인 없이 즉시 실행된다 | 1-6의 `ConfirmDialog`를 써서 버튼을 동작명("기권하기", "중단하기")으로 바꾸고 위험 색을 준다. 방장 맡기 요청이 열리면 이유를 한 번 알리고 확인을 받는다 | `RoomPage.tsx`, `HostRequests.tsx` | S | `e2e/online/host-tools.spec.ts`, `tests/online-game/hostRequests.test.tsx` |
| 3-7 | 온라인에서 "저장 완료를 기다려주세요" 같은 로컬 문구가 나온다 | 온라인 전용 "서버 응답을 기다려주세요" 문구로 분리한다 | `GameScreen.tsx`, `errorMessages.ts` | S | `e2e/online/participant-selection.spec.ts` |
| 3-8 | 저장소 오류 문구에 "Error:" 접두어와 기술 용어가 노출되고, 복구 화면에 선택 안내가 없다 | `error.message`만 표시하고, "먼저 '다시 시도'를 누르세요. 새 토너먼트는 저장된 게임과 기록을 지웁니다."를 추가한다 | `local-game/hooks/useLocalSession.ts`, `LocalGamePage.tsx` | S | `e2e/storage.spec.ts`, `e2e/tablet-recovery.spec.ts` |
| 3-9 | 오프라인 설치 앱에서 "멀티플레이 모드"를 누르면 브라우저 오류 화면이 나온다 | `navigator.onLine === false`이면 이동하지 않고 "멀티플레이는 인터넷 연결이 필요합니다"를 알린다 | `LocalHome.tsx`, `LocalGamePage.tsx` | S | `e2e/entry-routes.spec.ts`, `e2e/pwa.spec.ts` |

## 4단계: 가독성·터치 대상·접근성

이 단계의 항목은 원본 이미지 비교(`e2e/design.spec.ts`)와 승인된 수치에 영향을 줄 수 있으므로, 시각 변경 전에 범위를 확인받는다.

| # | 문제 | 수정 방향 | 주요 파일 | 크기 | 비고 |
|---|---|---|---|---|---|
| 4-1 | 터치 대상이 44px보다 작다: 헤더 HAND·블라인드(약 18u), 준비 중앙 −/+·↻(36u), 온라인 방장 요청·새 버전·초대 버튼(32~36u) | 보이는 크기는 유지하고 `::before`로 히트 영역을 44u 이상 확보한다. 온라인 버튼은 `min-height: max(44px, 32u)` | `header.css`, `table.css`, `online.css` | S | 2·9·10인 배치에서 겹침 확인 |
| 4-2 | 좌석 카드의 aria-label에 칩·누적액·역할·올인·미확정 초안이 없다. 베팅 중에는 동작 없는 버튼이 탭 정지점으로 남는다 | aria-label을 "P1, D·SB, 현재 차례, 누적 60(미확정 40 포함), 남은 칩 940"처럼 구성하고, 동작이 없는 단계에서는 탭 정지점에서 뺀다 | `PlayerSeat.tsx` | M | e2e의 `name: 'P1 ...'` 선택자 영향 확인 |
| 4-3 | 이름 입력 오류가 사라지는 토스트로만 나온다 (UX_SPEC 39 불일치). 블라인드 오류 문구는 어느 칸이 틀렸는지 알려주지 않는다 | 입력칸에 `aria-invalid`·`aria-describedby`와 칸 단위 오류 문구를 표시한다. 이름 저장 실패 시 원래 이름으로 되돌리는 선택지를 준다 | `InlineName.tsx`, `useSetupEditing.ts`, `SetupPanel.tsx`, `BlindSettings.tsx` | M | `e2e/setup.spec.ts`, `e2e/name-scope.spec.ts`, `e2e/input-boundaries.spec.ts` |
| 4-4 | 핵심 상태 문구가 작고 대비가 낮다: 정산 안내 13u 보조색, 배지 10u, 팟 번호 9u. 폴드와 탈락이 같은 흐림이다 | 정산 안내 14u·`--ink`, 배지 11u 이상으로 올린다. 올인 표시 강화는 카드 구성 변경이다 | `controls.css`, `table.css` | S | **승인 필요**(올인 표시) |
| 4-5 | 입력칸·버튼 경계 대비가 WCAG 1.4.11(3:1)에 못 미친다 (`--line` 1.77:1). 토큰 밖의 하드코딩 색이 있다 | `--line-strong`을 추가해 입력 테두리에 쓰고, 하드코딩 색을 토큰으로 옮긴다 | `tokens.css`, `base.css` | S | **승인 필요**(색 계약 변경) |
| 4-6 | 가로·짧은 화면에서 `--u`가 약 0.67까지 줄어 글자와 버튼이 작아지고, 확대도 막혀 있다 | 설치 앱 manifest에 `"orientation": "portrait"`를 추가한다. 브라우저 탭에서는 조작 버튼에 px 하한을 두거나 가로 2열 배치를 검토한다 | `public/local/manifest.webmanifest`, `tokens.css`, `base.css` | S~L | **승인 필요**(방향 고정, 2열 배치) |
| 4-7 | 온라인에서 내 차례가 되었다는 신호가 카드 강조뿐이다 | 내 차례로 바뀌는 순간 dock 안내 "내 차례입니다"와 상시 라이브 영역 알림을 추가한다. 진동(`navigator.vibrate`)은 선택 사항이다 | `model/onlineNotices.ts`, `RoomPage.tsx` | S | **승인 필요**(진동) |

## 5단계: 다듬기 (우선순위 낮음)

- 팟 버튼은 정산 단계에서만 버튼으로 렌더하고 "상세 ›" 단서를 붙인다 (`Table.tsx`).
- 지급 미리보기는 지급액이 있는 사람만 강조하고 나머지는 접는다 (`PayoutPreview.tsx`).
- 초대 공유에 `navigator.share`를 우선 사용하고, 복사에 실패하면 선택 가능한 링크 칸을 보여 준다. 메뉴 라벨은 "방 코드 ABC123 복사"로 바꾼다 (`WaitingBar.tsx`, `OnlineMenu.tsx`).
- 홈의 "단일 기기 모드" 아래에 저장된 게임이 있으면 "진행 중 · HAND 12"를 표시한다 (`LocalHome.tsx`).
- 설치 안내 문구에 오프라인 사용 이점을 넣고, iOS 안내를 "공유 버튼"으로 일반화한다. 표시 시점을 첫 게임 이후로 미루는 것은 **승인 필요** (`InstallNotice.tsx`, `useInstallPrompt.ts`).
- 오류 정보 복사가 실패하면 안내를 표시하고 `-webkit-user-select: text`를 추가한다 (`StorageErrorDetails.tsx`, `base.css`).

## 문서 정합성

구현과 어긋난 문서를 갱신한다. 사용자가 체감하는 영향은 없지만 이후 UX 판단 기준이 흔들린다.

- SINGLE_DEVICE_MODE.md:29, DESIGN_BASELINE.md:120: 멀티플레이 버튼을 "준비 중, 비활성"으로 적었지만 현재는 활성 버튼이다.
- SINGLE_DEVICE_MODE.md:187: manifest scope를 `/local/`로 적었지만 실제 값은 `/`이다.
- SINGLE_DEVICE_MODE.md:184: "게임 진행 중이어도 업데이트 적용"으로 적었지만 구현은 홈에서만 적용한다.

각 단계에서 스펙을 바꾸는 항목은 같은 커밋에서 UX_SPEC.md 또는 해당 모드 문서도 함께 갱신한다.

## 진행 순서와 검증

1. 단계 순서대로 진행하되, 한 행을 하나의 작업 단위로 보고 검증 후 커밋한다 (AGENTS.md).
2. 작은 변경은 표에 적은 관련 e2e·단위 테스트만 실행한다. 공통 부품을 바꾸는 2-1, 2-3, 2-4, 4-1과 단계 마지막에는 전체 e2e를 실행한다.
3. **승인 필요** 항목은 해당 단계를 시작하기 전에 한꺼번에 확인받는다.
4. "추정"으로 표시한 항목(2-4 포커스 복원, 3-3 배너 깜빡임, 가로 화면 OS 글자 크기)은 구현 전에 브라우저에서 재현해 확인한다.
