// Builds a single self-contained HTML document from a captured report.
// The exported file inlines the data, styles and the SAME renderer used for the
// live preview (embedded via Function.toString), so it renders offline anywhere.
// When replayAssets (the rrweb-player UMD + CSS strings from
// src/generated/player-assets.js, produced by build.mjs) are provided and the
// report carries rrweb events, a session-replay player is embedded too.
// Inline scripts are allowed here because the file opens as file:// (no CSP);
// the in-extension preview must use external scripts — see viewer.js.

import { renderReport, REPORT_CSS } from "./renderer.js";

const REPLAY_CSS = `
#replay-section{border-bottom:1px solid #2a2f3a;background:#171a21;padding:14px 22px}
#replay-section h2{margin:0 0 10px;font-size:13px;color:#8b93a3;text-transform:uppercase;letter-spacing:.05em}
#replay{display:flex;justify-content:center}
`;

function replayInit() {
  var report = JSON.parse(document.getElementById("openjam-data").textContent);
  var events = report.rrwebEvents || [];
  if (events.length < 2) return;
  var mount = document.getElementById("replay");
  var PlayerCtor = window.rrwebPlayer && (window.rrwebPlayer.default || window.rrwebPlayer);
  if (!PlayerCtor) return;
  var vw = (report.device && report.device.viewport) || {};
  var width = Math.min(mount.clientWidth || 1024, 1024);
  var height = vw.width && vw.height ? Math.round((width * vw.height) / vw.width) : Math.round((width * 9) / 16);
  new PlayerCtor({
    target: mount,
    props: { events: events, autoPlay: false, width: width, height: height },
  });
  document.getElementById("replay-section").hidden = false;
}

export function buildReportHTML(report, replayAssets) {
  const meta = report.meta || {};
  // Escape "<" so the embedded JSON can never break out of the <script> tag.
  const dataJson = JSON.stringify(report).replace(/</g, "\\u003c");
  const title = (meta.pageTitle || meta.pageUrl || "capture").replace(/[<>]/g, "");
  const hasReplay = !!(replayAssets && report.rrwebEvents && report.rrwebEvents.length > 1);
  // The UMD is executable JS, not JSON — neutralise any </script> inside it.
  const playerUmd = hasReplay ? replayAssets.PLAYER_UMD.replace(/<\/script/gi, "<\\/script") : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenJam Report — ${title}</title>
<style>${REPORT_CSS}</style>
${hasReplay ? `<style>${REPLAY_CSS}</style>\n<style>${replayAssets.PLAYER_CSS}</style>` : ""}
</head>
<body>
${hasReplay ? `<div id="replay-section" hidden><h2>Session replay</h2><div id="replay"></div></div>` : ""}
<div id="app"></div>
<script id="openjam-data" type="application/json">${dataJson}</script>
${hasReplay ? `<script>${playerUmd}</script>\n<script>\n${replayInit.toString()}\nreplayInit();\n</script>` : ""}
<script>
${renderReport.toString()}
renderReport(document.getElementById("app"), JSON.parse(document.getElementById("openjam-data").textContent));
</script>
</body>
</html>`;
}
