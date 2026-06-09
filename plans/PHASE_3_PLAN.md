# Phase 3 — Hybrid rrweb + CDP Pixel Keyframes (Implementation Plan)

> Status: PLAN ONLY. Do not implement from this document without sign-off.
> Authoritative source: `REPLAY_DESIGN.md` (esp. §5 "Fidelity gaps & the hybrid").
> Scope: Chromium-only enhancement. Firefox/Safari (Phase 4) get rrweb-only replay and
> simply omit the pixel lane.

---

## 0. Dependency on Phases 1–2 (HARD PREREQUISITE)

This plan assumes the following already exist and are working. **Do not start Phase 3 until each
is verified.**

- **Phase 1 (rrweb capture + in-extension replay):**
  - A content script (ISOLATED world, `run_at: "document_start"`) running `rrweb.record()` per
    `REPLAY_DESIGN.md §4`, relaying events to the background via `chrome.runtime.sendMessage`.
  - Segment ring buffer + IndexedDB persistence (`§3`), `"unlimitedStorage"` in `manifest.json`.
  - `viewer.js` hosts an in-extension `rrweb-player` and syncs to the existing `Date.now()`
    timeline rendered by `renderer.js`.
- **Phase 2 (self-contained export):**
  - `report-builder.js` inlines the UMD `rrweb-player` + fflate-compressed base64 events.
- **Report contract:** `report` objects carry **`report.rrwebEvents`** (the captured rrweb stream)
  alongside the existing `report.events` unified timeline and `report.meta` (`stopRecording()` in
  `background.js`, lines 316–327).

If `report.rrwebEvents` does not exist yet, STOP — Phase 3 has nothing to overlay onto.

**Files Phase 3 will touch:** `background.js`, the Phase-1 content script (new keyframe-detection
logic), `manifest.json` (no new perms — `debugger`/`<all_urls>` already present, lines 6–7),
`renderer.js` (overlay rendering — embedded verbatim into export so it must stay self-contained),
`viewer.js` (in-extension overlay host), `report-builder.js` (keyframe embedding).

---

## 1. The fundamental constraint (why this phase exists)

DOM replay reconstructs the **DOM**, not **pixels**. `REPLAY_DESIGN.md §5` enumerates the hard
gaps that are unrecoverable offline from rrweb alone:

1. **canvas / WebGL** — `recordCanvas` is opt-in and lossy; live GPU output is not in the DOM.
2. **`<video>` / `<audio>`** — rrweb records element *state*, not decoded frames.
3. **cross-origin iframes** — same-origin policy means the host page cannot read the child;
   `recordCrossOriginIframes: false` (§4) → **replay renders blank**.
4. **CORS-blocked stylesheets / images** — visuals the host JS cannot serialize.

The keyframe lane does not try to *fix* DOM replay. It captures **ground-truth pixels** at
moments where DOM replay is known-unreliable, and the player **overlays** those pixels over the
suspect region. rrweb stays the base layer; keyframes are sparse, event-driven patches.

**Design principle (bounded cost):** keyframes are *event-driven, NOT a continuous screencast*
(`§5`). Every trigger is rate-limited and the session is capped by a global frame budget so cost
stays bounded regardless of session length — the same discipline as the §3 memory bound.

---

## 2. Data model — the pixel keyframe marker

A keyframe is a marker interleaved on the **existing `Date.now()` timeline** (the same clock as
rrweb and `pushEvent` in `background.js`, line 27). Shape:

```
{
  t: <Date.now() epoch ms>,        // aligns with rrweb + report.events (no offset; §2)
  kind: "pixel",                    // new event kind, alongside console/network/error/log/screenshot
  reason: "start" | "stop" | "route" | "checkout" | "mutation-burst" |
          "user-mark" | "unreliable-region",
  rect: { x, y, width, height, dpr, scrollX, scrollY } | null,   // CSS px; x/y are VIEWPORT-relative
                                                                 // (getBoundingClientRect); scrollX/scrollY
                                                                 // let the background convert to the
                                                                 // DOCUMENT-relative coords CDP clip needs.
                                                                 // null = full viewport. (see §4.1 / Verification #3)
  selector: <string> | null,        // best-effort CSS path of the unreliable element (overlay anchor)
  regionKind: "canvas" | "webgl" | "video" | "xorigin-iframe" | null,
  dataURL: "data:image/webp;base64,..."        // the captured pixels
}
```

- `kind: "pixel"` makes keyframes first-class timeline events: they already flow through
  `report.events`, the `renderer.js` sort (line 51) and filter chips (line 54) for free. Add
  `"pixel"` to the `KINDS` array and `active` map in `renderer.js`.
- `rect` enables **clipped** screenshots via CDP `Page.captureScreenshot`'s `clip` param — only
  grab the suspect box, not the whole viewport, to control size (§4 risk).
