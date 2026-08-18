import { randomUUID } from "node:crypto";
import type { ChatMessage, HarnessAdapter, HarnessEvent, HarnessRunRequest, Usage } from "../harness/types.js";
import { AdapterRegistry } from "./adapter-registry.js";
import { estimateCostUsd } from "./cost.js";
import { resolveModelId } from "./model-resolution.js";
import { PricingRegistry } from "./pricing.js";
import { ProcessCancelledError, ProcessTimedOutError } from "./process-runner.js";
import { TaskQueue, QueueFullError } from "./queue.js";
import { RunStore, type RunStatus } from "./store.js";

export interface RunServiceOptions {
  adapterRegistry: AdapterRegistry;
  store: RunStore;
  queue?: TaskQueue;
  defaultTimeoutMs?: number;
  pricing?: PricingRegistry;
}

export interface RunServiceRequest {
  model: string;
  messages: ChatMessage[];
  timeoutMs?: number;
  apiKeyId?: string;
  allowedModels?: string[];
}

export interface RunStreamRequest {
  model: string;
  messages: ChatMessage[];
  timeoutMs?: number;
  apiKeyId?: string;
  allowedModels?: string[];
}

export interface RunStreamHandle {
  runId: string;
  events: AsyncGenerator<HarnessEvent>;
  cancel(): Promise<void>;
}

export type RunServiceResult =
  | { status: "completed"; runId: string; events: HarnessEvent[] }
  | { status: "failed"; runId: string; message: string; retryable?: boolean }
  | { status: "timed_out"; runId: string; message: string }
  | { status: "cancelled"; runId: string; message: string };

export class RunRejectedError extends Error {
  constructor(
    public readonly code: "invalid_model" | "unknown_harness" | "queue_full" | "model_not_allowed",
    message: string,
  ) {
    super(message);
    this.name = "RunRejectedError";
  }
}

class HarnessEventChannel {
  private buffer: HarnessEvent[] = [];
  private waiters: Array<(result: IteratorResult<HarnessEvent>) => void> = [];
  private finished = false;
  private failure: unknown;

  push(event: HarnessEvent): void {
    if (this.finished) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.buffer.push(event);
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.notifyDone();
  }

  fail(error: unknown): void {
    if (this.finished) return;
    this.finished = true;
    this.failure = error;
    this.notifyDone();
  }

  async *iterate(): AsyncGenerator<HarnessEvent> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift()!;
        continue;
      }

      if (this.finished) {
        if (this.failure !== undefined) throw this.failure;
        return;
      }

      const result = await new Promise<IteratorResult<HarnessEvent>>((resolve) => {
        this.waiters.push(resolve);
      });

      if (result.done) {
        if (this.failure !== undefined) throw this.failure;
        return;
      }

      yield result.value;
    }
  }

  private notifyDone(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter({ value: undefined, done: true });
  }
}

export class RunService {
  private readonly registry: AdapterRegistry;
  private readonly store: RunStore;
  private readonly queue: TaskQueue;
  private readonly defaultTimeoutMs: number;
  private readonly pricing: PricingRegistry;
  private readonly adaptersByRun = new Map<string, HarnessAdapter>();
  private readonly cancelledRuns = new Set<string>();

