# OpenJam

An open-source take on [Jam.dev](https://jam.dev): a Chrome extension that captures
**console logs, network requests, JS errors, screenshots, and device/environment info**
onto a single correlated timeline, then exports a **self-contained HTML bug report** you
can open offline and share as a file.

No backend, no account, no telemetry. Everything stays on your machine.

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

## Known limitations (v0.1.0)

- Console/network history before **Start** is not captured — recording is forward-only.
- Response bodies are captured only for text-like types under 100 KB (configurable via `BODY_CAPTURE_MAX_BYTES` in `background.js`).
- If Chrome suspends the background service worker during a long idle recording, the session ends; keep captures focused.
- No video recording yet (frame screenshots only). The CDP `Page.startScreencast` path is the natural next step.

## Roadmap ideas

- Screencast/video replay synced to the timeline.
- Annotated screenshots (boxes, arrows, redaction).
- One-click copy to GitHub / Linear / Slack issue templates.
- Cross-browser build via `webextension-polyfill` (Firefox MV3).
