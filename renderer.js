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
  progress.appendChild(fill);
  controls.appendChild(playBtn);
  controls.appendChild(progress);
  controls.appendChild(time);
  player.appendChild(stage);
  player.appendChild(controls);
  container.appendChild(player);

  var replayer = new ReplayerCtor(events, { root: stage, speed: 1 });
  var total = replayer.getMetaData().totalTime;
  var playing = false;
  var finished = false;
  var rafId = null;

  // Narration audio is driven entirely by the replay clock — there is no separate
  // audio player. Its position/rate follow the replayer, so play / pause / seek /
  // speed move both together. Both clocks are Date.now epoch ms: the replay offset
  // maps to a wall time (rrwebStart + getCurrentTime), and the audio position is
  // that wall minus the audio's own start, clamped to the track.
  var audio = null;
  var replayStart = (events[0] && events[0].timestamp) || 0;
  var audioStart = report.audio ? report.audio.startWall : 0;
  var audioDur = report.audio ? report.audio.durationMs : 0;
  if (report.audio && report.audio.dataUrl) {
    audio = document.createElement("audio");
    audio.src = report.audio.dataUrl;
    audio.preload = "auto";
    audio.style.display = "none";
    player.appendChild(audio);
  }
  function syncAudio() {
    if (!audio) return;
    var offsetMs = replayStart + Math.min(replayer.getCurrentTime(), total) - audioStart;
    if (!playing || offsetMs < 0 || offsetMs > audioDur) {
      if (!audio.paused) audio.pause(); // outside the narration window (or paused)
      return;
    }
    var want = offsetMs / 1000;
    if (Math.abs(audio.currentTime - want) > 0.3) { try { audio.currentTime = want; } catch (e) {} }
    if (audio.paused) audio.play().catch(function () {});
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
    var t = Math.min(replayer.getCurrentTime(), total);
    fill.style.width = (total ? (t / total) * 100 : 0) + "%";
    time.textContent = fmt(t) + " / " + fmt(total);
    highlightRow(replayStart + t);
    syncAudio();
    if (playing) rafId = requestAnimationFrame(paint);
  }
  function setPlaying(on) {
    playing = on;
    playBtn.textContent = on ? "❚❚ Pause" : finished ? "↺ Replay" : "▶ Play";
    if (rafId) cancelAnimationFrame(rafId);
    if (audio && !on) audio.pause();
    if (on) rafId = requestAnimationFrame(paint);
  }

  playBtn.addEventListener("click", function () {
    if (playing) {
      replayer.pause();
      setPlaying(false);
    } else {
      var from = finished ? 0 : replayer.getCurrentTime();
      finished = false;
      replayer.play(from >= total ? 0 : from);
      setPlaying(true);
    }
  });
  progress.addEventListener("click", function (e) {
    var rect = progress.getBoundingClientRect();
    var t = ((e.clientX - rect.left) / rect.width) * total;
    finished = false;
    if (playing) replayer.play(t);
    else replayer.pause(t);
    paint();
  });
  [1, 2, 4, 8].forEach(function (speed) {
    var btn = el("button", speed === 1 ? "oj-on" : null, speed + "x");
    btn.addEventListener("click", function () {
      controls.querySelectorAll("button.oj-on").forEach(function (b) {
        if (b !== playBtn) b.classList.remove("oj-on");
      });
      btn.classList.add("oj-on");
      var t = replayer.getCurrentTime();
      replayer.setConfig({ speed: speed });
      if (audio) audio.playbackRate = speed;
      if (playing) replayer.play(t);
    });
    controls.appendChild(btn);
  });
  replayer.on("finish", function () {
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
