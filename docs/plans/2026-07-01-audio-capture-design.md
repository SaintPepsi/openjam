# Audio capture: mic narration on the timeline — Design

**Date:** 2026-07-01
**Issue:** #8 (Audio capture: tab audio / mic narration on the timeline)
**Status:** design approved, pre-implementation

## Problem

The first field-test user asked to record **spoken narration** alongside a session so a
bug report can carry the reporter's voice ("here's what I did, here's what looked
wrong"). OpenJam captures console/network/errors/screenshots + rrweb DOM replay today,
but no audio. We want mic narration recorded during a session and played back in sync
with the timeline and replay — locally, self-contained, nothing uploaded.

## Constraints

- **Local-only, self-contained.** Audio must live in the one exported HTML file and
  never leave the machine unless the user shares that file (`CLAUDE.md` privacy model).
- **MV3 service worker has no DOM** and is killed when idle — it cannot run
  `getUserMedia` / `MediaRecorder`. Live media must run in a DOM context that outlives
  the popup.
- **Minimize new permissions** (freshly live on CWS). v1 adds exactly one: `offscreen`.
- **Additive lane.** Must not touch or risk the existing CDP + rrweb capture paths —
  same posture rrweb took ("different layers, no conflict").
- **Sync is by wall clock.** rrweb events and OpenJam timeline rows are both
  `Date.now()` epoch-ms; audio must align on the same clock.

## Scope (v1)

