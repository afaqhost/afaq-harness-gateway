import { spawnSync } from "node:child_process";
import { ProcessRunner } from "../core/process-runner.js";
import type { HarnessAdapter, HarnessEvent, HarnessRunRequest, Usage } from "./types.js";
import { buildMinimalEnv } from "./env.js";
import { serializeMessages } from "./messages.js";

export interface OpenCodeAdapterOptions {
  opencodePath?: string;
  models?: string[];
  env?: Record<string, string>;
  configDir?: string;
}

const DEFAULT_MODELS = ["opencode/mimo-v2.5-free"];

export function normalizeOpenCodeEvents(events: Record<string, unknown>[]): HarnessEvent[] {
  const result: HarnessEvent[] = [];
  let sessionId: string | undefined;
  let finalText: string | undefined;

  for (const ev of events) {
    const evType = ev.type as string | undefined;

    if (evType === "step_start") {
      sessionId = ev.sessionID as string | undefined;
      result.push({ type: "started", sessionId });
    } else if (evType === "text") {
      const part = ev.part as Record<string, unknown> | undefined;
      const text = part?.text as string | undefined;
      if (text !== undefined) {
        finalText = text;
        result.push({ type: "text_delta", text });
      }
    } else if (evType === "step_finish" || evType === "step-finish") {
      const part = ev.part as Record<string, unknown> | undefined;
      const reason = part?.reason as string | undefined;

      if (reason === "error") {
        result.push({ type: "failed", message: "OpenCode run failed", retryable: false });
        continue;
      }

      const tokens = (ev.tokens ?? part?.tokens) as Record<string, unknown> | undefined;
      const cost = (ev.cost ?? part?.cost) as number | undefined;
      if (tokens) {
        const inputTokens = tokens.input as number | undefined;
        const outputTokens = tokens.output as number | undefined;
        const cache = tokens.cache as Record<string, unknown> | undefined;
        const cachedInputTokens = cache?.read as number | undefined;
        const cacheWriteTokens = cache?.write as number | undefined;
        const totalTokens = (tokens.total as number | undefined) ?? ((inputTokens ?? 0) + (outputTokens ?? 0));

        const usage: Usage = {
          inputTokens,
          outputTokens,
          cachedInputTokens,
          cacheWriteTokens,
          totalTokens,
          costUsd: cost,
        };
        result.push({ type: "usage", usage });

        if (finalText !== undefined) {
          result.push({ type: "completed", text: finalText, sessionId, usage });
        }
      }
    } else if (evType === "error") {
      const message = String(ev.message ?? "OpenCode run failed");
      result.push({ type: "failed", message, retryable: false });
    }
    // Ignore all other event types.
  }

  return result;
}

export class OpenCodeAdapter implements HarnessAdapter {
  readonly id = "opencode";
  private opencodePath: string;
  private models: string[];
  private env: Record<string, string>;
  private runner: ProcessRunner;

  constructor(opts?: OpenCodeAdapterOptions) {
    this.opencodePath = opts?.opencodePath ?? "opencode";
    this.models = opts?.models ? [...opts.models] : [...DEFAULT_MODELS];
    const extra: Record<string, string> | undefined = opts?.configDir
      ? { XDG_DATA_HOME: opts.configDir, XDG_CONFIG_HOME: opts.configDir }
      : undefined;
    this.env = opts?.env ?? buildMinimalEnv(extra);
    this.runner = new ProcessRunner();
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    try {
      const result = spawnSync(this.opencodePath, ["--version"], {
        shell: false,
        timeout: 5000,
        env: this.env,
        encoding: "utf-8",
      });
      if (result.status === 0) {
        return { ok: true };
      }
      return { ok: false, message: (result.stderr ?? "").trim() || `exit code ${result.status}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async listModels(): Promise<string[]> {
    return [...this.models];
  }

  async *run(request: HarnessRunRequest): AsyncGenerator<HarnessEvent> {
    const prompt = serializeMessages(request.messages);
    const args = [
      "run",
      "--format", "json",
      "--model", request.model,
      prompt,
    ];

    const opencodeEvents: Record<string, unknown>[] = [];
    let exitCode: number | null = null;

    for await (const event of this.runner.run(request.runId, this.opencodePath, args, {
      timeoutMs: request.timeoutMs,
      env: this.env,
    })) {
      if (event.type === "jsonl") {
        opencodeEvents.push(event.value);
      } else if (event.type === "jsonl_error") {
        yield { type: "failed", message: event.error.message, retryable: false };
        return;
      } else if (event.type === "exit") {
        exitCode = event.code;
      }
    }

    if (exitCode !== null && exitCode !== 0) {
      yield { type: "failed", message: `OpenCode exited with code ${exitCode}`, retryable: false };
      return;
    }

    for (const event of normalizeOpenCodeEvents(opencodeEvents)) {
      yield event;
    }
  }

  async cancel(runId: string): Promise<void> {
    this.runner.cancel(runId);
  }
}
