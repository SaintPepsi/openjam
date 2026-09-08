# 04 — Network from the page (fetch and XHR)

Depends on: [00-epic](00-epic.md), [02](02-capture-lane-signal.md), [03](03-page-console-lane.md)

## Problem

Without `Network.*` events we see no requests. The page's own `fetch` and
`XMLHttpRequest` cover the calls people debug (APIs), and a MAIN-world patch sees them
with status, headers the browser exposes, and bodies via `Response.clone()`.

## Design

Same probe script (03), new module `src/page-probe/network.js`:

- `fetch` patch: record `{ requestId, method, url, requestHeaders, requestBody, t }` at
  call; on resolve fill `status, statusText, mimeType (content-type), responseHeaders,
  durationMs, encodedBytes (content-length or body length)`; body captured when
  content-type is texty and ≤ `BODY_CAPTURE_MAX_BYTES` (move that constant to
  `event-kinds.js` or a new `src/capture-limits.js` so both lanes import one value). On
  reject: `failed: true, errorText`. Return value and thrown errors pass through untouched.
- `XMLHttpRequest` patch: wrap `open`/`send`/`setRequestHeader`, read `loadend`.
- Events use `kind: "network"` and the exact `detail` keys `onDebuggerEvent` produces
  (`background.js:165-181`), with `resourceType: "fetch" | "xhr"`, `remoteAddress: null`,
  `fromCache: null`. The request event is pushed at send time and **updated** at completion
  in the background by `requestId`, exactly like the CDP lane's `session.requestEvents`
  map, so a request still in flight at stop shows as pending rather than missing. Probe
  emits two records per request (`net-start`, `net-end`) and the background merges.
- Pure: `mergeNetworkEnd(event, end)` in `src/lanes/inject.js` — testable without a
  browser; `classifyBody(contentType, length)` → capture / skip, shared with the CDP lane's
  `fetchResponseBody` (replace its inline regex; no stragglers).

## Steps

1. Test `test/capture-limits.test.js`: `classifyBody("application/json", 10)` → `true`;
   `("image/png", 10)` → `false`; `("text/plain", 200_000)` → `false`. Run → FAIL.
2. Implement; point `src/lanes/cdp.js fetchResponseBody` at it. `npm test` → unchanged counts.
3. Test `test/page-probe-network.test.js`: stub `globalThis.fetch` resolving a `Response`
   with JSON; after arming, calling `fetch("/api")` emits `net-start` then `net-end` with
   `status: 200`, `responseBody: '{"ok":true}'`; the caller still receives a readable body
   (`await res.json()` works — the clone rule). Rejecting fetch → `failed: true`.
   Disconfirming: read the body without cloning → the caller's `res.json()` throws
   "body used", test fails.
4. Implement `src/page-probe/network.js`. Run → PASS.
5. XHR: test with a minimal fake `XMLHttpRequest` class; assert one start/end pair with
   `resourceType: "xhr"`.
6. Background merge: unit-test `mergeNetworkEnd` directly (`net-end` for an unknown id →
   ignored; known id → merged fields). The through-`start` acceptance lives in 06.
7. Commit `feat(inject): fetch/XHR network events from the page`.

## Acceptance criteria

- `bun test test/page-probe-network.test.js test/capture-limits.test.js` → pass; pasted.
- The clone disconfirming test exists and fails when cloning is removed; pasted once.
- `grep -n "json|text|javascript" src/lanes/cdp.js` → no inline mime regex remains (moved
  to `classifyBody`).
- Follow-up noted, not built: `PerformanceObserver({ type: "resource" })` for img/script/css
  loads.
