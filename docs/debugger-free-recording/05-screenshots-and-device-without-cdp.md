# 05 — Screenshots and device info without CDP

Depends on: [00-epic](00-epic.md), [02](02-capture-lane-signal.md)

## Problem

`Page.captureScreenshot` and `Runtime.evaluate` (device info) need the debugger.
`chrome.tabs.captureVisibleTab` needs only the host permission we hold, and the device
collector is plain page JS that a content script can run.

## Design

- `src/lanes/inject.js screenshot(label)`: `chrome.tabs.get(tabId)` → `windowId`;
  `chrome.tabs.captureVisibleTab(windowId, { format: "png" })` → pushEvent
  `KIND.SCREENSHOT` with `detail.image` (already a data URL). Failure (tab not active, window
  minimised) → the existing `" (failed)"` variant with `detail.error`. Before capturing,
  check `tab.active`; if not, push the failed variant with error
  `"tab not visible"` instead of calling the API (it would throw the same, this is clearer).
- Device info: extract the object literal inside the `expression` string
  (`src/lanes/cdp.js`, formerly `background.js:95-109`) into `src/device-info.js`
  `export function collectDeviceInfo()`; CDP lane evaluates
  `"(" + collectDeviceInfo.toString() + ")()"`, the relay runs it directly on
  `oj-device-info` request and replies. One source, two runtimes (same trick
  `report-builder.js` uses for the renderer).

## Steps

1. Test `test/device-info.test.js`: with a stubbed `navigator`/`screen`/`location`,
   `collectDeviceInfo()` returns the same key set the LEGEND/viewer expects
   (`userAgent, platform, language, languages, vendor, cookieEnabled, online, url, referrer,
   title, viewport, screen, timezone, memory`). Run → FAIL.
2. Implement `src/device-info.js`; switch the CDP lane to `toString()`. `npm test` →
   e2e device assertions still pass (the viewer's Device section is exercised in
   `e2e/extension.spec.mjs`).
3. Relay: handle `{ action: "oj-device-info" }` → `sendResponse(collectDeviceInfo())`
   (relay is isolated-world; navigator/screen values are identical to MAIN world).
4. Test `test/background.test.js`: inject lane `screenshot("x")` with mocked
   `captureVisibleTab` resolving `"data:image/png;base64,AA"` → event with that image;
   mocked reject → `" (failed)"` event. Disconfirming: `tab.active = false` → failed variant
   without the API being called (spy count 0).
5. Implement in `src/lanes/inject.js`. Run → PASS.
6. Commit `feat(inject): captureVisibleTab screenshots, shared device-info collector`.

## Acceptance criteria

- `bun test test/device-info.test.js test/background.test.js` → pass; pasted.
- `grep -c "navigator.userAgent" src/lanes/cdp.js src/device-info.js` → `0` and `1`
  respectively (single source).
- e2e (06) asserts a real `captureVisibleTab` image lands in an inject-mode report:
  `detail.image` starts with `data:image/png;base64,` and is > 1 000 chars.
