# OpenJam — Phase 1 Implementation Plan: rrweb capture + in-extension replay (Chromium)

**Scope source:** `REPLAY_DESIGN.md` §7 "Phase 1", grounded in §2 (rrweb specifics), §3 (bounded
memory), §4 (record config), §6 (player wiring).
**Goal:** True DOM session replay, captured by rrweb in a content script, persisted to IndexedDB,
flattened into the existing report on stop, and played back inside `viewer.html` with the
`rrweb-player`, its current-time synced to the existing timeline highlight.

**This plan does NOT touch:** the self-contained export (`report-builder.js` — that is Phase 2),
CDP pixel keyframes (Phase 3), or cross-browser/Firefox/Safari (Phase 4). The existing
`chrome.debugger` capture path in `background.js` is left running **unchanged and in parallel**;
rrweb is an additive lane per §1 ("different layers… no conflict").

A reader should be able to execute every step mechanically. Every file path is absolute-from-repo-root
of `/Users/ian.hogers/projects/openjam`.

---

## 0. Critical architecture decision: build into `dist/`, load unpacked from `dist/`

The repo currently has **no build** — `manifest.json`, `popup.html`, `viewer.html`, and the loose
JS files load directly from the repo root. `.gitignore` already ignores `node_modules/` and
`dist/`. rrweb MUST be bundled (MV3 §2: "bundle rrweb… never CDN-load").

**Decision:** introduce esbuild. The build bundles all JS **entrypoints** and copies static assets
into `dist/`. **The unpacked extension is loaded from `dist/`, not the repo root.** Rationale:

- Source stays clean ES modules; `import "rrweb"` resolves only after bundling.
- `dist/` is already gitignored, so no committed build artifacts.
- Single source of truth for what ships: everything the browser sees lives in `dist/`.

`dist/` layout after a build:

```
dist/
  manifest.json          (copied verbatim, but with updated file refs — see Step 6)
  popup.html             (copied; still references popup.js)
  popup.js               (bundled, IIFE)
  viewer.html            (copied; references viewer.js as module + viewer.css as stylesheet)
  viewer.js              (bundled ESM — includes rrweb-player + renderer + report-builder)
  viewer.css             (esbuild sibling output — rrweb-player CSS gathered from viewer.js's import)
  background.js          (bundled ESM service worker)
  recorder.js            (bundled IIFE content script — NEW, includes rrweb record())
```

Note: `renderer.js` and `report-builder.js` are **not** separate files in `dist/` — esbuild inlines
them into `viewer.js`. This is fine for Phase 1. (Phase 2 will revisit `report-builder.js` because
the exported file embeds `renderReport.toString()`; bundling could rename it. See §Dependency note.)

---

## 1. Add npm + pinned dependencies

**Files created:** `/package.json`, `/package-lock.json` (generated).

### 1a. Exact install commands

Run from the repo root:

```bash
npm init -y
npm install --save-exact --save-dev esbuild@0.24.0
npm install --save-exact rrweb@2.0.1 rrweb-player@2.0.1
```

Pinned versions (REPLAY_DESIGN.md §2 mandates rrweb/​player 2.0.1; esbuild pinned for reproducible
builds):

- `rrweb@2.0.1`
- `rrweb-player@2.0.1`
- `esbuild@0.24.0` (devDependency)

`--save-exact` writes exact versions (no `^`) so the bundle is reproducible.

### 1b. package.json scripts

After `npm init -y`, edit `/package.json` to this shape (keep the generated `name`/`version`):

```json
{
  "name": "openjam",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "watch": "node build.mjs --watch",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "esbuild": "0.24.0"
  },
  "dependencies": {
    "rrweb": "2.0.1",
    "rrweb-player": "2.0.1"
  }
}
```

