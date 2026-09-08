# Record without the debugger — design record

**Issue:** [#48](https://github.com/SaintPepsi/openjam/issues/48)
**Shipped:** 0.7.0, branch `bugfix/issue-48-foreign-extension-frame`
**User-facing doc:** [Data capture → reduced mode](../feature-set/data-capture.md#when-chromes-debugger-is-unavailable-reduced-mode)

This was planned as an epic with seven tickets and then built in one pass. The tickets
are gone; this file keeps the decisions and points at the tests that hold them.

## Problem

`chrome.debugger.attach` vets every frame in the tab, not just the page URL
(chromium `chrome/browser/extensions/api/debugger/debugger_api.cc`,
`ExtensionMayAttachToRenderFrameHost`). One `<iframe>` owned by another extension
(password-manager inline menu, grammar checker, shopping assistant) makes the whole tab
unattachable while `chrome.tabs.get` still reports a normal https URL. 0.6.2 surfaced
Chrome's raw error and never recorded.

Reproduced with a fixture extension that injects its own iframe:
`test/e2e/foreign-extension/` (id pinned via manifest `key`, see `ID`), driven by
`e2e/foreign-extension-frame.spec.mjs`.

## Decisions

- **One capture lane per session, chosen at start.** `cdp` when attach succeeds, `inject`
  when attach fails with the foreign-frame error. Lanes share one interface
  (`{ name, start, quiesce, stop, screenshot, deviceInfo }`): `src/lanes/cdp.js`,
  `src/lanes/inject.js`. The rest of the worker reads `session.lane`; no `if (attachFailed)`
  scattered around.
- **The authoritative signal is `session.capture`**, copied to `report.meta.capture`.
  Viewer badge, AI-manifest `_doc`, and the popup warning all read that field.
- **Same event schema on both lanes.** `src/lanes/inject.js` maps probe records onto the
  `event-kinds.js` LEGEND with `null` where the lane cannot know (`remoteAddress`).
  Renderer, manifest and report-builder needed no changes.
- **Name the culprit without new permissions.** `src/foreign-frames.js` scans the page's
  frame `src`s via `chrome.scripting` and returns the other extension's IDs. The popup
  offers a **Manage extension …** button that opens `chrome://extensions/?id=…`. Showing
  the extension's *name* would need the `management` permission (install warning); not
  taken.
- **The page probe is never a manifest content script.** It is put into the recorded tab
  by the inject lane at start, and into each new document that tab navigates to when the
  relay says hello (`background.js`, `oj-rrweb-hello`). Every other tab keeps native
  `fetch`/`console`. Registered content scripts were tried and rejected: they match by
  URL, not by tab.
- **Flush before the grace window.** `stopRecording` calls `lane.quiesce()` (probe flush)
  before the 400 ms wait that keeps `recording=true`, so the probe's last batch is still
  accepted. On `pagehide` the probe hands its buffer to the relay over a synchronous DOM
  event (`oj-probe-flush`, string `detail`), because a `postMessage` task dies with the
  document.
- **Disarmed means free.** While not recording, a console call costs one boolean check and
  a fetch never has its body cloned (`isArmed()` gate in `src/page-probe/network.js`).
  `text/event-stream` bodies are never read on either lane (`src/capture-limits.js`).
- **Other attach failures still abort** with the raw CDP error. Only the foreign-frame
  message is a known, recoverable condition. Widening the fallback to every attach failure
  is an open call for Ian, not decided here.
- **No frame eviction.** Removing another extension's iframe to sneak an attach through is
  possible and rude; not on the table.

## What the inject lane loses

See the table in [data-capture.md](../feature-set/data-capture.md#when-chromes-debugger-is-unavailable-reduced-mode):
non-fetch loads, browser log entries, iframes, the first requests of a fresh navigation,
and screenshots of anything but the visible viewport.

## Proof

| Claim | Test | Disconfirming input |
| --- | --- | --- |
| Foreign frame → inject lane, culprit named, console/fetch/error/screenshots captured across a mid-recording reload, viewer badge pixel baseline | `e2e/foreign-extension-frame.spec.mjs` test 1 | remove the iframe (→ cdp); drop `injectProbe` from the hello handler; move `quiesce()` after the wait |
| Popup gold notice + Manage button, pixel baseline, button survives the 1 s re-render and opens `chrome://extensions` | same spec, test 2 | rebuild the buttons unconditionally in `openjam-popup.js` `_render` |
| Probe is not in bystander tabs | same spec, test 1 (`__ojProbeLoaded` check) | put `dist/page-probe.js` back in `manifest.json` |
| Same page without the frame → cdp lane, no warning | same spec, test 3 | — (control) |
| Lane selection, hello re-injection, flush order, stop-during-attach, device-info throw | `test/background.test.js` | listed per test |
| Console/error/rejection records, disarmed cost, pagehide bridge | `test/page-probe.test.js`, `test/relay.test.js` | listed per test |
| fetch/XHR records, body gating, event-stream, abort, no unhandled rejection | `test/page-probe-network.test.js` | listed per test |
| Argument serialisation, surrogate-safe clip, stack frames | `test/page-probe-serialize.test.js` | listed per test |
| Foreign-frame scan | `test/foreign-frames.test.js` | listed per test |
| Legible link on the red notice | `e2e/extension.spec.mjs` ("restricted pages") | drop the `.notice a` colour rule |

## Out of scope

- Firefox/Safari (Phase 4). This builds the lane Firefox will need, not the polyfill.
- Resource-timing events for non-fetch loads on the inject lane.
- Probe inside iframes.
