# Per-domain redaction overrides (follow-up)

Part of the **PII redaction** epic (`00-epic.md`). **Follow-up — lowest priority.** Depends on capture-time auto-redaction (`02-capture-time.md`).

The capture-time work ships a single **global** on/off for redaction. Some users will want finer control — disable redaction on a known-safe test domain, or force it on for a sensitive one — and a way to see and manage those choices. That needs its own UX design, so it's split out here.

## Behaviour (to be designed)

- **Per-domain override** — the user can set redaction on or off for a specific domain. An override wins over the global default; a domain with no override follows the global setting.
- **Remembered between sessions** — overrides persist (e.g. `chrome.storage`) and survive browser restarts.
- **Manage the list** — a surface where the user can see every domain with an override and whether it's on or off, edit it, or remove it, against the effective global default.

## UX questions to resolve first

- Where does setting an override live — a quick toggle in the popup for the current domain, the options page, or both?
- Where does the management list live — extension options page, or an expanded popup view?
- How are domains scoped — exact host, or host + subdomains / wildcard patterns?
- How does this interact with persisted **manual** redaction rules (from `03-viewer-manual-redaction.md`) — one settings surface or two?

## Acceptance criteria

Each criterion names the evidence that proves it. Try to break each one before accepting it.

- [ ] Override beats global → set global ON, override domain X to OFF; record on X → PII present in export (grep exit 0); record on Y → PII absent (grep exit 1). Evidence: two pasted runs.
- [ ] Persists across restart → set override, restart context, assert it holds. Evidence: `playwright test` output.
- [ ] Isolation → assert stored settings before/after setting X's override: only X's entry changes, Y's effective setting is identical. Evidence: pasted settings diff.
- [ ] **Disconfirming check:** clear X's override → X reverts to following global (not stuck at its old value). Evidence: e2e output.
- [ ] Manage list → view/edit/remove from one surface; after removing X, X follows global again. Evidence: `playwright test` output.

Report any UX decision still open — this is a follow-up and several questions above are deliberately unresolved; naming them is a valid result.

## Scope / notes

- Lowest priority; the epic ships useful without it — the global toggle from `02-capture-time.md` covers the common case.
- No new redaction *behaviour* beyond scoping when capture-time redaction runs; uses the same engine and settings storage.
