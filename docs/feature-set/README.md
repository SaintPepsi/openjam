# OpenJam feature set

A transparent, per-feature breakdown of what OpenJam does — what it captures, how it
behaves, what to expect, and (where available) the test data you can inspect yourself.
The goal is honesty about capability and expectation: you should be able to see exactly
what the tool does with your data before you trust it.

## Core promise

🔒 **Nothing is ever uploaded — you have full control over your data.** Everything stays
on your machine; the entire bug report is a single local file that only travels if *you*
choose to share it. See [Privacy & data control](privacy.md).

## Features

| Feature | What it gives you |
|---|---|
| [Session replay](session-replay.md) | Full DOM session replay of what happened, via rrweb |
| [Data capture](data-capture.md) | Console logs, JS errors, network, browser logs, environment |
| [Screenshots](screenshots.md) | Screenshots at start/stop, on errors, and on demand |
| [Audio narration](audio-narration.md) | Opt-in mic narration, recorded locally and synced to the timeline |
| [Bug report export](bug-report.md) | One self-contained, offline HTML file with a correlated timeline |
| [AI manifest](ai-manifest.md) | An embedded, AI-readable index so agents can diagnose reports fast |
| [Privacy & data control](privacy.md) | Nothing uploaded; everything local; you decide what's shared |

## Conventions

- Each feature doc has a **What it does**, **What to expect / limitations**, **Test data**, and **Related** section.
- "Test data" links to real fixtures and sample reports in the repo so claims are checkable, not just described.
- This set documents features in the **current release** only.
