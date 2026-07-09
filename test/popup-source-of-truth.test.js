// Single-source-of-truth guard for the popup component + design tokens.
//
// docs/index.html must NOT carry a hand-pasted copy of openjam-popup.js or a
// hand-maintained palette: both are spliced in by build.mjs between markers, so
// the shipped popup and the marketing demo can never drift (the inert demo-stop
// bug shipped byte-identical in both copies precisely because they were two
// hand-edited copies — see docs/popup-redesign-fixes/05-component-source-of-truth.md).
//
// The load-bearing test is "build owns the region": mutate the spliced block,
// rebuild, and the mutation must be gone. That is the acceptance criterion's
// disconfirming input, automated.
import { test, expect, beforeAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const p = (rel) => join(ROOT, rel);
const read = (rel) => readFileSync(p(rel), "utf8");
const build = () => execFileSync("node", ["build.mjs"], { cwd: ROOT, stdio: "pipe" });

const POPUP_START = "<!-- openjam-popup:start -->";
const POPUP_END = "<!-- openjam-popup:end -->";

beforeAll(() => build());

test("docs/index.html splices the component between markers, one copy only", () => {
  const html = read("docs/index.html");
  expect(html).toContain(POPUP_START);
  expect(html).toContain(POPUP_END);
  // Exactly one class definition in the page (the spliced one), and one in source.
  expect(html.match(/class OpenJamPopup\b/g)?.length ?? 0).toBe(1);
  expect(read("openjam-popup.js").match(/class OpenJamPopup\b/g)?.length ?? 0).toBe(1);
});

test("dead pre-component landing code is gone", () => {
  const html = read("docs/index.html");
  for (const dead of ["heroWave", "heroWords", "tiltCard", ".prow", ".microw"]) {
    expect(html.includes(dead)).toBe(false);
  }
});

test("the palette has one authored home (tokens.css); consumers derive it", () => {
  const HEX = "#6ea8fe"; // representative: --accent
  // tokens.css is the single authored source.
  expect(read("tokens.css")).toContain(HEX);
  // No consumer authors the hex outside its spliced token region.
  const TOK_START = "/* tokens:start */";
  const TOK_END = "/* tokens:end */";
  const stripSplice = (s) =>
    s.replace(new RegExp(`${escapeRe(TOK_START)}[\\s\\S]*?${escapeRe(TOK_END)}`, "g"), "");
  for (const rel of ["openjam-popup.js", "renderer.js", "viewer.html", "docs/index.html"]) {
    expect(stripSplice(read(rel)).includes(HEX)).toBe(false);
  }
});

test("build owns the spliced region: a hand-edit is overwritten on rebuild", () => {
  const rel = "docs/index.html";
  const before = read(rel);
  const at = before.indexOf(POPUP_START);
  expect(at).toBeGreaterThan(-1); // markers must exist for the splice to own anything
  const injected =
    before.slice(0, at + POPUP_START.length) +
    "\n/* HAND EDIT THAT MUST NOT SURVIVE */" +
    before.slice(at + POPUP_START.length);
  try {
    writeFileSync(p(rel), injected);
    build();
    const after = read(rel);
    expect(after.includes("HAND EDIT THAT MUST NOT SURVIVE")).toBe(false);
    expect(after).toBe(before);
  } finally {
    writeFileSync(p(rel), before); // restore regardless of assertion outcome
    build();
  }
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
