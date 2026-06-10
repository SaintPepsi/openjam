// Pre-filled GitHub new-issue links for OpenJam's OWN failures (debugger
// attach, report save/load, replay mount) — never for errors captured from
// the recorded page; those are the product. The prefill deliberately includes
// only the error text, extension version, and UA: issue bodies are public, so
// no page URLs or captured data, and the body leads with a PII warning the
// user sees again on GitHub's review page before submitting.

export const PII_WARNING =
  "⚠️ **REMOVE ANY PII BEFORE SUBMITTING** — this issue will be public. " +
  "Check the error text below for names, emails, internal URLs, or tokens " +
  "and delete anything you don't want published.";

// GitHub rejects new-issue URLs past ~8 KB (HTTP 414), so cap the error text
// (https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue#creating-an-issue-from-a-url-query).
const MAX_ERROR_CHARS = 2000;

export function issueURL(error, { version, userAgent }) {
  const text = String(error);
  const title = "[bug] " + text.slice(0, 80);
  const body = [
    PII_WARNING,
    "",
    "**What happened**",
    "<!-- what were you doing when this appeared? -->",
    "",
    "**Error**",
    "```",
    text.slice(0, MAX_ERROR_CHARS),
    "```",
    "",
    `**OpenJam version**: ${version}`,
    `**Browser**: ${userAgent}`,
  ].join("\n");
  const params = new URLSearchParams({ title, body, labels: "bug" });
  return "https://github.com/SaintPepsi/openjam/issues/new?" + params;
}

// Renders "error + report link + loud PII warning" into a container. Shared
// by the popup hint and the viewer failure states.
export function renderErrorReport(container, error, env) {
  container.textContent = "";
  const msg = document.createElement("div");
  msg.textContent = String(error);
  const link = document.createElement("a");
  link.href = issueURL(error, env);
  link.target = "_blank";
  link.textContent = "Report this on GitHub →";
  const warn = document.createElement("div");
  warn.className = "pii-warning";
  warn.textContent =
    "⚠️ The report is public — remove any PII (names, emails, internal URLs) before submitting.";
  container.append(msg, link, warn);
}
