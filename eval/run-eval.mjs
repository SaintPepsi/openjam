// eval/run-eval.mjs
// Opt-in real-LLM A/B eval. NOT run in CI (needs an agent CLI + tokens).
// For each variant, runs the agent TRIALS times asking it to find+diagnose the
// failure, then records: correct? (answer names endpoint+status+phrase),
// num_turns (effort proxy), output tokens. Prints a comparison + verdict.
//
//   npm run build && node eval/build-reports.mjs && node eval/run-eval.mjs
//
// Default agent is headless Claude Code (`claude -p --output-format json`).
// Override with OPENJAM_EVAL_AGENT_CMD (a command that takes the prompt as its
// last argv and prints Claude Code JSON to stdout). OPENJAM_EVAL_TRIALS sets N.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { GROUND_TRUTH } from "./fixture-report.mjs";

const trialsEnv = Number(process.env.OPENJAM_EVAL_TRIALS);
const TRIALS = Number.isInteger(trialsEnv) && trialsEnv > 0 ? trialsEnv : 3;
const VARIANTS = ["with-manifest", "without-manifest"];
const PROMPT = (file) =>
  `Read the OpenJam bug report at ${file}. Identify the single failing network request and explain the cause. ` +
  `State the HTTP method and path, the status code, and the error message.`;

function runAgent(file) {
  const custom = process.env.OPENJAM_EVAL_AGENT_CMD;
  const cmd = custom || "claude";
  const args = custom ? [PROMPT(file)] : ["-p", PROMPT(file), "--output-format", "json"];
  const raw = execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const json = JSON.parse(raw);
  return { text: json.result || "", turns: json.num_turns ?? null, tokens: json.usage?.output_tokens ?? null };
}

function isCorrect(text) {
  const t = text.toLowerCase();
  return (
    t.includes(GROUND_TRUTH.endpoint.toLowerCase()) &&
    t.includes(String(GROUND_TRUTH.status)) &&
    t.includes(GROUND_TRUTH.phrase.toLowerCase())
  );
}

const results = {};
for (const v of VARIANTS) {
  const file = path.join(import.meta.dirname, "out", v + ".html");
  const trials = [];
  for (let i = 0; i < TRIALS; i++) {
    const r = runAgent(file);
    const correct = isCorrect(r.text);
    trials.push({ correct, turns: r.turns, tokens: r.tokens });
    console.log(`[${v}] trial ${i + 1}/${TRIALS}: correct=${correct} turns=${r.turns} tokens=${r.tokens}`);
  }
  const avg = (k) => Math.round(trials.reduce((s, t) => s + (t[k] || 0), 0) / TRIALS);
  results[v] = { correctRate: trials.filter((t) => t.correct).length / TRIALS, avgTurns: avg("turns"), avgTokens: avg("tokens") };
}

console.table(results);
const a = results["with-manifest"], b = results["without-manifest"];
const pass = a.correctRate >= b.correctRate && a.avgTurns <= b.avgTurns;
console.log(pass ? "PASS: manifest diagnosis at least as correct, with no more effort." : "REVIEW: manifest did not help on this run.");
