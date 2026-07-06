# Audio Capture (mic narration) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ExecutingPlans to implement this plan task-by-task.

**Goal:** Record microphone narration during an OpenJam session and play it back, in sync with the timeline, from both the in-extension viewer and the self-contained export — fully local, opt-in.

**Architecture:** An offscreen document is the only place the MV3 service worker can run `getUserMedia`/`MediaRecorder`. The popup configures (toggle + mic picker) and hosts the one-time, extension-scoped mic permission prompt; the background worker creates/tears down the offscreen doc per recording as an additive lane beside CDP + rrweb; the offscreen doc records a `webm/opus` blob and returns it as a base64 data URL (Chrome messaging is JSON-only). Audio rides inside `report.audio` (inlined like screenshots), synced by a shared `startWall` clock.

**Tech Stack:** Chrome MV3 (`chrome.offscreen`, `chrome.runtime` messaging), `MediaRecorder`/`getUserMedia`, esbuild (build unchanged — new files are plain loose modules), `bun test` (unit), Playwright (e2e, with fake-media flags).

**Design doc:** `docs/plans/2026-07-01-audio-capture-design.md`. **Issue:** #8.

**Divergences from the design doc (intentional, see design "Storage path"):**
- Blob handoff is base64-over-message + inline in `report.audio.dataUrl` (mirrors screenshot inlining + `saveReport` degradation), **not** a new IndexedDB module.
- Narration is driven by the rrweb replay clock — the replayer is the single player (play/pause/seek/speed move the audio too); a standalone audio player exists only for reports with no replay. (Superseded the earlier "one-directional, two-way deferred" plan after the initial two-player build.)
Update the design doc's "Storage path" section to match as the final task.

**Conventions to preserve:**
- Fail-open like the rrweb lane (`background.js:274-296`): any audio failure logs a warning event and leaves `report.audio = null`; core capture is never blocked.
- `report.audio` is a sibling field beside `rrwebEvents` (not an event `KIND`).
- Background message routing already ignores messages carrying a `type` field in the action listener (`background.js:509`); all audio worker↔offscreen messages use `type: "oj-audio-*"` so they never collide with popup `action` messages.

---

## Task 0: Spike — verify popup→offscreen mic-permission reuse (de-risk, throwaway)

