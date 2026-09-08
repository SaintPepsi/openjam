import { test, expect } from "bun:test";
import { foreignExtensionIds } from "../src/foreign-frames.js";

test("lists other extensions' ids from frame sources, deduped and sorted, never our own", () => {
  const srcs = [
    "chrome-extension://bbbb/z",
    "chrome-extension://aaaa/x.html",
    "chrome-extension://aaaa/y.html?q=1",
    "https://example.test/",
    "chrome-extension://own/mic-permission.html",
    null,
  ];
  expect(foreignExtensionIds(srcs, "own")).toEqual(["aaaa", "bbbb"]);
});

test("empty or absent input yields no ids", () => {
  expect(foreignExtensionIds([], "own")).toEqual([]);
  expect(foreignExtensionIds(undefined, "own")).toEqual([]);
});
