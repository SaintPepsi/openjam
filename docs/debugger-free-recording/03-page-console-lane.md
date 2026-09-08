# 03 — Console and errors from the page

Depends on: [00-epic](00-epic.md), [02](02-capture-lane-signal.md)

## Problem

Without CDP there is no `Runtime.consoleAPICalled` or `Runtime.exceptionThrown`. The page
itself can report both if we patch `console.*` and listen to `error` /
`unhandledrejection` in the MAIN world, then ship them over the relay the rrweb recorder
already uses (`src/rrweb-relay.js`).

## Design

- New MAIN-world script `src/page-probe.js`, bundled by `build.mjs` to `dist/page-probe.js`,
  declared in `manifest.json` next to the recorder (`document_start`, `world: "MAIN"`).
  Installs patches immediately (so it wins the "first wrapper" race against Sentry-style
  wrappers) but only **emits** once armed by a `start` envelope; disarmed on `stop`.
- Envelope: reuses `TO_RELAY` / `FROM_RELAY` tags with new kinds `probe-batch`,
  `probe-start`, `probe-stop`. The relay forwards `probe-batch` as
  `chrome.runtime.sendMessage({ type: "oj-page-batch", eventsJson })`, a JSON string like
  rrweb batches (same depth contract). The background accepts it only when
  `session.capture === "inject"` and the sender tab matches, else replies `{ stop: true }`.
- Pure serializer `src/page-probe/serialize.js`: `serializeArgs(args)` → string, mirroring
  `formatRemoteObject` output shape (strings raw, objects via safe JSON with cycle guard,
  functions as `function name()`, depth cap 3, 1 000 chars per arg). `captureStack()` →
  `new Error().stack` with our own frames stripped.
- Event mapping (same schema as `LEGEND`):
  - `console.<level>` → `{ kind: "console", level, title: text, detail: { message, stack } }`
    with `warn → "warning"`, `debug/info/log` as-is.
  - `window.onerror` / `error` event → `{ kind: "error", level: "error", title: firstLine,
    detail: { message, url, line, column, stack } }`.
  - `unhandledrejection` → `kind: "error"`, message `"Unhandled promise rejection: …"`.
- Batches flush every 500 ms like the recorder; the final flush on `stop` is awaited under
  the same 300 ms cap (`src/rrweb-recorder.js:20-21` documents why).

## Steps

1. Unit test `test/page-probe-serialize.test.js`: `serializeArgs(["a", 1, { b: [1, 2] }])`
   → `'a 1 {"b":[1,2]}'`; cyclic object → contains `"[Circular]"`; function → `function f()`;
   5 000-char string → 1 000 chars plus `…`. Run → FAIL.
2. Implement `src/page-probe/serialize.js`. Run → PASS. Commit.
3. Unit test `test/page-probe.test.js` (bun, jsdom-free: stub `window`, `console`,
   `postMessage`): after `probe-start`, `console.error("x")` produces one batch with
   `kind: "console", level: "error"`; a `console.warn` before arming produces nothing;
   patched `console.log` still forwards to the original (spy called). Disconfirming: drop
   the forward call → spy assertion fails.
4. Implement `src/page-probe.js` (≤150 lines). Run → PASS.
5. Relay: add the three kinds to `src/rrweb-relay.js`; unit test the forward with a stubbed
   `chrome.runtime.sendMessage` (`test/relay.test.js` if absent, else extend).
6. Background: `oj-page-batch` handler → `pushEvent` per event, `maybeErrorScreenshot()` on
   `level === "error"` / `kind === "error"`. Implement as a pure
   `pageBatchToEvents(batch)` in `src/lanes/inject.js` and unit-test that directly; the
   end-to-end acceptance (batch accepted only in inject mode) is 06's test, since only 06
   makes inject mode reachable through `start`.
7. `build.mjs` entry + `manifest.json` content script entry. `npm run build` → `dist/page-probe.js`.
8. Commit `feat(inject): console + error events from the page`.

## Acceptance criteria

- `bun test test/page-probe-serialize.test.js test/page-probe.test.js` → pass; pasted.
- `ls dist/page-probe.js` exists after `npm run build`.
- Disconfirming: arm never sent → zero batches (test present and passing).
- Existing cdp lane unaffected: `npm test` counts unchanged plus the new tests.
