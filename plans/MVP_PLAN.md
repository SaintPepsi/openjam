# OpenJam MVP — Smallest Complete Replay (YAGNI cut of Phases 1–4)

**Goal — the whole loop, nothing more:** Start recording → capture data → stop → share.
Non-opinionated = use rrweb/library defaults; add no policy, no tuning, no extra surface.

## The loop, mapped to what exists vs. what's new

| Step | Mechanism | Status |
|---|---|---|
| **Start recording** | popup → background attaches `chrome.debugger` **and** tells the content script to start rrweb | exists + small add |
| **Capture data** | console/network/errors/device/screenshots (CDP) **+ rrweb DOM session** | exists + **new: rrweb** |
| **Stop recording** | popup → detach CDP, pull rrweb events, build report | exists + small add |
| **Share** | self-contained HTML file (timeline **+ embedded rrweb player**) | exists + **new: player** |

So the entire MVP delta is: **(a) record rrweb in a content script, (b) embed the rrweb player + events into the existing export.** That's it.

## KEEP (already built, works — do not touch)
- CDP capture of console/network/errors/device/screenshots → unified timeline (`background.js`)
- popup start/stop (`popup.js`), in-extension timeline viewer (`viewer.js`/`renderer.js`)
- self-contained HTML export via `report-builder.js` (`buildReportHTML`, `<`-escape intact)

## ADD (minimal)
1. **Build step.** rrweb must be bundled (MV3 bans remote code). One `build.mjs` (esbuild):
   - Bundle `rrweb@2.0.1` `record()` → `dist/rrweb-recorder.js` (IIFE, classic content script).
   - Read `node_modules/rrweb-player/dist/rrweb-player.umd.cjs` + `dist/style.css` → emit
     `src/generated/player-assets.js` exporting both as strings (for inlining into the export).
   - `package.json`: `"build": "node build.mjs"`. Pin `rrweb@2.0.1`, `rrweb-player@2.0.1`, `esbuild`.
2. **Content-script recorder** (`src/rrweb-recorder.js`, built → `dist/rrweb-recorder.js`):
   - ISOLATED world, `run_at: document_start`, `matches: <all_urls>`.
   - On `rrweb-start`: `record({ emit: e => events.push(e) })` — **rrweb defaults**, plain array.
   - On `rrweb-stop` (or a `get-events` request): reply with the events array via
     `chrome.runtime.sendMessage`. No ring buffer, no IndexedDB, no checkout.
3. **Background wiring** (`background.js`): on start, `chrome.tabs.sendMessage(tabId, {action:'rrweb-start'})`;
   on stop, request events and set `report.rrwebEvents`. (rrweb timestamps are `Date.now()` — align as-is.)
4. **Manifest:** add the `content_scripts` block (ISOLATED/document_start) + `web_accessible_resources`
   for `dist/rrweb-recorder.js`. (No new permissions.)
5. **Export** (`report-builder.js`): if `rrwebEvents.length > 1`, inline the player UMD string + CSS string
   + `events` as JSON, mount `new rrwebPlayer({ target, props:{ events } })`. CSS inlined as `<style>`
   (esbuild does NOT auto-link it — confirmed in Phase 1 verification). Keep the existing `<`-escape;
   additionally escape `<\/script>` in the UMD string constant.

## CUT (YAGNI — explicitly deferred, with the trigger that would bring each back)
- **Ring buffer / IndexedDB / checkpointing / `unlimitedStorage`** (Phase 1) → bring back when sessions
  run long enough to exhaust memory. MVP targets short bug captures; events sit in a plain array.
- **fflate compression / base64 / lazy-unpack / segment seeking / size caps** (Phase 2) → bring back when
  exports get large. Short sessions inline as raw JSON fine.
- **In-extension interactive player** → the **shared file** carries the player; the extension keeps the
  timeline. Add an in-extension player later if you want to watch before downloading.
- **Player ↔ timeline click-to-seek sync** → nice, not required for "complete". Player and timeline
  coexist in the file without cross-linking.
- **Hybrid CDP pixel keyframes** (Phase 3, entire) → bring back for canvas/WebGL/video/cross-origin apps.
- **Cross-browser / injection pivot / polyfill** (Phase 4, entire) → Chromium only (Chrome + Vivaldi
  already work). Bring back for Firefox/Safari.
- **Opinionated capture config** (`maskAllInputs`, `inlineImages`, `slimDOMOptions`, sampling) → use
  rrweb defaults (password masking only). Add policy when a real need appears.

## Honest limitations the MVP ships with
- Long sessions grow memory unbounded (no ring buffer). Short captures only.
- Large exports aren't compressed (raw inline JSON). Fine while sessions are short.
- Canvas/WebGL/video/cross-origin iframes replay imperfectly (no pixel keyframes).
- Images may not render offline (rrweb `inlineImages` default off) — structure/text replay faithfully.
- Chrome / Vivaldi / Chromium only.

## Carried-forward fixes from verification that STILL apply to the MVP
- Inline the player **CSS** into the export `<style>` (esbuild won't link it).
- `rrweb-player` UMD global is `rrwebPlayer`; the UMD is already minified — do not re-bundle it.
- `ui-update-current-time` is CONFIRMED real — but the MVP doesn't use it (sync is cut).

## Build & dogfood (the bar = "I can see the replay in the shared file, offline")
1. `npm install && npm run build`; load unpacked.
2. Record on a real site (e.g. Wikipedia): Start → click around → Stop.
3. Download the self-contained HTML. **Turn the network OFF.** Open the file from disk.
4. Confirm: timeline shows console/network events AND the rrweb player plays back the interaction.
   No failed requests, no CSP errors.

## File touch list
- new: `package.json`, `build.mjs`, `src/rrweb-recorder.js`, `src/generated/player-assets.js` (built)
- edit: `manifest.json`, `background.js`, `report-builder.js`
- unchanged: `popup.*`, `viewer.*`, `renderer.js`
