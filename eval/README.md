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
