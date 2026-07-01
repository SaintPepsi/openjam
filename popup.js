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
  if (s.enabled) await populateMics(s.deviceId); // manages picker visibility itself
  else micSelect.hidden = true;
}

async function micGranted() {
  // A getUserMedia prompt can't survive in the toolbar popup (it loses focus and
  // auto-dismisses). So the popup never calls getUserMedia — it only reads the
  // permission state. The grant is obtained on the focused mic-permission page.
  try {
    const s = await navigator.permissions.query({ name: "microphone" });
    return s.state === "granted";
  } catch {
    return false;
  }
}

async function populateMics(selectedId) {
  if (!(await micGranted())) {
    // Not granted yet: open the focused permission page (the popup can't prompt).
    chrome.tabs.create({ url: chrome.runtime.getURL("mic-permission.html") });
    micError.textContent = "Opening a tab to grant microphone access — click Allow there, then reopen this popup.";
    micError.hidden = false;
    micSelect.hidden = true;
    return false;
  }
  // Granted: labels are available without any prompt.
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
  micSelect.hidden = false;
  return true;
}

async function saveAudioSettings() {
  await chrome.storage.local.set({
    audioSettings: { enabled: audioToggle.checked, deviceId: audioToggle.checked ? micSelect.value || null : null },
  });
}

audioToggle.addEventListener("change", async () => {
  if (audioToggle.checked) {
    // Keep the setting enabled even while the grant is pending — recording will
    // use the default mic until a specific one is picked.
    await populateMics(null);
  } else {
    micSelect.hidden = true;
    micError.hidden = true;
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
