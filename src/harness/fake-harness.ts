import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProcessRunner } from "../core/process-runner.js";
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
  private runner: ProcessRunner;

  constructor(opts?: FakeHarnessAdapterOptions) {
    this.harnessPath = opts?.harnessPath ?? FAKE_HARNESS_PATH;
    this.extraArgs = opts?.extraArgs ?? [];
    this.runner = new ProcessRunner();
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

    for await (const event of this.runner.run(request.runId, "node", args, { timeoutMs: request.timeoutMs })) {
      if (event.type === "jsonl") {
        yield event.value as HarnessEvent;
      } else if (event.type === "jsonl_error") {
        yield { type: "failed", message: event.error.message, retryable: false };
        return;
      } else if (event.type === "exit") {
        if (event.code !== 0 && event.code !== null) {
          yield { type: "failed", message: `Fake harness exited with code ${event.code}`, retryable: false };
        }
      }
    }
  }

  async cancel(runId: string): Promise<void> {
    this.runner.cancel(runId);
  }
}
