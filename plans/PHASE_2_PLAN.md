# Phase 2 — Self-Contained Replay Export (Implementation Plan)

**Status:** Plan only. Do NOT implement from this document without sign-off.
**Scope:** Embed a *working*, offline rrweb replay player into the exported single HTML file
produced by `report-builder.js`. Opens from `file://` with the network off.
**Authoritative design:** `/Users/ian.hogers/projects/openjam/REPLAY_DESIGN.md` §6 (self-contained
export), with supporting constraints from §2 (rrweb specifics), §3 (compression / `@rrweb/packer`),
and §7 (phased plan).

> **CORRECTION (verification §10):** `@rrweb/packer`'s `pack`/`unpack` operate **per-event**
> (`pack(event)→base64 string`, `unpack(string)→event`), NOT on a whole array. AND `rrweb-player`
> **already imports `unpack` and applies it internally via `unpackFn`** (it passes
> `unpackFn: unpack` to its inner `Replayer`). Consequences for this plan, applied inline below:
> (a) we do **not** inline a separate `@rrweb/packer` unpack IIFE — the player unwraps packed
> events itself; (b) "compress the whole session once" means each event is `pack`-ed individually
> at export time (the array is `events.map(pack)`), producing an array of base64 strings, which is
> then JSON-stringified — there is no single packed blob to `atob`/`unpack` on click. See the
> Verification section for the corrected data flow and sources.

---

## 0. Dependency note — Phase 1 must be done first (BLOCKING)

This plan assumes **Phase 1 (REPLAY_DESIGN §7) is complete and merged**. Concretely, Phase 2
depends on all of the following already existing in the repo:

1. **`report.rrwebEvents`** — every report object persisted to `chrome.storage.local` /
   IndexedDB now carries an `rrwebEvents` array (rrweb event objects, `Date.now()` epoch-ms
   timestamps per §2). Phase 2 reads this field; it does not create it.
2. **An esbuild build step** — the extension is no longer loaded as raw source. There is a
   `package.json` and a build that bundles ES modules into the `dist/` (or equivalent) the
   manifest loads. Phase 2 *extends* this build; there is currently **no `package.json`** in the
   repo (`/Users/ian.hogers/projects/openjam/`), so its creation is Phase 1's responsibility.
3. **Installed, pinned deps** (per §2 — MIT, registry `dist-tags.latest = 2.0.1`):
   - `rrweb@2.0.1` — installed by Phase 1 (PHASE_1 §1a).
   - `rrweb-player@2.0.1` — installed by Phase 1. Ships the UMD build `dist/rrweb-player.umd.cjs`
     (global `rrwebPlayer`, lowercase) which **bundles `@rrweb/packer`'s `unpack` internally**
     (verification §10). Also ships `dist/style.css` (separate; must be inlined).
   - `esbuild@0.24.0` (dev) — installed by Phase 1.
   - **`@rrweb/packer@2.0.1` — NOT installed by Phase 1 (corrected, verification §10).** PHASE_1
     §1a installs only `rrweb`+`rrweb-player`+`esbuild`. Phase 2 owns this install:
     `npm install --save-exact @rrweb/packer@2.0.1`. It provides `pack` (used **at export time**
     in the builder) and `unpack` (NOT inlined into the export — the player carries its own).
     `pack`/`unpack` are **per-event** functions (`pack(event)→base64 string`), not whole-array.
4. **In-extension player** — `viewer.js` already hosts an `rrweb-player` instance against the live
   report (Phase 1). Phase 2 reuses the *same* player package, but inlined into the export.

> If any of the above is missing, STOP — that is Phase 1 work. Phase 2 changes nothing about
> capture, the ring buffer, IndexedDB, or `unlimitedStorage`.

**Current files Phase 2 touches or adds** (verified present unless marked NEW):
- `report-builder.js` (modified — the export generator)
- `viewer.js` (modified — pass `rrwebEvents` through; surface the full-session toggle)
- `build/` (NEW — esbuild plugin/script that emits inlinable string modules)
- `src/replay-runtime.js` (NEW — the code that runs *inside* the exported file)
- `package.json` build scripts (modified — add the asset-stringify + size-gate steps)

---

## 1. Architecture overview (what the exported file will contain)

The export today (per `report-builder.js`) is one `<!doctype html>` string with: inlined
`REPORT_CSS`, a `<script type="application/json">` data blob, and the `renderReport` source
embedded via `Function.prototype.toString()`. It works because the file is `file://` and has
**no CSP** (comment at `report-builder.js:5`). Phase 2 adds three new inlined payloads to the
same document, in this order:

1. **rrweb-player UMD** (`rrweb-player.umd.cjs` text) — sets the global `rrwebPlayer` (lowercase
   `r`; the UMD's globalName, verified §10). CSS (`dist/style.css`) is **separate** and must be
   inlined into a `<style>` too.
2. ~~**`unpack` runtime**~~ **REMOVED (verification §10).** `rrweb-player` already imports
   `@rrweb/packer`'s `unpack` and applies it internally (`unpackFn: unpack` → inner `Replayer`).
   We do **not** inline a separate unpack IIFE. When the player is fed packed events it unwraps
   them itself, per-event. There is no separate "unpack global" to embed.
3. **The packed events payload** — each event in `report.rrwebEvents` is `pack`-ed
   **individually** at export time (`pack` is per-event: `pack(event) → base64 string`, verified
   §10), producing an **array of base64 strings** `report.rrwebEvents.map(pack)`. That array is
   embedded as JSON (it contains only base64 chars + JSON quoting — no `<`). This is "compress the
   whole session" in the sense of compressing every event of the session at export, since the
   recorder stored raw events in Phase 1 (no `packFn`). It avoids the §6 "50 MB inline JSON"
   choke because each event's payload is zlib-compressed before stringify. **There is no single
   packed blob** — the per-event packing is what the player's `unpackFn` expects.
4. **A small replay-runtime glue script** (`src/replay-runtime.js`, inlined as source) that:
   lazy-parses the packed-events JSON on first user click, lazy-inits `rrwebPlayer` **with the
   packed events** (player unpacks each internally), seeks via segment keyframes, and wires
   `ui-update-current-time` → existing timeline highlight.

Data flow at open time (offline):

```
<script type=application/json> packed events[] ──JSON.parse──▶ packed string[] ──▶ rrwebPlayer({ events })
                                                                                      │ (player's unpackFn
                                                                                      │  unpacks each event)
                                          ui-update-current-time (e.payload, ms) ◀────┘
                                                                                      ▼
                                                          highlightTimelineRow(firstEventTs + e.payload)
```

> Note: because the player unpacks internally, the heavy work on first click is `JSON.parse` of
> the packed array + the player's own per-event `unpack`. There is no manual `atob`/`unpack` step.

Player init is **lazy on click** (§6). Decode/unpack of a multi-MB payload must not run on page
load — it runs once, the first time the user expands/plays the replay.

---

## 2. The build step — producing inlinable strings (do this before touching report-builder.js)

`report-builder.js` currently inlines `renderReport` by calling `renderReport.toString()` at
runtime (it can, because `renderer.js` is a same-bundle ES module). The UMD player is a
**third-party package**, not a function we author — so we cannot `.toString()` it. We must turn it
into a **string constant at build time** and import that string into `report-builder.js`.
(The `pack` function we use at export time is imported normally — it runs in the builder, not in
the exported file. The `unpack` runtime is **not** inlined: the player carries it — see §1
correction.)

### Step 2.1 — Add an esbuild "inline asset as string" step

Create `build/inline-assets.mjs` (NEW). It runs as part of the existing Phase 1 build and emits a
generated module `src/generated/replay-assets.js` (NEW, git-ignored) exporting **two** string
constants (the third — `RRWEB_UNPACK_IIFE` — is removed per the §1 correction; the player unpacks
internally):

- `RRWEB_PLAYER_UMD` — the text of `node_modules/rrweb-player/dist/rrweb-player.umd.cjs`. This
  file (confirmed `package.json` `main`/`unpkg`, §10) is already a Vite-built **production UMD**
  and defines the global `rrwebPlayer` (lowercase, §10). It already contains `@rrweb/packer`'s
  `unpack` bundled in. It is **already minified** as shipped — do NOT re-bundle it with
  `--bundle --format=iife` (re-bundling a UMD can break its global assignment and is unnecessary).
  Just read the file and store as a JS string constant. Measure its byte size for the gate (§3).
- `RRWEB_PLAYER_CSS` — the player's stylesheet text (`rrweb-player/dist/style.css`, confirmed
  exported as `./dist/style.css` in package.json, §10). The player needs its CSS to render
  controls/progress bar; inline it into a `<style>` in the export (same pattern as `REPORT_CSS`).

Implementation notes for `build/inline-assets.mjs`:
- Use esbuild's JS API (`esbuild.build({ write: false })`) to get output bytes in-memory, then
  write the generated module. Do **not** shell out per asset.
- Escape the captured text safely for embedding in a JS template/source string. Prefer
  `JSON.stringify(text)` to produce the constant (handles backticks, `${`, backslashes, newlines).
  This is the *build-time* escape; the `</script>` breakout escape is a separate, runtime concern
  handled in Step 4.4.
- Emit a build manifest `src/generated/replay-assets.sizes.json` recording byte sizes of each
  constant (raw and gzipped) for the size gate (Step 3).

### Step 2.2 — Wire it into package.json

Phase 1's build is `node build.mjs` (PHASE_1_PLAN §1b/§2), invoked via `"build": "node build.mjs"`
and `"watch": "node build.mjs --watch"`. Phase 2 must **chain** `build:assets` before it WITHOUT
clobbering the watch path. Add/modify scripts:
```
"build:assets": "node build/inline-assets.mjs",
"build": "npm run build:assets && node build.mjs",
"watch": "npm run build:assets && node build.mjs --watch",
"size:check": "node build/check-export-size.mjs"
```
`build:assets` must run **before** the main esbuild bundle, because `report-builder.js` will
`import` from `src/generated/replay-assets.js`. (Note: in `--watch`, `build:assets` runs once up
front; changes to the player package mid-watch require re-running `build:assets`. Acceptable —
the player version is pinned and changes rarely.)

> **Path consistency check (verification §10):** Phase 1 keeps `renderer.js`/`report-builder.js`
> at the **repo root** and bundles them into `dist/viewer.js` (PHASE_1_PLAN §0). Phase 2 adds
> `src/replay-runtime.js` and `src/generated/replay-assets.js`. `report-builder.js` (at repo root)
> importing `"./generated/replay-assets.js"` (Step 4.1) would resolve to `repo-root/generated/...`,
> NOT `src/generated/...`. **FIX:** either place the generated module at `repo-root/generated/`
> (drop the `src/` prefix everywhere in this plan), or import it as `"./src/generated/replay-assets.js"`.
> Pick one and use it consistently. This plan assumes the `src/` layout, so all imports in
> `report-builder.js` must use the `./src/...` prefix (see Step 4.1, corrected).

### Step 2.3 — Author the replay runtime (`src/replay-runtime.js`, NEW)

This is OUR code (so it can be embedded via `.toString()` like `renderReport`, OR bundled — pick
`.toString()` for consistency with the existing pattern at `report-builder.js:14`). Export one
function `initReplay(opts)` that runs inside the exported file. It must reference only browser
globals + the **single** inlined global `rrwebPlayer` (lowercase; verification §10 — there is no
separate unpack global, the player carries unpack) — same self-containment rule as `renderReport`
(`renderer.js:1-4`). Responsibilities:

1. Read the packed-events **JSON array** from a dedicated `<script type="application/json">`
   element by id (kept out of the report data blob; see Step 4). Its `.textContent` is a JSON
   array of base64 strings (each a `pack`-ed event).
2. On first activation: `JSON.parse(textContent)` → array of packed strings. Guard the parse in
   try/catch; on failure show an inline error, don't throw to the page. **Do NOT `atob`/unpack
   manually** — the player's internal `unpackFn` unpacks each event (verification §10). Packed
   events are passed straight to the player.
