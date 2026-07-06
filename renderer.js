// Shared report renderer. `renderReport` is intentionally self-contained — it
// references only browser globals and nests all its helpers — so it can be both
// imported (live preview in viewer.js) AND embedded verbatim into the exported
// standalone file via Function.prototype.toString().

export const REPORT_CSS = `
:root{--bg:#0f1115;--panel:#171a21;--panel2:#1d212b;--line:#2a2f3a;--fg:#e6e9ef;--muted:#8b93a3;--accent:#6ea8fe;--green:#3fb950;--orange:#d29922;--red:#f85149;--blue:#58a6ff;--violet:#bc8cff}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{padding:18px 22px;border-bottom:1px solid var(--line);background:var(--panel)}
header h1{margin:0 0 4px;font-size:18px}
header .sub{color:var(--muted);font-size:13px}
.meta{display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:10px;font-size:12px;color:var(--muted)}
.meta b{color:var(--fg);font-weight:600}
details.device{margin:0;border-bottom:1px solid var(--line);background:var(--panel)}
details.device summary{padding:10px 22px;cursor:pointer;color:var(--muted);user-select:none}
.device-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px 24px;padding:12px 22px 16px;font-size:12px}
.device-grid div{overflow:hidden;text-overflow:ellipsis}
.device-grid span{color:var(--muted)}
.toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 22px;background:var(--panel2);border-bottom:1px solid var(--line)}
.toolbar input[type=search]{flex:1;min-width:160px;background:var(--bg);border:1px solid var(--line);color:var(--fg);padding:6px 10px;border-radius:6px}
.filters{display:flex;gap:8px;flex-wrap:wrap}
.filter{border:1px solid var(--line);background:var(--bg);color:var(--muted);padding:5px 10px;border-radius:999px;cursor:pointer;font-size:12px}
.filter.on{color:var(--fg);border-color:var(--accent)}
.filter .count{opacity:.7;margin-left:4px}
.timeline{padding:8px 0 40px}
.row{display:grid;grid-template-columns:84px 70px 1fr;gap:10px;padding:7px 22px;border-bottom:1px solid #1c1f27;cursor:pointer;align-items:baseline}
.row:hover{background:#141823}
.row .time{color:var(--muted);font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap}
.badge{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 6px;border-radius:4px;text-align:center;align-self:start}
.b-console{background:#22303f;color:var(--blue)}
.b-network{background:#2b2440;color:var(--violet)}
.b-error{background:#3a1f23;color:var(--red)}
.b-log{background:#26303a;color:var(--muted)}
.b-screenshot{background:#1f3a2a;color:var(--green)}
.summary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.row.lvl-error .summary,.row.lvl-warning .summary{white-space:normal}
.row.oj-audio-active{background:#1d2b45;box-shadow:inset 3px 0 0 #6ea8fe}
.lvl-error .summary{color:var(--red)}
.lvl-warning .summary{color:var(--orange)}
.status{font-weight:700}
.s2{color:var(--green)}.s3{color:var(--blue)}.s4{color:var(--orange)}.s5{color:var(--red)}.sfail{color:var(--red)}
.detail{grid-column:1/-1;margin-top:8px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:pre-wrap;word-break:break-word;cursor:auto}
.detail h4{margin:10px 0 4px;font-family:-apple-system,sans-serif;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.detail h4:first-child{margin-top:0}
.kv{color:var(--muted)}
.detail img{max-width:100%;border:1px solid var(--line);border-radius:6px;margin-top:4px}
.empty{padding:40px 22px;text-align:center;color:var(--muted)}
`;

