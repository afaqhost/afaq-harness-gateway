import { describe, it, expect, beforeEach } from "vitest";
import { VersionStateStore } from "./state-store.js";
import { UpdateService } from "./update-service.js";
import type { UpdateServiceOptions } from "./update-service.js";
import type { HarnessAdapter, HarnessEvent } from "../harness/types.js";
import type { VersionRange } from "./types.js";

function makeAdapter(overrides: Partial<HarnessAdapter> = {}): HarnessAdapter {
  return {
    id: "test-adapter",
    async health() {
      return { ok: true };
    },
    async listModels() {
      return ["test-model"];
    },
    async *run(): AsyncGenerator<HarnessEvent> {
      yield { type: "started" };
      yield { type: "text_delta", text: "Hello" };
      yield { type: "completed", text: "Hello" };
    },
    async cancel() {},
    ...overrides,
  };
}

function makeOptions(
  store: VersionStateStore,
  overrides: Partial<UpdateServiceOptions> = {},
): UpdateServiceOptions {
  return {
    store,
    installOrUpdate() {
      return { success: true, path: "/usr/bin/echo" };
    },
    getVersionCommand() {
      return ["echo", "2.0.0"];
    },
    getCompatibilityRange() {
      return { minimum: "1.0.0", maximum: "5.0.0" };
    },
    getLatestKnownVersion() {
      return "2.0.0";
    },
    getAdapter() {
      return makeAdapter();
    },
    ...overrides,
  };
}

