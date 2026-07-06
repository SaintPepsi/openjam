// Builds a single self-contained HTML document from a captured report.
// The exported file inlines the data, styles and the SAME renderer + replay
// mount used by the in-extension viewer (embedded via Function.toString), so
// it renders offline anywhere. replayAssets (the rrweb-player UMD + CSS
// strings from src/generated/player-assets.js, produced by build.mjs) enable
// the session-replay player when the report carries rrweb events.
//
// PRIVACY: OpenJam itself must make no outbound connections — no telemetry, no
// phone-home. The CSP meta (below) enforces that: connect-src 'none' blocks
// fetch/XHR/beacon/WebSocket, and scripts are inline-only (no external or eval),
// so nothing OpenJam ships can exfiltrate. The session replay, however, is a
// faithful reproduction of the captured page, so it IS allowed to load that
// page's own passive assets — images/fonts/stylesheets (img/font/style-src *).
// OpenJam's own shell only ever references data: assets, so it stays inert; only
// the rrweb replay reaches the network, and only for GETs of page subresources.

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
  // When there's a replay, the replayer drives the narration (one player) — no
  // separate audio UI. The standalone player is only for reports without a replay.
  const hasStandaloneAudio = hasAudio && !hasReplay;
  // The engine is executable JS, not JSON — neutralise any </script> inside it.
  const engineJs = hasReplay ? replayAssets.ENGINE_IIFE.replace(/<\/script/gi, "<\\/script") : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' data: *; img-src * data: blob:; media-src * data: blob:; font-src * data:; frame-src 'self' data: blob:; connect-src 'none'; base-uri 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenJam Report — ${title}</title>
<style>${REPORT_CSS}</style>
${hasReplay ? `<style>${REPLAY_CSS}</style>\n<style>${replayAssets.ENGINE_CSS}</style>` : ""}
</head>
<body>
${hasReplay ? `<div id="replay-section"><h2>Session replay</h2><div id="replay"></div></div>` : ""}
${hasStandaloneAudio ? `<div id="audio-section"><h2>Narration</h2><div id="audio"></div></div>` : ""}
<div id="app"></div>
<script id="openjam-ai" type="application/json">${manifestJson}</script>
<script id="openjam-data" type="application/json">${dataJson}</script>
<script>
${renderReport.toString()}
renderReport(document.getElementById("app"), JSON.parse(document.getElementById("openjam-data").textContent));
</script>
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
${hasStandaloneAudio ? `<script>
${mountAudio.toString()}
try { mountAudio(document.getElementById("audio"), JSON.parse(document.getElementById("openjam-data").textContent)); }
catch (err) { var s = document.getElementById("audio-section"); if (s) s.hidden = true; console.error("audio mount failed", err); }
</script>` : ""}
</body>
</html>`;
}
