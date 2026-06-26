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

## What to expect / limitations

- A shared report file contains whatever was captured, so sharing a report shares that data —
  share a report the same way you'd share any file containing that data.
- Attaching the debugger to capture data shows Chrome's debugging banner; this is local access,
  not data leaving the machine.

## Test data

- Privacy policy: [PRIVACY.md](../../PRIVACY.md)
- Packaging tests confirming what ships in the extension: `test/packaging.test.js`

## Related

- [Bug report export](bug-report.md) — why one local file is central to the privacy model
