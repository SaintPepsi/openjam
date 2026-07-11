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
 * defined only when a DOM is present (gated behind a HTMLElement check).
 * ========================================================================== */

const CWS_URL =
  "https://chromewebstore.google.com/detail/openjam/oljdbmjhfjnhnpjcehcnkbbjdgnpjdaj";

// Brand logos, inlined from Iconify. No runtime fetch (self-contained page).
// Sources: logos/chrome, selfhst/chromium, logos/vivaldi-icon, logos/brave.
const ICONS = {
  chrome:   `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 256 256"><path fill="#fff" d="M128.003 199.216c39.335 0 71.221-31.888 71.221-71.223S167.338 56.77 128.003 56.77S56.78 88.658 56.78 127.993s31.887 71.223 71.222 71.223"/><path fill="#229342" d="M35.89 92.997Q27.92 79.192 17.154 64.02a127.98 127.98 0 0 0 110.857 191.981q17.671-24.785 23.996-35.74q12.148-21.042 31.423-60.251v-.015a63.993 63.993 0 0 1-110.857.017Q46.395 111.19 35.89 92.998"/><path fill="#fbc116" d="M128.008 255.996A127.97 127.97 0 0 0 256 127.997A128 128 0 0 0 238.837 64q-36.372-3.585-53.686-3.585q-19.632 0-57.152 3.585l-.014.01a63.99 63.99 0 0 1 55.444 31.987a63.99 63.99 0 0 1-.001 64.01z"/><path fill="#1a73e8" d="M128.003 178.677c27.984 0 50.669-22.685 50.669-50.67s-22.685-50.67-50.67-50.67c-27.983 0-50.669 22.686-50.669 50.67s22.686 50.67 50.67 50.67"/><path fill="#e33b2e" d="M128.003 64.004H238.84a127.973 127.973 0 0 0-221.685.015l55.419 95.99l.015.008a63.993 63.993 0 0 1 55.415-96.014z"/></svg>`,
  chromium: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 512 512"><linearGradient id="SVG8VGZfeUp" x1="29.563" x2="29.418" y1="107.274" y2="208.961" gradientTransform="translate(272.363 -277.956)scale(3.7794)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#afccfb"/><stop offset="1" stop-color="#8bb5f8"/></linearGradient><path fill="url(#SVG8VGZfeUp)" d="m256 256l110.9 64L256 512c141.4 0 256-114.6 256-256c0-46.6-12.5-90.3-34.3-128H256z"/><linearGradient id="SVGi9saKdTR" x1="-96.977" x2="-96.886" y1=".511" y2="1.996" gradientTransform="matrix(231.6257 0 0 231.6247 22710.69 -116.223)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1972e7"/><stop offset="1" stop-color="#1969d5"/></linearGradient><path fill="url(#SVGi9saKdTR)" d="M256 0C161.2 0 78.6 51.5 34.3 128l110.8 192L256 256V128h221.7C433.4 51.5 350.7 0 256 0"/><linearGradient id="SVGREkTJdqU" x1="-96.448" x2="-94.697" y1="-.234" y2=".777" gradientTransform="rotate(60 -9213.684 16059.277)scale(189.8637 189.864)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#659cf6"/><stop offset="1" stop-color="#4285f4"/></linearGradient><path fill="url(#SVGREkTJdqU)" d="M0 256c0 141.4 114.6 256 256 256l110.9-192L256 256l-110.9 64L34.3 128C12.5 165.7 0 209.4 0 256"/><path fill="#fff" d="M384 256c0 70.7-57.3 128-128 128s-128-57.3-128-128s57.3-128 128-128s128 57.3 128 128"/><linearGradient id="SVGsbzv3cDc" x1="-4.47" x2="-4.189" y1="113.868" y2="168.799" gradientTransform="translate(272.363 -277.956)scale(3.7794)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3680f0"/><stop offset="1" stop-color="#2678ec"/></linearGradient><path fill="url(#SVGsbzv3cDc)" d="M360 256c0 57.4-46.6 104-104 104s-104-46.6-104-104s46.6-104 104-104s104 46.6 104 104"/></svg>`,
  vivaldi:  `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 256 256"><defs><linearGradient id="SVGcEMoNdBf" x1="20.985%" x2="75.846%" y1="5.132%" y2="100.366%"><stop offset="0%" stop-opacity=".2"/><stop offset="79%" stop-opacity=".05"/></linearGradient></defs><path fill="#ef3939" d="M127.999 255.999c56.092 0 87.262 0 107.63-20.37C256 215.262 256 184.092 256 128c0-56.09 0-87.261-20.37-107.63C215.262 0 184.092 0 128 0C71.91 0 40.7 0 20.37 20.369S0 71.909 0 127.999c0 56.092 0 87.262 20.369 107.63C40.738 256 71.909 256 127.999 256"/><path fill="url(#SVGcEMoNdBf)" d="M211.221 80.633c-6.179-11.141-16.808-20.264-26.815-28.152s-19.83-12.64-32.108-16.048c-12.279-3.408-24.827-3.345-37.468-1.743s-23.52 4.488-34.56 10.851C69.232 51.904 60.658 59.695 52.936 69.83c-7.72 10.135-12.851 20.199-16.054 32.53s-4.363 25.992-2.549 38.601c1.814 12.61 4.017 24.61 10.566 35.54l.54.924l45.09 78.166q11.226.309 24.302.27h12.805c20.448.44 40.906-.165 61.292-1.812c20.404-2.237 35.061-7.25 46.286-18.548c16.509-16.506 19.634-40.106 20.212-78.283z"/><path fill="#fff" d="M195.808 60.085A95.95 95.95 0 0 0 91.226 39.316a96 96 0 0 0-43.058 35.358a96.02 96.02 0 0 0 0 106.65a96 96 0 0 0 43.058 35.359a95.95 95.95 0 0 0 104.582-20.77a95.91 95.91 0 0 0 20.863-104.682a95.9 95.9 0 0 0-20.863-31.146m-5.755 44.195a290355 290355 0 0 0-47.466 82.633a15.87 15.87 0 0 1-13.054 8.614a15.06 15.06 0 0 1-15.024-7.996c-10.003-17.23-19.93-34.575-29.855-51.883a6307 6307 0 0 1-18.152-31.6a15.958 15.958 0 0 1 12.977-24.184a15.45 15.45 0 0 1 14.637 8.268c4.48 7.726 8.883 15.452 13.287 23.179c3.205 5.563 6.294 11.125 9.577 16.611a25.1 25.1 0 0 0 8.8 9.253a25.1 25.1 0 0 0 12.21 3.727a25.604 25.604 0 0 0 27.036-22.754c0-1.043 0-2.086.232-2.627a27.05 27.05 0 0 0-2.703-11.937a15.956 15.956 0 0 1 15.864-23.422a15.95 15.95 0 0 1 11.48 7.05a16 16 0 0 1 2.471 6.444c.435 3.7-.38 7.44-2.317 10.624"/></svg>`,
  brave:    `<svg xmlns="http://www.w3.org/2000/svg" width="0.86em" height="1em" viewBox="0 0 256 301"><defs><linearGradient id="SVGE5ozGNYt" x1="0%" x2="100.097%" y1="50.018%" y2="50.018%"><stop offset="0%" stop-color="#fff"/><stop offset="14.13%" stop-color="#fff" stop-opacity=".958"/><stop offset="100%" stop-color="#fff" stop-opacity=".7"/></linearGradient><linearGradient id="SVGXA4vbbdk" x1="-.039%" x2="100%" y1="49.982%" y2="49.982%"><stop offset="0%" stop-color="#f1f1f2"/><stop offset="9.191%" stop-color="#e4e5e6"/><stop offset="23.57%" stop-color="#d9dadb"/><stop offset="43.8%" stop-color="#d2d4d5"/><stop offset="100%" stop-color="#d0d2d3"/></linearGradient></defs><path fill="#f15a22" d="M256 97.1L246.7 72l6.4-14.4c.8-1.9.4-4-1-5.5l-17.5-17.7c-7.7-7.7-19.1-10.4-29.4-6.8l-4.9 1.7l-26.8-29l-45.3-.3h-.3L82.3.4L55.6 29.6l-4.8-1.7c-10.4-3.7-21.9-1-29.6 6.9l-17.8 18c-1.2 1.2-1.5 2.9-.9 4.4l6.7 15L0 97.3L6 120l27.2 103.3c3.1 11.9 10.3 22.3 20.4 29.5c0 0 33 23.3 65.5 44.4c2.9 1.9 5.9 3.2 9.1 3.2s6.2-1.3 9.1-3.2c36.6-24 65.5-44.5 65.5-44.5c10-7.2 17.2-17.6 20.3-29.5l27-103.3z"/><path fill="url(#SVGE5ozGNYt)" d="M34.5 227.7L0 99.5l10.1-25.1l-7-18.6l16.7-17c5.5-4.9 16.3-6.6 21.3-3.7l26.1 15l34 7.9l26.5-11l2.2 227.7c-.4 32.8 1.7 29.3-22.4 13.8L48 248.6c-6.4-6.1-11.3-13-13.5-20.9" opacity=".15"/><path fill="url(#SVGXA4vbbdk)" d="m202.2 252.246l-50.6 34.6c-14.1 7.7-20.9 15.3-22 11.6c-.9-2.9-.2-11.4-.5-24.6l-.6-222.7c.1-2.2 1.6-5.9 4.2-5.5l25.8 7.8l37.2-5.8l24.6-18.1c2.6-2 6.4-1.8 8.8.5l22 21c2 2.1 2.1 6.2.9 8.8l-6.1 11.3l10.1 26.1l-34.8 129.4c-5.4 16.1-13 20.3-19 25.6" opacity=".4"/><path fill="#fff" d="M134 184.801c-1.2-.5-2.5-.9-2.9-.9h-3.2c-.4 0-1.7.4-2.9.9l-13 5.4c-1.2.5-3.2 1.4-4.4 2l-19.6 10.2c-1.2.6-1.3 1.7-.2 2.5l17.3 12.2c1.1.8 2.8 2.1 3.8 3l7.7 6.6c1 .9 2.6 2.3 3.6 3.2l7.4 6.6c1 .9 2.6.9 3.6 0l7.6-6.6c1-.9 2.6-2.3 3.6-3.2l7.7-6.7c1-.9 2.7-2.2 3.8-3l17.3-12.3c1.1-.8 1-1.9-.2-2.5l-19.6-10c-1.2-.6-3.2-1.5-4.4-2z"/><path fill="#fff" d="M227.813 101.557c.4-1.3.4-1.8.4-1.8c0-1.3-.1-3.5-.3-4.8l-1-2.9c-.6-1.2-1.6-3.1-2.4-4.2l-11.3-16.7c-.7-1.1-2-2.8-2.9-3.9l-14.6-18.3c-.8-1-1.6-1.9-1.7-1.8h-.2s-1.1.2-2.4.4l-22.3 4.4c-1.3.3-3.4.7-4.7.9l-.4.1c-1.3.2-3.4.1-4.7-.3l-18.7-6c-1.3-.4-3.4-1-4.6-1.3c0 0-3.8-.9-6.9-.8c-3.1 0-6.9.8-6.9.8c-1.3.3-3.4.9-4.6 1.3l-18.7 6c-1.3.4-3.4.5-4.7.3l-.4-.1c-1.3-.2-3.4-.7-4.7-.9l-22.5-4.2c-1.3-.3-2.4-.4-2.4-.4h-.2c-.1 0-.9.8-1.7 1.8l-14.6 18.3c-.8 1-2.1 2.8-2.9 3.9l-11.3 16.7c-.7 1.1-1.8 3-2.4 4.2l-1 2.9c-.2 1.3-.4 3.5-.3 4.8c0 0 0 .4.4 1.8c.7 2.4 2.4 4.6 2.4 4.6c.8 1 2.3 2.7 3.2 3.6l33.1 35.2c.9 1 1.2 2.8.7 4l-6.9 16.3c-.5 1.2-.6 3.2-.1 4.5l1.9 5.1c1.6 4.3 4.3 8.1 7.9 11l6.7 5.4c1 .8 2.8 1.1 4 .5l21.2-10.1c1.2-.6 3-1.8 4-2.7l15.2-13.7c2.2-2 2.3-5.4.3-7.6l-31.9-21.5c-1.1-.7-1.5-2.3-.9-3.5l14-26.4c.6-1.2.7-3.1.2-4.3l-1.7-3.9c-.5-1.2-2-2.6-3.2-3.1l-41.1-15.4c-1.2-.5-1.2-1 .1-1.1l26.5-2.5c1.3-.1 3.4.1 4.7.4l23.6 6.6c1.3.4 2.1 1.7 1.9 3l-8.2 44.9c-.2 1.3-.2 3.1.1 4.1s1.6 1.9 2.9 2.2l16.4 3.5c1.3.3 3.4.3 4.7 0l15.3-3.5c1.3-.3 2.6-1.3 2.9-2.2s.4-2.8.1-4.1l-8.1-44.9c-.2-1.3.6-2.7 1.9-3l23.6-6.6c1.3-.4 3.4-.5 4.7-.4l26.5 2.5c1.3.1 1.4.6.1 1.1l-41.1 15.6c-1.2.5-2.7 1.8-3.2 3.1l-1.7 3.9c-.5 1.2-.5 3.2.2 4.3l14.1 26.4c.6 1.2.2 2.7-.9 3.5l-31.9 21.6c-2.1 2.1-1.9 5.6.3 7.6l15.2 13.7c1 .9 2.8 2.1 4 2.6l21.3 10.1c1.2.6 3 .3 4-.5l6.7-5.5c3.6-2.9 6.3-6.7 7.8-11l1.9-5.1c.5-1.2.4-3.3-.1-4.5l-6.9-16.3c-.5-1.2-.2-3 .7-4l33.1-35.2c.9-1 2.3-2.6 3.2-3.6c-.2-.3 1.6-2.5 2.2-4.9"/></svg>`,
};