`"type": "module"` lets `build.mjs` use ESM `import`. (It does not affect the bundled extension
output — esbuild sets each entry's format explicitly.)

---

## 2. esbuild build script

**File created:** `/build.mjs`

This is a small Node script (not a config object) so we can also copy static assets and emit
`rrweb-player`'s CSS. Key requirements:

- `background.js` → ESM (manifest declares `"type": "module"` for the worker).
- `viewer.js` → ESM (the page loads it with `<script type="module">`).
- `popup.js` → IIFE (classic `<script src>`).
- `recorder.js` → IIFE (content scripts are NOT modules; they run in an isolated classic scope).
- `rrweb-player`'s CSS: `import "rrweb-player/dist/style.css"` from `viewer.js`. **CORRECTION
  (verified):** esbuild's built-in `css` loader does **NOT** inline CSS into the JS or inject a
  `<style>` at runtime. It emits a **sibling CSS file** next to the JS bundle (so `viewer.js` →
  `dist/viewer.js` + `dist/viewer.css`) and does **not** auto-link it. We therefore (a) keep the CSS
  import in `viewer.js` so esbuild gathers it, and (b) add a `<link rel="stylesheet" href="viewer.css">`
  to `viewer.html` ourselves (Step 7a). The CSS ships as a local `'self'` asset — still CSP-clean, no
  CDN. (Source: https://esbuild.github.io/content-types/#css-from-js)

```js
// build.mjs
import * as esbuild from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const outdir = "dist";

const STATIC = [
  ["manifest.dist.json", "manifest.json"], // see Step 6 — built manifest points at dist files
  ["popup.html", "popup.html"],
  ["viewer.html", "viewer.html"],
];

const ENTRIES = [
  { in: "background.js", format: "esm" },
  { in: "viewer.js",     format: "esm" },
  { in: "popup.js",      format: "iife" },
  { in: "recorder.js",   format: "iife" }, // NEW content script (Step 3)
];

async function build() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  const ctxs = await Promise.all(
    ENTRIES.map((e) =>
      esbuild.context({
        entryPoints: [e.in],
        outfile: `${outdir}/${e.in}`,
        bundle: true,
        format: e.format,
        platform: "browser",
        target: "chrome120",
        sourcemap: true,            // inline maps aid dogfood debugging; harmless in dist
        loader: { ".css": "css", ".svg": "dataurl" },
        logLevel: "info",
      }),
    ),
  );

  for (const [src, dst] of STATIC) await copyFile(src, `${outdir}/${dst}`);

  if (watch) {
    await Promise.all(ctxs.map((c) => c.watch()));
    console.log("watching…");
  } else {
    await Promise.all(ctxs.map((c) => c.rebuild()));
    await Promise.all(ctxs.map((c) => c.dispose()));
    console.log("built dist/");
  }
}

build().catch((e) => { console.error(e); process.exit(1); });
```

**Why a per-entry context array:** the four entrypoints need three different `format` values, and
esbuild's `format` is per-build, not per-entry. So we run one build context per entry.

**rrweb-player CSS:** `rrweb-player` ships `dist/style.css` (verified present in the published
package). In `viewer.js` (Step 7) we `import "rrweb-player/dist/style.css"`. esbuild gathers it and
emits a **sibling `dist/viewer.css`** (it does NOT inline or auto-inject — see correction above). We
link it ourselves from `viewer.html` (Step 7a). The CSS is a local `'self'` file — CSP-clean, no CDN.

**`viewer.css` is an esbuild side-output**, not an `ENTRIES`/`STATIC` item — you don't list it in the
build config; it appears automatically next to `viewer.js`. So the `dist/` layout in §0 gains a
`viewer.css` line (update §0 accordingly).

**Verification of Step 2:** `npm run build` exits 0 and creates the `dist/` files listed in §0.
Confirm: `ls dist/` shows `background.js viewer.js viewer.css popup.js recorder.js manifest.json
popup.html viewer.html`.

---

## 3. Content-script recorder (NEW)

**File created:** `/recorder.js` — bundled to `dist/recorder.js` as an IIFE content script.

Per REPLAY_DESIGN.md §2 + §3: `rrweb.record()` runs **in the content script** (the SW has no DOM
and is killed). Inject ISOLATED world at `document_start`, match `<all_urls>`, relay via
`chrome.runtime.sendMessage`. ISOLATED world has `chrome.runtime`, so no postMessage bridge.

### 3a. Recorder responsibilities

1. Listen for a `recorder:start` / `recorder:stop` message from the background SW (the recorder
   does NOT auto-start on every page; only when OpenJam is recording this tab).
2. On start: call `rrweb.record()` with the §4 config, building the **segment ring buffer**.
3. On each `emit(event)`: append to the current segment; when `isCheckout === true` (a fresh
   FullSnapshot forced by `checkoutEveryNms`), **flush the completed segment to IndexedDB** and
   start a new segment with this checkout event as element 0.
4. Maintain the bounded window by trimming whole leading segments (in-memory bound; the on-disk
   store is append-only per §3 "append-only segments").
5. On stop: stop the recorder, flush the final (partial) segment to IndexedDB, send `recorder:stopped`
   ack with the segment count.

### 3b. record() config (verbatim from REPLAY_DESIGN.md §4, with packFn omitted in Phase 1)

Phase 1 stores **raw** events (no `@rrweb/packer`); compression is a Phase 2 export concern
(§3 "Compress the whole session once on export"). So drop `packFn` here.

```js
// recorder.js  (bundled IIFE, ISOLATED world, document_start)
import { record } from "rrweb";
import { putSegment, clearTab } from "./recorder-db.js"; // Step 4

const RING_WINDOW_MS = 5 * 60 * 1000; // 5-min bounded window (§3). Infinity = full session.
const CHECKOUT_MS = 60_000;

let stopFn = null;
let tabId = null;            // provided by background on start
let segIndex = 0;
let current = [];            // current segment: [FullSnapshot, ...deltas]
let firstWall = null;

function flushCurrent() {
  if (!current.length) return;
  const seg = current;
  const idx = segIndex++;
  current = [];
  // append-only persistence keyed by (tabId, segmentIndex) — §3
  putSegment(tabId, idx, seg).catch((e) => console.warn("[openjam] putSegment failed", e));
}

function startRecording(incomingTabId) {
  if (stopFn) return;
  tabId = incomingTabId;
  segIndex = 0;
  current = [];
  firstWall = Date.now();

  stopFn = record({
    emit(event, isCheckout) {
      // isCheckout is true on the forced FullSnapshot boundary
      if (isCheckout && current.length) flushCurrent();
      current.push(event);
      // in-memory ring bound: drop whole leading segments older than the window.
      // (Disk store stays append-only; the player reads from disk on stop.)
      // Trim logic lives in the segment index math, not here, because flushed
      // segments leave memory immediately. current[] only ever holds one segment.
    },
    checkoutEveryNms: CHECKOUT_MS,
    sampling: { mousemove: 50, scroll: 150, media: 800, input: "last" },
    slimDOMOptions: {
      script: true, comment: true, headFavicon: true, headWhitespace: true,
      headMetaDescKeywords: true, headMetaSocial: true, headMetaRobots: true,
      headMetaHttpEquiv: true, headMetaAuthorship: true, headMetaVerification: true,
    },
    inlineStylesheet: true,
    inlineImages: true,
    maskAllInputs: true,
    recordCanvas: false,
    dataURLOptions: { type: "image/webp", quality: 0.6 },
    recordCrossOriginIframes: false,
  });
}

async function stopRecording() {
  if (stopFn) { stopFn(); stopFn = null; }
  flushCurrent(); // final partial segment
  return { segmentCount: segIndex, firstWall };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.action === "recorder:start") {
    // clear any stale segments for this tab before a fresh recording
    clearTab(msg.tabId).then(() => { startRecording(msg.tabId); sendResponse({ ok: true }); });
    return true;
  }
  if (msg && msg.action === "recorder:stop") {
    stopRecording().then((r) => sendResponse({ ok: true, ...r }));
    return true;
  }
  return false;
});
```

> **Memory-bound clarification (§3):** because each completed segment is flushed to IndexedDB and
> dropped from memory immediately on checkout, the content script never holds more than one segment
> (~60s of events) in RAM. The 5-min "window" is enforced at **read/flatten time** in the background
> (Step 5), where we take only the trailing `RING_WINDOW_MS` worth of whole segments. This satisfies
> the §3 bound "≤ (window/checkout + 1) × segment_size" without the recorder having to retain
> in-memory history. Trimming only whole leading segments, never orphaning the FullSnapshot, is the
> Sentry discard-on-checkout rule (§3).

### 3c. document_start ordering / FullSnapshot-first guard (§5 "Corruption guards")

`record()` synchronously emits the FullSnapshot as event 0 of segment 0, before any incremental
mutation observers fire. Because we only call `startRecording` on an explicit `recorder:start`
message (after the page has a DOM), the first emitted event is guaranteed to be the FullSnapshot.
Add a defensive assert: if `current.length === 0` and the first event's `type !== 2` (rrweb
`EventType.FullSnapshot`), log a warning — but do not block (rrweb guarantees this ordering).

---

## 4. IndexedDB persistence module (NEW)

**File created:** `/recorder-db.js` — imported by both `recorder.js` (writes) and `background.js`
(reads on stop). Bundled into each consumer by esbuild.

Per §3: IndexedDB, append-only, keyed by `(tabId, segmentIndex)`. `chrome.storage.local` is capped
at ~10 MB — too small for raw event buffers — so IndexedDB is mandatory.

> **CORRECTION — `"unlimitedStorage"` does NOT raise this DB's quota (verified).** This content-script
> IndexedDB lives in the **page origin** (see DB-scope note below), and `"unlimitedStorage"` applies
> only to the **extension origin** (extension `chrome.storage.local` / extension-origin IndexedDB /
> CacheStorage), never to page-origin storage a content script touches. Page-origin IndexedDB is
> instead governed by the browser's normal per-origin quota (a large fraction of free disk — ample for
> short Phase-1 captures). So `"unlimitedStorage"` is **not** what protects the segment store. It is
> still worth keeping in the manifest because the **final report** — including inline `rrwebEvents` —
> is persisted via the SW's `chrome.storage.local.set` (background.js), which *is* extension-origin and
> *does* benefit from `"unlimitedStorage"` (Step 5 / Risks). Update the Step 6 rationale accordingly.
> (Source: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies — content
> scripts access the host page's web storage, not the extension's.)

