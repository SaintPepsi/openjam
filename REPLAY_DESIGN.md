# OpenJam — Full Session Replay: Design & Requirements

Synthesized from four parallel research streams (2026-06-09). Every claim is cited in the
source streams; key URLs inlined below.

## 1. The architectural pivot

OpenJam currently captures console/network/errors/screenshots/device entirely through
`chrome.debugger` (CDP) in `background.js`. CDP is **Chromium-exclusive**:

- Firefox: never implemented `chrome.debugger` ([bug 1316741](https://bugzil.la/1316741)); no extension-level CDP.
- Safari: no CDP transport, no `debugger` permission, and `webRequest` is unavailable on MV3.

rrweb runs as injected page JS, which is portable everywhere. **Decision: page-injection
becomes the capture foundation; CDP becomes a Chromium-only enhancement.**

| Capability | Portable mechanism (all browsers) | Chromium-only enhancement (CDP) |
|---|---|---|
| Session replay | rrweb in content script | — |
| Console | patch `console.*` in injected script | `Runtime.consoleAPICalled` (richer stacks) |
| Network | wrap `fetch` + `XMLHttpRequest` | `Network.*` (full bodies/timing/cache) |
| Errors | `window.onerror` + `unhandledrejection` | `Runtime.exceptionThrown` |
| Screenshots | `tabs.captureVisibleTab` (viewport only) | `Page.captureScreenshot` (full-page, clip) |
| Device info | read `navigator`/`screen` in injected script | `Runtime.evaluate` |

Injection-side network capture is actually *more* reliable for bodies than CDP's
`Network.getResponseBody` (which can be evicted — a path `fetchResponseBody` already handles).

### Browser reach
- **Chromium (Chrome/Edge/Brave/Opera/Vivaldi):** everything, including CDP polish. Runs today.
- **Firefox:** rrweb + injection capture. Needs `webextension-polyfill`, `browser.*`, and an
  **event-page** background (`"background": { "scripts": [...] }`) instead of a service worker.
- **Safari:** rrweb + injection capture via `xcrun safari-web-extension-converter`. No CDP, no
  webRequest, no DevTools panels on iOS.

## 2. rrweb specifics (verified against npm registry + GitHub source)

- Pin **`rrweb@2.0.1`** + **`rrweb-player@2.0.1`** (both MIT). Ignore stale web results citing
  `1.0.0-alpha.4` / `2.0.0-alpha.*` — registry `dist-tags.latest` is `2.0.1`. `rrweb-player`
  ships a **UMD build** (`dist/rrweb-player.umd.cjs`) — this is what we inline into the export.
- rrweb timestamps are `Date.now()` epoch-ms → **align directly** with OpenJam's `t`/`capturedAt`
  (no offset correction, unlike CDP's monotonic clock which `background.js` already corrects).
- Inject via **ISOLATED-world** content script at `run_at: "document_start"`; relay events with
  `chrome.runtime.sendMessage` (no postMessage bridge needed — ISOLATED has `chrome.runtime`).
- **No conflict** with an active `chrome.debugger` session — different layers.
- MV3 forbids remote code → **bundle rrweb into the extension**, never CDN-load.

## 3. Bounded memory (the "no RAM drain" guarantee)

Sizes (PostHog measurements): FullSnapshot ≈ **263 KB** (~10× the page HTML); incremental events
avg ~2.8 KB/batch; mousemove ~309 B and already double-throttled (20ms/500ms). Budget raw events
at **~0.2–1 MB/min worst case**. Replay cost scales with **mutation volume, not duration**.

**Segment ring buffer** (each segment = `[FullSnapshot, ...deltas]`):
- `record({ checkoutEveryNms: 60_000 })` forces a fresh FullSnapshot every 60s; `emit` fires with
  `isCheckout === true` → start a new segment.
- Trim only **whole leading segments** older than the window, and only if `segments[1]` exists
  (so you never orphan the FullSnapshot the remaining deltas depend on). This is Sentry's
  discard-on-checkout rule.
- Memory bound ≤ `(window/checkout + 1) × segment_size`. 5-min window + 60s checkout ≈ 6 segments
  ≈ low single-digit MB, **capped regardless of session length**. Full-session = `window = Infinity`
  (disk-backed, see below).

**Storage / MV3 survival:**
- Run `record()` in the **content script** (the SW has no DOM and is killed after 30s idle / 5min).
- Persist segments to **IndexedDB** (append-only, `(tabId, segmentIndex)` keys). Add
  **`"unlimitedStorage"`** to manifest permissions (`chrome.storage.local` is only 10 MB).
- Service worker orchestrates only (start/stop/messaging) — never holds the buffer.

**Compression:** rrweb `@rrweb/packer` (fflate). Compress the **whole session once** on export
(better ratio than per-event), inline as **base64**, bundle `unpack` in the export.

## 4. Recommended record() config

```js
rrweb.record({
  emit,                              // → segment ring buffer → IndexedDB
  checkoutEveryNms: 60_000,          // recovery anchors + trim granularity
  sampling: { mousemove: 50, scroll: 150, media: 800, input: 'last' },
  slimDOMOptions: { script: true, comment: true, headFavicon: true, headWhitespace: true,
                    headMetaDescKeywords: true, headMetaSocial: true, headMetaRobots: true,
                    headMetaHttpEquiv: true, headMetaAuthorship: true, headMetaVerification: true },
  inlineStylesheet: true,            // offline-correct (rrweb 2.0: prefer captureAssets)
  inlineImages: true,                // MUST be on for offline export (default false)
  maskAllInputs: true,               // PII default; explicit per-capture unmask opt-in
  recordCanvas: false,               // flip on only for canvas-heavy pages (+ webgl plugin)
  dataURLOptions: { type: 'image/webp', quality: 0.6 },
  recordCrossOriginIframes: false,   // unusable from host page; pixel keyframes cover it
  packFn: pack,
});
```

## 5. Fidelity gaps & the hybrid

DOM replay reconstructs the DOM, not pixels. Hard gaps (offline): **canvas/WebGL** (opt-in, lossy),
**`<video>`/`<audio>`** (state not frames), **cross-origin iframes** (same-origin policy → replay
blank — impossible without injecting the child), CORS-blocked stylesheets/images.

**Hybrid = rrweb base + CDP pixel keyframes** (Chromium only, where bugs hide):
- `Page.captureScreenshot` on: start/stop, route change, each checkout, debounced large-mutation
  bursts, user-marked "this is the bug" moments, and when canvas/WebGL/video/cross-origin-iframe
  is in viewport. Event-driven, not continuous screencast → cheap.
- Player overlays the nearest keyframe (clipped to the element box) over unreliable regions; badge
  it as "pixel keyframe". Keyframes embed as base64 alongside the event JSON.
- Ship rrweb-only as the default; gate keyframes on detection + marked moments.

**Corruption guards:** ensure FullSnapshot is the first event; take snapshot synchronously before
observers; wrap mutation application in try/catch and re-anchor to nearest keyframe / next
checkout on error; count & log CORS-dropped assets into the export.

## 6. Self-contained export

The current `report-builder.js` inlines a JSON `<script>` blob + renderer via `toString` (works
because the file is `file://`, no CSP). Extend it:
- Inline `rrweb-player.umd.cjs` (UMD global) — measure real minified size (~120–250 KB) before
  shipping; gate the player on `rrwebEvents.length > 1`.
- Inline events as **fflate-compressed base64** (not raw JSON — 50 MB of inline JSON chokes
  browsers); bundle `unpack`; default export to the bounded window, "full session" as opt-in.
- Lazy-init the player on click; seek via segment keyframes.
- Wire `ui-update-current-time` ↔ OpenJam timeline highlight (both clocks are `Date.now()`).

## 7. Phased plan

- **Phase 1 — rrweb capture + replay (Chromium):** content-script recorder (ISOLATED,
  document_start), segment ring buffer, IndexedDB + `unlimitedStorage`, in-extension
  `rrweb-player` in `viewer.js`, sync to existing timeline. *Delivers true replay.*
- **Phase 2 — self-contained replay export:** inline UMD player + fflate base64 events into
  `report-builder.js`. *Delivers shareable replay file.*
- **Phase 3 — hybrid pixel keyframes:** CDP `Page.captureScreenshot` lane for canvas/WebGL/
  video/cross-origin gaps, player overlay.
- **Phase 4 — cross-browser:** port capture to injection (console/fetch/onerror), add
  `webextension-polyfill` + `browser.*`, dual background key, Firefox load + Safari conversion.

## Key sources
- rrweb: https://github.com/rrweb-io/rrweb · registry https://registry.npmjs.org/rrweb · player https://registry.npmjs.org/rrweb-player
- storage/perf recipe: https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/optimize-storage.md
- Sentry rolling buffer: https://github.com/getsentry/sentry-javascript/issues/6908
- PostHog perf benchmark: https://posthog.com/blog/session-recording-performance
- MV3 SW lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- chrome.debugger (Chromium-only): https://developer.chrome.com/docs/extensions/reference/api/debugger · FF bug https://bugzil.la/1316741
- content scripts (world/run_at): https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
- Safari web extensions: https://developer.apple.com/documentation/safariservices/safari-web-extensions
- cross-origin iframes: https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/cross-origin-iframes.md
- Vivaldi MV3: https://vivaldi.com/blog/manifest-v3-update-vivaldi-is-future-proofed-with-its-built-in-functionality/
