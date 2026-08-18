import { describe, it, expect } from "vitest";
import { UsageLimitError, UsageLimiter } from "./limits.js";

describe("UsageLimiter", () => {
  describe("checkRpm", () => {
    it("does nothing when limit is null or <= 0", () => {
      const limiter = new UsageLimiter();
      expect(() => limiter.checkRpm("k1", null)).not.toThrow();
      expect(() => limiter.checkRpm("k1", undefined)).not.toThrow();
      expect(() => limiter.checkRpm("k1", 0)).not.toThrow();
      expect(() => limiter.checkRpm("k1", -1)).not.toThrow();
    });

    it("allows requests up to the limit", () => {
      const limiter = new UsageLimiter();
      for (let i = 0; i < 3; i++) {
        limiter.checkRpm("k2", 3);
      }
    });

    it("throws when the limit is exceeded", () => {
      const limiter = new UsageLimiter();
      limiter.checkRpm("k3", 1);
      expect(() => limiter.checkRpm("k3", 1)).toThrow(UsageLimitError);
      try {
        limiter.checkRpm("k3", 1);
      } catch (e) {
        expect((e as UsageLimitError).code).toBe("rpm_exceeded");
      }
    });
  });

  describe("acquireConcurrency", () => {
    it("returns a no-op release when limit is null or <= 0", () => {
      const limiter = new UsageLimiter();
      const release1 = limiter.acquireConcurrency("k1", null);
      const release2 = limiter.acquireConcurrency("k1", undefined);
      const release3 = limiter.acquireConcurrency("k1", 0);
      expect(typeof release1).toBe("function");
      release1();
      release2();
      release3();
    });

    it("allows acquiring up to the limit and throws beyond", () => {
      const limiter = new UsageLimiter();
      const r1 = limiter.acquireConcurrency("k2", 2);
      const r2 = limiter.acquireConcurrency("k2", 2);
      expect(() => limiter.acquireConcurrency("k2", 2)).toThrow(UsageLimitError);
      r1();
      // After releasing one, we can acquire again
      const r3 = limiter.acquireConcurrency("k2", 2);
      r2();
      r3();
    });

    it("release is idempotent", () => {
      const limiter = new UsageLimiter();
      const release = limiter.acquireConcurrency("k3", 1);
      release();
      release(); // should not throw or decrement below 0
      // Can acquire again
      const release2 = limiter.acquireConcurrency("k3", 1);
      release2();
    });
  });

  describe("checkBudget", () => {
    it("does nothing when budget is null or undefined", () => {
      const limiter = new UsageLimiter();
      expect(() => limiter.checkBudget(100, null)).not.toThrow();
      expect(() => limiter.checkBudget(100, undefined)).not.toThrow();
    });

    it("does nothing when spend is below budget", () => {
      const limiter = new UsageLimiter();
      expect(() => limiter.checkBudget(99, 100)).not.toThrow();
    });

    it("throws when spend meets or exceeds budget", () => {
      const limiter = new UsageLimiter();
      expect(() => limiter.checkBudget(100, 100)).toThrow(UsageLimitError);
      expect(() => limiter.checkBudget(101, 100)).toThrow(UsageLimitError);
      try {
        limiter.checkBudget(100, 100);
      } catch (e) {
        expect((e as UsageLimitError).code).toBe("budget_exceeded");
      }
    });
  });
});
