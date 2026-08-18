#!/usr/bin/env node

// Deterministic OpenCode CLI shim for tests.
// Emits only the NDJSON contract the OpenCodeAdapter consumes.

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("1.18.15\n");
  process.exit(0);
}

// The prompt is the last positional argument.
const prompt = args[args.length - 1] ?? "";
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

if (prompt.includes("HANG")) {
  // Keep the process alive forever (until killed).
  // Do NOT emit anything — the test expects zero events before timeout.
  setInterval(() => {}, 1 << 30);
} else if (prompt.includes("MALFORMED")) {
  process.stdout.write("this is not json\n");
  process.exit(0);
} else if (prompt.includes("NONZERO")) {
  // Emit nothing useful, exit with code 7.
  process.exit(7);
} else if (prompt.includes("RESULT_ERROR")) {
  emit({ type: "error", message: "opencode auth failed" });
  process.exit(0);
} else {
  // Default: simple success flow matching OpenCode 1.18.15 JSONL schema.
  emit({ type: "step_start", sessionID: "shim-session-001" });
  emit({ type: "text", part: { type: "text", text: "Hello from opencode shim." } });
  emit({
    type: "step-finish",
    part: {
      reason: "stop",
      sessionID: "shim-session-001",
      tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 4, write: 0 } },
      cost: 0,
    },
    sessionID: "shim-session-001",
  });
  process.exit(0);
}
