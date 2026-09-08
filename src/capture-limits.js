// Shared capture limits for both lanes (src/lanes/cdp.js, src/lanes/inject.js).
export const BODY_CAPTURE_MAX_BYTES = 100 * 1024; // skip large/binary response bodies

const TEXTY = /json|text|javascript|xml|html|csv|x-www-form-urlencoded/i;

// Whether a response body is worth keeping: texty mime and (when known) small
// enough. `length` is the declared or measured byte count, 0/null when unknown.
export function classifyBody(mimeType, length) {
  if (!TEXTY.test(mimeType || "")) return false;
  if (/event-stream/i.test(mimeType)) return false; // never-ending: reading it would buffer forever
  if (length && length > BODY_CAPTURE_MAX_BYTES) return false;
  return true;
}
