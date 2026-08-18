import { spawn, type ChildProcess } from "node:child_process";
import { parseNdjson, JsonlParseError } from "../harness/jsonl.js";

export interface ProcessRunnerOptions {
  env?: Record<string, string>;
  timeoutMs?: number;
}

export type ProcessRunnerEvent =
  | { type: "jsonl"; value: Record<string, unknown> }
  | { type: "exit"; code: number | null }
  | { type: "jsonl_error"; error: JsonlParseError };

export class ProcessTimedOutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Process timed out after ${timeoutMs}ms.`);
    this.name = "ProcessTimedOutError";
  }
}

export class ProcessCancelledError extends Error {
  constructor(public readonly runId: string) {
    super(`Process ${runId} was cancelled.`);
    this.name = "ProcessCancelledError";
  }
}

export class ProcessRunner {
  private children = new Map<string, ChildProcess>();
  private cancelled = new Set<string>();

  async *run(
    runId: string,
    command: string,
    args: string[],
    options: ProcessRunnerOptions = {},
  ): AsyncGenerator<ProcessRunnerEvent> {
    const env = options.env ?? process.env;
    const child = spawn(command, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    this.children.set(runId, child);

    // Prompts are passed via argv, so close stdin immediately. Some CLIs
    // (e.g. opencode run) wait for stdin EOF and hang otherwise.
    child.stdin?.end();

    // Drain stderr so a chatty CLI cannot block on a full pipe buffer.
    child.stderr?.on("data", () => {});

    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, options.timeoutMs);
    }

    try {
      for await (const value of parseNdjson(child.stdout!)) {
        yield { type: "jsonl", value };
      }
    } catch (err) {
      if (err instanceof JsonlParseError) {
        child.kill("SIGKILL");
        yield { type: "jsonl_error", error: err };
        return;
      }
      throw err;
    } finally {
      if (timeout) clearTimeout(timeout);
      this.children.delete(runId);
    }

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("close", (code) => resolve(code));
    });

    if (this.cancelled.delete(runId)) {
      throw new ProcessCancelledError(runId);
    }

    if (timedOut) {
      throw new ProcessTimedOutError(options.timeoutMs!);
    }

    yield { type: "exit", code: exitCode };
  }

  cancel(runId: string): void {
    const child = this.children.get(runId);
    if (!child) return;

    this.cancelled.add(runId);
    child.kill("SIGTERM");

    const grace = setTimeout(() => {
      if (this.children.has(runId)) {
        child.kill("SIGKILL");
      }
    }, 2000);
    grace.unref?.();
  }
}
