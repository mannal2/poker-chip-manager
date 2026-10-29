# Input Hook and Form Dependencies

> **For agentic workers:** Use superpowers:executing-plans for this scoped input-boundary task; verify and commit locally.

**Goal:** Remove local lease-generation knowledge from reusable input hooks and whole-game state from the blind form without changing input lifetime or commands.

**Architecture:** LocalApp composes the existing betting and settlement scope keys from tournament/hand/local generation. useBettingDraft accepts an optional opaque scope and still invalidates on state version changes. useSettlementSelection accepts its opaque scope, retains selection across version-only changes, and keeps explicit UNDO resets. BlindSettings receives only initialSB/initialBB plus busy/onSave. LocalApp selects pending blinds before current hand values. Input strings and validation remain in the form.

## Constraints and tradeoffs

- Preserve scope string contents exactly: betting tournament:generation; settlement tournament/hand/generation. No active betting scope when generation is undefined.
- Caller owns context identity; the local composition root knows the local lease. Future online code must compose its own identity scope rather than passing local generation numbers.
- Keep the betting version check and all legal-action/command calculations unchanged. Settlement scope deliberately excludes state.version.
- Keep explicit resetWinners calls after successful UNDO, including same-request storage retry.
- Preserve BlindSettings key, mount-only initialization, pending-over-current precedence, busy guard, validation, labels and save callback.
- SetupPanel already accepts GameSettings; retain its draft/IME/blur behavior and InlineName unchanged. Do not generalize distinct draft hooks or introduce global state/dependencies/folder moves.

## Steps

- [x] Baseline relevant betting/settlement/blind browser tests.
- [x] Characterize winner-selection invalidation on control takeover and blind form initial/pending/validation/cancel behavior.
- [x] Pass explicit scope keys to the two hooks and initial values to the form.
- [x] Run all unit tests, full lint/typecheck/build, formatting and related Chromium/WebKit E2E.
- [x] Independent read-only review and verification record for the task-only local commit.

## Verification

- Unchanged baseline: 14 browser tests passed across Chromium/WebKit (`game.spec.ts single-undo.spec.ts manager.spec.ts`, grep `A06|최소 레이즈|인수 후 베팅|블라인드 예약은|무르기 저장 실패|A08`), exit 0.
- New input-boundary characterization cases: 4 passed across Chromium/WebKit before changes. Covers winner draft invalidation on takeover/reacquisition and blind initial/pending values, invalid equal blinds, cancel/reopen and next-hand values.
- After changes: all unit tests 18 files / 168 passed, no cache. Full lint and standalone typecheck passed.
- Related browser tests: 26 passed across Chromium/WebKit (`game.spec.ts single-undo.spec.ts manager.spec.ts input-boundaries.spec.ts keyboard-layout.spec.ts`, grep `A06|A07|최소 레이즈|인수 후 베팅|블라인드 예약은|무르기 저장 실패|A08|조작권 변경은 승자|블라인드 폼|이름 입력과 블라인드`), exit 0. Includes betting submission/retry, all streets, side pots, winner persistence/reset, scope changes, initial values and keyboard editing.
- Production `npm run build`: passed, exit 0, including TypeScript and PWA generation.
- Prettier checks passed for both hooks, BlindSettings and the new browser spec. Existing unrelated LocalApp formatting was retained; git diff --check passed.
- Exact normalized-newline comparisons confirmed betting command preparation and the blind form validation/markup are unchanged.
- Independent read-only review found no actionable regressions in scope composition, version handling, explicit UNDO reset, pending-blind precedence, form key or state lifetime.
- Each of the three browser runs required stopping only its own preview node after cases completed to finish teardown; all exited 0.
- Full browser suite, physical devices and future online integration were not tested.

## Outcome

Both reusable input hooks receive opaque context scopes instead of knowing the local lease-generation format. LocalApp retains local identity and initial-value selection. Betting remains version-sensitive; settlement selection deliberately is not. BlindSettings receives only two initial numeric values, busy state and a save callback, preserving its local string drafts and validation. No generic draft hook, dependency, folder migration or gameplay change was introduced.
