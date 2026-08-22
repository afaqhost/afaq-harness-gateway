import { describe, it, expect } from "vitest";
import {
  HOST_SENSITIVE_ENV_KEYS,
  HostEnvLeakError,
  buildTenantEnv,
  assertNoHostSensitiveEnv,
} from "./process-env.js";
import { createTenant } from "./types.js";

describe("HOST_SENSITIVE_ENV_KEYS", () => {
  it("contains Docker-related keys", () => {
    expect(HOST_SENSITIVE_ENV_KEYS.has("DOCKER_HOST")).toBe(true);
    expect(HOST_SENSITIVE_ENV_KEYS.has("DOCKER_TLS_VERIFY")).toBe(true);
    expect(HOST_SENSITIVE_ENV_KEYS.has("DOCKER_CERT_PATH")).toBe(true);
    expect(HOST_SENSITIVE_ENV_KEYS.has("DOCKER_CONTEXT")).toBe(true);
  });

  it("contains cloud credential keys", () => {
    expect(HOST_SENSITIVE_ENV_KEYS.has("AWS_ACCESS_KEY_ID")).toBe(true);
    expect(HOST_SENSITIVE_ENV_KEYS.has("AWS_SECRET_ACCESS_KEY")).toBe(true);
    expect(HOST_SENSITIVE_ENV_KEYS.has("AWS_SESSION_TOKEN")).toBe(true);
  });

  it("contains API key env vars", () => {
    expect(HOST_SENSITIVE_ENV_KEYS.has("ANTHROPIC_API_KEY")).toBe(true);
    expect(HOST_SENSITIVE_ENV_KEYS.has("OPENAI_API_KEY")).toBe(true);
    expect(HOST_SENSITIVE_ENV_KEYS.has("CODEX_API_KEY")).toBe(true);
    expect(HOST_SENSITIVE_ENV_KEYS.has("GITHUB_TOKEN")).toBe(true);
    expect(HOST_SENSITIVE_ENV_KEYS.has("NPM_TOKEN")).toBe(true);
  });

  it("contains KUBECONFIG and NODE_OPTIONS", () => {
    expect(HOST_SENSITIVE_ENV_KEYS.has("KUBECONFIG")).toBe(true);
    expect(HOST_SENSITIVE_ENV_KEYS.has("NODE_OPTIONS")).toBe(true);
  });
});

describe("buildTenantEnv", () => {
  const tenant = createTenant({ id: "t1", name: "T1", rootDir: "/var/tenants/t1" });

  it("sets HOME to tenant rootDir", () => {
    const env = buildTenantEnv(tenant);
    expect(env.HOME).toBe("/var/tenants/t1");
  });

  it("sets TMPDIR to tenant artifacts path", () => {
    const env = buildTenantEnv(tenant);
    expect(env.TMPDIR).toBe("/var/tenants/t1/artifacts");
  });

  it("does not contain Docker host env vars", () => {
    const env = buildTenantEnv(tenant);
    expect(env.DOCKER_HOST).toBeUndefined();
    expect(env.DOCKER_TLS_VERIFY).toBeUndefined();
    expect(env.DOCKER_CERT_PATH).toBeUndefined();
    expect(env.DOCKER_CONTEXT).toBeUndefined();
  });

  it("does not contain credential env vars", () => {
    const env = buildTenantEnv(tenant);
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(env.KUBECONFIG).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it("strips AHG_ prefixed keys from minimal env", () => {
    const saved = process.env.AHG_SECRET;
    process.env.AHG_SECRET = "should-not-leak";
    try {
      const env = buildTenantEnv(tenant);
      expect(env.AHG_SECRET).toBeUndefined();
    } finally {
      if (saved === undefined) {
        delete process.env.AHG_SECRET;
      } else {
        process.env.AHG_SECRET = saved;
      }
    }
  });

  it("merges extra env vars last", () => {
    const env = buildTenantEnv(tenant, { MY_VAR: "hello", HOME: "/override" });
    expect(env.MY_VAR).toBe("hello");
    expect(env.HOME).toBe("/override");
  });

  it("extra env can override TMPDIR", () => {
    const env = buildTenantEnv(tenant, { TMPDIR: "/custom/tmp" });
    expect(env.TMPDIR).toBe("/custom/tmp");
  });

  it("passes assertNoHostSensitiveEnv", () => {
    const env = buildTenantEnv(tenant);
    expect(() => assertNoHostSensitiveEnv(env)).not.toThrow();
  });
});

describe("assertNoHostSensitiveEnv", () => {
  it("passes for a clean env", () => {
    expect(() => assertNoHostSensitiveEnv({ HOME: "/home", PATH: "/usr/bin" })).not.toThrow();
  });

  it("throws HostEnvLeakError for DOCKER_HOST", () => {
    expect(() => assertNoHostSensitiveEnv({ DOCKER_HOST: "unix:///var/run/docker.sock" })).toThrow(HostEnvLeakError);
    expect(() => assertNoHostSensitiveEnv({ DOCKER_HOST: "unix:///var/run/docker.sock" })).toThrow(/DOCKER_HOST/);
  });

  it("throws HostEnvLeakError for AWS_ACCESS_KEY_ID", () => {
    expect(() => assertNoHostSensitiveEnv({ AWS_ACCESS_KEY_ID: "AKIA..." })).toThrow(HostEnvLeakError);
  });

  it("throws HostEnvLeakError for GITHUB_TOKEN", () => {
    expect(() => assertNoHostSensitiveEnv({ GITHUB_TOKEN: "ghp_..." })).toThrow(HostEnvLeakError);
  });

  it("throws HostEnvLeakError for AHG_ prefixed keys", () => {
    expect(() => assertNoHostSensitiveEnv({ AHG_INTERNAL_SECRET: "val" })).toThrow(HostEnvLeakError);
    expect(() => assertNoHostSensitiveEnv({ AHG_INTERNAL_SECRET: "val" })).toThrow(/AHG_INTERNAL_SECRET/);
  });

  it("throws HostEnvLeakError for NODE_OPTIONS", () => {
    expect(() => assertNoHostSensitiveEnv({ NODE_OPTIONS: "--max-old-space-size=4096" })).toThrow(HostEnvLeakError);
  });

  it("throws HostEnvLeakError for NPM_TOKEN", () => {
    expect(() => assertNoHostSensitiveEnv({ NPM_TOKEN: "npm_..." })).toThrow(HostEnvLeakError);
  });

  it("throws HostEnvLeakError for KUBECONFIG", () => {
    expect(() => assertNoHostSensitiveEnv({ KUBECONFIG: "/home/user/.kube/config" })).toThrow(HostEnvLeakError);
  });
});
