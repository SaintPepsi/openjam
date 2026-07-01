// Builds a single self-contained HTML document from a captured report.
// The exported file inlines the data, styles and the SAME renderer + replay
// mount used by the in-extension viewer (embedded via Function.toString), so
// it renders offline anywhere. replayAssets (the rrweb-player UMD + CSS
// strings from src/generated/player-assets.js, produced by build.mjs) enable
// the session-replay player when the report carries rrweb events.
// Inline scripts are allowed here because the file opens as file:// (no CSP);
// the in-extension viewer must use external scripts — see viewer.js.

import { renderReport, mountReplay, mountAudio, REPORT_CSS, REPLAY_CSS } from "./renderer.js";
import { buildManifest } from "./manifest.js";

export function buildReportHTML(report, replayAssets) {
  const meta = report.meta || {};
  // Escape "<" so the embedded JSON can never break out of the <script> tag.
  const dataJson = JSON.stringify(report).replace(/</g, "\\u003c");
  let manifestJson = "{}";
  try {
    manifestJson = JSON.stringify(buildManifest(report)).replace(/</g, "\\u003c");
  } catch (err) {
    manifestJson = JSON.stringify({ _doc: "manifest unavailable", error: String(err) }).replace(/</g, "\\u003c");
  }
  const title = (meta.pageTitle || meta.pageUrl || "capture").replace(/[<>]/g, "");
  const hasReplay = !!(replayAssets && report.rrwebEvents && report.rrwebEvents.length > 1);
  const hasAudio = !!(report.audio && report.audio.dataUrl);
  // The engine is executable JS, not JSON — neutralise any </script> inside it.
  const engineJs = hasReplay ? replayAssets.ENGINE_IIFE.replace(/<\/script/gi, "<\\/script") : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenJam Report — ${title}</title>
<style>${REPORT_CSS}</style>
${hasReplay ? `<style>${REPLAY_CSS}</style>\n<style>${replayAssets.ENGINE_CSS}</style>` : ""}
</head>
<body>
${hasReplay ? `<div id="replay-section"><h2>Session replay</h2><div id="replay"></div></div>` : ""}
${hasAudio ? `<div id="audio-section"><h2>Narration</h2><div id="audio"></div></div>` : ""}
<div id="app"></div>
<script id="openjam-ai" type="application/json">${manifestJson}</script>
<script id="openjam-data" type="application/json">${dataJson}</script>
${
  hasReplay
    ? `<script>${engineJs}</script>
<script>
${mountReplay.toString()}
try {
  var ojReport = JSON.parse(document.getElementById("openjam-data").textContent);
  mountReplay(document.getElementById("replay"), ojReport, window.RRWebReplayer);
} catch (err) {
  document.getElementById("replay-section").hidden = true;
  console.error("replay mount failed", err);
}
</script>`
    : ""
}
<script>
${renderReport.toString()}
renderReport(document.getElementById("app"), JSON.parse(document.getElementById("openjam-data").textContent));
</script>
${hasAudio ? `<script>
${mountAudio.toString()}
try { mountAudio(document.getElementById("audio"), JSON.parse(document.getElementById("openjam-data").textContent)); }
catch (err) { var s = document.getElementById("audio-section"); if (s) s.hidden = true; console.error("audio mount failed", err); }
</script>` : ""}
</body>
</html>`;
}
