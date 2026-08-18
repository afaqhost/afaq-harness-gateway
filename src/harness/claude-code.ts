import { spawnSync } from "node:child_process";
import { ProcessRunner } from "../core/process-runner.js";
import type { HarnessAdapter, HarnessEvent, HarnessRunRequest, Usage } from "./types.js";
import { buildMinimalEnv } from "./env.js";
import { serializeMessages } from "./messages.js";

export interface ClaudeCodeAdapterOptions {
  claudePath?: string;
  models?: string[];
  env?: Record<string, string>;
  configDir?: string;
}

const DEFAULT_MODELS = ["claude-sonnet-4-6"];

export function normalizeClaudeCodeEvents(events: Record<string, unknown>[]): HarnessEvent[] {
  const result: HarnessEvent[] = [];
  let sessionId: string | undefined;
  let finalText: string | undefined;
  let hasStreamText = false;

  for (const ev of events) {
    const evType = ev.type as string | undefined;
    const evSubtype = ev.subtype as string | undefined;

    if (evType === "system" && evSubtype === "init") {
      sessionId = ev.session_id as string | undefined;
      result.push({ type: "started", sessionId });
    } else if (evType === "stream_event") {
      const event = ev.event as Record<string, unknown> | undefined;
      if (event?.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta") {
          const text = delta.text as string;
          hasStreamText = true;
          finalText = text;
          result.push({ type: "text_delta", text });
        }
      }
    } else if (evType === "assistant" && !hasStreamText) {
      const message = ev.message as Record<string, unknown> | undefined;
      const content = message?.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            const text = block.text as string;
            finalText = text;
            result.push({ type: "text_delta", text });
          }
        }
      }
    } else if (evType === "result" && evSubtype === "success") {
      const rawUsage = ev.usage as Record<string, unknown> | undefined;
      if (rawUsage) {
        const inputTokens = rawUsage.input_tokens as number | undefined;
        const outputTokens = rawUsage.output_tokens as number | undefined;
        const cachedInputTokens = rawUsage.cache_read_input_tokens as number | undefined;
        const cacheWriteTokens = rawUsage.cache_creation_input_tokens as number | undefined;
        const totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
        const costUsd = ev.total_cost_usd as number | undefined;
        const usage: Usage = {
          inputTokens,
          outputTokens,
          cachedInputTokens,
          cacheWriteTokens,
          totalTokens,
          costUsd,
        };
        result.push({ type: "usage", usage });
        if (finalText !== undefined) {
          result.push({ type: "completed", text: finalText, sessionId: ev.session_id as string | undefined ?? sessionId, usage });
        }
      }
    } else if (evType === "result" && evSubtype !== "success") {
      const message = String(ev.error ?? ev.result ?? "Claude Code run failed");
      result.push({ type: "failed", message, retryable: false });
    } else if (evType === "error") {
      const message = String(ev.error ?? ev.message ?? "Claude Code error");
      result.push({ type: "failed", message, retryable: false });
    }
    // Ignore all other event types (system lifecycle, assistant partial events, etc.)
  }

  return result;
}

export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly id = "claude-code";
  private claudePath: string;
  private models: string[];
  private env: Record<string, string>;
  private runner: ProcessRunner;

  constructor(opts?: ClaudeCodeAdapterOptions) {
    this.claudePath = opts?.claudePath ?? "claude";
    this.models = opts?.models ? [...opts.models] : [...DEFAULT_MODELS];
    const extra: Record<string, string> | undefined = opts?.configDir
      ? { CLAUDE_CONFIG_DIR: opts.configDir }
      : undefined;
    this.env = opts?.env ?? buildMinimalEnv(extra);
    this.runner = new ProcessRunner();
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    try {
      const result = spawnSync(this.claudePath, ["--version"], {
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
      "-p",
      "--output-format", "json",
      "--model", request.model,
      prompt,
    ];

    const claudeEvents: Record<string, unknown>[] = [];
    let exitCode: number | null = null;

    for await (const event of this.runner.run(request.runId, this.claudePath, args, {
      timeoutMs: request.timeoutMs,
      env: this.env,
    })) {
      if (event.type === "jsonl") {
        claudeEvents.push(event.value);
      } else if (event.type === "jsonl_error") {
        yield { type: "failed", message: event.error.message, retryable: false };
        return;
      } else if (event.type === "exit") {
        exitCode = event.code;
      }
    }

    if (exitCode !== null && exitCode !== 0) {
      yield { type: "failed", message: `Claude Code exited with code ${exitCode}`, retryable: false };
      return;
    }

    for (const event of normalizeClaudeCodeEvents(claudeEvents)) {
      yield event;
    }
  }

  async cancel(runId: string): Promise<void> {
    this.runner.cancel(runId);
  }
}
