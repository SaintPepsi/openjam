# `<oj-waveform>` Reusable Waveform View — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ExecutingPlans to implement this plan task-by-task.

**Goal:** Extract the replay's waveform into one vanilla custom element `<oj-waveform>` (a pure view: `samples` + `progress` in, `oj-seek` out) used by both the exported report and the landing page, replacing the duplicated peak extraction in `renderer.js` and the synthetic `WaveformPlayer` in `docs/index.html`.

**Architecture:** `waveform.js` at the repo root defines a classic-script-safe custom element whose `render()` is a pure function of `{samples, progress}`. It owns peak extraction, canvas drawing, and click→event — nothing about audio, the clock, or the timeline. `build.mjs` splices it into `docs/index.html` (like `install-cta.js`) and emits its source as a `WAVEFORM_JS` string constant; `report-builder.js` inlines that constant so the element is registered in the exported report before `mountReplay` runs. Each parent (replay renderer, landing page) keeps its own audio + clock and pushes `progress` per frame.

**Tech Stack:** Vanilla custom elements (no framework), Web Audio API (decode only, in the parents), esbuild + string-splice build (`build.mjs`), bun test (unit + single-source), Playwright (e2e).

**Design doc:** `docs/plans/2026-07-10-oj-waveform-component-design.md` — preserve its "Principles applied" decisions (UI=fn(state), Single Source of Truth, Separation of Concerns).

**Conventions to honor:**
- Classic-script-safe: no top-level `import`/`export`; guarded `module.exports` for bun; element defined only behind an `HTMLElement` check (see `install-cta.js:47-64`).
- Commits: **do not commit** unless Ian asks in the moment (project rule). The "Commit" steps below stage the work and stop; ask before running `git commit`.
- Full check: `npm test` = `npm run build` + `bun test test/` + `playwright test` (root `CLAUDE.md`).

---

### Task 1: Pure `extractPeaks` in `waveform.js`

**Files:**
- Create: `waveform.js`
- Test: `test/waveform.test.js`

**Step 1: Write the failing test**

```js
// test/waveform.test.js
import { test, expect } from "bun:test";
import { extractPeaks } from "../waveform.js";

test("extractPeaks normalizes the loudest bar to 1", () => {
  // 8 samples, 4 bars → 2 samples/bar. Bar 2 holds the loudest sample (0.5).
  const s = new Float32Array([0.1, -0.1, 0.2, -0.2, 0.5, 0.0, 0.25, -0.25]);
  const peaks = extractPeaks(s, 4);
  expect(peaks.length).toBe(4);
  expect(Math.max(...peaks)).toBeCloseTo(1, 5); // loudest bar normalized to 1
  expect(peaks[2]).toBeCloseTo(1, 5);           // bar 2 is the loudest
  expect(peaks[0]).toBeCloseTo(0.1 / 0.5, 5);   // 0.2 relative to peak 0.5... see note
});

test("silence yields all-zero peaks (disconfirming: no divide-by-zero spike)", () => {
  const peaks = extractPeaks(new Float32Array(16), 8);
  expect(peaks.length).toBe(8);
  expect(peaks.every((p) => p === 0)).toBe(true);
});

test("a single spike lights exactly one bar", () => {
  const s = new Float32Array(12); // 12 samples, 6 bars → 2/bar
  s[0] = 0.9;                     // spike in bar 0
  const peaks = extractPeaks(s, 6);
  expect(peaks[0]).toBeCloseTo(1, 5);
  expect(peaks.slice(1).every((p) => p === 0)).toBe(true);
});
```

Note: bar 0 max is `max(|0.1|,|−0.1|)=0.1`; normalized `0.1/0.5=0.2`. Fix the first test's last assertion to `expect(peaks[0]).toBeCloseTo(0.2, 5)`.

**Step 2: Run test to verify it fails**

Run: `bun test test/waveform.test.js`
Expected: FAIL — `Cannot find module "../waveform.js"` / `extractPeaks is not a function`.

**Step 3: Write minimal implementation**

