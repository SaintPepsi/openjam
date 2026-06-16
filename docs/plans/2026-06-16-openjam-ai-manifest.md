# OpenJam AI Manifest Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ExecutingPlans to implement this plan task-by-task.

**Goal:** Embed a small, self-describing `#openjam-ai` manifest block in every exported OpenJam report so AI agents orient instantly and jump to failures by index, without parsing the multi-MB `#openjam-data` blob.

**Architecture:** A pure `buildManifest(report)` (new `manifest.js`) derives a legend + per-kind counts + a failure index (pointer + truncated error text) from the already-sorted `events[]`. Event kinds + legend live in a new `event-kinds.js` single source of truth, imported by `manifest.js` and `background.js`. `report-builder.js` orchestrates: it calls `buildManifest` and embeds the result as `<script id="openjam-ai">` *before* the unchanged `#openjam-data` block. Effectiveness is validated two ways: a **deterministic discoverability metric** in `bun test` (CI guardrail) and an **opt-in real-LLM A/B harness** under `eval/` that runs an agent over the report with vs. without the manifest and scores diagnosis correctness + effort.

**Tech Stack:** Plain ES modules (no TypeScript). Tests run under `bun test` (`bun:test`). Design doc: `docs/plans/2026-06-16-openjam-ai-manifest-design.md`.

