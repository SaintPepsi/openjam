// Packaging-completeness guard.
//
// The release `package` script zips a HAND-MAINTAINED file list. Unit tests run
// against source files in the repo (which always has every module), so a file
// that's imported at runtime but missing from the zip ships a broken extension
// — exactly how v0.4.0 went out without event-kinds.js/manifest.js and failed
// service-worker registration ("unknown error fetching the script").
//
// This walks the real reference graph from the manifest + HTML entry points and
// asserts every reachable local file is covered by the package list. It fails
// the moment a new module is added without updating that list.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// --- what the release actually ships -------------------------------------
// Parse the `package` npm script's zip arguments (the source of truth for the
// shipped artifact). Entries are files or directories.
const packageScript = JSON.parse(read("package.json")).scripts.package;
const shipped = packageScript
  .slice(packageScript.indexOf("openjam.zip") + "openjam.zip".length)
  .trim()
  .split(/\s+/)
  .filter(Boolean);

const isCovered = (p) =>
  shipped.includes(p) || shipped.some((entry) => p === entry || p.startsWith(entry + "/"));

// --- walk the reference graph from every entry point ---------------------
const manifest = JSON.parse(read("manifest.json"));
const required = new Set();
const queue = [];
const seen = new Set();

const want = (p) => {
  const norm = normalize(p);
  required.add(norm);
  if (!seen.has(norm)) {
    seen.add(norm);
    queue.push(norm);
  }
};

// Manifest entry points.
want(manifest.background.service_worker);
for (const cs of manifest.content_scripts ?? []) for (const js of cs.js ?? []) want(js);
if (manifest.action?.default_popup) want(manifest.action.default_popup);
for (const icon of Object.values(manifest.icons ?? {})) want(icon);

const matchAll = (src, re) => [...src.matchAll(re)].map((m) => m[1]);
const stripQuery = (s) => s.replace(/[?#].*$/, "");

while (queue.length) {
  const file = queue.shift();
  // Build outputs (dist/, src/generated/) are self-contained bundles — require
  // them, but don't parse their minified contents for phantom specifiers.
  if (file.startsWith("dist/") || file.startsWith("src/generated/")) continue;

  let body;
  try {
    body = read(file);
  } catch {
    continue; // missing file is reported by the coverage assertion below
  }

  if (file.endsWith(".html")) {
    const refs = [
      ...matchAll(body, /<script[^>]+src=["']([^"']+)["']/g),
      ...matchAll(body, /<link[^>]+href=["']([^"']+)["']/g),
    ];
    for (const r of refs) if (!/^https?:|^data:/.test(r)) want(stripQuery(r));
    continue;
  }

  // JS: relative static + dynamic imports, and runtime-loaded extension pages.
  const imports = [
    ...matchAll(body, /import\s+[^"']*from\s*["']([^"']+)["']/g),
    ...matchAll(body, /import\(\s*["']([^"']+)["']\s*\)/g),
  ];
  for (const spec of imports) {
    if (spec.startsWith("./") || spec.startsWith("../")) want(join(dirname(file), spec));
  }
  for (const url of matchAll(body, /getURL\(\s*["']([^"']+)["']/g)) {
    if (!/^https?:/.test(url)) want(stripQuery(url));
  }
}

test("package script ships every file reachable from the manifest", () => {
  const missing = [...required].filter((p) => !isCovered(p)).sort();
  expect(missing).toEqual([]);
});

test("guard actually reaches the modules that broke v0.4.0", () => {
  // Sanity: prove the walk is wired up, not vacuously passing.
  expect(required.has("event-kinds.js")).toBe(true); // via background.js
  expect(required.has("manifest.js")).toBe(true); // via viewer.html → report-builder.js
});

test("manifest description fits the Chrome Web Store limit (132 chars)", () => {
  // CWS rejects the upload outright if description > 132 — caught only at submit
  // time otherwise (the v0.4.1 description was 146 and blocked the first listing).
  expect(manifest.description.length).toBeLessThanOrEqual(132);
});

// --- CWS permission justifications ----------------------------------------
// The dashboard's Privacy practices tab needs a justification for every
// permission, and there is no API to set them — they're pasted by hand from
// docs/STORE_LISTING.md. A release that adds a permission without a paste-ready
// justification stalls in review, so the doc must cover the manifest before a
// tag ships. A justification is a `**<name>**` header followed by a fenced
// block with actual content.
const listing = read("docs/STORE_LISTING.md");
const hasJustification = (name) => {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\*\\*${esc}[^\\n]*\\*\\*\\n\`\`\`\\n[^\`]*[^\\s\`]`).test(listing);
};

test("every manifest permission has a CWS justification in STORE_LISTING.md", () => {
  const missing = manifest.permissions.filter((p) => !hasJustification(p));
  if ((manifest.host_permissions ?? []).length && !hasJustification("host permissions")) {
    missing.push("host permissions");
  }
  expect(missing).toEqual([]);
});

test("justification guard rejects an uncovered or empty block (disconfirming)", () => {
  expect(hasJustification("notARealPermission")).toBe(false);
  // A bare header with an empty fence must not count as a justification.
  expect(new RegExp(`\\*\\*empty[^\\n]*\\*\\*\\n\`\`\`\\n[^\`]*[^\\s\`]`).test("**empty**\n```\n\n```")).toBe(false);
});