3. Choose the event set: **bounded window by default**, full session only if the export embedded
   it AND the user opted in (Step 4.3). Find the seek anchor using **segment keyframes** —
   the first `FullSnapshot` at/just-before the chosen start — and pass the sliced events to the
   player so a deep session doesn't replay from t=0 (§6 "seek via segment keyframes"). **Note:**
   events are *packed* here, so `type`/`timestamp` are not directly readable on the base64 string;
   the segment-keyframe metadata (start index of each segment + its first event's epoch
   timestamp) must be precomputed at export time (Step 4.2) and embedded alongside, since you
   cannot inspect a packed event without unpacking it. The runtime slices the packed array by the
   precomputed index, it does not parse event `type` from packed strings.
4. `new rrwebPlayer({ target, props: { events, autoPlay: false, showController: true } })`
   (global is `rrwebPlayer`, lowercase — verification §10; the player unpacks `events` internally).
5. Subscribe: `player.addEventListener('ui-update-current-time', (e) => { ... })`. The handler
   receives an object whose `.payload` is the current time **in ms relative to replay start**
   (0-based; verified §10 — Controller dispatches `{ payload: currentTime }`). Convert to epoch
   using the first event's timestamp (both clocks are `Date.now()`, §2/§6), then call into the
   timeline highlight (Step 5). The first event's epoch timestamp must come from the precomputed
   metadata (Step 4.2), since the packed array can't be read without the player.
6. Return a handle so the host page can also drive the player (timeline-row click → `player.goto`).

---

## 3. Byte-size measurement and gating (measure real bytes before shipping)

§6 says "measure real minified size (~120–250 KB) before shipping". We do this mechanically, not
by guessing.

### Step 3.1 — Measure the real player size

After Step 2.1, `src/generated/replay-assets.sizes.json` holds actual byte counts. Record the real
`RRWEB_PLAYER_UMD` size + `RRWEB_PLAYER_CSS` (no separate unpack — it's inside the player UMD,
verification §10). These are **fixed overhead** added to *every* export, independent of session
length. Measuring byte size is trivial: `inline-assets.mjs` already has the file contents in
memory, so `Buffer.byteLength(text, 'utf8')` per asset — no esbuild minify pass needed since the
shipped UMD is already production-minified (Step 2.1).

### Step 3.2 — Define an export size budget and a gate

Create `build/check-export-size.mjs` (NEW), run as `size:check` and in CI:

- **Fixed-overhead budget:** player UMD (which includes unpack) + player CSS + replay-runtime
  source. Assert the sum is `<= 350 KB` minified (headroom over §6's 250 KB player estimate for
  CSS + glue). If it exceeds, fail the build — forces a conscious decision, not silent bloat.
- **Per-export budget (measured at export time, not build time):** in `report-builder.js`, after
  producing the packed-events JSON string (`JSON.stringify(events.map(pack))`), compute its byte
  length and expose it. Define soft/hard thresholds:
  - **Soft (warn):** packed-events JSON > 8 MB → the runtime shows a "large replay, may take a
    moment to load" notice (purely UX).
  - **Hard (gate):** if the packed-events JSON string would exceed a configurable cap (default
    **40 MB**) the builder **falls back to bounded-window only** and drops the full-session opt-in,
    logging a `console.warn` with the byte counts. The bounded window is itself capped by Phase 1's
    ring buffer (§3: 5-min window ≈ low single-digit MB), so the bounded payload is small by
    construction. **Inflation note (corrected):** each `pack`-ed event is *already* base64 (~1.33×
    its zlib-compressed bytes) and `JSON.stringify` adds quotes + commas (~3 bytes/event). The
    measured number is the true embedded byte count, so the gate is exact regardless of how the
    inflation breaks down — measure, don't estimate.

### Step 3.3 — Where size is computed

- **Build-time fixed overhead:** `build/check-export-size.mjs` reads
  `replay-assets.sizes.json`.
- **Per-export payload:** computed inside `buildReportHTML` from
  `new TextEncoder().encode(packedEventsJson).length` (the builder runs in the extension page —
  `viewer.js` calls `buildReportHTML`, PHASE_1 dep — so `TextEncoder` is available; `Buffer` is
  NOT, since this is a browser context, not Node). Compare against thresholds before deciding
  bounded-vs-full embed.

---

## 4. Exact changes to `report-builder.js`

Current `buildReportHTML` (`report-builder.js:9-34`) builds: escaped `dataJson`, `renderSource`,
`title`, returns the HTML template. Keep all of that. Add the replay layer:

### Step 4.1 — New imports
At top of `report-builder.js`, alongside `import { renderReport, REPORT_CSS } from "./renderer.js";`:
```
import { renderReport, REPORT_CSS } from "./renderer.js";
import { initReplay } from "./src/replay-runtime.js"; // OUR runtime, embedded via toString()
import { pack } from "@rrweb/packer";                  // per-event compress at export time
import {
  RRWEB_PLAYER_UMD, RRWEB_PLAYER_CSS,
} from "./src/generated/replay-assets.js";
```
(These resolve because the export builder runs inside the esbuild-bundled extension page. Paths
use the `./src/...` prefix because `report-builder.js` sits at the repo root — see Step 2.2 path
note. No `unpack` import: the player unpacks internally, verification §10.)

### Step 4.2 — Compute the replay payload and the gate decision
Inside `buildReportHTML(report)`, after the existing `dataJson` line:
```
const events = Array.isArray(report.rrwebEvents) ? report.rrwebEvents : [];
const hasReplay = events.length > 1;            // §6: gate the player on rrwebEvents.length > 1
```
- If `!hasReplay`: skip ALL replay inlining; the export is byte-for-byte the current behavior
  (no player UMD, no events, no glue). This keeps small/no-replay reports tiny.
- If `hasReplay`: decide bounded vs full per Step 3.2's hard cap. Compute:
  - `boundedEvents` = events within Phase 1's default window (the report should already carry the
    window boundary; if not, derive from `meta.capturedAt + meta.durationMs` minus the configured
    window). **Bounded is the default export** (§6: "default export to the bounded window").
  - `fullEvents` = the entire array, embedded **only as an explicit opt-in** (§6) and only if under
    the hard cap (Step 3.2).
