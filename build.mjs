// OpenJam build:
// 1. Bundle the rrweb recorder into a classic content script (MV3 forbids
//    remote code, so rrweb ships inside the extension).
// 2. Bundle @rrweb/replay's Replayer into a classic script exposing
//    window.RRWebReplayer — rrweb-player@2.x ships broken dist artifacts (the
//    compiled component never constructs its Replayer; verified across
//    2.0.0/2.0.1 UMD+ESM builds), so OpenJam drives the replay engine directly
//    with its own controller UI (renderer.js mountReplay).
// 3. Emit the engine + its CSS as string constants for inlining into the
//    self-contained HTML export, and as extension files for the viewer page.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// --- single-source splicing ------------------------------------------------
// The popup component and the colour palette each have ONE authored home
// (openjam-popup.js, tokens.css). Every other place they appear is a generated
// region between markers, refreshed here so the copies can never drift
// (docs/popup-redesign-fixes/05-component-source-of-truth.md). A hand-edit
// inside a marked region is overwritten on the next build — that is the point.

// Replace the text between `start` and `end` (markers kept) with `body`.
function splice(text, start, end, body, where) {
  const s = text.indexOf(start);
  if (s === -1) throw new Error(`splice: missing marker ${start} in ${where}`);
  const e = text.indexOf(end, s + start.length);
  if (e === -1) throw new Error(`splice: missing marker ${end} after ${start} in ${where}`);
  return text.slice(0, s + start.length) + body + text.slice(e);
}

const TOK_START = "/* tokens:start */";
const TOK_END = "/* tokens:end */";

