// eval/build-reports.mjs
// Writes the two variants the A/B eval compares:
//   eval/out/with-manifest.html    — current export (includes #openjam-ai)
//   eval/out/without-manifest.html — identical report, #openjam-ai stripped (baseline)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildReportHTML } from "../report-builder.js";
import { fixtureReport } from "./fixture-report.mjs";

const outDir = path.join(import.meta.dirname, "out");
mkdirSync(outDir, { recursive: true });

const withManifest = buildReportHTML(fixtureReport(), null);
const withoutManifest = withManifest.replace(/<script id="openjam-ai"[\s\S]*?<\/script>\n?/, "");
if (withoutManifest === withManifest) throw new Error("failed to strip #openjam-ai — check the block markup");

writeFileSync(path.join(outDir, "with-manifest.html"), withManifest);
writeFileSync(path.join(outDir, "without-manifest.html"), withoutManifest);
console.log("wrote eval/out/with-manifest.html and without-manifest.html");
