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