  constructor(options: RunServiceOptions) {
    this.registry = options.adapterRegistry;
    this.store = options.store;
    this.queue = options.queue ?? new TaskQueue();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.pricing = options.pricing ?? new PricingRegistry();
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

    const fullModelId = `${harness}/${canonicalModel}`;
    if (request.allowedModels && request.allowedModels.length > 0 && !request.allowedModels.includes(fullModelId)) {
      return this.reject(
        request.model,
        harness,
        canonicalModel,
        "model_not_allowed",
        `Model "${fullModelId}" is not in the allowed list.`,
      );
    }

    const runId = randomUUID();
    this.store.createRun({
      id: runId,
      requestedModel: request.model,
      resolvedModel: canonicalModel,
      harness,
      apiKeyId: request.apiKeyId,
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

  getRun(runId: string) {
    return this.store.getRun(runId);
  }

  getEstimatedCostSince(keyId: string, sinceIso: string): number {
    return this.store.sumEstimatedCostSince(keyId, sinceIso);
  }

  async stream(request: RunStreamRequest): Promise<RunStreamHandle> {
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

    const fullModelId = `${harness}/${canonicalModel}`;
    if (request.allowedModels && request.allowedModels.length > 0 && !request.allowedModels.includes(fullModelId)) {
      return this.reject(
        request.model,
        harness,
        canonicalModel,
        "model_not_allowed",
        `Model "${fullModelId}" is not in the allowed list.`,
      );
    }

    const runId = randomUUID();
    this.store.createRun({
      id: runId,
      requestedModel: request.model,
      resolvedModel: canonicalModel,
      harness,
      apiKeyId: request.apiKeyId,
    });
    this.adaptersByRun.set(runId, adapter);

    const channel = new HarnessEventChannel();
    let markStarted: (() => void) | undefined;
    let markStartFailed: ((err: unknown) => void) | undefined;
    const started = new Promise<void>((resolve, reject) => {
      markStarted = resolve;
      markStartFailed = reject;
    });

    const enqueuePromise = this.queue.enqueue(() => {
      markStarted?.();
      return this.executeStreamRun(runId, adapter, harness, canonicalModel, request, channel);
    });

    enqueuePromise.catch((err) => {
      this.adaptersByRun.delete(runId);
      if (err instanceof QueueFullError) {
        this.store.markFinished(runId, "rejected", err.message);
        const rejected = new RunRejectedError("queue_full", err.message);
        channel.fail(rejected);
        markStartFailed?.(rejected);
      } else {
        channel.fail(err);
        markStartFailed?.(err);
      }
    });

    await started;

    return {
      runId,
      events: channel.iterate(),
      cancel: () => this.cancel(runId),
    };
  }

  async cancel(runId: string): Promise<void> {
    this.cancelledRuns.add(runId);
    const adapter = this.adaptersByRun.get(runId);
    if (adapter) {
      await adapter.cancel(runId);
    }
  }

  private async reject(
    requestedModel: string,
    harness: string | undefined,
    canonicalModel: string | undefined,
    code: "invalid_model" | "unknown_harness" | "queue_full" | "model_not_allowed",
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

    if (this.cancelledRuns.has(runId)) {
      this.store.markFinished(runId, "cancelled", "Run was cancelled before it started.");
      return { status: "cancelled", runId, message: "Run was cancelled before it started." };
    }

    const events: HarnessEvent[] = [];
    let sessionId: string | undefined;
    let usage: Usage | undefined;
    let terminal: RunStatus = "completed";
    let errorMessage: string | undefined;
    let retryable: boolean | undefined;

    try {
      for await (const event of adapter.run(harnessRequest)) {
        if (this.cancelledRuns.has(runId)) {
          terminal = "cancelled";
          break;
        }

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
      if (err instanceof ProcessCancelledError || this.cancelledRuns.has(runId)) {
        this.store.markFinished(runId, "cancelled", "Run was cancelled.");
        return { status: "cancelled", runId, message: "Run was cancelled." };
      }
      this.store.markFinished(runId, "failed", err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      this.cancelledRuns.delete(runId);
    }

    if (sessionId || usage) {
      const fullModelId = `${harness}/${canonicalModel}`;
      const estimatedCostUsd = usage ? estimateCostUsd(usage, this.pricing.get(fullModelId)) : null;
      this.store.updateRunMeta(runId, {
        sessionId: sessionId ?? null,
        usageJson: usage ? JSON.stringify(usage) : null,
        estimatedCostUsd,
      });
    }

    if (terminal === "cancelled") {
      this.store.markFinished(runId, "cancelled", "Run was cancelled.");
      return { status: "cancelled", runId, message: "Run was cancelled." };
    }

    if (terminal === "failed") {
      this.store.markFinished(runId, "failed", errorMessage);
      return { status: "failed", runId, message: errorMessage ?? "Harness failed.", retryable };
    }

    this.store.markFinished(runId, "completed");
    return { status: "completed", runId, events };
  }

  private async executeStreamRun(
    runId: string,
    adapter: HarnessAdapter,
    harness: string,
    canonicalModel: string,
    request: RunStreamRequest,
    channel: HarnessEventChannel,
  ): Promise<void> {
    this.store.markStarted(runId);
    this.store.appendEvent(runId, "queued_to_running", { harness, model: canonicalModel });

    const harnessRequest: HarnessRunRequest = {
      runId,
      model: canonicalModel,
      messages: request.messages,
      stream: true,
      timeoutMs: request.timeoutMs ?? this.defaultTimeoutMs,
    };

    let sessionId: string | undefined;
    let usage: Usage | undefined;
    let terminal: RunStatus = "completed";
    let errorMessage: string | undefined;
    let retryable: boolean | undefined;

    try {
      if (this.cancelledRuns.has(runId)) {
        terminal = "cancelled";
        errorMessage = "Run was cancelled before it started.";
      } else {
        for await (const event of adapter.run(harnessRequest)) {
          if (this.cancelledRuns.has(runId)) {
            terminal = "cancelled";
            break;
          }

          this.store.appendEvent(runId, event.type, event);
          channel.push(event);

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
      }
    } catch (err) {
      if (err instanceof ProcessTimedOutError) {
        this.store.markFinished(runId, "timed_out", err.message);
        channel.fail(err);
        return;
      }
      if (err instanceof ProcessCancelledError || this.cancelledRuns.has(runId)) {
        this.store.markFinished(runId, "cancelled", "Run was cancelled.");
        channel.fail(new ProcessCancelledError(runId));
        return;
      }
      this.store.markFinished(runId, "failed", err instanceof Error ? err.message : String(err));
      channel.fail(err);
      return;
    } finally {
      this.cancelledRuns.delete(runId);
    }

    if (sessionId || usage) {
      const fullModelId = `${harness}/${canonicalModel}`;
      const estimatedCostUsd = usage ? estimateCostUsd(usage, this.pricing.get(fullModelId)) : null;
      this.store.updateRunMeta(runId, {
        sessionId: sessionId ?? null,
        usageJson: usage ? JSON.stringify(usage) : null,
        estimatedCostUsd,
      });
    }

    if (terminal === "cancelled") {
      this.store.markFinished(runId, "cancelled", errorMessage ?? "Run was cancelled.");
      channel.fail(new ProcessCancelledError(runId));
      return;
    }

    if (terminal === "failed") {
      this.store.markFinished(runId, "failed", errorMessage);
      channel.finish();
      return;
    }

    this.store.markFinished(runId, "completed");
    channel.finish();
  }
}
