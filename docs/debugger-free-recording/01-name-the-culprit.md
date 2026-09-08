# 01 — Name the culprit

Depends on: [00-epic](00-epic.md)

Ships on the current branch as part of 0.6.3, ahead of the rest of the epic. Reused by 06
as the source of the degraded-mode warning.

## Problem

`attachError()` (`background.js:390`) says "another extension" but cannot say which. The user
has to guess among everything installed. Chrome tells us nothing useful, but the page does:
every foreign frame's `src` is `chrome-extension://<id>/…`.

## Design

- Pure: `foreignExtensionIds(frameSrcs, ownId)` in `src/foreign-frames.js` → sorted unique
  IDs of other extensions. Input is a string array, so it tests without a DOM.
- Scan: `scanForeignFrames(tabId)` in `background.js` runs
  `chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func })` where
  `func` returns `[...document.querySelectorAll("iframe[src^='chrome-extension:']")].map(f => f.src)`.
  `allFrames: true` catches frames nested in ordinary iframes. Closed shadow roots are
  unreachable; the message then falls back to the unnamed text.
- Error payload grows a field: `{ ok: false, error, blockedBy: ["<id>", …] }`. The
  message names the count ("Another extension (ID abcd…) has added content…"); the popup
  renders one **Manage extension** button per ID that opens
  `chrome://extensions/?id=<id>` via `chrome.tabs.create`. Extensions may open
  `chrome://extensions` URLs with `tabs.create` even though pages cannot link to them.
- Popup: `popup.js showFailure(res)` passes `blockedBy` to a new
  `<openjam-popup>` notice slot rendering the buttons. Component stays `ui = fn(state)`:
  `showError(msg, { actions: [{ label, id }] })`, emits `oj-action` with the id; `popup.js`
  owns the `tabs.create` side effect.

## Steps

1. Test `test/foreign-frames.test.js`: `foreignExtensionIds(["chrome-extension://aaa/x.html","chrome-extension://aaa/y.html","chrome-extension://bbb/z","https://x/","chrome-extension://own/mic.html"], "own")` → `["aaa","bbb"]`; empty input → `[]`. Run `bun test test/foreign-frames.test.js` → FAIL (module missing).
2. Implement `src/foreign-frames.js` (≤20 lines). Run → PASS.
3. Test in `test/background.test.js`: mock `chrome.scripting.executeScript` to return
   `[{ result: ["chrome-extension://aaa/f.html"] }]`; with `attachFailure` set to the
   foreign-frame error, `start` returns `blockedBy: ["aaa"]` and `error` contains `aaa`.
   Disconfirming: mock returns `[]` → `blockedBy: []`, message is the unnamed text. Run → FAIL.
4. Implement `scanForeignFrames` and thread `blockedBy` through `attachError(err, ids)`.
   Run → PASS.
5. Component test (`test/popup-component.test.js` or the existing popup test file):
   `showError("x", { actions: [{ label: "Manage extension", id: "aaa" }] })` renders one
   button; clicking dispatches `oj-action` with `{ id: "aaa" }`. Disconfirming: no
   `actions` → zero buttons.
6. Wire `popup.js`: on `oj-action`, `chrome.tabs.create({ url: "chrome://extensions/?id=" + id })`.
7. e2e `e2e/foreign-extension-frame.spec.mjs`: after the blocked start, assert
   `blocked.blockedBy` equals `[new URL(frameOrigin).host]` (the fixture extension's id,
   already read from the injected frame's `src`). Assert the popup shows a **Manage extension** button
   after driving the real toggle, like the restricted-page test does (`e2e/extension.spec.mjs:485`).
8. Commit: `fix(#48): name the blocking extension and offer a one-click path to it`.

## Acceptance criteria

- `bun test test/foreign-frames.test.js test/background.test.js` → all pass; pasted output.
- `npx playwright test e2e/foreign-extension-frame.spec.mjs` → pass, with the
  `blockedBy` assertion present in the spec.
- Disconfirming: replace the `scanForeignFrames` result with `[]` → e2e fails on the
  `blockedBy` assertion; pasted output.
- Manual (Ian): pre-fix 0.6.2 shows the raw CDP error; 0.6.3 shows the named message and
  the button opens Edge/Chrome's extension page for the fixture extension.
