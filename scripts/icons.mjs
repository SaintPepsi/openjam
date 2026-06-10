// Generates icons/icon{16,32,48,128}.png from Microsoft Fluent Emoji 3D
// fruit art (MIT, https://github.com/microsoft/fluentui-emoji), fetched once
// via the Iconify API (https://iconify.design) and vendored into
// assets/iconify/ so rebuilds are offline and deterministic. Unicode/emoji
// have no raspberry or blackberry, so blueberries stand in.
//
//   npm run icons                # build manifest icons (DESIGN below)
//   PREVIEWS=1 npm run icons     # also render every design at 128px
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const DESIGN = "cluster"; // which design ships in icons/

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "icons");
const VENDOR = path.join(ROOT, "assets", "iconify");
const FRUITS = ["strawberry", "grapes", "cherries", "blueberries"];
mkdirSync(OUT, { recursive: true });
mkdirSync(VENDOR, { recursive: true });

async function svgDataURI(name) {
  const file = path.join(VENDOR, `${name}.svg`);
  if (!existsSync(file)) {
    const res = await fetch(`https://api.iconify.design/fluent-emoji:${name}.svg`);
    if (!res.ok) throw new Error(`iconify fetch failed for ${name}: ${res.status}`);
    writeFileSync(file, await res.text());
    console.log("vendored", path.relative(ROOT, file));
  }
  return `data:image/svg+xml;base64,${readFileSync(file).toString("base64")}`;
}

const uri = Object.fromEntries(
  await Promise.all(FRUITS.map(async (f) => [f, await svgDataURI(f)])),
);

// Each design returns absolutely-positioned art for an S x S tile. SVGs are
// vector, so rendering at the target size directly stays crisp.
const DESIGNS = {
  // Organic overlapping fruit pile: grapes and cherries peek out behind a
  // strawberry hero, blueberries tucked in front.
  cluster(S) {
    const sh = `filter:drop-shadow(0 ${S * 0.03}px ${S * 0.05}px rgba(40,5,20,.45))`;
    return `
      <img src="${uri.grapes}" style="position:absolute;width:${S * 0.5}px;top:${S * 0.07}px;left:${S * 0.05}px;transform:rotate(-14deg);${sh}">
      <img src="${uri.cherries}" style="position:absolute;width:${S * 0.48}px;top:${S * 0.08}px;right:${S * 0.04}px;transform:rotate(12deg);${sh}">
      <img src="${uri.blueberries}" style="position:absolute;width:${S * 0.4}px;bottom:${S * 0.05}px;left:${S * 0.07}px;transform:rotate(-6deg);${sh}">
      <img src="${uri.strawberry}" style="position:absolute;width:${S * 0.6}px;bottom:${S * 0.03}px;left:${S * 0.24}px;transform:rotate(-4deg);${sh}">`;
  },
  // Single strawberry hero, nothing else.
  hero(S) {
    return `<img src="${uri.strawberry}" style="position:absolute;width:${S * 0.74}px;top:${S * 0.13}px;left:${S * 0.13}px;filter:drop-shadow(0 ${S * 0.04}px ${S * 0.07}px rgba(40,5,20,.5))">`;
  },
  // Strawberry hero with cherries leaning in — middle ground.
  duo(S) {
    const sh = `filter:drop-shadow(0 ${S * 0.03}px ${S * 0.05}px rgba(40,5,20,.45))`;
    return `
      <img src="${uri.cherries}" style="position:absolute;width:${S * 0.52}px;top:${S * 0.08}px;right:${S * 0.06}px;transform:rotate(14deg);${sh}">
      <img src="${uri.strawberry}" style="position:absolute;width:${S * 0.64}px;bottom:${S * 0.05}px;left:${S * 0.08}px;transform:rotate(-8deg);${sh}">`;
  },
};

function tileHTML(S, design) {
  // 16px: always the lone strawberry — anything layered is mush that small.
  const art = (S <= 16 ? DESIGNS.hero : DESIGNS[design])(S);
  return `<!doctype html><meta charset="utf-8"><style>*{margin:0}</style>
    <div style="position:relative;width:${S}px;height:${S}px;overflow:hidden;
      border-radius:${Math.round(S * 0.22)}px;
      background:
        radial-gradient(circle at 28% 18%, rgba(255,255,255,.28), transparent 55%),
        linear-gradient(150deg, #d63d72 0%, #8e2150 55%, #5b1335 100%);
      box-shadow: inset 0 ${S * 0.015}px ${S * 0.03}px rgba(255,255,255,.25);">
      ${art}
    </div>`;
}

const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  const shoot = async (px, design, file) => {
    await page.setContent(tileHTML(px, design));
    await page.screenshot({
      path: file,
      clip: { x: 0, y: 0, width: px, height: px },
      omitBackground: true,
    });
  };

  for (const px of [128, 48, 32, 16]) {
    await shoot(px, DESIGN, path.join(OUT, `icon${px}.png`));
  }
  console.log(`wrote icons/icon{16,32,48,128}.png (design: ${DESIGN})`);

  if (process.env.PREVIEWS) {
    const prevDir = path.join(ROOT, "docs", "icon-previews");
    mkdirSync(prevDir, { recursive: true });
    for (const d of Object.keys(DESIGNS)) {
      await shoot(128, d, path.join(prevDir, `${d}.png`));
    }
    console.log("previews:", Object.keys(DESIGNS).join(", "), "->", prevDir);
  }
} finally {
  await browser.close();
}
