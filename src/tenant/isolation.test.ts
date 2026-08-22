import { describe, it, expect } from "vitest";
import {
  assertIsolationPolicy,
  DEFAULT_ISOLATION_POLICY,
  IsolationViolationError,
} from "./isolation.js";

describe("assertIsolationPolicy", () => {
  it("passes for the default policy", () => {
    expect(() => assertIsolationPolicy(DEFAULT_ISOLATION_POLICY)).not.toThrow();
  });

  it("passes for a safe custom policy", () => {
    expect(() =>
      assertIsolationPolicy({ exposeHostDockerSocket: false, mountHostFilesystem: false }),
    ).not.toThrow();
  });

  it("throws IsolationViolationError when Docker socket is exposed", () => {
    expect(() =>
      assertIsolationPolicy({ exposeHostDockerSocket: true, mountHostFilesystem: false }),
    ).toThrow(IsolationViolationError);
    expect(() =>
      assertIsolationPolicy({ exposeHostDockerSocket: true, mountHostFilesystem: false }),
    ).toThrow(/Docker socket/);
  });

  it("throws IsolationViolationError when host filesystem is mounted", () => {
    expect(() =>
      assertIsolationPolicy({ exposeHostDockerSocket: false, mountHostFilesystem: true }),
    ).toThrow(IsolationViolationError);
    expect(() =>
      assertIsolationPolicy({ exposeHostDockerSocket: false, mountHostFilesystem: true }),
    ).toThrow(/host filesystem/);
  });

  it("throws on first violation when both flags are true", () => {
    expect(() =>
      assertIsolationPolicy({ exposeHostDockerSocket: true, mountHostFilesystem: true }),
    ).toThrow(IsolationViolationError);
  });
});
