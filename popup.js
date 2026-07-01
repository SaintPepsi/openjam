// Popup controller: reflects recording state and drives start/stop/screenshot.

import { renderErrorReport } from "./issue-link.js";

const ENV = { version: chrome.runtime.getManifest().version, userAgent: navigator.userAgent };
const toggle = document.getElementById("toggle");
const shot = document.getElementById("shot");
const dot = document.getElementById("dot");
const stateLabel = document.getElementById("state");
const count = document.getElementById("count");
const hint = document.getElementById("hint");
const audioToggle = document.getElementById("audioToggle");
const micSelect = document.getElementById("micSelect");
const micError = document.getElementById("micError");

async function loadAudioSettings() {
  const { audioSettings } = await chrome.storage.local.get("audioSettings");
  const s = audioSettings || { enabled: false, deviceId: null };
  audioToggle.checked = s.enabled;
  if (s.enabled) await populateMics(s.deviceId);
  micSelect.hidden = !s.enabled;
}

async function populateMics(selectedId) {
  try {
    // A getUserMedia grant is required before device labels populate. It triggers
    // the extension-scoped prompt once; the grant persists and is reused by the
    // offscreen recorder (same chrome-extension:// origin). The popup never records.
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
    const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    micSelect.innerHTML = "";
    for (const m of mics) {
      const opt = document.createElement("option");
      opt.value = m.deviceId;
      opt.textContent = m.label || "Microphone";
      if (m.deviceId === selectedId) opt.selected = true;
      micSelect.appendChild(opt);
    }
    micError.hidden = true;
    return true;
  } catch (err) {
    micError.textContent = "Microphone unavailable: " + err.message;
    micError.hidden = false;
    return false;
  }
}

async function saveAudioSettings() {
  await chrome.storage.local.set({
    audioSettings: { enabled: audioToggle.checked, deviceId: audioToggle.checked ? micSelect.value || null : null },
  });
}

audioToggle.addEventListener("change", async () => {
  if (audioToggle.checked) {
    const ok = await populateMics(null);
    micSelect.hidden = !ok;
    if (!ok) audioToggle.checked = false;
  } else {
    micSelect.hidden = true;
  }
  await saveAudioSettings();
});
micSelect.addEventListener("change", saveAudioSettings);

function send(action, extra) {
  return chrome.runtime.sendMessage({ action, ...extra });
}

// Resolve the tab here, not in the service worker. A worker has no window of
// its own, so chrome.tabs.query({currentWindow}) there can return a tab from
// the wrong window (e.g. another extension's page) — the attach then fails with
// "Cannot access a chrome-extension:// URL of different extension". The popup is
// anchored to the window the user clicked from, so its query is reliable.
async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function paint(status) {
  const recording = !!status.recording;
  dot.classList.toggle("live", recording);
  stateLabel.textContent = recording ? "Recording" : "Idle";
  count.textContent = status.eventCount ? status.eventCount + " events" : "";
  toggle.textContent = recording ? "Stop & open report" : "Start recording";
  toggle.className = recording ? "stop" : "primary";
  shot.disabled = !recording;
}

async function refresh() {
  paint(await send("getStatus"));
}

toggle.addEventListener("click", async () => {
  const status = await send("getStatus");
  toggle.disabled = true;
  if (status.recording) {
    const res = await send("stop");
    if (!res.ok) renderErrorReport(hint, res.error, ENV);
    else window.close();
  } else {
    const res = await send("start", { tabId: await activeTabId() });
    if (!res.ok) renderErrorReport(hint, res.error, ENV);
    await refresh();
  }
  toggle.disabled = false;
});

shot.addEventListener("click", async () => {
  const res = await send("screenshot");
  if (res && res.eventCount != null) count.textContent = res.eventCount + " events";
});

refresh();
loadAudioSettings();
setInterval(refresh, 1000);
