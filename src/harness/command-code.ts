import { spawnSync } from "node:child_process";
import { ProcessRunner } from "../core/process-runner.js";
import type { HarnessAdapter, HarnessEvent, HarnessRunRequest, Usage } from "./types.js";

export interface CommandCodeAdapterOptions {
  cmdPath?: string;
  models?: string[];
  env?: Record<string, string>;
}

const DEFAULT_MODELS = ["deepseek/deepseek-v4-flash"];
const ENV_ALLOWLIST = ["HOME", "PATH", "USER", "SHELL", "LANG", "LC_ALL", "TMPDIR"];

function buildMinimalEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  return env;
}

export function serializeMessages(messages: HarnessRunRequest["messages"]): string {
  return messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");
}

export function mapCcExitCode(code: number): { message: string; retryable: boolean } {
  switch (code) {
    case 3:
      return { message: "Command-Code authentication error.", retryable: false };
    case 4:
      return { message: "Command-Code permission error.", retryable: false };
    case 5:
      return { message: "Command-Code rate limit exceeded.", retryable: true };
    case 6:
      return { message: "Command-Code network error.", retryable: true };
    case 7:
      return { message: "Command-Code upstream server error.", retryable: true };
    case 8:
      return { message: "Command-Code max turns reached.", retryable: false };
    case 9:
      return { message: "Command-Code no response.", retryable: false };
    case 10:
      return { message: "Command-Code insufficient credits.", retryable: false };
    case 130:
      return { message: "Command-Code interrupted.", retryable: false };
    default:
      return { message: `Command-Code exited with code ${code}.`, retryable: false };
  }
}

interface CcEvent {
  type: "event" | "result";
  event?: { type: string; [key: string]: unknown };
  [key: string]: unknown;
}

export function normalizeCcEvents(events: CcEvent[]): HarnessEvent[] {
  const result: HarnessEvent[] = [];
  let sessionId: string | undefined;

  for (const wrapper of events) {
    if (wrapper.type === "event" && wrapper.event) {
      const ev = wrapper.event;

      if (ev.type.startsWith("thinking_")) continue;

      switch (ev.type) {
        case "run_start":
          sessionId = ev.sessionId as string | undefined;
          result.push({ type: "started", sessionId });
          break;
        case "text_delta":
          result.push({ type: "text_delta", text: ev.delta as string });
          break;
        case "tool_running":
          result.push({ type: "tool_started", tool: ev.toolName as string });
          break;
        case "tool_completed": {
          const blocks = ev.result as Array<{ type: string; text: string }> | undefined;
          const output = blocks?.map((b) => b.text).join("") ?? "";
          result.push({ type: "tool_finished", tool: ev.toolName as string, output, success: true });
          break;
        }
        case "tool_errored": {
          const errorStr = typeof ev.error === "string" ? ev.error : String(ev.error ?? "");
          result.push({ type: "tool_finished", tool: ev.toolName as string, output: errorStr, success: false });
          break;
        }
        case "model_request_end": {
          const rawUsage = ev.usage as Record<string, number> | undefined;
          if (rawUsage) {
            result.push({
              type: "usage",
              usage: mapCcUsage(rawUsage),
            });
          }
          break;
        }
        case "run_end": {
          const runResult = ev.result as Record<string, unknown> | undefined;
          if (runResult) {
            const finalText = runResult.finalText as string | undefined;
            const rawUsage = runResult.usage as Record<string, number> | undefined;
            const runSessionId = (runResult.nextState as Record<string, string> | undefined)?.sessionId ?? sessionId;
            if (finalText !== undefined) {
              result.push({
                type: "completed",
                text: finalText,
                sessionId: runSessionId,
                usage: rawUsage ? mapCcUsage(rawUsage) : undefined,
              });
            }
          }
          break;
        }
      }
    } else if (wrapper.type === "result") {
      const subtype = wrapper.subtype as string | undefined;
      if (subtype === "error") {
        const errMsg = typeof wrapper.error === "string" ? wrapper.error : "Command-Code run failed.";
        result.push({ type: "failed", message: errMsg, retryable: false });
      } else {
        const finalText = wrapper.finalText as string | undefined;
        const rawUsage = wrapper.usage as Record<string, number> | undefined;
        const resultSessionId = wrapper.sessionId as string | undefined;
        if (finalText !== undefined) {
          result.push({
            type: "completed",
            text: finalText,
            sessionId: resultSessionId ?? sessionId,
            usage: rawUsage ? mapCcUsage(rawUsage) : undefined,
          });
        }
      }
    }
  }

  return result;
}

function mapCcUsage(raw: Record<string, number>): Usage {
  return {
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    cachedInputTokens: raw.cacheReadTokens,
    cacheWriteTokens: raw.cacheWriteTokens,
    totalTokens: raw.totalTokens ?? (raw.inputTokens ?? 0) + (raw.outputTokens ?? 0),
  };
}

export class CommandCodeAdapter implements HarnessAdapter {
  readonly id = "command-code";
  private cmdPath: string;
  private models: string[];
  private env: Record<string, string>;
  private runner: ProcessRunner;

  constructor(opts?: CommandCodeAdapterOptions) {
    this.cmdPath = opts?.cmdPath ?? "cmd";
    this.models = opts?.models ? [...opts.models] : [...DEFAULT_MODELS];
    this.env = opts?.env ?? buildMinimalEnv();
    this.runner = new ProcessRunner();
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    try {
      const result = spawnSync(this.cmdPath, ["--version"], {
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
      "-m", request.model,
      prompt,
    ];

    const ccEvents: CcEvent[] = [];
    let exitCode: number | null = null;
    let hadErrorResult = false;

    for await (const event of this.runner.run(request.runId, this.cmdPath, args, {
      timeoutMs: request.timeoutMs,
      env: this.env,
    })) {
      if (event.type === "jsonl") {
        const parsed = event.value as CcEvent;
        ccEvents.push(parsed);
        // Check if this is an error result frame.
        if (parsed.type === "result" && parsed.subtype === "error") {
          hadErrorResult = true;
        }
      } else if (event.type === "jsonl_error") {
        yield { type: "failed", message: event.error.message, retryable: false };
        return;
      } else if (event.type === "exit") {
        exitCode = event.code;
      }
    }

    // If exit code is non-zero and we haven't already handled an error result frame,
    // yield a failed event using the exit code mapping.
    if (exitCode !== null && exitCode !== 0 && !hadErrorResult) {
      yield { type: "failed", ...mapCcExitCode(exitCode) };
      return;
    }

    for (const event of normalizeCcEvents(ccEvents)) {
      yield event;
    }
  }

  async cancel(runId: string): Promise<void> {
    this.runner.cancel(runId);
  }
}
