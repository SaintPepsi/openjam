# OpenJam Privacy Policy

_Last updated: 2026-06-15_

OpenJam records browser sessions **entirely on your machine**. There is no
backend, no account, no analytics, and no telemetry.

## What OpenJam captures

While you are actively recording (and only then), OpenJam captures from the
recorded tab: console messages, JavaScript errors, network request metadata
and text response bodies, screenshots, device/environment info (user agent,
viewport, timezone), and a DOM session replay ([rrweb](https://github.com/rrweb-io/rrweb)).
Password fields are masked in the replay by default.

## Where it goes

Captured data is held in memory during recording and saved to your browser's
local extension storage (`chrome.storage.local`) when you stop. Only the most
recent report is kept. Exported reports are self-contained HTML files written
to wherever you choose to save them.

**Nothing is ever transmitted off your device by OpenJam.** The only way data
leaves your machine is you sharing an exported file yourself.

## Recording untrusted pages

To replay modern styling correctly, the session-replay recorder runs **inside
the recorded page's own context**. A side effect is that a malicious page can
read or tamper with **its own** capture while you record it — it can see the
replay data OpenJam collects about that page (the same DOM and inputs it already
controls), inject misleading events, or stop the recording. This is confined to
that one tab's own report; it cannot reach other tabs, other sites, or reports
already saved, and (as above) nothing leaves your machine.

It only matters if you record a page that is actively hostile — debugging your
own app or a site you trust is unaffected. **Only record pages you trust, and
treat the replay of an untrusted page as untrustworthy.**

## Permissions

| Permission | Why |
|---|---|
| `debugger` | Attach the Chrome DevTools Protocol to the recorded tab — the source of console/network/error/screenshot events |
| `<all_urls>` host access | Record whichever page the bug is on |
| `scripting` | Inject the session-replay recorder into pages that were already open before OpenJam was installed |
| `storage`, `unlimitedStorage` | Save the report locally without a size cap |

## Limited Use disclosure

OpenJam's use of user data complies with the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use),
including the Limited Use requirements: captured data is used solely to
provide the user-facing recording feature described on the store listing and
in the extension UI, is never transferred to anyone, and is never used for
advertising, creditworthiness, or any other purpose.

## Error reporting

If OpenJam itself fails, it offers a link to open a **pre-filled public GitHub
issue** containing only the error text, extension version, and browser user
agent — never page URLs or captured data. Nothing is sent unless you review
and submit the issue yourself.

## Verify it yourself

OpenJam is open source ([GPL-3.0](LICENSE)). Every claim above is checkable in
the code: capture and local-save logic in
[`background.js`](https://github.com/SaintPepsi/openjam/blob/main/background.js)
(single-report retention in `saveReport`), the issue-link contents in
[`issue-link.js`](https://github.com/SaintPepsi/openjam/blob/main/issue-link.js),
and the replay password-masking assertion in
[`e2e/extension.spec.mjs`](https://github.com/SaintPepsi/openjam/blob/main/e2e/extension.spec.mjs).

## Contact

Questions or concerns: [open an issue](https://github.com/SaintPepsi/openjam/issues).
