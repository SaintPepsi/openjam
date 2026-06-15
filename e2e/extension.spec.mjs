// End-to-end suite: loads the real unpacked extension, records the
// deterministic fixture, and verifies the full promise of the README — every
// capture source on the timeline, replay to the final state, self-contained
// offline export, reportable errors on restricted pages, single-report storage.
//
//   npm run build && npm run test:e2e
import { test, expect } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  launchExtension,
  serveFixture,
  openPopup,
  tabIdOf,
  sendAction,
  stopAndOpenViewer,
} from "../test/e2e/harness.mjs";

test.describe.configure({ mode: "serial" }); // one browser, recordings are global state

let context, extensionId, fixtureServer;

test.beforeAll(async () => {
  ({ context, extensionId } = await launchExtension());
  fixtureServer = await serveFixture();
});

test.afterAll(async () => {
  await context?.close();
  await fixtureServer?.close();
});

// Records the fixture with console + network + screenshot activity and
// resolves with the viewer page. Used by the first three tests.
async function recordSession({ injectStyle = false } = {}) {
  const fixture = await context.newPage();
  await fixture.goto(fixtureServer.url, { waitUntil: "load" });
  const popup = await openPopup(context, extensionId);
  const tabId = await tabIdOf(popup, fixtureServer.url);

  const started = await sendAction(popup, { action: "start", tabId });
  expect(started.ok).toBe(true);

  await fixture.bringToFront();
  // Inject the runtime CSS-in-JS rule first, so it precedes the increments and
  // is therefore applied once the replay reaches the final (counter=3) state.
  if (injectStyle) await fixture.locator("#injectStyle").click();
  await fixture.locator("#name").fill("Ada Lovelace");
  for (let i = 0; i < 3; i++) await fixture.locator("#inc").click();
  await fixture.locator("#fetchBtn").click();
  await expect(fixture.locator("#counter")).toHaveText("3");
  await fixture.waitForTimeout(1200); // rrweb mutation batches flush

  await sendAction(popup, { action: "screenshot" });
  const viewer = await stopAndOpenViewer(context, popup);
  await fixture.close();
  return { viewer, popup };
}

test("captures console, network and screenshots onto one timeline", async () => {
  const { viewer, popup } = await recordSession();

  // console: the fixture logs each increment
  await expect(viewer.locator(".row", { hasText: "counter is now 3" })).toBeVisible();
  // network: the fetch-self request, titled "<method> <url>" (background.js Network.requestWillBeSent)
  await expect(
    viewer.locator(".row", { hasText: "GET " + fixtureServer.url }).first(),
  ).toBeVisible();
  // screenshots: at least start-of-recording plus the manual one
  expect(await viewer.locator(".row", { hasText: "screenshot" }).count()).toBeGreaterThanOrEqual(2);

  // expanding a console row reveals the detail panel
  await viewer.locator(".row", { hasText: "counter is now 3" }).click();
  await expect(viewer.locator(".detail").first()).toBeVisible();
  await viewer.close();
  await popup.close();
});

test("session replay plays back to the fixture's final state", async () => {
  const { viewer, popup } = await recordSession();

  await viewer.locator("#replay .replayer-wrapper").waitFor();
  await viewer.locator(".oj-controls button", { hasText: "8x" }).click();
  await viewer.locator(".oj-controls button", { hasText: "Play" }).click();

  // The replay iframe rebuilds the fixture DOM; the counter must reach 3.
  const replayFrame = viewer.frameLocator("#replay .replayer-wrapper iframe");
  await expect(replayFrame.locator("#counter")).toHaveText("3", { timeout: 20000 });
  // rrweb masks password inputs by default — the typed name is replayed, the secret never is
  await expect(replayFrame.locator("#name")).toHaveValue("Ada Lovelace");
  await viewer.close();
  await popup.close();
});

test("replay preserves runtime CSS-in-JS styling (insertRule from the page)", async () => {
  // Regression guard: the recorder must run in the MAIN world to observe the
  // page's own CSSStyleSheet.insertRule calls. From the isolated world those
  // are invisible and the replayed element renders unstyled.
  const { viewer, popup } = await recordSession({ injectStyle: true });

  await viewer.locator("#replay .replayer-wrapper").waitFor();
  await viewer.locator(".oj-controls button", { hasText: "8x" }).click();
  await viewer.locator(".oj-controls button", { hasText: "Play" }).click();

  const replayFrame = viewer.frameLocator("#replay .replayer-wrapper iframe");
  // Reaching counter=3 means playback applied every earlier event, incl. the
  // insertRule that styles #cssinjs.
  await expect(replayFrame.locator("#counter")).toHaveText("3", { timeout: 20000 });
  const bg = await replayFrame
    .locator("#cssinjs")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(42, 161, 152)");

  await viewer.close();
  await popup.close();
});

test("exported HTML is self-contained and replays offline", async () => {
  const { viewer, popup } = await recordSession();

  const [download] = await Promise.all([
    viewer.waitForEvent("download"),
    viewer.locator("#download").click(),
  ]);
  const file = path.join(mkdtempSync(path.join(tmpdir(), "openjam-e2e-")), "export.html");
  await download.saveAs(file);

  // Open the export from disk with the fixture server down — fully offline.
  await fixtureServer.close();
  const offline = await context.newPage();
  // The replay iframe is populated via document.write, which can hold the
  // window load event open indefinitely — don't wait for it.
  await offline.goto("file://" + file, { waitUntil: "domcontentloaded" });
  await expect(offline.locator(".row", { hasText: "counter is now 3" })).toBeVisible();
  await offline.locator(".oj-controls button", { hasText: "8x" }).click();
  await offline.locator(".oj-controls button", { hasText: "Play" }).click();
  const frame = offline.frameLocator(".replayer-wrapper iframe");
  await expect(frame.locator("#counter")).toHaveText("3", { timeout: 20000 });

  await offline.close();
  await viewer.close();
  await popup.close();
  fixtureServer = await serveFixture(); // restore for later tests
});

test("restricted pages fail with a reportable error", async () => {
  const restricted = await context.newPage();
  await restricted.goto("chrome://version/");
  const popup = await openPopup(context, extensionId);
  const tabId = await tabIdOf(popup, "chrome://version/");

  const res = await sendAction(popup, { action: "start", tabId });
  expect(res.ok).toBe(false);
  expect(res.error).toContain("chrome://");

  // The popup's failure branch (popup.js toggle handler) renders the error
  // with a GitHub issue link and the PII warning.
  await popup.evaluate(async (error) => {
    const { renderErrorReport } = await import("./issue-link.js");
    renderErrorReport(document.getElementById("hint"), error, {
      version: chrome.runtime.getManifest().version,
      userAgent: navigator.userAgent,
    });
  }, res.error);
  await expect(popup.locator("#hint a")).toHaveAttribute(
    "href",
    /github\.com\/SaintPepsi\/openjam\/issues\/new/,
  );
  await expect(popup.locator(".pii-warning")).toContainText("remove any PII");
  await restricted.close();
  await popup.close();
});

test("storage keeps only the newest report", async () => {
  const { viewer: first, popup: p1 } = await recordSession();
  await first.close();
  await p1.close();
  const { viewer: second, popup } = await recordSession();
  await second.close();

  const reportKeys = await popup.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return Object.keys(all).filter((k) => k.startsWith("report-"));
  });
  expect(reportKeys).toHaveLength(1);
  await popup.close();
});