- **CORRECTED — image format.** CDP's `quality` param is documented **"jpeg only"**
  (https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot). WebP
  quality is honored only inconsistently across Chromium versions (it was bolted on later and some
  wrappers still treat quality as jpeg-only). The existing `captureScreenshot` uses **PNG** (which
  ignores `quality` entirely). To get a real, size-controlled lossy frame, the keyframe lane uses
  **`format: "jpeg", quality: 60`** (reliable, well-supported, honors quality). WebP is NOT a safe
  way to hit a size target via `quality` here. Note this does NOT match rrweb's `dataURLOptions`
  (`image/webp` @0.6) — that controls rrweb's *internal* canvas snapshots, a separate path, so
  "parity" was never required. (see Verification #1)

---

## 3. Content-script detection logic (the "where are the gaps?" sensor)

The content script (from Phase 1) already runs in every frame at `document_start`. Add a
**region detector** that finds unreliable elements and signals the background to grab a keyframe.

### 3.1 What to detect

- `canvas` elements (covers both 2D and WebGL contexts).
- WebGL specifically: a `canvas` whose `getContext('webgl' | 'webgl2' | 'experimental-webgl')`
  has been obtained. Detect by patching `HTMLCanvasElement.prototype.getContext` at
  `document_start` to tag the element (`el.__openjamWebGL = true`) — running before page scripts
  is why ISOLATED + `document_start` matters.
- `video` and `audio` elements (treat playing `<video>` as unreliable; `<audio>` has no pixels but
  flag state-change moments).
- **cross-origin iframes:** an `<iframe>` whose `src` origin ≠ `location.origin`. Detect by URL
  comparison (cannot touch `contentDocument` cross-origin, which is exactly the gap).

### 3.2 How to know it's worth a keyframe (viewport + activity gating)

A canvas off-screen or never drawn-to is not worth a frame. Gate detection on **both**:

1. **In viewport:** use a single shared `IntersectionObserver` (threshold `0.01`) over all detected
   elements. Only intersecting elements are candidates.
2. **Active / changed:** 
   - canvas/WebGL: hook draw activity cheaply — wrap `getContext` (above) and, for WebGL, the
     element is "active" once any `gl.drawArrays`/`gl.drawElements`/`gl.clear` fires (patch the
     returned context's methods to set a per-frame dirty flag). For 2D, patch the returned context
     once to flip dirty on first draw call. Keep this O(1) — set a boolean, do not log per call.
   - video: listen for `play`, `seeked`, `timeupdate` (throttled), `pause`.
   - cross-origin iframe: presence in viewport is enough (it can never be DOM-replayed).

### 3.3 Computing the rect

For each unreliable element to be captured, compute `el.getBoundingClientRect()` plus
`window.devicePixelRatio` **and the current scroll offset** (`window.scrollX` / `window.scrollY`).

**CORRECTED — coordinate space (this was wrong and is the classic CDP clip bug):**

- CDP `clip.{x,y,width,height}` are in **device-independent pixels (dip = CSS px)**, and `clip.{x,y}`
  are **relative to the root document origin**, NOT the viewport. `getBoundingClientRect()` returns
  **viewport-relative** coords. The background MUST convert:
  `clip.x = rect.x + scrollX`, `clip.y = rect.y + scrollY`
  (chromedp#844 documents exactly this mismatch:
  https://github.com/chromedp/chromedp/issues/844). The original plan sent the raw viewport rect →
  on any scrolled page the clip would be offset by the scroll amount and crop the wrong region.
- **CORRECTED — `scale`.** CDP multiplies `clip.scale` by the page's `devicePixelRatio` internally.
  Passing `dpr` as `scale` therefore applies dpr **twice** (`dpr × dpr`). Use **`scale: 1`**; the
  emitted PNG/JPEG is already at native device resolution. `dpr` is still sent in `rect` so the
  *player overlay* (§8) can map recorded device-px back to CSS-px for positioning.

So the content script sends CSS-px viewport rect + `dpr` + `scrollX`/`scrollY`; the background does
the viewport→document conversion at capture time (§4.1).

Also compute a stable-ish `selector` (tag + nth-of-type chain, capped depth) for overlay anchoring
in the player when layout has drifted.

### 3.4 Signalling

The content script posts a debounced request (see §5 policy) to the background:

```
chrome.runtime.sendMessage({
  action: "pixelKeyframe",
  reason: "unreliable-region",
  regions: [ { selector, regionKind, rect: {x,y,width,height,dpr,scrollX,scrollY} }, ... ]
})
```

When multiple unreliable regions are visible, send them in **one** message; the background decides
whether to take one full-viewport frame or several clipped frames (§5 budget logic).

---

## 4. Background keyframe lane (CDP capture)

Implemented in `background.js`, reusing the existing `chrome.debugger` attachment and the existing
`captureScreenshot` helper (lines 114–126) as the starting point.

### 4.1 New helper: `captureKeyframe({ reason, rect, selector, regionKind })`

Generalize the existing `captureScreenshot` (lines 114–126):

- Call `sendCmd("Page.captureScreenshot", params)` where:
  - **CORRECTED:** `format: "jpeg", quality: 60` — CDP `quality` is documented **jpeg-only**
    (https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot); webp
    quality is version-inconsistent and the existing PNG path ignores quality entirely. JPEG gives
    reliable, size-bounded lossy frames.
  - **CORRECTED — `captureBeyondViewport`.** For a *clipped* capture of a possibly-scrolled region,
    set `captureBeyondViewport: true`. With `false`, the clip is constrained to the current visual
    viewport and a region whose document coords lie outside it (or only partly inside) is cropped or
    blank. (The existing full-viewport `screenshot` path keeps `false`; only the clipped keyframe
    path needs `true`.) For `rect == null` full-viewport keyframes, keep `false`.
  - **CORRECTED — clip math.** If `rect`:
    `clip: { x: rect.x + rect.scrollX, y: rect.y + rect.scrollY, width: rect.width,
    height: rect.height, scale: 1 }`.
    - `x/y` are converted from viewport-relative (`getBoundingClientRect`) to **document-relative**
      by adding the recorded scroll offset (chromedp#844:
      https://github.com/chromedp/chromedp/issues/844).
    - `scale: 1` — NOT `rect.dpr`. CDP multiplies `scale` by `devicePixelRatio` internally, so
      passing dpr would double-scale (`dpr × dpr`) and produce a wrong-size crop.
- On success, `pushEvent({ t: Date.now(), kind: "pixel", reason, rect, selector, regionKind,
  dataURL: "data:image/jpeg;base64," + result.data })` (reuse `pushEvent`, line 26 — this puts the
  marker on the unified timeline and into the report automatically).
- On failure, `pushEvent` a `kind:"pixel"` marker with `dataURL: null` and an `error` field (mirror
  the existing failure branch, line 124) — never throw into the lane; a dropped frame must not
  break recording (§5 corruption guards spirit).

> Note: the existing `captureScreenshot` calls (start/stop on lines 297/303, error-cooldown on
> 261–266) can either stay as `kind:"screenshot"` or be folded into the keyframe lane. Recommended:
> keep manual/error screenshots as `screenshot`, and have the keyframe lane own the new
> `reason`-tagged `pixel` frames so the two concepts stay distinct in the UI.

### 4.2 Budget + rate-limit state (added to `session`)

Extend the `session` object (background.js, lines 9–19) with:

```
keyframes: { count: 0, lastAt: 0, lastReasonAt: {}, budgetHit: false }
```

A single chokepoint `requestKeyframe(opts)` enforces the §5 policy before calling
`captureKeyframe`. Every trigger routes through it. Reset `keyframes` in `startRecording`
(alongside the other resets, lines 272–282).

---

## 5. Triggering policy (PRECISE — this is the cost-control contract)

A keyframe is taken **only** when `requestKeyframe` passes ALL of: (a) recording is active,
(b) global budget not exhausted, (c) the per-reason debounce window has elapsed, (d) a global
minimum-interval gate has elapsed.

### 5.1 Global gates

- **Global min interval:** `MIN_KEYFRAME_INTERVAL_MS = 750`. No two keyframes (any reason) closer
  than 750 ms, except `start`/`stop`/`user-mark` which bypass this gate (they are intentional and
  rare).
- **Global frame budget:** `MAX_KEYFRAMES = 300` per session. On the 300th frame, set
  `budgetHit = true`, `pushEvent` one `kind:"log"` notice ("pixel keyframe budget reached"), and
  stop taking automatic frames. `user-mark` still allowed (reserve headroom: stop *automatic*
  frames at 280, keep 20 for explicit marks). **CORRECTED:** clipped JPEG @q60 of a typical element
  box runs ~20–60 KB (full-viewport frames are larger, ~80–200 KB). Taking a conservative
  ~50 KB/frame average, 300 frames caps the lane at **≈ 15 MB** — still bounded regardless of
  session length, and the §7 12 MB soft cap + drop-oldest keeps the *embedded* payload under that.
  (Original "~30 KB/WebP → ≈9 MB" assumed the now-corrected WebP format; recompute against the
  real per-frame bytes during dogfood §10.3.)

### 5.2 Per-trigger rules

| Trigger (`reason`) | Fires when | Debounce / cap |
|---|---|---|
| `start` | recording begins | once; bypasses min-interval |
| `stop` | recording ends (capture **before** detach) | once; bypasses min-interval |
| `route` | SPA route change / full nav (content script observes `popstate`, `pushState`/`replaceState` patch, `hashchange`) | leading-edge, then 1000 ms debounce |
| `checkout` | each rrweb `isCheckout === true` emit (every 60s per §4) | 1:1 with checkouts (already ≤1/60s) |
| `mutation-burst` | content script sees a large DOM mutation burst (MutationObserver: ≥ `MUTATION_BURST_THRESHOLD = 200` nodes added/removed within a 500 ms window) | **trailing-edge** 500 ms debounce; max 1 per 2000 ms |
| `user-mark` | user clicks "Mark this moment" (popup.js → message) | none; bypasses budget cap up to the reserved 20 |
| `unreliable-region` | §3 detector reports canvas/WebGL/video/xorigin-iframe in viewport AND active | **trailing-edge** 600 ms debounce per region `selector`; while a `<video>` is playing, refresh that region every `VIDEO_REFRESH_MS = 2000` (so playback shows motion, still bounded) |

### 5.3 One frame vs. many

When `unreliable-region` reports multiple regions in one message:
- If total area of regions > 60% of viewport, OR ≥ 3 regions → take **one full-viewport** frame
  (cheaper than many clips, better overlay coherence).
- Else take **one clipped frame per region** (smaller payloads, precise overlay).

### 5.4 Debounce implementation note

Debounce timers live in the **content script** for `route`/`mutation-burst`/`unreliable-region`
(it has the DOM signal); the background enforces only the global min-interval + budget. This keeps
the SW from holding many timers (it can be killed at 30s idle — §3) and means a torn-down SW only
loses gating state, never the buffer.

---

## 6. Message protocol (content script ↔ background)

Extend the existing `chrome.runtime.onMessage` switch in `background.js` (lines 350–377):

| Message | Direction | Payload | Handler |
|---|---|---|---|
| `pixelKeyframe` | CS → BG | `{ reason, regions?: [{selector, regionKind, rect}] }` | route to `requestKeyframe` per §5.3 |
| `markMoment` | popup → BG | `{ label? }` | `requestKeyframe({ reason: "user-mark" })` + existing screenshot semantics |
| (existing) `start` / `stop` / `screenshot` / `getStatus` | unchanged | — | start/stop also fire `start`/`stop` keyframes |

The `route` and `checkout` reasons arrive via `pixelKeyframe` too (content script owns the rrweb
`emit` checkout signal and the history/nav hooks). All handlers must `sendResponse({ ok, count })`
and keep the `return true` async pattern (line 376).

Add a `popup.html` / `popup.js` button "Mark this moment" that sends `markMoment` (mirrors the
existing manual-screenshot wiring).

---

## 7. Storage & embedding

- **In-extension storage:** keyframes are already inside `report.events` (because `captureKeyframe`
  uses `pushEvent`), so they persist via the existing `chrome.storage.local.set` in
  `stopRecording` (line 330). No new storage path. (`unlimitedStorage` from Phase 1 covers the
  larger base64 payload.)
- **Export embedding (CORRECTED — this had a real double-counting / wrong-lane inconsistency):**
  Keyframes are `kind:"pixel"` events living in **`report.events`**, not in `report.rrwebEvents`.
  `report-builder.js` line 13 does `JSON.stringify(report)` — i.e. it inlines **all** of
  `report.events` **raw and uncompressed** into the `<script type="application/json">` blob. Phase 2
  (`PHASE_2_PLAN.md §4.2`) only pulls **`report.rrwebEvents`** into the fflate-compressed base64
  octet-stream payload; it does **not** touch `report.events`. Therefore, as written, pixel
  `dataURL`s would NOT be in the compressed blob — they would sit raw in the JSON blob, exactly the
  "50 MB inline JSON chokes browsers" failure (§6) this plan claims to avoid. Resolve with ONE of:
  1. **(preferred)** In `buildReportHTML`, split the heavy `kind:"pixel"` `dataURL`s out of
     `report.events` before `JSON.stringify`, and embed them in the **same fflate octet-stream lane
     Phase 2 built** (alongside, but as a distinct keyed payload from, the rrweb events). The
     renderer/initReplay rehydrates them back onto the events by `id` at load time. This is the only
     option that actually compresses them.
  2. Leave them raw in the JSON blob and accept the size cost — only acceptable because the §7 soft
     cap (below) and `MAX_KEYFRAMES` bound the total; still risks the inline-JSON choke on big
     sessions. Not preferred.
  - **No double-counting:** whichever lane holds the `dataURL`s, it must be the *only* one — do not
    leave the `dataURL` in `report.events` JSON **and** also copy it into the compressed lane. The
    size guard below must measure the lane that actually ships the bytes.
  - **`</script>` safety:** base64 (`[A-Za-z0-9+/=]`) contains no `<`, so the existing `<`-escape
    (line 13) is sufficient for the JSON-blob path; the compressed-lane path is base64 too. Keep the
    escape as defense.
- **Size guard:** if total keyframe bytes exceed a soft cap (e.g. 12 MB), drop oldest *automatic*
  frames first (keep `user-mark`, `start`, `stop`, `error`-adjacent) — log the count dropped into
  the report meta (mirrors §5 "count & log CORS-dropped assets").

---

## 8. Player overlay (in-extension `viewer.js` + exported player)

The overlay logic must live in code embedded verbatim into the export. `renderer.js` is already
self-contained for exactly this reason (its header comment, lines 1–4). Put the overlay renderer
in `renderer.js` (or a sibling that `report-builder.js` also `toString`-embeds) so both the
in-extension preview and the exported file share one implementation.

### 8.1 Overlay model

The rrweb player renders into its own container. On top of it, maintain an **absolutely-positioned
overlay layer** sized to the player's replay viewport.

- **Time sync:** the player already emits current replay time (`ui-update-current-time`, wired to
  the timeline per `§6`). On each tick, find the **nearest pixel keyframe at or before** the
  current time whose `regionKind`/`selector` corresponds to a region currently on screen.
- **Positioning:** anchor the overlay `<img>` (the keyframe `dataURL`) using the recorded `rect`
  (scaled from the recorded dpr/viewport to the current player viewport scale). If `selector`
  resolves in the replayed DOM, prefer the live replayed element's box (corrects layout drift);
  fall back to recorded `rect` when it doesn't resolve.
- **Clipped overlay:** clipped keyframes (`rect != null`) are positioned over just the suspect box.
  Full-viewport keyframes (`rect == null`) are used for the full-bleed fallback (below).

### 8.2 Badge + fallback

- Show a small **"pixel keyframe"** badge on/near each active overlay (reuse the badge styling
  pattern in `renderer.js` lines 30–35; add a `.b-pixel` class and a `"pixel"` entry to the
  badge/filter set).
- **Full-bleed fallback:** when the playhead is scrubbed to a moment dominated by a canvas/WebGL or
  cross-origin-iframe region (i.e. the DOM replay there would be blank/garbage), and a
  full-viewport keyframe exists near that time, show the keyframe **full-bleed** over the player
  with the badge, instead of trusting the blank DOM frame. Heuristic: if the nearest keyframe is
  `regionKind: "xorigin-iframe"` or a full-viewport `route`/`checkout` frame and no reliable DOM
  exists, go full-bleed.
- The timeline (`renderer.js`) gets a `pixel` filter chip and clickable `pixel` rows that seek the
  player to that keyframe's `t` (rows already seek-capable once Phase-1 wired player↔timeline).

### 8.3 Corruption guards (`§5`)

These belong to the player and must work in the export too:

- **FullSnapshot-first:** assert the first rrweb event is a FullSnapshot before play; if not,
  seek to the first checkout segment (Phase-1 segment model, §3) and warn.
- **try/catch mutation apply:** wrap the player's incremental-mutation application; on throw,
  **re-anchor to the nearest pixel keyframe** (show it full-bleed) and then jump the player to the
  next rrweb checkout segment to resume clean DOM replay. Log the re-anchor into a visible notice.
- This makes pixel keyframes double as **recovery anchors**, not just visual patches — the reason
  `checkout` frames exist at every 60s checkout.

---

## 9. Ordered implementation steps

1. **Manifest check** — confirm `debugger`, `tabs`, `<all_urls>`, `unlimitedStorage` present
   (lines 6–7 + Phase-1 addition). No new permissions required.
2. **Data model** — add `kind:"pixel"` to `renderer.js` `KINDS` (line 54) + `active` (line 55) +
   a `.b-pixel` badge class (near lines 30–35). Render a `pixel` row + detail (show the `dataURL`
   as an `<img>`, reuse the screenshot branch lines 187–193).
3. **Background: `captureKeyframe` + `requestKeyframe`** — generalize `captureScreenshot`
   (lines 114–126) for WebP + `clip`; add `session.keyframes` state + the §5 gate chokepoint.
4. **Background: message handlers** — add `pixelKeyframe` + `markMoment` to the switch
   (lines 350–377).
5. **Content script: history/nav hooks** — patch `pushState`/`replaceState`, listen `popstate`/
   `hashchange` → debounced `route` keyframe request.
6. **Content script: rrweb checkout hook** — on `isCheckout === true` emit, request `checkout`
   keyframe (1:1).
7. **Content script: mutation-burst observer** — MutationObserver counting added/removed nodes per
   500 ms window; trailing-edge `mutation-burst` request at threshold 200.
8. **Content script: region detector** — `getContext` patch (canvas/WebGL dirty flags),
   `IntersectionObserver`, video event listeners, cross-origin iframe URL check; compute rect+dpr+
   selector; batch into one `unreliable-region` request with the §5 debounce.
9. **Background: budget/size guard** — enforce `MAX_KEYFRAMES`, soft byte cap, drop-oldest-
   automatic logic; log drops into `report.meta`.
10. **Export embedding** — confirm keyframes flow through `report-builder.js` JSON inline
    (line 13); fold into the Phase-2 fflate compression pass; verify `<` escaping holds for
    base64.
11. **Player overlay (shared)** — implement the overlay layer + time-sync + selector/rect anchoring
    in the self-contained renderer; wire into `viewer.js` host and into the `report-builder.js`
    embed so both share it.
12. **Badge + full-bleed fallback + pixel filter/seek** — §8.2.
13. **Corruption guards** — FullSnapshot-first assert, try/catch mutation apply → re-anchor to
    nearest keyframe → resume at next checkout (§8.3).
14. **Dogfood verification** — §10.

---

## 10. DOGFOOD verification (the acceptance bar)

The bar is literal: **"I can see the canvas in the replay."** DOM-only replay would be blank/garbage
in these cases; the pixel lane must show real pixels.

1. **Canvas/WebGL page** — record a WebGL demo (e.g. a Three.js example or
   `https://webglsamples.org/aquarium/aquarium.html`):
   - Confirm `kind:"pixel"`, `regionKind:"webgl"` markers appear in the timeline with non-null
     `dataURL`s.
   - Open the in-extension replay (`viewer.js`): scrub to a canvas moment → the overlay shows the
     **real rendered canvas pixels** with a "pixel keyframe" badge, positioned over the canvas box.
   - Export the report; open the standalone `.html` offline (file://) → same canvas pixels visible.
     **PASS = canvas is visible in both.**
2. **Cross-origin iframe page** — record a page embedding a cross-origin iframe (e.g. a YouTube
   embed or any `<iframe src>` on a different origin):
   - Confirm a `regionKind:"xorigin-iframe"` keyframe exists.
   - In replay, the iframe region (which rrweb renders **blank**, §5/§4) is covered **full-bleed /
     clipped** by the keyframe pixels with the badge. **PASS = iframe content visible, not blank.**
3. **Bounds check** — confirm `keyframes.count` stays ≤ `MAX_KEYFRAMES` and total keyframe bytes ≤
   soft cap on a 5-minute heavy session; confirm no continuous-screencast behavior (frames are
   sparse, event-aligned). **Measure the real per-frame JPEG bytes** (clipped vs full-viewport) and
   confirm the §5.1 budget math (≈15 MB ceiling) holds with the actual numbers — the original
   ~30 KB/WebP estimate was for the now-corrected format.
   - **Scroll regression check (catches the clip-coordinate bug):** during one capture, **scroll the
     unreliable element below the fold** before it triggers a keyframe, then confirm the captured
     pixels show the *element*, not an offset/blank crop. This is the concrete test that the
     viewport→document (`+scrollX/scrollY`) conversion and `captureBeyondViewport:true` are correct.
4. **Corruption check** — artificially force a mutation-apply throw (e.g. a malformed event in a
   test fixture); confirm the player re-anchors to the nearest keyframe and resumes at the next
   checkout instead of dying.

---

## 11. Risks & mitigations

| Risk | Detail | Mitigation |
|---|---|---|
| **Screenshot cost / cadence** | `Page.captureScreenshot` blocks the CDP pipe and costs CPU/GPU; too-frequent capture janks the page being recorded. | Event-driven only (no screencast, §5); global 750 ms min-interval; trailing-edge debounces; `MAX_KEYFRAMES=300`. |
| **Keyframe size budget** | Base64 WebP frames bloat the report and can choke inline-JSON export (§6 "50 MB chokes browsers"). | Clip to element rect; WebP q0.6; 300-frame + 12 MB soft caps; drop-oldest-automatic; fold into Phase-2 fflate compression. |
| **Clip-rect accuracy** | CDP clip x/y are **document-relative dip**; `getBoundingClientRect` is **viewport-relative**; `scale` is multiplied by dpr internally → scroll/dpr mismatches give wrong crop. | **CORRECTED:** convert to document coords (`x+scrollX`, `y+scrollY`); use `scale:1` (NOT dpr — CDP applies dpr itself); `captureBeyondViewport:true` for clipped captures so off-viewport regions aren't cropped; recompute rect+scroll at capture time. (chromedp#844; CDP Viewport docs.) |
| **Debugger banner** | `chrome.debugger.attach` shows the "DevTools is debugging this tab" banner (already present in Phases 1–2 capture). | No change vs. today — banner already shown by existing attach (background.js line 285); document it; pixel lane adds no new attach. |
| **Overlay positioning drift** | Replayed layout differs from capture-time layout → overlay misaligns over the wrong box. | Prefer live replayed element box via `selector`; fall back to recorded `rect`; full-bleed fallback when a region can't be anchored; badge signals it's an overlay, not live DOM. |
| **WebGL detection misses** | Page obtains context before our patch, or uses `OffscreenCanvas`/worker. | Patch `getContext` at `document_start` (ISOLATED, before page JS); document `OffscreenCanvas`/worker-rendered canvas as a known limitation for a later phase. |
| **Cross-origin iframe is itself uncapturable in detail** | We can screenshot the *host* viewport region but cannot enter the child. | Accept: pixel keyframe of the host viewport region is the ground truth; that's the §5 strategy ("impossible without injecting the child"). |
| **SW lifecycle** | Service worker killed at 30s idle loses gating state. | Debounce timers + buffer live in the content script (§5.4); SW orchestrates only (§3); lost gating state only means an extra frame, never a lost buffer. |

---

## 12. Out of scope (explicit)

- Continuous video/screencast capture (rejected by §5 — event-driven only).
- Firefox/Safari pixel keyframes (no CDP; Phase 4 ships rrweb-only there).
- Capturing inside cross-origin iframe DOM (requires injecting the child; not this phase).
- `OffscreenCanvas` / worker-rendered canvas (documented limitation).

---

## 13. Sources (followable citations)

Codebase facts cite file + line directly inline above. External/framework claims:

- Hybrid strategy, fidelity gaps, corruption guards: `REPLAY_DESIGN.md` §5
  (`/Users/ian.hogers/projects/openjam/REPLAY_DESIGN.md`, lines 93–109).
- `record()` config (`recordCanvas`, `recordCrossOriginIframes`, `dataURLOptions`):
  `REPLAY_DESIGN.md` §4 (lines 74–91).
- Bounded-memory / segment ring buffer / checkout: `REPLAY_DESIGN.md` §3 (lines 48–72).
- Self-contained export (fflate base64, inline-JSON limits): `REPLAY_DESIGN.md` §6 (lines 112–120).
- `chrome.debugger` / `Page.captureScreenshot` (Chromium-only):
  https://developer.chrome.com/docs/extensions/reference/api/debugger (via §1 / "Key sources", line 140).
- CDP `Page.captureScreenshot` `clip` + `captureBeyondViewport` + `quality` (jpeg-only) params,
  `Viewport` type (x/y/width/height in **dip**, `scale` = page scale factor multiplied by dpr):
  https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot
- Clip coords are **document-relative**, not viewport-relative (the scroll-offset bug):
  https://github.com/chromedp/chromedp/issues/844
- rrweb (`isCheckout`, canvas/cross-origin recipes): https://github.com/rrweb-io/rrweb and
  https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/cross-origin-iframes.md
  (via "Key sources", lines 135/143).
- WebGL dogfood target (Aquarium demo): https://webglsamples.org/aquarium/aquarium.html

---

## Verification (adversarial pass, 2026-06-09)

Each external CDP/API claim checked against live docs; each codebase line-ref checked against the
actual files. Verdict: **PASS-WITH-FIXES** (all confirmed errors corrected inline above).

### CDP `Page.captureScreenshot` (claims 1 & 3)

- **CORRECTED — `format:"webp", quality:60`.** CDP docs state `quality` is **"jpeg only"**
  (https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot). WebP
  quality support is version-inconsistent. Changed to `format:"jpeg", quality:60` in §2, §4.1, §5.1.
  Source: CDP devtools-protocol Page docs + https://github.com/puppeteer/puppeteer/issues/5348.
- **CONFIRMED — `format` supports `jpeg`/`png`/`webp`; `clip` (Viewport) and `captureBeyondViewport`
  exist in CDP 1.3.** OpenJam attaches `PROTOCOL_VERSION = "1.3"` (background.js line 5) and these
  are stable (non-experimental except `captureBeyondViewport`, which is "Experimental" but shipped
  and used by Puppeteer: https://github.com/puppeteer/puppeteer/pull/6805). Source: CDP Page docs.
- **CORRECTED — clip coordinate space (the bug the review was told to hunt for).** `clip.{x,y}` are
  **document-relative device-independent pixels**; `getBoundingClientRect()` is **viewport-relative**.
  The original plan sent the raw viewport rect → wrong crop on any scrolled page. Fixed: add
  `scrollX/scrollY` (content script now sends them; background converts in §4.1). Source:
  https://github.com/chromedp/chromedp/issues/844 ("Protocol expects position relative to root
  document, GetBoxModel returns viewport-relative").
- **CORRECTED — `scale`.** CDP multiplies `clip.scale` by `devicePixelRatio` internally; passing
  `dpr` as `scale` double-scales. Fixed to `scale: 1` in §3.3/§4.1. Source: CDP Viewport type
  ("scale = Page scale factor") + web confirmation that scale is multiplied by dpr.
- **CORRECTED — `captureBeyondViewport`.** With `false`, a clip outside the visual viewport is
  cropped/blank; clipped keyframes of scrolled regions need `true`. Fixed in §4.1; full-viewport
  frames keep `false`. Source: https://github.com/puppeteer/puppeteer/pull/6805 + CDP docs.

### Content-script detection feasibility (claim 2)

- **CONFIRMED.** Patching `HTMLCanvasElement.prototype.getContext` at `document_start` in an ISOLATED
  world (before page JS) is sound — Phase 1 already establishes ISOLATED + `document_start` content
  script (PHASE_1_PLAN §6, manifest `world:"ISOLATED"`, `run_at:"document_start"`). Note: ISOLATED
  world shares the **DOM** with the page but has a **separate JS scope** — patching a prototype
  method still affects page-created canvases because the prototype object is shared across worlds
  for DOM types. `IntersectionObserver`, `<video>` events (`play`/`seeked`/`timeupdate`/`pause`),
  cross-origin `<iframe>` detection by `new URL(iframe.src).origin !== location.origin`, and
  `getBoundingClientRect()` are all standard DOM APIs available to the content script. STILL-FLAGGED
  (already in §11 risks): `OffscreenCanvas`/worker-rendered canvas and a canvas that obtained its
  context before injection are not detected — documented as out-of-scope.

### Keyframe embedding / Phase-2 consistency (claim 4)

- **CORRECTED — double-counting / wrong-lane bug.** Pixel keyframes live in `report.events`
  (via `pushEvent`), but `report-builder.js` line 13 inlines `JSON.stringify(report)` **raw**, and
  Phase 2 (PHASE_2_PLAN §4.2) compresses only `report.rrwebEvents`. So the plan's claim that
  keyframes "fold into the Phase-2 fflate compression pass" was false as written — they would ship
  raw in the JSON blob. Rewrote §7 with two explicit resolutions (preferred: split dataURLs into the
  fflate octet-stream lane and rehydrate by `id`) and an explicit no-double-counting rule. Source:
  report-builder.js line 13; PHASE_2_PLAN.md §4.2.

### Frame budget / debounce (claim 5)

- **CONFIRMED bounded, CORRECTED numbers.** The gate chain (recording-active + `MAX_KEYFRAMES=300`
  + per-reason debounce + 750 ms global min-interval) is genuinely bounded regardless of session
  length. The **byte** estimate was wrong (assumed webp ~30 KB → ≈9 MB); recomputed for JPEG@q60
  (~20–60 KB clipped, ~80–200 KB full) → ≈15 MB ceiling, still bounded and below the §7 12 MB
  embedded soft cap via drop-oldest. Fixed §5.1, §10.3. Debounce-in-content-script (§5.4) is sound
  given the SW 30s-idle kill (REPLAY_DESIGN §3).

### Internal consistency / ordering / line refs

- **CONFIRMED — codebase line references.** `pushEvent` (line 26), `captureScreenshot` (114–126),
  debugger attach (285), `onMessage` switch (350–377), `session` object (9–19), start resets
  (272–282), and the stop-before-detach ordering (`captureScreenshot("Recording stopped")` line 303
  precedes `chrome.debugger.detach` line 311 — so a `stop` keyframe "before detach" per §5.2 is
  feasible) all verified against `background.js`. `renderer.js` `KINDS` (line 54), `active` (55),
  `.b-*` badges (31–35), screenshot `<img>` branch (187–193) verified.
- **CONFIRMED — dogfood proves the bar.** §10.1/§10.2 (WebGL Aquarium + cross-origin iframe, scrub
  → see real pixels overlaid in BOTH in-extension and exported file) genuinely exercises "I can see
  the canvas/iframe pixels in the replay" — but only if the clip-coordinate corrections above land;
  otherwise the overlaid crop would be offset on a scrolled page. The dogfood should explicitly
  **scroll the page before triggering a keyframe** to catch a coordinate regression (added emphasis
  to §10.3's measurement step; recommend the WebGL canvas be below the fold during one capture).
- **STILL-UNVERIFIABLE — overlay anchoring fidelity (§8).** Mapping a recorded device-px JPEG back
  onto the replayed DOM via `selector`/`rect` scaled by the recorded vs. current player viewport is
  plausible but not empirically validated here; depends on Phase-1 player↔timeline wiring
  (PHASE_1_PLAN §7, itself flagged VERIFY-FIRST for `ui-update-current-time`). Carry as residual risk
  — prove during §10 dogfood, not on paper.