- **Mic narration only.** Tab audio is a fast-follow (adds `tabCapture` + an
  `AudioContext` re-pipe so capture doesn't mute the tab).
- **One continuous session track** — a single blob for the whole recording, not
  per-clip timeline events.
- **A popup toggle** "Record audio"; when on, a **mic picker** (device `<select>`).
- Export-size growth is explicitly **not** a v1 concern.

## Approaches Considered

1. **Offscreen doc + popup-hosted permission (chosen).** The popup (a real
   extension page, same `chrome-extension://` origin as the offscreen doc) triggers the
   one-time mic-permission prompt and enumerates devices; the offscreen document reuses
   that same-origin grant to run `MediaRecorder`.
   - *Principles:* clean Separation of Concerns (config vs orchestration vs I/O);
     honest, persistent, **extension-named** permission prompt.
   - *Tradeoff:* relies on the popup→offscreen permission reuse holding across the
     same origin (high confidence; spike-verified first).

2. **Offscreen doc + embedded permission iframe.** The offscreen doc embeds an iframe
   pointing at a bundled extension page that calls `getUserMedia`
   (chrome-extensions-samples #821 pattern).
   - *Tradeoff:* needed only if there were no other real extension page to host the
     prompt. We have one — the popup — which the design requires anyway. So the iframe
     is redundant indirection here.

3. **Content-script `getUserMedia` in the page.** Record mic from a content script.
   - *Tradeoff:* uses the **page** origin → **per-site** prompt, grant doesn't persist,
     dies on navigation/reload. Bad privacy optics and violates Separation / Single
     Source of Truth (capture scattered into every page). Rejected.

## Chosen Approach

**Approach 1.** The popup requirement (toggle + mic picker) already puts a real
extension page in the flow, and it shares an origin with the offscreen document — so it
subsumes the permission-page role and the iframe indirection disappears. The offscreen
document is the media I/O boundary; the service worker orchestrates; a pure function
computes sync; the viewer renders.

## Architecture

Each component does one job.

- **`popup.js` / `popup.html`** — configuration + permission.
  - A "🎙 Record audio" toggle. When switched on: call `getUserMedia({audio:true})`
    once to trigger the extension-scoped prompt, then `enumerateDevices()` and populate
    a mic `<select>` with real labels (labels are empty before a grant). **Stop the
    probe stream immediately** — the popup never records.
  - Persist `{ enabled, deviceId }` to `chrome.storage.local`. The popup closing is
    harmless; it only writes settings.
  - Denied permission → inline error, toggle stays off.

- **`background.js`** — orchestrator (service worker).
  - On `start`: read the audio setting; if enabled, `chrome.offscreen.createDocument({
    url:'offscreen.html', reasons:['USER_MEDIA'], justification:'Record mic narration
    for a local bug report' })` and message it `{ audio:'start', deviceId, startWall }`.
  - On `stop`: message `{ audio:'stop' }`, receive the recorded blob back **as a base64
    data URL in the message response** (see Storage path), fold it into `report.audio`,
    then `chrome.offscreen.closeDocument()`.
  - `startWall` is the **same** record-start `Date.now()` the other lanes use.

- **`offscreen.html` / `offscreen.js`** (NEW) — media I/O boundary.
  - `getUserMedia({ audio: { deviceId: deviceId ? {exact:deviceId} : undefined } })`
    (reuses the popup's same-origin grant) → `MediaRecorder` (default
    `audio/webm;codecs=opus`) → collect chunks. On stop, assemble one Blob, read it as a
    base64 data URL, and return `{ dataUrl, mime, startWall, durationMs }` in the message
    response (chrome messaging is JSON-only — a Blob/ArrayBuffer would be lost; see
    Storage path).

- **`audio-sync.js`** (NEW) — pure functions.
  - `audioTimeFor(replayWall, startWall, durationMs) -> seconds`, clamped to
    `[0, durationMs/1000]`. No DOM, unit-tested.

- **Viewer (`viewer.js`) + export (`report-builder.js`)** — render.
  - Mount one `<audio>` **at runtime** (`mountAudio`, from the embedded `#openjam-data`
    JSON); drive the timeline-row highlight from the audio clock via `startWall`. The
    export inlines the blob once as the `data:audio/webm` `dataUrl` inside `#openjam-data`
    — the `<audio>` element itself is created at runtime, not baked into the HTML string.

- **`manifest.js` (`buildManifest`)** — AI-facing index.
  - When `report.audio` is present, add a one-line `audio: { durationMs, mime }` to the
    manifest so an AI agent reading `#openjam-ai` knows a narration track exists without
    parsing the blob. Derived from `report.audio` (no new source of truth). Omitted when
    audio is null. Grounding: `buildManifest` return shape at `manifest.js` (`_doc`,
    `schema`, `counts`, `failures`, `failuresOmitted`).

### Sequence

```
popup: toggle ON -> getUserMedia (prompt once) -> enumerateDevices -> pick mic
       -> storage.local.audio = { enabled:true, deviceId }
user: Start recording
  SW start -> (audio enabled?) createDocument(USER_MEDIA)
           -> offscreen: getUserMedia({deviceId}) -> MediaRecorder.start()
user: Stop & open report
  SW stop -> offscreen: MediaRecorder.stop() -> Blob -> base64 data URL
          -> returned in the message response -> report.audio = { dataUrl, mime, startWall, durationMs }
          -> closeDocument() -> build/open report
viewer/export: <audio> currentTime = audioTimeFor(replayWall, startWall, durationMs)
```

## Data Model

- **Setting** (`chrome.storage.local`), remembered between sessions like the redaction
  toggle:
  ```js
  audio: { enabled: boolean, deviceId: string | null }
  ```
- **Report** — a sibling field beside `rrwebEvents` / `device`, NOT an event `KIND`
  (it's one continuous track):
  ```js
  report.audio = {
    dataUrl: string,      // base64 audio/webm, inlined from record time onward (see Storage path)
    mime: "audio/webm;codecs=opus",
    startWall: number,    // Date.now() at record start (shared with all lanes)
    durationMs: number,
  } | null                // null when audio was off or failed
  ```

## Storage path

**As built:** the offscreen document returns the recorded blob to the service worker as a
**base64 data URL in the chrome message response** (chrome messaging is JSON-only, so a
`Blob`/`ArrayBuffer` can't cross the boundary). The worker inlines it directly in
`report.audio.dataUrl`, exactly the way screenshots are inlined, and it degrades the same
way under storage pressure (`saveReport` drops `report.audio` alongside `rrwebEvents` when
a save fails).

Extension-origin **IndexedDB was considered** (a dedicated blob store the worker reads
back) but **not used for v1**: the base64-inline path reuses the existing screenshot
inlining + `saveReport` quota-degradation machinery with no new module or source of truth,
and keeps the whole report a single self-contained value. IndexedDB stays available as a
future option if audio size ever needs streaming/offloading.

## Error Handling (fail-open, mirrors the rrweb lane)

Audio is additive; any failure degrades to "no audio," never blocks core capture.

- No mic present / permission denied / `createDocument` fails / `MediaRecorder` errors
  → log a warning, `report.audio = null`, the rest of the report is unaffected.
- Chosen `deviceId` unplugged before/for a recording → fall back to the default input
  (drop the `exact` constraint).
- Same try/catch posture the existing rrweb start/stop uses in `background.js`.

## Testing Strategy

- **Unit (`bun test`)** — `audio-sync.js` (pure):
  - `audioTimeFor` maps a wall between start and end to the right offset.
  - **Disconfirming:** wall < `startWall` clamps to `0`; wall > end clamps to
    `durationMs/1000`; `report.audio === null` → sync is a no-op.
- **e2e (`playwright`, real unpacked extension)** — launch Chrome with
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` so the mic
  auto-grants headless:
  - Toggle state persists across popup reopen.
  - With audio on, an offscreen document exists during recording
    (`chrome.offscreen.hasDocument()`), and is gone after stop.
  - `report.audio` is present iff the toggle was on.
  - Exported HTML embeds the `data:audio/webm` URL exactly **once** inside the
    `#openjam-data` JSON when audio was recorded (and a browser-rendered export mounts
    exactly one runtime `<audio>` via `mountAudio`); **zero** when it wasn't
    (disconfirming). The `<audio>` is created at runtime, so it is not a static tag in the
    built HTML string.
- **Dogfood** — narrate a real session, open the report, press play: audio plays and
  the timeline row highlight tracks the audio/replay position.

## Principles Applied

- **Separation of Concerns** — popup configures, SW orchestrates, offscreen does media
  I/O, `audio-sync.js` computes, viewer renders. Each has one reason to change.
- **Data Drives Behavior** — audio is an additive lane gated on a settings flag; the
  existing CDP/rrweb capture paths get **zero** new branches.
- **Single Source of Truth** — `report.audio` and the settings shape are each defined
  once; `startWall` is the one shared record-start clock.
- **Pure Functions for Testability** — sync math is isolated and unit-tested with a
  disconfirming case.
- **Fail-open consistency** — degradation mirrors the existing rrweb lane rather than
  inventing a new failure posture.

## Acceptance criteria

Each criterion names the evidence that proves it (a command + output, or `file:line`).
Try to break each one before accepting it. e2e runs the real unpacked extension with
`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` so the mic
auto-grants headless — landing those flags in the playwright config is the first
implementation step and blocks the e2e items below.

**Popup toggle + mic picker**
- [ ] Toggle persists across sessions → set "Record audio" ON, close and reopen the
  popup; `storage.local.audio.enabled === true`. Evidence: `playwright test` output.
- [ ] **Disconfirming:** fresh profile with no stored setting → toggle reads OFF (audio
  is opt-in). Evidence: e2e assertion before any interaction.
- [ ] Mic picker appears only when enabled and lists real labels → toggle ON → a mic
  `<select>` renders with ≥1 option whose `label` is non-empty (proves the grant
  happened; labels are empty pre-grant). Evidence: e2e asserting the option text.
- [ ] **Disconfirming:** toggle OFF → the mic `<select>` is absent from the DOM.
  Evidence: e2e `expect(locator).toHaveCount(0)`.

**Offscreen lifecycle**
- [ ] Offscreen doc exists only during an audio recording → with audio ON, after
  `start` `chrome.offscreen.hasDocument()` is `true`; after `stop` it is `false`.
  Evidence: pasted values from an e2e/SW eval at both points.
- [ ] **Disconfirming:** with audio OFF, `hasDocument()` is `false` for the whole
  recording (no offscreen doc created). Evidence: e2e output.

**Report payload**
- [ ] `report.audio` populated when recorded → record with audio ON; the stored report
  has `report.audio` with `mime === "audio/webm;codecs=opus"`, `durationMs > 0`, and a
  `startWall` equal to the record-start used by `events`/`rrwebEvents`. Evidence: a
  `bun test` (or e2e) asserting the fields + the shared `startWall`.
- [ ] **Disconfirming:** record with audio OFF → `report.audio === null`. Evidence:
  test output.

**Self-contained export**
- [ ] Exactly one inlined audio track on export → export an audio-ON report; the
  `data:audio/webm` URL appears **exactly once inside the embedded `#openjam-data` JSON**
  (`grep -c 'data:audio/webm' report.html` → `1`), and a browser-rendered export shows
  **exactly one** runtime `<audio>` under `#audio-section` whose `src` starts
  `data:audio/webm`. Note: the `<audio>` is created at runtime by `mountAudio`, so it is
  **not** in the built HTML string — do not grep the export for a static
  `<audio ... src="data:audio/webm">`. Evidence: pasted count + the rendered element.
- [ ] **Disconfirming:** export an audio-OFF report → no `#audio-section` and
  `grep -c 'data:audio/webm' report.html` → `0`. Evidence: pasted count.
- [ ] No external audio egress → `grep -nE "fetch|XMLHttpRequest|WebSocket|https?://"`
  across `offscreen.js` shows no upload of the blob; the blob path is
  `MediaRecorder` blob → base64 data URL → message response → `report.audio.dataUrl`
  inline only. Evidence: pasted grep + `file:line` of the data-URL read and the export inline.

**Sync (pure function)**
- [ ] `audioTimeFor` maps a mid-session wall to the right offset → `bun test`:
  `audioTimeFor(startWall + 5000, startWall, 10000) === 5`. Evidence: test output.
- [ ] **Disconfirming:** `audioTimeFor(startWall - 1, …) === 0` (clamp low),
  `audioTimeFor(startWall + 999999, startWall, 10000) === 10` (clamp high), and a null
  track is a no-op. Evidence: test output.

**AI manifest**
- [ ] Manifest reflects audio when present → `bun test`: `buildManifest(report)` on an
  audio report returns `audio: { durationMs, mime }`. Evidence: test output.
- [ ] **Disconfirming:** `report.audio === null` → the returned manifest has no `audio`
  key. Evidence: test output.

**Fail-open degradation**
- [ ] Denied mic never breaks the report → unit/e2e: force `getUserMedia` to reject; the
  report still builds, `report.audio === null`, and `report.events` (+ `rrwebEvents` if
  present) are intact. Evidence: test output showing the core payload present.
- [ ] **Disconfirming:** the same recording with a working mic yields
  `report.audio !== null` — proves the failure path, not a permanently-off feature.
  Evidence: test output.

**Playback (dogfood — manual, named result)**
- [ ] Narrate a real session, open the report, press play → audio plays and the timeline
  row highlight tracks the audio/replay position. Result: pass/fail noted (manual;
  headless can't assert audible output — report honestly if not verified).

Report any criterion you could not produce evidence for. "Couldn't verify the popup→
offscreen permission reuse headlessly" is a valid result and feeds Open Question #1.

## Decided

- **AI manifest** — when `report.audio` is present, `buildManifest` adds one line
  `audio: { durationMs, mime }` to `#openjam-ai`; omitted when audio is null.

## Open Questions

1. **Permission reuse popup → offscreen** (same `chrome-extension://` origin).
   **Status (partly verified):** the e2e (`e2e/audio.spec.mjs`) exercises the offscreen
   `getUserMedia` → `MediaRecorder` path successfully **headless with a fake device**
   (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, so the prompt
   auto-grants) — the mechanics work end to end and produce a `report.audio` track. What
   this does **not** prove is the exact popup-grant → offscreen-reuse *persistence* with a
   real mic and a real one-time prompt (the fake-UI flag bypasses the prompt entirely). So
   the popup→offscreen same-origin grant reuse still wants a real-mic **dogfood
   confirmation** — Task 0 remains a manual check. If real-mic reuse doesn't hold, fall
   back to Approach 2 (iframe inside the offscreen doc).
2. **Fast-follow (tab audio)** — second stream via `tabCapture.getMediaStreamId` mixed
   with the mic through an `AudioContext`; adds `tabCapture` and the re-pipe-to-speakers
   step. Out of scope for v1, noted so the data model (`report.audio`) doesn't need to
   change to accommodate it later (a single mixed track still fits).

## References

Framework / API facts:
- Offscreen documents, `chrome.offscreen.createDocument` reasons + `USER_MEDIA`, and
  re-piping captured audio through an `AudioContext` so the tab isn't muted —
  <https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture>
- Mic permission needs a real extension page context (popup/iframe), not the offscreen
  doc alone; extension-named persistent prompt —
  <https://github.com/GoogleChrome/chrome-extensions-samples/issues/821>
- Reference implementations (MV3 SW + offscreen + `MediaRecorder`, mic/tab):
  <https://github.com/asimons81/chrome-video-recorder>,
  <https://github.com/recallai/chrome-recording-transcription-extension>
- `MediaRecorder` default container/codec (`audio/webm;codecs=opus`),
  `navigator.mediaDevices.enumerateDevices()` (labels empty until a grant),
  Chrome fake-media flags for headless tests
  (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`) — MDN /
  Chrome DevTools docs.

Codebase facts:
- Event model + `report` sibling fields: `event-kinds.js`, `background.js` (report
  assembly with `device` / `rrwebEvents`).
- AI manifest shape: `manifest.js` (`buildManifest`).
- Popup "main panel" (Start/Stop toggle, status): `popup.html`, `popup.js`.
- rrweb additive-lane precedent + storage/message caps: `plans/PHASE_1_PLAN.md`.
- Privacy model (local-only, self-contained): `CLAUDE.md`.
