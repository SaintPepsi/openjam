// Offscreen document: the ONLY place OpenJam can run getUserMedia + MediaRecorder
// (the MV3 service worker has no DOM). Records mic narration to a webm/opus blob,
// returns it to the worker as a base64 data URL (chrome messaging is JSON-only, so
// a Blob/ArrayBuffer would be lost). Created and closed by background.js per
// recording. Reuses the extension-scoped mic grant obtained in the popup.

const MIME = "audio/webm;codecs=opus";
let recorder = null;
let chunks = [];
let stream = null;
let startWall = null;

async function start(deviceId) {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
  });
  chunks = [];
  recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(MIME) ? { mimeType: MIME } : undefined);
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  startWall = Date.now();
  recorder.start();
}

function stop() {
  return new Promise((resolve) => {
    if (!recorder) return resolve(null);
    recorder.onstop = async () => {
      const durationMs = Date.now() - startWall;
      const blob = new Blob(chunks, { type: MIME });
      const dataUrl = await new Promise((res) => {
        const fr = new FileReader();
        fr.onloadend = () => res(fr.result);
        fr.readAsDataURL(blob);
      });
      if (stream) stream.getTracks().forEach((t) => t.stop());
      recorder = null; stream = null;
      resolve({ dataUrl, mime: MIME, startWall, durationMs });
    };
    recorder.stop();
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "oj-audio-start") {
    start(msg.deviceId || null).then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
  if (msg.type === "oj-audio-stop") {
    stop().then((r) => sendResponse(r)).catch(() => sendResponse(null));
    return true;
  }
});
