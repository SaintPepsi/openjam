# 06 — Fall back to the inject lane on a foreign frame

Depends on: [00-epic](00-epic.md), [01](01-name-the-culprit.md), [02](02-capture-lane-signal.md),
[03](03-page-console-lane.md), [04](04-page-network-lane.md), [05](05-screenshots-and-device-without-cdp.md)

## Problem

Everything above exists but nothing selects it. `startRecording` still returns
`attachError(err)` and stops.

## Design

```js
// background.js startRecording, replacing the try/catch at the attach
let lane = cdpLane;
try {
  await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
} catch (err) {
  if (!FOREIGN_EXTENSION_FRAME.test(String(err))) {
    session.recording = false;
    return { ok: false, error: attachError(err) };
  }
  lane = injectLane;
  session.blockedBy = await scanForeignFrames(tabId);   // from 01
}
session.capture = lane.name;   // "cdp" | "inject"
session.lane = lane;
await lane.start(tabId);
```

- The report gets a first `KIND.LOG` warning event: "Recorded without Chrome's debugger:
  extension <id> has content in this page. Network shows fetch/XHR only; screenshots are
  viewport-only." Same text goes back to the popup as `{ ok: true, warning, blockedBy }`.
- Popup: `showWarning(warning, { actions })` (gold box, not red) reusing 01's action
  buttons. Recording state stays "on".
- `oj-page-batch` and `oj-device-info` are only honoured when `session.capture === "inject"`.
  In cdp mode the probe is never armed, so nothing arrives; the check is defence in depth.
- `stopRecording`: `lane.stop(tabId)` (inject: send `probe-stop`, await the 400 ms grace
  like rrweb; cdp: detach). `salvageRecording` unchanged: it only ever fires from debugger
  detach / tab removal, both lanes tolerate it.

## Steps

1. Unit `test/background.test.js`: with `attachFailure` = the foreign-frame error and the
   scripting mock returning one foreign src, `start` → `{ ok: true, warning: /without
   Chrome's debugger/, blockedBy: ["aaa"] }`, `getStatus().capture === "inject"`; a
   subsequent `oj-page-batch` from the tab is accepted; `stop` → stored report has
   `meta.capture: "inject"` and the first event is the LOG warning. Disconfirming:
   `attachFailure` = "Another debugger is already attached" → `ok: false`, no lane started.
   Run → FAIL.
2. Implement the selection above and `src/lanes/inject.js start/stop`
   (arm/disarm the probe over `chrome.tabs.sendMessage`, with the same executeScript
   retry the rrweb starter uses at `background.js:275-297` — extract that retry into
   `ensureContentScripts(tabId)` and reuse it; no second copy).
3. Run → PASS. Commit `feat(#48): record via the inject lane when a foreign frame blocks the debugger`.
4. e2e `e2e/foreign-extension-frame.spec.mjs` — rewrite the blocked assertion into the
   success path:
   - `start` → `ok: true`, `warning` contains the fixture extension's id, `capture` is
     `"inject"` on `getStatus`.
   - Drive the fixture: click `#inc` (console.log in fixture), `#fetchBtn` (fetch self),
     `#errBtn` (throws `Error("fixture test error")`, `test/e2e/fixture.html:68`).
   - `stopAndOpenViewer` → report (read via `viewer.evaluate` or storage) has
     `meta.capture === "inject"`, a `console` event, a `network` event with `status: 200`
     and `resourceType: "fetch"`, an `error` event whose title contains `fixture test error`, and a screenshot
     with a real PNG data URL.
   - Keep the frame-removal disconfirming half: without the frame, `capture === "cdp"`.
5. `npm test` green. Commit `test(e2e): inject-lane recording next to a foreign extension`.

## Acceptance criteria

- `npx playwright test e2e/foreign-extension-frame.spec.mjs` → pass; pasted with the
  assertion list visible in the spec.
- Disconfirming: comment out the probe arming in `injectLane.start` → e2e fails on the
  `console` event assertion (not on a selector); pasted once.
- `bun test test/background.test.js` → pass including the "other attach errors still
  abort" test from the current branch.
- Manual (Ian): with Bitwarden or the fixture extension enabled on a real site, Start
  records, the popup shows the gold warning naming the extension, the viewer shows fetch
  calls and console output.
