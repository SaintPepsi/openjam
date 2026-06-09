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
