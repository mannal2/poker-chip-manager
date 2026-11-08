# 확인창 하단 버튼 정리 구현 계획

작성일: 2026-11-08
상태: 계획만 수립함. 구현 담당자가 이 문서대로 진행한다.

## 목표

1. 확인창의 실행 버튼과 닫기 버튼이 간격 없이 세로로 붙어 있는 문제를 고친다. 대화상자 하단에 버튼 줄을 하나 두고, 실행 버튼은 CTA(`.primary`) 스타일로 표시한다.
2. 같은 모양을 쓰는 모든 대화상자에 같은 하단 버튼 줄을 적용한다.
3. 로컬 모드에서 브라우저 기본 `window.confirm`으로 띄우는 확인창을 앱의 확인창으로 바꾼다.
4. 온라인 관리 메뉴의 `앱 홈` 항목 이름을 `홈`으로 바꾼다. 로컬 관리 메뉴는 이미 `홈`이다.

## 원인

[Dialog.tsx](../../../frontend/src/shared/ui/Dialog.tsx)는 `dismissOutside`가 아니면 `children` 바로 뒤에 `닫기` 버튼을 감싸는 요소 없이 렌더한다.
버튼은 블록처럼 쌓이고, 앞의 버튼과 위아래 간격이 없다. 실행 버튼도 일반 버튼 스타일이라 CTA로 보이지 않는다.

## 범위에서 제외하는 것

- 버튼 문구 변경: 실행 버튼의 `확인`, 닫기 버튼의 `닫기`, `나중에`, `업데이트하기` 등 기존 이름은 그대로 둔다. e2e가 이름으로 버튼을 찾는다.
  특히 확인창의 닫기 버튼을 `취소`로 바꾸지 않는다. 화면의 무르기 버튼과 온라인 선택 취소 버튼이 이미 `취소`라서 e2e 선택자(`getByRole('button', { name: '취소', exact: true })`)가 충돌한다.
- 위험 동작 전용 색(빨간 버튼): 새 색 토큰은 DESIGN_BASELINE의 색 계약을 바꾸므로 이번 작업에 넣지 않는다. 실행 버튼은 기존 `.primary`(금색)를 쓴다.
- 온라인 입장 화면의 `앱 홈으로` 링크([OnlineApp.tsx:50](../../../frontend/src/features/online-game/OnlineApp.tsx:50)): 관리 메뉴가 아니므로 바꾸지 않는다.
- 관리 메뉴 자체(`.menu-actions` 세로 목록)와 기록·블라인드 대화상자의 본문 배치는 바꾸지 않는다.

## 작업 1: Dialog에 하단 버튼 줄 추가

파일: `frontend/src/shared/ui/Dialog.tsx`, `frontend/src/shared/styles/base.css`

1. `Dialog`에 선택 prop `actions?: ReactNode`를 추가한다.
2. `children` 뒤에 하단 버튼 줄을 렌더한다.
   ```tsx
   {(actions || !dismissOutside) && (
     <div className="dialog-actions">
       {!dismissOutside && (
         <button disabled={closeDisabled} onClick={onClose}>닫기</button>
       )}
       {actions}
     </div>
   )}
   ```
   닫기 버튼이 왼쪽, 실행 버튼이 오른쪽에 온다. `dismissOutside` 대화상자는 지금처럼 닫기 버튼이 없다.
3. `base.css`에 스타일을 추가한다. 기존 `.actions`(controls.css:106-115)와 같은 비율을 쓴다.
   ```css
   .dialog-actions {
     display: flex;
     gap: calc(8 * var(--u));
     margin-top: calc(16 * var(--u));
   }
   .dialog-actions > * {
     flex: 1;
   }
   .dialog-actions .primary {
     flex: 1.5;
   }
   ```
4. 이 변경만으로 `지급 미리보기`처럼 닫기 버튼만 있는 대화상자도 위쪽 간격이 생긴다. 닫기 버튼 하나는 줄 전체 너비를 차지한다.

## 작업 2: 온라인 관리 확인창

파일: `frontend/src/features/online-game/RoomPage.tsx` (276-289행 부근)

- 대상: 기권, 기권 처리, 토너먼트 중단, 다시 준비하기, 방장 넘기기, 참가자 내보내기 확인창. 모두 같은 `confirmation` 대화상자를 쓴다.
- `확인` 버튼을 `children`에서 빼서 `actions`로 넘기고 `className="primary"`를 준다. `aria-disabled={session.busy}`와 클릭 동작은 그대로 유지한다.
- 대상 이름(`confirmation.target.name`)과 경고 문구 `<p>`는 본문에 그대로 둔다.

