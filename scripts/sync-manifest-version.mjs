// npm's `version` lifecycle hook: copy the freshly bumped package.json version into
// manifest.json so `npm version patch` bumps both files in one commit and tag.
// npm skips this hook when ~/.npmrc has ignore-scripts=true, so use `npm run bump -- patch`
// (forces --ignore-scripts=false). test/version-sync.test.js is the backstop.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const manifestSrc = readFileSync("manifest.json", "utf8");
const next = manifestSrc.replace(/"version": "[^"]+"/, `"version": "${version}"`);
if (next === manifestSrc) throw new Error("manifest.json version field not found");
writeFileSync("manifest.json", next);
console.log(`manifest.json version -> ${version}`);
