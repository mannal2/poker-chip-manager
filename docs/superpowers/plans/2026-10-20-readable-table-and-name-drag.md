# Readable Table and Name Editing Drag Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 카드와 주요 조작부의 가독성을 높이고, 이름 편집 뒤 드래그가 막히는 현상을 수정한다.

**Architecture:** 기존 Table/BetControls 및 화면 맞춤 구조 안에서 크기와 배치만 조정한다. 이름 편집과 카드 드래그의 이벤트 순서를 별도로 수정하며, 저장 중 조작 차단과 저장 오류 복구는 유지한다.

**Tech Stack:** React, TypeScript, CSS, Vitest, Playwright (Chromium/WebKit).

**Spec:** 이 대화에서 승인된 디자인 방향, UX_SPEC.md, SYSTEM_SPEC.md. 이번 문서는 구현 전 계획이며 실제 UI 변경은 포함하지 않는다.

## Global Constraints

- 기본 화면은 항상 스크롤 금지. 핸드 기록 내부 스크롤은 유지.
- 가로 화면은 높이에 맞는 너비만 사용하고 가운데 배치.
- 최대 10명, 이름 글자만 편집 진입, 나머지 카드 영역은 딜러 선택/드래그.
- 기존 색상과 디자인, 키보드 입력 시 화면 축소 방지, 저장 안정성 유지.
- 개별 작업 검증 후 로컬 커밋. push/PR/merge/배포는 별도 요청 필요.
- 픽셀 수치는 --u=1 기준 초안. 최종 판정은 화면 맞춤 후 실제 크기로 한다.

## Review Focus

1. 10명일 때 카드 겹침과 긴 이름/큰 칩 숫자의 잘림.
2. 짧은 가로 화면에서 전체 자동 축소가 글자 확대 효과를 상쇄하는 상황.
3. 이름 편집 중 카드 누르기의 pointerdown → blur → 저장 → 재렌더 순서.
4. 한글 조합, 유효하지 않은 이름, 저장 실패 때 편집/드래그 상태 불일치.
5. 키보드 닫힘 및 화면 회전 후 화면 맞춤 반복 변경/깜빡임.

## 결함 현상과 코드 분석

- 사용자 보고: 대기 화면 이름 입력에 포커스 효과가 남고 해당 카드를 드래그할 수 없다.
- InlineName.tsx는 편집 input에 금색 outline을 주며, input 존재 시 이름 편집 영역을 이름 행 전체 너비로 확장한다. 이 영역은 pointerdown 전파를 차단한다.
- LocalApp.tsx는 renameId가 설정되어 있으면 모든 카드의 useSeatDrag를 비활성화한다.
- useSeatDrag.ts는 pointerdown 시 enabled=false이면 세션을 만들지 않는다. 이 판단은 기본 포커스 이동으로 발생하는 blur보다 먼저 일어날 수 있다.
- InlineName의 blur 저장은 busy/한글 조합 중이면 편집을 닫지 않는다. 변경 저장은 비동기이고 저장 중에도 드래그가 비활성화된다. enabled 변경 시 훅 정리가 기존 세션을 취소한다.
- 따라서 단순 포커스 테두리 문제가 아니라 편집 상태/포인터 전파/저장 시점이 맞물린 경로가 있다. 사용자의 정확한 지속 재현 조건은 아직 브라우저에서 확인하지 않았으므로 구현 첫 단계에서 재현 테스트로 확정한다.

### Task 1: 이름 편집 종료와 드래그 전환

**Files:** frontend/src/ui/InlineName.tsx, frontend/src/ui/Table.tsx, frontend/src/ui/useSeatDrag.ts, frontend/src/app/LocalApp.tsx 중 재현으로 필요한 파일만 수정.
**Tests:** frontend/e2e/interaction-revision.spec.ts, frontend/e2e/tablet-touch.spec.ts, frontend/e2e/keyboard-layout.spec.ts.

- [x] 실패 재현: 이름 입력 중 같은 카드의 숫자 영역과 이름 옆 빈 공간을 길게 누르고 이동한다. 다른 카드도 확인한다. Enter 확정/바깥 클릭 확정/한글 조합 종료/이름 미변경을 나누어 실행한다.
- [x] 금색 input 테두리와 실제 document.activeElement, renameId에 따른 드래그 차단을 구분한다. 편집 종료 뒤 남는 차단인지 첫 제스처 유실인지 확인한다.
- [x] 이름 글자/입력 자체는 편집 동작으로 유지한다. 카드의 나머지 영역을 누르면 편집을 먼저 확정하고 드래그 시작을 연결한다. 키보드 접근용 포커스 표시를 일괄 제거하지 않는다.
- [x] 저장이 필요한 경우 기존 저장 차단을 우회하지 않는다. 누름이 유지되고 저장이 정상 완료된 경우에만 최신 좌석 순서로 드래그를 시작하며, 손을 떼거나 입력 오류/저장 실패/포인터 취소가 발생하면 대기 동작을 취소한다. 무조건 두 번 누르게 만드는 방식은 피한다.
- [x] 실패 시 이름 중복/빈 이름 안내와 수정 경로가 유지되고, 딜러 선택이나 좌석 이동이 의도치 않게 저장되지 않는지 검증한다.
- [x] 관련 E2E를 Chromium/WebKit에서 실행하고 기존 좌석 삽입/저장 복구 테스트를 확인한다. 버그 조사 기록 및 IMPLEMENTATION_PROGRESS.md 갱신 후 커밋한다.

