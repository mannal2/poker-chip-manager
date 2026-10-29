# Chip Motion Calculation and Playback Separation

> **For agentic workers:** Use superpowers:executing-plans. Verify and locally commit this responsibility before any later refactoring.

**Goal:** Make chip playback independent of local commands and predicted game transitions, preserving current confirmed-save behavior.

**Architecture:** ui/chipTransfer.ts defines the existing ChipTransfer data contract. app/localChipTransfers.ts retains the current pure local transition preview unchanged. app/useLocalChipMotion.ts connects local commands to the shared ui/useChipMotion.ts renderer, which prepares coordinates for a supplied movement list and plays/clears animations. LocalApp uses the local hook; useLocalSession confirmation/version/request-id/retry code stays untouched.

## Constraints and tradeoffs

- Keep current folders, DOM selectors, geometry, 720ms duration/delays, styles, effects and reduced-motion behavior.
- Prepare coordinates before dispatch; play only on the existing confirmed result or matching same-request retry.
- Preserve UNDO/NEW_TOURNAMENT clearing and scope/resize/pagehide/visibility cleanup with epoch invalidation of stale prepared animations.
- Keep hidden/reduced-motion checks in the local adapter before prediction and in the shared renderer before capture/play. The small repeated presentation guards preserve short-circuit behavior and keep the renderer independently usable; no new policy abstraction is needed.
- Shared renderer imports only the movement type, React and browser APIs; no GameState, transition or local Request dependency.
- Online transport/event mapping is future work. Do not create an online adapter or treat a client prediction as server confirmation.
- Keep the existing calculator tests in place with only their import updated; folder migration is deferred.

## Steps

- [x] Baseline: calculator unit tests and existing Chromium/WebKit chip-motion tests.
- [x] Add and verify a characterization case for resize between unknown save and successful retry, invalidating old coordinates.
- [x] Move the calculator unchanged, extract movement type and local hook, and make shared prepare accept movement data only.
- [x] Run unit tests, full lint/typecheck/build, formatting and related browser regression tests.
- [x] Independent read-only review and verification record for the task-only local commit.

## Verification

- Unchanged baseline: calculator unit tests 5 passed; existing chip-motion browser tests 12 passed across Chromium/WebKit, exit 0.
- Added resize-before-retry characterization: 2 passed across Chromium/WebKit before extraction. Checks successful saved balances/pot and no playback using the old coordinates.
- Post-extraction unit tests: 18 files / 168 passed (`npm run test -- --run --no-cache`). Full lint and standalone typecheck passed.
- Post-extraction browser tests: 22 passed across Chromium/WebKit (`chip-motion.spec.ts saving-appearance.spec.ts name-scope.spec.ts`, no filter), exit 0. Covers the new stale-coordinate case, confirmed-save/retry playback, joint payouts, fold combining, UNDO/home/resize cleanup, reduced motion, editing scopes and duplicate-input blocking.
- Production `npm run build`: passed, exit 0, including TypeScript and PWA generation.
- Prettier checks for all new/moved/modified motion files and browser spec passed; git diff --check passed.
- Exact normalized-newline comparisons confirmed the calculator function and the renderer's play implementation are unchanged from HEAD.
- Independent read-only review found no actionable regressions in command handling, confirmation/retry flow, guards, epoch invalidation or DOM geometry. useLocalSession is unchanged.
- Each of the three browser runs required stopping only its own preview node after all cases completed to finish teardown; all then exited 0.
- Full browser suite, physical-device checks and online integration were not performed.

## Outcome

The shared renderer prepares and plays ChipTransfer[] without game rules, local request types or persistence dependencies. The local hook retains local command-specific clearing and prediction, while the existing session decides when a prepared animation is confirmed. A future online adapter can supply server-confirmed movement data without invoking the local transition preview. No transport, protocol, folder migration or gameplay behavior was introduced.
