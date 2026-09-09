// `npm version` bumps package.json and the `version` script copies it into
// manifest.json (scripts/sync-manifest-version.mjs). Nothing else keeps them equal,
// so a hand edit of either would ship a store upload with the wrong number.
// Disconfirming input: change one of the two version fields and this goes red.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => JSON.parse(readFileSync(join(import.meta.dir, "..", p), "utf8"));

test("manifest.json and package.json carry the same version", () => {
  expect(read("manifest.json").version).toBe(read("package.json").version);
});
