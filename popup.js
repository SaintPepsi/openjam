// Popup controller: reflects recording state and drives start/stop/screenshot.

import { renderErrorReport } from "./issue-link.js";

const ENV = { version: chrome.runtime.getManifest().version, userAgent: navigator.userAgent };
const toggle = document.getElementById("toggle");
const shot = document.getElementById("shot");
const dot = document.getElementById("dot");
const stateLabel = document.getElementById("state");
const count = document.getElementById("count");
const hint = document.getElementById("hint");

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
setInterval(refresh, 1000);
