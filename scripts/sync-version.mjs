// npm's `version` lifecycle hook: copy the freshly bumped package.json version into
// manifest.json and the landing page (docs/index.html) so `npm version patch` bumps
// all three in one commit and tag. GitHub Pages serves main:/docs, so the site
// shows the new number as soon as the release commit lands on main.
// npm skips this hook when ~/.npmrc has ignore-scripts=true, so use `npm run bump -- patch`
// (forces --ignore-scripts=false). test/version-sync.test.js is the backstop.
//
// On the landing page only elements marked `data-version` are rewritten. Other
// version strings are release notes ("Now with voice narration · v0.6.0") and
// must keep the number they were written with.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

const sync = (file, pattern, replacement) => {
  const src = readFileSync(file, "utf8");
  if (!src.match(pattern)) throw new Error(`${file}: no version string matched ${pattern}`);
  writeFileSync(file, src.replace(pattern, replacement));
  console.log(`${file} version -> ${version}`);
};

sync("manifest.json", /"version": "[^"]+"/, `"version": "${version}"`);
sync("docs/index.html", /(data-version[^>]*>[^<]*?)v\d+\.\d+\.\d+/g, `$1v${version}`);
