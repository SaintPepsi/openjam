# OpenJam Phase 4 — Cross-Browser Capture (Firefox + Safari)

**Status:** Implementation plan only — NOT code. Do not implement from this document; it is the
ordered spec to hand to the build step.

**Goal (from `REPLAY_DESIGN.md` §7, Phase 4):** make OpenJam run on Firefox and Safari by pivoting
the capture foundation from `chrome.debugger`/CDP to **page injection** (a content script), keeping
CDP only as a Chromium-only enhancement behind a capability check. The "bar" for done is: *"I
recorded a real session in Firefox"* — console + network + errors + rrweb replay captured **without**
`chrome.debugger`, exported, and opened as a self-contained HTML.

---

## 0. Dependency note — Phases 1–3 (read first)

This plan assumes Phases 1–3 from `REPLAY_DESIGN.md` §7 are **complete and shipping on Chromium**:

- **Phase 1** — rrweb capture + replay: a content-script recorder running in the ISOLATED world at
  `run_at: "document_start"` (§2, §7), segment ring buffer with `checkoutEveryNms: 60_000` (§3),
  IndexedDB persistence + `unlimitedStorage`, and `rrweb-player` wired into `viewer.js`.
- **Phase 2** — self-contained export: `report-builder.js` inlines the `rrweb-player` UMD build and
  fflate-base64 event blob (§6).
- **Phase 3** — hybrid pixel keyframes: CDP `Page.captureScreenshot` lane for canvas/WebGL/video/
  cross-origin gaps (§5, §7).

**Why this matters for Phase 4:** Phase 1 already proved that a content script can `record()` and
relay events with `chrome.runtime.sendMessage` from the ISOLATED world (§2, line 44). Phase 4 reuses
that exact transport for the new injection-capture lanes. The rrweb recorder is **already portable**
(injected page JS) — Phase 4 does **not** re-port rrweb; it ports the *non-rrweb* signals (console /
network / errors / device) that today live entirely in CDP inside
`/Users/ian.hogers/projects/openjam/background.js`.

