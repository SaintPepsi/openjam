# Releasing OpenJam — automatic deployment

How automated Chrome Web Store publishing is wired, and the repeatable release
loop. The repo plumbing is `release.yml` + [`PlasmoHQ/bpp`](https://github.com/PlasmoHQ/bpp),
which publishes on every `v*` tag **when the `SUBMIT_KEYS` secret exists**.

**Status (2026-06-24):** v0.4.2 submitted to the CWS, **Pending review**. CWS item
ID `oljdbmjhfjnhnpjcehcnkbbjdgnpjdaj`. **`SUBMIT_KEYS` is set and verified** (the
refresh token mints an access token with the `chromewebstore` scope) — so the
one-time credential setup below is **done**; it's recorded here for the next time
the token needs rotating or for adding Edge.

> The steps below are the path actually followed, on Google's current **Google
> Auth Platform** UI (it replaced the old standalone "OAuth consent screen").

---

## One-time credential setup (done — recorded for rotation)

### Step 1 — New Google Cloud project + enable the API
1. https://console.cloud.google.com → project dropdown → **New Project** (e.g. `openjam-release`), switch into it.
2. Enable the API: https://console.cloud.google.com/apis/library/chromewebstore.googleapis.com → **Enable**.

✅ Library page shows **API enabled**.

### Step 2 — Configure Google Auth Platform → publish to Production
A fresh project shows **"Google Auth platform not configured yet" → Get started**.
1. Click **Get started**, then complete the wizard:
   - **App Information** — app name (`OpenJam Release`) + user support email.
   - **Audience** — **External** (Internal needs a Workspace org; a personal Gmail can't use it).
   - **Contact Information** — your email → **Finish** → **Create**.
2. Open the **Audience** tab → **Publish app** → status becomes **In production**.

> ⚠️ **The 7-day trap.** Left in **Testing**, the refresh token expires after ~7
> days and releases silently break. Production issues a long-lived token. No
> Google verification review is needed for first-party CI use — you just accept
> an "unverified app" warning once during Step 4. (Established Google OAuth
> policy; see the Plasmo token guide in References.)

✅ **Audience** tab reads **Publishing status: In production**.

### Step 3 — Create the OAuth client + get the secret file
1. **Clients** tab (or "Create OAuth client" on Overview) → **Create client**.
2. **Application type → Desktop app**, name `openjam-cli` → **Create**.
3. Copy the **Client ID**. For the **Client secret**: click the client in the
   **Clients** list to open its detail page (Client ID + secret are shown with
   copy buttons), or use **Download JSON** to get `client_secret_*.json`.
   *(If "Download JSON" does nothing, it's a popup-blocker — copy from the detail
   page instead, or allow popups.)*

✅ You have the Client ID and a `client_secret_<id>.json` file.

### Step 4 — Mint the refresh token (loopback method)
We used a zero-dependency Node loopback helper rather than the `chrome-webstore-upload-keys`
CLI — it reads the secret straight from the downloaded JSON, so the secret never
gets pasted anywhere. Save this as `get-refresh-token.mjs`:

```js
import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const c = cfg.installed || cfg.web;
const PORT = 4561, REDIRECT = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: c.client_id, redirect_uri: REDIRECT, response_type: "code",
  scope: SCOPE, access_type: "offline", prompt: "consent",
}).toString();
console.log("Open this URL:\n" + authUrl);

const exchange = (code) => new Promise((resolve, reject) => {
  const body = new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: REDIRECT, grant_type: "authorization_code" }).toString();
  const req = https.request("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }, (res) => {
    let d = ""; res.on("data", (x) => (d += x)); res.on("end", () => resolve(JSON.parse(d)));
  });
  req.on("error", reject); req.write(body); req.end();
});

http.createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) return res.end("waiting…");
  const tok = await exchange(code);
  res.end("✅ refresh token captured — close this tab.");
  console.log("REFRESH_TOKEN: " + (tok.refresh_token || JSON.stringify(tok)));
  process.exit(0);
}).listen(PORT, () => console.log("Listening on " + REDIRECT));
```

Run it and open the printed URL:
```sh
node get-refresh-token.mjs ~/Downloads/client_secret_<id>.json
```
At the consent screen: pick the account → **"Google hasn't verified this app" →
Advanced → Go to openjam-cli (unsafe)** → **Allow**. The browser redirects to
`localhost:4561`, the script exchanges the code and prints `REFRESH_TOKEN: …`.

> If you hit a hard **"Access blocked: app not verified"** with no *Advanced*
> link, the consent screen is still in **Testing** — finish Step 2's Publish.

✅ You have a `refreshToken`.

### Step 5 — Set the `SUBMIT_KEYS` secret
One JSON blob; only `clientSecret` + `refreshToken` are truly sensitive (`extId`
is public, it's the store URL). Build it by reading the secret from the file and
pipe straight into `gh` — never written to disk:
```sh
node -e '
const fs=require("fs");
const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).installed;
process.stdout.write(JSON.stringify({chrome:{
  extId:"oljdbmjhfjnhnpjcehcnkbbjdgnpjdaj",
  clientId:c.client_id, clientSecret:c.client_secret, refreshToken:process.argv[2]
}}));
' ~/Downloads/client_secret_<id>.json "<REFRESH_TOKEN>" \
| gh secret set SUBMIT_KEYS --repo SaintPepsi/openjam
```

✅ **Verify it's set:**
```sh
gh secret list --repo SaintPepsi/openjam   # SUBMIT_KEYS with a recent timestamp
```

✅ **Verify the credential actually works** (mints an access token — don't stop at "secret set"):
```sh
node -e '
const fs=require("fs"),https=require("https");
const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).installed;
const body=new URLSearchParams({client_id:c.client_id,client_secret:c.client_secret,refresh_token:process.argv[2],grant_type:"refresh_token"}).toString();
https.request("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"}},r=>{let d="";r.on("data",x=>d+=x);r.on("end",()=>{const j=JSON.parse(d);console.log(j.access_token?"OK scope="+j.scope:"FAIL "+d)})}).end(body);
' ~/Downloads/client_secret_<id>.json "<REFRESH_TOKEN>"
# → OK scope=https://www.googleapis.com/auth/chromewebstore
```

### Step 6 — Clean up
- **Delete** `~/Downloads/client_secret_<id>.json` — everything it held is now in the GitHub secret.

---

## Releasing a new version (the repeatable loop)

> ⏳ Hold the first automated tag until the manual v0.4.2 review is **approved/live** —
> `bpp` uploads *and* publishes, which conflicts with an item still in review.

1. Bump `version` in `manifest.json` + `package.json` (e.g. `0.4.3`), open a PR, merge.
2. Tag and push from `main`:
   ```sh
   git checkout main && git pull
   git tag v0.4.3 && git push origin v0.4.3
   ```
3. Watch it:
   ```sh
   gh run watch "$(gh run list --workflow=release.yml -L1 --json databaseId -q '.[0].databaseId')"
   ```

✅ **The real bar (not just "CI green"):**
- `release.yml` run **success**.
- GitHub Release created with the `openjam.zip` asset.
- CWS dashboard shows the **new version** uploaded (Pending review → live).

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Publish step skipped | `SUBMIT_KEYS` missing/empty — redo Step 5. |
| `invalid_grant` after ~a week | Consent screen still in **Testing** — Publish to Production (Step 2), re-mint (Step 4). |
| `UPLOAD_IN_PROGRESS` / publish rejected | Item still under review — wait for approval, re-tag. |
| `403` / 2SV required | Enable 2-Step Verification on the publisher Google account. |
| `Access blocked: app not verified` (no *Advanced*) | Testing mode + not a test user — Publish to Production. |
| Edge later | Add an `"edge"` block (`productId/clientId/apiKey`) to `SUBMIT_KEYS` — issue #4. |

---

## References

- Official — Use the Chrome Web Store API: https://developer.chrome.com/docs/webstore/using-api
- API v1 reference: https://developer.chrome.com/docs/webstore/api/v1
- Plasmo token guide (matches our `bpp` setup): https://github.com/PlasmoHQ/chrome-webstore-api/blob/main/token.md
- `bpp` action: https://github.com/PlasmoHQ/bpp · keys format: https://github.com/PlasmoHQ/bms#submit-keysjson
- Tracking: issue #9 (release checklist), #3 (CWS listing), #4 (Edge), #6 (SUBMIT_KEYS)
