# Chrome Web Store listing — copy/paste reference

Paste-ready values for the CWS Developer Dashboard listing. Reuse for the Edge
Add-ons listing too (issue #4). Title and the short summary come from
`manifest.json` automatically — everything below is entered in the dashboard.

---

## Store listing page

### Description

```
OpenJam is an open-source, privacy-first bug reporter for Chrome — a free alternative to Jam.dev.

Hit record, reproduce the bug, and OpenJam captures everything a developer needs to fix it onto a single correlated timeline:

• Console logs and uncaught JavaScript errors, with full stack traces
• Network requests — method, URL, status, headers, payloads, timing, and response bodies
• Screenshots — at start and stop, automatically on every error, and on demand
• Device & environment info — browser, OS, viewport, screen size, timezone
• A full DOM session replay (powered by rrweb) you can scrub through frame by frame
• Optional mic narration you can hear play back in sync with the replay

Click "Stop & open report" and OpenJam produces a single self-contained HTML file. Open it offline, on any machine, with no extension or account required to view it, and watch the whole session play back next to the timeline. Perfect for attaching to a GitHub issue, Jira ticket, or Slack thread.

Privacy first: everything stays on your machine. No backend, no account, no telemetry — nothing is ever transmitted. OpenJam is fully open source under GPL-3.0, so you can read and audit every line.

How it works: OpenJam attaches the Chrome DevTools Protocol — the same mechanism Chrome DevTools itself uses — to the tab you choose, so it captures exactly what the browser sees. Chrome shows a "being debugged" banner while recording; that's expected and disappears when you stop.

Source code: https://github.com/SaintPepsi/openjam
Report a bug / request a feature: https://github.com/SaintPepsi/openjam/issues
Privacy policy: https://github.com/SaintPepsi/openjam/blob/main/PRIVACY.md
```

### Category

```
Developer Tools
```

### Language

```
English (United States)
```

### Graphic assets

| Asset | File | Status |
|---|---|---|
| Store icon (128×128) | `icons/icon128.png` | ✅ ready |
| Screenshot 1 (1280×800) | `docs/screenshots/viewer.png` | ✅ no-alpha, ready |
| Screenshot 2 (1280×800) | `docs/screenshots/viewer-expanded.png` | ✅ no-alpha, ready |
| Small promo tile (440×280) | — | optional, skip |
| Marquee promo tile (1400×560) | — | optional, skip |

### Additional fields

| Field | Value |
|---|---|
| Official URL | Leave **None** (requires Search Console domain verification) |
| Homepage URL | `https://github.com/SaintPepsi/openjam` |
| Support URL | `https://github.com/SaintPepsi/openjam/issues` |
| Mature content | **Off** |

---

## Privacy practices tab (needed before submit)

### Single purpose

```
OpenJam records a browser session — console logs, network activity, JavaScript errors, screenshots, device info, optional microphone narration, and a DOM session replay — on a tab the user chooses, and exports it as a self-contained HTML bug report. Everything stays on the user's machine.
```

### Permission justifications

**debugger**
```
Attaches the Chrome DevTools Protocol to the user-selected tab to capture console logs, uncaught exceptions, network requests/responses, and screenshots — the core of the bug recorder, and the only API exposing this data together. Runs only on the tab the user presses Start on, and detaches on Stop.
```

**storage**
```
Saves the captured report (events, screenshots, DOM replay) to local extension storage so the report page can render it after recording stops. Only the most recent report is kept; nothing is transmitted.
```

**unlimitedStorage**
```
A session replay with screenshots routinely exceeds the default ~10 MB local-storage quota, so the capture would fail without it. Data remains local.
```

**scripting**
```
Injects OpenJam's rrweb replay recorder into the recorded tab (when the content script isn't already present, e.g. after the extension reloads) to capture the DOM and its mutations for playback. Only on the tab the user chose to record.
```

**offscreen**
```
The MV3 service worker has no DOM and cannot run getUserMedia/MediaRecorder, so the opt-in microphone-narration feature records in an offscreen document instead. It is created only when the user has enabled "Record audio" and starts a recording, and is closed when the recording stops. The narration is embedded in the local report file; nothing is transmitted.
```

**host permissions (`<all_urls>`)**
```
Users record bugs on arbitrary websites, so OpenJam needs host access to read the page and inject the recorder on whatever tab they pick. It does nothing on any page until the user explicitly presses Start; no host is touched in the background.
```

### Data usage

- Declare you do **not** collect or use user data.
- Certify all three compliance boxes (no selling, no unrelated use, no unapproved transfer).
- Privacy policy URL: `https://github.com/SaintPepsi/openjam/blob/main/PRIVACY.md`

> OpenJam transmits nothing — every capture stays on the user's machine. That includes
> mic narration: opt-in, recorded locally, embedded in the local report file, never
> collected or transmitted.
