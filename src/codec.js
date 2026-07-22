// Compress/decompress #openjam-data (gzip + base64), the event/network/console
// timeline embedded in a standalone export. Not the #openjam-ai manifest — that
// stays plain JSON on purpose (manifest.js: readable by an AI/human straight off
// the HTML source with no decode step).
//
// Bundled by build.mjs into two self-contained targets from this one source
// (single source of truth, docs/popup-redesign-fixes/05-component-source-of-truth.md
// precedent): src/generated/codec.js (ESM, bundles fflate — importable by
// report-builder.js/redact-report.mjs under Node AND directly by the browser via
// viewer.js, neither of which can resolve a bare "fflate" specifier) and
// dist/codec.js (IIFE, global `OJCodec` — read as a string into CODEC_IIFE and
// inlined into the exported HTML itself, so an offline standalone file can
// decode its own data with no import and no network).
import { gzipSync, gunzipSync, strToU8, strFromU8 } from "fflate";

// atob/btoa take/return a JS "binary string" (one UTF-16 code unit per byte).
// Chunked so a multi-MB Uint8Array never hits the string-args call-stack limit
// on String.fromCharCode(...bytes) (V8 caps spread/apply args around 65k-130k).
const CHUNK = 0x8000;

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeOjData(value) {
  return bytesToBase64(gzipSync(strToU8(JSON.stringify(value))));
}

export function decodeOjData(base64) {
  return JSON.parse(strFromU8(gunzipSync(base64ToBytes(base64))));
}
