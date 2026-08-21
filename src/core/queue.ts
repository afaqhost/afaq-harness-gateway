export interface QueueOptions {
  concurrency?: number;
  capacity?: number;
  queueTimeoutMs?: number;
}

export class QueueFullError extends Error {
  constructor(capacity: number) {
    super(`Queue is full (capacity ${capacity}).`);
    this.name = "QueueFullError";
  }
}

export class QueueTimeoutError extends Error {
  constructor(queueTimeoutMs: number) {
    super(`Queue entry timed out after ${queueTimeoutMs}ms.`);
    this.name = "QueueTimeoutError";
  }
}

interface QueueItem<T> {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class TaskQueue {
  private readonly concurrency: number;
  private readonly capacity: number;
  private readonly queueTimeoutMs: number | undefined;
  private readonly pending: QueueItem<unknown>[] = [];
  private running = 0;

  constructor(options: QueueOptions = {}) {
    this.concurrency = options.concurrency ?? 1;
    this.capacity = options.capacity ?? 100;
    this.queueTimeoutMs = options.queueTimeoutMs;

    if (this.concurrency < 1) {
      throw new Error("Queue concurrency must be >= 1.");
    }
    if (this.capacity < 1) {
      throw new Error("Queue capacity must be >= 1.");
    }
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.pending.length + this.running >= this.capacity) {
      return Promise.reject(new QueueFullError(this.capacity));
    }

    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<unknown> = {
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      if (this.queueTimeoutMs && this.queueTimeoutMs > 0) {
        item.timer = setTimeout(() => {
          const idx = this.pending.indexOf(item);
          if (idx < 0) return;
          this.pending.splice(idx, 1);
          reject(new QueueTimeoutError(this.queueTimeoutMs!));
        }, this.queueTimeoutMs);
        item.timer.unref?.();
      }

      this.pending.push(item);
      this.drain();
    });
  }

  get size(): number {
    return this.pending.length;
  }

  get active(): number {
    return this.running;
  }

  private drain(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const item = this.pending.shift()!;
      if (item.timer) clearTimeout(item.timer);
      this.running++;
      item
        .task()
        .then(item.resolve, item.reject)
        .finally(() => {
          this.running--;
          this.drain();
        });
    }
  }
}