```js
// recorder-db.js
const DB_NAME = "openjam-replay";
const STORE = "segments";
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // composite key [tabId, segmentIndex]; index by tabId for range reads
        const os = db.createObjectStore(STORE, { keyPath: ["tabId", "segmentIndex"] });
        os.createIndex("byTab", "tabId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putSegment(tabId, segmentIndex, events) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ tabId, segmentIndex, events, wall: events[0] && events[0].timestamp });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Reads all segments for a tab, ordered by segmentIndex.
export async function getSegments(tabId) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const out = [];
    const range = IDBKeyRange.bound([tabId, -Infinity], [tabId, Infinity]);
    const cur = tx.objectStore(STORE).openCursor(range);
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { out.push(c.value); c.continue(); }
      else resolve(out.sort((a, b) => a.segmentIndex - b.segmentIndex));
    };
    cur.onerror = () => reject(cur.error);
  });
}

export async function clearTab(tabId) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const range = IDBKeyRange.bound([tabId, -Infinity], [tabId, Infinity]);
    const cur = tx.objectStore(STORE).openCursor(range);
    cur.onsuccess = () => { const c = cur.result; if (c) { c.delete(); c.continue(); } };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

> **Note on DB scope:** IndexedDB is **origin-partitioned**. The content script's `recorder-db.js`
> writes to the **page origin's** IndexedDB; the SW reads from the **extension origin's** IndexedDB —
> these are *different* databases. Therefore the SW cannot read what the content script wrote
> directly. **Resolution for Phase 1:** the content script reads its own segments back and ships
> them to the SW in the `recorder:stopped` response payload (segments are already capped to ~1 segment
> in memory per flush, but on stop we re-read all of this tab's segments from the page-origin DB and
> return them). See Step 5 for the corrected message flow. The SW does NOT open IndexedDB itself in
> Phase 1.
>
> This is a correction to the literal design-doc wording ("read segments from IndexedDB" in the SW).
> The doc's intent — durable, append-only, bounded storage that survives SW suspension — is fully
> preserved; only the *reader* changes from SW to content-script, because the content script owns the
> page-origin DB. Flag this to the design owner.

Accordingly, add to `recorder.js` a `getSegments`-based read on stop:

```js
import { putSegment, getSegments, clearTab } from "./recorder-db.js";
// ... in stopRecording():
async function stopRecording() {
  if (stopFn) { stopFn(); stopFn = null; }
  flushCurrent();
  const segs = await getSegments(tabId);   // re-read this tab's append-only segments
  return { segmentCount: segs.length, firstWall, segments: segs };
}
```

---

## 5. Background orchestration changes

**File modified:** `/background.js`.

The existing `chrome.debugger` flow is untouched. We add an rrweb lane that:

1. On `start`: after `startRecording(tab.id)` (the existing CDP attach), also tell the content
   script to start rrweb.
2. On `stop`: before building the report, tell the content script to stop rrweb and return its
   segments; flatten them into `report.rrwebEvents`.

### 5a. Add a top-of-file import

```js
// background.js — at top
// (recorder-db import NOT needed in the SW for Phase 1; segments arrive via message)
```

### 5b. Start hook — extend the existing `startRecording`

In `startRecording(tabId)`, after `await captureScreenshot("Recording started");` and before
`return { ok: true };`, add:

```js
  // Kick off rrweb capture in the page (content script is already injected at document_start).
  try {
    await chrome.tabs.sendMessage(tabId, { action: "recorder:start", tabId });
  } catch (err) {
    // Content script may not be present on chrome:// or the extension gallery — degrade gracefully.
    console.warn("[openjam] rrweb start failed (no content script on this page):", err);
  }
