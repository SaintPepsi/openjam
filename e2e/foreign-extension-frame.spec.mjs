// Issue #48: "Could not attach debugger: Error: Cannot access a chrome-extension://
// URL of different extension" on an ordinary https page.
//
// chrome.debugger.attach checks EVERY frame in the tab, not just the top-level
// URL (chromium: chrome/browser/extensions/api/debugger/debugger_api.cc,
// ExtensionMayAttachToRenderFrameHost). One <iframe> from another extension —
// a password-manager inline menu, a grammar checker, a shopping assistant —
// makes the whole tab unattachable, while chrome.tabs.get still reports a
// normal https URL. OpenJam now records anyway on the inject lane (page probe +
// captureVisibleTab), marks the report meta.capture="inject", and names the
// blocking extension.
//
// Disconfirming inputs: remove the foreign iframe before starting → capture is
// "cdp" and the warning assertions fail; comment out the probe arming in
// src/lanes/inject.js start() → the console/network/error assertions fail;
// move lane.quiesce() after the 400 ms wait in background.js stopRecording →
// the console assertion fails (its batch arrives after recording=false).
import { test, expect } from "@playwright/test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { launchExtension, serveFixture, openPopup, tabIdOf, sendAction, stopAndOpenViewer, ROOT } from "../test/e2e/harness.mjs";

test.describe.configure({ mode: "serial" });

const FIXTURE_ID = readFileSync(path.join(ROOT, "test", "e2e", "foreign-extension", "ID"), "utf8").trim();

let context, extensionId, fixtureServer;

test.beforeAll(async () => {
  ({ context, extensionId } = await launchExtension({
    extraExtensions: [path.join(ROOT, "test", "e2e", "foreign-extension")],
  }));
  fixtureServer = await serveFixture();
});

test.afterAll(async () => {
  await context?.close();
  await fixtureServer?.close();
});

async function openFixtureWithForeignFrame() {
  const page = await context.newPage();
  await page.goto(fixtureServer.url, { waitUntil: "load" });
  // The fixture extension's content script has injected its frame and it has
  // committed a chrome-extension:// URL that is not ours.
  await expect(page.frameLocator("#foreign-ext-frame").locator("body")).toHaveText("foreign extension frame");
  const foreignId = await page.locator("#foreign-ext-frame").evaluate((f) => new URL(f.src).host);
  expect(foreignId).not.toBe(extensionId);
  // The fixture manifest pins a `key`, so its id is the same on every machine and
  // the popup/viewer pixel baselines below stay deterministic.
  expect(foreignId).toBe(FIXTURE_ID);
  return { page, foreignId };
}

const latestReport = (popup) =>
  popup.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return all[all.lastReportKey];
  });

