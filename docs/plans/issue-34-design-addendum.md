# issue-34 — addendum: blob: srcs set mid-recording (the real-world case)

**Date:** 2026-07-16. Triage-loop re-entry after a real-world export showed the
shipped `inlineImages: true` fix does not cover the actual Atlassian pattern.

## What the export forensics showed

(Local export analyzed with node; identifying values redacted. Not committed.)

- The target `<img>` was in the **full snapshot with `src=""`** — a placeholder.
- Mid-recording, the page's media client set `src=blob:...` via an **attribute
  mutation** (rrweb event type 3, source 0, `attributes` entry).
- 19 https-sourced images in the same snapshot **did** get `rr_dataURL` — the
  flag was active and works for the snapshot-complete path.
- Zero blob-sourced imgs were inlined.

## Two rrweb gaps (verified in vendored source, rrweb 2.0.1)

1. **The attribute-mutation path never inlines.** `case "attributes"` in the
   MutationBuffer (`node_modules/rrweb/dist/rrweb.js:11879-11925`) records the
   new value via `transformAttribute` verbatim; `inlineImages` is consulted only
   in the node serializer (full snapshot + mutation-added nodes).
2. **The late-load path writes to a dead object.** For an img not loaded at
   serialize time, `recordInlineImage` (rrweb.js:1060-1097) fires on `load` and
   mutates the *already-emitted* snapshot attributes object. Our recorder flushes
   event batches every 500ms over `postMessage` (structured clone), so a late
   `rr_dataURL` lands on an object that has already been cloned away. Lost.

The shipped e2e loaded the blob **before** `start`, so it proved only the
snapshot-complete path — the one path rrweb handles. The mid-recording case had
no disconfirming test (discovery §7, open unknown 3).

## Fix: emit-side blob rewriter in the recorder (MAIN world)

The recorder (`src/rrweb-recorder.js`, MAIN world) is the only place a page's
`blob:` URLs are alive and fetchable. Before flushing a batch, rewrite blob img
srcs into `data:` URIs inside the buffered events themselves:

- **Entry points scanned per event:**
  - type 2 (full snapshot): walk `data.node` for `img` nodes with a `blob:` src
    and no `rr_dataURL` (covers the snapshot race);
  - type 3 / source 0 `adds`: walk added subtrees the same way;
  - type 3 / source 0 `attributes`: entries setting `src` to a `blob:` URL
    (the Atlassian case).
- **Rewrite:** `fetch(blobUrl)` (same-document, in-memory — no network egress)
  → `FileReader.readAsDataURL` → replace the event's `src` value with the
  `data:` URI. The Replayer applies attribute mutations verbatim, so a rewritten
  `src` renders directly (`rr_dataURL` is only honored at node build,
  `@rrweb/replay/dist/replay.js:4113-4145`). Bonus: this satisfies the AC's
  literal "no `blob:` src left in the serialised DOM" for these nodes.
- **Async handling:** rewrites resolve in milliseconds (blob is in-memory).
  `flush()` awaits the pending rewrites for its batch with a hard cap (~2s via
  `Promise.race`) so the event stream can never stall; on failure/timeout the
  original src is left untouched (today's behavior, graceful). Per-URL promise
  cache dedupes repeated sets of the same blob URL.
- **Kept:** `inlineImages: true` stays — it handles snapshot-complete images
  cheaply and synchronously; the rewriter covers what it structurally can't.
- **Out of scope (noted, not built):** `blob:` URLs inside `srcset` (the
  observed mutation nulls srcset), CSS `background-image: url(blob:)`.

## Proof obligations

- **e2e (the real repro):** a test where the `<img>` exists at record start and
  the page sets `src = URL.createObjectURL(...)` **after** recording begins.
  Run it against the current branch HEAD first — it must FAIL (red), proving the
  shipped flag alone doesn't cover this. Then the rewriter turns it green.
  Offline assertions same as the existing blob test (rendered `naturalWidth > 0`,
  effective src starts `data:`).
- **Unit:** exercise the rewrite through the recorder's emit→flush path with the
  mocked rrweb (drive `currentEmit` with a synthetic attribute-mutation event);
  if the bun test env lacks blob/fetch support for this, test the transform seam
  directly. The e2e carries the acceptance either way.
- No real workspace names, URLs, or filenames in any committed code or test.
