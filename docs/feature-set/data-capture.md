# Data capture

Part of the [OpenJam feature set](README.md).

## What it does

OpenJam attaches the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
(`chrome.debugger`) to the active tab — the same mechanism DevTools itself uses — and
records, per [README → How it works](../../README.md#how-it-works):

| Source | CDP domain | What you get |
|---|---|---|
| Console | `Runtime.consoleAPICalled` | log/info/warn/error messages + stack traces |
| Errors | `Runtime.exceptionThrown` | uncaught exceptions with stack + source location |
| Network | `Network.*` | method, URL, status, headers, payloads, timing, size, response bodies (text, <100 KB) |
| Browser log | `Log.entryAdded` | browser-level warnings |
| Environment | `Runtime.evaluate` | UA, platform, viewport, screen, timezone, memory |

Every event is normalised to a wall-clock timestamp so the report renders one ordered,
filterable timeline alongside the [session replay](session-replay.md).

## What to expect / limitations

- Network response bodies are captured for text content under ~100 KB; larger or binary
  bodies are not inlined.
- Attaching the debugger shows Chrome's "OpenJam is debugging this tab" banner — expected,
  it's how CDP access works.

## Test data

- Event normalisation/kinds: `test/event-kinds.test.js`
- Synthetic-but-realistic capture with a planted `400` buried in ordinary traffic:
  `eval/fixture-report.mjs`
- Report builder tests: `test/report-builder.test.js`

## Related

- [Bug report export](bug-report.md) — how captured events are packaged
- [AI manifest](ai-manifest.md) — the machine-readable index over these events