## 작업 3: 복구 신청 대화상자

파일: `frontend/src/features/online-game/components/HostRequests.tsx` (44-62행 부근), `frontend/src/features/online-game/styles/online.css`

- 신청이 여러 건일 수 있으므로 신청마다 있는 `복구 승인`/`복구 거절` 격자(`.host-request-actions`)는 본문에 그대로 둔다.
- `복구 승인`에 `className="primary"`를 준다.
- 하단 `닫기`는 작업 1로 자동으로 간격이 생긴다. 신청 행 사이에도 간격이 필요하면 `.host-request + .host-request`에 `margin-top`을 추가한다.

## 작업 4: 앱 업데이트·설치 안내

파일: `frontend/src/features/pwa/UpdateNotice.tsx`, `frontend/src/features/pwa/InstallNotice.tsx`, `frontend/src/features/local-game/LocalGamePage.tsx`(241행 부근, 업데이트 대화상자), `frontend/src/features/gameplay/styles/controls.css`

- UpdateNotice: 지금은 `업데이트`(`.actions` 안), `나중에`, `다시 시도`가 각각 따로 렌더된다. 이 버튼들을 한 줄로 모은다.
  - `available`: [`나중에`(자동 안내일 때만)] [`업데이트`/`업데이트하기`(primary)]
  - `error`·`applyError`: [`나중에`(자동 안내일 때만)] [`다시 시도`(primary)]
  - 업데이트 대화상자는 `dismissOutside`이므로 `Dialog`의 `actions`로 넘기거나, UpdateNotice 안에서 `<div className="dialog-actions">`로 직접 감싼다. 둘 중 구조가 단순한 쪽을 고른다.
  - `disabled={!canApply}` 동작과 버튼 이름은 바꾸지 않는다.
- InstallNotice: `.install-actions`를 `.dialog-actions`로 바꾼다. 버튼 순서는 [`나중에`] [`앱 설치`(primary)]로 맞춘다. `설치 창에서 선택해주세요.` 상태 문구는 버튼 줄 밖(위)으로 옮긴다.
- 다른 곳에서 쓰지 않으면 `controls.css`의 `.install-actions` 규칙을 지운다.

## 작업 5: 로컬 확인창을 앱 대화상자로 교체

파일: `frontend/src/features/local-game/LocalGamePage.tsx`(91행), `frontend/src/shared/ui/ConfirmDialog.tsx`(신규, 필요하면)

현재 `ask: (message) => Promise.resolve(window.confirm(message))`이며, 호출처는 [useLocalSession.ts](../../../frontend/src/features/local-game/hooks/useLocalSession.ts)의 135·224·230행 세 곳이다(새 토너먼트 시작·준비, 다른 화면의 새 토너먼트로 교체).

1. `LocalGamePage`에 `{ message, resolve } | null` 상태를 두고, `ask`는 이 상태를 설정한 뒤 Promise를 반환한다.
2. 상태가 있으면 `Dialog`를 연다.
   - 제목: `확인`
   - 본문: `message`
   - `actions`: `<button className="primary">확인</button>`
   - `확인`을 누르면 `resolve(true)`, 닫기·Esc를 누르면 `resolve(false)`를 호출한 뒤 상태를 지운다.
3. 확인창이 이미 열려 있을 때 `ask`가 다시 호출되면 이전 Promise를 `false`로 끝낸 뒤 새 질문을 연다.
4. 언마운트될 때 열려 있는 Promise는 `false`로 끝낸다.
5. 다른 대화상자(관리 메뉴)가 열린 상태에서 `ask`가 호출될 수 있다. 관리 메뉴를 닫은 뒤 확인창을 여는지 확인한다. 지금은 `새 토너먼트` 클릭 후 메뉴가 닫히는지 먼저 확인한다.
6. `ask`의 타입(`(message: string) => Promise<boolean>`)은 바꾸지 않는다. `useLocalSession`은 수정하지 않는 것이 목표다.

## 작업 6: 온라인 관리 메뉴 `앱 홈` → `홈`

파일: `frontend/src/features/online-game/components/OnlineMenu.tsx`

