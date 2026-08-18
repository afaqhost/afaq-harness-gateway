import { spawnSync } from "node:child_process";
import { ProcessRunner } from "../core/process-runner.js";
import type { HarnessAdapter, HarnessEvent, HarnessRunRequest, Usage } from "./types.js";
import { buildMinimalEnv } from "./env.js";
import { serializeMessages } from "./messages.js";

export interface CodexAdapterOptions {
  codexPath?: string;
  models?: string[];
  env?: Record<string, string>;
  configDir?: string;
}

const DEFAULT_MODELS = ["gpt-5.6-luna"];

export function normalizeCodexEvents(events: Record<string, unknown>[]): HarnessEvent[] {
  const result: HarnessEvent[] = [];
  let sessionId: string | undefined;
  let finalText: string | undefined;

  for (const ev of events) {
    const evType = ev.type as string | undefined;

    if (evType === "thread.started") {
      sessionId = ev.thread_id as string | undefined;
      result.push({ type: "started", sessionId });
    } else if (evType === "item.completed") {
      const item = ev.item as Record<string, unknown> | undefined;
      if (item?.type === "agent_message") {
        const text = item.text as string;
        finalText = text;
        result.push({ type: "text_delta", text });
      }
    } else if (evType === "turn.completed") {
      const rawUsage = ev.usage as Record<string, number> | undefined;
      if (rawUsage) {
        const inputTokens = rawUsage.input_tokens;
        const cachedInputTokens = rawUsage.cached_input_tokens;
        const outputTokens = rawUsage.output_tokens;
        const usage: Usage = {
          inputTokens,
          cachedInputTokens,
          outputTokens,
          totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
        };
        result.push({ type: "usage", usage });
        if (finalText !== undefined) {
          result.push({ type: "completed", text: finalText, sessionId, usage });
        }
      }
    } else if (evType === "turn.failed") {
      const error = ev.error as Record<string, unknown> | undefined;
      const message = String(error?.message ?? "Codex turn failed");
      result.push({ type: "failed", message, retryable: false });
    } else if (evType === "error") {
      const message = String(ev.message ?? "Codex error");
      result.push({ type: "failed", message, retryable: false });
    }
    // Ignore all other event types (thread/turn/item lifecycle, reasoning, etc.)
  }

  return result;
}

export class CodexAdapter implements HarnessAdapter {
  readonly id = "codex";
  private codexPath: string;
  private models: string[];
  private env: Record<string, string>;
  private runner: ProcessRunner;

  constructor(opts?: CodexAdapterOptions) {
    this.codexPath = opts?.codexPath ?? "codex";
    this.models = opts?.models ? [...opts.models] : [...DEFAULT_MODELS];
    const extra: Record<string, string> | undefined = opts?.configDir
      ? { CODEX_HOME: opts.configDir }
      : undefined;
    this.env = opts?.env ?? buildMinimalEnv(extra);
    this.runner = new ProcessRunner();
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    try {
      const result = spawnSync(this.codexPath, ["--version"], {
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
      "exec",
      "--json",
      "--ephemeral",
      "--skip-git-repo-check",
      "-m", request.model,
      prompt,
    ];

    const codexEvents: Record<string, unknown>[] = [];
    let exitCode: number | null = null;
    let hadErrorResult = false;

    for await (const event of this.runner.run(request.runId, this.codexPath, args, {
      timeoutMs: request.timeoutMs,
      env: this.env,
    })) {
      if (event.type === "jsonl") {
        const parsed = event.value;
        codexEvents.push(parsed);
        if (parsed.type === "turn.failed" || parsed.type === "error") {
          hadErrorResult = true;
        }
      } else if (event.type === "jsonl_error") {
        yield { type: "failed", message: event.error.message, retryable: false };
        return;
      } else if (event.type === "exit") {
        exitCode = event.code;
      }
    }

    if (exitCode !== null && exitCode !== 0 && !hadErrorResult) {
      yield { type: "failed", message: `Codex exited with code ${exitCode}`, retryable: false };
      return;
    }

    for (const event of normalizeCodexEvents(codexEvents)) {
      yield event;
    }
  }

  async cancel(runId: string): Promise<void> {
    this.runner.cancel(runId);
  }
}
