// Which OTHER extensions have frames in a page. Input is the list of iframe
// src URLs the scan collected; output is the sorted, de-duplicated set of
// extension ids that are not ours. Pure, so the scan itself stays a one-liner.
export function foreignExtensionIds(frameSrcs, ownId) {
  const ids = new Set();
  for (const src of frameSrcs || []) {
    if (typeof src !== "string" || !src.startsWith("chrome-extension://")) continue;
    const id = src.slice("chrome-extension://".length).split(/[/?#]/)[0];
    if (id && id !== ownId) ids.add(id);
  }
  return [...ids].sort();
}

// Runs inside every frame of the tab (chrome.scripting, allFrames) and
// returns the extension-origin iframe sources it can see. Closed shadow roots
// are out of reach; the caller copes with an empty result.
export function listExtensionFrameSrcs() {
  return Array.from(document.querySelectorAll("iframe[src^='chrome-extension:']"), (f) => f.src);
}
