# Install CTA Component — Design

**Date:** 2026-07-10

## Problem

The landing page (`docs/index.html`) has four identical "Add to Chrome" install
buttons (nav, hero, step 1, final CTA). Today:

- The Chrome "icon" is a CSS `conic-gradient` circle (`.chrome`, index.html:72),
  not a real logo, and it's the same regardless of the visitor's browser.
- Browser detection is a hardcoded `if`-chain in the page IIFE (index.html:862)
  that only relabels the text ("Add to Brave" etc.), not the icon.
- The button markup (`<a class="btn btn-primary" href="…CWS…"> <span class="chrome">
  <span class="cta-label">…`) is pasted four times. Any change to href, icon, or
  label means editing four places.

Goal: one standalone source file that owns the whole button — icon, label, href,
and browser detection — so a change applies to every instance automatically, and
adding a browser is adding a data row. Show brand-accurate logos per detected
browser (Chrome, Chromium, Vivaldi, Brave).

## Constraints

- **Self-contained page (docs/CLAUDE.md).** No CDN scripts, external fonts, or
  network egress. Assets ship as files in `docs/` or inline. The SVGs are copied
  from Iconify at authoring time and inlined — no runtime fetch.
- **Single-file output.** The shipped `index.html` must remain one self-contained
  file, matching the existing `openjam-popup.js` → build-splice pattern.