- 27행의 `{ label: '앱 홈' }`을 `{ label: '홈', home: true }`로 바꾼다. `MenuItem`에 `home?: boolean`을 추가한다.
- 107행에서 문자열 `'앱 홈'`으로 비교하던 분기를 `item.home ? home() : choose(item)`으로 바꾼다. 문구가 바뀌어도 분기가 깨지지 않게 하기 위해서다.
- 문서: [MULTIPLAYER_MODE.md](../../../MULTIPLAYER_MODE.md) 7절 관리 메뉴 표에 `앱 홈`이 있으면 `홈`으로 고친다.

## 테스트 수정

이름이 바뀌는 곳과 네이티브 대화상자에 의존하는 곳만 수정한다.

| 파일 | 수정 내용 |
|---|---|
| `frontend/tests/online-game/onlineMenu.test.tsx:8-11` | 기대 목록의 `'앱 홈'` → `'홈'` |
| `frontend/e2e/online/host-tools.spec.ts:43` | `menu(page, '앱 홈')` → `menu(page, '홈')`. 다른 `홈` 버튼과 겹치면 관리 메뉴 대화상자 안으로 범위를 좁힌다 |
| `frontend/e2e/game.spec.ts:311, 317-325` | `page.on('dialog')`/`once('dialog')` 대신 앱 확인창의 `확인`·`닫기`를 누른다. 기존 의도(첫 질문은 수락, 두 번째 교체 질문은 거절, 질문 2회)를 유지한다 |
| `frontend/e2e/single-undo.spec.ts:15-19` | 네이티브 대화상자가 없음을 세는 검사는 "앱 확인창이 열리지 않음"(`getByRole('dialog', { name: '확인' })` 개수 0)으로 바꾼다 |
| 그 밖에 `새 토너먼트`를 누르는 e2e | 네이티브 대화상자 처리 없이 진행하던 테스트가 있으면 확인창의 `확인`을 누르도록 바꾼다. `grep -rn "새 토너먼트" frontend/e2e`로 찾는다 |

`e2e/online/managementSupport.ts`의 `confirm()`은 버튼 이름 `확인`을 유지하므로 수정하지 않아도 된다.

새로 추가할 검증:

- 단위 테스트(Vitest): `Dialog`에 `actions`를 넘기면 `.dialog-actions` 안에 `닫기`가 먼저, 실행 버튼이 다음에 오는지 확인한다.
- e2e 한 건: 온라인 `토너먼트 중단` 확인창에서 `닫기`와 `확인`이 같은 줄에 있고(두 버튼의 `boundingBox().y`가 같음), 서로 겹치지 않으며, `확인`에 `primary` 클래스가 있는지 확인한다.

## 검증 순서

`frontend/`에서 실행한다.

1. `npm run typecheck`
2. `npm run lint`
3. `npx vitest run`
4. 관련 e2e:
   - `npx playwright test e2e/game.spec.ts e2e/single-undo.spec.ts e2e/install.spec.ts e2e/pwa.spec.ts e2e/startup-update.spec.ts e2e/interaction-revision.spec.ts e2e/manager.spec.ts e2e/design.spec.ts`
   - `npm run test:e2e:online -- e2e/online/host-tools.spec.ts e2e/online/participant-selection.spec.ts e2e/online/recovery.spec.ts`
5. 공통 `Dialog`를 바꾸므로 마지막에 전체 e2e를 실행한다: `npm run test:e2e`, `npm run test:e2e:online`, `npm run test:e2e:restart`.

실패한 검증이 있으면 숨기지 말고 출력과 함께 보고한다.

## 커밋

AGENTS.md에 따라 작업 단위마다 검증 후 로컬에 커밋한다. 푸시와 PR은 하지 않는다. 커밋 메시지에 AI 작성 표시(Co-Authored-By 등)를 넣지 않는다.

권장 커밋 단위:

1. `feat: add dialog action row` (작업 1~4와 관련 테스트)
2. `feat: replace native confirm in local mode` (작업 5와 관련 테스트)
3. `fix: rename online menu home item` (작업 6과 관련 테스트·문서)

## 완료 기준

- 모든 확인창에서 닫기와 실행 버튼이 한 줄에 간격을 두고 놓이고, 실행 버튼이 금색 CTA로 보인다.
- 로컬 모드에서 브라우저 기본 확인창이 더 이상 뜨지 않는다.
- 온라인 관리 메뉴의 첫 항목이 `홈`이고, 누르면 지금처럼 앱 홈으로 이동한다.
- 위 검증이 모두 통과한다.