// Data drives behaviour: add a browser = add a row. `find` returns the first
// matching row, and Chrome is the default fallback (not a row). Current rows'
// tests are mutually exclusive, so order is irrelevant today. It only starts to
// matter if you add rows whose tests can BOTH match one UA (e.g. a broad
// Chrome-token row that would shadow Vivaldi/Brave) — put the specific row first.
const BROWSERS = [
  { id: "vivaldi",  label: "Vivaldi",  test: (ua) => /Vivaldi/.test(ua) },
  { id: "brave",    label: "Brave",    test: (ua, nav) => !!(nav && nav.brave) },
  { id: "chromium", label: "Chromium", test: (ua) => /Chromium\//.test(ua) },
];
// Chrome is the honest default. Edge/Opera aren't in the table on purpose: they
// have their own extension stores and CWS installs carry friction there, so they
// fall through to "Add to Chrome" rather than promising a store we're not on.
const DEFAULT_BROWSER = { id: "chrome", label: "Chrome" };

// Pure: (ua, nav) -> {id, label, svg}. No DOM, no globals — trivially testable.
function pickBrowser(ua, nav) {
  const hit = BROWSERS.find((b) => b.test(ua, nav)) || DEFAULT_BROWSER;
  return { id: hit.id, label: hit.label, svg: ICONS[hit.id] };
}

// Element defined only where a DOM exists (bun test imports this file with no
// DOM — gating keeps pickBrowser importable without a HTMLElement shim).
if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class InstallCta extends HTMLElement {
    connectedCallback() {
      const b = pickBrowser(navigator.userAgent, navigator);
      // Light DOM: the rendered <a> is a normal child, so the page's global
      // .btn / .btn-primary CSS styles it — no shadow root, no style duplication.
      this.innerHTML =
        `<a class="btn btn-primary" href="${CWS_URL}" target="_blank" rel="noopener">` +
          `<span class="cta-ic" aria-hidden="true">${b.svg}</span> ` +
          `<span class="cta-label">Add to ${b.label}</span>` +
        `</a>`;
    }
  }
  // Guard against double-registration (parity with openjam-popup.js).
  if (!customElements.get("install-cta")) customElements.define("install-cta", InstallCta);
}

// Guarded CJS export for bun tests; invisible to the browser (module undefined).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { pickBrowser, BROWSERS, ICONS };
}
