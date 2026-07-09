/* ============================================================================
 * <openjam-popup> — shared OpenJam popup component
 * ----------------------------------------------------------------------------
 * One source of truth for the OpenJam recording popup, used in BOTH:
 *   1. The marketing landing page  (attribute: demo tilt)
 *   2. The actual Chrome extension  (popup.html — driven by popup.js)
 *
 * Vanilla custom element. No framework, no build step, no remote code — safe
 * for an MV3 extension. Styles live in Shadow DOM so nothing leaks in or out.
 *
 * It only renders features OpenJam actually has:
 *   • Start recording  ↔  Stop & open report
 *   • Mic narration    → a toggle that reveals the microphone device list
 *   • A live mic-level meter shown only while recording with audio on
 *   • Status (Idle / Recording + event count) and a hint line
 *
 * ── Using it in the extension (popup.html) ──────────────────────────────────
 *   <openjam-popup id="oj"></openjam-popup>
 *   <script src="openjam-popup.js"></script>
 *   <script type="module" src="popup.js"></script>
 *
 * ── Wiring it from popup.js ─────────────────────────────────────────────────
 *   const oj = document.getElementById('oj');
 *   const send = (action, extra) => chrome.runtime.sendMessage({ action, ...extra });
 *
 *   oj.addEventListener('oj-toggle', async () => {
 *     const s = await send('getStatus');
 *     if (s.recording) { const r = await send('stop'); if (r.ok) window.close(); else oj.showError(r.error); }
 *     else { const r = await send('start', { tabId }); if (!r.ok) oj.showError(r.error); }
 *     oj.setStatus(await send('getStatus'));
 *   });
 *   oj.addEventListener('oj-mic-toggle',  e => saveAudio({ enabled: e.detail.enabled }));
 *   oj.addEventListener('oj-mic-change',  e => saveAudio({ deviceId: e.detail.deviceId }));
 *
 *   // Poll status like the current popup does:
 *   setInterval(async () => oj.setStatus(await send('getStatus')), 1000);
 *   // While recording with audio, push the analyser level so the meter is live:
 *   //   oj.setMicLevel(rms);   // rms in 0..1
 *
 * ── Public API ──────────────────────────────────────────────────────────────
 *   .recording (bool)                 get/set recording state
 *   .setStatus({ recording, eventCount })
 *   .setMicLevel(v)                   0..1 — drives the live meter
 *   .setMics([{id,label}], selectedId)
 *   .showError(msg) / .showWarning(msg) / .clearNotices()
 *   attributes: recording, mic, demo, tilt
 *   events (bubbling, composed): oj-toggle, oj-mic-toggle{enabled}, oj-mic-change{deviceId}
 * ========================================================================== */