describe("UpdateService", () => {
  let store: VersionStateStore;

  beforeEach(() => {
    store = new VersionStateStore(":memory:");
  });

  describe("getState / listStates", () => {
    it("returns undefined for nonexistent state", () => {
      const svc = new UpdateService(makeOptions(store));
      expect(svc.getState("nonexistent")).toBeUndefined();
    });

    it("lists states from the store", () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      store.upsert({
        definitionId: "h2",
        installedVersion: "2.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(makeOptions(store));
      expect(svc.listStates()).toHaveLength(2);
    });
  });

  describe("checkForUpdate", () => {
    it("throws when no installed version exists", () => {
      const svc = new UpdateService(makeOptions(store));
      expect(() => svc.checkForUpdate("nonexistent")).toThrow(
        "No installed version found",
      );
    });

    it("reports no update when installed equals latest", () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "2.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(makeOptions(store));
      const status = svc.checkForUpdate("h1");
      expect(status.updateAvailable).toBe(false);
      expect(status.installedVersion).toBe("2.0.0");
      expect(status.latestKnownVersion).toBe("2.0.0");
    });

    it("reports update available when latest is newer", () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(makeOptions(store));
      const status = svc.checkForUpdate("h1");
      expect(status.updateAvailable).toBe(true);
      expect(status.latestKnownVersion).toBe("2.0.0");
      expect(status.latestCompatibility?.status).toBe("supported");
    });

    it("reports no update when latest is older", () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "3.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(makeOptions(store));
      const status = svc.checkForUpdate("h1");
      expect(status.updateAvailable).toBe(false);
    });

    it("never calls installOrUpdate", () => {
      let installCalled = false;
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(
        makeOptions(store, {
          installOrUpdate() {
            installCalled = true;
            return { success: true, path: "/usr/bin/test" };
          },
        }),
      );
      svc.checkForUpdate("h1");
      expect(installCalled).toBe(false);
    });

    it("includes compatibility info for latest known version", () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(
        makeOptions(store, {
          getCompatibilityRange() {
            return { minimum: "3.0.0" };
          },
        }),
      );
      const status = svc.checkForUpdate("h1");
      expect(status.updateAvailable).toBe(true);
      expect(status.latestCompatibility?.status).toBe("incompatible");
    });
  });

  describe("performUpdate", () => {
    it("throws when no installed version exists", async () => {
      const svc = new UpdateService(makeOptions(store));
      await expect(
        svc.performUpdate({ definitionId: "nonexistent" }),
      ).rejects.toThrow("No installed version found");
    });

    it("rejects when no target version is available", async () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(
        makeOptions(store, {
          getLatestKnownVersion: undefined,
        }),
      );
      const result = await svc.performUpdate({ definitionId: "h1" });
      expect(result.success).toBe(false);
      expect(result.activated).toBe(false);
      expect(result.reason).toContain("no target version");
    });

    it("rejects incompatible target without calling installOrUpdate", async () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      let installCalled = false;
      const svc = new UpdateService(
        makeOptions(store, {
          getCompatibilityRange() {
            return { maximum: "1.5.0" };
          },
          installOrUpdate() {
            installCalled = true;
            return { success: true, path: "/usr/bin/test" };
          },
        }),
      );
      const result = await svc.performUpdate({
        definitionId: "h1",
        targetVersion: "2.0.0",
      });
      expect(result.success).toBe(false);
      expect(result.activated).toBe(false);
      expect(result.reason).toContain("not supported");
      expect(installCalled).toBe(false);

      const state = store.get("h1");
      expect(state?.compatibilityStatus).toBe("incompatible");
    });

    it("rejects when installOrUpdate fails", async () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(
        makeOptions(store, {
          installOrUpdate() {
            return { success: false, error: "disk full" };
          },
        }),
      );
      const result = await svc.performUpdate({
        definitionId: "h1",
        targetVersion: "2.0.0",
      });
      expect(result.success).toBe(false);
      expect(result.activated).toBe(false);
      expect(result.reason).toContain("Install failed");
      expect(result.reason).toContain("disk full");
    });

    it("rejects when version verification mismatches", async () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(
        makeOptions(store, {
          getVersionCommand() {
            return ["echo", "9.9.9"];
          },
        }),
      );
      const result = await svc.performUpdate({
        definitionId: "h1",
        targetVersion: "2.0.0",
      });
      expect(result.success).toBe(false);
      expect(result.activated).toBe(false);
      expect(result.reason).toContain("Version mismatch");
      expect(result.verifiedVersion).toBe("9.9.9");
    });

    it("rejects when contract test fails", async () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(
        makeOptions(store, {
          getAdapter() {
            return makeAdapter({
              async health() {
                return { ok: false, message: "broken" };
              },
            });
          },
        }),
      );
      const result = await svc.performUpdate({
        definitionId: "h1",
        targetVersion: "2.0.0",
      });
      expect(result.success).toBe(false);
      expect(result.activated).toBe(false);
      expect(result.contractTest?.ok).toBe(false);
    });

    it("rejects when post-update health check fails", async () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      let healthCallCount = 0;
      const svc = new UpdateService(
        makeOptions(store, {
          getAdapter() {
            return makeAdapter({
              async health() {
                healthCallCount++;
                // First call is inside contract test, second is post-update health
                if (healthCallCount >= 2) {
                  return { ok: false, message: "post-update failure" };
                }
                return { ok: true };
              },
            });
          },
        }),
      );
      const result = await svc.performUpdate({
        definitionId: "h1",
        targetVersion: "2.0.0",
      });
      expect(result.success).toBe(false);
      expect(result.activated).toBe(false);
      expect(result.reason).toContain("health check failed");
      expect(result.health?.ok).toBe(false);
    });

    it("rejects when no adapter is available", async () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(
        makeOptions(store, {
          getAdapter: undefined,
        }),
      );
      const result = await svc.performUpdate({
        definitionId: "h1",
        targetVersion: "2.0.0",
      });
      expect(result.success).toBe(false);
      expect(result.activated).toBe(false);
      expect(result.reason).toContain("No adapter");
    });

    it("rejects when no version command is configured", async () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(
        makeOptions(store, {
          getVersionCommand() {
            return undefined;
          },
        }),
      );
      const result = await svc.performUpdate({
        definitionId: "h1",
        targetVersion: "2.0.0",
      });
      expect(result.success).toBe(false);
      expect(result.activated).toBe(false);
      expect(result.reason).toContain("No version command");
    });

    it("succeeds for a full happy-path update", async () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(makeOptions(store));
      const result = await svc.performUpdate({
        definitionId: "h1",
        targetVersion: "2.0.0",
      });
      expect(result.success).toBe(true);
      expect(result.activated).toBe(true);
      expect(result.fromVersion).toBe("1.0.0");
      expect(result.targetVersion).toBe("2.0.0");
      expect(result.verifiedVersion).toBe("2.0.0");
      expect(result.contractTest?.ok).toBe(true);
      expect(result.health?.ok).toBe(true);
      expect(result.compatibility.status).toBe("supported");

      const state = store.get("h1");
      expect(state?.installedVersion).toBe("2.0.0");
      expect(state?.knownGoodVersion).toBe("2.0.0");
      expect(state?.compatibilityStatus).toBe("supported");
    });

    it("uses latestKnownVersion when no targetVersion provided", async () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      const svc = new UpdateService(makeOptions(store));
      const result = await svc.performUpdate({ definitionId: "h1" });
      expect(result.success).toBe(true);
      expect(result.targetVersion).toBe("2.0.0");
    });

    it("rejects blocked versions before installing", async () => {
      store.upsert({
        definitionId: "h1",
        installedVersion: "1.0.0",
        compatibilityStatus: "supported",
      });
      let installCalled = false;
      const svc = new UpdateService(
        makeOptions(store, {
          getCompatibilityRange() {
            return { blocked: ["2.0.0"] };
          },
          installOrUpdate() {
            installCalled = true;
            return { success: true, path: "/usr/bin/test" };
          },
        }),
      );
      const result = await svc.performUpdate({
        definitionId: "h1",
        targetVersion: "2.0.0",
      });
      expect(result.success).toBe(false);
      expect(result.activated).toBe(false);
      expect(installCalled).toBe(false);
    });
  });
});
