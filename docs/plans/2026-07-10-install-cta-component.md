# Install CTA Component Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ExecutingPlans to implement this plan task-by-task.

**Goal:** Replace the four hand-pasted "Add to Chrome" buttons on the landing page with one reusable `<install-cta>` custom element that renders the whole button, detects the visitor's browser, and shows a brand-accurate logo — defined once in a standalone file, spliced into `docs/index.html` at build.

**Architecture:** New classic-script `install-cta.js` at the repo root (next to `openjam-popup.js`) holds an `ICONS` map, a `BROWSERS` data table, a pure `pickBrowser(ua, nav)` function, and a **light-DOM** custom element. `build.mjs` splices it into `docs/index.html` between markers (same mechanism as the popup), so the shipped page stays one self-contained file. Light DOM (not shadow) so the page's existing `.btn`/`.btn-primary` CSS styles the button — no style duplication.

**Tech Stack:** Vanilla custom elements (no framework), esbuild-free string splice in `build.mjs`, `bun:test` for unit, `@playwright/test` for e2e.

**Design doc:** `docs/plans/2026-07-10-install-cta-component-design.md`

---

## Conventions this plan follows

- **Commits:** Ian handles commits on openjam. Each task ends with a `git add` staging step and a suggested message, but **do not run `git commit` unless Ian asks in the moment.** Stage and report; let him commit.
- **Classic-script safety:** `install-cta.js` is spliced as a classic `<script>` (build.mjs neutralises `</script`). It must have **no top-level `import`/`export`** — the browser would throw. Testability comes from a guarded CJS export at the bottom and a DOM-gated element block.
- **Acceptance = command + output** (root `CLAUDE.md`). Every test names its disconfirming input (`e2e/CLAUDE.md`).

---

### Task 1: `install-cta.js` — data + pure `pickBrowser` (no DOM yet)

**Files:**
- Create: `install-cta.js`
- Test: `test/install-cta.test.js`

**Step 1: Write the failing test**

`test/install-cta.test.js`:

```js
// pickBrowser is a pure (ua, nav) -> {id,label,svg} function. It replaces the
// hand-rolled if-chain that used to live in docs/index.html's page IIFE.
// Disconfirming input: Edge/Opera MUST fall through to Chrome (OpenJam isn't on
// their stores) — asserting they relabel to "Edge"/"Opera" fails on purpose.
import { test, expect } from "bun:test";
import { pickBrowser, BROWSERS, ICONS } from "../install-cta.js";

const UA = {
  chrome:   "Mozilla/5.0 ... Chrome/126.0.0.0 Safari/537.36",
  chromium: "Mozilla/5.0 ... Chromium/126.0.0.0 Chrome/126.0.0.0 Safari/537.36",
  vivaldi:  "Mozilla/5.0 ... Chrome/126.0.0.0 Safari/537.36 Vivaldi/6.7",
  edge:     "Mozilla/5.0 ... Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  opera:    "Mozilla/5.0 ... Chrome/126.0.0.0 Safari/537.36 OPR/110.0.0.0",
};

test("Chrome is the default", () => {
  const b = pickBrowser(UA.chrome, {});
  expect(b.id).toBe("chrome");
  expect(b.label).toBe("Chrome");
  expect(b.svg.length).toBeGreaterThan(0);
});

test("Vivaldi wins over the Chrome token in its UA", () => {
  expect(pickBrowser(UA.vivaldi, {}).label).toBe("Vivaldi");
});

test("Brave is detected via navigator.brave, not the UA", () => {
  expect(pickBrowser(UA.chrome, { brave: {} }).label).toBe("Brave");
});

test("Chromium is detected via the Chromium/ token", () => {
  expect(pickBrowser(UA.chromium, {}).label).toBe("Chromium");
});

test("Edge and Opera fall through to Chrome (own stores, not CWS-friendly)", () => {
  expect(pickBrowser(UA.edge, {}).label).toBe("Chrome");
  expect(pickBrowser(UA.opera, {}).label).toBe("Chrome");
});

test("every browser id has a non-empty inline SVG", () => {
  for (const id of ["chrome", "chromium", "vivaldi", "brave"]) {
    expect(ICONS[id]).toBeDefined();
    expect(ICONS[id]).toContain("<svg");
  }
  // Every data-table row maps to an icon.
  for (const b of BROWSERS) expect(ICONS[b.id]).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/install-cta.test.js`
