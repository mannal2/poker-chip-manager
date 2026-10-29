# Feature Folder Migration

> **For agentic workers:** Use superpowers:executing-plans. Complete this structural migration, verify it and commit locally before unrelated work.

**Goal:** Organize existing responsibilities for mode-independent gameplay UI and mode-specific operation without behavior changes.

## Target ownership

| Target | Existing files/responsibility |
| --- | --- |
| app/App.tsx | Existing path selection and AppRedirect from LocalApp |
| features/gameplay/components | Table, PlayerSeat, BoardCards, GameHeader, BetControls, SetupPanel, InlineName, SettlementPanel, PayoutPreview, BlindSettings, HistoryPanel |
| features/gameplay/hooks | useBettingDraft, useSettlementSelection, useSeatDrag, useChipMotion |
| features/gameplay/model | tableView, history, seatOrder, seatLayout, chipTransfer |
| features/gameplay/styles | table.css and controls.css, unchanged and in the same import order |
| features/local-game/LocalGamePage.tsx | Existing LocalWorkspace (renamed/exported) and LocalGame, preserving all local state and recovery boundaries |
| features/local-game/components | LocalHome, ManagerMenu, LocalHistoryPanel |
| features/local-game/hooks | useLocalSession, useSetupEditing, useLocalHistory, useLocalChipMotion |
| features/local-game/model | appReducer, localChipTransfers |
| features/local-game/storage | All existing local/* storage/controller/restore modules |
| features/pwa | Existing pwa/* plus usePwaPresentation |
| shared | ui/Dialog, hooks/useScreenFit, browser/zoomPolicy, styles/tokens.css |
| game | Existing pure rules/types; unchanged |

## Constraints and tradeoffs

- Move modules and update all static, dynamic and type-import paths in source/tests/browser harnesses. Preserve module exports and filenames except the existing entry/page names needed for the app boundary.
- The only structural extraction is the existing entry/redirect into app/App; LocalWorkspace becomes LocalGamePage. Preserve function bodies, recovery keys, Hook order, event handlers and document navigation.
- No lazy loading, router, barrel exports, aliases, dependencies, protocol, storage schema or empty online scaffolding.
- Keep HTML entry points, Vite config and SW scope/cache policy unchanged. Online remains the existing placeholder and never invokes local PWA hooks.
- Preserve CSS bytes and order; mixed control/dialog selectors stay intact for this move. Splitting global style responsibilities would be a separate styling task.
- Keep test locations and cross-language JSON fixtures stable. Update historical plan records only by adding this new record, not rewriting old references.
- Snapshot source and use normalized module comparisons to verify that moved files changed only in import specifiers; separately compare entry/page function bodies.

## Steps

- [x] Baseline all unit tests and home/PWA browser cases.
- [x] Relocate files and update import paths; split only existing entry/page composition.
- [x] Verify content preservation, dependency direction, obsolete imports and all entry/test harness references.
- [x] Run all unit tests, lint, typecheck, full Chromium/WebKit suite and production build/PWA artifact checks.
- [x] Independent read-only review and evidence record for the task-only local commit.

## Verification

- Baseline: all unit tests 18 files / 168 passed, no cache; home/PWA browser cases 8 passed across Chromium/WebKit (`app-flow.spec.ts pwa.spec.ts`, grep `앱 홈은|A09|online|전환`), exit 0.
- Relocated 47 source files. Updated static imports, dynamic imports and import types in unit tests and design/storage browser harnesses; existing test directories remain unchanged.
- Snapshot comparison: 108 existing source/test/config/style files match after relative-import target normalization. The four existing entry/page functions match after their explicit entry/page renames. CSS content and local page import order are unchanged.
- Verified shared/gameplay/PWA dependency direction and no obsolete source paths in executable frontend code. Vite config, HTML entry points, game modules, fixtures, package files and API/storage contracts are unchanged.
- Post-migration all unit tests: 18 files / 168 passed, no cache. Full lint and standalone typecheck passed.
- Independent read-only review found no actionable regressions in reference coverage, entry/page lifetimes, CSS order or SW boundaries.
- Added src/README.md documenting directory ownership, dependencies, input scopes and the future online integration boundary.
- Full browser suite: 434 passed / 2 skipped across Chromium/WebKit, exit 0 (`npx playwright test --reporter=line`, 436 cases in 30 files). The skips are the existing Chromium CDP-only touch cases under WebKit; both ran under Chromium. Includes design comparisons, all game/input/history/storage/recovery cases, PWA offline/update/install behavior, keyboard/zoom and responsive/touch layouts.
- Production `npm run build`: passed, exit 0, including TypeScript and PWA generation. CSS output retains `main-DH0qAZDy.css`.
- Production artifact checks passed: 8 precache resources exist, both local HTML JS/CSS dependencies are cached, manifest start/scope remain /local/, online/API/test entry resources are not precached and test-only HTML entries are absent from the production build.
- Final content/dependency verification repeated successfully after browser tests. New App/source README formatting and git diff --check passed; existing moved-module formatting was retained.
- Both browser runs required stopping only their own preview node after all cases completed to finish teardown; both then exited 0. PWA browser runs were serialized with production builds because they temporarily modify generated SW files.
- Physical devices and future online implementation were not tested.

## Outcome

The source tree now expresses existing ownership: app entry, pure game rules, common gameplay, local operation/storage, local PWA and generic shared utilities. Existing route functions were relocated without changing document navigation or local recovery lifetimes. Future online code can compose the common gameplay UI through its own state/permission/transport adapters; no online implementation, lazy loading, API change or storage migration was included.
