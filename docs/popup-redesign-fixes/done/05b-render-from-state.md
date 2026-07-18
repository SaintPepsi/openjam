# 05b — Render the component from state (`ui = fn(state)`)

Depends on: [00-epic](../00-epic.md), [05](05-component-source-of-truth.md)

## Problem

`<openjam-popup>` mutates the DOM imperatively across scattered handlers — the
button label, the REC timer, the error notice, the mic picker, the level meter
are each poked in place. So rendered UI drifts from component state, and each
drift is a separate bug with a separate patch:

- [01](01-toggle-reentrancy.md): a red error painted over a recording that
  started fine.
- [03](03-mic-state.md): the switch renders ON above an empty picker.
- [04](04-mic-meter.md): the meter shown while nothing feeds it.
- [06](../06-demo-toggle.md): the label frozen at "Stop" though `recording`
  flipped false.

Fixing each poke in isolation leaves the next one free to drift.

## Fix

Introduce a single `_render(state)` that derives every displayed value from
component state (recording, elapsed, eventCount, micEnabled, micGranted, error,
demo). Handlers mutate state and call `_render`; no handler writes display DOM
directly. Land this before the behavior tickets so each routes its fix through
render instead of adding another poke.

## Acceptance criteria

- `_render(state)` is the one place that writes display DOM: `grep` shows the
  handlers assign state and call `_render`, not `.textContent` / `.style` /
  `setAttribute` on display nodes. Cite `openjam-popup.js:line`.
- Component test: set state fields and call `_render`, assert the DOM reflects
  them — label text for `recording` true/false, timer text for `elapsed`, error
  notice hidden when `error` is empty. Command + passing output in the PR.
- Disconfirming input: hardcode one derived value (e.g. the label) instead of
  reading state → its render test fails. Paste the failing output.
- `npm test` green; the landing demo renders unchanged (screenshot).