```

### 5c. Stop hook — extend the existing `stopRecording`

In `stopRecording()`, capture the rrweb segments **before** detaching the debugger and building the
report. Add right after `const tabId = session.tabId;`:

```js
  let rrwebEvents = [];
  try {
    const res = await chrome.tabs.sendMessage(tabId, { action: "recorder:stop" });
    if (res && res.segments) {
      // §3: bounded window — keep only trailing RING_WINDOW_MS of whole segments,
      // never orphaning a FullSnapshot. Then flatten in segment order.
      rrwebEvents = flattenSegments(res.segments);   // window math uses segment walls, not startWall
    }
  } catch (err) {
    console.warn("[openjam] rrweb stop failed:", err);
  }
```

Then add the `report.rrwebEvents` field to the existing `report` object literal:

```js
  const report = {
    meta: { /* unchanged */ },
    device: session.device,
    events: session.events.slice().sort((a, b) => a.t - b.t),
    rrwebEvents,                 // NEW — flattened rrweb event array (or [] if none)
  };
```

### 5d. New helper `flattenSegments` (add near the other helpers in background.js)

```js
const RING_WINDOW_MS = 5 * 60 * 1000;

// Flatten append-only segments into one rrweb event array.
// Keeps only whole leading segments within the window; never orphans a FullSnapshot. (§3)
function flattenSegments(segments) {
  if (!segments.length) return [];
  const lastWall = segments[segments.length - 1].wall || Date.now();
  const cutoff = lastWall - RING_WINDOW_MS;
  // Drop whole leading segments older than cutoff, but only if a later segment exists
  // (so the surviving deltas still have their FullSnapshot at index 0). Sentry rule.
  let start = 0;
  while (start < segments.length - 1 && (segments[start].wall || 0) < cutoff) start++;
  const kept = segments.slice(start);
  return kept.flatMap((s) => s.events);
}
```

> For Phase 1, full-session capture is acceptable too — set `RING_WINDOW_MS = Infinity` to flatten
> everything (matches §3 "Full session = window = Infinity"). Default to 5 min for the bounded
> guarantee; expose as a constant for easy flip during dogfood.

The existing `chrome.storage.local.set({ [key]: report, ... })` then persists the report **with**
`rrwebEvents` inline. (rrweb events are JSON-serializable; a few minutes of capture is well under
`chrome.storage.local` limits when small, but large captures may exceed 10 MB — see Risks. For
Phase 1 dogfood on short sessions this is fine; Phase 2 moves the heavy payload to compressed
export.)

---

## 6. manifest.json changes

**File created:** `/manifest.dist.json` (the source manifest that gets copied to `dist/manifest.json`
by `build.mjs`). We keep the original `/manifest.json` untouched so the pre-build loose-file layout
still documents intent, but the **loaded** manifest is the dist one.

### Precise diff (from current `manifest.json` → new `manifest.dist.json`)

```diff
 {
   "manifest_version": 3,
   "name": "OpenJam",
   "version": "0.1.0",
   "description": "Capture console logs, network requests, screenshots and device info on one timeline, then export a self-contained bug report. Open-source Jam.dev.",
-  "permissions": ["debugger", "tabs", "storage", "activeTab"],
+  "permissions": ["debugger", "tabs", "storage", "activeTab", "unlimitedStorage"],
   "host_permissions": ["<all_urls>"],
   "background": { "service_worker": "background.js", "type": "module" },
+  "content_scripts": [
+    {
+      "matches": ["<all_urls>"],
+      "js": ["recorder.js"],
+      "run_at": "document_start",
+      "world": "ISOLATED",
+      "all_frames": false
+    }
+  ],
   "action": { "default_popup": "popup.html", "default_title": "OpenJam" }
 }
```

Notes:
- `"unlimitedStorage"`: lifts the ~10 MB cap on the SW's **extension-origin** `chrome.storage.local`,
  where the final report (with inline `rrwebEvents`) is saved. NOTE: it does **not** affect the
  content-script segment IndexedDB, which is page-origin (see Step 4 correction) — page-origin
  IndexedDB already has a large default quota.
- `"world": "ISOLATED"` and `"run_at": "document_start"` per §2.
- `"all_frames": false` for Phase 1 (cross-origin iframes are out of scope per §5; top frame only).
- All `js`/`service_worker`/popup/viewer paths are relative to `dist/` because the extension is
  loaded from `dist/`. The file names match the esbuild outputs from Step 2.

---

## 7. In-extension player wiring

**Files modified:** `/viewer.html`, `/viewer.js`. (`renderer.js` exports `renderReport`; we read the
timeline rows it builds to drive the sync.)

Per §6: inline `rrweb-player` as a bundled module (respects page CSP `script-src 'self'` — no CDN),
mount in `viewer.html`, wire `ui-update-current-time` ↔ existing timeline highlight; both clocks are
`Date.now()`.

> **API facts (NOW VERIFIED against rrweb-player upstream source + npm 2.0.1 — see Verification
> section).** Both previously-unverified claims are confirmed; the verification commands below are
> retained only as a post-install sanity check, not a blocker:
>
> 1. **Player import + CSS path — CONFIRMED.** `rrweb-player@2.0.1` `package.json` declares
>    `"module": "./dist/rrweb-player.js"`, `"main": "./dist/rrweb-player.umd.cjs"`, an `exports` map
>    including `"./dist/style.css"`, and ships `dist/style.css`. The ESM default export is the player
>    class. `import rrwebPlayer from "rrweb-player"` + `import "rrweb-player/dist/style.css"` are both
>    valid. Sanity-check after install: `cat node_modules/rrweb-player/package.json` and
>    `ls node_modules/rrweb-player/dist/`.
> 2. **Event name + payload — CONFIRMED.** The player emits **`ui-update-current-time`**. In
>    `Controller.svelte` it is dispatched as `dispatch('ui-update-current-time', { payload: currentTime })`
>    where `currentTime = replayer.getCurrentTime()` — a **relative offset in ms from replay start**
>    (NOT an absolute epoch). The player's `addEventListener` maps it via
>    `controller.$on(event, ({ detail }) => handler(detail))`, so the registered handler receives the
>    dispatched object directly, i.e. `handler({ payload: <offsetMs> })`. Therefore `e.payload` IS the
>    offset ms — the code below is correct as written. Sanity-check after install:
>    `grep -ro "ui-update-current-time" node_modules/rrweb-player/dist/`.
>    (Source: Controller.svelte / Player.svelte in rrweb-io/rrweb.)

### 7a. viewer.html — add a player mount + a "Replay" panel

Add inside `<body>`, above `<div id="app"></div>`:

```html
  <div id="replay" hidden>
    <div id="replay-player"></div>
  </div>
