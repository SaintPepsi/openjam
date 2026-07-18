// pf-07 Task 4 — Visual AC proof for the standalone-audio "Narration" heading.
//
// The storage-quota-degraded report drops rrweb events but keeps audio, so it
// renders `<div id="audio-section"><h2>Narration</h2>` with NO replay. Before
// pf-07, the `#audio-section h2` style lived in REPLAY_CSS (injected only when
// there is a replay), so this heading shipped unstyled. The fix moves the rule
// into the always-injected REPORT_CSS. This spec proves, by computed style +
// a real PNG (no human eyeballing), that the heading now renders in the
// design-system section treatment.
//
//   npx playwright test e2e/audio-section-style.spec.mjs
//
// No extension needed — this is a standalone report render via the default
// @playwright/test `page` fixture.
import { test, expect } from "@playwright/test";
import { buildReportHTML } from "../report-builder.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, statSync } from "node:fs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Ready-made standalone-audio shape: audio present, no rrweb, replayAssets=null
// → hasReplay false → hasStandaloneAudio true.
function audioOnlyHTML() {
  return buildReportHTML(
    {
      meta: {},
      events: [],
      rrwebEvents: [],
      audio: {
        dataUrl: "data:audio/webm;base64,AA",
        mime: "audio/webm;codecs=opus",
        startWall: 1,
        durationMs: 10,
      },
    },
    null,
  );
}

test("standalone-audio Narration heading renders in the section style", async ({ page }) => {
  const html = audioOnlyHTML();
  await page.setContent(html, { waitUntil: "load" });

  // mountAudio only sets an <audio src>; the fake data URL must not throw and
  // hide the section (report-builder.js:77 sets .hidden on mount throw).
  const section = page.locator("#audio-section");
  await expect(section).toBeVisible();

  const h2 = page.locator("#audio-section h2");
  await expect(h2).toBeVisible();
  await expect(h2).toHaveText("Narration");

  // SECTION treatment 1: uppercase label.
  await expect(h2).toHaveCSS("text-transform", "uppercase");

  // SECTION treatment 2: font-family resolves to the --mono stack. Derive the
  // expected from the resolved CSS var (no brittle hardcoded string).
  const { fontFamily, expectedMono } = await page.evaluate(() => {
    const el = document.querySelector("#audio-section h2");
    const rootMono = getComputedStyle(document.documentElement)
      .getPropertyValue("--mono")
      .trim();
    return {
      fontFamily: getComputedStyle(el).fontFamily,
      expectedMono: rootMono,
    };
  });
  // Normalise quoting/spacing differences between the raw var and the computed
  // font-family before comparing.
  const norm = (s) => s.replace(/['"]/g, "").replace(/\s*,\s*/g, ",").trim();
  expect(norm(fontFamily)).toBe(norm(expectedMono));

  // SECTION treatment 3: the accent ::before dot. content is '' (empty), so we
  // prove the dot by its rendered box + non-transparent background, NOT content.
  const before = await page.evaluate(() => {
    const el = document.querySelector("#audio-section h2");
    const cs = getComputedStyle(el, "::before");
    return {
      width: cs.width,
      height: cs.height,
      backgroundColor: cs.backgroundColor,
      content: cs.content,
    };
  });
  expect(parseFloat(before.width)).toBeGreaterThan(0);
  expect(parseFloat(before.height)).toBeGreaterThan(0);
  // A rendered accent dot is opaque — reject transparent / zero-alpha.
  expect(before.backgroundColor).not.toBe("transparent");
  expect(before.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

  // Real artifact: a PNG of the rendered #audio-section. test-results/ is
  // gitignored (no committed local recordings).
  const outDir = join(REPO_ROOT, "test-results");
  mkdirSync(outDir, { recursive: true });
  const pngPath = join(outDir, "audio-section-narration.png");
  await section.screenshot({ path: pngPath });

  const size = statSync(pngPath).size;
  expect(size).toBeGreaterThan(0);
  console.log(`[pf-07] wrote #audio-section screenshot: ${pngPath} (${size} bytes)`);
});

test("disconfirming: removing #audio-section h2 rule un-styles the heading", async ({ page }) => {
  // Self-contained teeth check: strip the `#audio-section h2{...}` declaration
  // from the built HTML's <style> and confirm the uppercase treatment vanishes.
  // This proves the passing test isn't vacuously green on some inherited style.
  const html = audioOnlyHTML();

  // The rule is a combined selector: `#replay-section h2,#audio-section h2{...}`.
  // Remove the whole declaration block so #audio-section h2 has no section rule.
  const mutated = html.replace(
    /#replay-section h2,#audio-section h2\{[^}]*\}/,
    "",
  );
  // Guard: the replacement actually changed something (the rule was present).
  expect(mutated).not.toBe(html);
  expect(mutated).not.toContain("#audio-section h2{");

  await page.setContent(mutated, { waitUntil: "load" });

  const h2 = page.locator("#audio-section h2");
  await expect(h2).toBeVisible();
  await expect(h2).toHaveText("Narration");

  // Without the rule, a default <h2> is NOT uppercase — it falls back to `none`.
  await expect(h2).not.toHaveCSS("text-transform", "uppercase");
  await expect(h2).toHaveCSS("text-transform", "none");
});
