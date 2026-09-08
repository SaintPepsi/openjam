# Record without the debugger — epic

**Issue:** [#48](https://github.com/SaintPepsi/openjam/issues/48)
**Branch:** `bugfix/issue-48-foreign-extension-frame` (stopgap landed: named error, repro fixture)
**Type:** bug turned capability gap

## Problem

`chrome.debugger.attach` vets every frame in the tab, not just the page URL
(chromium `debugger_api.cc`, `ExtensionMayAttachToRenderFrameHost`). One `<iframe>` owned
by another extension (Bitwarden/1Password inline menu, Grammarly, shopping assistants) makes
the whole tab unattachable. `chrome.tabs.get` still reports a normal https URL, so
`recordableTabError()` (`background.js:371`) passes and the attach fails. Today that ends the
session before it starts (`background.js:418-423`). Reproduced end to end in
`e2e/foreign-extension-frame.spec.mjs` with the fixture extension
`test/e2e/foreign-extension/`.

The debugger is currently a hard dependency for four things: network, console/errors,
screenshots, device info. Session replay and audio never needed it.

## Goal

A recording always starts on a normal web page. When the debugger is unavailable, capture
runs from the content scripts we already inject, the report says so, and the user is told
which extension is in the way and what they lose.

## Decisions

- **One capture lane per session, chosen at start.** `cdp` when attach succeeds, `inject`
  when attach fails because of a foreign frame. No dual-lane dedupe (the Phase 4 plan's
  "baseline + enhancement" idea is deferred until Firefox forces it). Data drives behavior:
  the lane is a value the rest of the worker reads, never an `if (attachFailed)` scattered
  around.
- **The authoritative signal is `session.capture`** (`"cdp" | "inject"`), copied to
  `report.meta.capture`. Every "are we degraded?" question reads that field. Nothing
  infers the mode from whether a debugger event arrived or a field is null.
- **Same event schema on both lanes.** `KIND.NETWORK/CONSOLE/ERROR/SCREENSHOT` events from
  the inject lane carry the same `detail` keys as `event-kinds.js` `LEGEND` documents,
  with `null` where the lane cannot know (e.g. `remoteAddress`). Renderer, manifest and
  report-builder need no changes.
- **Name the culprit without new permissions.** A `chrome.scripting` scan of the page for
  `chrome-extension://` frame sources yields the offending extension IDs. No
  `management` permission (adds a "manage your extensions" install warning), no
  `webNavigation` (adds "read your browsing history").
- **No frame eviction.** Removing another extension's iframe to sneak an attach through
  is technically possible and rude; not on the table unless the inject lane proves
  insufficient in practice.
- **Failed attach for any other reason still aborts** with the raw CDP error, as today.
  Only the foreign-frame case is a known, recoverable condition.

## What the inject lane loses (documented, not hidden)

| Signal | cdp | inject |
| --- | --- | --- |
| fetch/XHR requests, status, headers, texty bodies ≤100 KB | ✓ | ✓ (response headers only those exposed to JS; request headers only those the page set) |
| Non-JS loads (img, script, css, navigations) | ✓ | ✗ (follow-up: PerformanceObserver resource timing) |
| Console, uncaught errors, unhandled rejections | ✓ | ✓ |
| Browser-level `Log.entryAdded` (mixed content, CSP) | ✓ | ✗ |
| Screenshots | any tab | active tab only (`captureVisibleTab`) |
| Device info | ✓ | ✓ (same collector, run in-page) |
| Replay, audio | ✓ | ✓ |

## Children

| Doc | Ticket | Status |
| --- | --- | --- |
| [01-name-the-culprit.md](01-name-the-culprit.md) | Error carries the blocking extension IDs; popup offers a one-click path to disable | planned |
| [02-capture-lane-signal.md](02-capture-lane-signal.md) | `session.capture` + `report.meta.capture`, CDP code moved behind a lane module | planned |
| [03-page-console-lane.md](03-page-console-lane.md) | Console, errors, rejections from the MAIN world via the relay | planned |
| [04-page-network-lane.md](04-page-network-lane.md) | fetch/XHR via MAIN-world patches, same NETWORK schema | planned |
| [05-screenshots-and-device-without-cdp.md](05-screenshots-and-device-without-cdp.md) | `captureVisibleTab` screenshots, shared device-info collector | planned |
| [06-fallback-wiring.md](06-fallback-wiring.md) | Attach fails on a foreign frame → inject lane, warning with culprit, e2e proof | planned |
| [07-docs-and-release.md](07-docs-and-release.md) | feature-set docs, viewer badge, issue reply, 0.7.0 | planned |

01 ships first on its own (this branch, 0.6.3). 02–07 are the epic proper; 02 must land
before 03–06 because it defines the signal they all read.

## Out of scope

- Firefox/Safari support (Phase 4 plan). This epic builds the lane Firefox will need but
  does not add the polyfill or the capability check.
- Resource-timing network events for non-fetch loads (noted in 04 as follow-up).
- Frame eviction ("Record anyway") — see Decisions.

## Risks

- `captureVisibleTab` only captures the active tab in the focused window; error
  screenshots fire while the user is on the page, so this mostly works, but the
  e2e must bring the fixture to front before asserting (05).
- MAIN-world patches of `fetch`/`console` at `document_start` compete with the page's own
  wrappers (Sentry, Datadog). Ours must be installed first and be transparent (preserve
  `this`, return values, and throw behaviour). Tests in 03/04 cover a page that wraps after
  us.
- `background.js` is 622 lines; 02 splits the CDP code into `src/lanes/cdp.js` before
  any inject code is added, or the file passes 800.
