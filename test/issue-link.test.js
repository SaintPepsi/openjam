import { describe, test, expect } from "bun:test";
import { issueURL, PII_WARNING } from "../issue-link.js";

const env = { version: "0.2.0", userAgent: "TestUA/1.0" };

describe("issueURL", () => {
  test("targets the repo's new-issue page", () => {
    const u = new URL(issueURL("boom", env));
    expect(u.origin + u.pathname).toBe("https://github.com/SaintPepsi/openjam/issues/new");
  });

  test("carries error, version and UA in the prefill", () => {
    const u = new URL(issueURL("debugger attach failed", env));
    expect(u.searchParams.get("title")).toBe("[bug] debugger attach failed");
    const body = u.searchParams.get("body");
    expect(body).toContain("debugger attach failed");
    expect(body).toContain("0.2.0");
    expect(body).toContain("TestUA/1.0");
  });

  test("issue body leads with the PII warning", () => {
    const body = new URL(issueURL("x", env)).searchParams.get("body");
    expect(body.startsWith(PII_WARNING)).toBe(true);
    expect(PII_WARNING).toContain("REMOVE ANY PII");
  });

  test("truncates long errors to keep the URL under GitHub's ~8k limit", () => {
    const u = issueURL("e".repeat(50000), env);
    expect(u.length).toBeLessThan(8000);
    expect(new URL(u).searchParams.get("title").length).toBeLessThanOrEqual(86);
  });

  test("never includes a page URL, even if the error mentions one", () => {
    // The helper only embeds what it's given — no location/tab context exists
    // in its signature. Guard the signature by asserting unknown keys are ignored.
    const body = new URL(
      issueURL("err", { ...env, pageUrl: "https://secret.internal/path" }),
    ).searchParams.get("body");
    expect(body).not.toContain("secret.internal");
  });
});
