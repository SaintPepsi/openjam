# docs/ — conventions

- **The landing page (`index.html`) is self-contained.** No CDN scripts,
  external fonts, analytics, or any network egress — the root `CLAUDE.md`
  privacy rule applies to the marketing page too, and this directory is where
  a stray `<link href="https://fonts...">` is most likely to appear. Assets
  ship as files in this directory or inline.
- **The `<openjam-popup>` block in `index.html` is generated.** Edit
  `openjam-popup.js` at the repo root and run `node build.mjs`; hand-edits to
  the spliced block are overwritten by the next build. (Until
  `docs/popup-redesign-fixes/done/05-component-source-of-truth.md` lands, the block
  is a manual paste — do not edit it independently either; fix the source and
  re-sync.)
- **Reusable UI is a vanilla custom element, authored at the repo root and
  spliced into `index.html` by `build.mjs` between markers** (like
  `openjam-popup.js` and `install-cta.js`). No framework, no build-time
  template engine, MV3-safe (no remote code). The one design choice per
  element is which DOM it uses:
  - **Shadow DOM** when the element owns its styling and must look identical
    on any host (`<openjam-popup>` — ships its own `<style>`).
  - **Light DOM** when it must adopt the host page's styling
    (`<install-cta>` renders a plain `.btn` so `index.html`'s button CSS
    styles it; a shadow root would wall those styles off and force a copy).
  Guard each spliced element with a single-source test (see
  `test/popup-source-of-truth.test.js`) so a hand-pasted copy can't drift.
  Ref: https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_custom_elements
- **`feature-set/` docs change in the same PR as the UI they describe.**
  Removing or renaming a control without updating its feature-set doc is the
  drift documented in `docs/popup-redesign-fixes/done/02-screenshot-button.md`.
- Planned/design docs follow the root convention: epic + numbered children,
  tickets depend forward only.