- Compress with packer **per-event** (verification §10 — `pack` takes one event, returns a base64
  string): `const packedBounded = boundedEvents.map(pack);` → an array of base64 strings. Likewise
  `packedFull = fullEvents.map(pack)` if included. Then `JSON.stringify(packedBounded)` is the
  embedded payload. **No manual `atob`/`btoa`/`Uint8Array` step** — `pack` already returns base64,
  so the call-stack concern about `String.fromCharCode` does not apply here.
- **Precompute seek/sync metadata** (the runtime can't read packed events — verification §10).
  Before packing, walk `boundedEvents` (still raw at this point) and record:
  - `firstTs` = `boundedEvents[0].timestamp` (epoch-ms; needed for `ui-update-current-time` → epoch
    conversion in Step 5).
  - `keyframes` = array of `{ index, ts }` for every event where `type === 2` (rrweb
    `FullSnapshot`) — these are the seek anchors. Embed this small metadata object as JSON in its
    own `<script type="application/json">` element. The runtime slices the packed array by these
    indices; it never inspects packed strings.

### Step 4.3 — Bounded default + full-session opt-in
- Always embed `packedBounded` as the primary payload.
- If `fullEvents` is included, embed it as a **second** payload element with a distinct id. The
  UI shows a "Load full session" control; the replay runtime only decodes/loads the full payload
  when that control is clicked (keeps default open fast; §6 "full session as opt-in", "lazy-init
  on click").

### Step 4.4 — Embed payloads WITHOUT breaking out of `<script>`
The existing report-data blob escapes `<` so it can't close the tag (`report-builder.js:11-13`,
`.replace(/</g, "\\u003c")`). **This existing escape is correct and MUST stay unchanged** — it's
applied to `dataJson` (the report JSON), and `JSON.parse` reads `<` straight back to `<`, so
no un-escaping is needed (verified by reading `report-builder.js`). Phase 2 adds:
- The packed-events payload is a **JSON array of base64 strings** in
  `<script type="application/json" id="openjam-replay-bounded">`. Base64 + JSON quoting contains
  only `[A-Za-z0-9+/="\,\[\] ]` — no `<` — so it is inherently `</script>`-safe. **Apply the same
  `<` escape uniformly anyway** (cheap; future-proofs against a payload-format change). The
  keyframe-metadata JSON gets the same treatment.
- The inlined `RRWEB_PLAYER_UMD` is an *executable* `<script>` body, not data — minified
  third-party JS can legitimately contain the literal substring `</script>` inside a string
  literal or regex. **Escape `</script>` → `<\/script>` in that constant** before embedding (a
  known inline-script footgun; the `<` JSON-escape does NOT apply to executable script bodies
  because `<</script>` is not valid JS — you must use the `<\/` form, which IS valid JS). Do
  this at embed time in `buildReportHTML` (`umd.replace(/<\/(script)/gi, "<\\/$1")`), not in the
  build step, so the stored constant stays faithful. Only **one** executable constant needs this
  now (`RRWEB_UNPACK_IIFE` is gone — verification §10), but keep the replace generic in case more
  executable inlines are added.

> **Two distinct escapes, do not conflate them:** (1) `<` on *data* JSON (report + packed
> events + keyframes) — the existing footgun guard, extended; (2) `<\/script>` on *executable* JS
> (the UMD) — a different mechanism (`<` would corrupt JS). The existing `dataJson` escape at
> `report-builder.js:13` is verified intact and is **not** modified.

### Step 4.5 — New HTML template sections
Extend the returned template. Order matters (the player global must exist before the glue runs):
```
<head>
  ...
  <style>${REPORT_CSS}</style>
  ${hasReplay ? `<style>${RRWEB_PLAYER_CSS}</style>` : ""}
</head>
<body>
  <div id="app"></div>
  ${hasReplay ? `<div id="openjam-replay" hidden></div>` : ""}

  <script id="openjam-data" type="application/json">${dataJson}</script>
  ${hasReplay ? `<script id="openjam-replay-bounded" type="application/json">${packedBoundedJson}</script>` : ""}
  ${hasReplay && packedFullJson ? `<script id="openjam-replay-full" type="application/json">${packedFullJson}</script>` : ""}
  ${hasReplay ? `<script id="openjam-replay-meta" type="application/json">${metaJson}</script>` : ""}

  ${hasReplay ? `<script>${umdEscaped}</script>` : ""}    <!-- defines global rrwebPlayer (includes unpack) -->

  <script>
    ${renderSource}
    ${hasReplay ? initReplay.toString() : ""}
    var __report = JSON.parse(document.getElementById("openjam-data").textContent);
    renderReport(document.getElementById("app"), __report);
    ${hasReplay ? `initReplay({
      report: __report,
      mountInto: document.getElementById("openjam-replay"),
      timelineRoot: document.getElementById("app")
    });` : ""}
  </script>
</body>
```
- `renderReport` is still embedded via `.toString()` (unchanged pattern).
- `initReplay` is embedded the same way, and only when `hasReplay`.
- `umdEscaped` = `RRWEB_PLAYER_UMD.replace(/<\/(script)/gi, "<\\/$1")` (Step 4.4). Emitted
  **before** the glue script so the `rrwebPlayer` global exists when `initReplay` runs.
- The packed events live in `application/json` script tags (NOT `application/octet-stream` —
  they're JSON arrays of base64 strings now, not binary; corrected). Browsers don't execute
  `application/json` scripts; the runtime reads `.textContent` and `JSON.parse`s on click.
- `initReplay` does NOT parse/init on load — it only wires up a "Play replay" affordance; the
  `JSON.parse` + player init (which unpacks internally) fire on first click (Step 2.3).

---

## 5. Wiring `ui-update-current-time` ↔ existing timeline highlight

The renderer's timeline rows are built in `renderReport` (`renderer.js:213-234`), each row keyed
by event time. To highlight the row matching the player's current time:

### Step 5.1 — Expose a highlight hook from `renderReport` (small, additive change)
`renderReport` currently keeps `events` local (`renderer.js:51`) and builds rows in `render()`.
Add, without changing existing behavior:
- Tag each row element with its epoch time: `row.dataset.t = String(ev.t)` when appending
  (`renderer.js:231`).
- Attach a highlighter to the container so external code can call it:
  `container.__openjamHighlight = function (epochMs) { /* find nearest row with dataset.t <= epochMs, add .tl-active class, scrollIntoView */ };`
  Add a `.tl-active{outline:2px solid var(--accent)}` rule to `REPORT_CSS` (`renderer.js:6-48`).
This keeps `renderReport` self-contained (no new imports) and works identically in the live
preview (`viewer.js`) and the export.

### Step 5.2 — `initReplay` drives the highlighter
In `src/replay-runtime.js`:
- On `ui-update-current-time`, the handler receives an event object `e` whose `e.payload` is the
  current time **in ms relative to replay start** (0-based; verified §10 — Controller dispatches
  `{ payload: currentTime }`, currentTime is 0-based). Compute `epochMs = firstTs + e.payload`
  where `firstTs` comes from the precomputed metadata blob (Step 4.2), **not** from reading the
  packed events (they're unreadable without the player).
- Call `opts.timelineRoot.__openjamHighlight(epochMs)` (throttle to animation frames to avoid
  thrash on fast playback).
- Reverse direction: when a timeline row is clicked, call `player.goto(epochMs - firstTs)`
  (`goto`/`play` take a 0-based offset from replay start — verified §10) so the existing row-click
  affordance also scrubs the replay (nice-to-have; wire if cheap).

### Step 5.3 — Same wiring in `viewer.js` (live preview parity)
In `viewer.js` (after `renderReport(...)`), if `report.rrwebEvents.length > 1`, init the
in-extension player (Phase 1 already did this) and attach the **same** `__openjamHighlight` call
on `ui-update-current-time`. Pass `rrwebEvents` through unchanged.

> **Packed-vs-raw parity note (corrected):** Phase 1's `viewer.js` feeds the player **raw**
> (un-`pack`-ed) events — `report.rrwebEvents` from Phase 1 is raw (the recorder omits `packFn`,
> PHASE_1 §3b). The *export* feeds **packed** events. The player's internal `unpack` handles both:
> `unpack` first tries plain `JSON.parse`, and only zlib-decompresses if that fails / on the packer
> version mark (verified §10 — unpack.ts). So the same `rrwebPlayer` works on raw events (live
> preview) and packed events (export) with no code change. The behaviours are therefore equivalent
> but **not byte-identical inputs** — the export is the live preview with events compressed, not a
> literal freeze. Adjust the wording in §6/§8 that calls the export "the live preview frozen to
> disk": it's the live preview *re-rendered from compressed events*.

---

## 6. Risks & mitigations

1. **Export file size (biggest risk).** Fixed overhead is player UMD + CSS + unpack + glue
   (~250–350 KB minified, gated in Step 3.2). The variable part is the events payload.
   *Mitigation:* bounded window is the default and is capped by Phase 1's ring buffer (§3:
   5-min/60s ≈ low single-digit MB). Full session is opt-in and hard-capped (40 MB base64). The
   `hasReplay` gate means no-replay reports pay zero overhead.

2. **Base64 inflation (~1.33× per event) + JSON overhead.** Each `pack`-ed event is base64
   (~4/3 of its zlib bytes) plus JSON quoting/commas. *Mitigation:* the hard cap is defined on the
   **measured `JSON.stringify(events.map(pack))` byte length** in `buildReportHTML` (Step 3.2/3.3),
   so the gate sees the true embedded size regardless of inflation breakdown. fflate zlib shrinks
   each event before base64, so bounded payloads stay small. **No `String.fromCharCode`/manual
   base64 concern** — `pack` returns base64 strings directly (verification §10); we never touch a
   raw `Uint8Array`, so the chunked-encoder workaround is unnecessary and was removed.

3. **Unpack-on-open performance.** The player's internal per-event `unpack` (zlib via fflate's
   synchronous `unzlibSync`, verified §10 — no workers) + JSON materialization of a large session
   can block the main thread for hundreds of ms. *Mitigation:* parse + player init are **lazy on
   click** (§6), not on load, so first paint is unaffected; show the "large replay loading" notice
   (Step 3.2 soft threshold); keep the default payload bounded so the common path is fast. fflate
   is pure-JS and runs synchronously in a `file://` page with no worker (verified §10), so the
   offline file needs no worker — keep the work on the main thread with a visible spinner. (A Web
   Worker is possible but `file://` worker support is browser-inconsistent — do NOT rely on it.)

4. **CSP.** §6 and `report-builder.js:5` assert `file://` has no CSP, so inline `<script>` runs.
   *Confirm explicitly in dogfood (Step 7)*: open the exported file with DevTools console open and
   verify there are **zero** CSP violation messages and the inline player script executed. If any
   Chromium release ever ships a `file://` CSP, this whole approach (and the existing JSON-inline
   approach) breaks — so this confirmation is a required gate, not a formality. Note: the
   in-extension `viewer.html` still uses external scripts (MV3 `script-src 'self'`,
   `viewer.js:1-3` / `viewer.html:23`); only the **exported** file inlines. Do not regress that.

5. **Large-DOM snapshot parse cost.** rrweb `FullSnapshot` ≈ 263 KB and ~10× page HTML (§3);
   rebuilding it into the player's iframe on first play can be heavy for DOM-huge pages.
   *Mitigation:* lazy-init (already), and seek via the nearest segment keyframe (§6) rather than
   rebuilding from t=0; the player rebuilds from one `FullSnapshot` + deltas, not the whole
   session. inlineImages/inlineStylesheet (§4) mean assets are in the snapshot — good for offline
   fidelity but adds to snapshot size; this is the §5 fidelity/size trade-off, accepted.

6. **Player/packer version skew (largely mitigated by §10 finding).** Since the **player carries
   its own `unpack`** and we `pack` at export with `@rrweb/packer`, both must agree on the packer
   version mark. `unpack` throws on a mismatched `v` mark (verified §10 — unpack.ts validates
   `e.v === MARK`). *Mitigation:* pin exact versions (`rrweb-player@2.0.1` + `@rrweb/packer@2.0.1`,
   both confirmed `dist-tags.latest`, §10); CI fails if `package-lock` versions drift. Add
   `@rrweb/packer@2.0.1` to Phase 1's deps — PHASE_1 §1a installs only `rrweb`+`rrweb-player`, so
   **Phase 2 must `npm install --save-exact @rrweb/packer@2.0.1`** (it is NOT a Phase 1 dep; the
   PHASE_2 §0 dependency list wrongly implies Phase 1 installs it — corrected below).

7. **`ui-update-current-time` API shape (now verified §10).** The handler receives an event object
   with `.payload` = current time in ms relative to replay start (0-based). The plan's `e.payload`
   usage (Step 5.2, and Phase 1 viewer.js) is **correct**. *Mitigation retained:* the dogfood step
   (7) still exercises it end-to-end as a belt-and-braces check, but this is no longer an unverified
   load-bearing assumption.

---

## 7. DOGFOOD verification — "I can see it working offline"

The standard is **literally watching the replay play and scrub from a disk file with the network
off.** Tests that don't do this do not count as done.

### Step 7.1 — Build
1. `npm run build:assets` → confirm `src/generated/replay-assets.js` and
   `replay-assets.sizes.json` exist; eyeball the recorded sizes.
2. `npm run size:check` → must pass the fixed-overhead gate (Step 3.2).
3. `npm run build` → full extension bundle builds with no errors.

### Step 7.2 — Record a real session
4. Load the unpacked extension in Chrome. Open a non-trivial real page (interactive: clicks,
   scrolls, a network request or two, ideally an error). Start OpenJam capture, interact for
   ~30–60s so there is `rrwebEvents.length > 1` and at least one checkout/segment.
5. Stop capture, open the in-extension report (`viewer.html`). Confirm the live player plays AND
   the timeline highlight moves with `ui-update-current-time` (Phase 1 + Step 5.3).

### Step 7.3 — Export
6. Click "Download self-contained HTML". Note the file size; sanity-check it against the payload
   budget (Step 3).

### Step 7.4 — The offline proof (the actual standard)
7. **Turn the network OFF** (disable Wi-Fi / pull ethernet, or DevTools "Offline" is NOT enough —
   physically/OS-level disable so a `file://` page truly can't reach anything).
8. Open the exported `.html` **directly from disk** (`file://…/openjam-….html`) in a fresh
   browser profile/window.
9. Open DevTools console BEFORE interacting. Confirm:
   - **Zero** failed network requests (no CDN, no font, no analytics — fully self-contained).
   - **Zero** CSP violations (Risk 4 confirmation).
10. Click the "Play replay" affordance. Confirm:
    - The player lazy-inits (`JSON.parse` of packed events happens now, not on load).
    - **No `unpack`/version-mark errors in the console** — the player's internal `unpack`
      successfully decompressed every packed event (proves the export `pack` ↔ player `unpack`
      versions agree; Risk 6). A garbled/blank replay with a thrown `unpack` error = FAIL.
    - The replay **actually plays** — DOM reconstructs and animates.
    - **Scrubbing works** — drag the player's progress bar; the replay seeks.
    - The OpenJam **timeline highlight tracks** the replay's current time (Step 5).
11. If full-session opt-in was embedded: click "Load full session", confirm it loads and plays the
    longer session.
12. Repeat 8–10 in a **second browser** (e.g. Firefox or Safari) opening the same file from disk —
    the export is plain `file://` HTML+JS and should be browser-agnostic even though capture is
    Chromium-only in this phase.

### Step 7.5 — Negative / edge checks
13. Export a report where `rrwebEvents.length <= 1` → confirm NO player is embedded, file is small,
    and the timeline still renders (regression check on the `hasReplay` gate).
14. Export a deliberately large session → confirm the hard-cap fallback to bounded-only triggers
    and logs the byte counts (Step 3.2), and the file still opens and plays the bounded window.

**Done = step 10 observed working with the network physically off.** Anything less is not done.

---

## 8. Summary of file changes

| File | Change |
|---|---|
| `report-builder.js` | Add replay imports (`pack`, player UMD/CSS strings, `initReplay`); compute `hasReplay`/bounded/full + per-event `pack` → JSON array of base64 strings + keyframe/`firstTs` metadata; `<\/script>`-escape the UMD constant + `<`-escape data JSON (existing escape kept); extend HTML template with player CSS, `application/json` packed-events + meta payload(s), player UMD, and `initReplay.toString()` glue. **No unpack IIFE — player carries unpack.** |
| `renderer.js` | Tag rows with `dataset.t`; expose `container.__openjamHighlight`; add `.tl-active` CSS. (Additive, parity for preview + export.) |
| `viewer.js` | Pass `rrwebEvents` through; attach `__openjamHighlight` on the in-extension player's `ui-update-current-time`; surface full-session opt-in. |
| `src/replay-runtime.js` (NEW) | `initReplay()` — lazy `JSON.parse` + player init on click (player unpacks internally), seek via precomputed keyframes, drive timeline highlight. Self-contained (browser + the one inlined `rrwebPlayer` global only). |
| `build/inline-assets.mjs` (NEW) | Emit `RRWEB_PLAYER_UMD`, `RRWEB_PLAYER_CSS` string constants + size manifest. (No unpack entry/constant.) |
| `build/check-export-size.mjs` (NEW) | Fixed-overhead size gate; CI-enforced. |
| `src/generated/replay-assets.js` (NEW, git-ignored) | Build output: the **two** inlinable string constants (player UMD + CSS). |
| `package.json` | Add `@rrweb/packer@2.0.1` dep; add `build:assets`, `size:check`; sequence `build:assets` before the main bundle in both `build` and `watch`. |

**Constitutional anchors:** simplest-thing-that-works (reuse the existing `.toString()` inline
pattern; reuse the player's built-in `unpack` rather than inlining a second copy — verification §10);
design for the real constraint (browser inline-JSON choke → per-event `pack` so each event ships
zlib-compressed base64, §3/§6); verifiability built in (the dogfood standard is an observable
offline play, Step 7).

---

## 9. Sources

Codebase facts (this repo) — followable file paths, all verified for this plan:
- `/Users/ian.hogers/projects/openjam/report-builder.js` — current inline pattern: JSON blob +
  `renderReport.toString()`; `<`-escape `.replace(/</g, "\\u003c")` (lines 11–13); `file://`/no-CSP
  comment (line 5).
- `/Users/ian.hogers/projects/openjam/renderer.js` — `renderReport` self-containment rule (lines
  1–4); `REPORT_CSS` (lines 6–48); row construction / append (lines 213–234).
- `/Users/ian.hogers/projects/openjam/viewer.js` — export download flow (lines 30–40); MV3
  external-script rationale (lines 1–3).
- `/Users/ian.hogers/projects/openjam/viewer.html` — `<script type="module" src="viewer.js">`
  (line 23).
- `/Users/ian.hogers/projects/openjam/manifest.json` — MV3, no `package.json` present in repo yet
  (confirms Phase 1 owns build setup).
- `/Users/ian.hogers/projects/openjam/REPLAY_DESIGN.md` — §6 self-contained export (lines 112–120),
  §2 rrweb specifics (lines 38–46), §3 compression & sizes (lines 50–72), §7 phases (lines 124–132).

External / framework facts — followable URLs (mirroring REPLAY_DESIGN.md §"Key sources", lines
134–144; verify against these before implementing, since stale web results conflict):
- rrweb-player UMD build (`dist/rrweb-player.umd.cjs`), `ui-update-current-time` event, player
  props/API: https://github.com/rrweb-io/rrweb/tree/master/packages/rrweb-player
- rrweb / rrweb-player version pin `2.0.1` (registry `dist-tags.latest`):
  https://registry.npmjs.org/rrweb-player and https://registry.npmjs.org/rrweb
- `@rrweb/packer` `pack`/`unpack` (fflate) + compress-whole-session recipe:
  https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/optimize-storage.md
- rrweb event types (`FullSnapshot` = type 2), snapshot semantics:
  https://github.com/rrweb-io/rrweb/blob/master/guide.md
- FullSnapshot ≈ 263 KB / ~10× page HTML, per-event sizes (PostHog benchmark):
  https://posthog.com/blog/session-recording-performance
- esbuild JS API (`build({ write: false })`, `--bundle --minify --format=iife`):
  https://esbuild.github.io/api/
- `</script>` inside inline-script-string breakout footgun (escape `</script>` → `<\/script>`):
  https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
- base64 size overhead (4/3 inflation): https://developer.mozilla.org/en-US/docs/Glossary/Base64

---

## 10. Verification (adversarial review — 2026-06-09)

Packages were not installed locally, so all rrweb claims were checked against the npm registry and
the rrweb GitHub `master` source. Verdict per claim:

### Claim 1 — `@rrweb/packer`: name, exports, API, inlinability
**CORRECTED.** Package name `@rrweb/packer` is correct; `dist-tags.latest = 2.0.1` (published
2026-06-03), `main: ./dist/packer.cjs`, `module: ./dist/packer.js`, with `./pack` and `./unpack`
sub-exports. It DOES export `pack` and `unpack`.
- **But the plan's central assumption was wrong:** `pack`/`unpack` are **per-event**, not
  whole-array. `pack(event)` wraps one event, `zlibSync(strToU8(JSON.stringify(e)))`, returns a
  **base64 string** (`strFromU8(..., true)`). `unpack(raw: string)` returns ONE `eventWithTime`
  (tries plain `JSON.parse` first, else `unzlibSync`; validates a version `MARK`). There is no
  array codec. The plan's "pack the whole array once → atob → unpack the blob" was unexecutable.
  Corrected to per-event `events.map(pack)` → JSON array of base64 strings.
- **Bigger correction:** `@rrweb/packer`'s `unpack` does NOT need inlining at all — see Claim 2.
  The plan's `RRWEB_UNPACK_IIFE` / `build/entries/unpack-entry.js` are removed.
- Source: https://registry.npmjs.org/@rrweb/packer ·
  https://github.com/rrweb-io/rrweb/blob/master/packages/packer/src/pack.ts ·
  .../packer/src/unpack.ts ·
  https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/optimize-storage.md
- Change: §0 dep list, §1 architecture, §2.1, §4.1, §4.2 corrected to per-event pack; unpack-inline
  path removed throughout.

### Claim 2 — `rrweb-player` UMD, global name, CSS
**CONFIRMED (with a material addition).** `rrweb-player@2.0.1` (`dist-tags.latest`) ships
`dist/rrweb-player.umd.cjs` (package.json `main` + `unpkg`), and `dist/style.css` (exported as
`./dist/style.css`). The UMD defines the global **`rrwebPlayer`** (lowercase r) — the plan's
`window.rrwebPlayer` capitalization in §1 was inconsistent; standardized to `rrwebPlayer`. CSS is
separate and MUST be inlined as a `<style>` (confirmed). 
- **Material addition:** `Player.svelte` does `new Replayer(events, { unpackFn: unpack, ...$$props })`
  — i.e. **the player imports `@rrweb/packer`'s `unpack` and applies it per-event internally.** So
  packed events can be passed straight to `rrwebPlayer({ props: { events } })` and the player
  unwraps them. This is why Claim 1's separate unpack inline is unnecessary.
- The UMD is a Vite **production** build (already minified) — do NOT re-bundle it (would risk
  breaking the global). Plan §2.1 corrected (was: "run through esbuild --minify --bundle").
- Source: https://unpkg.com/rrweb-player@2.0.1/package.json ·
  https://github.com/rrweb-io/rrweb/blob/master/packages/rrweb-player/package.json ·
  https://raw.githubusercontent.com/rrweb-io/rrweb/master/packages/rrweb-player/src/Player.svelte
- Change: §1, §2.1, §4.5 (global name, no re-bundle, CSS inline kept).

### Claim 3 — base64 + fflate decode-on-open soundness; sync in `file://`
**CONFIRMED, with the mechanism corrected.** fflate runs **synchronously** with no workers
(`unzlibSync`/`unzlibSync` in `pack.ts`/`unpack.ts`), so it works in a `file://` page with no
worker — the plan's "no workers needed" is right. But the decode is NOT a manual `atob`+`unpack` of
a single blob; it is the **player's internal per-event `unpack`** triggered by feeding it packed
events. The on-click work is `JSON.parse(packed array)` + the player's per-event unzlib. Plan §1,
§2.3, §3, Risk 3 corrected accordingly.
- Source: .../packer/src/unpack.ts (synchronous `unzlibSync`) ·
  https://github.com/rrweb-io/rrweb/blob/master/docs/recipes/optimize-storage.md

### Claim 4 — `</script>` escaping for executable inlines vs. the existing JSON `<`-escape
**CONFIRMED, and the existing escape is intact.** `report-builder.js:13` does
`JSON.stringify(report).replace(/</g, "\\u003c")` on the report data — verified present and
correct; Phase 2 does NOT touch it. The plan correctly identifies TWO distinct escapes: (1) `<`→
`<` on data JSON (footgun guard, extended to the new JSON payloads), and (2) `</script>`→
`<\/script>` on the **executable** UMD constant (a different mechanism — `<` is invalid inside
raw JS, so `<\/` is required). After removing the unpack IIFE there is exactly ONE executable
constant needing the `<\/script>` escape (the player UMD). The `replace(/<\/(script)/gi,"<\\/$1")`
in §4.4 is correct. Hardened the §4.4 wording to prevent conflating the two.
- Source: https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
- Change: §4.4, §4.5 (one executable constant, not two).

### Claim 5 — size gating feasibility & base64 inflation cap logic
**CONFIRMED, simplified.** Build-time size measurement is trivial and needs no esbuild minify pass:
the shipped UMD is already minified, so `inline-assets.mjs` just `Buffer.byteLength`s the file
contents it already holds. The per-export cap: since each event is `pack`-ed to base64 individually,
there is no single "1.37× base64 blob" — the plan's 1.37× framing was approximate. Corrected to
**measure the true `JSON.stringify(events.map(pack))` byte length** via `TextEncoder` (browser
context — `Buffer` is NOT available in the extension page; the plan said `Buffer.byteLength` OR
`TextEncoder`, corrected to `TextEncoder` only). The gate is exact because it measures the literal
embedded string.
- Source: https://esbuild.github.io/api/ · https://developer.mozilla.org/en-US/docs/Glossary/Base64
- Change: §3.1, §3.2, §3.3.

### Cross-cutting / internal consistency
- **CORRECTED — `@rrweb/packer` is not a Phase 1 dep.** PHASE_1 §1a installs only
  `rrweb`+`rrweb-player`+`esbuild`. PHASE_2 §0 wrongly listed `@rrweb/packer` as already-installed.
  Phase 2 now owns `npm install --save-exact @rrweb/packer@2.0.1`. Source: PHASE_1_PLAN §1a.
- **CORRECTED — import path layout.** `report-builder.js` sits at the **repo root** (PHASE_1 §0),
  so `import "./generated/..."` would resolve to repo-root, not `src/`. Standardized to
  `./src/...` prefix (§2.2 note, §4.1).
- **CORRECTED — build script chaining.** PHASE_1's build is `node build.mjs`; §2.2 now chains
  `build:assets` before BOTH `build` and `watch` (previously only `build`, which would have left
  `watch` without the generated assets).
- **CORRECTED — packed events are unreadable by the runtime.** The runtime cannot inspect `type`/
  `timestamp` on packed base64 strings, so segment-keyframe seeking and the `firstTs` epoch
  conversion must use **precomputed metadata** embedded at export time (§4.2 new step). The
  original §2.3/§5.2 implied reading event fields from the payload — unexecutable on packed data.
- **CONFIRMED — `ui-update-current-time` exists; payload shape verified.** Controller dispatches
  `{ payload: currentTime }`; `currentTime` is **0-based ms from replay start**. The handler's
  `e.payload` (Step 5.2, Phase 1 viewer.js) is correct, and `firstTs + e.payload = epoch` is the
  right conversion. `goto`/`play` take a 0-based offset. Source:
  https://raw.githubusercontent.com/rrweb-io/rrweb/master/packages/rrweb-player/src/Controller.svelte
- **NOTED — export ≠ byte-identical to live preview.** Live preview feeds RAW events; export feeds
  PACKED events (player unpacks both). Behaviour is equivalent; "frozen to disk" wording softened
  (§5.3).
- **CONFIRMED — dogfood proves offline play.** Step 7.4 physically disables the network (not just
  DevTools Offline), opens from `file://`, checks zero failed requests + zero CSP violations, and
  requires observed play + scrub + timeline sync. Added an explicit **"no `unpack`/version-mark
  error"** check (Step 7.4.10) so a silent decode failure can't pass as success. This is a genuine
  offline-play proof, not merely "the file opens".

### STILL-UNVERIFIABLE (must be confirmed at implementation time)
- Exact `dist/style.css` selector names and whether the player's controls render correctly when the
  CSS is inlined into a `file://` page (visual — only the dogfood Step 7.4 can confirm).
- That `rrweb-player`'s UMD genuinely needs no other global (e.g. no peer that must be loaded
  first). The `package.json` shows no `peerDependencies` requiring a separate global, and the UMD
  bundles its deps, but confirm with `ls node_modules/rrweb-player/dist/` + a smoke load after
  install (PHASE_1 §7 VERIFY-FIRST gate already mandates this `ls`/`grep`).
- Whether `slimDOMOptions`/`inlineImages` from Phase 1 produce a FullSnapshot that replays fully
  offline (asset-completeness is a §5 fidelity concern, observable only in Step 7.4).
