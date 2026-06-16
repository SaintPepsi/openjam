// Single source of truth for OpenJam event kinds and their AI-facing legend.
// Intended to be imported by manifest.js (the legend) and background.js (the kind
// literals it emits) — wired up in later tasks.
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
  [KIND.NETWORK]:
    "detail: method,url,status,statusText,requestHeaders,requestBody,responseHeaders,responseBody,durationMs,encodedBytes,failed,errorText",
  [KIND.CONSOLE]: "detail: message,stack; level: log|info|warning|error|debug",
  [KIND.ERROR]: "detail: message,url,line,column,stack",
  [KIND.LOG]: "detail: message,url,source",
  [KIND.SCREENSHOT]: "title labels the moment; detail: image (a data URL) or error",
};