export const REPLAY_CSS = `
#replay-section{border-bottom:1px solid #2a2f3a;background:#171a21;padding:14px 22px}
#replay-section h2{margin:0 0 10px;font-size:13px;color:#8b93a3;text-transform:uppercase;letter-spacing:.05em}
#replay{display:flex;justify-content:center}
.oj-player{max-width:1024px;width:100%}
.oj-stage{position:relative;overflow:hidden;background:#fff;border-radius:8px 8px 0 0;border:1px solid #2a2f3a;border-bottom:0}
.oj-stage .replayer-wrapper{transform-origin:0 0;position:absolute;left:0;top:0}
.oj-stage iframe{border:0;pointer-events:none}
.oj-controls{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#1d212b;border:1px solid #2a2f3a;border-radius:0 0 8px 8px}
.oj-controls button{background:#2a2f3a;color:#e6e9ef;border:0;border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer}
.oj-controls button.oj-on{background:#6ea8fe;color:#0b0d12}
.oj-progress{flex:1;height:8px;background:#0f1115;border-radius:4px;cursor:pointer;position:relative}
.oj-progress-fill{height:100%;width:0;background:#6ea8fe;border-radius:4px;pointer-events:none}
.oj-time{color:#8b93a3;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.oj-hover-time{position:absolute;bottom:calc(100% + 6px);transform:translateX(-50%);display:none;background:#0b0d12;border:1px solid #2a2f3a;color:#e6e9ef;font-size:11px;padding:2px 6px;border-radius:4px;white-space:nowrap;font-variant-numeric:tabular-nums;z-index:2}
.oj-progress:hover .oj-hover-time,.oj-waveform:hover .oj-hover-time{display:block}
.oj-vol{width:72px;accent-color:#6ea8fe;cursor:pointer}
.oj-controls button.oj-icon{padding:6px 9px}
.oj-waveform{position:relative;margin-top:8px;height:44px;background:#0f1115;border:1px solid #2a2f3a;border-radius:6px;overflow:hidden;cursor:pointer}
.oj-waveform .oj-hover-time{bottom:auto;top:6px}
.oj-wave{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
`;

