# 02 — Capture lane signal and CDP lane module

Depends on: [00-epic](00-epic.md)

## Problem

Every debugger call in `background.js` is inline: `sendCmd` (`:37`), `captureDeviceInfo`
(`:94`), `captureScreenshot` (`:119`), `fetchResponseBody` (`:133`), `onDebuggerEvent`
(`:152-264`), attach/enable (`:418-428`), detach (`:452`). A second lane cannot be added
next to that without either duplicating orchestration or sprinkling `if` checks. The
epic's rule: one signal, read everywhere; lane-specific code behind a common interface.

## Design

`session.capture: "cdp" | "inject" | null` (null when idle). Set once in `startRecording`
and copied to `report.meta.capture` in `finalizeRecording`.

Lane interface (Unify Shared Interfaces), both lanes implement it:

```js
// src/lanes/types.js — documentation only, JS project
// Lane = {
//   start(tabId): Promise<void>      // begin streaming events via pushEvent
//   stop(tabId): Promise<void>       // stop streaming; safe to call twice
//   screenshot(label): Promise<void> // pushEvent(KIND.SCREENSHOT) or the failed variant
//   deviceInfo(tabId): Promise<object>
// }
```

`src/lanes/cdp.js` is the existing code moved, not rewritten: it receives
`{ pushEvent, session, maybeErrorScreenshot }` via a factory `createCdpLane(deps)` so it
keeps reading the same session fields. `background.js` keeps orchestration only:
`startRecording` picks the lane, calls `lane.start`, `captureDeviceInfo`/`captureScreenshot`
delegate to `session.lane`. The attach itself stays in `startRecording` because its
failure decides the lane (06).

The `if (msg.type) return;` router split and the `onMessage` handlers stay where they are.

## Steps

1. Test `test/background.test.js`: after `start`, `getStatus` includes `capture: "cdp"`; after
   `stop`, the stored report has `meta.capture === "cdp"`. Run → FAIL (field missing).
2. Add `capture` to `session`, set it in `startRecording`, expose in `getStatus`, copy into
   `meta`. Run → PASS. Commit `feat: session.capture signal`.
3. Create `src/lanes/cdp.js`: move `PROTOCOL_VERSION`, `BODY_CAPTURE_MAX_BYTES`, `sendCmd`,
   `monotonicToWall`, `previewToString`, `formatRemoteObject`, `formatStackTrace`,
   `headersToObject`, `captureDeviceInfo`, `captureScreenshot`, `fetchResponseBody`,
   `onDebuggerEvent` verbatim into `createCdpLane(deps)`. Register
   `chrome.debugger.onEvent.addListener` inside `start` (guarded so it registers once) or
   keep the listener in `background.js` and forward to `session.lane.onDebuggerEvent`.
   Budget: `src/lanes/cdp.js` ≤ 280 lines, `background.js` drops below 400.
4. `background.js`: `const cdpLane = createCdpLane({ pushEvent, session, maybeErrorScreenshot })`;
   `startRecording` sets `session.lane = cdpLane`; `captureScreenshot(label)` becomes
   `session.lane.screenshot(label)`; `stopRecording`/`salvageRecording` call `session.lane.stop`.
5. `npm test` → identical pass counts to before the move (92 unit, 38 e2e). No new tests are
   needed for a pure move; the existing suite is the regression net.
6. Commit `refactor: extract CDP capture into src/lanes/cdp.js behind the lane interface`.

## Acceptance criteria

- `bun test test/background.test.js` shows the new `capture` assertions passing; pasted.
- `npm test` → 92 unit / 38 e2e pass after the move; pasted counts.
- `wc -l background.js src/lanes/cdp.js` → both under budget; pasted.
- Disconfirming for step 1: remove the `meta.capture` copy → the stored-report test fails;
  pasted.