// The palette lines from tokens.css (declarations only, comments dropped).
const tokenLines = readFileSync("tokens.css", "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("--"));

// Two renderings of the same palette: raw CSS for the .css/.html/template-literal
// consumers, and quoted JS array elements for the component's string-array <style>.
const tokensCss = "\n  " + tokenLines.join("\n  ") + "\n  ";
const tokensJsArray = "\n    " + tokenLines.map((l) => JSON.stringify("  " + l) + ",").join("\n    ") + "\n    ";

// Fan the palette out to every consumer between its token markers.
for (const file of ["renderer.js", "viewer.html", "openjam-popup.js"]) {
  // openjam-popup.js builds its <style> as a JS string-array, so it takes the
  // array-element rendering; the others are raw CSS.
  const body = file === "openjam-popup.js" ? tokensJsArray : tokensCss;
  writeFileSync(file, splice(readFileSync(file, "utf8"), TOK_START, TOK_END, body, file));
}

// Splice the (now palette-refreshed) components into the landing page, and the
// palette into the landing :root. Each component is inlined as a <script>, so
// neutralise `</script` (the sequence that ends script data) before embedding —
// same escaping report-builder.js does when it inlines the component into an
// export (https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements).
const spliceScript = (html, src, start, end, label) =>
  splice(html, start, end, "\n<script>\n" + src.replace(/<\/script/gi, "<\\/script") + "\n</script>\n", label);
// waveform.js is also emitted raw as WAVEFORM_JS below, so read it once here.
const waveformSrc = readFileSync("waveform.js", "utf8");
let landing = readFileSync("docs/index.html", "utf8");
landing = splice(landing, TOK_START, TOK_END, tokensCss, "docs/index.html (:root)");
landing = spliceScript(landing, readFileSync("openjam-popup.js", "utf8"), "<!-- openjam-popup:start -->", "<!-- openjam-popup:end -->", "docs/index.html (component)");
landing = spliceScript(landing, readFileSync("install-cta.js", "utf8"), "<!-- install-cta:start -->", "<!-- install-cta:end -->", "docs/index.html (install-cta)");
landing = spliceScript(landing, waveformSrc, "<!-- oj-waveform:start -->", "<!-- oj-waveform:end -->", "docs/index.html (oj-waveform)");
// Inline the narrated-repro clip as a base64 data URL so the easter egg's
// shape-decode fetch works off disk too (file:// blocks fetch of a sibling
// file). Keeps the page self-contained (docs/CLAUDE.md) — no network egress.
const shiftAudioDataUrl = "data:audio/mpeg;base64," + readFileSync("docs/ah-shit-here-we-go-again.mp3").toString("base64");
landing = splice(landing, "/* shift-audio:start */", "/* shift-audio:end */",
  "\n    var SHIFT_AUDIO_SRC = " + JSON.stringify(shiftAudioDataUrl) + ";\n    ", "docs/index.html (shift-audio)");
writeFileSync("docs/index.html", landing);
console.log("spliced palette into 4 consumers + component + install-cta + oj-waveform + inlined shift-audio into docs/index.html");

await build({
  entryPoints: ["src/rrweb-recorder.js"],
  bundle: true,
  format: "iife",
  minify: true,
  outfile: "dist/rrweb-recorder.js",
  logLevel: "info",
});

// Isolated-world bridge that forwards the MAIN-world recorder's batches to the
// background worker (the recorder has no chrome.* APIs in the main world).
await build({
  entryPoints: ["src/rrweb-relay.js"],
  bundle: true,
  format: "iife",
  minify: true,
  outfile: "dist/rrweb-relay.js",
  logLevel: "info",
});

await build({
  stdin: {
    contents: 'import { Replayer } from "@rrweb/replay";\nwindow.RRWebReplayer = Replayer;\n',
    resolveDir: process.cwd(),
    sourcefile: "replay-engine-entry.js",
  },
  bundle: true,
  format: "iife",
  minify: true,
  outfile: "dist/rrweb-replay.js",
  logLevel: "info",
});

const engine = readFileSync("dist/rrweb-replay.js", "utf8");
const engineCss = readFileSync("node_modules/@rrweb/replay/dist/style.min.css", "utf8");

// Both get inlined into an HTML <script>/<style>. The export neutralises
// </script>, but <!-- or <script would shift the HTML parser into a state that
// swallows the closing tag (https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements).
if (/<\/script|<script|<!--/i.test(engine)) {
  throw new Error("replay engine bundle contains HTML-breaking sequences (<script, </script or <!--); review export inlining before shipping");
}

// src/codec.js (gzip+base64 for #openjam-data) bundled twice from one source:
// ESM for report-builder.js/redact-report.mjs (Node AND the unbundled browser
// import chain — viewer.js -> report-builder.js — neither can resolve a bare
// "fflate" specifier), and an IIFE global for inlining into the standalone
// export itself (same reason the replay engine is inlined as IIFE above).
await build({
  entryPoints: ["src/codec.js"],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "src/generated/codec.js",
  logLevel: "info",
});

await build({
  entryPoints: ["src/codec.js"],
  bundle: true,
  format: "iife",
  globalName: "OJCodec",
  minify: true,
  outfile: "dist/codec.js",
  logLevel: "info",
});

const codecIife = readFileSync("dist/codec.js", "utf8");
if (/<\/script|<script|<!--/i.test(codecIife)) {
  throw new Error("codec bundle contains HTML-breaking sequences (<script, </script or <!--); review export inlining before shipping");
}

writeFileSync("dist/rrweb-replay.css", engineCss);
mkdirSync("src/generated", { recursive: true });
writeFileSync(
  "src/generated/player-assets.js",
  "// Generated by build.mjs — do not edit. Engine: @rrweb/replay@2.0.1.\n" +
    "export const ENGINE_IIFE = " + JSON.stringify(engine) + ";\n" +
    "export const ENGINE_CSS = " + JSON.stringify(engineCss) + ";\n" +
    "export const WAVEFORM_JS = " + JSON.stringify(waveformSrc) + ";\n" +
    "export const CODEC_IIFE = " + JSON.stringify(codecIife) + ";\n",
);
console.log("wrote src/generated/player-assets.js, dist/rrweb-replay.{js,css}, dist/codec.js");
