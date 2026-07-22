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
import { WAVEFORM_JS, CODEC_IIFE } from "./src/generated/player-assets.js";
import { encodeOjData } from "./src/generated/codec.js";

// A report's rrwebEvents may be a JSON string (new — stored stringified to clear
// Chrome's Mojo ~100-depth cap) or a plain array (old reports, synthetic test
// reports). Normalize to an array ONCE up front so the embedded #openjam-data
// JSON always carries a plain array (standalone replay depends on it) and
// everything downstream (mountReplay, the .length checks) is unchanged.
function asEventArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try {
    return JSON.parse(v);
  } catch {
    return [];
  }
}

export function buildReportHTML(report, replayAssets) {
  report = { ...report, rrwebEvents: asEventArray(report.rrwebEvents) };
  const meta = report.meta || {};
  // #openjam-data is gzip+base64'd (issue #44: a report with 44 inlined images
  // was 87.6 MB — the DOM/mutation/network JSON itself is a secondary but real
  // contributor, and this shrinks it independent of the image fix). Base64's
  // alphabet (A-Za-z0-9+/=) can never contain "<", so — unlike the old raw-JSON
  // path — there is no </script> breakout to neutralise here; the codec bundle
  // (CODEC_IIFE, inlined below) decodes it back to the report object at view
  // time. The #openjam-ai manifest stays plain, uncompressed JSON on purpose:
  // it's designed for an AI/human to read straight off the HTML source with no
  // decode step (manifest.js), so compressing it would defeat its own point.
  const dataB64 = encodeOjData(report);
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
  // Inlined JS is executable, not JSON — neutralise any </script> before embedding.
  const forInlineScript = (js) => js.replace(/<\/script/gi, "<\\/script");
  const engineJs = hasReplay ? forInlineScript(replayAssets.ENGINE_IIFE) : "";
  // The <oj-waveform> element definition, inlined so the replay player can create
  // one (mountReplay draws the narration waveform). Registered before that script
  // runs. The standalone narration player uses a plain <audio> and never touches
  // <oj-waveform>, so it's only needed when there's a replay.
  const inlineWaveform = hasReplay && hasAudio;
  const waveformJs = inlineWaveform ? forInlineScript(WAVEFORM_JS) : "";

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
<script id="openjam-data" type="application/gzip;base64">${dataB64}</script>
<script>${forInlineScript(CODEC_IIFE)}</script>
<script>
${renderReport.toString()}
renderReport(document.getElementById("app"), OJCodec.decodeOjData(document.getElementById("openjam-data").textContent));
</script>
${inlineWaveform ? `<script>${waveformJs}</script>` : ""}
${
  hasReplay
    ? `<script>${engineJs}</script>
<script>
${mountReplay.toString()}
try {
  var ojReport = OJCodec.decodeOjData(document.getElementById("openjam-data").textContent);
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
try { mountAudio(document.getElementById("audio"), OJCodec.decodeOjData(document.getElementById("openjam-data").textContent)); }
catch (err) { var s = document.getElementById("audio-section"); if (s) s.hidden = true; console.error("audio mount failed", err); }
</script>` : ""}
</body>
</html>`;
}