// Mounts a session-replay player: @rrweb/replay's Replayer (the engine) plus a
// minimal controller UI. rrweb-player@2.x dist builds are broken (they never
// construct their Replayer), so OpenJam drives the engine directly.
// Self-contained like renderReport so the export can embed it via toString.
// Mount into a VISIBLE container — hidden containers measure 0x0.
export function mountReplay(container, report, ReplayerCtor) {
  var events = report.rrwebEvents || [];
  if (!ReplayerCtor || events.length < 2) return null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmt(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  var vw = (report.device && report.device.viewport) || {};
  var pageW = vw.width || 1024;
  var pageH = vw.height || 576;
  var player = el("div", "oj-player");
  var stage = el("div", "oj-stage");
  var controls = el("div", "oj-controls");
  var playBtn = el("button", null, "▶ Play");
  var progress = el("div", "oj-progress");
  var fill = el("div", "oj-progress-fill");
  var time = el("div", "oj-time", "0:00 / 0:00");
  var hoverTip = el("div", "oj-hover-time");
  progress.appendChild(fill);
  progress.appendChild(hoverTip);
  controls.appendChild(playBtn);
  controls.appendChild(progress);
  controls.appendChild(time);
  player.appendChild(stage);
  player.appendChild(controls);
  container.appendChild(player);

  var replayer = new ReplayerCtor(events, { root: stage, speed: 1 });
  var total = replayer.getMetaData().totalTime;
  var totalEl = document.getElementById("oj-diag-total");
  if (totalEl) totalEl.textContent = Math.round(total) + " ms";
  var playing = false;
  var finished = false;
  var rafId = null;

  // Narration plays the DECODED audio buffer through Web Audio
  // (AudioBufferSourceNode), NOT an <audio> element: MediaRecorder webm/opus
  // blobs have no reliable duration and aren't seekable, so the element drifts,
  // but a decoded buffer seeks sample-accurately via start(0, offset). Both
  // clocks are Date.now epoch ms: a timeline offset maps to a wall time
  // (replayStart + t), and the audio position is that wall minus the audio's
  // own start.
  var replayStart = (events[0] && events[0].timestamp) || 0;
  var audioStart = report.audio && report.audio.startWall != null ? report.audio.startWall : 0;
  var audioCtx = null, audioBuf = null, gainNode = null, srcNode = null;
  var audioVol = 1, audioMuted = false, audioPlaying = false;
  var srcStartCtx = 0, srcStartOffset = 0, curSpeed = 1;
  var wave = null, peaks = null, hasWave = false, waveWrap = null;

  // ONE timeline spanning the LONGER of the replay and the narration window —
  // you usually keep talking after the screen stops changing, and that tail
  // must stay reachable. Inside the replay the replayer is the clock; past its
  // end the replay holds its last frame and a wall clock runs out the tail.
  var duration = total;
  if (report.audio && report.audio.dataUrl && report.audio.durationMs) {
    duration = Math.max(total, audioStart - replayStart + report.audio.durationMs);
  }
  var tailAt = null; // non-null = position (ms) in the narration tail past the replay
  var tailWall = 0;
  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }
  function curTime() {
    if (tailAt == null) return Math.min(replayer.getCurrentTime(), total);
    if (playing) {
      var n = now();
      tailAt = Math.min(tailAt + (n - tailWall) * curSpeed, duration);
      tailWall = n;
    }
    return tailAt;
  }
  function seek(t) {
    t = Math.max(0, Math.min(t, duration));
    if (t < total) {
      tailAt = null;
      if (playing) replayer.play(t);
      else replayer.pause(t);
    } else {
      replayer.pause(total); // hold the final frame
      tailAt = t;
      tailWall = now();
    }
  }
  if (report.audio && report.audio.dataUrl) {
    // Volume / mute — routed through the GainNode (see startSrc).
    var muteBtn = el("button", "oj-icon", "🔊");
    muteBtn.title = "Mute narration";
    var vol = document.createElement("input");
    vol.type = "range"; vol.min = "0"; vol.max = "1"; vol.step = "0.05"; vol.value = "1";
    vol.className = "oj-vol"; vol.title = "Volume";
    var applyGain = function () {
      if (gainNode) gainNode.gain.value = audioMuted ? 0 : audioVol;
      muteBtn.textContent = audioMuted ? "🔇" : "🔊";
    };
    muteBtn.addEventListener("click", function () {
      audioMuted = !audioMuted;
      // unmuting with the slider at 0 would still be silent — restore volume
      if (!audioMuted && audioVol === 0) { audioVol = 1; vol.value = "1"; }
      applyGain();
    });
    vol.addEventListener("input", function () { audioVol = Number(vol.value); audioMuted = audioVol === 0; applyGain(); });
    controls.appendChild(muteBtn);
    controls.appendChild(vol);

    // Waveform in its own strip UNDER the scrub bar (only when there's audio): a
    // visible cue narration exists, plus a second seek surface. The scrub bar above
    // stays the primary control, unchanged.
    waveWrap = el("div", "oj-waveform");
    wave = document.createElement("canvas");
    wave.className = "oj-wave";
    var waveTip = el("div", "oj-hover-time");
    waveWrap.appendChild(wave);
    waveWrap.appendChild(waveTip);
    player.appendChild(waveWrap);
    waveWrap.addEventListener("click", function (e) {
      var rect = waveWrap.getBoundingClientRect();
      finished = false;
      seek(((e.clientX - rect.left) / rect.width) * duration);
      paint();
    });
    waveWrap.addEventListener("mousemove", function (e) {
      var rect = waveWrap.getBoundingClientRect();
      var x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      waveTip.textContent = fmt((x / rect.width) * duration);
      waveTip.style.left = x + "px";
    });

    // Decode the track once — it feeds BOTH the waveform peaks and playback.
    // Fail-open: if Web Audio is unavailable, the strip stays empty and silent.
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      try {
        audioCtx = new AC();
        gainNode = audioCtx.createGain();
        gainNode.gain.value = 1;
        gainNode.connect(audioCtx.destination);
        var comma = report.audio.dataUrl.indexOf(",");
        var bin = atob(report.audio.dataUrl.slice(comma + 1));
        var raw = new Uint8Array(bin.length);
        for (var bi = 0; bi < bin.length; bi++) raw[bi] = bin.charCodeAt(bi);
        audioCtx.decodeAudioData(raw.buffer, function (buf) {
          audioBuf = buf;
          // The decoded length is the audible truth (the wall durationMs also
          // counts encoder stop-latency) — refit the timeline to it.
          duration = Math.max(total, audioStart - replayStart + Math.round(buf.duration * 1000));
          var n = Math.max(60, Math.min(600, Math.floor((waveWrap.clientWidth || 600) / 3)));
          var ch = buf.getChannelData(0);
          var block = Math.floor(ch.length / n) || 1;
          peaks = new Array(n);
          var mx = 0.0001;
          for (var p = 0; p < n; p++) {
            var s = p * block, pk = 0;
            for (var q = 0; q < block; q++) { var v = Math.abs(ch[s + q] || 0); if (v > pk) pk = v; }
            peaks[p] = pk; if (pk > mx) mx = pk;
          }
          for (var r = 0; r < n; r++) peaks[r] /= mx;
          hasWave = true;
          var decodedMs = Math.round(buf.duration * 1000);
          var dEl = document.getElementById("oj-diag-decoded");
          if (dEl) dEl.textContent = decodedMs + " ms";
          var gEl = document.getElementById("oj-diag-gap");
          if (gEl && report.audio && report.audio.durationMs != null) gEl.textContent = report.audio.durationMs - decodedMs + " ms";
          if (!playing) paint(); // repaint at the refitted duration; a running loop picks it up next frame
        }, function () {
          // a decode failure is exactly what this panel diagnoses — say so
          var dEl = document.getElementById("oj-diag-decoded");
          if (dEl) dEl.textContent = "decode failed";
          var gEl = document.getElementById("oj-diag-gap");
          if (gEl) gEl.textContent = "—";
        });
      } catch (e) {}
    }
  }
  function drawWave(frac) {
    if (!hasWave || !wave || !peaks || !waveWrap) return;
    var dpr = window.devicePixelRatio || 1;
    var cw = Math.round((waveWrap.clientWidth || 600) * dpr);
    var chh = Math.round((waveWrap.clientHeight || 44) * dpr);
    if (wave.width !== cw || wave.height !== chh) { wave.width = cw; wave.height = chh; }
    var ctx = wave.getContext("2d");
    ctx.clearRect(0, 0, cw, chh);
    // The strip IS the timeline (0..duration), so the wave is drawn at the
    // narration's true offset and scale on it — playhead, scrub bar and wave
    // share one axis instead of the wave silently stretching to fit.
    var audioMs = audioBuf ? audioBuf.duration * 1000 : report.audio.durationMs || 0;
    var x0 = duration ? ((audioStart - replayStart) / duration) * cw : 0;
    var span = duration ? (audioMs / duration) * cw : cw;
    var n = peaks.length, barW = span / n, mid = chh / 2, playX = frac * cw;
    for (var i = 0; i < n; i++) {
      var x = x0 + i * barW;
      if (x + barW < 0 || x > cw) continue;
      var h = Math.max(dpr, peaks[i] * chh * 0.85);
      ctx.fillStyle = x < playX ? "#6ea8fe" : "#3b414d";
      ctx.fillRect(x, mid - h / 2, Math.max(dpr, barW - dpr), h);
    }
    if (duration > total) {
      // tick where on-screen activity ends and narration-only tail begins
      ctx.fillStyle = "#8b93a3";
      ctx.fillRect((total / duration) * cw, 0, dpr, chh);
    }
  }
  function stopSrc() {
    if (srcNode) { try { srcNode.onended = null; srcNode.stop(); } catch (e) {} srcNode = null; }
    audioPlaying = false;
  }
  function startSrc(offsetSec) {
    stopSrc();
    if (!audioCtx || !audioBuf || offsetSec < 0 || offsetSec >= audioBuf.duration) return;
    if (audioCtx.state === "suspended" && audioCtx.resume) audioCtx.resume();
    srcNode = audioCtx.createBufferSource();
    srcNode.buffer = audioBuf;
    srcNode.playbackRate.value = curSpeed;
    srcNode.connect(gainNode);
    srcNode.onended = function () { audioPlaying = false; };
    srcStartCtx = audioCtx.currentTime;
    srcStartOffset = offsetSec;
    srcNode.start(0, offsetSec);
    audioPlaying = true;
  }
  // Where playback currently is, in track seconds (advances at ctx rate × speed).
  function srcOffset() {
    return audioPlaying ? srcStartOffset + (audioCtx.currentTime - srcStartCtx) * curSpeed : srcStartOffset;
  }
  // Narration position = fn(timeline clock). Web Audio plays accurately once
  // started at the right offset, so we only (re)start on entering the window or
  // when the timeline jumps away from where the buffer is (a seek / speed change).
  function syncAudio(tMs) {
    if (!audioBuf) return;
    var want = (replayStart + tMs - audioStart) / 1000;
    var inWindow = playing && want >= 0 && want < audioBuf.duration;
    if (!inWindow) { if (audioPlaying) stopSrc(); return; }
    if (!audioPlaying) { startSrc(want); return; }
    if (Math.abs(srcOffset() - want) > 0.15) startSrc(want);
  }
  function highlightRow(wall) {
    var rows = document.querySelectorAll("#app .timeline .row");
    var pick = null;
    for (var i = 0; i < rows.length; i++) {
      if (Number(rows[i].dataset.t) <= wall) pick = rows[i]; else break;
    }
    for (var j = 0; j < rows.length; j++) rows[j].classList.remove("oj-audio-active");
    if (pick) pick.classList.add("oj-audio-active");
  }

  // Scale the recorded viewport to fit the stage width.
  var stageW = Math.min(player.clientWidth || 1024, 1024);
  var scale = Math.min(1, stageW / pageW);
  stage.style.height = Math.round(pageH * scale) + "px";
  var wrapper = stage.querySelector(".replayer-wrapper");
  if (wrapper) wrapper.style.transform = "scale(" + scale + ")";

  function paint() {
    // paint() is also called synchronously by seek handlers — cancel any pending
    // frame first or every scrub while playing would stack an extra loop.
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    var t = curTime();
    if (playing && t >= duration) { finished = true; setPlaying(false); t = duration; }
    var frac = duration ? t / duration : 0;
    fill.style.width = frac * 100 + "%";
    drawWave(frac);
    time.textContent = fmt(t) + " / " + fmt(duration);
    highlightRow(replayStart + t);
    syncAudio(t);
    if (playing) rafId = requestAnimationFrame(paint);
  }
  function setPlaying(on) {
    playing = on;
    playBtn.textContent = on ? "❚❚ Pause" : finished ? "↺ Replay" : "▶ Play";
    if (rafId) cancelAnimationFrame(rafId);
    if (!on) stopSrc();
    if (on) rafId = requestAnimationFrame(paint);
  }

  playBtn.addEventListener("click", function () {
    if (playing) {
      if (tailAt == null) replayer.pause();
      setPlaying(false);
      return;
    }
    var from = finished ? 0 : curTime();
    if (from >= duration) from = 0;
    finished = false;
    playing = true; // before seek(): it consults this to play vs pause the replayer
    seek(from);
    setPlaying(true);
  });
  progress.addEventListener("click", function (e) {
    var rect = progress.getBoundingClientRect();
    finished = false;
    seek(((e.clientX - rect.left) / rect.width) * duration);
    paint();
  });
  progress.addEventListener("mousemove", function (e) {
    var rect = progress.getBoundingClientRect();
    var x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    hoverTip.textContent = fmt((x / rect.width) * duration);
    hoverTip.style.left = x + "px";
  });
  [1, 2, 4, 8].forEach(function (speed) {
    var btn = el("button", speed === 1 ? "oj-on" : null, speed + "x");
    btn.addEventListener("click", function () {
      controls.querySelectorAll("button.oj-on").forEach(function (b) {
        if (b !== playBtn) b.classList.remove("oj-on");
      });
      btn.classList.add("oj-on");
      var t = curTime();
      curSpeed = speed;
      replayer.setConfig({ speed: speed });
      if (playing) { seek(t); startSrc((replayStart + t - audioStart) / 1000); }
    });
    controls.appendChild(btn);
  });
  replayer.on("finish", function () {
    if (duration > total) {
      // narration outlasts the replay: hold the last frame and enter the tail
      // (even if paused this exact tick — Play must resume the tail, not restart)
      if (tailAt == null) { tailAt = total; tailWall = now(); }
      if (!playing) paint();
      return;
    }
    finished = true;
    setPlaying(false);
    paint();
  });

  replayer.pause(0); // render the first frame without starting playback
  paint();
  return replayer;
}

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

