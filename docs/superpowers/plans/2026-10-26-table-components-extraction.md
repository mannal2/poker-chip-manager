# Table Components Extraction

> **For agentic workers:** Use superpowers:executing-plans. Complete and locally commit each responsibility before the next.

**Goal:** Separate player-seat rendering and board presentation/animation from Table while preserving behavior and future mode-independent UI reuse.

**Architecture:** PlayerSeat owns CardPlayer display and existing name-edit/select event markup. Table computes seat positioning, passes drag visual flags/handlers and retains table-wide font fitting. BoardCards owns board count, markup, refs and layout-effect animation. Table retains setup controls, pot navigation and layout. No mode flags, persistence dependencies, new libraries or folder migration.

## Constraints and review focus

- Preserve root div/button switching, inner value button/div switching, InlineName keys, CSS selectors and labels; add no DOM wrappers.
- Spread drag handlers after existing click/context handlers, preserving overrides and pointer capture/currentTarget behavior.
- Preserve player ID keys across reorder and editScope changes; leave input/IME/save logic in InlineName.
- Keep the table ResizeObserver and every-render font-fitting effect unchanged, including selector scope.
- Board keeps first-render/new-hand/restore suppression, only-new-cards animation, duration/easing, cleanup, UNDO behavior and reduced-motion handling.
- Board mounts only in the existing non-setup branch. Its effect/ref lifetime follows that visible board; setup has no rendered cards.
- Existing browser tests cover behavior; do not add implementation-mirroring component tests.

## Task 1: PlayerSeat

- [x] Baseline browser tests for board progression, name-to-drag interaction and IME.
- [x] Extract PlayerSeat/CardPlayer; pass resolved position and drag presentation/handlers from Table.
- [x] Run unit tests, lint, typecheck/build and related Chromium/WebKit E2E for editing, pending saves, scopes, dragging, dealer selection and font fitting.
- [x] Inspect changes and record verification for the task-only local commit.

## Task 2: BoardCards

- [ ] Move count, board markup and animation effect together; wire props from Table.
- [ ] Run unit tests, lint, typecheck/build and related Chromium/WebKit E2E for board counts, UNDO, initial/restore/reduced-motion behavior, layout and chip motion.
- [ ] Request an independent final read-only review, record verification and commit this task locally.

## Verification

### PlayerSeat

- Unchanged baseline: 8 browser cases passed across Chromium/WebKit for board progression/UNDO, name-to-drag interaction and IME (`interaction-revision.spec.ts board.spec.ts`, grep `이름 편집에서 같은|한글 조합|보드 0/`).
- All unit tests: 18 files / 168 passed, no cache. Full lint passed. Production build including TypeScript/PWA generation passed, exit 0.
- PlayerSeat/Table formatting normalized and diff checked. No unrelated code, CSS or persistence changes.
- Post-extraction browser tests: 30 passed across Chromium/WebKit (`interaction-revision.spec.ts name-scope.spec.ts readable-layout.spec.ts`, grep `이름 편집에서 같은|이름 저장 대기|잘못된 이름|한글 조합|이름 글자 밖|원형 경계 삽입|복원 뒤|조작권 변경|실제 글자`). Covers pending-save press/release, invalid input, IME, rotated dragging, dealer selection, stale drafts and 10-player font/layout at four viewports.
- Each browser run required stopping only its preview node after cases completed to finish teardown; both then exited 0.
- Tradeoff: PlayerSeat receives resolved CSS position and drag visual flags/handlers, so it need not know seat order or coordinate geometry. Table-wide font fitting stays in Table to preserve current measurement/ResizeObserver behavior.

### BoardCards

Pending. Full browser suite and physical-device checks are outside this task's verification scope.
