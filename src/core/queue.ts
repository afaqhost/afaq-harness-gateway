export interface QueueOptions {
  concurrency?: number;
  capacity?: number;
}

export class QueueFullError extends Error {
  constructor(capacity: number) {
    super(`Queue is full (capacity ${capacity}).`);
    this.name = "QueueFullError";
  }
}

interface QueueItem<T> {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

export class TaskQueue {
  private readonly concurrency: number;
  private readonly capacity: number;
  private readonly pending: QueueItem<unknown>[] = [];
  private running = 0;

  constructor(options: QueueOptions = {}) {
    this.concurrency = options.concurrency ?? 1;
    this.capacity = options.capacity ?? Number.POSITIVE_INFINITY;

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
      this.pending.push({ task, resolve, reject } as QueueItem<unknown>);
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
