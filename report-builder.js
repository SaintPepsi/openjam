// Builds a single self-contained HTML document from a captured report.
// The exported file inlines the data, styles and the SAME renderer used for the
// live preview (embedded via Function.toString), so it renders offline anywhere.
// Inline scripts are allowed here because the file opens as file:// (no CSP);
// the in-extension preview must use external scripts — see viewer.js.

import { renderReport, REPORT_CSS } from "./renderer.js";

export function buildReportHTML(report) {
  const meta = report.meta || {};
  // Escape "<" so the embedded JSON can never break out of the <script> tag.
  // JSON.parse reads < straight back to "<", so no un-escaping is needed.
  const dataJson = JSON.stringify(report).replace(/</g, "\\u003c");
  const renderSource = renderReport.toString();
  const title = (meta.pageTitle || meta.pageUrl || "capture").replace(/[<>]/g, "");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenJam Report — ${title}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div id="app"></div>
<script id="openjam-data" type="application/json">${dataJson}</script>
<script>
${renderSource}
renderReport(document.getElementById("app"), JSON.parse(document.getElementById("openjam-data").textContent));
</script>
</body>
</html>`;
}
