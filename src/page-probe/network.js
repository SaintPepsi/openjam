// MAIN-world fetch/XHR probe. Emits two records per request — net-start at
// send, net-end at completion — with the same detail keys the CDP lane's
// Network.* handling produces (src/lanes/cdp.js), so the background merges
// them into one timeline event and the viewer needs no lane-specific code.
// Transparent to the page: same return values, same rejections, bodies read
// from a clone so the caller's stream is untouched.
import { BODY_CAPTURE_MAX_BYTES, classifyBody } from "../capture-limits.js";

let seq = 0;

export function headersToObject(headers) {
  const out = {};
  if (!headers) return out;
  try {
    if (typeof headers.forEach === "function" && !Array.isArray(headers)) {
      headers.forEach((v, k) => (out[k] = v));
    } else if (Array.isArray(headers)) {
      for (const [k, v] of headers) out[k] = v;
    } else {
      for (const k of Object.keys(headers)) out[k] = headers[k];
    }
  } catch {
    // exotic header object — leave what we have
  }
  return out;
}

export function parseRawHeaders(raw) {
  const out = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

function absolute(url) {
  try {
    return new URL(url, typeof location !== "undefined" ? location.href : undefined).href;
  } catch {
    return String(url);
  }
}

const mimeOf = (contentType) => String(contentType || "").split(";")[0].trim();

// isArmed gates the only expensive step — reading a cloned body — so a page
// that is not being recorded pays one function call per fetch, nothing more.
export function installNetworkProbe({ emit, isArmed = () => true, now = () => Date.now(), clock = () => performance.now() }, g = globalThis) {
  const origFetch = g.fetch;
  if (typeof origFetch === "function") {
    g.fetch = function (input, init) {
      const requestId = "f" + ++seq;
      const t0 = clock();
      try {
        const req = typeof Request !== "undefined" && input instanceof Request ? input : null;
        const url = req ? req.url : absolute(input && input.href ? input.href : input);
        const method = String((init && init.method) || (req && req.method) || "GET").toUpperCase();
        emit({
          kind: "net-start",
          requestId,
          t: now(),
          method,
          url,
          resourceType: "fetch",
          requestHeaders: headersToObject((init && init.headers) || (req && req.headers)),
          requestBody: init && typeof init.body === "string" ? init.body : null,
        });
      } catch {
        // never let bookkeeping break the page's fetch
      }
      const p = origFetch.apply(this, arguments);
      p.then(
        (res) => {
          const end = {
            kind: "net-end",
            requestId,
            t: now(),
            status: res.status,
            statusText: res.statusText,
            mimeType: mimeOf(res.headers.get("content-type")),
            responseHeaders: headersToObject(res.headers),
            durationMs: Math.round(clock() - t0),
            encodedBytes: Number(res.headers.get("content-length")) || null,
            failed: false,
          };
          if (!isArmed() || !classifyBody(end.mimeType, end.encodedBytes)) return emit(end);
          res
            .clone()
            .text()
            .then(
              (text) => {
                if (text.length <= BODY_CAPTURE_MAX_BYTES) end.responseBody = text;
                if (!end.encodedBytes) end.encodedBytes = text.length;
                emit(end);
              },
              () => emit(end),
            );
        },
        (err) => emit({ kind: "net-end", requestId, t: now(), durationMs: Math.round(clock() - t0), failed: true, errorText: String(err) }),
      ).catch(() => {
        // bookkeeping threw (exotic Response from another wrapper) — never
        // surface that to the page as an unhandled rejection
      });
      return p;
    };
  }

  const XHR = g.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const { open, send, setRequestHeader } = XHR.prototype;
    XHR.prototype.open = function (method, url) {
      this.__oj = { method: String(method).toUpperCase(), url: absolute(url), headers: {} };
      return open.apply(this, arguments);
    };
    XHR.prototype.setRequestHeader = function (k, v) {
      if (this.__oj) this.__oj.headers[k] = v;
      return setRequestHeader.apply(this, arguments);
    };
    XHR.prototype.send = function (body) {
      const meta = this.__oj;
      if (meta) {
        const requestId = "x" + ++seq;
        const t0 = clock();
        let aborted = false;
        this.addEventListener("abort", () => (aborted = true));
        emit({
          kind: "net-start",
          requestId,
          t: now(),
          method: meta.method,
          url: meta.url,
          resourceType: "xhr",
          requestHeaders: meta.headers,
          requestBody: typeof body === "string" ? body : null,
        });
        this.addEventListener("loadend", () => {
          const failed = this.status === 0;
          const mimeType = mimeOf(this.getResponseHeader && this.getResponseHeader("content-type"));
          const end = {
            kind: "net-end",
            requestId,
            t: now(),
            status: failed ? null : this.status,
            statusText: this.statusText || null,
            mimeType,
            responseHeaders: parseRawHeaders(this.getAllResponseHeaders && this.getAllResponseHeaders()),
            durationMs: Math.round(clock() - t0),
            encodedBytes: null,
            failed,
            canceled: aborted,
            errorText: failed ? (aborted ? "aborted" : "network error") : undefined,
          };
          const textual = this.responseType === "" || this.responseType === "text";
          if (!failed && textual && classifyBody(mimeType, 0)) {
            const text = String(this.responseText || "");
            if (text.length <= BODY_CAPTURE_MAX_BYTES) end.responseBody = text;
            end.encodedBytes = text.length;
          }
          emit(end);
        });
      }
      return send.apply(this, arguments);
    };
  }
}
