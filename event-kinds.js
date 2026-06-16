// Single source of truth for OpenJam event kinds and their AI-facing legend.
// Imported by manifest.js (the legend) and background.js (the kind literals it emits).
// NOTE: renderer.js cannot import this — it is serialised via .toString() into the
// exported HTML, so its kind literals stay inline by necessity.

export const KIND = {
  NETWORK: "network",
  CONSOLE: "console",
  ERROR: "error",
  LOG: "log",
  SCREENSHOT: "screenshot",
};

export const KINDS = Object.values(KIND);

export const LEGEND = {
  network:
    "detail: method,url,status,statusText,requestHeaders,requestBody,responseHeaders,responseBody,durationMs,encodedBytes,failed,errorText",
  console: "detail: message,stack; level: log|info|warning|error|debug",
  error: "detail: message,url,line,column,stack",
  log: "detail: message,url,source",
  screenshot: "title labels the moment; detail: dataUrl or error",
};
