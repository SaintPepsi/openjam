# Audio narration

Part of the [OpenJam feature set](README.md).

## What it does

OpenJam can record **spoken microphone narration** alongside a session, so a bug report can
carry your voice explaining what you did and what looked wrong — played back in sync with
the timeline and [session replay](session-replay.md).

It is **opt-in**. In the popup, a "🎙 Record audio" toggle turns it on; when enabled, a mic
picker (`#micSelect`) lets you choose which microphone to use. Your choice is remembered
between sessions (`chrome.storage.local` `audioSettings = { enabled, deviceId }`).

Because the MV3 service worker has no DOM (it can't run `getUserMedia`/`MediaRecorder`),
recording happens in an **offscreen document** (`offscreen.html` / `offscreen.js`) that the
background worker creates for the duration of a recording and tears down afterwards. The
offscreen doc records **one continuous `webm/opus` track** for the whole session and hands
it back to the worker as a base64 data URL. The worker folds it into `report.audio`
(`{ dataUrl, mime, startWall, durationMs }`), inlined the same way screenshots are.

Playback is created **at runtime** by `mountAudio` (`renderer.js`): both the in-extension
viewer and the self-contained export build the `<audio>` element from the embedded
`#openjam-data` JSON, and on each `timeupdate` highlight the timeline row nearest the
current wall-clock position (`startWall` + `currentTime`).

## What to expect / limitations

- **Opt-in and local-only.** Off by default; nothing is ever uploaded. The audio lives
  inside the one exported HTML file and only travels if *you* share that file
  ([Privacy & data control](privacy.md)).
- **One continuous track.** A single `audio/webm;codecs=opus` blob per session, not
  per-clip events. Tab audio is a fast-follow, not in this version.
- **Needs the `offscreen` permission.** v1 adds exactly one new permission (`offscreen`)
  so the offscreen document can run `getUserMedia`/`MediaRecorder`.
- **Fail-open.** Any audio failure (no mic, permission denied, recorder error) degrades to
  "no audio" (`report.audio = null`) and never blocks the rest of the capture. Under
  storage-quota pressure the audio is dropped alongside the replay, in layers.
- **The `<audio>` is built at runtime**, not baked into the export HTML string — the
  `data:audio/webm` URL lives once inside the embedded `#openjam-data` JSON, and the player
  is mounted from it when the report opens.
- **Names / free-text in the recording are not this feature's concern.** Scrubbing sensitive
  content is handled separately by redaction, not audio capture.

## Test data

- End-to-end capture→export loop with a fake mic (toggle persistence, offscreen lifecycle,
  `report.audio` payload, and exactly-one runtime `<audio>` on export, each with a
  disconfirming case): `e2e/audio.spec.mjs`
- Deterministic fixture the lanes are driven against (has `#errBtn` and other lane
  triggers): `test/e2e/fixture.html`
- Pure sync-math unit tests (`audioTimeFor` / `wallForAudioTime`): `test/audio-sync.test.js`

## Related

- [Session replay](session-replay.md) — the DOM replay the narration plays back in sync with
- [Data capture](data-capture.md) — the console/network/error lanes on the same timeline
- [Bug report export](bug-report.md) — how the narration is packaged into one offline file
- [AI manifest](ai-manifest.md) — records a one-line `audio: { durationMs, mime }` when a track exists
- [Privacy & data control](privacy.md) — nothing uploaded; you decide what's shared
