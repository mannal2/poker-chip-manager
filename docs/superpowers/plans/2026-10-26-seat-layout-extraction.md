# Seat Layout Extraction

**Goal:** Share seat coordinates between rendering and dragging without a hook importing a React component.

**Scope:** Move the existing seatCoordinates declaration unchanged from ui/Table.tsx to ui/seatLayout.ts. Update Table and useSeatDrag imports. Preserve the public name, type, coordinate values and seat indexing. No folder migration, layout recalculation, component extraction or new abstraction.

**Tradeoff:** Keep the existing mutable Record type for this mechanical move rather than changing consumers or introducing a layout API. Both consumers depend directly on the same data-only module.

## Steps

- [x] Verify unchanged seat-order/table-view unit tests and circular-boundary browser tests.
- [x] Move the declaration and update its two consumers.
- [x] Compare the extracted declaration against HEAD byte-for-byte after newline normalization.
- [x] Run all unit tests, lint, typecheck, production build and related Chromium/WebKit E2E covering 2–10 players, rotation and dragging.
- [x] Record verification and inspect the diff for the task-only local commit.

## Verification

- Baseline unit tests: seatOrder and tableView, 2 files / 14 passed.
- Baseline browser tests: 4 passed across Chromium/WebKit; circular-boundary insertion with and without view rotation.
- Extracted declaration equals HEAD exactly after newline normalization, including type and all 2–10-player values. A second comparison confirmed Table changed only by removing the declaration and adding its import.
- All unit tests: 18 files / 168 passed (`npm run test -- --run --no-cache`).
- Full lint, standalone typecheck and new-module Prettier check passed.
- Post-extraction browser tests: 20 passed across Chromium/WebKit (`interaction-revision.spec.ts setup.spec.ts`, grep `원형 경계|10명:`), exit 0. Covers 2–10 players, circular-boundary dragging, rotated view, full rotation and dealer/order preservation.
- Production `npm run build`: passed, exit 0, including TypeScript and PWA generation.
- Both browser runs required stopping only their preview node after cases completed to finish teardown, consistent with previous tasks; both then exited 0.
- No new tests were needed for the unchanged data declaration; existing behavior tests and exact declaration comparison cover this move.
- Full browser suite, physical-device tests and future online integration were not run.

## Outcome

Table and useSeatDrag now depend directly on ui/seatLayout.ts. The drag hook no longer imports Table.tsx. Coordinate data has no React, local-storage or mode dependency; current rendering and target calculations are unchanged. No component extraction or folder restructuring was included.