**Design constraints carried into this plan:**
- Stay self-contained — everything lives inside the single exported HTML. No CLI/MCP/sidecar.
- Do NOT change the existing `#openjam-data` contract; the viewer reads it.
- `renderer.js` is serialized via `.toString()` into the HTML, so it **cannot** import `event-kinds.js` — its kind literals stay inline by necessity (documented deviation; `renderer.js` is not touched by this plan).
- `message` truncation cap = **500 chars** (resolves the design doc's open question).

---

### Task 1: Single source of truth for event kinds + legend

**Files:**
- Create: `event-kinds.js`
- Test: `test/event-kinds.test.js`

**Step 1: Write the failing test**

```js
// test/event-kinds.test.js
import { test, expect } from "bun:test";
import { KIND, KINDS, LEGEND } from "../event-kinds.js";

test("KINDS lists every kind the recorder emits", () => {
  expect([...KINDS].sort()).toEqual(["console", "error", "log", "network", "screenshot"]);
});

test("KIND values match KINDS", () => {
  expect(Object.values(KIND).sort()).toEqual([...KINDS].sort());
});

test("LEGEND documents every kind", () => {
  for (const k of KINDS) expect(typeof LEGEND[k]).toBe("string");
  expect(Object.keys(LEGEND).sort()).toEqual([...KINDS].sort());
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/event-kinds.test.js`
Expected: FAIL — cannot resolve `../event-kinds.js`.

**Step 3: Write minimal implementation**

```js
// event-kinds.js
// Single source of truth for OpenJam event kinds and their AI-facing legend.
// Imported by manifest.js (the legend) and background.js (the kind literals it emits).
// NOTE: renderer.js cannot import this — it is serialised via .toString() into the
// exported HTML, so its kind literals stay inline by necessity.

export const KIND = {
  NETWORK: "network",
  CONSOLE: "console",
  ERROR: "error",
  LOG: "log",
  SCREENSHOT: "screenshot",
};

export const KINDS = Object.values(KIND);

export const LEGEND = {
  network:
    "detail: method,url,status,statusText,requestHeaders,requestBody,responseHeaders,responseBody,durationMs,encodedBytes,failed,errorText",
  console: "detail: message,stack; level: log|info|warning|error|debug",
  error: "detail: message,url,line,column,stack",
  log: "detail: message,url,source",
  screenshot: "title labels the moment; detail: dataUrl or error",
};
```

**Step 4: Run test to verify it passes**

Run: `bun test test/event-kinds.test.js`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add event-kinds.js test/event-kinds.test.js
git commit -m "feat: add event-kinds.js as single source of truth for kinds + legend"
```

---

### Task 2: `buildManifest` — legend, counts, schema

**Files:**
- Create: `manifest.js`
- Test: `test/manifest.test.js`

**Step 1: Write the failing test**

```js
// test/manifest.test.js
import { test, expect } from "bun:test";
import { buildManifest } from "../manifest.js";

function report(events) {
  return { meta: {}, events };
}

test("counts events per kind and derives console.error", () => {
  const m = buildManifest(
    report([
      { t: 1, kind: "network", title: "GET /a", detail: { status: 200 } },
      { t: 2, kind: "console", level: "log", title: "hi", detail: { message: "hi" } },
      { t: 3, kind: "console", level: "error", title: "boom", detail: { message: "boom" } },
    ]),
  );
  expect(m.counts.network).toBe(1);
  expect(m.counts.console).toBe(2);
  expect(m.counts["console.error"]).toBe(1);
  expect(m.counts.error).toBe(0);
});

test("schema legend documents every kind", () => {
  const m = buildManifest(report([]));
  expect(Object.keys(m.schema).sort()).toEqual(["console", "error", "log", "network", "screenshot"]);
  expect(typeof m._doc).toBe("string");
});

test("empty report yields zeroed counts and no failures", () => {
  const m = buildManifest(report([]));
  expect(m.counts.network).toBe(0);
  expect(m.failures).toEqual([]);
});

test("tolerates a missing events array", () => {
  expect(() => buildManifest({})).not.toThrow();
  expect(buildManifest({}).failures).toEqual([]);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/manifest.test.js`
Expected: FAIL — cannot resolve `../manifest.js`.

**Step 3: Write minimal implementation**

```js
// manifest.js
// Pure builder: derives a small, self-describing index from a captured report so
// AI agents orient (#openjam-ai) without parsing the full #openjam-data blob.
import { KINDS, LEGEND } from "./event-kinds.js";

const DOC =
  "OpenJam capture. events[] in #openjam-data is sorted ascending by t (epoch ms). " +
  "Each event = {t,kind,title,detail}. Indices ('i') below point into that array. " +
  "Extract #openjam-data for full event detail.";

export function buildManifest(report) {
  const events = (report && report.events) || [];
  const counts = {};
  for (const k of KINDS) counts[k] = 0;
  let consoleErrors = 0;

  for (const e of events) {
    if (counts[e.kind] != null) counts[e.kind] += 1;
    if (e.kind === "console" && e.level === "error") consoleErrors += 1;
  }
  counts["console.error"] = consoleErrors;

  return { _doc: DOC, schema: LEGEND, counts, failures: [] };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/manifest.test.js`
Expected: PASS (4 tests). `failures` is empty for now — Task 3 fills it.

**Step 5: Commit**

```bash
git add manifest.js test/manifest.test.js
git commit -m "feat: buildManifest with legend, counts and schema"
```

---

### Task 3: `buildManifest` — failure index (pointer + error text)

**Files:**
- Modify: `manifest.js`
- Test: `test/manifest.test.js` (add cases)

**Step 1: Write the failing test (append to `test/manifest.test.js`)**

```js
test("indexes HTTP failures with status and response body as message", () => {
  const m = buildManifest(
    report([
      { t: 1, kind: "network", title: "GET /ok", detail: { status: 200 } },
      { t: 2, kind: "network", title: "PATCH /diaries/5", detail: { status: 400, responseBody: "Cannot save changes for 2026-06-19" } },
    ]),
  );
  expect(m.failures).toHaveLength(1);
  expect(m.failures[0]).toMatchObject({ i: 1, kind: "network", status: 400, title: "PATCH /diaries/5", message: "Cannot save changes for 2026-06-19" });
});

test("indexes network transport failures via errorText", () => {
  const m = buildManifest(report([{ t: 1, kind: "network", title: "FAILED /x", detail: { failed: true, errorText: "net::ERR_FAILED" } }]));
  expect(m.failures[0]).toMatchObject({ i: 0, kind: "network", message: "net::ERR_FAILED" });
});

test("indexes thrown errors and console errors", () => {
  const m = buildManifest(
    report([
      { t: 1, kind: "error", title: "TypeError: x", detail: { message: "TypeError: x is not a function" } },
      { t: 2, kind: "console", level: "error", title: "bad", detail: { message: "bad thing" } },
    ]),
  );
  expect(m.failures.map((f) => f.i)).toEqual([0, 1]);
  expect(m.failures[0].message).toBe("TypeError: x is not a function");
  expect(m.failures[1].message).toBe("bad thing");
});

test("truncates failure messages to 500 chars + ellipsis", () => {
  const long = "x".repeat(600);
  const m = buildManifest(report([{ t: 1, kind: "error", title: "e", detail: { message: long } }]));
  expect(m.failures[0].message.length).toBe(501); // 500 + "…"
  expect(m.failures[0].message.endsWith("…")).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/manifest.test.js`
Expected: FAIL — `failures` is still `[]`.

**Step 3: Write minimal implementation (edit `manifest.js`)**

Add above `buildManifest`:

```js
const MESSAGE_CAP = 500;

function truncate(s) {
  if (typeof s !== "string") return s;
  return s.length > MESSAGE_CAP ? s.slice(0, MESSAGE_CAP) + "…" : s;
}

// An event is a failure if a rule matches; `message` is the highest-signal text.
// Data-driven: a new failure kind is a new row, not a new branch.
const FAILURE_RULES = [
  {
    match: (e) => e.kind === "network" && e.detail && typeof e.detail.status === "number" && e.detail.status >= 400,
    message: (e) => e.detail.responseBody || e.detail.statusText || null,
  },
  {
    match: (e) => e.kind === "network" && e.detail && e.detail.failed,
    message: (e) => e.detail.errorText || null,
  },
  { match: (e) => e.kind === "error", message: (e) => (e.detail && e.detail.message) || e.title || null },
  {
    match: (e) => e.kind === "console" && e.level === "error",
    message: (e) => (e.detail && e.detail.message) || e.title || null,
  },
];
```

Then replace the `failures: []` build with a real scan. Change the loop and return:

```js
  const failures = [];
  events.forEach((e, i) => {
    if (counts[e.kind] != null) counts[e.kind] += 1;
    if (e.kind === "console" && e.level === "error") consoleErrors += 1;
    const rule = FAILURE_RULES.find((r) => r.match(e));
    if (rule) {
      const entry = { i, kind: e.kind, title: e.title };
      if (e.kind === "network" && e.detail) entry.status = e.detail.status;
      const msg = rule.message(e);
      if (msg) entry.message = truncate(msg);
      failures.push(entry);
    }
  });
  counts["console.error"] = consoleErrors;

  return { _doc: DOC, schema: LEGEND, counts, failures };
```

(Remove the old `for (const e of events)` count loop — it is now folded into `forEach`.)

**Step 4: Run test to verify it passes**

Run: `bun test test/manifest.test.js`
Expected: PASS (8 tests — 4 from Task 2 + 4 new).

**Step 5: Commit**

```bash
git add manifest.js test/manifest.test.js
git commit -m "feat: index failures (HTTP, transport, exceptions, console.error) in manifest"
```

---

### Task 4: Embed `#openjam-ai` in the exported report

**Files:**
- Modify: `report-builder.js:12-33`
- Test: `test/report-builder.test.js` (add cases)

**Step 1: Write the failing test (append to `test/report-builder.test.js`)**

```js
test("export embeds an #openjam-ai manifest before #openjam-data", () => {
  const html = buildReportHTML(makeReport(0), null);
  expect(html.indexOf('id="openjam-ai"')).toBeGreaterThan(-1);
  // manifest comes before the full data blob
  expect(html.indexOf('id="openjam-ai"')).toBeLessThan(html.indexOf('id="openjam-data"'));
  const block = html.match(/id="openjam-ai" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const manifest = JSON.parse(block);
  expect(typeof manifest._doc).toBe("string");
  expect(manifest.schema).toBeDefined();
  expect(manifest.counts.console).toBe(1); // makeReport() emits one console event
});

test("#openjam-data block is unchanged (still parseable, full events)", () => {
  const html = buildReportHTML(makeReport(0), null);
  const data = html.match(/id="openjam-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  expect(JSON.parse(data).events).toHaveLength(1);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/report-builder.test.js`
Expected: FAIL — no `id="openjam-ai"` in output.

**Step 3: Write minimal implementation (edit `report-builder.js`)**

Add the import at the top with the existing import:

```js
import { renderReport, mountReplay, REPORT_CSS, REPLAY_CSS } from "./renderer.js";
import { buildManifest } from "./manifest.js";
```

Inside `buildReportHTML`, after the `dataJson` line, build the manifest JSON (export must never fail because of it):

```js
  const dataJson = JSON.stringify(report).replace(/</g, "\\u003c");
  let manifestJson = "{}";
  try {
    manifestJson = JSON.stringify(buildManifest(report)).replace(/</g, "\\u003c");
  } catch (err) {
    manifestJson = JSON.stringify({ _doc: "manifest unavailable", error: String(err) }).replace(/</g, "\\u003c");
  }
```

Then emit the block immediately before the existing `#openjam-data` line:

```js
<script id="openjam-ai" type="application/json">${manifestJson}</script>
<script id="openjam-data" type="application/json">${dataJson}</script>
```

**Step 4: Run test to verify it passes**

Run: `bun test test/report-builder.test.js`
Expected: PASS — including the existing size/escaping tests (the manifest is small and `<`-escaped the same way, so linear-growth and bounded-inflation tests still hold).

**Step 5: Commit**

```bash
git add report-builder.js test/report-builder.test.js
git commit -m "feat: embed #openjam-ai manifest block before #openjam-data in export"
```

---

### Task 5: Reconcile `background.js` against the shared kinds (SSoT)

**Files:**
- Modify: `background.js` (top import + `kind:` literals at lines ~121, 161, 219, 232, 251)
- Test: existing `test/background.test.js` (no new test; this is a no-behavior-change refactor guarded by it)

**Step 1: Run the existing background tests first (baseline)**

Run: `bun test test/background.test.js`
Expected: PASS — record the count so you can confirm no regression after the edit.

**Step 2: Add the import and replace the literals**

At the top of `background.js`:

```js
import { KIND } from "./event-kinds.js";
```

Replace each `kind:` string literal with the constant (behavior identical — same strings):
- `kind: "screenshot"` → `kind: KIND.SCREENSHOT` (×2: success + failed screenshot)
- `kind: "network"` → `kind: KIND.NETWORK`
- `kind: "console"` → `kind: KIND.CONSOLE`
- `kind: "error"` → `kind: KIND.ERROR`
- `kind: "log"` → `kind: KIND.LOG` (×2: rrweb-start log + Log.entryAdded)

Use grep to find them all: `grep -n 'kind: "' background.js` — replace every match.

**Step 3: Verify no behavior change**

Run: `bun test test/background.test.js`
Expected: PASS — same count as the Step 1 baseline.

**Step 4: Verify the strings still serialize identically**

Run: `grep -n 'kind: "' background.js`
Expected: NO matches remain (all literals replaced).

**Step 5: Commit**

```bash
git add background.js
git commit -m "refactor: background.js emits kinds via event-kinds.js SSoT"
```

---

### Task 6: Full suite + README documentation

**Files:**
- Modify: `README.md` (add a short "For AI agents" subsection under "How it works")

**Step 1: Run the whole suite**

Run: `bun test test/`
Expected: PASS — all suites green (event-kinds, manifest, report-builder, background, plus the untouched recorder/issue-link/relay suites).

**Step 2: Document the manifest for agents (edit `README.md`)**

Add after the "How it works" table:

```markdown
### For AI agents

Each report embeds a small `<script id="openjam-ai" type="application/json">` manifest
*before* the full `<script id="openjam-data">` blob. Read the manifest first: it carries a
`_doc` description, a per-kind `schema` legend, `counts`, and a `failures[]` index whose
`i` fields point into the sorted `events[]` array in `#openjam-data`. Orient from the
manifest, then extract only the events you need by index — no need to parse the whole blob.
```

**Step 3: Verify the doc matches reality**

Run: `node -e "const {buildReportHTML}=await import('./report-builder.js'); const h=buildReportHTML({meta:{},events:[{t:1,kind:'network',title:'PATCH /x',detail:{status:400,responseBody:'nope'}}],rrwebEvents:[]},null); const m=h.match(/id=.openjam-ai. type=.application\/json.>([\s\S]*?)<\/script>/)[1]; console.log(m)"`
Expected: prints a JSON manifest containing `_doc`, `schema`, `counts`, and a `failures` entry with `i:0, status:400, message:"nope"`. (Confirms README's claims are accurate — this is the citation for the doc.)

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the #openjam-ai manifest for AI agents"
```

---

### Task 7: Deterministic discoverability metric (CI)

Proves — without an LLM — that the manifest surfaces the planted failure and that an agent reading top-down reaches the diagnosis far sooner via `#openjam-ai` than by scanning `#openjam-data`. This is the CI guardrail; Task 8 is the real-AI answer.

**Files:**
- Create: `eval/fixture-report.mjs` (synthetic-but-realistic capture with ONE planted failure buried in ordinary traffic — shared by Task 7 and Task 8)
- Create: `test/manifest-eval.test.js`

**Step 1: Write the fixture (shared, no test yet)**

```js
// eval/fixture-report.mjs
// A realistic-but-synthetic OpenJam capture with a SINGLE planted failure buried
// among ordinary traffic. Flows through the real buildReportHTML, so it produces
// a genuine openJam HTML. Used by the deterministic metric (Task 7) and the
// opt-in real-LLM A/B harness (Task 8). Swap in a real captured report object to
// evaluate against production data.

export const GROUND_TRUTH = {
  endpoint: "PATCH /diaries/5",
  status: 400,
  phrase: "Cannot save changes for 2026-06-19",
};

function noise(n, startT) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ t: startT + i, kind: "network", title: "GET /api/item/" + i, detail: { method: "GET", url: "https://app/api/item/" + i, status: 200 } });
    out.push({ t: startT + i + 0.5, kind: "console", level: "log", title: "loaded " + i, detail: { message: "loaded " + i } });
  }
  return out;
}

export function fixtureReport() {
  const t0 = 1750000000000;
  const events = [
    ...noise(60, t0),
    {
      t: t0 + 1000,
      kind: "network",
      title: GROUND_TRUTH.endpoint,
      detail: {
        method: "PATCH",
        url: "https://app/diaries/5",
        status: 400,
        statusText: "Bad Request",
        requestBody: JSON.stringify({ entries: [{ date: "2026-06-19", availability: "UNAVAILABLE" }] }),
        responseBody: GROUND_TRUTH.phrase + ": the day cannot be made unavailable while it has active bookings.",
      },
    },
    ...noise(60, t0 + 2000),
  ];
  return {
    meta: { version: "0.3.0", capturedAt: t0, durationMs: 5000, pageUrl: "https://app/diaries/5", pageTitle: "Diary" },
    device: { viewport: { width: 1280, height: 800 } },
    events: events.sort((a, b) => a.t - b.t),
    rrwebEvents: [],
  };
}
```

**Step 2: Write the failing test**

```js
// test/manifest-eval.test.js
import { test, expect } from "bun:test";
import { buildReportHTML } from "../report-builder.js";
import { buildManifest } from "../manifest.js";
import { fixtureReport, GROUND_TRUTH } from "../eval/fixture-report.mjs";

test("manifest surfaces the planted failure (index, status, message)", () => {
  const report = fixtureReport();
  const m = buildManifest(report);
  expect(m.failures).toHaveLength(1);
  const f = m.failures[0];
  expect(report.events[f.i].title).toBe(GROUND_TRUTH.endpoint);
  expect(f.status).toBe(GROUND_TRUTH.status);
  expect(f.message).toContain(GROUND_TRUTH.phrase);
});

test("bytes-to-diagnosis: failure is reachable from the manifest far sooner than from the raw blob", () => {
  const html = buildReportHTML(fixtureReport(), null);
  const aiStart = html.indexOf('id="openjam-ai"');
  const aiEnd = html.indexOf("</script>", aiStart);
  const phraseInManifest = html.indexOf(GROUND_TRUTH.phrase, aiStart);
  expect(phraseInManifest).toBeGreaterThan(-1);
  expect(phraseInManifest).toBeLessThan(aiEnd); // the answer lives inside the small top block

  const dataStart = html.indexOf('id="openjam-data"');
  const phraseInData = html.indexOf(GROUND_TRUTH.phrase, dataStart);
  expect(aiEnd).toBeLessThan(phraseInData); // manifest ends before the buried event
  // quantify "easier to find": reaching the manifest's end costs < half the bytes
  // of reaching the failure by scanning the raw timeline.
  expect(aiEnd / phraseInData).toBeLessThan(0.5);
});
```

**Step 3: Run test to verify it fails**

Run: `bun test test/manifest-eval.test.js`
Expected: FAIL — `../eval/fixture-report.mjs` unresolved until Step 1 saved (if you wrote Step 1 first, this passes immediately; that's fine — confirm green).

**Step 4: Run test to verify it passes**

Run: `bun test test/manifest-eval.test.js`
Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add eval/fixture-report.mjs test/manifest-eval.test.js
git commit -m "test: deterministic discoverability metric for the AI manifest"
```

---

### Task 8: Opt-in real-LLM A/B eval harness

Runs an actual agent against the report **with** vs **without** the manifest and measures whether the manifest made diagnosis more correct and/or lower-effort. Non-deterministic, token-costing, **never in CI** — invoked via `npm run eval`.

**Files:**
- Create: `eval/build-reports.mjs` (writes the two HTML variants)
- Create: `eval/run-eval.mjs` (runs the agent N times per variant, scores, prints a table)
- Create: `eval/README.md`
- Modify: `package.json` (add `eval` script; add `eval/out/` to `.gitignore`)

**Step 1: Write the variant builder**

```js
// eval/build-reports.mjs
// Writes the two variants the A/B eval compares:
//   eval/out/with-manifest.html    — current export (includes #openjam-ai)
//   eval/out/without-manifest.html — identical report, #openjam-ai stripped (baseline)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildReportHTML } from "../report-builder.js";
import { fixtureReport } from "./fixture-report.mjs";

const outDir = path.join(import.meta.dirname, "out");
mkdirSync(outDir, { recursive: true });

const withManifest = buildReportHTML(fixtureReport(), null);
const withoutManifest = withManifest.replace(/<script id="openjam-ai"[\s\S]*?<\/script>\n?/, "");
if (withoutManifest === withManifest) throw new Error("failed to strip #openjam-ai — check the block markup");

writeFileSync(path.join(outDir, "with-manifest.html"), withManifest);
writeFileSync(path.join(outDir, "without-manifest.html"), withoutManifest);
console.log("wrote eval/out/with-manifest.html and without-manifest.html");
```

**Step 2: Write the eval runner**

```js
// eval/run-eval.mjs
// Opt-in real-LLM A/B eval. NOT run in CI (needs an agent CLI + tokens).
// For each variant, runs the agent TRIALS times asking it to find+diagnose the
// failure, then records: correct? (answer names endpoint+status+phrase),
// num_turns (effort proxy), output tokens. Prints a comparison + verdict.
//
//   npm run build && node eval/build-reports.mjs && node eval/run-eval.mjs
//
// Default agent is headless Claude Code (`claude -p --output-format json`).
// Override with OPENJAM_EVAL_AGENT_CMD (a command that takes the prompt as its
// last argv and prints Claude Code JSON to stdout). OPENJAM_EVAL_TRIALS sets N.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { GROUND_TRUTH } from "./fixture-report.mjs";

const TRIALS = Number(process.env.OPENJAM_EVAL_TRIALS || 3);
const VARIANTS = ["with-manifest", "without-manifest"];
const PROMPT = (file) =>
  `Read the OpenJam bug report at ${file}. Identify the single failing network request and explain the cause. ` +
  `State the HTTP method and path, the status code, and the error message.`;

function runAgent(file) {
  const custom = process.env.OPENJAM_EVAL_AGENT_CMD;
  const cmd = custom || "claude";
  const args = custom ? [PROMPT(file)] : ["-p", PROMPT(file), "--output-format", "json"];
  const raw = execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const json = JSON.parse(raw);
  return { text: json.result || "", turns: json.num_turns ?? null, tokens: json.usage?.output_tokens ?? null };
}

function isCorrect(text) {
  const t = text.toLowerCase();
  return (
    t.includes(GROUND_TRUTH.endpoint.toLowerCase()) &&
    t.includes(String(GROUND_TRUTH.status)) &&
    t.includes(GROUND_TRUTH.phrase.toLowerCase())
  );
}

const results = {};
for (const v of VARIANTS) {
  const file = path.join(import.meta.dirname, "out", v + ".html");
  const trials = [];
  for (let i = 0; i < TRIALS; i++) {
    const r = runAgent(file);
    const correct = isCorrect(r.text);
    trials.push({ correct, turns: r.turns, tokens: r.tokens });
    console.log(`[${v}] trial ${i + 1}/${TRIALS}: correct=${correct} turns=${r.turns} tokens=${r.tokens}`);
  }
  const avg = (k) => Math.round(trials.reduce((s, t) => s + (t[k] || 0), 0) / TRIALS);
  results[v] = { correctRate: trials.filter((t) => t.correct).length / TRIALS, avgTurns: avg("turns"), avgTokens: avg("tokens") };
}

console.table(results);
const a = results["with-manifest"], b = results["without-manifest"];
const pass = a.correctRate >= b.correctRate && a.avgTurns <= b.avgTurns;
console.log(pass ? "PASS: manifest diagnosis at least as correct, with no more effort." : "REVIEW: manifest did not help on this run.");
```

(Both loops are bounded `for` loops — `VARIANTS` and `TRIALS` — never `while`.)

**Step 3: Wire the script + ignore output**

In `package.json` `scripts`, add:
```json
"eval": "node eval/build-reports.mjs && node eval/run-eval.mjs"
```
Append to `.gitignore`:
```
eval/out/
```

**Step 4: Write `eval/README.md`**

```markdown
# OpenJam manifest A/B eval

Measures whether the embedded `#openjam-ai` manifest makes it easier for an AI to
**find and diagnose** the failure in a report.

- `fixture-report.mjs` — a synthetic-but-realistic capture with one planted 400,
  buried among ordinary traffic. Shared with the deterministic test
  (`test/manifest-eval.test.js`, runs in `bun test`).
- `build-reports.mjs` — emits `out/with-manifest.html` and `out/without-manifest.html`.
- `run-eval.mjs` — runs an agent N times per variant, scores correctness against
  the ground truth, records effort (turns/tokens), prints a comparison + verdict.

## Run (opt-in — needs an agent CLI + tokens; not part of CI)

```sh
npm run build
npm run eval
```

Default agent is headless Claude Code (`claude -p`). Override the agent with
`OPENJAM_EVAL_AGENT_CMD`, trial count with `OPENJAM_EVAL_TRIALS`.

A PASS means the manifest variant was at least as correct with no more effort.
```

**Step 5: Verify the deterministic parts (no agent needed)**

Run: `npm run build && node eval/build-reports.mjs && ls eval/out && grep -c 'openjam-ai' eval/out/with-manifest.html eval/out/without-manifest.html`
Expected: lists both HTML files; `with-manifest.html` count ≥ 1, `without-manifest.html` count = 0 (block stripped). This proves the harness produces a valid A/B pair.

**Step 6: (Optional) Run the real eval once and record the result**

Run: `npm run eval` (requires `claude` CLI logged in; spends tokens)
Expected: a `console.table` comparing `correctRate` / `avgTurns` / `avgTokens` for both variants, then `PASS`/`REVIEW`. Paste the table into the PR description as evidence.

**Step 7: Commit**

```bash
git add eval/build-reports.mjs eval/run-eval.mjs eval/README.md package.json .gitignore
git commit -m "test: opt-in real-LLM A/B eval for manifest-assisted diagnosis"
```

---

## Verification Summary

- `bun test test/` — all suites pass (incl. `manifest-eval` discoverability metric).
- `#openjam-ai` appears before `#openjam-data`; both parse as JSON; `#openjam-data` unchanged.
- `failures[].i` indices resolve to the matching events in `#openjam-data`.
- `grep -n 'kind: "' background.js` returns nothing (SSoT reconciled).
- README "For AI agents" claims verified against real `buildReportHTML` output (Task 6 Step 3).
- Discoverability metric: `bun test test/manifest-eval.test.js` → manifest surfaces the planted failure and `aiEnd/phraseInData < 0.5`.
- A/B harness produces a valid variant pair: `node eval/build-reports.mjs && grep -c 'openjam-ai' eval/out/*.html` → 1 vs 0.
- (Opt-in) `npm run eval` → comparison table + `PASS`/`REVIEW` verdict; table pasted into the PR.

## Principles Applied

- **Pure Functions for Testability** — `buildManifest(report)` is pure; tested in isolation (Tasks 2–3).
- **Data Drives Behavior** — `FAILURE_RULES` table + `LEGEND` data; new failure/kind = new row, not a new branch.
- **Single Source of Truth** — `event-kinds.js` owns kinds + legend; `manifest.js` and `background.js` import it.
- **Separation of Concerns** — compute (`manifest.js`) vs. embed (`report-builder.js`) vs. render (`renderer.js`, untouched).
- **Deviation** — `renderer.js` keeps inline kind literals because it is `.toString()`-serialized into the export and cannot import a module at runtime. Justified under principles.md "When This Doesn't Apply" (framework/serialization constraint).