**Current reality (the thing we are pivoting away from):** in `background.js`, 100% of
console/network/errors/device/screenshot capture flows through `chrome.debugger.sendCommand` /
`chrome.debugger.onEvent` (`onDebuggerEvent`, lines 147–259; `startRecording` attaches the debugger,
lines 285–294). `manifest.json` declares `"permissions": ["debugger", ...]` and a Chromium
`service_worker` background. Per design §1 (lines 9–13), **CDP exists on neither Firefox nor
Safari** — Firefox never implemented `chrome.debugger` ([bug 1316741](https://bugzil.la/1316741)),
Safari has no CDP transport, no `debugger` permission, and no `webRequest` on MV3.

---

## 1. Capability matrix (authoritative — reused from `REPLAY_DESIGN.md` §1, lines 17–24)

Every capture must produce **the same report schema** regardless of mechanism. The mechanism is
chosen at runtime by capability detection (Step 3); the *output shape* never changes.

| Capability      | Portable mechanism (all browsers — the baseline)                 | Chromium-only enhancement (CDP, behind capability check) |
|-----------------|------------------------------------------------------------------|----------------------------------------------------------|
| Session replay  | rrweb in content script (already portable; Phase 1)              | —                                                        |
| Console         | patch `console.*` in injected script                             | `Runtime.consoleAPICalled` (richer stacks)               |
| Network         | wrap `fetch` + `XMLHttpRequest` (+ Performance API timing)       | `Network.*` (full bodies/timing/cache)                   |
| Errors          | `window.onerror` + `unhandledrejection`                          | `Runtime.exceptionThrown`                                |
| Screenshots     | `tabs.captureVisibleTab` (viewport only)                         | `Page.captureScreenshot` (full-page, clip)               |
| Device info     | read `navigator` / `screen` in injected script                   | `Runtime.evaluate`                                       |

**Per-browser reach** (design §1, lines 29–34):

| Browser                                   | Replay | Console | Network | Errors | Screenshot          | Device | CDP enhancement |
|-------------------------------------------|--------|---------|---------|--------|---------------------|--------|-----------------|
| Chromium (Chrome/Edge/Brave/Opera/Vivaldi)| rrweb  | inject **or** CDP | inject **or** CDP | inject **or** CDP | `captureVisibleTab` + CDP full-page | inject **or** CDP | **Yes** |
| Firefox                                   | rrweb  | inject  | inject  | inject | `captureVisibleTab` (viewport) | inject | No |
| Safari                                    | rrweb  | inject  | inject  | inject | `captureVisibleTab` (viewport) | inject | No |

Design note (§1, lines 26–27): injection-side network capture is *more* reliable for response
**bodies** than CDP's `Network.getResponseBody`, which can be evicted from cache — the existing
`fetchResponseBody` in `background.js` (lines 128–143) already works around that eviction. So the
portable lane is not merely a fallback; for bodies it is an upgrade.

---

## 2. Ordered implementation steps

### Step 1 — Build the injection capture module (`capture-inject.js`, content script, MAIN world)

New file: `/Users/ian.hogers/projects/openjam/capture-inject.js`.

This is the cross-browser baseline. It runs as a content script and must patch the **page's own**
globals, so it executes in the **MAIN world** at `run_at: "document_start"` (it must install hooks
before page code runs). This is distinct from the Phase 1 rrweb recorder, which runs in the
**ISOLATED world** (design §2, line 43) — rrweb only reads the DOM, but console/fetch/error hooks
must replace the *page's* objects, which the ISOLATED world cannot reach.

Transport across the world boundary: MAIN-world script cannot call `browser.runtime.sendMessage`
directly, so it emits each captured event via `window.postMessage` to a tiny **ISOLATED-world relay**
content script (Step 1e) that forwards to the background via `browser.runtime.sendMessage`. (Phase 1
rrweb in ISOLATED can use `runtime` directly per §2 line 44; only the MAIN-world patches need the
postMessage hop.)

Sub-tasks (each emits an event in the **exact existing schema** — see Step 2 for the schema
contract):

- **1a. Console patch** — wrap `console.log/info/warn/error/debug` (preserve originals, always call
  through). Map method → `level` to match the existing values produced by `onDebuggerEvent`'s
  `Runtime.consoleAPICalled` branch (`background.js` lines 213–224): `log`, `info`, `warning`,
  `error`, `debug` (note CDP emits `warning`, not `warn` — normalize `console.warn` → `level:
  "warning"` so the viewer needs no changes). Serialize args with a safe stringifier (handle
  circular refs, DOM nodes, Errors) producing a single `message` string equivalent to
  `formatRemoteObject(...).join(" ")`. Capture a JS stack via `new Error().stack`, parsed into the
  same `string[]` shape `formatStackTrace` returns (`name — url:line:col`).

- **1b. Network — `fetch` wrapper** — wrap `window.fetch`. Record request (`method`, `url`,
  `requestHeaders`, `requestBody` from the init/`Request`), `await` the real fetch, then read
  `response.status`, `statusText`, `response.headers` (iterate `Headers`), `mimeType` (from
  `content-type`). To read the body **without consuming the page's copy**, clone **before** the page
  reads it: `const probe = response.clone();` and hand the **original** back to the page. **Gate the
  body read on metadata FIRST, before touching the clone's stream:** check `content-type` is texty
  (`/json|text|javascript|xml|html|csv|x-www-form-urlencoded/i`, `background.js` line 131) AND
  `content-length` is present and ≤ `BODY_CAPTURE_MAX_BYTES` (100 KB, `background.js` line 6). Only
  then call `await probe.text()`. **Why the order matters (verified, MDN `Response.clone`):** a cloned
  body buffers in memory at the rate of the *faster* reader — if OpenJam reads the clone while the
  page reads its branch slowly, the browser holds the *entire* response in RAM with no backpressure
  cap. Gating on the `content-length` header *before* reading the clone is what keeps this bounded.
  When `content-length` is **absent** (chunked/streamed), do **not** read the clone — treat as the
  streaming case (Step 1d) and record `responseBody: "[streamed/unknown-length — body not captured]"`.
  Timing from `performance.now()` deltas (start→settle) and
  cross-checked against `PerformanceObserver`/`performance.getEntriesByName(url)` resource timing.
  On rejection set `failed: true`, `errorText`. **Edge cases (see Step 1d).**

- **1c. Network — `XMLHttpRequest` wrapper** — patch `XMLHttpRequest.prototype.open` and `.send`
  to record `method`/`url`/request body, then on `loadend` read `status`, `statusText`,
  `getAllResponseHeaders()` (parse into object), and `responseText` (size/MIME-gated identically to
  1b). Timing via `performance` resource entry for the URL, fallback to `loadstart→loadend` deltas.

- **1d. Network edge cases** (these are first-class requirements, not afterthoughts):
  - **Opaque responses** (`response.type === "opaque"`, i.e. `no-cors` cross-origin): status reads
    as `0`, headers empty, body unreadable. Record the request, mark `detail.opaque = true`,
    `status: 0`, and `responseBody: "[opaque cross-origin response — body unreadable]"`. Do **not**
    attempt `.clone().text()` (throws).
  - **Streaming / `ReadableStream` bodies** (SSE, chunked, large downloads): do **not** buffer the
    stream — that would change page timing/memory and can never terminate (SSE). If
    `content-length` is absent or exceeds `BODY_CAPTURE_MAX_BYTES`, skip the body and set
    `responseBody: "[streamed/oversized — body not captured]"`. Never `tee()` an SSE stream.
  - **`Request`-object first arg** (`fetch(new Request(...))`): read url/method/headers off the
    `Request` instance, not assuming a string URL.
  - **Already-consumed / `bodyUsed`**: always operate on `response.clone()` before the page reads
    it; if `clone()` throws (already used), skip body, keep metadata.
  - **`sendBeacon` and `WebSocket`**: out of scope for Phase 4 baseline; note as a known gap in the
    export's "capture-method" metadata (Step 8).
  - **Aborted requests** (`AbortController`): catch `AbortError`, mark `failed: true`,
    `canceled: true` to mirror `Network.loadingFailed` (`background.js` lines 204–211).

- **1e. ISOLATED-world relay** (`capture-relay.js`) — receives `window.postMessage` events from the
  MAIN-world module, filters by a shared nonce/origin (security: ignore messages not bearing the
  OpenJam tag so page JS can't inject fake events), and forwards via `browser.runtime.sendMessage`.

- **1f. Errors** — `window.addEventListener("error", ...)` (uncaught) and
  `window.addEventListener("unhandledrejection", ...)`. Produce `kind: "error"`, `level: "error"`,
  with `message`, `url`, `line`, `column`, `stack[]` to match the `Runtime.exceptionThrown` branch
  (`background.js` lines 225–243). For `unhandledrejection`, pull `event.reason` (Error → message +
  stack; else stringify).

- **1g. Device info** — read `navigator`/`screen`/`window`/`Intl`/`document` directly in the
  injected script, producing the **identical object** the CDP `captureDeviceInfo` expression builds
  (`background.js` lines 89–112): `userAgent, platform, language, languages, vendor, cookieEnabled,
  online, url, referrer, title, viewport{width,height}, screen{width,height,dpr,colorDepth},
  timezone, memory`. Note `performance.memory` is Chromium-only → emit `memory: null` elsewhere
  (already the documented fallback). Emit once at recording start.

### Step 2 — Capability-detection abstraction so one report schema is produced either way

New file: `/Users/ian.hogers/projects/openjam/capture-core.js` (loaded by the background context).

This is the heart of the pivot. It defines a **CaptureBackend interface** with two implementations
that emit into the **same `pushEvent` pipeline and the same event schema** already established in
`background.js` (`pushEvent`, lines 26–30 → `{ id, rel, t, kind, ... }`; final report shape in
`stopRecording`, lines 316–327):

- **`CdpBackend`** — the existing `background.js` logic, extracted unchanged (the `onDebuggerEvent`
  router + `chrome.debugger.attach`/`sendCmd`). Chromium-only.
- **`InjectionBackend`** — receives the relayed messages from Step 1 via
  `browser.runtime.onMessage` and calls `pushEvent` with identical `kind`/`level`/`detail` fields.

**Capability check** (runtime, not build-time, so a single Chromium build can prefer CDP and still
fall back):

```
const hasCDP = typeof browser !== "undefined"
            && !!browser.debugger
            && typeof browser.debugger.attach === "function";
```

This works because the polyfill **wraps** `chrome.debugger` under `browser.debugger` on Chromium, but
is a **NO-OP on Firefox** (verified: it never fabricates namespaces Firefox lacks) — so
`browser.debugger` is `undefined` on Firefox/Safari and `hasCDP === false` there. (Equivalently, test
`chrome.debugger` directly; both resolve identically on Chromium.)

Selection policy:
- `hasCDP === true` (Chromium): **always run InjectionBackend as the baseline**, and additionally
  attach `CdpBackend` as an *enhancement* for full-page screenshots + richer bodies/timing (design
  §1 enhancement column). To avoid double-counting, when CDP is active, mark injection-captured
  console/network/error events `detail.source = "inject"` and CDP ones `detail.source = "cdp"`, and
  pick **one authoritative lane per signal** (default: CDP for console/network/errors on Chromium
  for backward-compat with Phases 1–3; injection for the screenshot fallback + body reliability).
  The other lane is suppressed from the timeline but its presence proves parity (Step 9).
- `hasCDP === false` (Firefox/Safari): **InjectionBackend only.** No `chrome.debugger` call is ever
  made — this is the explicit done-bar.

Critically: `chrome.debugger` must **never be a hard dependency**. Today `startRecording`
(`background.js` lines 285–289) *aborts the whole session* if `attach` fails. The refactor moves
debugger attach behind `if (hasCDP)`; failure to attach degrades to injection-only, never aborts.

### Step 3 — Screenshots: portable fallback

- Portable: `browser.tabs.captureVisibleTab(windowId, { format: "png" })` (viewport only) — replaces
  the CDP `Page.captureScreenshot` call in `captureScreenshot` (`background.js` lines 114–126) when
  `!hasCDP`. Requires `activeTab`/`<all_urls>` (already in `manifest.json` line 6–7) and `"tabs"`.
- Chromium enhancement: keep `Page.captureScreenshot` with `captureBeyondViewport` for full-page +
  clip (design §1, line 23; §5 hybrid keyframes from Phase 3).
- Both paths emit the same `kind: "screenshot"`, `detail.image` data-URL shape.
- Note for export metadata: on Firefox/Safari, all screenshots are **viewport-only**; the player
  badge from Phase 3 should reflect reduced fidelity.

### Step 4 — Adopt `webextension-polyfill` + `browser.*` namespace

- Vendor `webextension-polyfill` (Mozilla, MIT) into the extension — **bundled, not CDN** (MV3
  remote-code ban, design §2 line 46). Add `browser-polyfill.min.js`.
- Convert all `chrome.*` call sites to `browser.*` (promise-based): `background.js`, `popup.js`,
  `viewer.js`, the Phase 1 recorder. The polyfill makes `chrome.*` callback APIs return promises on
  Chromium and provides `browser.*` on Firefox/Safari; Firefox/Safari already expose native
  `browser.*` promises.
- Load order: the polyfill script must be listed **before** other scripts in the event-page
  `background.scripts` array (Step 5) and before content scripts that use `browser.*`.
- **Bundling caveat (verified):** the polyfill is UMD and its global-context detection uses `this`,
  which is `undefined` inside an ES module / strict IIFE — importing it as an ESM under a bundler can
  throw `TypeError: can't access property "runtime" of undefined`. Because the Firefox/Safari
  background is a **classic (non-module) event page** (Step 5), list `browser-polyfill.min.js` as a
  **separate plain `<script>`/`scripts[]` entry** (it assigns the global `browser`) rather than
  `import`-ing it into a bundled module. Same for content scripts: load the polyfill as its own
  `js[]` entry before the script that uses `browser.*`. (On Chromium the existing `background.js`
  service worker is `type:"module"` — there, import the npm package, which is the supported ESM path,
  OR keep the classic global approach uniformly; do not mix `this`-based UMD into an ESM entry.)

### Step 5 — Per-target manifest / build strategy

**Decision: build-time per-target manifests** (not one universal manifest). Rationale: the
`background` key is structurally incompatible between targets and cannot be expressed in one file —
Chromium MV3 requires `"service_worker"`; Firefox/Safari MV3 use an **event page**
`"background": { "scripts": [...] }` (design §1, lines 31–33). A single manifest cannot satisfy both.

Approach: keep a `manifest.base.json` + small per-target overlay JSON + a tiny build script
(`build.mjs`) that merges and writes `dist/<target>/manifest.json`. Targets: `chromium`, `firefox`,
`safari`.

Per-target differences:

| Manifest key            | Chromium                                  | Firefox                                              | Safari                                    |
|-------------------------|-------------------------------------------|------------------------------------------------------|-------------------------------------------|
| `background`            | `{ "service_worker": "background.js", "type": "module" }` | `{ "scripts": ["browser-polyfill.min.js","background.js"] }` (event page; Firefox does **not** support `background.service_worker` — [bug 1573659](https://bugzil.la/1573659)) | `{ "scripts": ["browser-polyfill.min.js","background.js"] }` (Safari supports both `scripts` and `service_worker`, but **no `type:"module"`** — bundle to one classic script via esbuild; the converter keeps `scripts`) |
| `permissions`           | `["debugger","tabs","storage","activeTab","unlimitedStorage"]` | drop `"debugger"`; keep rest | drop `"debugger"`; `unlimitedStorage` n/a on iOS — keep, harmless |
| `browser_specific_settings` | — | `{ "gecko": { "id": "openjam@openjam.dev", "strict_min_version": "128.0" } }` | — (Xcode bundle id instead) |
| `content_scripts`       | rrweb (ISOLATED) + `capture-inject.js` (`world:"MAIN"`) + `capture-relay.js` (ISOLATED) | rrweb (ISOLATED) + `capture-inject.js` (`world:"MAIN"`, Firefox ≥ 128) + `capture-relay.js` (ISOLATED) | rrweb (ISOLATED) + `capture-relay.js` (ISOLATED) **only**; `capture-inject.js` injected **programmatically** by the relay (Safari static manifest `world:"MAIN"` unsupported — see note) |

Notes:
- Add `"unlimitedStorage"` (design §3, line 67) — required by Phase 1 IndexedDB but list it here as
  part of the manifest sweep.
- `content_scripts[].world` — declarative `"MAIN"` for `capture-inject.js` is supported in
  **Chromium** (`content_scripts` since Chrome 111) and **Firefox ≥ 128** (landed in the Fx128 MV3
  update; MAIN-world content scripts have **no** WebExtension API access — confirming the
  postMessage→ISOLATED relay in Step 1e is mandatory, not optional). **Safari does NOT support
  `world:"MAIN"` in the static `content_scripts` manifest** — only via the
  `scripting.registerContentScripts` API (since Safari 16.4), and even that is unreliable on desktop.
  Therefore for **Safari (always)** and **Firefox < 128**, the MAIN-world hooks must be installed by
  **programmatic page-context `<script>` injection** from the ISOLATED relay at `document_start`
  (the relay creates a `<script>` element whose `textContent` is the `capture-inject.js` source and
  appends it to `document.documentElement`). The build emits the declarative `world:"MAIN"` key
  **only for Chromium and Firefox ≥ 128**; the relay's script-tag injection is the baseline path for
  every other target. Because the relay already exists for transport (Step 1e), making it also the
  injector for the no-declarative-MAIN targets adds no new file. **Caveat:** the page-script-injection
  fallback means `capture-inject.js` must be shippable as a standalone string the relay can inline —
  the build should emit it both as a content-script asset (declarative targets) and as an
  importable string/`web_accessible_resources` URL the relay fetches and injects (fallback targets).
- The Firefox event page is **non-persistent** (terminates when idle) — see Risks (Step 10): the
  background must hold no in-memory buffer (it already orchestrates only; the rrweb buffer lives in
  the content script per design §3 line 68 — preserve that invariant for injection events too by
  persisting to IndexedDB as they arrive, not accumulating in `session.events` in RAM).

### Step 6 — Firefox load + test (`about:debugging`)

1. `node build.mjs firefox` → `dist/firefox/`.
2. Firefox → `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select
   `dist/firefox/manifest.json`.
3. Confirm no manifest errors (event page recognized, no `debugger` permission warning).
4. Open a test page, click the OpenJam action, **Start**, interact (click, type, trigger a
   `console.log`, fire a `fetch`, throw an uncaught error), **Stop**.
5. The viewer opens (`viewer.html?key=...`); confirm console + network + errors + rrweb replay are
   all present and that **no `chrome.debugger` banner ever appeared** (Firefox can't show one — its
   absence is the proof the injection lane carried the session).
6. Export the self-contained HTML; open the exported `file://` HTML in a fresh tab and confirm the
   rrweb player + timeline render offline.

### Step 7 — Safari conversion (`xcrun safari-web-extension-converter`)

1. `node build.mjs safari` → `dist/safari/`.
2. On a Mac with Xcode: `xcrun safari-web-extension-converter dist/safari/ --project-location
   build/safari-xcode --bundle-identifier dev.openjam.extension` → generates an Xcode project
   wrapping the web extension.
3. Open in Xcode, build & run; enable the extension in Safari → Settings → Extensions; allow on
   `<all_urls>`.
4. Record a session as in Step 6.
5. **Document Safari API gaps explicitly** (design §1, line 34): no CDP/`debugger`; **`webRequest` is
   unusable for capture** — a non-persistent MV3 background page (the only option here) **cannot
   register `webRequest` listeners** (Safari surfaces "An extension with a non-persistent background
   page cannot listen to webRequest events"), so the fetch/XHR injection lane is the *only* network
   source — there is no fallback; **no DevTools panels on iOS**; screenshots are **viewport-only**
   (`tabs.captureVisibleTab`, and on iOS 16/17 it can crop while scrolling — known Apple bug). These
   are expected, not bugs.
6. Note: Safari requires a Mac + Xcode to build/sign; it cannot be validated on the Linux/Firefox
   dogfood path. Treat Safari as "code-complete + converts cleanly + manual Mac verification" for
   this phase.

### Step 8 — Export metadata: record which mechanism captured the session

Extend the report `meta` (built in `stopRecording`, `background.js` lines 316–324) with
`captureMethod: { browser, replay: "rrweb", console, network, errors, screenshots, device }` where
each value is `"inject"` or `"cdp"`. Surface a small badge in the viewer/export so a reader knows a
Firefox report is injection-captured (and that screenshots are viewport-only). This also feeds the
parity audit (Step 9).

---

## 3. DOGFOOD verification (the done-bar)

**Primary bar — Firefox, no `chrome.debugger`:**
1. `node build.mjs firefox`, load via `about:debugging` (Step 6).
2. Record a *real* session on a real site: generate at least one `console.log`, one `console.error`,
   one successful `fetch`, one failing/aborted request, and one uncaught exception; move the mouse
   and click so rrweb has mutations.
3. Stop → viewer opens. **Confirm all four signals + rrweb replay are present**, captured purely via
   injection (verify by code path: `hasCDP === false` on Firefox, so `CdpBackend` is never
   constructed and `browser.debugger` is `undefined`).
4. Export the HTML; open the exported file offline; confirm the rrweb player plays back and the
   timeline shows console/network/error events.
5. Success statement to assert verbatim: **"I recorded a real session in Firefox"** — only claim it
   after steps 1–4 are observed, not inferred (VerificationBeforeCompletion).

**Secondary — Chromium regression:** same session on Chromium; confirm Phases 1–3 still pass
(CDP enhancement still attaches, full-page screenshots present), proving the injection baseline
didn't regress the existing path.

**Safari:** code-complete + `safari-web-extension-converter` produces a building Xcode project;
manual record/replay verification **requires a Mac + Xcode** and is performed there (Step 7). Do not
claim Safari "works" from the Firefox/Linux environment.

---

## 4. Risks & mitigations

1. **Behavioral parity between CDP and injection capture.** Injection sees JS-level console/network/
   errors but **misses** what only the browser engine sees: `console` calls from other extensions,
   network from the browser itself / preloads / `<img>`/`<link>` subresource loads not going through
   `fetch`/XHR, and CSP-violation reports. *Mitigation:* run **both** lanes on Chromium during a
   verification window and diff (Step 8 `source` tags); document known-missing categories in the
   export metadata; accept subresource gaps as expected for the portable baseline (rrweb still
   captures the visual result).

2. **`fetch`/XHR wrapping edge cases** (Step 1d): streaming/SSE (never buffer — would hang or change
   memory), opaque `no-cors` responses (unreadable — mark, don't throw), `Request`-object args,
   `bodyUsed`/double-read (always `clone()` first), aborted requests, `sendBeacon`/`WebSocket` (out
   of scope, declared as gaps). *Mitigation:* explicit handling per case + size/MIME gating reusing
   `BODY_CAPTURE_MAX_BYTES` and the texty-MIME regex (`background.js` lines 6, 131); fail safe to
   metadata-only, never break the page's own request.

3. **Event-page lifetime (Firefox/Safari).** The non-persistent event page terminates when idle, so
   it must hold **no recording buffer in memory** — anything in `session.events` (RAM) is lost on
   suspend. *Mitigation:* mirror the Phase 1 invariant (design §3, lines 64–68): rrweb buffer lives
   in the content script + IndexedDB; injection events must likewise be **persisted to IndexedDB as
   they arrive**, with the background acting only as an orchestrating relay. Re-validate that the
   message listener and recording flags survive a background suspend/wake cycle.

4. **Safari API gaps.** No CDP, **no `webRequest`** (injection is the sole network source — no
   safety net), no DevTools panels on iOS, viewport-only screenshots, Mac+Xcode required to build.
   *Mitigation:* the injection baseline is designed to be the only requirement; document gaps in the
   export metadata (Step 8); scope Safari to "converts + builds + manual Mac verification" this
   phase.

5. **MAIN-world injection portability.** `content_scripts[].world: "MAIN"` is unsupported on older
   Firefox and on Safari. *Mitigation:* programmatic page-context `<script>` injection from the
   ISOLATED relay at `document_start` as the fallback (Step 5 note); feature-detect and prefer the
   declarative `world` key where available.

6. **`console.warn` level mismatch.** CDP emits `level: "warning"`; naive injection would emit
   `"warn"`, silently breaking viewer filtering. *Mitigation:* normalize in Step 1a (explicit map).

7. **Timestamp alignment.** Injection uses `Date.now()` directly — which is *simpler* than CDP's
   monotonic clock that `background.js` corrects via `monoOffset` (lines 36–39, 152–155) and aligns
   natively with rrweb's `Date.now()` epoch-ms (design §2, line 42). *No offset correction needed on
   the injection path* — but ensure the `CdpBackend` keeps its correction so mixed Chromium sessions
   stay aligned.

---

## 5. Out of scope for Phase 4

- Re-porting rrweb (already portable; Phase 1).
- `WebSocket` / `sendBeacon` / subresource network capture (declared gaps).
- Cross-origin iframe capture (design §5 — impossible offline; Phase 3 keyframes mitigate on
  Chromium only).
- iOS Safari DevTools-panel parity (does not exist).

---

## 6. File touch list (for the build step that follows this plan)

- **New:** `capture-inject.js` (MAIN-world hooks), `capture-relay.js` (ISOLATED relay),
  `capture-core.js` (CaptureBackend interface + capability check + Cdp/Injection backends),
  `browser-polyfill.min.js` (vendored), `manifest.base.json`, `manifest.firefox.json`,
  `manifest.safari.json`, `build.mjs`.
- **Modified:** `background.js` (extract CDP logic into `CdpBackend`, gate debugger behind `hasCDP`,
  stop aborting on attach failure, persist injection events to IndexedDB, add `captureMethod` meta),
  `popup.js` / `viewer.js` (→ `browser.*`), `manifest.json` (becomes the Chromium overlay or is
  replaced by per-target output under `dist/`).
- **Reused unchanged:** the report event schema (`pushEvent`), `BODY_CAPTURE_MAX_BYTES` + texty-MIME
  regex, the Phase 1 rrweb recorder.

---

## Verification (adversarial pass, 2026-06-09)

Each premise was checked against current primary sources (MDN, Mozilla bugzilla/blog, Apple developer
docs/forums, the webextension-polyfill repo). `CONFIRMED` = claim stands as written; `CORRECTED` =
plan was wrong/ambiguous and was edited inline above; `STILL-UNVERIFIABLE` = needs runtime check.

1. **`chrome.debugger` absent on Firefox & Safari (the whole premise).** **CONFIRMED.** Firefox never
   implemented it; tracking bug is open/unresolved with no timeline.
   https://bugzilla.mozilla.org/show_bug.cgi?id=1316741 (and meta
   https://bugzilla.mozilla.org/show_bug.cgi?id=1323098). Safari has no `chrome.debugger`/CDP
   extension surface (not in Apple's web-extension API set):
   https://developer.apple.com/documentation/safariservices/safari-web-extensions . No change needed.

2. **MAIN-world relay requirement.** **CONFIRMED + CORRECTED.** MAIN-world content scripts have **no
   WebExtension API access** ("content scripts executed in the MAIN world do not have access to any
   WebExtension APIs"), so the postMessage→ISOLATED relay (Step 1e) is mandatory — confirmed and
   made explicit in Step 5. https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/
   · https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts
   **CORRECTED:** declarative `world:"MAIN"` support — Chrome ≥ 111, **Firefox ≥ 128** (not 121/115),
   and **Safari does NOT support it in the static manifest** (only via `scripting.registerContentScripts`
   since 16.4, unreliable on desktop): https://developer.apple.com/forums/thread/728849 . The plan's
   own manifest table had set `strict_min_version: "115.0"` (a 13-version contradiction with its
   "Firefox ≥ 128" note) and listed Safari static MAIN as `same` — both fixed: floor raised to
   `128.0`, Safari (always) + Firefox < 128 now route through programmatic page-`<script>` injection
   from the relay as the **baseline**, not a footnote.

3. **Per-target manifest.** **CONFIRMED + CORRECTED.** Firefox does **not** support
   `background.service_worker` and requires event-page `background.scripts` +
   `browser_specific_settings.gecko.id`: https://bugzil.la/1573659 ·
   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background .
   Service-worker background is effectively rejected/ignored on Firefox — CONFIRMED. **CORRECTED
   nuance:** Safari supports **both** `background.scripts` and `background.service_worker` (it is not
   forced to event-page), but has **no `type:"module"`** — must bundle to one classic script; added to
   the table. `xcrun safari-web-extension-converter <dir> --bundle-identifier <id> --project-location
   <path>` flags confirmed: https://developer.apple.com/documentation/safariservices/converting-a-web-extension-for-safari .

4. **fetch/XHR wrapping edge cases.** **CONFIRMED + CORRECTED.** Opaque/`no-cors`, `Request`-object
   args, `bodyUsed`, abort, SSE-never-tee were already handled. **CORRECTED a real memory bug:** the
   plan said "clone to read body without consuming the page's copy" but did not order the size-gate
   before the read. Per MDN `Response.clone`, a cloned body buffers in memory at the *faster* reader's
   rate with **no backpressure cap** — reading the clone of a large/slow page response can hold the
   entire body in RAM. Step 1b now gates on a present `content-length ≤ 100 KB` **before** reading the
   clone, and treats absent `content-length` (chunked) as the streaming/skip case.
   https://developer.mozilla.org/en-US/docs/Web/API/Response/clone

5. **`tabs.captureVisibleTab` portable screenshot fallback.** **CONFIRMED.** Available in Firefox &
   Safari, **viewport-only** by design (full-page capture is an unimplemented request, bug 1346651);
   needs `activeTab`/host permission + `"tabs"`. Known iOS 16/17 cropping-while-scrolling bug noted.
   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureVisibleTab ·
   https://bugzilla.mozilla.org/show_bug.cgi?id=1346651

6. **webextension-polyfill.** **CONFIRMED + CORRECTED.** Still the Mozilla-recommended cross-browser
   approach; NO-OP on Firefox/Safari, wraps callback APIs to promises on Chromium. https://github.com/mozilla/webextension-polyfill
   **CORRECTED:** added the UMD-`this`/`globalThis` bundling caveat — importing it into an ESM entry
   throws `TypeError`; load it as a separate classic `<script>`/`js[]`/`scripts[]` entry. https://github.com/mozilla/webextension-polyfill/issues/202

**Additional internal-consistency fix:** the capability check `browser.debugger.attach` is sound
because the polyfill wraps `chrome.debugger`→`browser.debugger` on Chromium and adds nothing on
Firefox (so it is `undefined` there) — annotated in Step 2.

**Safari webRequest framing (CORRECTED nuance):** Safari is not "no webRequest" per se — it has
observational webRequest, but a **non-persistent MV3 background cannot register webRequest listeners**
("An extension with a non-persistent background page cannot listen to webRequest events"). The
plan's conclusion (injection is the only viable network source on Safari) is unchanged and correct;
wording tightened in Step 7. https://github.com/w3c/webextensions/issues/151

**STILL-UNVERIFIABLE (runtime checks for the build step):**
- The exact behavior of `world:"MAIN"` declarative key on the *installed* Firefox 128 build vs the
  programmatic-injection fallback — verify by loading via `about:debugging` (the dogfood already does
  this; the no-`chrome.debugger` proof holds since the namespace cannot exist on Firefox).
- Whether `scripting.registerContentScripts({world:"MAIN"})` works on the target desktop Safari
  version, or whether the page-`<script>` injection is required there too (plan now defaults Safari to
  page-`<script>` injection, so this is de-risked).

### Verdict: **PASS-WITH-FIXES**

The architectural premise (pivot off CDP to injection; CDP as Chromium-only enhancement) is sound and
fully supported by sources. The dogfood bar ("recorded a real session in Firefox via about:debugging,
no chrome.debugger") is valid and executable.

**Top 3 corrections applied:**
1. `strict_min_version: "115.0"` → `"128.0"` — MAIN-world content scripts require Firefox 128; the
   plan internally contradicted itself (115 in the table vs "≥128" in the note). A 115 ESR build would
   silently drop the MAIN-world injection and capture nothing on the injection lane.
2. Safari MAIN-world via static `content_scripts` is **unsupported** — the matrix wrongly listed it as
   `same`. Safari (and Firefox < 128) now route MAIN-world hooks through programmatic page-`<script>`
   injection from the relay as the baseline path, not a footnote.
3. `response.clone()` body capture had an unbounded-memory bug — gating moved to *before* reading the
   clone (require `content-length ≤ 100 KB`), preventing whole-response RAM buffering on slow/large
   responses.

**Residual risks:**
- The page-`<script>` injection fallback requires `capture-inject.js` to be shippable as an inlinable
  string / `web_accessible_resources` URL; the build must emit it in both forms (now noted in Step 5).
  If overlooked, Safari captures nothing.
- Behavioral parity gap between CDP and injection (subresource loads, other-extension console, CSP
  reports) is real and only documented, not closed — acceptable for the portable baseline but means a
  Firefox report is genuinely lower-fidelity than a Chromium CDP one.
- Safari remains unverifiable from the Linux/Firefox dogfood path (Mac+Xcode required); the plan
  correctly scopes it to "converts + builds + manual Mac verification" and does not over-claim.