```

Add minimal styling to the `<style>` block in `viewer.html`:

```css
  #replay{border-bottom:1px solid #2a2f3a;background:#171a21;padding:10px 14px}
  #replay-player{max-width:100%}
  .rr-player{margin:0 auto}
```

Link the player's stylesheet. esbuild emits the imported `rrweb-player/dist/style.css` as a sibling
`viewer.css` (Step 2 correction) — it is NOT auto-injected — so add this to `viewer.html`'s `<head>`
(next to / before the existing `<script type="module" src="viewer.js">`):

```html
  <link rel="stylesheet" href="viewer.css">
```

(Local `'self'` asset — CSP-clean. If you skip this, the player renders unstyled and Milestone C
step 3's "styled controller" check fails.)

### 7b. viewer.js — instantiate the player and sync to the timeline

Modify `/viewer.js`. Add imports at top:

```js
import rrwebPlayer from "rrweb-player";   // default export = the player class (verified, 2.0.1)
import "rrweb-player/dist/style.css";     // esbuild gathers this into a sibling dist/viewer.css
                                          // (NOT runtime-injected — viewer.html links it, Step 7a)
```

In `load()`, after `renderReport(document.getElementById("app"), report);`, add:

```js
  if (Array.isArray(report.rrwebEvents) && report.rrwebEvents.length > 1) {
    mountReplay(report);
  }
```

Add the `mountReplay` function:

```js
function mountReplay(report) {
  const panel = document.getElementById("replay");
  panel.hidden = false;

  const player = new rrwebPlayer({
    target: document.getElementById("replay-player"),
    props: {
      events: report.rrwebEvents,
      autoPlay: false,
      showController: true,
      width: Math.min(window.innerWidth - 40, 1024),
    },
  });

  // Both clocks are Date.now() epoch-ms (§2). rrweb events carry `timestamp`;
  // OpenJam timeline rows carry `t`. The player emits ui-update-current-time as
  // an OFFSET from the first event. Convert to absolute wall time and highlight
  // the nearest timeline row at-or-before that wall time.
  const replayStartWall = report.rrwebEvents[0].timestamp;

  player.addEventListener("ui-update-current-time", (e) => {
    const offsetMs = e.payload;                 // ms since replay start
    const wall = replayStartWall + offsetMs;    // absolute Date.now()-aligned ms
    highlightTimelineAt(wall, report);
  });
}

