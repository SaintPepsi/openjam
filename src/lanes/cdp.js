// CDP capture lane: the chrome.debugger side of recording. Everything here was
// background.js until the inject lane (src/lanes/inject.js) needed the same
// seams — attach/start/stop/screenshot/deviceInfo — behind one interface so the
// worker can pick a lane at start (session.lane) and stop caring which.
import { KIND } from "../../event-kinds.js";
import { BODY_CAPTURE_MAX_BYTES, classifyBody } from "../capture-limits.js";
import { collectDeviceInfo } from "../device-info.js";

const PROTOCOL_VERSION = "1.3";

export function createCdpLane({ session, pushEvent, maybeErrorScreenshot }) {
  function sendCmd(method, params = {}) {
    return chrome.debugger.sendCommand({ tabId: session.tabId }, method, params);
  }

  function monotonicToWall(timestampSeconds) {
    if (session.monoOffset === null) return Date.now();
    return timestampSeconds * 1000 + session.monoOffset;
  }

  // ---- argument / preview formatting ---------------------------------------

  function previewToString(preview) {
    const props = (preview.properties || []).map((p) =>
      preview.subtype === "array" ? p.value : p.name + ": " + p.value,
    );
    const body = props.join(", ") + (preview.overflow ? ", …" : "");
    if (preview.subtype === "array") return "[" + body + "]";
    const label = preview.description && preview.description !== "Object" ? preview.description + " " : "";
    return label + "{" + body + "}";
  }

  function formatRemoteObject(obj) {
    if (!obj) return "";
    switch (obj.type) {
      case "string":
        return obj.value;
      case "number":
      case "boolean":
        return String(obj.value);
      case "undefined":
        return "undefined";
      case "function":
        return obj.description || "function";
      case "object":
        if (obj.subtype === "null") return "null";
        if (obj.preview) return previewToString(obj.preview);
        return obj.description || "[object]";
      default:
        return obj.description != null ? obj.description : String(obj.value);
    }
  }

  function formatStackTrace(stackTrace) {
    if (!stackTrace || !stackTrace.callFrames) return [];
    return stackTrace.callFrames.map((f) => {
      const where = (f.url || "<anonymous>") + ":" + (f.lineNumber + 1) + ":" + (f.columnNumber + 1);
      const name = f.functionName || "(anonymous)";
      return name + " — " + where;
    });
  }

  // ---- capture helpers ------------------------------------------------------

  async function captureDeviceInfo() {
    try {
      const expression = "(" + collectDeviceInfo.toString() + ")()";
      const result = await sendCmd("Runtime.evaluate", { expression, returnByValue: true });
      // A page-side throw (fingerprint blockers replacing navigator getters)
      // resolves, not rejects — surface it as the error it is.
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "device info threw in page");
      if (!result.result || typeof result.result.value !== "object") throw new Error("device info returned no object");
      session.device = result.result.value;
    } catch (err) {
      session.device = { error: String(err) };
    }
  }

  async function captureScreenshot(label) {
    try {
      const result = await sendCmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      pushEvent({
        t: Date.now(),
        kind: KIND.SCREENSHOT,
        title: label,
        detail: { image: "data:image/png;base64," + result.data },
      });
    } catch (err) {
      pushEvent({ t: Date.now(), kind: KIND.SCREENSHOT, title: label + " (failed)", detail: { error: String(err) } });
    }
  }

  async function fetchResponseBody(requestId, event, response) {
    const headers = response.headers || {};
    const lengthHeader = Number(headers["content-length"] || headers["Content-Length"] || 0);
    if (!classifyBody(response.mimeType, lengthHeader)) return;
    try {
      const body = await sendCmd("Network.getResponseBody", { requestId });
      if (body.base64Encoded) {
        event.detail.responseBody = "[binary " + (body.body ? body.body.length : 0) + " base64 chars — not decoded]";
      } else if (body.body && body.body.length <= BODY_CAPTURE_MAX_BYTES) {
        event.detail.responseBody = body.body;
      }
    } catch {
      // body may already be evicted from the network cache — ignore.
    }
  }

  // ---- CDP event routing ----------------------------------------------------

  function onDebuggerEvent(source, method, params) {
    if (!session.recording || source.tabId !== session.tabId) return;

    switch (method) {
      case "Network.requestWillBeSent": {
        if (session.monoOffset === null && params.wallTime != null) {
          session.monoOffset = params.wallTime * 1000 - params.timestamp * 1000;
        }
        const t = params.wallTime != null ? params.wallTime * 1000 : monotonicToWall(params.timestamp);
        const req = params.request;
        const event = pushEvent({
          t,
          kind: KIND.NETWORK,
          title: req.method + " " + req.url,
          detail: {
            requestId: params.requestId,
            method: req.method,
            url: req.url,
            resourceType: params.type,
            requestHeaders: req.headers || {},
            requestBody: req.postData || null,
            monoStart: params.timestamp,
            status: null,
            statusText: null,
            mimeType: null,
            responseHeaders: null,
            durationMs: null,
            encodedBytes: null,
            failed: false,
          },
        });
        session.requestEvents.set(params.requestId, event);
        break;
      }
      case "Network.responseReceived": {
        const event = session.requestEvents.get(params.requestId);
        if (!event) break;
        const r = params.response;
        event.detail.status = r.status;
        event.detail.statusText = r.statusText;
        event.detail.mimeType = r.mimeType;
        event.detail.responseHeaders = r.headers || {};
        event.detail.remoteAddress = r.remoteIPAddress ? r.remoteIPAddress + ":" + r.remotePort : null;
        event.detail.fromCache = !!r.fromDiskCache;
        break;
      }
      case "Network.loadingFinished": {
        const event = session.requestEvents.get(params.requestId);
        if (!event) break;
        event.detail.encodedBytes = params.encodedDataLength;
        if (event.detail.monoStart != null) {
          event.detail.durationMs = Math.round((params.timestamp - event.detail.monoStart) * 1000);
        }
        const r = { headers: event.detail.responseHeaders, mimeType: event.detail.mimeType };
        fetchResponseBody(params.requestId, event, r);
        break;
      }
      case "Network.loadingFailed": {
        const event = session.requestEvents.get(params.requestId);
        if (!event) break;
        event.detail.failed = true;
        event.detail.errorText = params.errorText;
        event.detail.canceled = !!params.canceled;
        event.title = "FAILED " + event.detail.url;
        break;
      }
      case "Runtime.consoleAPICalled": {
        const text = (params.args || []).map(formatRemoteObject).join(" ");
        pushEvent({
          t: params.timestamp || Date.now(),
          kind: KIND.CONSOLE,
          level: params.type, // log, info, warning, error, debug
          title: text,
          detail: { message: text, stack: formatStackTrace(params.stackTrace) },
        });
        if (params.type === "error") maybeErrorScreenshot();
        break;
      }
      case "Runtime.exceptionThrown": {
        const d = params.exceptionDetails || {};
        const text = (d.exception && d.exception.description) || d.text || "Uncaught exception";
        pushEvent({
          t: params.timestamp || Date.now(),
          kind: KIND.ERROR,
          level: "error",
          title: text.split("\n")[0],
          detail: {
            message: text,
            url: d.url,
            line: d.lineNumber != null ? d.lineNumber + 1 : null,
            column: d.columnNumber != null ? d.columnNumber + 1 : null,
            stack: formatStackTrace(d.stackTrace),
          },
        });
        maybeErrorScreenshot();
        break;
      }
      case "Log.entryAdded": {
        const e = params.entry;
        if (e.source === "network" || e.level === "verbose") break; // network errors already captured
        pushEvent({
          t: e.timestamp || Date.now(),
          kind: KIND.LOG,
          level: e.level,
          title: e.text,
          detail: { message: e.text, url: e.url, source: e.source },
        });
        break;
      }
      default:
        break;
    }
  }

  return {
    name: "cdp",
    attach: (tabId) => chrome.debugger.attach({ tabId }, PROTOCOL_VERSION),
    async start() {
      await sendCmd("Network.enable", {});
      await sendCmd("Runtime.enable", {});
      await sendCmd("Log.enable", {});
      await sendCmd("Page.enable", {});
    },
    async stop(tabId) {
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
        // already detached — fine.
      }
    },
    // The debugger follows navigations by itself and sees every frame; nothing
    // page-side to (re)arm, no page-side batches to accept.
    pageHello: () => false,
    handleBatch: () => false,
    screenshot: captureScreenshot,
    deviceInfo: captureDeviceInfo,
    onDebuggerEvent,
  };
}
