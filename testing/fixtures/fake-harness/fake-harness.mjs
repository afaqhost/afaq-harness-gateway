#!/usr/bin/env node

const args = process.argv.slice(2);
const hang = args.includes("--hang");
const malformed = args.includes("--malformed");

const modelIdx = args.indexOf("--model");
const model = modelIdx !== -1 ? args[modelIdx + 1] : "fake-model";

if (malformed) {
  process.stdout.write("this is not json\n");
  process.exit(0);
}

const sessionId = "fake-session-001";
const text = "Hello from fake harness.";
const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0 };

const events = [
  { type: "started", sessionId },
  { type: "text_delta", text },
  { type: "usage", usage },
  { type: "completed", text, sessionId, usage },
];

for (const event of events) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

if (hang) {
  // Keep the process alive forever
  setInterval(() => {}, 1 << 30);
} else {
  process.exit(0);
}
