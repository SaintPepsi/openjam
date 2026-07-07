// Popup controller — drives <openjam-popup> from the background capture engine.
// Same messages the previous popup used (getStatus / start / stop) + the same
// mic-permission flow; only the DOM wiring changed to the component's API/events.

import { renderErrorReport } from "./issue-link.js";

const ENV = { version: chrome.runtime.getManifest().version, userAgent: navigator.userAgent };
const oj = document.getElementById("oj");
const send = (action, extra) => chrome.runtime.sendMessage({ action, ...extra });

// The popup is anchored to the window the user clicked from, so this query is reliable.
async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// renderErrorReport writes markup (with the "Report on GitHub" link) into an element;
// capture that HTML and hand it to the component's notice slot.
function errorHtml(error) {
  const tmp = document.createElement("div");
  renderErrorReport(tmp, error, ENV);
  return tmp.innerHTML;
}

/* ---------------- record / stop ---------------- */
oj.addEventListener("oj-toggle", async () => {
  oj.clearNotices();
  const status = await send("getStatus");
  if (status.recording) {
    const res = await send("stop");
    if (!res.ok) oj.showError(errorHtml(res.error));
    else { window.close(); return; }        // report opens in a new tab, popup closes
  } else {
    const res = await send("start", { tabId: await activeTabId() });
    if (!res.ok) oj.showError(errorHtml(res.error));
  }
  await refresh();
});

async function refresh() {
  const s = await send("getStatus");
  oj.setStatus({ recording: !!s.recording, eventCount: s.eventCount || 0 });
}

/* ---------------- mic narration (audio) ---------------- */
// A getUserMedia prompt can't survive in the toolbar popup, so we only read the
// permission state here and defer the grant to the focused mic-permission page.
async function micGranted() {
  try { return (await navigator.permissions.query({ name: "microphone" })).state === "granted"; }
  catch { return false; }
}

async function listMics(selectedId) {
  const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  oj.setMics(mics.map((m) => ({ id: m.deviceId, label: m.label || "Microphone" })), selectedId);
}

async function saveAudio(patch) {
  const { audioSettings } = await chrome.storage.local.get("audioSettings");
  const next = { enabled: false, deviceId: null, ...(audioSettings || {}), ...patch };
  if (!next.enabled) next.deviceId = null;
  await chrome.storage.local.set({ audioSettings: next });
}

oj.addEventListener("oj-mic-toggle", async (e) => {
  const enabled = e.detail.enabled;
  await saveAudio({ enabled });
  if (!enabled) return;
  if (!(await micGranted())) {
    // Popup can't prompt — open the focused permission tab, like the old popup did.
    chrome.tabs.create({ url: chrome.runtime.getURL("mic-permission.html") });
    oj.showError("Opening a tab to grant microphone access — click Allow there, then reopen this popup.");
    return;
  }
  await listMics(null);
});

oj.addEventListener("oj-mic-change", (e) => saveAudio({ deviceId: e.detail.deviceId }));

async function loadAudio() {
  const { audioSettings } = await chrome.storage.local.get("audioSettings");
  const s = audioSettings || { enabled: false, deviceId: null };
  oj.micEnabled = s.enabled;                       // reflects into the component's toggle
  if (s.enabled && (await micGranted())) await listMics(s.deviceId);
}

/* ---------------- boot + poll ---------------- */
refresh();
loadAudio();
setInterval(refresh, 1000);

// OPTIONAL — live mic-level meter while recording:
// the meter only shows when recording with audio on. Feed it a 0..1 level from
// wherever the mic stream lives (offscreen/background), e.g. via a runtime message:
//   chrome.runtime.onMessage.addListener((m) => { if (m.action === "micLevel") oj.setMicLevel(m.rms); });
// If you don't feed it, the meter simply stays flat.
