// `npm version` bumps package.json and the `version` script (scripts/sync-version.mjs)
// copies it into manifest.json and the landing page. Nothing else keeps them equal,
// so a hand edit would ship a store upload with the wrong number, or leave GitHub
// Pages (served from main:/docs) advertising a stale release.
// Disconfirming input: change any one version string and this goes red.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(import.meta.dir, "..", p), "utf8");
const { version } = JSON.parse(read("package.json"));

test("manifest.json and package.json carry the same version", () => {
  expect(JSON.parse(read("manifest.json")).version).toBe(version);
});

test("every version string on the landing page matches package.json", () => {
  const found = read("docs/index.html").match(/\bv\d+\.\d+\.\d+\b/g);
  expect(found.length).toBeGreaterThan(0);
  expect(new Set(found)).toEqual(new Set([`v${version}`]));
});
