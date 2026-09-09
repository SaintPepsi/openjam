// npm's `version` lifecycle hook: copy the freshly bumped package.json version into
// manifest.json and the landing page (docs/index.html) so `npm version patch` bumps
// all three in one commit and tag. GitHub Pages serves main:/docs, so the site
// shows the new number as soon as the release commit lands on main.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

const sync = (file, pattern, replacement) => {
  const src = readFileSync(file, "utf8");
  if (!src.match(pattern)) throw new Error(`${file}: no version string matched ${pattern}`);
  writeFileSync(file, src.replace(pattern, replacement));
  console.log(`${file} version -> ${version}`);
};

sync("manifest.json", /"version": "[^"]+"/, `"version": "${version}"`);
sync("docs/index.html", /\bv\d+\.\d+\.\d+\b/g, `v${version}`);
