#!/usr/bin/env node

// Deterministic Codex CLI shim for tests.
// Emits only the NDJSON contract the CodexAdapter consumes.

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("codex-cli 0.147.0\n");
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
  emit({ type: "turn.failed", error: { message: "codex auth failed" } });
  process.exit(0);
} else {
  // Default: simple success flow matching Codex CLI 0.147.0 JSONL schema.
  emit({ type: "thread.started", thread_id: "shim-thread-001" });
  emit({ type: "turn.started" });
  emit({ type: "item.completed", item: { type: "agent_message", text: "Hello from codex shim." } });
  emit({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 5 } });
  process.exit(0);
}