test("another extension's iframe: recording runs on the inject lane and names the culprit (#48)", async () => {
  const { page, foreignId } = await openFixtureWithForeignFrame();
  const popup = await openPopup(context, extensionId);
  const tabId = await tabIdOf(popup, fixtureServer.url);

  // captureVisibleTab needs the recorded tab in front.
  await page.bringToFront();
  const started = await sendAction(popup, { action: "start", tabId });
  expect(started.ok).toBe(true);
  expect(started.blockedBy).toEqual([foreignId]);
  expect(started.warning).toContain("reduced mode: extension " + foreignId);
  expect((await sendAction(popup, { action: "getStatus" })).capture).toBe("inject");

  // The probe is injected into the recorded tab only, never by manifest: a
  // second tab opened during the recording has an untouched console/fetch.
  // Disconfirming: put dist/page-probe.js back in manifest.json content_scripts.
  const bystander = await context.newPage();
  await bystander.goto(fixtureServer.url, { waitUntil: "load" });
  expect(await bystander.evaluate(() => window.__ojProbeLoaded === undefined)).toBe(true);
  await bystander.close();
  await page.bringToFront();

  // Drive the fixture's real handlers: console.log, then a reload mid-recording
  // (the new document gets a fresh probe via the relay's hello), then console,
  // fetch(self) and an uncaught throw in the reloaded document. No settle wait:
  // stop must flush the probe's buffer itself.
  // Disconfirming: drop the injectProbe call from the oj-rrweb-hello handler →
  // only one "counter is now 1" console event survives.
  await page.locator("#inc").click();
  await page.reload({ waitUntil: "load" });
  await expect(page.frameLocator("#foreign-ext-frame").locator("body")).toHaveText("foreign extension frame");
  await page.locator("#inc").click();
  await page.locator("#fetchBtn").click();
  await page.locator("#errBtn").click();

  const viewer = await stopAndOpenViewer(context, popup);
  const report = await latestReport(popup);
  expect(report.meta.capture).toBe("inject");
  expect(report.device.userAgent).toContain("Chrome");
  const byKind = (k) => report.events.filter((e) => e.kind === k);
  expect(byKind("log")[0].detail.blockedBy).toEqual([foreignId]);
  expect(byKind("console").filter((e) => e.title === "counter is now 1")).toHaveLength(2); // before + after reload
  const fetched = byKind("network").find((e) => e.detail.url === fixtureServer.url);
  expect(fetched.detail).toMatchObject({ method: "GET", status: 200, resourceType: "fetch" });
  expect(fetched.detail.responseBody).toContain("OpenJam E2E Fixture");
  expect(byKind("error").some((e) => e.title.includes("fixture test error"))).toBe(true);
  const shots = byKind("screenshot").filter((e) => e.detail.image);
  expect(shots.length).toBeGreaterThanOrEqual(2); // started + stopped (+ on error)
  expect(shots[0].detail.image.startsWith("data:image/png;base64,")).toBe(true);
  expect(shots[0].detail.image.length).toBeGreaterThan(1000);

  // The viewer says so where the reader looks first. Pixel baseline of the header
  // so the reduced-mode badge is something a reporter can be shown.
  await expect(viewer.locator(".meta")).toContainText("reduced (no debugger)");
  await expect(viewer.locator(".meta")).toHaveScreenshot("viewer-reduced-mode-meta.png");

  await viewer.close();
  await popup.close();
  await page.close();
});

test("popup shows the gold reduced-mode notice with a Manage extension button", async () => {
  const { page, foreignId } = await openFixtureWithForeignFrame();
  const popup = await openPopup(context, extensionId);
  // Drive the REAL toggle: popup.js resolves the active tab (the fixture, kept in
  // front) and starts; the background answers with the warning + blockedBy.
  await page.bringToFront();
  await popup.locator("openjam-popup [data-act=toggle]").dispatchEvent("click");
  const warn = popup.locator("openjam-popup .warn");
  await expect(warn).toContainText("reduced mode: extension " + foreignId);
  await expect(warn.locator("button.act")).toHaveCount(1);
  await expect(popup.locator("openjam-popup .err")).toBeHidden();
  await expect(popup.locator("openjam-popup .st-lbl")).toHaveText("REC");
  // Visual baseline of the reduced-mode popup: the gold notice naming the fixture
  // extension plus its Manage button. This PNG is what we show a reporter.
  await expect(popup.locator("openjam-popup .card")).toHaveScreenshot("popup-reduced-mode.png");
  // The popup re-renders every second while recording. The Manage button must
  // be the same element across renders: a keyboard user who tabbed onto it
  // keeps focus, and it still opens chrome://extensions for the named extension.
  // Disconfirming: rebuild the warning buttons unconditionally in _render →
  // focus is lost within a second.
  const manage = warn.locator("button.act");
  await manage.focus();
  await popup.waitForTimeout(1500);
  expect(await popup.evaluate(() => document.querySelector("openjam-popup").shadowRoot.activeElement?.className)).toBe("act");
  const manageTab = context.waitForEvent("page");
  await manage.click();
  const opened = await manageTab;
  expect(opened.url()).toBe("chrome://extensions/?id=" + foreignId);
  await opened.close();
  await sendAction(popup, { action: "stop" });
  await popup.close();
  await page.close();
});

test("same page without the foreign frame records on the cdp lane, no warning", async () => {
  const { page } = await openFixtureWithForeignFrame();
  await page.evaluate(() => document.getElementById("foreign-ext-frame").remove());
  const popup = await openPopup(context, extensionId);
  const tabId = await tabIdOf(popup, fixtureServer.url);
  const started = await sendAction(popup, { action: "start", tabId });
  expect(started).toEqual({ ok: true });
  expect((await sendAction(popup, { action: "getStatus" })).capture).toBe("cdp");
  await sendAction(popup, { action: "stop" });
  await popup.close();
  await page.close();
});
