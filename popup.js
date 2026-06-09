// Popup controller: reflects recording state and drives start/stop/screenshot.

const toggle = document.getElementById("toggle");
const shot = document.getElementById("shot");
const dot = document.getElementById("dot");
const stateLabel = document.getElementById("state");
const count = document.getElementById("count");
const hint = document.getElementById("hint");

function send(action, extra) {
  return chrome.runtime.sendMessage({ action, ...extra });
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
    if (!res.ok) hint.textContent = res.error;
    else window.close();
  } else {
    const res = await send("start");
    if (!res.ok) hint.textContent = res.error;
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
