#!/usr/bin/env node

// Deterministic Claude Code CLI shim for tests.
// Emits only the NDJSON contract the ClaudeCodeAdapter consumes.

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("2.1.0\n");
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
  emit({ type: "result", subtype: "error_during_execution", error: "claude auth failed" });
  process.exit(0);
} else {
  // Default: simple success flow matching Claude Code JSON output schema.
  emit({ type: "system", subtype: "init", session_id: "shim-session-001" });
  emit({ type: "assistant", message: { content: [{ type: "text", text: "Hello from claude shim." }] } });
  emit({
    type: "result",
    subtype: "success",
    result: "Hello from claude shim.",
    session_id: "shim-session-001",
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4, cache_creation_input_tokens: 0 },
    total_cost_usd: 0.001,
  });
  process.exit(0);
}