Expected: FAIL — `Cannot find module '../install-cta.js'`.

**Step 3: Fetch the four SVGs to inline**

The icons come from Iconify, fetched once at authoring time and inlined (no runtime fetch — self-contained page rule, `docs/CLAUDE.md`). Run:

```bash
curl -s https://api.iconify.design/logos/chrome.svg
curl -s https://api.iconify.design/selfhst/chromium.svg
curl -s https://api.iconify.design/logos/vivaldi-icon.svg
curl -s https://api.iconify.design/logos/brave.svg
```

Expected: each prints one `<svg …>…</svg>`. Paste each verbatim into the `ICONS` map below. (Chromium is absent from Iconify's `logos:` set; `selfhst:chromium` is the brand-accurate substitute.)

**Step 4: Write minimal implementation**

`install-cta.js` — data + pure function only (element added in Task 2):

```js
/* ============================================================================
 * <install-cta> — the OpenJam "Add to <browser>" install button.
 * ----------------------------------------------------------------------------
 * One source of truth for the install CTA: href, per-browser label, and
 * brand logo. Spliced into docs/index.html by build.mjs (classic <script>) so
 * every button on the page stays in sync. Light DOM on purpose — the page's
 * .btn/.btn-primary CSS styles it, no shadow encapsulation to duplicate styles.
 *
 * Classic-script safe: no top-level import/export. Pure logic is exported for
 * bun tests via a guarded module.exports at the bottom; the custom element is
 * defined only when a DOM is present.
 * ========================================================================== */

// One home for the store link (was pasted 4× in docs/index.html).
const CWS_URL =
  "https://chromewebstore.google.com/detail/openjam/oljdbmjhfjnhnpjcehcnkbbjdgnpjdaj";

// Brand logos, inlined from Iconify (see plan Task 1, Step 3). No runtime fetch.
const ICONS = {
  chrome:   `<svg …paste logos:chrome here…></svg>`,
  chromium: `<svg …paste selfhst:chromium here…></svg>`,
  vivaldi:  `<svg …paste logos:vivaldi-icon here…></svg>`,
  brave:    `<svg …paste logos:brave here…></svg>`,
};

// Data drives behaviour: add a browser = add a row. ORDER MATTERS — Vivaldi and
// Brave both carry "Chrome" in their UA, so they must be tested before the
// Chromium/Chrome fallback. Edge/Opera are intentionally absent (own stores):
// they fall through to the Chrome default in pickBrowser.
const BROWSERS = [
  { id: "vivaldi",  label: "Vivaldi",  test: (ua) => /Vivaldi/.test(ua) },
  { id: "brave",    label: "Brave",    test: (ua, nav) => !!(nav && nav.brave) },
  { id: "chromium", label: "Chromium", test: (ua) => /Chromium\//.test(ua) },
];
const DEFAULT = { id: "chrome", label: "Chrome" };

// Pure: (ua, nav) -> {id, label, svg}. No DOM, no globals — trivially testable.
function pickBrowser(ua, nav) {
  // Edge/Opera: own stores, CWS install has friction → honest "Add to Chrome".
  if (/Edg\//.test(ua) || /OPR\//.test(ua)) {
    return { id: DEFAULT.id, label: DEFAULT.label, svg: ICONS[DEFAULT.id] };
  }
  const hit = BROWSERS.find((b) => b.test(ua, nav)) || DEFAULT;
  return { id: hit.id, label: hit.label, svg: ICONS[hit.id] };
}

// Guarded CJS export for bun tests; invisible to the browser (module undefined).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { pickBrowser, BROWSERS, ICONS, CWS_URL };
}
```

**Step 5: Run test to verify it passes**

Run: `bun test test/install-cta.test.js`
Expected: PASS — 6 tests.

Then confirm the disconfirming input actually bites: temporarily add `{ id: "edge", label: "Edge", test: (ua) => /Edg\//.test(ua) }` to the top of `BROWSERS`, rerun, and the Edge/Opera test must FAIL on the `"Chrome"` assertion. Revert.

**Step 6: Stage (do not commit — Ian commits)**

```bash
git add install-cta.js test/install-cta.test.js
# Suggested message: feat(landing): install-cta data + pure pickBrowser
```

---

### Task 2: Add the light-DOM custom element

**Files:**
- Modify: `install-cta.js` (append the element block before the CJS export)

**Step 1: Write the element (DOM-gated)**

Insert **above** the `module.exports` guard:

```js
// Element defined only where a DOM exists (bun test imports this file with no
// DOM — gating keeps pickBrowser importable without a HTMLElement shim).
if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class InstallCta extends HTMLElement {
    connectedCallback() {
      const b = pickBrowser(navigator.userAgent, navigator);
      // Light DOM: rendered <a> is a normal child, so global .btn CSS applies.
      this.innerHTML =
        `<a class="btn btn-primary" href="${CWS_URL}" target="_blank" rel="noopener">` +
          `<span class="cta-ic" aria-hidden="true">${b.svg}</span> ` +
          `<span class="cta-label">Add to ${b.label}</span>` +
        `</a>`;
    }
  }
  customElements.define("install-cta", InstallCta);
}
```

**Step 2: Verify the pure-function tests still pass (element block is skipped under bun)**

Run: `bun test test/install-cta.test.js`
Expected: PASS — 6 tests, no `HTMLElement is not defined` error (the `if` guard is skipped).

**Step 3: Stage**

```bash
git add install-cta.js
# Suggested message: feat(landing): <install-cta> light-DOM element
```

---

### Task 3: Splice `install-cta.js` into `docs/index.html` via `build.mjs`

**Files:**
- Modify: `build.mjs:57-63` (add a second splice next to the popup splice)
- Modify: `docs/index.html` (add marker pair once, near the popup markers or end of body)

**Step 1: Add the marker pair to `docs/index.html`**

Place immediately after the existing popup markers block (search `<!-- openjam-popup:end -->`). Add on their own lines:

```html
<!-- install-cta:start --><!-- install-cta:end -->
```

**Step 2: Add the splice to `build.mjs`**

After the popup splice (currently `build.mjs:62`), and before `writeFileSync("docs/index.html", landing)` at `build.mjs:63`, add:

```js
const CTA_START = "<!-- install-cta:start -->";
const CTA_END = "<!-- install-cta:end -->";
const ctaJs = readFileSync("install-cta.js", "utf8").replace(/<\/script/gi, "<\\/script");
landing = splice(landing, CTA_START, CTA_END, "\n<script>\n" + ctaJs + "\n</script>\n", "docs/index.html (install-cta)");
```

Update the final `console.log` to mention the CTA splice.

**Step 3: Run the build**

Run: `node build.mjs`
Expected: `spliced …` log with no `splice: missing marker` error, exit 0.

**Step 4: Verify the element definition landed exactly once**

Run: `grep -c "class InstallCta" docs/index.html`
Expected: `1`.
Run: `grep -c "customElements.define(\"install-cta\"" docs/index.html`
Expected: `1`.

**Step 5: Stage**

```bash
git add build.mjs docs/index.html
# Suggested message: build(landing): splice install-cta into index.html
```

---

### Task 4: Replace the four CTA buttons with `<install-cta>`, remove dead code

**Files:**
- Modify: `docs/index.html` — CTA blocks at lines ~260-262, ~275-277, ~417-419, ~445-447
- Modify: `docs/index.html` — dead `.chrome` CSS at lines ~72-75
- Modify: `docs/index.html` — dead relabel if-chain at lines ~853-870

**Step 1: Replace each of the four button blocks**

Each block is:

```html
<a class="btn btn-primary" href="https://chromewebstore.google.com/detail/openjam/oljdbmjhfjnhnpjcehcnkbbjdgnpjdaj" target="_blank" rel="noopener">
  <span class="chrome" aria-hidden="true"></span> <span class="cta-label">Add to Chrome</span>
</a>
```

Replace **the whole `<a>…</a>`** with:

```html
<install-cta></install-cta>
```

Preserve any wrapper-specific inline style: the step-1 button carries `style="margin-top:14px"` on the `<a>` (index.html:417). Move that onto the element: `<install-cta style="margin-top:14px"></install-cta>` (light DOM: the margin applies to the element box wrapping the `<a>`; if it doesn't visually land, put it back on the inner `.btn` via a `compact`-style attribute in Task 6's open-question check).

**Step 2: Replace the dead `.chrome` CSS with `.cta-ic` sizing**

Delete `index.html:72-75` (`.btn .chrome{…}` and `.btn .chrome::after{…}`). In their place add the icon-box sizing (single home for icon dimensions, matching the old 18px circle):

```css
.btn .cta-ic{width:18px;height:18px;flex:0 0 auto;display:inline-flex}
.btn .cta-ic svg{width:100%;height:100%;display:block}
```

**Step 3: Remove the dead relabel if-chain**

Delete the block at `index.html:853-870` (the `/* relabel the install CTA */` comment through the closing `}` of `if (browser){…}`). `<install-cta>` now owns detection. Leave the surrounding IIFE and the nav-shadow / reveal code intact.

**Step 4: Rebuild and eyeball**

Run: `node build.mjs && node -e "const h=require('fs').readFileSync('docs/index.html','utf8'); console.log('install-cta tags:', (h.match(/<install-cta/g)||[]).length); console.log('leftover .chrome:', h.includes('.btn .chrome')); console.log('leftover relabel:', h.includes('relabel the install CTA'));"`
Expected: `install-cta tags: 5` (4 usages + 1 in the spliced JS string is not a tag; the count matches only the `<install-cta` occurrences — 4 usage tags, plus none from JS since the source uses `"install-cta"` quoted → verify the number is 4; if 5, one is the quoted define, which is fine, adjust expectation to 4 usages). `leftover .chrome: false`. `leftover relabel: false`.

> Note: `customElements.define("install-cta", …)` uses a quoted string, not a `<install-cta` tag, so it won't inflate the tag count. Expected usage tags: **4**.

**Step 5: Drive it in a real browser (verify skill)**

Run the app / open the built page and confirm all four buttons render a logo + "Add to <browser>" and link to the CWS URL. Use the e2e harness in Task 6 as the automated proof; for a manual smoke: `open docs/index.html` (renders as Chrome default when opened in Chrome).

**Step 6: Stage**

```bash
git add docs/index.html
# Suggested message: refactor(landing): use <install-cta> for all install buttons
```

---

### Task 5: Guard single-source-of-truth (unit)

**Files:**
- Modify: `test/popup-source-of-truth.test.js` (add an install-cta guard, mirroring the popup guard)

**Step 1: Write the failing test**

Add to `test/popup-source-of-truth.test.js`:

```js
const CTA_START = "<!-- install-cta:start -->";
const CTA_END = "<!-- install-cta:end -->";

test("install-cta is spliced from one source, no hand-pasted copy", () => {
  const html = read("docs/index.html");
  expect(html).toContain(CTA_START);
  expect(html).toContain(CTA_END);
  // Exactly one class definition in the page (spliced) and one in source.
  expect(html.match(/class InstallCta\b/g)?.length ?? 0).toBe(1);
  expect(read("install-cta.js").match(/class InstallCta\b/g)?.length ?? 0).toBe(1);
  // The CWS URL is authored once (in install-cta.js), not pasted in the page's
  // static markup. It appears in the page ONLY inside the spliced script.
  const withoutSplice = html.replace(
    new RegExp(`${escapeRe(CTA_START)}[\\s\\S]*?${escapeRe(CTA_END)}`), "");
  expect(withoutSplice.includes("chromewebstore.google.com/detail/openjam")).toBe(false);
});
```

**Step 2: Run to verify it passes after build**

Run: `bun test test/popup-source-of-truth.test.js`
Expected: PASS (the `beforeAll(build)` already rebuilds). Disconfirming input: paste a raw `<a href="…chromewebstore…">` into the page's static markup — the `withoutSplice` assertion must fail. Verify once, then revert.

**Step 3: Stage**

```bash
git add test/popup-source-of-truth.test.js
# Suggested message: test(landing): guard install-cta single source of truth
```

---

### Task 6: Update e2e — structure + browser relabel

**Files:**
- Modify: `e2e/landing-page-structure.spec.mjs`

**Step 1: Update the structure test for the new markup**

The four buttons are now `<install-cta>` rendering an inner `<a.btn>`. Add to the "sections and headings render" test (or a new test):

```js
test("install CTAs render a logo + label and link to the Chrome Web Store", async ({ page }) => {
  await page.goto(url, { waitUntil: "load" });
  const ctas = page.locator("install-cta a.btn");
  await expect(ctas).toHaveCount(4);                    // nav, hero, step 1, final
  const first = ctas.first();
  await expect(first).toHaveAttribute("href", /chromewebstore\.google\.com\/detail\/openjam/);
  await expect(first.locator(".cta-ic svg")).toBeVisible();   // real logo, not empty
  await expect(first.locator(".cta-label")).toHaveText(/Add to Chrome/); // Chromium UA under Playwright
});
```

Disconfirming input: change `toHaveCount(4)` expectation by deleting one `<install-cta>` from the page → the count assertion fails. (`e2e/CLAUDE.md`: assert the user-visible outcome — the rendered `<a>`, the visible SVG — not the mechanism.)

**Step 2: Add a relabel test with a spoofed UA**

Playwright overrides the UA per test via `test.use({ userAgent })` (https://playwright.dev/docs/api/class-testoptions#test-options-user-agent). Verify the data table actually swaps the label:

```js
test.describe("browser relabel", () => {
  test.use({ userAgent: "Mozilla/5.0 (X11) Chrome/126.0.0.0 Safari/537.36 Vivaldi/6.7" });
  test("Vivaldi UA relabels every CTA to 'Add to Vivaldi'", async ({ page }) => {
    await page.goto(url, { waitUntil: "load" });
    const labels = page.locator("install-cta .cta-label");
    await expect(labels.first()).toHaveText("Add to Vivaldi");
    // Disconfirming: with the default Chrome UA this reads "Add to Chrome" — a
    // stuck label (detection not wired) fails here.
  });
});
```

**Step 3: Regenerate the visual baseline**

The button markup/appearance changed, so the full-page pixel baseline must be regenerated (CI is the snapshot source of truth per `playwright.config`). Locally macOS skips snapshot compare. Note in the PR that `npm run test:snapshots` must run to refresh `landing-full.png`.

Run (structure only, locally): `npx playwright test landing-page-structure -g "install CTAs|relabel|sections"`
Expected: the structure + relabel tests PASS (visual test may report a diff locally — expected until snapshots regenerate in CI).

**Step 4: Stage**

```bash
git add e2e/landing-page-structure.spec.mjs
# Suggested message: test(e2e): install-cta structure + browser relabel
```

---

### Task 7: Full suite

**Step 1: Run the whole gate**

Run: `npm test`
Expected: build succeeds; `bun test test/` green (incl. `install-cta.test.js`, `popup-source-of-truth.test.js`); `playwright test` green except the landing visual baseline, which needs `npm run test:snapshots` (CI). Paste the output.

**Step 2: Update feature-set docs if one covers the install flow**

Per `docs/CLAUDE.md`, feature-set docs change in the same PR as the UI. Check `docs/feature-set/` for an install/CTA doc; if one names the "Add to Chrome" button, update it to describe per-browser relabeling. If none exists, no action.

**Step 3: Stage any doc changes**

```bash
git add docs/feature-set/ 2>/dev/null || true
# Suggested message: docs(feature-set): note per-browser install relabel
```

---

## Open questions to resolve during implementation

1. **No-JS fallback (design open Q1).** Light-DOM `<install-cta>` is empty without JS. If a static fallback is wanted, put a plain `<a class="btn btn-primary" href="…CWS…">Add to Chrome</a>` *inside* `<install-cta>…</install-cta>` in the page; the element replaces it on upgrade via `this.innerHTML`. Costs a little markup back in the page (but not the logic). Decide with Ian; default is no fallback (matches the popup, which also needs JS).
2. **Nav variant (design open Q2).** Confirm the nav button looks right as `.btn btn-primary`; if it needs the tighter old sizing, add a `compact` attribute the element reads to add a class. Only add if visually needed (YAGNI).
3. **`margin-top` on step-1 button.** Verify the moved inline style lands correctly on the light-DOM wrapper; adjust per Task 4 Step 1 if not.

## Principles applied

- **Single Source of Truth** — icons, labels, href, detection live only in `install-cta.js`; `build.mjs` fans it into the page; Task 5 guards it.
- **Data Drives Behavior** — `BROWSERS` table; add a browser = add a row (Task 1).
- **Pure Functions for Testability** — `pickBrowser` is pure and unit-tested in isolation (Task 1), replacing the untestable inline if-chain.
- **Separation of Concerns / UI = fn(state)** — element renders, data decides; detection no longer tangled into page-init code (Task 4 Step 3).
- **Deviation (light DOM):** accepted so the button inherits the page's `.btn` CSS — shadow DOM would duplicate those styles (design doc "Principles Applied").
