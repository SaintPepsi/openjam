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

// Element defined only where a DOM exists (bun test imports this file with no
// DOM — the guard keeps extractPeaks importable without an HTMLElement shim).
if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class OjWaveform extends HTMLElement {
    connectedCallback() {
      if (!this._canvas) {
        // A custom element defaults to display:inline, which can't size a
        // 100%-height canvas child; force block. We do NOT set `position` — the
        // playhead is drawn on the canvas, so nothing inside needs a positioning
        // context, and writing it here would clobber a caller's own layout.
        this.style.display = this.style.display || "block";
        this._canvas = document.createElement("canvas");
        this._canvas.style.width = "100%";
        this._canvas.style.height = "100%";
        this._canvas.style.display = "block";
        this.appendChild(this._canvas);
        this._ctx = this._canvas.getContext("2d");
        this._progress = this._progress || 0;
        // click → seek: emit the fraction; the PARENT maps it to time and acts.
        // Bound to `this` (stable across reattach), so set once.
        this.addEventListener("click", (e) => {
          var r = this._canvas.getBoundingClientRect();
          var frac = r.width ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0;
          this.dispatchEvent(new CustomEvent("oj-seek", { detail: { fraction: frac }, bubbles: true }));
        });
        if (typeof ResizeObserver !== "undefined") {
          this._ro = new ResizeObserver(() => { this._measure(); this._peaks = null; this.render(); });
        }
      }
      if (this._ro) this._ro.observe(this); // re-observe on every (re)connect
      this.render();
    }
    disconnectedCallback() { if (this._ro) this._ro.disconnect(); } // keep the RO; just stop observing

    set samples(v) { this._samples = v; this._peaks = null; this.render(); }
    get samples() { return this._samples; }
    set progress(v) { this._progress = Math.max(0, Math.min(1, +v || 0)); this.render(); }
    get progress() { return this._progress; }

    // Cache the box size. Read once here (and on every resize via the
    // ResizeObserver) so render() never reads layout in the per-frame progress
    // path — reading clientWidth there forces a synchronous reflow each frame,
    // because the parent's scrub-bar write has already dirtied layout.
    _measure() { this._w = this.clientWidth || 600; this._h = this.clientHeight || 44; }
    _barCount() {
      // width/3 clamped 60..600 — the replay's rule (renderer.js:288), now shared.
      return Math.max(60, Math.min(600, Math.floor(this._w / 3)));
    }
    _colors() {
      if (!this._colorCache) {
        var cs = getComputedStyle(this);
        this._colorCache = {
          played: cs.getPropertyValue("--accent").trim(),
          unplayed: "#3b414d", // no token consumer for the unplayed shade today (renderer.js:343)
        };
      }
      return this._colorCache;
    }
    // Pure fn of (this._samples, this._progress, size): same inputs → same pixels.
    render() {
      if (!this._ctx || !this._canvas) return;
      if (this._w == null) this._measure(); // first paint before any resize event
      var dpr = window.devicePixelRatio || 1;
      var cw = Math.round(this._w * dpr);
      var chh = Math.round(this._h * dpr);
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

// Guarded CJS export for bun tests; invisible to the browser (module undefined).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractPeaks };
}
