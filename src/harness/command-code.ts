import { parseNdjson, JsonlParseError } from "./jsonl.js";
import { spawnChild } from "./spawn.js";
import type { HarnessAdapter, HarnessEvent, HarnessRunRequest, Usage } from "./types.js";

export interface CommandCodeAdapterOptions {
  cmdPath?: string;
}

function serializeMessages(messages: HarnessRunRequest["messages"]): string {
  return messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");
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

  constructor(opts?: CommandCodeAdapterOptions) {
    this.cmdPath = opts?.cmdPath ?? "cmd";
  }

  async health() {
    return { ok: true as const, message: "Command-Code adapter ready" };
  }

  async listModels() {
    return ["deepseek/deepseek-v4-flash"];
  }

  async *run(request: HarnessRunRequest): AsyncGenerator<HarnessEvent> {
    const prompt = serializeMessages(request.messages);
    const args = [
      "-p",
      "--output-format", "json",
      "-m", request.model,
      prompt,
    ];

    const child = spawnChild({ command: this.cmdPath, args });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    if (request.timeoutMs) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, request.timeoutMs);
    }

    const ccEvents: CcEvent[] = [];

    try {
      for await (const obj of parseNdjson(child.stdout!)) {
        ccEvents.push(obj as CcEvent);
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
      yield { type: "failed", message: `Command-Code timed out after ${request.timeoutMs}ms`, retryable: true };
      return;
    }

    if (exitCode !== 0 && exitCode !== null) {
      yield { type: "failed", message: `Command-Code exited with code ${exitCode}`, retryable: false };
      return;
    }

    for (const event of normalizeCcEvents(ccEvents)) {
      yield event;
    }
  }

  async cancel(_runId: string): Promise<void> {
    // TODO: implement in Phase 03
  }
}
