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

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest |
| `background.js` | Capture engine — CDP attach, event routing, report assembly |
| `report-builder.js` | Generates the self-contained HTML timeline |
| `popup.html` / `popup.js` | Start/stop/screenshot controls |
| `viewer.html` | Renders the report and handles file export |

## Session replay

While recording, an rrweb recorder (content script, `src/rrweb-recorder.js`) captures the
DOM and its mutations. The exported HTML embeds
[rrweb-player](https://github.com/rrweb-io/rrweb/tree/master/packages/rrweb-player) plus
the event stream, so the shared file plays the session back — scrubbable, offline, no
dependencies. Replay uses rrweb defaults (passwords masked; other inputs visible).

## Known limitations (v0.2.0 — MVP, see plans/MVP_PLAN.md for the cut list)

- Console/network history before **Start** is not captured — recording is forward-only.
- Response bodies are captured only for text-like types under 100 KB (configurable via `BODY_CAPTURE_MAX_BYTES` in `background.js`).
- Replay events are held in memory uncompressed — keep captures short (minutes, not hours). If a report exceeds the [~10 MB storage quota](https://developer.chrome.com/docs/extensions/reference/api/storage), the replay is dropped and noted on the timeline.
- Canvas/WebGL, video frames, and cross-origin iframes replay imperfectly (DOM replay, not pixels — see `plans/PHASE_3_PLAN.md`).
- Images may not render in offline replay (rrweb `inlineImages` default off); structure and text replay faithfully.
- Chromium-only (Chrome, Vivaldi, Edge, Brave). Firefox/Safari need the injection pivot in `plans/PHASE_4_PLAN.md`.

## Roadmap (researched & verified plans in plans/)

- `PHASE_1_PLAN.md` — bounded ring buffer + IndexedDB for long sessions, in-extension player
- `PHASE_2_PLAN.md` — compressed exports (fflate) for large captures
- `PHASE_3_PLAN.md` — hybrid CDP pixel keyframes for canvas/WebGL/cross-origin
- `PHASE_4_PLAN.md` — Firefox/Safari via injection-based capture
