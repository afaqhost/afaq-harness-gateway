import { TaskQueue, QueueFullError, QueueTimeoutError } from "../core/queue.js";
import type { Tenant } from "./types.js";

export { QueueFullError, QueueTimeoutError };

export class TenantQueue {
  readonly base: TaskQueue;

  constructor(tenant: Tenant, base?: TaskQueue) {
    if (base) {
      this.base = base;
    } else {
      const concurrency = tenant.limits.concurrency?.maxConcurrentRuns;
      const capacity = tenant.limits.concurrency?.queueCapacity;
      this.base = new TaskQueue({
        concurrency: concurrency !== undefined && concurrency > 0 ? concurrency : 1,
        capacity: capacity !== undefined && capacity > 0 ? capacity : 100,
      });
    }
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return this.base.enqueue(task);
  }

  get size(): number {
    return this.base.size;
  }

  get active(): number {
    return this.base.active;
  }
}
