// Issue #48: "Could not attach debugger: Error: Cannot access a chrome-extension://
// URL of different extension" on an ordinary https page.
//
// chrome.debugger.attach checks EVERY frame in the tab, not just the top-level
// URL (chromium: chrome/browser/extensions/api/debugger/debugger_api.cc,
// ExtensionMayAttachToRenderFrameHost). One <iframe> from another extension —
// a password-manager inline menu, a grammar checker, a shopping assistant —
// makes the whole tab unattachable for us, while chrome.tabs.get still reports
// a normal https URL, so recordableTabError() waves it through.
//
// Disconfirming inputs: remove the foreign iframe before starting → the first
// `start` succeeds and the `toBe(false)` assertion fails; drop attachError() from
// background.js → the raw "Cannot access a chrome-extension://" error leaks.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { launchExtension, serveFixture, openPopup, tabIdOf, sendAction, ROOT } from "../test/e2e/harness.mjs";

test.describe.configure({ mode: "serial" });

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

test("another extension's iframe on a normal page blocks the debugger attach (#48)", async () => {
  const page = await context.newPage();
  await page.goto(fixtureServer.url, { waitUntil: "load" });
  // The fixture extension's content script has injected its frame and it has
  // committed a chrome-extension:// URL that is not ours.
  const frame = page.frameLocator("#foreign-ext-frame");
  await expect(frame.locator("body")).toHaveText("foreign extension frame");
  const frameOrigin = await page.locator("#foreign-ext-frame").evaluate((f) => new URL(f.src).origin);
  expect(frameOrigin).toMatch(/^chrome-extension:\/\//);
  expect(frameOrigin).not.toBe(`chrome-extension://${extensionId}`);

  const popup = await openPopup(context, extensionId);
  const tabId = await tabIdOf(popup, fixtureServer.url);

  // The guard sees an http URL and lets it through; Chrome then rejects the
  // attach, and the user gets advice naming the cause, not the raw CDP error.
  const blocked = await sendAction(popup, { action: "start", tabId });
  expect(blocked.ok).toBe(false);
  expect(blocked.error).toContain("Another extension has added content to this page");
  expect(blocked.error).not.toContain("Cannot access a chrome-extension://");
  expect((await sendAction(popup, { action: "getStatus" })).recording).toBe(false);

  // Same tab, same URL, foreign frame removed: attach succeeds. This pins the
  // cause on the frame, not on the page or on two extensions being loaded.
  await page.evaluate(() => document.getElementById("foreign-ext-frame").remove());
  const started = await sendAction(popup, { action: "start", tabId });
  expect(started.ok).toBe(true);
  await sendAction(popup, { action: "stop" });

  await popup.close();
  await page.close();
});