Retire the one assumption the whole design rests on (design Open Question #1) before building. **Do not commit spike code.**

**Step 1:** Temporarily add `"offscreen"` to `manifest.json` permissions. Create throwaway `offscreen.html` (`<script type="module" src="offscreen.js"></script>`) and `offscreen.js` that on message `{type:"oj-audio-start"}` calls `navigator.mediaDevices.getUserMedia({audio:true})` and `sendResponse({ok:true})` (or `{ok:false,error}`).

**Step 2:** In the popup DevTools console (real extension page), run once:
```js
await navigator.mediaDevices.getUserMedia({ audio: true });  // grant the extension-scoped prompt
```
Confirm the prompt reads "OpenJam wants to use your microphone".

**Step 3:** From the background service-worker console:
```js
await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA"], justification: "spike" });
await chrome.runtime.sendMessage({ type: "oj-audio-start" });
```
**Expected (Approach 1 holds):** `{ ok: true }` with **no second permission prompt**.
**If it re-prompts or returns `{ok:false}`:** Approach 1 fails — STOP, update the design doc to Approach 2 (iframe-in-offscreen permission page), and adjust Tasks 3 & 5 before continuing.

**Step 4:** Revert all spike edits (`git checkout manifest.json`, delete throwaway files). Record the result (pass/fail) in the design doc's Open Question #1.

---

## Task 1: `audioTimeFor` pure sync function (TDD)

**Files:**
- Create: `audio-sync.js`
- Test: `test/audio-sync.test.js`

**Step 1: Write the failing test** — `test/audio-sync.test.js` (match the import style of an existing unit test, e.g. `test/event-kinds.test.js`):

```js
import { test, expect } from "bun:test";
import { audioTimeFor, wallForAudioTime } from "../audio-sync.js";

test("maps a mid-session wall to offset seconds", () => {
  expect(audioTimeFor(1000 + 5000, 1000, 10000)).toBe(5);
});
test("clamps a wall before start to 0", () => {
  expect(audioTimeFor(999, 1000, 10000)).toBe(0);
});
test("clamps a wall past the end to durationMs", () => {
  expect(audioTimeFor(1000 + 999999, 1000, 10000)).toBe(10);
});
test("null/absent duration is a no-op (0)", () => {
  expect(audioTimeFor(5000, 1000, null)).toBe(0);
});
test("wallForAudioTime is the inverse of the offset math", () => {
  expect(wallForAudioTime(5, 1000)).toBe(6000);
});
```

**Step 2: Run it to verify it fails**
Run: `bun test test/audio-sync.test.js`
Expected: FAIL — cannot find module `../audio-sync.js`.

**Step 3: Write the minimal implementation** — `audio-sync.js`:

```js
// Pure sync math for narration playback. No DOM — unit-tested in isolation.
// The whole timeline shares one wall clock (Date.now epoch ms); audio aligns to
// it via the report's audio.startWall, exactly like rrweb events.

// Wall-clock instant -> audio element currentTime (seconds), clamped to the track.
export function audioTimeFor(wallMs, startWall, durationMs) {
  if (startWall == null || durationMs == null) return 0;
  const offsetMs = Math.max(0, Math.min(wallMs - startWall, durationMs));
  return offsetMs / 1000;
}

// Inverse: the wall-clock instant an audio position corresponds to.
export function wallForAudioTime(currentTimeSec, startWall) {
  return startWall + currentTimeSec * 1000;
}
```

**Step 4: Run tests to verify they pass**
Run: `bun test test/audio-sync.test.js`
Expected: PASS (5 tests).

**Step 5: Commit**
```bash
git add audio-sync.js test/audio-sync.test.js
git commit -m "feat(audio): pure sync math for narration playback"
```

---

## Task 2: Manifest permission + packaging

**Files:**
- Modify: `manifest.json` (permissions array)
- Modify: `package.json` (`package` script file list)
- Test: `test/packaging.test.js` (update expected file list if it asserts one)

**Step 1: Read the packaging test first**
Run: `cat test/packaging.test.js`
Note whether it asserts an exact shipped-file list; if so it must gain `offscreen.html`, `offscreen.js`, `audio-sync.js` in Step 4.

**Step 2: Add the `offscreen` permission** — `manifest.json`:
```diff
-  "permissions": ["debugger", "storage", "unlimitedStorage", "scripting"],
+  "permissions": ["debugger", "storage", "unlimitedStorage", "scripting", "offscreen"],
```

**Step 3: Add new files to the package zip** — `package.json` `scripts.package`, append the three new loose files before `icons`:
```diff
- "package": "npm run build && zip -r openjam.zip manifest.json LICENSE background.js event-kinds.js manifest.js issue-link.js popup.html popup.js viewer.html viewer.js renderer.js report-builder.js icons dist src/generated"
+ "package": "npm run build && zip -r openjam.zip manifest.json LICENSE background.js event-kinds.js manifest.js issue-link.js popup.html popup.js viewer.html viewer.js renderer.js report-builder.js audio-sync.js offscreen.html offscreen.js icons dist src/generated"
```

**Step 4: Update packaging test** if Step 1 found an asserted list — add the three files, mirroring the existing entries.

**Step 5: Verify**
Run: `bun test test/packaging.test.js && bun test test/manifest.test.js`
Expected: PASS.

**Step 6: Commit**
```bash
git add manifest.json package.json test/packaging.test.js
git commit -m "feat(audio): add offscreen permission and ship new audio files"
```

---

## Task 3: Offscreen document — the MediaRecorder host

**Files:**
- Create: `offscreen.html`
- Create: `offscreen.js`

**Step 1:** Create `offscreen.html` (minimal — it only hosts the script):
```html
<!doctype html>
<meta charset="utf-8">
<title>OpenJam audio</title>
<script type="module" src="offscreen.js"></script>
```

**Step 2:** Create `offscreen.js`:
```js
// Offscreen document: the ONLY place OpenJam can run getUserMedia + MediaRecorder
// (the MV3 service worker has no DOM). Records mic narration to a webm/opus blob,
// returns it to the worker as a base64 data URL (chrome messaging is JSON-only, so
// a Blob/ArrayBuffer would be lost). Created and closed by background.js per
// recording. Reuses the extension-scoped mic grant obtained in the popup (verified
// in Task 0).

const MIME = "audio/webm;codecs=opus";
let recorder = null;
let chunks = [];
let stream = null;
let startWall = null;

async function start(deviceId) {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
  });
  chunks = [];
  recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(MIME) ? { mimeType: MIME } : undefined);
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  startWall = Date.now();
  recorder.start();
}

function stop() {
  return new Promise((resolve) => {
    if (!recorder) return resolve(null);
    recorder.onstop = async () => {
      const durationMs = Date.now() - startWall;
      const blob = new Blob(chunks, { type: MIME });
      const dataUrl = await new Promise((res) => {
        const fr = new FileReader();
        fr.onloadend = () => res(fr.result);
        fr.readAsDataURL(blob);
      });
      if (stream) stream.getTracks().forEach((t) => t.stop());
      recorder = null; stream = null;
      resolve({ dataUrl, mime: MIME, startWall, durationMs });
    };
    recorder.stop();
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "oj-audio-start") {
    start(msg.deviceId || null).then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
  if (msg.type === "oj-audio-stop") {
    stop().then((r) => sendResponse(r)).catch(() => sendResponse(null));
    return true;
  }
});
```

**Step 3: Verify (manual — no DOM in bun/CI):** load the unpacked extension, and from the background console after `createDocument`, `chrome.runtime.sendMessage({type:"oj-audio-start"})` returns `{ok:true}`, then `{type:"oj-audio-stop"}` returns an object whose `dataUrl` starts with `data:audio/webm`. This path is exercised end-to-end by the e2e in Task 9; note here if you can't verify standalone.

**Step 4: Commit**
```bash
git add offscreen.html offscreen.js
git commit -m "feat(audio): offscreen MediaRecorder host"
```

---

## Task 4: Background audio lane

**Files:**
- Modify: `background.js` (session shape; start/stop/salvage/finalize; saveReport degradation)

**Step 1: Extend the session shape** — `background.js:11-23`, add two fields:
```diff
   device: null,
   lastErrorShot: 0,
+  audioActive: false,
 };
```
And in the `Object.assign(session, {...})` reset inside `startRecording` (`background.js:337-349`), add `audioActive: false,`.

**Step 2: Add the audio lane helpers** near the rrweb recorder helpers (after `background.js:296`):
```js
// ---- mic narration lane (offscreen MediaRecorder) -------------------------

async function startAudioRecorder() {
  const { audioSettings } = await chrome.storage.local.get("audioSettings");
  if (!audioSettings || !audioSettings.enabled) return;
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["USER_MEDIA"],
        justification: "Record microphone narration for a local bug report.",
      });
    }
    const res = await chrome.runtime.sendMessage({ type: "oj-audio-start", deviceId: audioSettings.deviceId || null });
    if (!res || !res.ok) throw new Error((res && res.error) || "audio start failed");
    session.audioActive = true;
  } catch (err) {
    session.audioActive = false;
    try { await chrome.offscreen.closeDocument(); } catch { /* none open */ }
    pushEvent({ t: Date.now(), kind: KIND.LOG, level: "warning", title: "Audio narration unavailable", detail: { message: String(err) } });
  }
}

async function stopAudioRecorder() {
  if (!session.audioActive) return null;
  session.audioActive = false;
  try {
    const res = await chrome.runtime.sendMessage({ type: "oj-audio-stop" });
    return res && res.dataUrl ? res : null;
  } catch {
    return null;
  } finally {
    try { await chrome.offscreen.closeDocument(); } catch { /* already closed */ }
  }
}
```

**Step 3: Start the lane** — in `startRecording`, after `await startReplayRecorder(tabId);` (`background.js:365`):
```diff
   await startReplayRecorder(tabId);
+  await startAudioRecorder();
   return { ok: true };
```

**Step 4: Collect + thread the blob on stop and salvage.**
In `stopRecording` (`background.js:392`), replace the tail `return finalizeRecording();`:
```diff
-  return finalizeRecording();
+  const audio = await stopAudioRecorder();
+  return finalizeRecording({ audio });
```
In `salvageRecording` (`background.js:413`), replace `await finalizeRecording({ note });`:
```diff
-  await finalizeRecording({ note });
+  const audio = await stopAudioRecorder();
+  await finalizeRecording({ note, audio });
```

**Step 5: Put audio in the report** — `finalizeRecording` signature + report literal (`background.js:419-436`):
```diff
-async function finalizeRecording({ note } = {}) {
+async function finalizeRecording({ note, audio } = {}) {
```
```diff
     events: session.events.slice().sort((a, b) => a.t - b.t),
     rrwebEvents: session.rrwebEvents.slice().sort((a, b) => a.timestamp - b.timestamp),
+    audio: audio || null,
   };
```

**Step 6: Degrade audio under storage quota** — in `saveReport`'s first catch (`background.js:465`), drop audio alongside replay:
```diff
   } catch (err) {
     report.rrwebEvents = [];
+    report.audio = null;
```

**Step 7: Verify** the file still parses and existing background tests pass.
Run: `bun test test/background.test.js`
Expected: PASS (no regressions). Add audio-specific coverage here only if `background.test.js` already unit-tests report assembly; otherwise the audio lane is covered by e2e (Task 9) — note that here.

**Step 8: Commit**
```bash
git add background.js
git commit -m "feat(audio): background lane — offscreen create/collect, report.audio, quota degradation"
```

---

## Task 5: Popup toggle + mic picker

**Files:**
- Modify: `popup.html` (markup + styles)
- Modify: `popup.js` (settings, permission prompt, device enumeration)

**Step 1: Add markup** — `popup.html`, after the `#shot` button:
```html
  <label class="audio-row"><input type="checkbox" id="audioToggle"> 🎙 Record audio</label>
  <select id="micSelect" hidden></select>
  <div class="oj-error" id="micError" hidden></div>
```
Add styles to the `<style>` block:
```css
  .audio-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--fg);margin-bottom:8px;cursor:pointer}
  #micSelect{width:100%;margin-bottom:8px;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:6px}
```

**Step 2: Add popup logic** — `popup.js`, after the existing element lookups:
```js
const audioToggle = document.getElementById("audioToggle");
const micSelect = document.getElementById("micSelect");
const micError = document.getElementById("micError");

async function loadAudioSettings() {
  const { audioSettings } = await chrome.storage.local.get("audioSettings");
  const s = audioSettings || { enabled: false, deviceId: null };
  audioToggle.checked = s.enabled;
  if (s.enabled) await populateMics(s.deviceId);
  micSelect.hidden = !s.enabled;
}

async function populateMics(selectedId) {
  try {
    // A getUserMedia grant is required before labels are populated. It triggers
    // the extension-scoped prompt once; the grant persists and is reused by the
    // offscreen recorder (same chrome-extension:// origin).
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop()); // the popup never records
    const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    micSelect.innerHTML = "";
    for (const m of mics) {
      const opt = document.createElement("option");
      opt.value = m.deviceId;
      opt.textContent = m.label || "Microphone";
      if (m.deviceId === selectedId) opt.selected = true;
      micSelect.appendChild(opt);
    }
    micError.hidden = true;
    return true;
  } catch (err) {
    micError.textContent = "Microphone unavailable: " + err.message;
    micError.hidden = false;
    return false;
  }
}

async function saveAudioSettings() {
  await chrome.storage.local.set({
    audioSettings: { enabled: audioToggle.checked, deviceId: audioToggle.checked ? micSelect.value || null : null },
  });
}

audioToggle.addEventListener("change", async () => {
  if (audioToggle.checked) {
    const ok = await populateMics(null);
    micSelect.hidden = !ok;
    if (!ok) audioToggle.checked = false;
  } else {
    micSelect.hidden = true;
  }
  await saveAudioSettings();
});
micSelect.addEventListener("change", saveAudioSettings);
```
And call `loadAudioSettings();` next to the existing `refresh();` at the bottom.

**Step 3: Verify** — manual: toggle on → prompt appears once → picker fills with real labels; reopen popup → toggle + selection restored (`chrome.storage.local` `audioSettings`). Automated coverage in Task 9.

**Step 4: Commit**
```bash
git add popup.html popup.js
git commit -m "feat(audio): popup record-audio toggle + mic picker"
```

---

## Task 6: AI manifest reflects audio (TDD)

**Files:**
- Modify: `manifest.js` (`buildManifest` return)
- Test: `test/manifest.test.js`

**Step 1: Write the failing test** — add to `test/manifest.test.js`:
```js
test("includes audio metadata when report.audio is present", () => {
  const m = buildManifest({ events: [], audio: { dataUrl: "data:audio/webm;base64,AA", mime: "audio/webm;codecs=opus", startWall: 1, durationMs: 4200 } });
  expect(m.audio).toEqual({ durationMs: 4200, mime: "audio/webm;codecs=opus" });
});
test("omits audio key when report.audio is null", () => {
  const m = buildManifest({ events: [], audio: null });
  expect(m.audio).toBeUndefined();
});
```

**Step 2: Run to verify it fails**
Run: `bun test test/manifest.test.js`
Expected: FAIL — `m.audio` is undefined in the first test.

**Step 3: Implement** — `manifest.js`, in `buildManifest`, replace the final `return`:
```diff
-  return { _doc: DOC, schema: LEGEND, counts, failures: capped, failuresOmitted };
+  const out = { _doc: DOC, schema: LEGEND, counts, failures: capped, failuresOmitted };
+  if (report && report.audio) out.audio = { durationMs: report.audio.durationMs, mime: report.audio.mime };
+  return out;
```

**Step 4: Run to verify it passes**
Run: `bun test test/manifest.test.js`
Expected: PASS.

**Step 5: Commit**
```bash
git add manifest.js test/manifest.test.js
git commit -m "feat(audio): note narration track in the AI manifest"
```

---

## Task 7: Playback — `mountAudio` + export inlining (TDD where possible)

**Files:**
- Modify: `renderer.js` (new `mountAudio` export; add `data-t` to timeline rows for sync)
- Modify: `report-builder.js` (inline `<audio>` + `mountAudio` in the export)
- Test: `test/report-builder.test.js`

**Step 1: Read `renderer.js` render()** to confirm the row element and where the sorted `events` are built (`renderer.js:336-348`). Add a wall-clock hook to each row inside `render()`:
```diff
       var row = el("div", "row lvl-" + (ev.level || ev.kind));
+      row.dataset.t = String(ev.t);
```

**Step 2: Add `mountAudio`** to `renderer.js` (self-contained like `mountReplay`, so the export can embed it via `toString`), near `mountReplay`:
```js
// Self-contained (embedded via toString in the export). Plays the narration and,
// on each timeupdate, highlights the timeline row nearest the current wall time.
export function mountAudio(container, report) {
  if (!report.audio || !report.audio.dataUrl) return;
  var startWall = report.audio.startWall;
  var audio = document.createElement("audio");
  audio.controls = true;
  audio.src = report.audio.dataUrl;
  audio.style.width = "100%";
  container.appendChild(audio);

  audio.addEventListener("timeupdate", function () {
    var wall = startWall + audio.currentTime * 1000;
    var rows = document.querySelectorAll("#app .timeline .row");
    var pick = null;
    for (var i = 0; i < rows.length; i++) {
      if (Number(rows[i].dataset.t) <= wall) pick = rows[i]; else break;
    }
    for (var j = 0; j < rows.length; j++) rows[j].classList.remove("oj-audio-active");
    if (pick) { pick.classList.add("oj-audio-active"); pick.scrollIntoView({ block: "nearest" }); }
  });
}
```
Add a highlight style to `REPORT_CSS` (`renderer.js:6`):
```css
.row.oj-audio-active{background:#1d2b45;box-shadow:inset 3px 0 0 #6ea8fe}
```

**Step 3: Write the failing export test** — add to `test/report-builder.test.js` (mirror its existing `buildReportHTML` cases):
```js
test("inlines exactly one audio element when report.audio is present", () => {
  const html = buildReportHTML({ meta: {}, events: [], rrwebEvents: [], audio: { dataUrl: "data:audio/webm;base64,AA", mime: "audio/webm;codecs=opus", startWall: 1, durationMs: 10 } }, null);
  expect((html.match(/id="audio-section"/g) || []).length).toBe(1);
});
test("omits the audio section when report.audio is null", () => {
  const html = buildReportHTML({ meta: {}, events: [], rrwebEvents: [], audio: null }, null);
  expect(html.includes('id="audio-section"')).toBe(false);
});
```

**Step 4: Run to verify it fails**
Run: `bun test test/report-builder.test.js`
Expected: FAIL — no `audio-section` emitted yet.

**Step 5: Implement export inlining** — `report-builder.js`:
- Import `mountAudio`: change line 10 to `import { renderReport, mountReplay, mountAudio, REPORT_CSS, REPLAY_CSS } from "./renderer.js";`
- Add `const hasAudio = !!(report.audio && report.audio.dataUrl);` near line 24.
- Add the section markup after the replay-section line (`report-builder.js:38`):
```js
${hasAudio ? `<div id="audio-section"><h2>Narration</h2><div id="audio"></div></div>` : ""}
```
- Add the mount script before the final `renderReport` script (`report-builder.js:57`). Note `mountAudio` reads `#app .timeline`, so it must run AFTER `renderReport`; place it after the renderReport call:
```js
${hasAudio ? `<script>
${mountAudio.toString()}
try { mountAudio(document.getElementById("audio"), JSON.parse(document.getElementById("openjam-data").textContent)); }
catch (err) { var s = document.getElementById("audio-section"); if (s) s.hidden = true; console.error("audio mount failed", err); }
</script>` : ""}
```

**Step 6: Run to verify it passes**
Run: `bun test test/report-builder.test.js`
Expected: PASS.

**Step 7: Commit**
```bash
git add renderer.js report-builder.js test/report-builder.test.js
git commit -m "feat(audio): inline narration player + timeline-highlight sync in export"
```

---

## Task 8: In-extension viewer playback

**Files:**
- Modify: `viewer.html` (add a hidden `#audio-section` mirroring `#replay-section`)
- Modify: `viewer.js` (mount audio after renderReport)

**Step 1: Read `viewer.html`** to copy the exact `#replay-section` markup pattern.
Run: `grep -n "replay-section" viewer.html`
Add a sibling, hidden by default:
```html
<div id="audio-section" hidden><h2>Narration</h2><div id="audio"></div></div>
```

**Step 2: Mount in `viewer.js`** — import `mountAudio` (add to the `renderer.js` import on line 7) and, after `renderReport(...)` (`viewer.js:32`):
```js
if (report.audio && report.audio.dataUrl) {
  const section = document.getElementById("audio-section");
  section.hidden = false;
  try { mountAudio(document.getElementById("audio"), report); }
  catch (err) { renderErrorReport(document.getElementById("audio"), "Audio failed to mount: " + err, ENV); }
}
```

**Step 3: Verify** — manual: open a report with audio; the player appears and plays; timeline rows highlight as it plays. Covered by e2e in Task 9.

**Step 4: Commit**
```bash
git add viewer.html viewer.js
git commit -m "feat(audio): in-extension viewer narration playback"
```

---

## Task 9: e2e — fake mic, full capture→export loop

**Files:**
- Modify: `playwright.config.mjs` (fake-media Chrome flags) OR the launch args in `test/e2e/harness.mjs`
- Create: `test/e2e/audio.spec.mjs` (mirror an existing e2e spec's structure)

**Step 1: Read the e2e harness** to see how the extension is launched and where Chrome args live.
Run: `sed -n '1,80p' test/e2e/harness.mjs`
Add these launch args wherever the persistent context is created:
```
--use-fake-device-for-media-stream
--use-fake-ui-for-media-stream
```
(The first supplies a synthetic mic; the second auto-accepts the permission prompt headless.)

**Step 2: Write the e2e spec** — `test/e2e/audio.spec.mjs`. Use the existing specs' import + fixtures. Assert, in order:
1. **Toggle persists:** open popup, check `#audioToggle`, reopen popup → checkbox still checked and `chrome.storage.local` `audioSettings.enabled === true`.
2. **Disconfirming (opt-in default):** fresh profile → `#audioToggle` unchecked; `#micSelect` has `hidden` attribute.
3. **Offscreen lifecycle:** with audio on, start recording → evaluate `chrome.offscreen.hasDocument()` in the SW returns `true`; after stop → `false`. Disconfirming: audio off → stays `false`.
4. **Report payload:** audio-on run → the stored report has `report.audio.mime === "audio/webm;codecs=opus"` and `durationMs > 0`. Disconfirming: audio-off run → `report.audio === null`.
5. **Export:** build the export (see `test/e2e/build-export.mjs`) from an audio-on report → the `data:audio/webm` URL appears exactly once **inside the embedded `#openjam-data` JSON** (`(html.match(/data:audio\/webm/g) || []).length === 1`), and a browser-rendered export mounts exactly one runtime `<audio>` under `#audio-section` whose `src` starts `data:audio/webm`. Note: the `<audio>` is created at runtime by `mountAudio`, so do **not** grep the built HTML string for a static `<audio ... src="data:audio/webm">` — it isn't there. Disconfirming: audio-off export → zero `data:audio/webm` matches and no `#audio-section`.

**Step 3: Run**
Run: `npm run build && npx playwright test test/e2e/audio.spec.mjs`
Expected: PASS. If mic capture yields a 0-length blob under the fake device, record a longer interaction window before stop and note it.

**Step 4: Commit**
```bash
git add playwright.config.mjs test/e2e/harness.mjs test/e2e/audio.spec.mjs
git commit -m "test(audio): e2e capture→export with fake mic"
```

---

## Task 10: Docs + design-doc reconciliation

**Files:**
- Create: `docs/feature-set/audio-narration.md` (What it does / What to expect / Test data / Related — per `CLAUDE.md` Docs)
- Modify: `docs/plans/2026-07-01-audio-capture-design.md` (update "Storage path" to base64-inline; mark Open Question #1 resolved from Task 0)
- Modify: `README.md` (one line under features, if the feature list enumerates capture kinds)

**Step 1:** Write the feature-set page; point "Test data" at `test/e2e/audio.spec.mjs` and the fixture used.
**Step 2:** Reconcile the design doc's storage section with the base64-inline decision; record the Task 0 permission-reuse result.
**Step 3:** Full suite green.
Run: `npm test`
Expected: build + `bun test test/` + `playwright test` all PASS.
**Step 4: Commit**
```bash
git add docs/feature-set/audio-narration.md docs/plans/2026-07-01-audio-capture-design.md README.md
git commit -m "docs(audio): feature-set page + design reconciliation"
```

---

## Manual testing (dogfood audio + sync end to end)

**Test area — do NOT use the Chrome Web Store or `chrome://` pages.** Chrome blocks
content scripts and `chrome.debugger` there, so capture silently produces no
replay/audio (OpenJam's guard only screens `chrome://`/extension pages,
`background.js:322-331`).

- **Primary (real site):** the GitHub repo page,
  <https://github.com/SaintPepsi/openjam> — a normal https page with plenty to click
  (tabs, files, buttons) and real network/console traffic. Once the feature is built,
  do a narrated test recording here, export it, and analyse the report together
  (cross-check narration ↔ timeline, and run the redaction verification skill over it —
  `docs/pii-redaction/`).
- **Deterministic fallback:** `test/e2e/fixture.html` opened as a `file://` URL
  (recordable — `background.js:329` allows `file:`). Its buttons each drive one capture
  lane: `#inc` → console + DOM; `#fetchBtn` → network; `#injectStyle` → CSS-in-JS
  replay; `#name`/`#secret` → input replay (password stays masked); `#errBtn` →
  uncaught error + auto-screenshot.

**Narrated click-through** (speak each line so audio ↔ timeline can be cross-checked):
1. Popup → toggle 🎙 Record audio ON → pick a mic (grant the prompt once).
2. Popup → Start recording. Say: "Starting the test."
3. Do 3–4 distinct actions with a beat between each (e.g. on GitHub: open the Issues
   tab, open a file, scroll; on the fixture: Increment ×3, Fetch self, Inject style,
   Trigger error). Narrate each as you do it.
4. Popup → Stop & open report. Say: "Stopping."

**Observe (pass criteria):**
- Report opens with a Narration player; press play → your voice plays back.
- As audio plays, timeline rows highlight in step with what you narrated (the order you
  described matches the order highlighted).
- Export → open the downloaded HTML offline → narration plays, highlight still tracks. The
  `<audio>` is created at runtime by `mountAudio`, so grep the source URL, not a static tag:
  `grep -c 'data:audio/webm' openjam-*.html` → `1` (inside `#openjam-data`), and the opened
  report shows one `<audio>` under `#audio-section` whose `src` starts `data:audio/webm`.
- **Disconfirming:** record once with the toggle OFF → no Narration player,
  `report.audio` null, export has zero `<audio>` elements.

## Acceptance criteria

The full evidence-based AC set lives on issue #8 and in the design doc. Each task above ends in a green command; Tasks 1, 6, 7 are TDD (test fails first, then passes), Task 9 covers the toggle/offscreen/payload/export ACs with disconfirming checks, and the audio↔timeline playback highlight is the manual dogfood item (headless can't assert audible output — report it honestly).
