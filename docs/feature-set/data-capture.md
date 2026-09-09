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

## When Chrome's debugger is unavailable (reduced mode)

`chrome.debugger.attach` vets every frame in the tab, not just the page URL. One iframe
owned by another extension (password-manager inline menus, grammar checkers, shopping
assistants) makes the whole tab unattachable — Chrome's rule that one extension may never
inspect another ([#48](https://github.com/SaintPepsi/openjam/issues/48)). OpenJam then
records anyway from a page probe it puts into the tab, marks the report
`meta.capture: "inject"`, and tells you which extension is in the way with a
**Manage extension** button.

Any other attach failure takes the same path: the recording runs in reduced mode and the
warning quotes Chrome's reason verbatim (for example "Another debugger is already attached"
when DevTools holds the tab), so you can fix the cause and record again in full.

| Signal | Full (`cdp`) | Reduced (`inject`) |
|---|---|---|
| fetch/XHR: method, URL, status, headers, texty bodies < 100 KB | ✓ | ✓ (headers limited to what the page can see) |
| Other loads (img, script, css, navigations) | ✓ | ✗ |
| Console, uncaught errors, unhandled rejections | ✓ | ✓ |
| Browser log (`Log.entryAdded`) | ✓ | ✗ |
| Frames | all | top frame only (console/fetch inside iframes are not seen) |
| First requests right after a navigation | ✓ | may be missed (the probe is put into the new document a few ms after it starts) |
| Screenshots | any tab | active tab only, viewport |
| Environment, session replay, narration | ✓ | ✓ |

The viewer's header shows `Capture reduced (no debugger)` on such a report. The page
probe that makes reduced mode work is put into the recorded tab only, and only for the
duration of the recording; every other page keeps its native `fetch` and `console`.

## What to expect / limitations

- Network response bodies are captured for text content under ~100 KB; larger or binary
  bodies are not inlined.
- Attaching the debugger shows Chrome's "OpenJam is debugging this tab" banner — expected,
  it's how CDP access works.

## Test data

- Reduced mode end to end, next to a fixture extension that injects its own iframe:
  `e2e/foreign-extension-frame.spec.mjs` with `test/e2e/foreign-extension/`
- Page probe (console/error/fetch/XHR in the MAIN world): `test/page-probe.test.js`,
  `test/page-probe-network.test.js`, `test/page-probe-serialize.test.js`
- Lane selection and the reduced-mode report: `test/background.test.js`
- Event normalisation/kinds: `test/event-kinds.test.js`
- Synthetic-but-realistic capture with a planted `400` buried in ordinary traffic:
  `eval/fixture-report.mjs`
- Report builder tests: `test/report-builder.test.js`

## Related

- [Bug report export](bug-report.md) — how captured events are packaged
- [AI manifest](ai-manifest.md) — the machine-readable index over these events