- **No new runtime dependencies, no framework.** Vanilla custom element.
- **Honest labels.** Edge/Opera keep "Add to Chrome" (they have their own stores;
  OpenJam isn't on them). Detection semantics from index.html:853-870 are preserved.

## Approaches Considered

1. **`<install-cta>` light-DOM custom element, spliced inline (chosen).** A new
   `install-cta.js` at repo root defines an `ICONS` map + `BROWSERS` data table +
   a `pickBrowser(ua)` pure function + a light-DOM custom element that renders the
   full button. `build.mjs` splices it into `index.html` as a `<script>` between
   markers, exactly like the popup. Every usage site is `<install-cta></install-cta>`.
   - *Principles:* Single Source of Truth (icons/labels/href/detection in one
     file), Data Drives Behavior (add a browser = add a row), UI = fn(state).
     Matches the `<openjam-popup>` precedent.

2. **Render function + data table, HTML keeps `<a>` placeholders.** `install-cta.js`
   exports `mountInstallCtas()` + data; HTML keeps `<a data-install-cta>` skeletons
   the function fills.
   - *Rejected:* button structure still lives in HTML four times, so "change once,
     apply everywhere" is only half-true. Weak on the stated goal.

3. **Build-time expansion only.** `build.mjs` expands placeholders into static `<a>`
   markup at build.
   - *Rejected:* browser detection is inherently runtime (visitor UA), so it still
     needs a runtime shim — logic splits across build + runtime, violating "all
     logic in one file."

## Chosen Approach

Approach 1. It's the only option where a usage instance is just the tag and every
concern lives in the standalone file. Light DOM (not shadow) so the page's existing
`.btn` / `.btn-primary` CSS styles the button with no style duplication — shadow DOM
would wall those styles off and force a copy, breaking Single Source of Truth.

## Architecture

**New file: `install-cta.js` (repo root, next to `openjam-popup.js`).** Contains:

- `ICONS` — map of `id → inline SVG string` (chrome, chromium, vivaldi, brave).
  SVGs copied from Iconify at authoring time (fetched once via the Iconify API,
  then inlined — no runtime fetch):
  - Chrome: https://api.iconify.design/logos/chrome.svg
  - Chromium: https://api.iconify.design/selfhst/chromium.svg
    (Chromium is absent from the `logos:` set; `selfhst:chromium` is the
    brand-accurate substitute)
  - Vivaldi: https://api.iconify.design/logos/vivaldi-icon.svg
  - Brave: https://api.iconify.design/logos/brave.svg

  Sized via a wrapping span, not the SVG's own `1em` width, so all four render at a
  consistent box.
- `BROWSERS` — ordered data table. Each row: `{ id, label, test }` where `test` is a
  predicate over `(ua, nav)`. Order matters (Vivaldi/Brave carry "Chrome" in UA),
  same ordering the current if-chain relies on.
- `CWS_URL` — the Chrome Web Store link, defined once (currently repeated 4×).
- `pickBrowser(ua, nav)` — **pure function.** Walks `BROWSERS`, returns the first
  match, else the Chrome default. Returns `{ id, label, svg }`. Unit-testable.
- `<install-cta>` — light-DOM custom element. `connectedCallback()` calls
  `pickBrowser(navigator.userAgent, navigator)` and sets `this.innerHTML` to the full
  `<a class="btn btn-primary" href=CWS_URL target=_blank rel=noopener>` with the icon
  span + `<span class="cta-label">Add to {label}</span>`. Optional `compact` attribute
  for the nav variant if it needs tighter styling (else identical).

**`build.mjs`:** add an `install-cta:start` / `install-cta:end` marker splice that
inlines `install-cta.js` as a `<script>` (neutralising `</script`, same as the popup),
so the shipped `index.html` stays one file.

**`docs/index.html`:** replace the four `<a class="btn btn-primary">…</a>` install
blocks with `<install-cta></install-cta>`; add the marker pair for the build splice;
drop the now-dead `.chrome` CSS (index.html:72-75) and the relabel if-chain
(index.html:862-870), whose job the element now owns.

## Data Model

```js
// install-cta.js
const CWS_URL = "https://chromewebstore.google.com/detail/openjam/oljdbmjhfjnhnpjcehcnkbbjdgnpjdaj";

const ICONS = {
  chrome:   `<svg …logos:chrome…></svg>`,
  chromium: `<svg …selfhst:chromium…></svg>`,
  vivaldi:  `<svg …logos:vivaldi-icon…></svg>`,
  brave:    `<svg …logos:brave…></svg>`,
};

// Order matters: Vivaldi & Brave UA strings both contain "Chrome".
// Edge/Opera intentionally absent → fall through to the Chrome default.
const BROWSERS = [
  { id: "vivaldi",  label: "Vivaldi",  test: (ua) => /Vivaldi/.test(ua) },
  { id: "brave",    label: "Brave",    test: (ua, nav) => !!nav.brave },
  { id: "chromium", label: "Chromium", test: (ua) => /Chromium\//.test(ua) },
];
const DEFAULT = { id: "chrome", label: "Chrome" };

function pickBrowser(ua, nav) {
  if (/Edg\//.test(ua) || /OPR\//.test(ua)) return { ...DEFAULT, svg: ICONS.chrome };
  const hit = BROWSERS.find((b) => b.test(ua, nav)) || DEFAULT;
  return { id: hit.id, label: hit.label, svg: ICONS[hit.id] };
}
```

## Error Handling

- **Unknown / missing UA** → `pickBrowser` falls through to the Chrome default. No
  throw; the button always renders something valid.
- **`navigator.brave` absent** → predicate is `!!nav.brave`, safe when undefined.
- **Element used with no JS** (JS disabled) → light-DOM element is empty. Mitigation:
  keep a minimal `<noscript>`/fallback `<a>` decision is an open question below.
- **Build marker missing** → `splice()` already throws with a clear message.

## Testing Strategy

- **Unit (`bun test`):** `pickBrowser` against real UA strings — Chrome, Chromium,
  Vivaldi, Brave (via `{brave:{}}`), Edge, Opera, empty string. Asserts `id`/`label`
  and that a non-empty `svg` comes back. This is the disconfirming-input coverage the
  root CLAUDE.md requires (Edge/Opera must NOT relabel).
- **e2e (`playwright`):** the four CTAs render an `<a>` with the CWS href, a visible
  icon, and a "Add to …" label; existing landing visual/structure tests updated for
  the new markup.
- **Build:** `node build.mjs` splices `install-cta.js` in; assert the shipped
  `index.html` contains the element definition and no `</script` breakage.

## Principles Applied

- **Single Source of Truth** — icons, labels, href, and detection live only in
  `install-cta.js`; `build.mjs` fans it into the page. Kills the 4× paste and the
  duplicated CWS URL.
- **Data Drives Behavior** — `BROWSERS` table; adding a browser is adding a row, not
  a new `if`.
- **Pure Functions for Testability** — `pickBrowser` is pure `(ua, nav) → {id,label,svg}`,
  replacing the untestable inline if-chain.
- **Separation of Concerns / UI = fn(state)** — the element renders; the data table
  decides. Detection logic isn't tangled into unrelated page-init code.
- **Deviation (light DOM, no encapsulation):** justified under "When This Doesn't
  Apply" — the button must inherit the page's `.btn` CSS. Shadow DOM would force
  duplicating those styles, a worse SSoT outcome than accepting open internals for a
  button.

## Open Questions

1. **No-JS fallback.** Light-DOM element renders empty without JS. Keep a static
   `<a class="btn btn-primary">Add to Chrome</a>` inside `<install-cta>` as fallback
   content the element replaces on upgrade? Low cost, honest default. Leaning yes.
2. **Nav variant.** Does the nav button need the `compact` attribute, or is it
   visually identical to the others once it uses `.btn btn-primary`? Confirm during
   implementation against the current nav styling.
3. **Icon sizing.** Iconify SVGs carry intrinsic `width` (`1em`, and Brave's
   `0.86em`). Normalise via a wrapper span with fixed dimensions so all four match
   the old 18px circle footprint.
