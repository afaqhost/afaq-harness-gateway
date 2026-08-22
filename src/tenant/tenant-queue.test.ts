import { describe, it, expect } from "vitest";
import { TenantQueue, QueueFullError } from "./tenant-queue.js";
import { TaskQueue } from "../core/queue.js";
import { createTenant } from "./types.js";

describe("TenantQueue", () => {
  it("uses tenant concurrency and capacity limits", () => {
    const t = createTenant({
      id: "t1",
      name: "T",
      rootDir: "/var/t",
      limits: { concurrency: { maxConcurrentRuns: 3, queueCapacity: 50 } },
    });
    const q = new TenantQueue(t);
    expect(q.size).toBe(0);
    expect(q.active).toBe(0);
  });

  it("falls back to default concurrency 1 when limit is undefined", () => {
    const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t" });
    const q = new TenantQueue(t);
    expect(q.base).toBeInstanceOf(TaskQueue);
  });

  it("falls back to default concurrency 1 when limit is zero", () => {
    const t = createTenant({
      id: "t1",
      name: "T",
      rootDir: "/var/t",
      limits: { concurrency: { maxConcurrentRuns: 0 } },
    });
    const q = new TenantQueue(t);
    expect(q.base).toBeInstanceOf(TaskQueue);
  });

  it("falls back to default capacity 100 when limit is undefined", () => {
    const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t" });
    const q = new TenantQueue(t);
    expect(q.base).toBeInstanceOf(TaskQueue);
  });

  it("falls back to default capacity 100 when limit is zero", () => {
    const t = createTenant({
      id: "t1",
      name: "T",
      rootDir: "/var/t",
      limits: { concurrency: { queueCapacity: 0 } },
    });
    const q = new TenantQueue(t);
    expect(q.base).toBeInstanceOf(TaskQueue);
  });

  it("uses provided base queue", () => {
    const base = new TaskQueue({ concurrency: 2, capacity: 10 });
    const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t" });
    const q = new TenantQueue(t, base);
    expect(q.base).toBe(base);
  });

  it("delegates enqueue to the base queue", async () => {
    const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t" });
    const q = new TenantQueue(t);
    const result = await q.enqueue(async () => 42);
    expect(result).toBe(42);
  });

  it("delegates size and active to the base queue", () => {
    const t = createTenant({ id: "t1", name: "T", rootDir: "/var/t" });
    const q = new TenantQueue(t);
    expect(q.size).toBe(q.base.size);
    expect(q.active).toBe(q.base.active);
  });

  it("throws QueueFullError when capacity is exceeded", async () => {
    const t = createTenant({
      id: "t1",
      name: "T",
      rootDir: "/var/t",
      limits: { concurrency: { maxConcurrentRuns: 1, queueCapacity: 1 } },
    });
    const q = new TenantQueue(t);

    let resolveFirst!: () => void;
    const first = q.enqueue(() => new Promise<void>((r) => { resolveFirst = r; }));

    const second = q.enqueue(async () => {});
    await expect(second).rejects.toBeInstanceOf(QueueFullError);

    resolveFirst();
    await first;
  });
});
