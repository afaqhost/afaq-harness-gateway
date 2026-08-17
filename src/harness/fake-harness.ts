import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNdjson, JsonlParseError } from "./jsonl.js";
import { spawnChild } from "./spawn.js";
import type { HarnessAdapter, HarnessEvent, HarnessRunRequest } from "./types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FAKE_HARNESS_PATH = resolve(__dirname, "../../testing/fixtures/fake-harness/fake-harness.mjs");

export interface FakeHarnessAdapterOptions {
  harnessPath?: string;
  extraArgs?: string[];
}

export class FakeHarnessAdapter implements HarnessAdapter {
  readonly id = "fake-harness";
  private harnessPath: string;
  private extraArgs: string[];

  constructor(opts?: FakeHarnessAdapterOptions) {
    this.harnessPath = opts?.harnessPath ?? FAKE_HARNESS_PATH;
    this.extraArgs = opts?.extraArgs ?? [];
  }

  async health() {
    return { ok: true as const, message: "Fake harness is always healthy" };
  }

  async listModels() {
    return ["fake-model"];
  }

  async *run(request: HarnessRunRequest): AsyncGenerator<HarnessEvent> {
    const args = [
      this.harnessPath,
      "--model", request.model,
      ...this.extraArgs,
    ];

    const timeoutMs = request.timeoutMs;
    const child = spawnChild({ command: "node", args });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    if (timeoutMs) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
    }

    try {
      for await (const obj of parseNdjson(child.stdout!)) {
        yield obj as HarnessEvent;
      }
    } catch (err) {
      if (err instanceof JsonlParseError) {
        yield { type: "failed", message: err.message, retryable: false };
        return;
      }
      throw err;
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("close", resolve);
    });

    if (timedOut) {
      yield { type: "failed", message: `Harness timed out after ${timeoutMs}ms`, retryable: true };
      return;
    }

    if (exitCode !== 0 && exitCode !== null) {
      yield { type: "failed", message: `Fake harness exited with code ${exitCode}`, retryable: false };
    }
  }

  async cancel(_runId: string): Promise<void> {
    // No-op for fake harness
  }
}
