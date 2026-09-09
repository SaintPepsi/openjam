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

// Content scripts, one bundle each: the MAIN-world rrweb recorder, the
// MAIN-world page probe (console/error/fetch/XHR for the inject lane, #48), and
// the isolated-world relay that carries both to the background worker (MAIN
// world has no chrome.* APIs).
for (const name of ["rrweb-recorder", "page-probe", "rrweb-relay"]) {
  await build({
    entryPoints: ["src/" + name + ".js"],
    bundle: true,
    format: "iife",
    minify: true,
    outfile: "dist/" + name + ".js",
    logLevel: "info",
  });
}

// Bundle-time patch of one condition in rrweb-snapshot's rebuild (inlined into
// @rrweb/replay). Two deliberate changes in one string:
//  1. Upstream bug (#43): for an <img> with both srcset and rr_dataURL, the "back up
//     the srcset" branch matches EVERY attribute name, so alt/class/style/id are
//     swallowed and the image replays unstyled at natural size. Fix: `name === "srcset"`.
//     Still on rrweb master (rebuild.ts, "backup original img srcset"). Delete this
//     half once @rrweb/replay ships the fix; the match guard below will say so.
//  2. OpenJam divergence, keep even after 1 is upstreamed: `src` also goes to the
//     backup branch, so an http URL or a data: placeholder never lands on the replay
//     element and rrweb's rr_dataURL branch (which records rrweb-original-src) stays
//     in charge. Guarded by the currentSrc assertion in the #43 e2e.
const RRWEB_SRCSET_BUG = 'tagName === "img" && n2.attributes.srcset && n2.attributes.rr_dataURL';
const RRWEB_SRCSET_FIX = 'tagName === "img" && (name === "srcset" || name === "src") && n2.attributes.srcset && n2.attributes.rr_dataURL';
// Fail loud on an rrweb bump: exactly one match in the file, and the hook must run
// at all (an entry move, e.g. to replay.mjs, would otherwise skip onLoad silently).
let rrwebSrcsetPatched = false;
const patchRrwebSrcsetRebuild = {
  name: "patch-rrweb-srcset-rebuild",
  setup(b) {
    b.onLoad({ filter: /@rrweb[/\\]replay[/\\]dist[/\\]replay\.js$/ }, (args) => {
      const parts = readFileSync(args.path, "utf8").split(RRWEB_SRCSET_BUG);
      if (parts.length !== 2) throw new Error(`rrweb srcset rebuild patch: expected 1 match, found ${parts.length - 1} in ${args.path}`);
      rrwebSrcsetPatched = true;
      return { contents: parts.join(RRWEB_SRCSET_FIX), loader: "js" };
    });
  },
};

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
  plugins: [patchRrwebSrcsetRebuild],
});
if (!rrwebSrcsetPatched) throw new Error("rrweb srcset rebuild patch never ran (did @rrweb/replay's entry move?)");

const engine = readFileSync("dist/rrweb-replay.js", "utf8");
const engineCss = readFileSync("node_modules/@rrweb/replay/dist/style.min.css", "utf8");

// Both get inlined into an HTML <script>/<style>. The export neutralises
// </script>, but <!-- or <script would shift the HTML parser into a state that
// swallows the closing tag (https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements).
if (/<\/script|<script|<!--/i.test(engine)) {
  throw new Error("replay engine bundle contains HTML-breaking sequences (<script, </script or <!--); review export inlining before shipping");
}

writeFileSync("dist/rrweb-replay.css", engineCss);
mkdirSync("src/generated", { recursive: true });
writeFileSync(
  "src/generated/player-assets.js",
  "// Generated by build.mjs — do not edit. Engine: @rrweb/replay@2.0.1.\n" +
    "export const ENGINE_IIFE = " + JSON.stringify(engine) + ";\n" +
    "export const ENGINE_CSS = " + JSON.stringify(engineCss) + ";\n" +
    "export const WAVEFORM_JS = " + JSON.stringify(waveformSrc) + ";\n",
);
console.log("wrote src/generated/player-assets.js, dist/rrweb-replay.{js,css}");