(function () {
  "use strict";
  if (customElements.get("openjam-popup")) return;

  var TPL = document.createElement("template");
  TPL.innerHTML = [
    "<style>",
    ":host{",
    /* tokens:start */
    "  --bg:#0f1115; --bg2:#0b0d12; --panel:#171a21; --panel2:#1d212b;",
    "  --line:#2a2f3a; --line-soft:#212632;",
    "  --fg:#e6e9ef; --muted:#8b93a3; --dim:#5b6472;",
    "  --accent:#6ea8fe; --accent2:#58a6ff; --blue:var(--accent2); --accent-ink:#0b0d12;",
    "  --green:#3fb950; --gold:#d29922; --orange:var(--gold); --terra:#d97757;",
    "  --red:#f85149; --violet:#bc8cff; --audio:#1d2b45;",
    /* tokens:end */
    "  --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,Roboto,sans-serif;",
    "  --mono:ui-monospace,'SF Mono',SFMono-Regular,'Cascadia Code',Menlo,Consolas,monospace;",
    "  display:block; color:var(--fg); font-family:var(--sans);",
    "}",
    /* 3D wrapper (only tilts when [tilt] is set) */
    ".stage{perspective:1400px}",
    ":host([tilt]) .stage{animation:oj-float 6.5s ease-in-out infinite}",
    "@keyframes oj-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}",
    ".card{",
    "  transform-style:preserve-3d; transform:rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));",
    "  background:linear-gradient(180deg,#1b1f28,#141821); border:1px solid #303747;",
    "  border-radius:16px; padding:13px; box-shadow:0 30px 70px -30px rgba(0,0,0,.85), 0 1px 0 rgba(255,255,255,.06) inset;",
    "}",
    /* header */
    ".head{display:flex; align-items:center; gap:8px; padding:3px 5px 12px}",
    ".fruit{font-size:13px; white-space:nowrap; flex:0 0 auto; margin-right:3px}",
    ".name{font-weight:700; font-size:14px; letter-spacing:-.01em}",
    ".status{margin-left:auto; display:flex; align-items:center; gap:6px; font-family:var(--mono); font-size:10.5px; letter-spacing:.04em; color:var(--muted)}",
    ".dot{width:7px; height:7px; border-radius:50%; background:var(--dim); flex:0 0 auto}",
    ":host([recording]) .dot{background:var(--red); box-shadow:0 0 0 0 rgba(248,81,73,.5); animation:oj-pulse 2s ease-out infinite}",
    ":host([recording]) .st-lbl{color:var(--red)}",
    "@keyframes oj-pulse{0%{box-shadow:0 0 0 0 rgba(248,81,73,.5)}70%{box-shadow:0 0 0 7px rgba(248,81,73,0)}100%{box-shadow:0 0 0 0 rgba(248,81,73,0)}}",
    ".st-meta{color:var(--dim)}",
    /* rows */
    ".row{display:flex; align-items:center; gap:11px; width:100%; text-align:left; box-sizing:border-box;",
    "  background:var(--bg); border:1px solid var(--line); border-radius:11px; padding:12px 13px; margin-bottom:8px;",
    "  color:var(--fg); font-size:14px; font-weight:600; font-family:var(--sans); cursor:pointer;",
    "  transition:border-color .16s ease, background .16s ease, transform .1s ease}",
    ".row:not(.primary):hover{border-color:#3a4252; background:#141922}",
    ".row .ic{width:18px; height:18px; flex:0 0 auto; display:grid; place-items:center}",
    ".ic svg{width:16px; height:16px; stroke:var(--accent); stroke-width:2; fill:none; stroke-linecap:round; stroke-linejoin:round}",
    ".row.primary{background:var(--accent); color:var(--accent-ink); border-color:transparent; justify-content:center; font-weight:700}",
    ".row.primary .ic svg{stroke:var(--accent-ink)}",
    ".row.primary:hover{background:#8bbcff}",
    ":host([recording]) .row.primary{background:var(--red); color:#fff}",
    ":host([recording]) .row.primary .ic svg{stroke:#fff}",
    ":host([recording]) .row.primary:hover{background:#ff6b63}",
    ".dotr{width:9px; height:9px; border-radius:50%; background:currentColor}",
    /* mic block */
    ".mic{display:block; padding:0; border:1px solid var(--line); border-radius:11px; overflow:hidden; margin-bottom:8px; background:var(--bg); cursor:default}",
    ":host([mic]) .mic{background:var(--audio); border-color:transparent; box-shadow:inset 3px 0 0 var(--accent)}",
    ".mic-head{display:flex; align-items:center; gap:11px; padding:12px 13px; cursor:pointer}",
    ".mic-head .ic svg{stroke:var(--muted)}",
    ":host([mic]) .mic-head .ic svg{stroke:var(--accent)}",
    ".mic-lbl{font-size:14px; font-weight:600}",
    ".mic-sub{display:block; font-family:var(--mono); font-size:10.5px; font-weight:500; color:var(--dim); margin-top:2px; letter-spacing:.02em}",
    /* switch */
    ".sw{margin-left:auto; width:36px; height:21px; border-radius:999px; background:#2a2f3a; position:relative; flex:0 0 auto; transition:background .18s ease}",
    ".sw::after{content:''; position:absolute; top:2px; left:2px; width:17px; height:17px; border-radius:50%; background:#8b93a3; transition:transform .18s ease, background .18s ease}",
    ":host([mic]) .sw{background:var(--accent)}",
    ":host([mic]) .sw::after{transform:translateX(15px); background:#0b0d12}",
    /* mic body (list + meter) collapses when off */
    ".mic-body{max-height:0; opacity:0; transition:max-height .24s ease, opacity .2s ease; padding:0 13px}",
    ":host([mic]) .mic-body{max-height:120px; opacity:1; padding-bottom:12px}",
    "select{width:100%; box-sizing:border-box; background:var(--bg); color:var(--fg); border:1px solid var(--line);",
    "  border-radius:8px; padding:7px 9px; font-size:12.5px; font-family:var(--sans); margin-bottom:4px}",
    /* meter (live mic level) + label on one compact row — only while recording */
    ".meter-row{display:none; align-items:center; gap:9px; padding-top:2px}",
    ":host([recording][mic]) .meter-row{display:flex}",
    ".meter{flex:1 1 auto; min-width:0; display:flex; align-items:center; gap:2px; height:22px; padding:0 1px}",
    ".meter .bar{flex:1 1 0; min-width:2px; border-radius:2px; background:var(--accent); transform:scaleY(.12); transform-origin:center; opacity:.9}",
    ".meter-hint{font-family:var(--mono); font-size:10px; color:var(--accent); letter-spacing:.04em; white-space:nowrap; flex:0 0 auto}",
    ".meter-hint::before{content:'\\25CF '}",
    ":host([recording][mic]) .mic-body{max-height:150px}",
    /* notices */
    ".notice{font-size:11.5px; border-radius:8px; padding:8px 10px; margin-top:2px; font-weight:600; line-height:1.4}",
    ".err{border:1px solid var(--red); background:rgba(248,81,73,.15); color:#ff7b72}",
    ".warn{border:1px solid var(--gold); background:rgba(210,153,34,.15); color:#e3b341}",
    ".hint{color:var(--muted); font-size:11.5px; line-height:1.5; padding:4px 5px 2px}",
    ".hint a{color:var(--accent)}",
    "[hidden]{display:none !important}",
    "@media (prefers-reduced-motion:reduce){",
    "  :host([tilt]) .stage{animation:none}",
    "  .card{transition:none} .dot{animation:none !important} .meter .bar{transition:none}",
    "}",
    "</style>",
    "<div class='stage'>",
    "  <div class='card' part='card'>",
    "    <div class='head'>",
    "      <span class='fruit' aria-hidden='true'>🍓🫐🍇🍒</span>",
    "      <span class='name'>OpenJam</span>",
    "      <span class='status'><span class='dot'></span><span class='st-lbl'>Idle</span><span class='st-meta'></span></span>",
    "    </div>",
    "    <button type='button' class='row primary' data-act='toggle'>",
    "      <span class='ic'><span class='dotr'></span></span><span class='t'>Start recording</span>",
    "    </button>",
    "    <div class='mic'>",
    "      <div class='mic-head' data-act='mic' role='switch' tabindex='0' aria-checked='false' aria-label='Mic narration'>",
    "        <span class='ic'><svg viewBox='0 0 24 24' aria-hidden='true'><rect x='9' y='3' width='6' height='11' rx='3'/><path d='M5 11a7 7 0 0 0 14 0M12 18v3'/></svg></span>",
    "        <span><span class='mic-lbl'>Mic narration</span><span class='mic-sub'>Off · talk through the bug</span></span>",
    "        <span class='sw' aria-hidden='true'></span>",
    "      </div>",
    "      <div class='mic-body'>",
    "        <select aria-label='Microphone'></select>",
    "        <div class='meter-row'>",
    "          <div class='meter' aria-hidden='true'></div>",
    "          <span class='meter-hint' hidden>listening…</span>",
    "        </div>",
    "      </div>",
    "    </div>",
    "    <div class='notice err' hidden></div>",
    "    <div class='notice warn' hidden></div>",
    "    <div class='hint'>Records console, network, errors &amp; a full session replay on the active tab.</div>",
    "  </div>",
    "</div>"
  ].join("");

  var METER_BARS = 40;

  class OpenJamPopup extends HTMLElement {
    static get observedAttributes() { return ["recording", "mic", "demo"]; }

    constructor() {
      super();
      this.attachShadow({ mode: "open" }).appendChild(TPL.content.cloneNode(true));
      this._levels = new Array(METER_BARS).fill(0);
      this._elapsed = 0;
      this._eventCount = 0;
      this._error = "";
      this._warning = "";
      this._raf = 0;
      this._reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    connectedCallback() {
      var r = this.shadowRoot;
      this._elToggle = r.querySelector("[data-act=toggle]");
      this._elToggleT = r.querySelector(".row.primary .t");
      this._elIcon = r.querySelector(".row.primary .ic");
      this._elMicHead = r.querySelector("[data-act=mic]");
      this._elMicSub = r.querySelector(".mic-sub");
      this._elSelect = r.querySelector("select");
      this._elMeter = r.querySelector(".meter");
      this._elMeterHint = r.querySelector(".meter-hint");
      this._elStLbl = r.querySelector(".st-lbl");
      this._elStMeta = r.querySelector(".st-meta");
      this._elErr = r.querySelector(".err");
      this._elWarn = r.querySelector(".warn");

      // build meter bars
      for (var i = 0; i < METER_BARS; i++) {
        var b = document.createElement("span");
        b.className = "bar";
        this._elMeter.appendChild(b);
      }
      this._bars = Array.prototype.slice.call(this._elMeter.querySelectorAll(".bar"));

      // interactions
      this._elToggle.addEventListener("click", () => this._onToggle());
      this._elMicHead.addEventListener("click", () => this._onMic());
      this._elMicHead.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); this._onMic(); }
      });
      this._elSelect.addEventListener("change", () => {
        this._emit("oj-mic-change", { deviceId: this._elSelect.value || null });
      });

      this._render();
      this._loop();

      if (this.hasAttribute("demo")) this._startDemo();
      if (this.hasAttribute("tilt")) this._startTilt();
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      cancelAnimationFrame(this._feedRaf);
      cancelAnimationFrame(this._tiltRaf);
      if (this._demoTimer) clearInterval(this._demoTimer);
      if (this._tiltHandler) window.removeEventListener("mousemove", this._tiltHandler);
    }

    attributeChangedCallback() { if (this._elToggle) this._render(); }

    /* ---------- public API ---------- */
    get recording() { return this.hasAttribute("recording"); }
    set recording(v) { v ? this.setAttribute("recording", "") : this.removeAttribute("recording"); }
    get micEnabled() { return this.hasAttribute("mic"); }
    set micEnabled(v) { v ? this.setAttribute("mic", "") : this.removeAttribute("mic"); }

    setStatus(s) {
      s = s || {};
      if ("recording" in s) this.recording = !!s.recording;
      if ("eventCount" in s && s.eventCount != null) this._eventCount = s.eventCount;
      if (this._elToggle) this._elToggle.disabled = false; // round-trip settled: release the re-entrancy guard
      this._render();
    }

    // 0..1 level from the host's real mic analyser
    setMicLevel(v) {
      v = Math.max(0, Math.min(1, +v || 0));
      this._levels.push(v); if (this._levels.length > METER_BARS) this._levels.shift();
    }

    setMics(list, selectedId) {
      this._elSelect.innerHTML = "";
      (list || []).forEach((m) => {
        var o = document.createElement("option");
        o.value = m.id != null ? m.id : m.deviceId;
        o.textContent = m.label || "Microphone";
        if (o.value === selectedId) o.selected = true;
        this._elSelect.appendChild(o);
      });
    }

    showError(msg) { this._error = msg || ""; this._render(); }
    showWarning(msg) { this._warning = msg || ""; this._render(); }
    clearNotices() { this._error = ""; this._warning = ""; this._render(); }

    /* ---------- internals ---------- */
    _emit(name, detail) {
      this.dispatchEvent(new CustomEvent(name, { detail: detail || {}, bubbles: true, composed: true }));
    }

    _onToggle() {
      // Re-entrancy guard: ignore a second toggle while a start/stop round-trip
      // is in flight. The button's disabled state IS the flag; setStatus clears
      // it once the host's round-trip settles. Demo has no host, so it clears
      // synchronously below.
      if (this._elToggle.disabled) return;
      this._elToggle.disabled = true;
      // In live mode the host flips state (via setStatus after chrome round-trip).
      // In demo mode we own the state.
      this._emit("oj-toggle", { recording: !this.recording });
      if (this.hasAttribute("demo")) { this._demoToggle(); this._elToggle.disabled = false; }
    }

    _onMic() {
      var next = !this.micEnabled;
      this.micEnabled = next;
      this._render();
      this._emit("oj-mic-toggle", { enabled: next });
      if (this.hasAttribute("demo")) this._demoMic(next);
    }

    // ui = fn(state): the single place that writes display DOM. Every derived
    // value is read from component state here; handlers mutate state and call
    // _render, so what's shown can't drift from what's true.
    _render() {
      if (!this._elToggle) return;
      this._elMicHead.setAttribute("aria-checked", String(this.micEnabled));
      var rec = this.recording;
      this._elToggleT.textContent = rec ? "Stop & open report" : "Start recording";
      this._elIcon.innerHTML = rec
        ? "<svg viewBox='0 0 24 24' aria-hidden='true'><rect x='6' y='6' width='12' height='12' rx='2' fill='currentColor' stroke='none'/></svg>"
        : "<span class='dotr'></span>";
      this._elStLbl.textContent = rec ? "REC" : "Idle";
      // meta: demo shows a timer; live shows the event count
      if (rec) {
        this._elStMeta.textContent = this.hasAttribute("demo")
          ? this._fmt(this._elapsed)
          : (this._eventCount ? this._eventCount + " events" : "");
      } else {
        this._elStMeta.textContent = "";
      }
      this._elMicSub.textContent = this.micEnabled
        ? (rec ? "Recording your narration" : "On · talk through the bug")
        : "Off · talk through the bug";
      this._elMeterHint.hidden = !(rec && this.micEnabled);
      // notices: err carries HTML (issue link); warn is plain text. Hidden when empty.
      this._elErr.innerHTML = this._error || "";
      this._elErr.hidden = !this._error;
      this._elWarn.textContent = this._warning || "";
      this._elWarn.hidden = !this._warning;
    }

    _fmt(ms) {
      var s = Math.floor(ms / 1000), m = Math.floor(s / 60), ss = s % 60;
      return (m < 10 ? "0" : "") + m + ":" + (ss < 10 ? "0" : "") + ss;
    }

    _loop() {
      var render = () => {
        // The meter only shows while recording with mic on; skip the invisible
        // 40-bar repaint otherwise so an idle popup isn't working every frame.
        if (this.recording && this.micEnabled) {
          for (var i = 0; i < METER_BARS; i++) {
            var v = this._levels[i] || 0;
            this._bars[i].style.transform = "scaleY(" + (0.12 + v * 0.88).toFixed(3) + ")";
            this._bars[i].style.opacity = (0.45 + v * 0.55).toFixed(2);
          }
        }
        this._raf = requestAnimationFrame(render);
      };
      this._raf = requestAnimationFrame(render);
    }

    /* ---------- demo mode (marketing) ---------- */
    _startDemo() {
      this.recording = true;
      this.micEnabled = true;
      this.setMics([{ id: "default", label: "MacBook Pro Microphone" }, { id: "ext", label: "External USB Mic" }], "default");
      this._elapsed = 14000;
      this._render();
      // synthetic speech-cadence level feed for the meter (visual only)
      var t0 = performance.now();
      var feed = () => {
        var t = (performance.now() - t0) / 1000;
        var syll = Math.pow(Math.abs(Math.sin(t * 6.2)), 1.5);
        var phrase = 0.5 + 0.5 * Math.sin(t * 0.9 + 1);
        var gap = (Math.sin(t * 2.3) > 0.8) ? 0.1 : 1;
        var lvl = this.micEnabled && this.recording ? Math.max(0.05, syll * phrase * gap) : 0;
        this.setMicLevel(lvl);
        this._feedRaf = requestAnimationFrame(feed);
      };
      this._feedRaf = requestAnimationFrame(feed);
      // running REC timer
      this._demoTimer = setInterval(() => {
        if (this.recording) { this._elapsed += 1000; this._render(); }
      }, 1000);
    }

    _demoToggle() {
      if (!this.recording) { this._elapsed = 0; this._eventCount = 0; }
      this._render();
    }

    _demoMic(on) {
      // clear meter quickly when turned off
      if (!on) this._levels = new Array(METER_BARS).fill(0);
      this._render();
    }

    /* ---------- 3D tilt (marketing hero) ---------- */
    _startTilt() {
      if (this._reduce) { this.style.setProperty("--rx", "6deg"); this.style.setProperty("--ry", "-8deg"); return; }
      var card = this.shadowRoot.querySelector(".card");
      var hovering = false, tx = 6, ty = -8, cx = 6, cy = -8;
      this._tiltHandler = (e) => {
        var r = this.getBoundingClientRect();
        var px = (e.clientX - (r.left + r.width / 2)) / r.width;
        var py = (e.clientY - (r.top + r.height / 2)) / r.height;
        if (Math.abs(px) > 1.4 || Math.abs(py) > 1.4) { hovering = false; return; }
        tx = 6 - py * 12; ty = -8 + px * 16; hovering = true;
      };
      window.addEventListener("mousemove", this._tiltHandler, { passive: true });
      var loop = () => {
        var t = Date.now();
        var targetX = hovering ? tx : 6 + Math.sin(t / 1700) * 1.6;
        var targetY = hovering ? ty : -8 + Math.cos(t / 1500) * 1.6;
        cx += (targetX - cx) * 0.09; cy += (targetY - cy) * 0.09;
        card.style.setProperty("--rx", cx.toFixed(2) + "deg");
        card.style.setProperty("--ry", cy.toFixed(2) + "deg");
        this._tiltRaf = requestAnimationFrame(loop);
      };
      this._tiltRaf = requestAnimationFrame(loop);
    }
  }

  customElements.define("openjam-popup", OpenJamPopup);
})();
