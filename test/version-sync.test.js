// `npm version` bumps package.json and the `version` script (scripts/sync-version.mjs)
// copies it into manifest.json and the landing page. Nothing else keeps them equal,
// so a hand edit would ship a store upload with the wrong number, or leave GitHub
// Pages (served from main:/docs) advertising a stale release.
// Disconfirming input: change any one synced version string and this goes red.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(import.meta.dir, "..", p), "utf8");
const { version } = JSON.parse(read("package.json"));
const landing = read("docs/index.html");

test("manifest.json and package.json carry the same version", () => {
  expect(JSON.parse(read("manifest.json")).version).toBe(version);
});

test("every data-version element on the landing page matches package.json", () => {
  const found = [...landing.matchAll(/data-version[^>]*>[^<]*?(v\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  expect(found.length).toBeGreaterThan(0);
  expect(new Set(found)).toEqual(new Set([`v${version}`]));
});

// Release notes on the page keep the version they were written with. Voice
// narration shipped in 0.6.0; if the sync ever goes back to a global replace,
// this pins the regression.
test("release-note version strings are left alone by the sync", () => {
  expect(landing).toContain("Now with voice narration <span>· v0.6.0</span>");
});
