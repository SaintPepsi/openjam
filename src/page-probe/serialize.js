// Pure formatting for the page probe (src/page-probe.js): turn console
// arguments into the one-line text the CDP lane produces from RemoteObjects,
// and capture a stack without the probe's own frames. No DOM, no globals
// beyond Error — unit-tested directly.
const MAX_ARG_CHARS = 1000;
const MAX_DEPTH = 3;

function clip(s) {
  return s.length > MAX_ARG_CHARS ? s.slice(0, MAX_ARG_CHARS) + "…" : s;
}

function serializeOne(value, depth, seen) {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "string") return value;
  if (type === "number" || type === "boolean" || type === "bigint" || type === "symbol") return String(value);
  if (type === "undefined") return "undefined";
  if (type === "function") return "function " + (value.name || "") + "()";
  if (value instanceof Error) return value.stack || String(value);
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? "[…]" : "{…}";
  seen.add(value);
  try {
    if (Array.isArray(value)) return "[" + value.map((v) => serializeOne(v, depth + 1, seen)).join(",") + "]";
    if (value instanceof Date) return value.toISOString();
    if (typeof Node !== "undefined" && value instanceof Node) return "<" + String(value.nodeName).toLowerCase() + ">";
    const keys = Object.keys(value);
    const body = keys.map((k) => JSON.stringify(k) + ":" + serializeOne(value[k], depth + 1, seen)).join(",");
    const label = value.constructor && value.constructor.name && value.constructor.name !== "Object" ? value.constructor.name + " " : "";
    return label + "{" + body + "}";
  } catch {
    return "[object]";
  } finally {
    seen.delete(value);
  }
}

// Strings stay raw; everything else JSON-ish, depth-capped, cycle-safe,
// clipped per argument. Joined with spaces like console output.
export function serializeArgs(args) {
  return Array.from(args, (a) => clip(serializeOne(a, 0, new Set()))).join(" ");
}

// Stack frames as "name — url:line:col" strings, matching the CDP lane's
// formatStackTrace output. Drops its own frame plus `skip` caller frames (the
// probe passes 1 for its console wrapper).
export function captureStack(skip = 0) {
  const raw = (new Error().stack || "").split("\n").slice(2 + skip);
  return raw
    .map((l) => l.trim().replace(/^at\s+/, ""))
    .filter(Boolean)
    .map((l) => {
      const m = /^(.*?)\s+\((.*)\)$/.exec(l);
      return m ? m[1] + " — " + m[2] : "(anonymous) — " + l;
    });
}
