// pickBrowser is a pure (ua, nav) -> {id,label,svg} function. It replaces the
// hand-rolled if-chain that used to live in docs/index.html's page IIFE.
// Disconfirming input: Edge/Opera MUST fall through to Chrome (OpenJam isn't on
// their stores) — asserting they relabel to "Edge"/"Opera" fails on purpose.
import { test, expect } from "bun:test";
import { pickBrowser, BROWSERS, ICONS } from "../install-cta.js";

const UA = {
  chrome:   "Mozilla/5.0 ... Chrome/126.0.0.0 Safari/537.36",
  chromium: "Mozilla/5.0 ... Chromium/126.0.0.0 Chrome/126.0.0.0 Safari/537.36",
  vivaldi:  "Mozilla/5.0 ... Chrome/126.0.0.0 Safari/537.36 Vivaldi/6.7",
  edge:     "Mozilla/5.0 ... Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  opera:    "Mozilla/5.0 ... Chrome/126.0.0.0 Safari/537.36 OPR/110.0.0.0",
};

test("Chrome is the default", () => {
  const b = pickBrowser(UA.chrome, {});
  expect(b.id).toBe("chrome");
  expect(b.label).toBe("Chrome");
  expect(b.svg.length).toBeGreaterThan(0);
});

test("Vivaldi wins over the Chrome token in its UA", () => {
  expect(pickBrowser(UA.vivaldi, {}).label).toBe("Vivaldi");
});

test("Brave is detected via navigator.brave, not the UA", () => {
  expect(pickBrowser(UA.chrome, { brave: {} }).label).toBe("Brave");
});

test("Chromium is detected via the Chromium/ token", () => {
  expect(pickBrowser(UA.chromium, {}).label).toBe("Chromium");
});

test("Edge and Opera fall through to Chrome (own stores, not CWS-friendly)", () => {
  expect(pickBrowser(UA.edge, {}).label).toBe("Chrome");
  expect(pickBrowser(UA.opera, {}).label).toBe("Chrome");
});

test("the returned svg matches the detected browser's icon", () => {
  expect(pickBrowser(UA.vivaldi, {}).svg).toBe(ICONS.vivaldi);
  expect(pickBrowser(UA.chrome, {}).svg).toBe(ICONS.chrome);
});

test("nav omitted: pickBrowser(ua) returns Chrome without throwing", () => {
  expect(pickBrowser(UA.chrome).label).toBe("Chrome");
});

test("every browser id has a non-empty inline SVG", () => {
  for (const id of ["chrome", "chromium", "vivaldi", "brave"]) {
    expect(ICONS[id]).toBeDefined();
    expect(ICONS[id]).toContain("<svg");
  }
  for (const b of BROWSERS) expect(ICONS[b.id]).toBeDefined();
});
