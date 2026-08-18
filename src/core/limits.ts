export class UsageLimitError extends Error {
  constructor(
    public readonly code: "rpm_exceeded" | "concurrency_exceeded" | "budget_exceeded",
    message: string,
  ) {
    super(message);
    this.name = "UsageLimitError";
  }
}

export class UsageLimiter {
  private readonly rpmTimestamps = new Map<string, number[]>();
  private readonly concurrencyCounts = new Map<string, number>();

  checkRpm(keyId: string, rpmLimit: number | null | undefined): void {
    if (rpmLimit == null || rpmLimit <= 0) return;

    const now = Date.now();
    const windowStart = now - 60_000;
    const timestamps = this.rpmTimestamps.get(keyId) ?? [];
    const recent = timestamps.filter((t) => t > windowStart);

    if (recent.length >= rpmLimit) {
      throw new UsageLimitError("rpm_exceeded", `RPM limit of ${rpmLimit} exceeded for key ${keyId}.`);
    }

    recent.push(now);
    this.rpmTimestamps.set(keyId, recent);
  }

  acquireConcurrency(keyId: string, maxConcurrency: number | null | undefined): () => void {
    if (maxConcurrency == null || maxConcurrency <= 0) {
      return () => {};
    }

    const current = this.concurrencyCounts.get(keyId) ?? 0;
    if (current >= maxConcurrency) {
      throw new UsageLimitError(
        "concurrency_exceeded",
        `Concurrency limit of ${maxConcurrency} exceeded for key ${keyId}.`,
      );
    }

    this.concurrencyCounts.set(keyId, current + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.concurrencyCounts.get(keyId) ?? 0;
      if (count <= 1) {
        this.concurrencyCounts.delete(keyId);
      } else {
        this.concurrencyCounts.set(keyId, count - 1);
      }
    };
  }

  checkBudget(monthlySpendUsd: number, budgetUsd: number | null | undefined): void {
    if (budgetUsd == null) return;
    if (monthlySpendUsd >= budgetUsd) {
      throw new UsageLimitError("budget_exceeded", `Monthly budget of $${budgetUsd} exceeded.`);
    }
  }
}