### Task 2: 베팅 조작부를 3줄로 변경

**Files:** frontend/src/ui/BetControls.tsx, frontend/src/ui/controls.css.
**Tests:** 기존 베팅 E2E와 frontend/e2e/tablet-layout.spec.ts.

- [x] 1행은 베팅 취소/콜·체크/폴드/올인, 2행은 칩 5/10/50/100, 3행은 Clear/BET로 배치한다. 기존 액션과 비활성 조건은 유지한다.
- [x] 3행 너비는 2:3. Clear는 보조 스타일, BET는 기존 금색 강조. 표시 문구 변경은 이번 작업에서 추가하지 않는다.
- [x] 첫 행 글자 약 14, 버튼 높이 48~52, 칩 지름 50~52를 초안으로 적용한다. 좁은 화면에서는 텍스트/터치 영역을 우선하고 여백부터 줄인다.
- [x] 각 행 경계와 칩 개수, 2:3 너비, 칩 누적/Clear/BET 동작 및 초과 입력 차단을 검증한다. 관련 테스트/타입 검사/린트 통과 후 진행 기록을 갱신하고 커밋한다.

### Task 3: 카드·테이블·주요 버튼 확대와 높이 조정

**Files:** frontend/src/ui/table.css, frontend/src/ui/controls.css, frontend/src/ui/tokens.css. frontend/src/ui/useScreenFit.ts는 실제 축소 문제가 확인된 경우에만 최소 수정.
**Tests:** frontend/e2e/tablet-layout.spec.ts, frontend/e2e/keyboard-layout.spec.ts 및 기존 10인/회전/화면 맞춤 테스트.

- [x] 이름/칩 글자 13~14, 카드 높이 60~64를 초안으로 조정한다. 너비는 10인 간격을 보며 필요한 만큼만 늘린다.
- [x] 실제 테이블 배치 영역과 felt를 세로로 약 10~15% 늘린다. 대기/베팅/승자 화면에서 동일한 카드 배치 영역을 사용한다.
- [x] 게임 시작/다음 핸드/메뉴 등 주요 버튼의 글자와 높이를 소폭 늘린다. 이름 편집 글자의 클릭 범위를 카드 전체로 확대하지 않는다.
- [x] 3행 조작부를 포함한 전체 높이를 함께 맞춘다. 높이가 부족하면 바깥 여백과 행 간격을 먼저 줄이고 그다음 컴포넌트 크기를 조절한다. 폰트 확대를 상쇄하는 전체 축소 여부를 기존 화면과 수치로 비교한다.
- [x] 320x568, 390x844, 800x1280, 1280x800, 844x390, 667x375 및 기존 초소형 케이스에서 2~10인 대기/베팅/승자 화면을 검사한다. 기본 화면 스크롤/잘림/카드 간 겹침이 없어야 한다.
- [x] 일반 세로 화면에서는 실제 렌더링된 카드 글자가 기존보다 커야 한다. 극단적으로 낮은 화면은 스크롤 없음과 조작 가능성을 우선하며 확대 한계를 기록한다.
- [x] 긴 이름/큰 금액, 카드 드래그, 화면 회전, 키보드, 핸드 기록 내부 스크롤을 확인한다. 클릭 후 크기 스타일이 반복 변경되거나 화면이 깜빡이지 않는지 확인한다.
- [x] 타입 검사/린트/단위 테스트/관련 E2E/프로덕션 빌드를 통과시킨다. 전후 화면 비교, 한계, 실행 결과를 IMPLEMENTATION_PROGRESS.md에 기록하고 커밋한다.

## 실행 순서

버그 재현·수정 → 3행 베팅 조작부 → 카드/테이블/화면 높이 최종 조정. 각 작업의 검증과 커밋을 마친 뒤 다음 작업으로 진행한다. 2026-10-20 사용자 구현 승인 후 각 작업을 검증하고 별도 커밋했다. 독립 리뷰의 편집기 수명 결함과 최종 테스트 경합도 보완했다. 최종 검증 수치와 실패/재검증 이력은 IMPLEMENTATION_PROGRESS.md를 따른다. 실기기 검증·push·PR·배포는 수행하지 않았다.
