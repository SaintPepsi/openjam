// Dedicated permission page. A getUserMedia prompt cannot survive in the toolbar
// popup (the popup loses focus and the prompt auto-dismisses — "Permission
// dismissed"). This page is a focused, persistent surface where the prompt shows
// properly. Once granted, the permission persists for the whole extension origin,
// so the popup can enumerate devices without a prompt and the offscreen recorder
// reuses the same-origin grant.
const msg = document.getElementById("msg");

(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop()); // this page never records
    // Cache labelled devices so the popup can show the picker immediately.
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === "audioinput")
      .map((d) => ({ deviceId: d.deviceId, label: d.label }));
    await chrome.storage.local.set({ audioDevices: devices });
    msg.className = "ok";
    msg.textContent = "Microphone enabled. You can close this tab and reopen OpenJam.";
    setTimeout(() => window.close(), 1500);
  } catch (err) {
    msg.className = "err";
    msg.textContent =
      "Microphone access failed: " + err.message +
      ". Open this extension's site settings (chrome://settings/content/microphone) to allow it, then try again.";
  }
})();
