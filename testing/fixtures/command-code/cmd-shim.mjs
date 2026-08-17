#!/usr/bin/env node

// Deterministic Command-Code CLI shim for tests.
// Emits only the NDJSON contract the adapter consumes.

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("1.26.0\n");
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
} else if (prompt.includes("TOOL_EVENTS")) {
  emit({ type: "event", event: { type: "run_start", sessionId: "shim-session" } });
  emit({ type: "event", event: { type: "tool_running", toolCallId: "tc1", toolName: "read_file", description: "Reading file" } });
  emit({ type: "event", event: { type: "tool_completed", toolCallId: "tc1", toolName: "read_file", result: [{ type: "text", text: "file contents" }] } });
  emit({ type: "event", event: { type: "text_delta", delta: "done" } });
  emit({ type: "result", subtype: "success", sessionId: "shim-session", finalText: "done", usage: { inputTokens: 5, outputTokens: 1 } });
  process.exit(0);
} else if (prompt.includes("RESULT_ERROR")) {
  emit({ type: "result", subtype: "error", error: "Command-Code authentication failed" });
  process.exit(0);
} else if (prompt.includes("NONZERO")) {
  // Emit nothing useful, exit with code 7 (upstream server error).
  process.exit(7);
} else {
  // Default: simple success flow.
  emit({ type: "event", event: { type: "run_start", sessionId: "shim-default" } });
  emit({ type: "event", event: { type: "text_delta", delta: "Hello" } });
  emit({ type: "event", event: { type: "text_delta", delta: " world" } });
  emit({ type: "event", event: { type: "model_request_end", usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } } });
  emit({ type: "result", subtype: "success", sessionId: "shim-default", finalText: "Hello world", usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } });
  process.exit(0);
}
