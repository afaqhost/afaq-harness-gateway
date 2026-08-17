import { randomUUID } from "node:crypto";
import type { ChatMessage, HarnessAdapter, HarnessEvent, HarnessRunRequest, Usage } from "../harness/types.js";
import { AdapterRegistry } from "./adapter-registry.js";
import { resolveModelId } from "./model-resolution.js";
import { ProcessCancelledError, ProcessTimedOutError } from "./process-runner.js";
import { TaskQueue, QueueFullError } from "./queue.js";
import { RunStore, type RunStatus } from "./store.js";

export interface RunServiceOptions {
  adapterRegistry: AdapterRegistry;
  store: RunStore;
  queue?: TaskQueue;
  defaultTimeoutMs?: number;
}

export interface RunServiceRequest {
  model: string;
  messages: ChatMessage[];
  timeoutMs?: number;
}

export type RunServiceResult =
  | { status: "completed"; runId: string; events: HarnessEvent[] }
  | { status: "failed"; runId: string; message: string; retryable?: boolean }
  | { status: "timed_out"; runId: string; message: string }
  | { status: "cancelled"; runId: string; message: string };

export class RunRejectedError extends Error {
  constructor(
    public readonly code: "invalid_model" | "unknown_harness" | "queue_full",
    message: string,
  ) {
    super(message);
    this.name = "RunRejectedError";
  }
}

export class RunService {
  private readonly registry: AdapterRegistry;
  private readonly store: RunStore;
  private readonly queue: TaskQueue;
  private readonly defaultTimeoutMs: number;
  private readonly adaptersByRun = new Map<string, HarnessAdapter>();

  constructor(options: RunServiceOptions) {
    this.registry = options.adapterRegistry;
    this.store = options.store;
    this.queue = options.queue ?? new TaskQueue();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  }

  async run(request: RunServiceRequest): Promise<RunServiceResult> {
    let harness: string;
    let canonicalModel: string;

    try {
      const resolved = resolveModelId(request.model, (alias) => this.store.getAlias(alias));
      harness = resolved.harness;
      canonicalModel = resolved.model;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.reject(request.model, undefined, undefined, "invalid_model", message);
    }

    const adapter = this.registry.get(harness);
    if (!adapter) {
      return this.reject(
        request.model,
        harness,
        canonicalModel,
        "unknown_harness",
        `Unknown harness "${harness}".`,
      );
    }

    const runId = randomUUID();
    this.store.createRun({
      id: runId,
      requestedModel: request.model,
      resolvedModel: canonicalModel,
      harness,
    });
    this.adaptersByRun.set(runId, adapter);

    try {
      return await this.queue.enqueue(() => this.executeRun(runId, adapter, harness, canonicalModel, request));
    } catch (err) {
      this.adaptersByRun.delete(runId);
      if (err instanceof QueueFullError) {
        this.store.markFinished(runId, "rejected", err.message);
        throw new RunRejectedError("queue_full", err.message);
      }
      throw err;
    }
  }

  async cancel(runId: string): Promise<void> {
    const adapter = this.adaptersByRun.get(runId);
    if (adapter) {
      await adapter.cancel(runId);
    }
  }

  private async reject(
    requestedModel: string,
    harness: string | undefined,
    canonicalModel: string | undefined,
    code: "invalid_model" | "unknown_harness" | "queue_full",
    message: string,
  ): Promise<never> {
    const runId = randomUUID();
    this.store.createRun({
      id: runId,
      requestedModel,
      resolvedModel: canonicalModel,
      harness,
    });
    this.store.appendEvent(runId, "rejected", { message });
    this.store.markFinished(runId, "rejected", message);
    throw new RunRejectedError(code, message);
  }

  private async executeRun(
    runId: string,
    adapter: HarnessAdapter,
    harness: string,
    canonicalModel: string,
    request: RunServiceRequest,
  ): Promise<RunServiceResult> {
    this.store.markStarted(runId);
    this.store.appendEvent(runId, "queued_to_running", { harness, model: canonicalModel });

    const harnessRequest: HarnessRunRequest = {
      runId,
      model: canonicalModel,
      messages: request.messages,
      stream: false,
      timeoutMs: request.timeoutMs ?? this.defaultTimeoutMs,
    };

    const events: HarnessEvent[] = [];
    let sessionId: string | undefined;
    let usage: Usage | undefined;
    let terminal: RunStatus = "completed";
    let errorMessage: string | undefined;
    let retryable: boolean | undefined;

    try {
      for await (const event of adapter.run(harnessRequest)) {
        this.store.appendEvent(runId, event.type, event);
        events.push(event);

        switch (event.type) {
          case "started":
            if (event.sessionId) sessionId = event.sessionId;
            break;
          case "usage":
            usage = event.usage;
            break;
          case "completed":
            if (event.sessionId) sessionId = event.sessionId;
            if (event.usage) usage = event.usage;
            break;
          case "failed":
            terminal = "failed";
            errorMessage = event.message;
            retryable = event.retryable;
            break;
        }

        if (terminal === "failed") break;
      }
    } catch (err) {
      if (err instanceof ProcessTimedOutError) {
        this.store.markFinished(runId, "timed_out", err.message);
        return { status: "timed_out", runId, message: err.message };
      }
      if (err instanceof ProcessCancelledError) {
        this.store.markFinished(runId, "cancelled", err.message);
        return { status: "cancelled", runId, message: err.message };
      }
      this.store.markFinished(runId, "failed", err instanceof Error ? err.message : String(err));
      throw err;
    }

    if (sessionId || usage) {
      this.store.updateRunMeta(runId, {
        sessionId: sessionId ?? null,
        usageJson: usage ? JSON.stringify(usage) : null,
      });
    }

    if (terminal === "failed") {
      this.store.markFinished(runId, "failed", errorMessage);
      return { status: "failed", runId, message: errorMessage ?? "Harness failed.", retryable };
    }

    this.store.markFinished(runId, "completed");
    return { status: "completed", runId, events };
  }
}
