# Privacy & data control

Part of the [OpenJam feature set](README.md).

## What it does

🔒 **Nothing is ever uploaded — you have full control over your data.**

- No backend, no account, no telemetry ([README](../../README.md), [PRIVACY.md](../../PRIVACY.md)).
- Everything captured stays on your machine.
- The [bug report](bug-report.md) is a single self-contained local file. It only leaves your
  machine if *you* choose to share that file — there is no server, sync, or upload path.

This is the core promise OpenJam is built around: the privacy bar is not "never capture," it
is "nothing leaves unless you send it."

### OpenJam makes no outbound connections (enforced by CSP)

OpenJam itself never phones home — no telemetry, no tracking, no exfiltration. A
**Content-Security-Policy** enforces it rather than leaving it to good intentions:
`connect-src 'none'` blocks all `fetch`/XHR/beacon/WebSocket, and scripts are inline-only (no
external or `eval`), so nothing OpenJam ships can send data anywhere. OpenJam's own report
shell only ever references `data:` assets, so it stays inert regardless.

The **session replay is exempt on purpose**: it's a faithful reproduction of the captured
page, so it is allowed to load that page's own passive assets — images, fonts, stylesheets
(`img`/`font`/`style-src *`). Those GETs are the page rendering itself, not OpenJam sending
anything out. The policy applies in both the exported HTML (a `<meta>` CSP,
`report-builder.js`) and the in-extension pages (`manifest.json`
`content_security_policy.extension_pages`). Verified end-to-end: a report's `fetch` raises a
`connect-src` CSP violation while an external image loads fine (`e2e/extension.spec.mjs`, with
a no-CSP disconfirming case).

## What to expect / limitations

- A shared report file contains whatever was captured, so sharing a report shares that data —
  share a report the same way you'd share any file containing that data.
- Attaching the debugger to capture data shows Chrome's debugging banner; this is local access,
  not data leaving the machine.
- **External assets in a replay won't render.** Because egress is blocked, images/fonts the
  captured page loaded from other origins (e.g. avatars, CDN fonts) show blank/unstyled in the
  replay. This is the privacy tradeoff: correctness of "no connections" over pixel fidelity.
  Inlining those assets at capture time is a possible fidelity follow-up.

## Test data

- Privacy policy: [PRIVACY.md](../../PRIVACY.md)
- Packaging tests confirming what ships in the extension: `test/packaging.test.js`

## Related

- [Bug report export](bug-report.md) — why one local file is central to the privacy model
