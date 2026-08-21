import { describe, it, expect } from "vitest";
import { ProcessRunner, ProcessTimedOutError, ProcessCancelledError } from "./process-runner.js";

async function collect(runId: string, command: string, args: string[], timeoutMs?: number) {
  const runner = new ProcessRunner();
  const events: unknown[] = [];
  try {
    for await (const event of runner.run(runId, command, args, { timeoutMs })) {
      events.push(event);
    }
    return { events, error: undefined };
  } catch (err) {
    return { events, error: err };
  }
}

describe("ProcessRunner", () => {
  it("spawns safely and captures stdout JSONL plus exit code", async () => {
    const result = await collect(
      "r1",
      "node",
      ["-e", 'console.log(JSON.stringify({ type: "completed", text: "ok" }))'],
    );

    expect(result.error).toBeUndefined();
    expect(result.events).toEqual([
      { type: "jsonl", value: { type: "completed", text: "ok" } },
      { type: "exit", code: 0 },
    ]);
  });

  it("captures a non-zero exit code", async () => {
    const result = await collect("r2", "node", ["-e", "process.exit(3)"]);
    expect(result.error).toBeUndefined();
    expect(result.events).toEqual([{ type: "exit", code: 3 }]);
  });

  it("throws ProcessTimedOutError when the process exceeds timeoutMs", async () => {
    const result = await collect("r3", "node", ["-e", "setInterval(() => {}, 1000000)"], 200);
    expect(result.error).toBeInstanceOf(ProcessTimedOutError);
    expect((result.error as ProcessTimedOutError).timeoutMs).toBe(200);
  });

  it("surfaces JSONL parse failures as a jsonl_error event", async () => {
    const result = await collect("r4", "node", ["-e", "console.log('this is not json')"]);
    expect(result.error).toBeUndefined();
    expect(result.events[0]).toMatchObject({ type: "jsonl_error" });
  });

  it("cancels a cooperative child via SIGTERM", async () => {
    const runner = new ProcessRunner();

    const consume = (async () => {
      try {
        for await (const _ of runner.run("r5", "node", ["-e", "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000000)"])) {
          void _;
        }
        return undefined;
      } catch (err) {
        return err;
      }
    })();

    await new Promise((r) => setTimeout(r, 150));
    runner.cancel("r5");

    const err = await consume;
    expect(err).toBeInstanceOf(ProcessCancelledError);
  });

  it("passing env REPLACES the environment instead of merging", async () => {
    const runner = new ProcessRunner();
    const events: unknown[] = [];

    for await (const event of runner.run(
      "env-test",
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify({HOME: process.env.HOME, CUSTOM: process.env.CUSTOM}))"],
      { env: { CUSTOM: "yes", PATH: process.env.PATH ?? "" } },
    )) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    const jsonl = events[0] as { type: string; value: Record<string, unknown> };
    expect(jsonl.type).toBe("jsonl");
    expect(jsonl.value.CUSTOM).toBe("yes");
    expect(jsonl.value.HOME).toBeUndefined();
  });

  it("kills a child that ignores SIGTERM after the grace period", async () => {
    const runner = new ProcessRunner();
    const startedAt = Date.now();

    const consume = (async () => {
      try {
        for await (const _ of runner.run("r6", "node", ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000000)"])) {
          void _;
        }
        return undefined;
      } catch (err) {
        return err;
      }
    })();

    await new Promise((r) => setTimeout(r, 150));
    runner.cancel("r6");

    const err = await consume;
    expect(err).toBeInstanceOf(ProcessCancelledError);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2000);
  });

  it("kills a detached process group on cancel", async () => {
    const runner = new ProcessRunner();

    const consume = (async () => {
      try {
        for await (const _ of runner.run("r7", "node", ["-e", "const { spawn } = require('child_process'); const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000000)'], { stdio: 'ignore' }); process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000000)"])) {
          void _;
        }
        return undefined;
      } catch (err) {
        return err;
      }
    })();

    await new Promise((r) => setTimeout(r, 200));
    runner.cancel("r7");

    const err = await consume;
    expect(err).toBeInstanceOf(ProcessCancelledError);
  });
});
