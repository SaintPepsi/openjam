# OpenJam

An open-source take on [Jam.dev](https://jam.dev): a Chrome extension that captures
**console logs, network requests, JS errors, screenshots, device/environment info, and a
full DOM session replay** ([rrweb](https://github.com/rrweb-io/rrweb)) onto a single
correlated timeline, then exports a **self-contained HTML bug report** — open it offline
and watch the session play back.

No backend, no account, no telemetry. Everything stays on your machine.

## Build (required once)

rrweb must be bundled into the extension — MV3 forbids loading remote code
([Chrome docs](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)):

```sh
npm install
npm run build   # bundles dist/rrweb-recorder.js + generates src/generated/player-assets.js
```

## How it works

OpenJam attaches the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
(`chrome.debugger`) to the active tab — the same mechanism DevTools itself uses — and listens to:

| Source | CDP domain | What you get |
|---|---|---|
| Console | `Runtime.consoleAPICalled` | log/info/warn/error messages + stack traces |
| Errors | `Runtime.exceptionThrown` | uncaught exceptions with stack + source location |
| Network | `Network.*` | method, URL, status, headers, payloads, timing, size, response bodies (text, <100 KB) |
| Browser log | `Log.entryAdded` | browser-level warnings |
| Screenshots | `Page.captureScreenshot` | at start/stop, on every error, and on demand |
| Environment | `Runtime.evaluate` | UA, platform, viewport, screen, timezone, memory |

Every event is normalised to a wall-clock timestamp so the report renders one ordered,
filterable timeline.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this `openjam/` folder.
4. Pin OpenJam from the extensions menu.

## Use

1. Go to the page with the bug.
2. Click the OpenJam icon → **Start recording**. Chrome shows a "being debugged" banner — that's the CDP attachment; leave it.
3. Reproduce the bug. Hit **📸 Capture screenshot** at key moments if you want extra frames.
4. Click **Stop & open report**. A timeline opens in a new tab.
5. Click **⬇ Download self-contained HTML** to save a shareable file.

## Report viewer

- Filter by type (console / network / error / log / screenshot).
- Full-text search across titles and payloads.
- Click any row to expand: headers, request/response bodies (pretty-printed JSON), stack traces, full screenshots.

## Development

Dev → build → test loop:

```sh
git clone https://github.com/SaintPepsi/openjam.git && cd openjam
npm install        # pinned deps: rrweb@2.0.1, rrweb-player@2.0.1, esbuild
npm run build      # see "When to rebuild" below
npm test           # bun test — 17 tests (memory behaviors, export safety)
```

Then load the extension: `chrome://extensions` → Developer mode → **Load unpacked** →
this folder. After each code change: rebuild (if needed), click the **↻ reload** icon on
the OpenJam card, and reload the target page (so the content script re-injects).

**When to rebuild (`npm run build`):**

| You changed | Rebuild? | Why |
|---|---|---|
| `src/rrweb-recorder.js` | **Yes** | esbuild bundles it (+rrweb) into `dist/rrweb-recorder.js` |
| rrweb / rrweb-player versions | **Yes** | regenerates the bundle and `src/generated/player-assets.js` |
| `background.js`, `popup.*`, `viewer.*`, `renderer.js`, `report-builder.js` | No | loaded directly by the extension — just reload it |
| `manifest.json` | No | reload the extension |

`dist/` and `src/generated/` are build outputs (gitignored) — a fresh clone won't load
until you run `npm run build` once.

**Testing:** `npm test` runs the [Bun](https://bun.sh) suite in `test/` — recorder buffer
drainage, orphaned-recorder stop, session isolation, storage-quota degradation, export
size/escaping bounds. The capture side (CDP + content-script messaging in a live tab)
isn't unit-testable; dogfood it: record a real site, download the report, open it with
the network off, and confirm the replay plays.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest |
| `background.js` | Capture engine — CDP attach, event routing, rrweb orchestration, report assembly |
| `src/rrweb-recorder.js` | Content-script session recorder (bundled to `dist/rrweb-recorder.js`) |
| `build.mjs` | esbuild: bundles the recorder, generates `src/generated/player-assets.js` |
| `report-builder.js` | Generates the self-contained HTML export (timeline + replay player) |
| `renderer.js` | Shared timeline renderer (extension page + embedded in exports) |
| `popup.html` / `popup.js` | Start/stop/screenshot controls |
| `viewer.html` / `viewer.js` | Renders the report and handles file export |
| `test/` | Bun test suite |
| `plans/` | Verified phase plans + MVP plan; `REPLAY_DESIGN.md` is the architecture |

## Session replay

While recording, an rrweb recorder (content script, `src/rrweb-recorder.js`) captures the
DOM and its mutations. The exported HTML embeds
[rrweb-player](https://github.com/rrweb-io/rrweb/tree/master/packages/rrweb-player) plus
the event stream, so the shared file plays the session back — scrubbable, offline, no
dependencies. Replay uses rrweb defaults (passwords masked; other inputs visible).

## Known limitations (v0.2.0 — MVP, see plans/MVP_PLAN.md for the cut list)

- Console/network history before **Start** is not captured — recording is forward-only.
- Response bodies are captured only for text-like types under 100 KB (configurable via `BODY_CAPTURE_MAX_BYTES` in `background.js`).
- Replay events are held in memory uncompressed — keep captures short (minutes, not hours). If a report exceeds the [~10 MB storage quota](https://developer.chrome.com/docs/extensions/reference/api/storage), it degrades in layers: replay dropped (noted on the timeline), then screenshot pixels.
- Only the most recent report is kept in extension storage (quota); download the HTML to keep a capture.
- Canvas/WebGL, video frames, and cross-origin iframes replay imperfectly (DOM replay, not pixels — see `plans/PHASE_3_PLAN.md`).
- Images may not render in offline replay (rrweb `inlineImages` default off); structure and text replay faithfully.
- Chromium-only (Chrome, Vivaldi, Edge, Brave), **Chrome ≥118 required**: from 118 an active `chrome.debugger` session keeps the background service worker alive for the whole recording ([SW lifecycle docs](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)); on older versions a long idle recording can be evicted. Firefox/Safari need the injection pivot in `plans/PHASE_4_PLAN.md`.

## Roadmap (researched & verified plans in plans/)

- `PHASE_1_PLAN.md` — bounded ring buffer + IndexedDB for long sessions, in-extension player
- `PHASE_2_PLAN.md` — compressed exports (fflate) for large captures
- `PHASE_3_PLAN.md` — hybrid CDP pixel keyframes for canvas/WebGL/cross-origin
- `PHASE_4_PLAN.md` — Firefox/Safari via injection-based capture