// Find the timeline row whose event time `t` is the latest <= wall, and mark it.
function highlightTimelineAt(wall, report) {
  const events = (report.events || []).slice().sort((a, b) => a.t - b.t);
  let pick = null;
  for (const ev of events) { if (ev.t <= wall) pick = ev; else break; }
  const rows = document.querySelectorAll("#app .timeline .row");
  rows.forEach((r) => r.classList.remove("rr-active"));
  if (!pick) return;
  // renderer.js builds rows in sorted event order; map by index.
  const idx = events.indexOf(pick);
  const row = rows[idx];
  if (row) {
    row.classList.add("rr-active");
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}
```

Add a highlight style. Append to the `REPORT_CSS` is cleaner, but to avoid touching `renderer.js`'s
export contract in Phase 1, add it in `viewer.html`'s `<style>`:

```css
  .row.rr-active{background:#1d2b45 !important;box-shadow:inset 3px 0 0 #6ea8fe}
```

> **Row-index mapping caveat:** `highlightTimelineAt` assumes the DOM rows in `#app .timeline`
> correspond 1:1 and in-order to the sorted `events` array. `renderer.js` renders rows in sorted
> order BUT filters can hide rows (search/kind toggles change which rows exist). For Phase 1 dogfood
> the default state shows all rows, so index mapping holds. A robust mapping (data-attribute on each
> row carrying `ev.id`) is a small Phase 1.1 follow-up; note it but do not block. If you want it now:
> in `renderer.js` add `row.dataset.eventId = ev.id;` and select by
> `#app .timeline .row[data-event-id="..."]` instead of by index. (This is a 1-line renderer change
> and the safer choice — recommended.)

---

## 8. Build + load procedure

```bash
# from repo root
npm install                 # installs pinned deps (Step 1)
npm run build               # produces dist/ (Step 2)
```

Load in Chrome/Chromium:

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**.
4. Select the **`dist/`** directory (NOT the repo root).
5. Confirm the extension card shows "OpenJam 0.1.0" with no errors. If "Errors" appears, open it —
   most likely a manifest path typo or a missing `dist/` file.

For iterative work: `npm run watch` keeps `dist/` rebuilt on save; click the **reload** ↻ icon on
the extension card after each change (content-script and manifest changes require a reload; for a
content-script change you must also reload the **page under test**).

---

## 9. DOGFOOD verification per milestone

The bar is "I can see replay working" — not "it compiles". Each milestone has a concrete
load-record-observe check on a **real site**.

### Milestone A — Build & load (after Steps 1–2, 6)
At this point only the build + manifest exist; recorder/player not yet wired.
1. `npm run build`; Load unpacked from `dist/`.
2. **Observe:** extension card shows OpenJam 0.1.0, zero errors. Click "service worker" link →
   DevTools console for the SW opens with no exceptions.
3. **Observe:** open `chrome://extensions` → Details → the content script `recorder.js` is listed.

### Milestone B — Recorder captures to IndexedDB (after Steps 3–5)
1. Navigate to **https://example.com** (simple, fast, same-origin assets).
2. Open the OpenJam popup → **Start recording**.
3. On the page, open DevTools → **Application → IndexedDB → openjam-replay → segments**.
   **Observe:** at least one record appears with `tabId`, `segmentIndex: 0`, and an `events` array
   whose `events[0].type === 2` (FullSnapshot).
4. Interact: scroll, click a link to **https://example.com** subpaths or move the mouse for ~5s.
   **Observe:** the `events` array in segment 0 grows (incremental events). Refresh the IndexedDB
   view to see updates.
5. Wait **>60 seconds** while moving the mouse occasionally.
   **Observe:** a second record `segmentIndex: 1` appears, whose `events[0].type === 2` (a fresh
   checkout FullSnapshot) — proves `checkoutEveryNms` segmenting works.
6. Popup → **Stop & open report**.
   **Observe:** the SW console logs no rrweb errors; the report tab opens.

### Milestone C — Replay plays in the viewer (after Step 7)
1. Repeat B steps 1–2 on a **richer real site** with visible DOM changes, e.g.
   **https://en.wikipedia.org/wiki/Special:Random** — scroll, expand a section, hover links for
   ~20 seconds.
2. Popup → **Stop & open report**.
3. In the viewer tab: **Observe** a Replay panel appears above the timeline with the rrweb-player
   controller (play/pause/seek bar) — styled (proves the bundled CSS loaded; CSP not violated:
   check the viewer's DevTools console shows **no** `Refused to load/execute … script-src 'self'`
   errors).
4. Click **Play**. **Observe:** the recorded page reconstructs and animates — your scroll and hover
   are reproduced in the player canvas. This is the "I can see replay working" bar.
5. While the replay plays, **Observe:** in the timeline below, a row highlights (blue left-bar) and
   auto-scrolls in sync as the player's current time advances — confirms the
   `ui-update-current-time` ↔ timeline sync, both on `Date.now()`.
6. Drag the player seek bar backward/forward. **Observe:** the highlighted timeline row jumps to the
   event nearest that wall-clock moment.

### Milestone D — Bounded memory / long session (optional but recommended)
1. Temporarily leave `RING_WINDOW_MS = 5*60*1000`. Record on **https://news.ycombinator.com**,
   navigating between pages for **~7 minutes**.
2. Stop. **Observe** in the SW console (add a temporary `console.log(rrwebEvents.length, segments.length)`):
   segments older than the 5-min window were dropped (kept segment count ≈ 6, per §3 bound), yet the
   replay still starts cleanly (first kept event is a FullSnapshot — no blank/garbled replay).
3. **Observe:** the OpenJam tab's memory in `chrome://system` or Task Manager did not climb
   unbounded during the 7-minute capture (sanity check on §3's "no RAM drain" claim).

---

## 10. Risks / unknowns & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Bundle size** of rrweb + rrweb-player (§6 estimates player ~120–250 KB; rrweb record similar). | Slower content-script parse on every page; large `viewer.js`. | Recorder bundle only imports `rrweb` `record` (tree-shaken); the player only loads in `viewer.js` (one tab). Measure with `ls -la dist/*.js` after build; if `recorder.js` > ~500 KB, import from `rrweb/es` record-only entry. Sourcemaps inflate dist but don't ship to users meaningfully — drop `sourcemap` for a release build. |
| **SW suspension** (killed after 30s idle / 5min, §3). | Background loses in-memory `session` (the CDP path), and any rrweb state if it lived in SW. | rrweb runs in the **content script**, never the SW (§3) — capture survives SW death. The CDP `session` object is the pre-existing behavior and unchanged. Start/stop are message-driven and short-lived, so suspension between popup actions is harmless. |
| **CSP** on the viewer page (`script-src 'self'`). | A CDN or `eval`'d player would be blocked. | Player is **bundled** into `viewer.js` (Step 7) and its CSS injected via esbuild's css loader as a `<style>` — both are 'self'. Verified in Milestone C step 3 (no CSP console errors). No `new Function`/CDN anywhere. |
| **Content-script injection timing** (must be `document_start`, ISOLATED). | Miss the FullSnapshot of early DOM; or fail to relay. | Manifest sets `run_at:document_start` + `world:ISOLATED` (Step 6). Recorder only calls `record()` on explicit `recorder:start` (after DOM exists), and rrweb takes the FullSnapshot synchronously as event 0 (§5 guard in Step 3c). |
| **IndexedDB origin partition** (SW vs page origin). | SW cannot read what the content script wrote — the literal design wording would fail. | Corrected in Step 4/5: the content script reads its own page-origin DB on stop and ships segments to the SW via message. Flag this deviation to the design owner. |
| **`chrome.tabs.sendMessage` to pages with no content script** (chrome://, Web Store, PDF viewer). | Start/stop throws; recording silently lacks rrweb. | Wrapped in try/catch (Steps 5b/5c) with a console warning; CDP capture still works. Dogfood only on normal http(s) sites. |
| **Large `rrwebEvents` exceeding `chrome.storage.local`** (~10 MB without `unlimitedStorage`; effectively unbounded with it). | Stop fails to persist the report. | `"unlimitedStorage"` (Step 6) lifts the extension-origin `storage.local` cap, so this is largely mitigated. Phase 1 default 5-min window also keeps it small. Phase 2 moves the heavy payload to compressed export. If hit, lower `RING_WINDOW_MS` or drop `inlineImages` for the test. |
| **`tabs.sendMessage` payload cap (~32 MB) when shipping all segments in the stop response** (verified: messages over the limit throw "Message length exceeded maximum allowed length"). With `inlineImages:true` + `inlineStylesheet:true`, FullSnapshots are large (§3: ~263 KB+ each, ~6 segments in a 5-min window → low-single-digit MB typical, but image-heavy pages can balloon). | `recorder:stop` response throws; rrwebEvents lost (caught by try/catch → empty replay, CDP report still fine). | Phase 1's bounded 5-min window keeps typical payloads well under 32 MB. **Residual risk:** image-heavy/long sessions. If you hit the cap, either (a) lower `RING_WINDOW_MS` / set `inlineImages:false`, or (b) chunk the segments across multiple messages (ship per-segment via repeated `tabs.sendMessage`, or use a long-lived `chrome.runtime.connect` Port and stream segment-by-segment). Chunking is the robust fix and a recommended Phase 1.1 follow-up. (Source: chromium-extensions: chrome.runtime message length limit.) |
| **`maskAllInputs:true`** masks form fields in replay. | Replay shows masked inputs — could confuse a first dogfood. | Intended PII default (§4). For a dogfood where you want to see typed text, temporarily set `maskAllInputs:false` — but ship masked. |
| **Filtered-timeline row index drift** (sync mapping). | Highlight points at wrong row when filters active. | Use the `data-event-id` mapping recommended in Step 7b (1-line `renderer.js` change) rather than positional index. |

---

## 11. Dependency note — what later phases build on Phase 1 outputs

- **Phase 2 (self-contained export):** consumes `report.rrwebEvents` (produced in Step 5) — flattens
  it into the exported HTML via `report-builder.js`, this time **fflate-compressed base64** + inlined
  `rrweb-player.umd.cjs`. *Phase-1 dependency to watch:* `report-builder.js` embeds
  `renderReport.toString()`. Once esbuild bundles `viewer.js`, function names can be mangled; Phase 2
  must either keep `report-builder.js`/`renderer.js` as separate non-bundled assets, or set esbuild
  `keepNames:true` / `minify:false` for that entry. **Do not minify in Phase 1** (config above
  doesn't) so this stays trivially correct, and leave a comment in `report-builder.js`.
- **Phase 3 (hybrid pixel keyframes):** adds a CDP `Page.captureScreenshot` lane keyed to rrweb
  checkouts and marked moments. It depends on Phase 1's segment boundaries (the `isCheckout` flush in
  Step 3) as the natural keyframe trigger, and on the `rrwebEvents` + timeline being already synced
  (Step 7) so keyframes can overlay at the right current-time.
- **Phase 4 (cross-browser):** reuses the content-script recorder (Step 3) as the portable capture
  foundation, swapping `chrome.*` for `browser.*` via `webextension-polyfill` and adding the
  event-page background variant. The IndexedDB module (Step 4) is already DOM/SW-agnostic and ports
  directly. The `dist/` build (Steps 1–2) gains a second manifest target.

---

## 12. File inventory (created / modified)

**Created:**
- `/package.json`, `/package-lock.json`
- `/build.mjs`
- `/recorder.js`
- `/recorder-db.js`
- `/manifest.dist.json`
- `/plans/PHASE_1_PLAN.md` (this file)

**Modified:**
- `/background.js` (Steps 5b–5d)
- `/viewer.html` (Step 7a)
- `/viewer.js` (Step 7b)
- `/renderer.js` (optional 1-line `data-event-id` in Step 7b — recommended)

**Untouched:** `/manifest.json` (kept as the loose-layout reference; `manifest.dist.json` is what
ships), `/popup.html`, `/popup.js`, `/report-builder.js` (Phase 2), the entire existing CDP capture
path in `/background.js`.

> Note: `dist/viewer.css` is a **build artifact** (esbuild sibling output), not a hand-written source
> file, so it is not in the "Created" list — but `viewer.html` must `<link>` it (Step 7a).

---

## Verification (adversarial pass)

Verified against upstream rrweb / rrweb-player source and npm registry (packages are NOT installed
locally; all checks are against published 2.0.1 + the `master` source the 2.0.1 tag was cut from).

| # | Claim | Verdict | Source | Change made |
|---|---|---|---|---|
| 1a | rrweb-player@2.0.1 emits `ui-update-current-time` | **CONFIRMED** | `Controller.svelte` dispatches `dispatch('ui-update-current-time', { payload: currentTime })`; `Player.svelte` `addEventListener` maps via `controller.$on(event, ({ detail }) => handler(detail))` — https://github.com/rrweb-io/rrweb/blob/master/packages/rrweb-player/src/Controller.svelte | None — event name was correct. |
| 1b | Payload is the current-time **offset in ms** and reachable as `e.payload` | **CONFIRMED** | `currentTime = replayer.getCurrentTime()` (relative offset, not epoch); handler receives the dispatched object `{ payload }`, so `e.payload` = offset ms. | Reworded Step 7 gate from "unverified/assert" to "CONFIRMED"; clarified the `$on(detail)` → `e.payload` chain. Code (`const offsetMs = e.payload; const wall = replayStartWall + offsetMs`) was already correct. |
| 1c | `rrweb-player/dist/style.css` exists; UMD build exists; ESM default export is the player class; constructor is `{ target, props }` with `events/autoPlay/showController/width` | **CONFIRMED** | npm `rrweb-player@2.0.1`: `module:./dist/rrweb-player.js`, `main:./dist/rrweb-player.umd.cjs`, `exports` includes `./dist/style.css`; `dist/` ships `style.css` + `rrweb-player.umd.cjs`. `RRwebPlayerOptions = { target: HTMLElement; props: {...} }` with all four props valid — https://registry.npmjs.org/rrweb-player/2.0.1 + https://github.com/rrweb-io/rrweb/blob/master/packages/rrweb-player/src/types.ts | None — all correct. |
| 2 | rrweb@2.0.1 `record()` options (`checkoutEveryNms`, `sampling`, `slimDOMOptions`, `inlineStylesheet`, `inlineImages`, `maskAllInputs`, `recordCanvas`, `dataURLOptions`, `recordCrossOriginIframes`) and `emit(event, isCheckout)` second-arg boolean | **CONFIRMED** | `recordOptions` type lists all fields; `emit?: (e, isCheckout?: boolean) => void` — https://github.com/rrweb-io/rrweb/blob/master/packages/rrweb/src/types.ts | None. |
| 2b | Initial FullSnapshot fires with `isCheckout === false`; only `checkoutEveryNms`-triggered snapshots pass `true` | **CONFIRMED** | `takeFullSnapshot()` at init (no arg → `isCheckout=false`); `takeFullSnapshot(true)` on `exceedTime` — https://github.com/rrweb-io/rrweb/blob/master/packages/rrweb/src/record/index.ts | None — the recorder's flush-on-checkout logic (Step 3a/3b) is correct for both the first segment and subsequent checkouts. |
| 3a | Content script IndexedDB is **page-origin**, not extension-origin; SW cannot read it; the plan's "content script re-reads + ships via stop message" fix is correct | **CONFIRMED** | Content scripts access the host page's web storage (localStorage/IndexedDB), not the extension's — https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies + chromium-extensions discussion. | None to the architecture — the existing Step 4/5 correction is sound. Milestone B step 3 (inspect DB under the page's DevTools) is consistent with page-origin. |
| 3b | `chrome.runtime`/`chrome.tabs.sendMessage` has a practical size cap; shipping all segments in one message may exceed it | **CONFIRMED (gap in plan)** | ~32 MB cap; over-limit throws "Message length exceeded maximum allowed length" — chromium-extensions / GitHub issues. | **Added a Risks-table row** documenting the ~32 MB cap, when image-heavy captures approach it, and a chunking / `chrome.runtime.connect` Port streaming fix as Phase 1.1. |
| 4a | `"unlimitedStorage"` is valid and justified | **CORRECTED** | `"unlimitedStorage"` applies to the **extension origin** only (extension `storage.local`/IndexedDB/CacheStorage), NOT page-origin storage — https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies | Permission KEPT (it lifts the `chrome.storage.local` cap for the SW-saved report incl. inline `rrwebEvents`), but the **rationale in Step 4 and Step 6 was wrong** ("for the page-origin segment DB") and is now corrected — it does NOT raise the segment DB's quota (page-origin quota is separately large). |
| 4b | Manifest MV3: `content_scripts` `world:ISOLATED` + `run_at:document_start`; SW `type:module`; `<all_urls>` host perms | **CONFIRMED** | Existing manifest already has `host_permissions:["<all_urls>"]` and module SW; ISOLATED+document_start are standard MV3. No `web_accessible_resources` needed (recorder is a declared content script, not fetched by the page; viewer/popup are extension pages). | None. |
| 5a | esbuild can bundle rrweb (ESM) into an IIFE content script and an ESM viewer module | **CONFIRMED** | `bundle:true` + per-entry `format` (`iife`/`esm`) is standard; the per-entry `esbuild.context()` array correctly works around `format` being per-build. | None. |
| 5b | `import "rrweb-player/dist/style.css"` makes esbuild **inline + runtime-inject** the CSS as `<style>` | **CORRECTED (real break)** | esbuild's built-in `css` loader emits a **sibling CSS file** next to the JS bundle and does **NOT** auto-inject or auto-link it — https://esbuild.github.io/content-types/ | Fixed in Step 2 and Step 7a/7b: esbuild now produces `dist/viewer.css`; `viewer.html` must add `<link rel="stylesheet" href="viewer.css">`; updated §0 layout and the `ls dist/` verification to include `viewer.css`. Without this fix the player renders unstyled and Milestone C step 3 fails. |
| Internal | Step ordering executable; dogfood checks are real "observe" checks | **CONFIRMED** | — | Cleaned an unused `startWall` param in `flattenSegments` (window math uses segment walls). Dogfood Milestones A–D are genuine load-record-observe checks against real sites. |

### Residual risks an executor MUST know
1. **Message-size cap (3b):** the single-message segment ship is the most likely real-world failure on
   image-heavy or long sessions. Bounded 5-min window keeps typical runs safe, but treat chunking /
   Port streaming as the first follow-up if you see "Message length exceeded".
2. **Filtered-row index drift (already in plan):** the `highlightTimelineAt` positional index mapping
   breaks when timeline filters hide rows. Apply the recommended 1-line `renderer.js`
   `data-event-id` mapping rather than relying on default-all-visible state.
3. **Page-origin DB cleanup:** segments persist in *each visited page's* IndexedDB (`openjam-replay`).
   `clearTab` only clears the current `tabId`'s rows on the *next* start; stale DBs accumulate per
   origin across sites. Not fatal for Phase 1 dogfood, but note it — a cross-origin cleanup story is
   owed before wider use.