```js
// waveform.js
/* ============================================================================
 * <oj-waveform> — the OpenJam audio waveform view.
 * ----------------------------------------------------------------------------
 * One source of truth for the waveform: peak extraction + canvas render + a
 * click→seek event. A PURE VIEW — ui = fn({samples, progress}). It owns nothing
 * about audio playback, the clock, or the timeline; each parent (the replay
 * renderer, the landing page) keeps its own audio + clock and pushes `progress`.
 *
 * Spliced into docs/index.html by build.mjs and inlined into the exported report
 * by report-builder.js (see waveform.js's WAVEFORM_JS constant). Classic-script
 * safe: no top-level import/export; pure logic exported for bun via a guarded
 * module.exports; the element defined only where a DOM exists.
 * ========================================================================== */

// Pure: (Float32Array channel data, bar count) -> normalized peaks[] in 0..1.
// The single home for the algorithm that used to be copied in renderer.js and
// the landing page. Silence → all zeros (no divide-by-zero: we normalize only
// when there's signal).
function extractPeaks(samples, bars) {
  var n = Math.max(1, bars | 0);
  var peaks = new Array(n).fill(0);
  if (!samples || !samples.length) return peaks;
  var block = Math.floor(samples.length / n) || 1;
  var mx = 0;
  for (var i = 0; i < n; i++) {
    var start = i * block, pk = 0;
    for (var j = 0; j < block; j++) {
      var v = Math.abs(samples[start + j] || 0);
      if (v > pk) pk = v;
    }
    peaks[i] = pk;
    if (pk > mx) mx = pk;
  }
  if (mx > 0) for (var k = 0; k < n; k++) peaks[k] /= mx;
  return peaks;
}

// Guarded CJS export for bun tests; invisible to the browser (module undefined).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractPeaks };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/waveform.test.js`
Expected: PASS (3 tests). If bar-0 assertion still uses `0.1/0.5`, correct it to `0.2` per the note.

**Step 5: Commit (stage only — ask Ian before committing)**

```bash
git add waveform.js test/waveform.test.js
# then ASK before: git commit -m "feat(waveform): pure extractPeaks with unit tests"
```

---

### Task 2: The `<oj-waveform>` element (canvas render + oj-seek)

**Files:**
- Modify: `waveform.js`

DOM behavior is verified by e2e (Task 8), not bun — the repo tests elements through their pure logic only (`install-cta.js` unit-tests `pickBrowser`, never the element).

**Step 1: Add the element below `extractPeaks`, above the `module.exports` block**

```js
// Element defined only where a DOM exists (bun test imports this file with no
// DOM — the guard keeps extractPeaks importable without an HTMLElement shim).
if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class OjWaveform extends HTMLElement {
    static extractPeaks(samples, bars) { return extractPeaks(samples, bars); }

    connectedCallback() {
      if (this._canvas) return;
      this.style.display = this.style.display || "block";
      this.style.position = "relative";
      this._canvas = document.createElement("canvas");
      this._canvas.style.width = "100%";
      this._canvas.style.height = "100%";
      this._canvas.style.display = "block";
      this.appendChild(this._canvas);
      this._ctx = this._canvas.getContext("2d");
      this._progress = this._progress || 0;
      // click → seek: emit the fraction; the PARENT maps it to time and acts.
      this.addEventListener("click", (e) => {
        var r = this._canvas.getBoundingClientRect();
        var frac = r.width ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0;
        this.dispatchEvent(new CustomEvent("oj-seek", { detail: { fraction: frac }, bubbles: true }));
      });
      if (typeof ResizeObserver !== "undefined") {
        this._ro = new ResizeObserver(() => { this._peaks = null; this.render(); });
        this._ro.observe(this);
      }
      this.render();
    }
    disconnectedCallback() { if (this._ro) { this._ro.disconnect(); this._ro = null; } }

    set samples(v) { this._samples = v; this._peaks = null; this.render(); }
    get samples() { return this._samples; }
    set progress(v) { this._progress = Math.max(0, Math.min(1, +v || 0)); this.render(); }
    get progress() { return this._progress; }

    _barCount() {
      // width/3 clamped 60..600 — the replay's rule (renderer.js:288), now shared.
      var w = this.clientWidth || 600;
      return Math.max(60, Math.min(600, Math.floor(w / 3)));
    }
    _colors() {
      var cs = getComputedStyle(this);
      return {
        played: cs.getPropertyValue("--accent").trim() || "#6ea8fe",
        // no token consumer for the unplayed shade today; literal, as renderer.js:343.
        unplayed: "#3b414d",
      };
    }
    // Pure fn of (this._samples, this._progress, size): same inputs → same pixels.
    render() {
      if (!this._ctx || !this._canvas) return;
      var dpr = window.devicePixelRatio || 1;
      var cw = Math.round((this.clientWidth || 600) * dpr);
      var chh = Math.round((this.clientHeight || 44) * dpr);
      if (this._canvas.width !== cw || this._canvas.height !== chh) { this._canvas.width = cw; this._canvas.height = chh; }
      var ctx = this._ctx;
      ctx.clearRect(0, 0, cw, chh);
      if (!this._samples) return; // fail-open: no data → empty strip
      if (!this._peaks) this._peaks = extractPeaks(this._samples, this._barCount());
      var c = this._colors();
      var peaks = this._peaks, n = peaks.length, barW = cw / n, mid = chh / 2, playX = (this._progress || 0) * cw;
      for (var i = 0; i < n; i++) {
        var x = i * barW;
        var h = Math.max(dpr, peaks[i] * chh * 0.85);
        ctx.fillStyle = x < playX ? c.played : c.unplayed;
        ctx.fillRect(x, mid - h / 2, Math.max(dpr, barW - dpr), h);
      }
    }
  }
  if (!customElements.get("oj-waveform")) customElements.define("oj-waveform", OjWaveform);
}
```

