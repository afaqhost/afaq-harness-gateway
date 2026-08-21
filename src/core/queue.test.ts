import { describe, it, expect } from "vitest";
import { TaskQueue, QueueFullError, QueueTimeoutError } from "./queue.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("TaskQueue", () => {
  it("runs tasks in FIFO order", async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    const order: number[] = [];

    const make = (n: number) => () =>
      delay(10).then(() => {
        order.push(n);
        return n;
      });

    const results = await Promise.all([queue.enqueue(make(1)), queue.enqueue(make(2)), queue.enqueue(make(3))]);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("respects the concurrency limit", async () => {
    const queue = new TaskQueue({ concurrency: 2, capacity: 10 });
    let active = 0;
    let maxActive = 0;

    const make = () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active--;
    };

    await Promise.all([queue.enqueue(make()), queue.enqueue(make()), queue.enqueue(make()), queue.enqueue(make())]);
    expect(maxActive).toBe(2);
  });

  it("rejects when the queue is at capacity", async () => {
    const queue = new TaskQueue({ concurrency: 1, capacity: 2 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const blocking = queue.enqueue(async () => {
      await gate;
      return 1;
    });
    const second = queue.enqueue(async () => 2);

    await expect(queue.enqueue(async () => 3)).rejects.toBeInstanceOf(QueueFullError);

    release();
    await Promise.all([blocking, second]);
  });

  it("counts running tasks toward capacity", async () => {
    const queue = new TaskQueue({ concurrency: 1, capacity: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const first = queue.enqueue(async () => {
      await gate;
      return 1;
    });

    await delay(10);
    await expect(queue.enqueue(async () => 2)).rejects.toBeInstanceOf(QueueFullError);

    release();
    await first;
  });

  it("rejects a queued task that exceeds queueTimeoutMs", async () => {
    const queue = new TaskQueue({ concurrency: 1, queueTimeoutMs: 30 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const blocking = queue.enqueue(async () => {
      await gate;
      return 1;
    });

    const queued = queue.enqueue(async () => 2);
    await expect(queued).rejects.toBeInstanceOf(QueueTimeoutError);

    release();
    await blocking;
  });

  it("does not time out a running task", async () => {
    const queue = new TaskQueue({ concurrency: 1, queueTimeoutMs: 30 });
    const result = await queue.enqueue(async () => {
      await delay(80);
      return "done";
    });
    expect(result).toBe("done");
  });
});
