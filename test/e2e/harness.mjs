// Shared extension-driving helpers for the e2e specs (e2e/) and the
// screenshot generator (scripts/screenshots.mjs): launch Chromium with the
// unpacked extension, serve the deterministic fixture, and drive the
// background worker through a popup page opened as a tab.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

export const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

// Extensions need a persistent context, and `channel: "chromium"` selects
// the full browser whose new headless mode supports extensions — the default
// headless shell does not (https://playwright.dev/docs/chrome-extensions).
export async function launchExtension({ headful = !!process.env.HEADFUL } = {}) {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: !headful,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      // Give headless Chromium a synthetic microphone and auto-accept the
      // getUserMedia permission prompt, so the audio-capture e2e can grant and
      // record without a real device or a manual click.
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(sw.url()).host;
  // Pre-grant mic to the extension origin so the popup's permission check
  // (navigator.permissions.query) reports "granted" and enumerates inline,
  // instead of routing to the focused mic-permission page (not needed headless).
  try {
    await context.grantPermissions(["microphone"], { origin: `chrome-extension://${extensionId}` });
  } catch {
    // older channels may not support origin-scoped grants — fake-ui still covers capture
  }
  return { context, extensionId };
}

// Serves test/e2e/fixture.html over http — content scripts don't run on
// file:// without the user opting in. Returns { url, close }.
export async function serveFixture() {
  const html = readFileSync(path.join(ROOT, "test", "e2e", "fixture.html"));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    // server.close() alone waits for the browser's keep-alive sockets to
    // drain (i.e. forever) — sever them first.
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

// popup.html opened as a tab doubles as the control surface: it can
// chrome.runtime.sendMessage the background worker, and chrome.tabs.query
// resolves tab ids for the explicit-tab `start` message.
export async function openPopup(context, extensionId) {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 440 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator("#toggle").waitFor();
  return popup;
}

export function tabIdOf(popup, urlPrefix) {
  return popup.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: url + "*" });
    return tab.id;
  }, urlPrefix);
}

export function sendAction(popup, msg) {
  return popup.evaluate((m) => chrome.runtime.sendMessage(m), msg);
}

// Stops the recording and resolves with the viewer page the background opens.
export async function stopAndOpenViewer(context, popup) {
  const [viewer] = await Promise.all([
    context.waitForEvent("page"),
    sendAction(popup, { action: "stop" }),
  ]);
  await viewer.waitForURL(/viewer\.html/);
  await viewer.setViewportSize({ width: 1280, height: 800 });
  return viewer;
}