**Step 2: Verify it still imports cleanly in bun (no DOM regression)**

Run: `bun test test/waveform.test.js`
Expected: PASS — the `HTMLElement` guard means the element block is skipped under bun; `extractPeaks` still exports.

**Step 3: Commit (stage only — ask Ian)**

```bash
git add waveform.js
# ASK before: git commit -m "feat(waveform): oj-waveform pure-view element (samples/progress in, oj-seek out)"
```

---

### Task 3: Splice into the landing page + emit `WAVEFORM_JS` for the report

**Files:**
- Modify: `build.mjs:63-68` (add a third splice + the generated constant)
- Modify: `docs/index.html` (add markers where the script goes)

**Step 1: Add markers to `docs/index.html`**

Immediately after the `install-cta` script block (near `docs/index.html:838`, after the `<!-- install-cta:end -->` marker and its `</script>`), add:

```html
<!-- oj-waveform:start -->
<!-- oj-waveform:end -->
```

(An empty region; `build.mjs` fills it. Placed before the page's own behavior `<script>` at line ~912 so the element is defined before the landing glue runs.)

**Step 2: Extend `build.mjs`**

After the install-cta splice (`build.mjs:66`), add:

```js
const WAVE_START = "<!-- oj-waveform:start -->";
const WAVE_END = "<!-- oj-waveform:end -->";
const waveformSrc = readFileSync("waveform.js", "utf8");
const waveJs = waveformSrc.replace(/<\/script/gi, "<\\/script");
landing = splice(landing, WAVE_START, WAVE_END, "\n<script>\n" + waveJs + "\n</script>\n", "docs/index.html (oj-waveform)");
```

Update the final `writeFileSync("docs/index.html", landing)` (unchanged) and the console log (`build.mjs:68`) to mention oj-waveform.

Then, where `build.mjs` writes `src/generated/player-assets.js` (`build.mjs:115-120`), add `WAVEFORM_JS` to the emitted file so the report can inline the same source:

```js
writeFileSync(
  "src/generated/player-assets.js",
  "// Generated by build.mjs — do not edit. Engine: @rrweb/replay@2.0.1.\n" +
    "export const ENGINE_IIFE = " + JSON.stringify(engine) + ";\n" +
    "export const ENGINE_CSS = " + JSON.stringify(engineCss) + ";\n" +
    "export const WAVEFORM_JS = " + JSON.stringify(waveformSrc) + ";\n",
);
```

**Step 3: Run the build and verify the splice landed**

Run: `node build.mjs && grep -c "class OjWaveform" docs/index.html`
Expected: prints `1` (exactly one spliced copy). Also: `grep -c "WAVEFORM_JS" src/generated/player-assets.js` → `1`.

**Step 4: Commit (stage only — ask Ian)**

```bash
git add build.mjs docs/index.html src/generated/player-assets.js
# ASK before: git commit -m "build(waveform): splice oj-waveform into landing + emit WAVEFORM_JS"
```

---

### Task 4: Single-source guard test

**Files:**
- Modify: `test/popup-source-of-truth.test.js`

**Step 1: Add a failing test mirroring the install-cta guard (`test/popup-source-of-truth.test.js:81-88`)**

```js
const WAVE_START = "<!-- oj-waveform:start -->";
const WAVE_END = "<!-- oj-waveform:end -->";

test("oj-waveform is spliced from one source, no hand-pasted copy", () => {
  const html = read("docs/index.html");
  expect(html).toContain(WAVE_START);
  expect(html).toContain(WAVE_END);
  expect(html.match(/class OjWaveform\b/g)?.length ?? 0).toBe(1);
  expect(read("waveform.js").match(/class OjWaveform\b/g)?.length ?? 0).toBe(1);
});
```

**Step 2: Run the test**

Run: `bun test test/popup-source-of-truth.test.js`
Expected: PASS (the `beforeAll(() => build())` already rebuilds so the region is populated).

**Step 3: Commit (stage only — ask Ian)**

```bash
git add test/popup-source-of-truth.test.js
# ASK before: git commit -m "test(waveform): single-source guard for spliced oj-waveform"
```

---

### Task 5: Inline the element into the exported report

**Files:**
- Modify: `report-builder.js:17` (import) and `:59-78` (inline before mountReplay + standalone audio)

**Step 1: Import the generated source**

At `report-builder.js:17`, alongside the renderer import, add:

```js
import { WAVEFORM_JS } from "./src/generated/player-assets.js";
```

**Step 2: Inline it before the `mountReplay` script**

The report neutralises `</script>` already (`report-builder.js:37`). `WAVEFORM_JS` is the raw source; neutralise it the same way and inline it before `${mountReplay.toString()}` (inside the `hasReplay` branch, `report-builder.js:61`). Add a `hasWaveAudio` flag and a shared inlined block:

```js
const hasWaveAudio = hasAudio; // both replay and standalone narration draw a waveform
const waveformJs = hasWaveAudio ? WAVEFORM_JS.replace(/<\/script/gi, "<\\/script") : "";
```

Then emit `${hasWaveAudio ? `<script>${waveformJs}</script>` : ""}` once, before both the replay `<script>` (`:61`) and the standalone-audio `<script>` (`:74`), so `<oj-waveform>` is registered wherever a parent creates one.

**Step 3: Verify a built report registers the element**

Run: `npm run build` then generate a report fixture and grep. Minimal check:
`node -e "import('./report-builder.js').then(async m => { const html = m.buildReportHTML({audio:{dataUrl:'data:audio/webm;base64,AA==',startWall:0,durationMs:1000}, rrwebEvents:[]}, null); console.log(/customElements.define\(.oj-waveform./.test(html)); })"`
Expected: prints `true`.

**Step 4: Commit (stage only — ask Ian)**

```bash
git add report-builder.js
# ASK before: git commit -m "build(report): inline oj-waveform so exported reports register it"
```

---

### Task 6: Replace `drawWave` in the replay renderer

**Files:**
- Modify: `renderer.js:190` (state vars), `:247-315` (create element + extraction), `:316-351` (delete `drawWave`), `:402-415` (`paint()` pushes progress)

This converts the replay strip from a timeline view to a clip view (design doc "Behavior Change"): bars fill the strip = the narration clip; the scrub bar above stays the full-timeline control; the tail tick is dropped.

**Step 1: Replace the waveform-creation block (`renderer.js:247-256`)**

Swap the `waveWrap`/`wave` canvas construction for the element, keeping the `.oj-waveform` wrapper (its CSS at `renderer.js:125` stays for sizing/border):

```js
// Waveform in its own strip UNDER the scrub bar (only when there's audio): the
// shared <oj-waveform> view. It owns extraction + drawing; the renderer owns the
// clock and pushes `progress`. Click emits oj-seek → we map the clip fraction back
// to timeline ms and seek.
waveWrap = el("div", "oj-waveform");
var waveEl = document.createElement("oj-waveform");
waveEl.style.position = "absolute"; waveEl.style.inset = "0";
var waveTip = el("div", "oj-hover-time");
waveWrap.appendChild(waveEl);
waveWrap.appendChild(waveTip);
player.appendChild(waveWrap);
waveEl.addEventListener("oj-seek", function (e) {
  var clipStart = audioStart - replayStart;
  var clipDur = audioBuf ? Math.round(audioBuf.duration * 1000) : (report.audio.durationMs || 0);
  finished = false;
  seek(clipStart + e.detail.fraction * clipDur);
  paint();
});
waveWrap.addEventListener("mousemove", function (e) {
  var rect = waveWrap.getBoundingClientRect();
  var x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  // hover still reads the full timeline (the strip spans the clip; tip shows clip time)
  var clipStart = audioStart - replayStart;
  var clipDur = audioBuf ? Math.round(audioBuf.duration * 1000) : (report.audio.durationMs || 0);
  waveTip.textContent = fmt(clipStart + (x / rect.width) * clipDur);
  waveTip.style.left = x + "px";
});
```

Remove the now-unused `wave`, `peaks`, `hasWave`, `waveColors` declarations at `renderer.js:190` (keep `waveWrap`), and add `var waveEl = null;` there.

**Step 2: Feed `samples` on decode; drop the inline peak loop (`renderer.js:288-299`)**

In the `decodeAudioData` success callback, replace the peak-extraction loop and `hasWave = true` with:

```js
audioBuf = buf;
duration = Math.max(total, audioStart - replayStart + Math.round(buf.duration * 1000));
if (waveEl) waveEl.samples = buf.getChannelData(0); // element extracts + draws
```

Keep the diag lines (`oj-diag-decoded` / `oj-diag-gap`) and `if (!playing) paint();`.

**Step 3: Delete `drawWave` entirely (`renderer.js:316-351`)**

Remove the whole `function drawWave(frac) { ... }`.

**Step 4: In `paint()`, push clip-relative progress instead of `drawWave(frac)` (`renderer.js:410`)**

Replace `drawWave(frac);` with:

```js
if (waveEl && audioBuf) {
  var clipStart = audioStart - replayStart;
  var clipDur = Math.round(audioBuf.duration * 1000);
  waveEl.progress = clipDur ? Math.max(0, Math.min(1, (t - clipStart) / clipDur)) : 0;
}
```

(`t` is `curTime()`, already computed at `renderer.js:406`. This is the same relationship `syncAudio` uses at `renderer.js:379`.)

**Step 5: Build + drive the replay to confirm the waveform advances and seeks**

Run: `npm run build`
Then use the `verify`/`run` skill to open a report with narration in the viewer and confirm: (a) bars render, (b) the playhead colour advances while playing, (c) clicking the strip seeks audio + replay together.
Expected: all three observed. If Web Audio is unavailable, the strip is empty and silent (fail-open, unchanged).

**Step 6: Commit (stage only — ask Ian)**

```bash
git add renderer.js
# ASK before: git commit -m "refactor(replay): draw the waveform via shared oj-waveform, drop duplicated extraction"
```

---

### Task 7: Replace the synthetic `WaveformPlayer` on the landing page

**Files:**
- Modify: `docs/index.html` markup (`:315-323`), the behavior `<script>` (`WaveformPlayer` `:958-1156` + call `:1160`), CSS (`:121-139`)

Source edits go in `docs/index.html` directly here (the landing behavior script is hand-authored, not spliced — only the `<oj-waveform>` definition is spliced).

**Step 1: Swap the markup (`docs/index.html:322`)**

Replace `<div class="wave" id="shiftWave" role="img" aria-label="Narration waveform"></div>` with:

```html
<oj-waveform id="shiftWave" role="img" aria-label="Narration waveform" style="display:block;position:relative;height:52px;background:var(--bg);border:1px solid var(--line);border-radius:8px;overflow:hidden"></oj-waveform>
```

**Step 2: Delete `WaveformPlayer` and its call; add a small clip player**

Delete the `function WaveformPlayer(opts){ ... }` (`:958-1156`) and the `WaveformPlayer({...})` call (`:1160`). In their place (inside the same IIFE, before its closing `})();` at `:1161`), add a minimal clip player that decodes the mp3 once, drives `progress`, and handles `oj-seek`:

```js
// Narrated-repro easter egg: play the real GTA clip through the SAME <oj-waveform>
// the report uses. The element shows the shape + playhead; this glue owns the
// audio + clock (ui = fn(state)). No synth — the marketing page demoes the real thing.
(function () {
  var waveEl = document.getElementById("shiftWave");
  var btn = document.getElementById("shiftPlay");
  if (!waveEl || !btn) return;
  var audio = new Audio("ah-shit-here-we-go-again.mp3");
  audio.preload = "auto";
  var raf = 0;
  var playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" class="ic-play"><path d="M7 5l13 7-13 7z" fill="currentColor"/></svg>';
  var stopIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';

  // Decode once for the shape (fail-open: no Web Audio → static empty strip, audio still plays).
  var AC = window.AudioContext || window.webkitAudioContext;
  if (AC && window.fetch) {
    fetch("ah-shit-here-we-go-again.mp3").then(function (r) { return r.arrayBuffer(); })
      .then(function (b) { return new AC().decodeAudioData(b); })
      .then(function (buf) { waveEl.samples = buf.getChannelData(0); })
      .catch(function () {});
  }
  function frame() {
    waveEl.progress = audio.duration ? audio.currentTime / audio.duration : 0;
    if (!audio.paused && !audio.ended) raf = requestAnimationFrame(frame);
  }
  function stop() { audio.pause(); cancelAnimationFrame(raf); waveEl.progress = 0; btn.innerHTML = playIcon; btn.setAttribute("aria-label", "Play the narrated repro"); }
  audio.addEventListener("ended", stop);
  waveEl.addEventListener("oj-seek", function (e) { audio.currentTime = e.detail.fraction * (audio.duration || 0); waveEl.progress = e.detail.fraction; });
  btn.addEventListener("click", function () {
    if (audio.paused) { audio.currentTime = 0; audio.play(); btn.innerHTML = stopIcon; btn.setAttribute("aria-label", "Stop the narrated repro"); raf = requestAnimationFrame(frame); }
    else stop();
  });
})();
```

**Step 3: Remove now-dead synth CSS (`docs/index.html:131-139`)**

Delete the `.wave`, `.wave .bar`, `.wave .bar.on`, `.wave .ph`, `.caption`, `.caption .w*` rules — the DOM bars and caption are gone. Keep `.narr`, `.narr-head`, `.play`, `.narr-label`, `.narr-tag` (still used by the play button + label). Update the comment at `:121`.

**Step 4: Build + eyeball the landing page**

Run: `npm run build`
Then open `docs/index.html` (use the `run`/`verify` skill) and confirm: the narrated-repro card shows a real waveform of the clip, the play button plays the mp3, the playhead advances, and clicking the strip seeks. `grep -c "WaveformPlayer" docs/index.html` → `0`.

**Step 5: Commit (stage only — ask Ian)**

```bash
git add docs/index.html
# ASK before: git commit -m "feat(landing): narrated-repro uses the real oj-waveform, drop synth WaveformPlayer"
```

---

### Task 8: Update e2e + full green

**Files:**
- Modify: `e2e/landing-page-structure.spec.mjs` (the narrated-repro assertions)
- Verify: whole suite

**Step 1: Update the landing structure spec**

Where the spec asserts the narrated-repro block (it currently expects `#shiftWave` and possibly `.wave .bar`), change it to assert an `<oj-waveform id="shiftWave">` is present with a `<canvas>` child, and that clicking `#shiftPlay` starts playback (aria-label flips to the stop label). Remove any assertion on synthetic `.bar` spans.

Run: `npx playwright test e2e/landing-page-structure.spec.mjs`
Expected: PASS. Fix selectors until green.

**Step 2: Run the whole suite**

Run: `npm test`
Expected: build succeeds; `bun test test/` passes (incl. `waveform.test.js` + the single-source guard); all Playwright specs pass.

**Step 3: Regenerate screenshots if the visual spec flags a diff**

If the landing/report visual spec diffs on the new canvas waveform, regenerate the baselines the same way the repo already does (recent commits `chore(screenshots): regenerate popup + viewer shots`), and confirm the new shots show the real waveform.

**Step 4: Final commit (stage only — ask Ian)**

```bash
git add e2e/ test/ && git status
# ASK before committing. Ian handles commits on openjam.
```

---

## Verification checklist (acceptance criteria — command + expected output)

- `bun test test/waveform.test.js` → 3 pass (incl. silence → all-zero, single spike → one bar).
- `grep -c "class OjWaveform" docs/index.html` → `1` (one spliced copy).
- `bun test test/popup-source-of-truth.test.js` → single-source guard passes.
- Built report: `node -e` snippet in Task 5 → prints `true` (`oj-waveform` registered).
- `grep -c "WaveformPlayer" docs/index.html` → `0` (synth deleted).
- `grep -c "function drawWave" renderer.js` → `0` (duplicated extraction gone).
- `npm test` → build + bun + Playwright all green.
- Hand-driven (Tasks 6/7 via `run`/`verify`): playhead advances while playing and a strip click seeks, on both the report and the landing page.

## Principles applied (from the design doc)

- **UI = fn(state)** — `render()` is pure over `{samples, progress}`; the element emits `oj-seek` and mutates nothing external.
- **Single Source of Truth** — one `extractPeaks` (Task 1) replaces the two copies (`renderer.js:288-298`, `docs/index.html:1014-1021`); one authored `waveform.js` spliced/inlined everywhere, guarded by the Task 4 test.
- **Separation of Concerns** — element = view; each parent = audio + clock + timeline. The renderer keeps the one clock (Task 6).
- **No false-sharing** — timeline offset + tail tick stay in the replay parent, not pushed into the generic element.