export function renderReport(container, report) {
  var events = (report.events || []).slice().sort(function (a, b) { return a.t - b.t; });
  var meta = report.meta || {};
  var device = report.device || {};
  var KINDS = ["console", "network", "error", "log", "screenshot"];
  var active = { console: true, network: true, error: true, log: true, screenshot: true };
  var query = "";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function relTime(ms) {
    if (ms == null) return "";
    if (ms < 1000) return "+" + Math.round(ms) + "ms";
    return "+" + (ms / 1000).toFixed(2) + "s";
  }
  function bytes(n) {
    if (n == null) return "";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(2) + " MB";
  }
  function kv(parent, label, value) {
    if (value == null || value === "") return;
    var d = el("div");
    d.appendChild(el("span", "kv", label + ": "));
    d.appendChild(document.createTextNode(String(value)));
    parent.appendChild(d);
  }
  function section(parent, title) { parent.appendChild(el("h4", null, title)); }
  function headerBlock(parent, title, obj) {
    if (!obj || !Object.keys(obj).length) return;
    section(parent, title);
    Object.keys(obj).forEach(function (k) { parent.appendChild(el("div", null, k + ": " + obj[k])); });
  }
  function statusClass(s) { if (s == null) return "sfail"; return "s" + String(s)[0]; }

  // ---- header ----
  var header = el("header");
  header.appendChild(el("h1", null, "OpenJam Report"));
  header.appendChild(el("div", "sub", meta.pageTitle || ""));
  var metaRow = el("div", "meta");
  function metaItem(label, val) {
    var d = el("div");
    d.appendChild(el("b", null, label + " "));
    d.appendChild(document.createTextNode(val));
    metaRow.appendChild(d);
  }
  metaItem("URL", meta.pageUrl || "—");
  metaItem("Captured", meta.capturedAt ? new Date(meta.capturedAt).toLocaleString() : "—");
  metaItem("Duration", ((meta.durationMs || 0) / 1000).toFixed(1) + "s");
  metaItem("Events", String(meta.eventCount != null ? meta.eventCount : events.length));
  header.appendChild(metaRow);
  container.appendChild(header);

  // ---- device ----
  var dev = el("details", "device");
  dev.appendChild(el("summary", null, "Device & environment"));
  var grid = el("div", "device-grid");
  var screen = device.screen || {};
  var viewport = device.viewport || {};
  var devRows = [
    ["User agent", device.userAgent],
    ["Platform", device.platform],
    ["Vendor", device.vendor],
    ["Language", (device.languages || [device.language]).filter(Boolean).join(", ")],
    ["Timezone", device.timezone],
    ["Viewport", viewport.width ? viewport.width + " × " + viewport.height : null],
    ["Screen", screen.width ? screen.width + " × " + screen.height + " @" + (screen.dpr || 1) + "x" : null],
    ["Color depth", screen.colorDepth ? screen.colorDepth + "-bit" : null],
    ["Cookies enabled", device.cookieEnabled == null ? null : String(device.cookieEnabled)],
    ["Online", device.online == null ? null : String(device.online)],
    ["Referrer", device.referrer],
    ["JS heap used", device.memory ? Math.round(device.memory.usedJSHeapSize / 1048576) + " MB" : null],
  ];
  devRows.forEach(function (r) {
    if (r[1] == null || r[1] === "") return;
    var d = el("div");
    d.appendChild(el("span", null, r[0] + ": "));
    d.appendChild(document.createTextNode(String(r[1])));
    grid.appendChild(d);
  });
  dev.appendChild(grid);
  container.appendChild(dev);

  // ---- audio sync diagnostics (only when a track exists) ----
  // Surfaces both clocks so a real recording can be diagnosed. The audio position
  // is mapped as (rrwebStart + replayTime) − audioStart, so what matters is how the
  // audio startWall relates to the rrweb start, and whether the DECODED duration
  // matches the wall duration — a gap means capture latency shifted sample 0.
  if (report.audio) {
    var a = report.audio;
    var rrEvents = report.rrwebEvents || [];
    var rr0 = rrEvents.length ? rrEvents[0].timestamp : null;
    var rrLast = rrEvents.length ? rrEvents[rrEvents.length - 1].timestamp : null;
    var iso = function (ms) { try { return new Date(ms).toISOString(); } catch (e) { return String(ms); } };
    var diag = el("details", "device");
    diag.appendChild(el("summary", null, "Audio sync diagnostics"));
    var dgrid = el("div", "device-grid");
    var drow = function (label, val, id) {
      var d = el("div");
      d.appendChild(el("span", null, label + ": "));
      var v = document.createTextNode(val == null ? "" : String(val));
      if (id) { var s = el("b", null, val == null ? "" : String(val)); s.id = id; d.appendChild(s); }
      else d.appendChild(v);
      dgrid.appendChild(d);
    };
    drow("Recording started (capturedAt)", meta.capturedAt != null ? meta.capturedAt + " · " + iso(meta.capturedAt) : "—");
    drow("rrweb first event", rr0 != null ? rr0 + " · " + iso(rr0) : "none");
    drow("rrweb last event", rrLast != null ? rrLast + " · " + iso(rrLast) : "none");
    drow("rrweb span (last − first)", rr0 != null && rrLast != null ? rrLast - rr0 + " ms" : "—");
    drow("audio startWall", a.startWall != null ? a.startWall + " · " + iso(a.startWall) : "—");
    drow("audio duration (wall)", a.durationMs != null ? a.durationMs + " ms" : "—");
    drow("audio start − rrweb start", a.startWall != null && rr0 != null ? a.startWall - rr0 + " ms" : "—");
    drow("audio start − capturedAt", a.startWall != null && meta.capturedAt != null ? a.startWall - meta.capturedAt + " ms" : "—");
    drow("audio duration (decoded)", "decoding…", "oj-diag-decoded");
    drow("wall − decoded gap", "…", "oj-diag-gap");
    drow("replayer totalTime", "…", "oj-diag-total");
    diag.appendChild(dgrid);
    container.appendChild(diag);
  }

  // ---- toolbar ----
  var toolbar = el("div", "toolbar");
  var filters = el("div", "filters");
  toolbar.appendChild(filters);
  var search = el("input");
  search.type = "search";
  search.placeholder = "Search events…";
  search.addEventListener("input", function (e) { query = e.target.value.toLowerCase(); render(); });
  toolbar.appendChild(search);
  container.appendChild(toolbar);

  var tl = el("div", "timeline");
  container.appendChild(tl);

  function buildSummary(ev) {
    var wrap = el("div", "summary");
    if (ev.kind === "network") {
      var d = ev.detail || {};
      var st = el("span", "status " + statusClass(d.status), d.failed ? "ERR" : (d.status != null ? String(d.status) : "…"));
      wrap.appendChild(st);
      wrap.appendChild(document.createTextNode(" " + d.method + " " + d.url));
      if (d.durationMs != null) wrap.appendChild(document.createTextNode("  (" + d.durationMs + "ms" + (d.encodedBytes ? ", " + bytes(d.encodedBytes) : "") + ")"));
    } else {
      wrap.textContent = ev.title;
    }
    return wrap;
  }

  function buildDetail(ev) {
    var d = el("div", "detail");
    var det = ev.detail || {};
    if (ev.kind === "network") {
      kv(d, "URL", det.url);
      kv(d, "Method", det.method);
      kv(d, "Status", (det.status != null ? det.status : "") + " " + (det.statusText || ""));
      kv(d, "Type", det.resourceType);
      kv(d, "Duration", det.durationMs != null ? det.durationMs + " ms" : "");
      kv(d, "Size", bytes(det.encodedBytes));
      kv(d, "Remote", det.remoteAddress);
      if (det.failed) kv(d, "Error", det.errorText);
      headerBlock(d, "Request headers", det.requestHeaders);
      if (det.requestBody) { section(d, "Request body"); d.appendChild(el("div", null, det.requestBody)); }
      headerBlock(d, "Response headers", det.responseHeaders);
      if (det.responseBody) {
        section(d, "Response body");
        var body = det.responseBody;
        try { body = JSON.stringify(JSON.parse(det.responseBody), null, 2); } catch (e) {}
        d.appendChild(el("div", null, body));
      }
    } else if (ev.kind === "screenshot") {
      if (det.image) {
        var img = document.createElement("img");
        img.src = det.image;
        d.appendChild(img);
      } else {
        kv(d, "Error", det.error);
      }
    } else {
      d.appendChild(el("div", null, det.message || ev.title));
      if (det.url) kv(d, "Source", det.url + (det.line ? ":" + det.line : ""));
      if (det.stack && det.stack.length) {
        section(d, "Stack");
        det.stack.forEach(function (line) { d.appendChild(el("div", null, line)); });
      }
    }
    return d;
  }

  function matches(ev) {
    if (!active[ev.kind]) return false;
    if (!query) return true;
    var hay = (ev.title + " " + JSON.stringify(ev.detail || {})).toLowerCase();
    return hay.indexOf(query) !== -1;
  }

  function render() {
    tl.textContent = "";
    var shown = 0;
    events.forEach(function (ev) {
      if (!matches(ev)) return;
      shown++;
      var row = el("div", "row " + (ev.level ? "lvl-" + ev.level : ""));
      row.dataset.t = String(ev.t);
      row.appendChild(el("div", "time", relTime(ev.rel != null ? ev.rel : ev.t - (meta.capturedAt || 0))));
      row.appendChild(el("div", "badge b-" + ev.kind, ev.kind));
      row.appendChild(buildSummary(ev));
      var open = false;
      var detailNode = null;
      row.addEventListener("click", function (e) {
        if (e.target.closest(".detail")) return;
        open = !open;
        if (open) { detailNode = buildDetail(ev); row.appendChild(detailNode); }
        else if (detailNode) { row.removeChild(detailNode); }
      });
      tl.appendChild(row);
    });
    if (!shown) tl.appendChild(el("div", "empty", "No events match the current filter."));
  }

  KINDS.forEach(function (k) {
    var n = events.filter(function (e) { return e.kind === k; }).length;
    var btn = el("button", "filter on");
    btn.appendChild(document.createTextNode(k));
    btn.appendChild(el("span", "count", "(" + n + ")"));
    btn.addEventListener("click", function () {
      active[k] = !active[k];
      btn.classList.toggle("on", active[k]);
      render();
    });
    filters.appendChild(btn);
  });

  render();
}
