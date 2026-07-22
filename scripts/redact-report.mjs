// Redacts an exported OpenJam report (.html) and writes new redacted copies — one
// per redaction "way" so each can be reviewed in isolation. Decodes the embedded
// report object (`<script id="openjam-data">`, gzip+base64), runs the chosen way
// over it, and swaps the result back into the same HTML so the redacted file still
// renders through OpenJam's own renderer + replay (report-builder.js inlines the
// same codec and re-decodes that script at load). The input is never mutated;
// new files are written.
//
//   node scripts/redact-report.mjs <input.html> [output.html]   # default way: tuned
//   node scripts/redact-report.mjs <input.html> --way=aggressive
//   node scripts/redact-report.mjs <input.html> --all           # every way
//   npm run redact -- <input.html> [--all|--way=NAME]
//
// Output defaults to <input>.<way>.redacted.html next to the input.
//
// NOTE: ad-hoc CLI for trialling redaction against real recordings. The pattern
// sets live inline; the shipping engine (redaction-engine.js) is a separate
// deliverable — see docs/pii-redaction/.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { encodeOjData, decodeOjData } from "../src/generated/codec.js";

// ---- pattern library ------------------------------------------------------
const luhn = (s) => {
  const d = s.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
};
const PATTERN_LIB = {
  email: [/[\w.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g],
  jwt: [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  bearer: [/bearer\s+[A-Za-z0-9._-]{8,}/gi],
  ssn: [/\b\d{3}-\d{2}-\d{4}\b/g],
  cc: [/\b(?:\d[ -]?){13,19}\b/g, luhn],
  ipv4: [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g],       // high false-positive (versions, dims)
  uuid: [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi], // identifiers, not personal
};

// Sensitive headers redacted by name (OWASP Logging Cheat Sheet:
// https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).
const SENSITIVE_HEADERS = new Set([
  "authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key",
  "api-key", "x-auth-token", "x-access-token", "x-csrf-token", "x-xsrf-token",
  "x-amz-security-token", "x-amz-credential",
]);

// Sensitive BODY keys: redact the value by the field it sits in, value-blind — the
// field-flagging idea (docs/pii-redaction/DECISIONS.md D16). Catches structured PII the
// value patterns can't (a name has no signature). Matched whole-key on a normalized key
// (lowercased, separators stripped) so `className`/`fileName` don't false-fire.
const normKey = (k) => k.toLowerCase().replace(/[_\-\s]/g, "");
// tuned: high-precision keys that are almost always PII
const KEYS_TUNED = new Set([
  "password", "passwd", "pwd", "secret", "clientsecret", "token", "accesstoken",
  "refreshtoken", "sessiontoken", "apikey", "apisecret", "privatekey", "authorization",
  "email", "emailaddress", "phone", "phonenumber", "mobile", "ssn", "dob", "dateofbirth",
  "firstname", "lastname", "fullname", "givenname", "familyname", "surname",
  "creditcard", "cardnumber", "cvv", "cvc",
]);
// broad: over-redacts; aggressive only. ID-shaped keys are NEVER here — correlation spine (D3).
const KEYS_BROAD = new Set([
  ...KEYS_TUNED, "name", "username", "address", "streetaddress", "postcode", "zip", "zipcode",
]);

// ---- ways (data drives behaviour) -----------------------------------------
const WAYS = {
  // floor: structural only — sensitive headers by name, no content scanning
  structural: { patterns: [], headers: true, keys: new Set() },
  // recommended: high-precision content patterns + precise key names, pruned of FP-prone ones
  tuned: { patterns: ["email", "jwt", "bearer", "ssn", "cc"], headers: true, keys: KEYS_TUNED },
  // the recommendation's literal default set, incl. the false-positive magnets
  aggressive: { patterns: ["email", "jwt", "bearer", "ssn", "cc", "ipv4", "uuid"], headers: true, keys: KEYS_BROAD },
};

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const pos = argv.filter((a) => !a.startsWith("--"));
const [input, outArg] = pos;
const all = flags.includes("--all");
const wayArg = (flags.find((f) => f.startsWith("--way=")) || "").split("=")[1] || "tuned";

if (!input) {
  console.error("usage: node scripts/redact-report.mjs <input.html> [output.html] [--all|--way=NAME]");
  console.error("ways:", Object.keys(WAYS).join(", "));
  process.exit(2);
}
if (!existsSync(input)) { console.error(`error: no such file: ${input}`); process.exit(2); }
if (!all && !WAYS[wayArg]) { console.error(`error: unknown way "${wayArg}". ways: ${Object.keys(WAYS).join(", ")}`); process.exit(2); }

// ---- engine ---------------------------------------------------------------
const makeRedactor = (way) => {
  const patterns = WAYS[way].patterns.map((id) => [id, ...PATTERN_LIB[id]]);
  const keys = WAYS[way].keys;
  const stats = {};
  const bump = (t) => (stats[t] = (stats[t] || 0) + 1);
  const redactString = (s) => {
    let out = s;
    for (const [type, re, validate] of patterns) {
      out = out.replace(re, (m) => { if (validate && !validate(m)) return m; bump(type); return `[REDACTED:${type}]`; });
    }
    return out;
  };
  // parse a JSON-string body, redact the structure (so key-name pass + patterns reach
  // leaves), re-serialize. Falls back to string-level pattern redaction if not JSON.
  const redactJsonBody = (raw) => {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return redactString(raw); }
    if (parsed === null || typeof parsed !== "object") return redactString(raw);
    return JSON.stringify(redact(parsed));
  };
  // deep walk: redact string leaves; redact sensitive headers by name. Patterns
  // replace only the matched substring, so JSON/structure stays intact.
  const redact = (x) => {
    if (typeof x === "string") return redactString(x);
    if (Array.isArray(x)) return x.map(redact);
    if (x && typeof x === "object") {
      const o = {};
      for (const [k, v] of Object.entries(x)) {
        const lk = k.toLowerCase();
        if (WAYS[way].headers && (lk === "requestheaders" || lk === "responseheaders") && v && typeof v === "object" && !Array.isArray(v)) {
          const hdr = {};
          for (const [hk, hv] of Object.entries(v)) {
            if (SENSITIVE_HEADERS.has(hk.toLowerCase())) { hdr[hk] = "[REDACTED:header]"; bump("header"); }
            else hdr[hk] = redact(hv);
          }
          o[k] = hdr;
        } else if (keys.has(normKey(k)) && (typeof v === "string" || typeof v === "number")) {
          // value-blind: this field is PII by name (D16). Nested objects still recurse below.
          o[k] = "[REDACTED:field]"; bump("field");
        } else if ((lk === "requestbody" || lk === "responsebody") && typeof v === "string") {
          // bodies are captured as raw JSON strings (background.js:171) — parse → walk
          // → re-serialize so the key-name pass (D16) and patterns reach the leaves.
          // Non-JSON (form/multipart/XML) falls back to string-level pattern redaction.
          o[k] = redactJsonBody(v);
        } else o[k] = redact(v);
      }
      return o;
    }
    return x;
  };
  return { redact, stats };
};

// ---- swap embedded data + manifest, leave everything else untouched -------
// #openjam-ai (manifest) is plain JSON — same contract as report-builder.js.
// #openjam-data is gzip+base64 (issue #44) — decode/re-encode with the same
// codec bundle report-builder.js inlines into the export, so a redacted file
// still opens: no esc() needed on that side, base64's alphabet can't contain "<".
const esc = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const srcHtml = readFileSync(input, "utf8");
const grab = (html, id) => {
  const m = html.match(new RegExp(`(<script id="${id}"[^>]*>)([\\s\\S]*?)(</script>)`));
  return m ? { open: m[1], body: m[2], close: m[3], whole: m[0] } : null;
};

const data0 = grab(srcHtml, "openjam-data");
if (!data0) { console.error('error: no <script id="openjam-data"> found — is this an OpenJam report?'); process.exit(1); }
const ai0 = grab(srcHtml, "openjam-ai"); // manifest is optional

const base = input.replace(/(\.html?)?$/i, "");
const ways = all ? Object.keys(WAYS) : [wayArg];

for (const way of ways) {
  const { redact, stats } = makeRedactor(way);
  // Replace via a FUNCTION so `$` in the JSON isn't read as a String.replace
  // special pattern ($&, $', $`) — that would splice the document into itself.
  let html = srcHtml.replace(data0.whole, () => data0.open + encodeOjData(redact(decodeOjData(data0.body))) + data0.close);
  if (ai0) html = html.replace(ai0.whole, () => ai0.open + esc(redact(JSON.parse(ai0.body))) + ai0.close);

  // corruption canary: #openjam-ai stays plain JSON (redaction ~ token substitution,
  // output ≈ input there), and #openjam-data's redacted content re-gzips through the
  // same codec (redaction tokens are themselves repetitive, so this side typically
  // shrinks, not grows) — either way a >1.5x blowup means something broke, not a
  // normal redaction outcome.
  if (html.length > srcHtml.length * 1.5) {
    console.error(`error [${way}]: output ${html.length}B >> input ${srcHtml.length}B — refusing to write (likely corruption).`);
    continue;
  }
  const out = !all && outArg ? outArg : `${base}.${way}.redacted.html`;
  writeFileSync(out, html);
  console.log(`[${way}] -> ${out}  ${JSON.stringify(stats)}`);
}
