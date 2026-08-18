import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGatewayServer } from "./server.js";
import { FakeHarnessAdapter } from "./harness/fake-harness.js";
import { AdapterRegistry } from "./core/adapter-registry.js";
import { RunService } from "./core/run-service.js";
import { RunStore } from "./core/store.js";
import { AuthService } from "./core/auth-service.js";
import { ApiKeyStore } from "./core/api-key-store.js";
import { UserStore } from "./core/user-store.js";
import { SessionStore } from "./core/session-store.js";
import { UsageLimiter } from "./core/limits.js";
import type { HarnessAdapter } from "./harness/types.js";

function createAuthEnv() {
  const dir = mkdtempSync(join(tmpdir(), "ahg-test-"));
  const dbPath = join(dir, "auth.db");
  const apiKeyStore = new ApiKeyStore(dbPath);
  const userStore = new UserStore(dbPath);
  const sessionStore = new SessionStore(dbPath);
  const authService = new AuthService({ apiKeyStore, userStore, sessionStore });
  const cleanup = () => { try { rmSync(dir, { recursive: true }); } catch {} };
  return { apiKeyStore, userStore, sessionStore, authService, cleanup };
}

function createRunService(adapter: HarnessAdapter, opts?: { defaultTimeoutMs?: number }) {
  const registry = new AdapterRegistry();
  registry.register(adapter);
  const store = new RunStore(":memory:");
  const runService = new RunService({
    adapterRegistry: registry,
    store,
    defaultTimeoutMs: opts?.defaultTimeoutMs ?? 30_000,
  });
  return { registry, store, runService };
}

async function http(
  port: number,
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    raw?: boolean;
  } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", ...opts.headers },
  };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const body = opts.raw ? await res.text() : await res.json();
  return { status: res.status, body, headers: res.headers };
}

function authedHttp(port: number, path: string, token: string, opts: { method?: string; body?: unknown } = {}) {
  return http(port, path, { ...opts, headers: { Authorization: `Bearer ${token}` } });
}

function sessionHttp(port: number, path: string, cookie: string, opts: { method?: string; body?: unknown } = {}) {
  return http(port, path, { ...opts, headers: { Cookie: cookie } });
}

function extractCookie(headers: Headers): string {
  const setCookie = headers.get("set-cookie") ?? "";
  const match = setCookie.match(/ahg_session=([^;]+)/);
  return `ahg_session=${match![1]}`;
}

async function setupAndLogin(port: number): Promise<{ cookie: string }> {
  await http(port, "/auth/setup", { method: "POST", body: { username: "admin", password: "password123" } });
  const loginRes = await http(port, "/auth/login", { method: "POST", body: { username: "admin", password: "password123" } });
  return { cookie: extractCookie(loginRes.headers) };
}

async function createApiKey(port: number, cookie: string, body: Record<string, unknown>) {
  return sessionHttp(port, "/v1/keys", cookie, { method: "POST", body });
}

type Srv = { server: import("node:http").Server; start: () => Promise<void>; stop: () => Promise<void>; port: number };

function buildAuthServer(adapter: HarnessAdapter, env: ReturnType<typeof createAuthEnv>, opts?: { usageLimiter?: UsageLimiter; defaultTimeoutMs?: number }): Srv {
  const { registry, runService } = createRunService(adapter, opts);
  return createGatewayServer({
    runService,
    adapterRegistry: registry,
    authService: env.authService,
    usageLimiter: opts?.usageLimiter,
    port: 0,
  }) as unknown as Srv;
}

describe("Phase 06: Auth + Usage HTTP integration", () => {
  describe("/health (unauthenticated)", () => {
    it("returns 200 without any auth", async () => {
      const env = createAuthEnv();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;

      const res = await http(port, "/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");

      await srv.stop();
    });
  });

  describe("API key auth on /v1/models", () => {
    it("returns 401 without Bearer token", async () => {
      const env = createAuthEnv();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;

      const res = await http(port, "/v1/models");
      expect(res.status).toBe(401);

      await srv.stop();
    });

    it("returns allowed models filtered by allowlist with a valid restricted key", async () => {
      const env = createAuthEnv();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);
      const keyRes = await createApiKey(port, cookie, {
        name: "restricted",
        model_allowlist: ["fake-harness/fake-model"],
      });
      const key = keyRes.body as { full_key: string };

      const res = await authedHttp(port, "/v1/models", key.full_key);
      expect(res.status).toBe(200);
      const data = (res.body as { data: Array<{ id: string }> }).data;
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe("fake-harness/fake-model");

      await srv.stop();
    });
  });

  describe("/v1/chat/completions auth rejection", () => {
    it("returns 401 for invalid key", async () => {
      const env = createAuthEnv();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;

      const res = await authedHttp(port, "/v1/chat/completions", "ahg_live_invalidkey123", {
        method: "POST",
        body: { model: "fake-harness/fake-model", messages: [{ role: "user", content: "hi" }], stream: false },
      });
      expect(res.status).toBe(401);

      await srv.stop();
    });

    it("returns 401 for disabled key", async () => {
      const env = createAuthEnv();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);
      const keyRes = await createApiKey(port, cookie, { name: "will-disable" });
      const key = keyRes.body as { full_key: string; key: { id: string } };
      await sessionHttp(port, `/v1/keys/${key.key.id}/disable`, cookie, { method: "POST" });

      const res = await authedHttp(port, "/v1/chat/completions", key.full_key, {
        method: "POST",
        body: { model: "fake-harness/fake-model", messages: [{ role: "user", content: "hi" }], stream: false },
      });
      expect(res.status).toBe(401);
      expect((res.body as { error: { message: string } }).error.message).toContain("disabled");

      await srv.stop();
    });

    it("returns 401 for expired key", async () => {
      const env = createAuthEnv();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const keyRes = await createApiKey(port, cookie, { name: "expired", expires_at: pastDate });
      const key = keyRes.body as { full_key: string };

      const res = await authedHttp(port, "/v1/chat/completions", key.full_key, {
        method: "POST",
        body: { model: "fake-harness/fake-model", messages: [{ role: "user", content: "hi" }], stream: false },
      });
      expect(res.status).toBe(401);
      expect((res.body as { error: { message: string } }).error.message).toContain("expired");

      await srv.stop();
    });
  });

  describe("Model allowlist enforcement", () => {
    it("returns 403 when model is not in allowlist", async () => {
      const env = createAuthEnv();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);
      const keyRes = await createApiKey(port, cookie, {
        name: "restricted",
        model_allowlist: ["fake-harness/other-model"],
      });
      const key = keyRes.body as { full_key: string };

      const res = await authedHttp(port, "/v1/chat/completions", key.full_key, {
        method: "POST",
        body: { model: "fake-harness/fake-model", messages: [{ role: "user", content: "hi" }], stream: false },
      });
      expect(res.status).toBe(403);
      expect((res.body as { error: { type: string } }).error.type).toBe("permission_error");

      await srv.stop();
    });
  });

  describe("RPM limit", () => {
    it("returns 429 when RPM limit exceeded", async () => {
      const env = createAuthEnv();
      const usageLimiter = new UsageLimiter();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env, { usageLimiter });
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);
      const keyRes = await createApiKey(port, cookie, { name: "rpm-test", rpm_limit: 1 });
      const key = keyRes.body as { full_key: string };

      const reqBody = {
        model: "fake-harness/fake-model",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      };

      const res1 = await authedHttp(port, "/v1/chat/completions", key.full_key, { method: "POST", body: reqBody });
      expect(res1.status).toBe(200);

      const res2 = await authedHttp(port, "/v1/chat/completions", key.full_key, { method: "POST", body: reqBody });
      expect(res2.status).toBe(429);
      expect((res2.body as { error: { type: string } }).error.type).toBe("rate_limit_error");

      await srv.stop();
    });
  });

  describe("Concurrency limit", () => {
    it("returns 429 when concurrency limit exceeded, releases on cancel", async () => {
      const harnessPath = new URL("../testing/fixtures/fake-harness/fake-harness.mjs", import.meta.url).pathname;
      const adapter = new FakeHarnessAdapter({ harnessPath, extraArgs: ["--hang"] });
      const env = createAuthEnv();
      const usageLimiter = new UsageLimiter();
      const srv = buildAuthServer(adapter, env, { usageLimiter, defaultTimeoutMs: 30000 });
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);
      const keyRes = await createApiKey(port, cookie, { name: "conc-test", max_concurrency: 1 });
      const key = keyRes.body as { full_key: string };

      const reqBody = {
        model: "fake-harness/fake-model",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      };

      // Start first hanging stream
      const controller1 = new AbortController();
      const res1 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${key.full_key}` },
        body: JSON.stringify(reqBody),
        signal: controller1.signal,
      });
      expect(res1.status).toBe(200);

      // Second request should be 429
      const res2 = await authedHttp(port, "/v1/chat/completions", key.full_key, { method: "POST", body: reqBody });
      expect(res2.status).toBe(429);

      // Cancel first stream and wait for release
      controller1.abort();
      await new Promise((r) => setTimeout(r, 500));

      // Third request should get past concurrency check (200 or 502, not 429)
      const controller2 = new AbortController();
      const res3 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${key.full_key}` },
        body: JSON.stringify(reqBody),
        signal: controller2.signal,
      });
      expect(res3.status).not.toBe(429);
      controller2.abort();

      await new Promise((r) => setTimeout(r, 200));
      await srv.stop();
    }, 15000);
  });

  describe("Budget limit", () => {
    it("returns 429 when monthly budget is zero", async () => {
      const env = createAuthEnv();
      const usageLimiter = new UsageLimiter();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env, { usageLimiter });
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);
      const keyRes = await createApiKey(port, cookie, { name: "budget-test", monthly_budget_usd: 0 });
      const key = keyRes.body as { full_key: string };

      const res = await authedHttp(port, "/v1/chat/completions", key.full_key, {
        method: "POST",
        body: { model: "fake-harness/fake-model", messages: [{ role: "user", content: "hi" }], stream: false },
      });
      expect(res.status).toBe(429);
      expect((res.body as { error: { type: string } }).error.type).toBe("rate_limit_error");

      await srv.stop();
    });
  });

  describe("GET /v1/usage", () => {
    it("returns estimated usage with estimated=true", async () => {
      const env = createAuthEnv();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);
      const keyRes = await createApiKey(port, cookie, { name: "usage-test" });
      const key = keyRes.body as { full_key: string };

      const res1 = await authedHttp(port, "/v1/usage", key.full_key);
      expect(res1.status).toBe(200);
      const body1 = res1.body as { object: string; estimated: boolean; estimated_cost_usd: number; key_id: string };
      expect(body1.object).toBe("usage");
      expect(body1.estimated).toBe(true);
      expect(body1.estimated_cost_usd).toBe(0);
      expect(body1.key_id).toBeTruthy();

      await authedHttp(port, "/v1/chat/completions", key.full_key, {
        method: "POST",
        body: { model: "fake-harness/fake-model", messages: [{ role: "user", content: "hi" }], stream: false },
      });

      const res2 = await authedHttp(port, "/v1/usage", key.full_key);
      expect(res2.status).toBe(200);
      const body2 = res2.body as { estimated_cost_usd: number };
      expect(body2.estimated_cost_usd).toBeGreaterThanOrEqual(0);

      await srv.stop();
    });
  });

  describe("Key management lifecycle", () => {
    it("setup → login → create → list → disable → auth fails → enable → delete", async () => {
      const env = createAuthEnv();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;

      const setupRes = await http(port, "/auth/setup", {
        method: "POST",
        body: { username: "admin", password: "password123" },
      });
      expect(setupRes.status).toBe(201);
      expect((setupRes.body as { username: string }).username).toBe("admin");

      const setupRes2 = await http(port, "/auth/setup", {
        method: "POST",
        body: { username: "admin2", password: "password123" },
      });
      expect(setupRes2.status).toBe(409);

      const loginRes = await http(port, "/auth/login", {
        method: "POST",
        body: { username: "admin", password: "password123" },
      });
      expect(loginRes.status).toBe(200);
      const cookie = extractCookie(loginRes.headers);

      const keyRes = await createApiKey(port, cookie, {
        name: "my-key",
        model_allowlist: ["fake-harness/fake-model"],
        rpm_limit: 10,
        monthly_budget_usd: 100,
      });
      expect(keyRes.status).toBe(201);
      const keyBody = keyRes.body as { full_key: string; key: Record<string, unknown> };
      expect(keyBody.full_key).toMatch(/^ahg_live_/);
      expect(keyBody.key.key_hash).toBeUndefined();
      expect(keyBody.key.name).toBe("my-key");
      expect(keyBody.key.model_allowlist).toEqual(["fake-harness/fake-model"]);

      const listRes = await sessionHttp(port, "/v1/keys", cookie);
      expect(listRes.status).toBe(200);
      const keys = (listRes.body as { data: Array<Record<string, unknown>> }).data;
      expect(keys.length).toBeGreaterThanOrEqual(1);
      for (const k of keys) {
        expect(k.key_hash).toBeUndefined();
      }

      const keyId = keyBody.key.id as string;
      const disableRes = await sessionHttp(port, `/v1/keys/${keyId}/disable`, cookie, { method: "POST" });
      expect(disableRes.status).toBe(200);
      expect((disableRes.body as { ok: boolean }).ok).toBe(true);

      const authRes = await authedHttp(port, "/v1/models", keyBody.full_key);
      expect(authRes.status).toBe(401);

      const enableRes = await sessionHttp(port, `/v1/keys/${keyId}/enable`, cookie, { method: "POST" });
      expect(enableRes.status).toBe(200);

      const authRes2 = await authedHttp(port, "/v1/models", keyBody.full_key);
      expect(authRes2.status).toBe(200);

      const deleteRes = await sessionHttp(port, `/v1/keys/${keyId}`, cookie, { method: "DELETE" });
      expect(deleteRes.status).toBe(200);

      const authRes3 = await authedHttp(port, "/v1/models", keyBody.full_key);
      expect(authRes3.status).toBe(401);

      await srv.stop();
    });
  });

  describe("Auth setup 409 after first user exists", () => {
    it("returns 409 when users already exist", async () => {
      const env = createAuthEnv();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;

      await http(port, "/auth/setup", { method: "POST", body: { username: "first", password: "password123" } });
      const res = await http(port, "/auth/setup", { method: "POST", body: { username: "second", password: "password123" } });
      expect(res.status).toBe(409);
      expect((res.body as { error: { message: string } }).error.message).toContain("users already exist");

      await srv.stop();
    });
  });

  describe("Sensitive value absence", () => {
    it("invalid-key 401 response does not contain the submitted raw key", async () => {
      const env = createAuthEnv();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;

      const secretKey = "ahg_live_supersecretkeyvalue12345678";
      const res = await authedHttp(port, "/v1/chat/completions", secretKey, {
        method: "POST",
        body: { model: "fake-harness/fake-model", messages: [{ role: "user", content: "hi" }], stream: false },
      });
      expect(res.status).toBe(401);
      const bodyText = JSON.stringify(res.body);
      expect(bodyText).not.toContain(secretKey);

      await srv.stop();
    });
  });

  describe("Run detail includes cost fields", () => {
    it("GET /v1/runs/:id includes estimated_cost_usd and cost_is_estimated", async () => {
      const env = createAuthEnv();
      const srv = buildAuthServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);
      const keyRes = await createApiKey(port, cookie, { name: "cost-test" });
      const key = keyRes.body as { full_key: string };

      const chatRes = await authedHttp(port, "/v1/chat/completions", key.full_key, {
        method: "POST",
        body: { model: "fake-harness/fake-model", messages: [{ role: "user", content: "hi" }], stream: false },
      });
      expect(chatRes.status).toBe(200);

      const completionBody = chatRes.body as { id: string };
      const runId = completionBody.id.replace("chatcmpl-", "");

      const runRes = await authedHttp(port, `/v1/runs/${runId}`, key.full_key);
      expect(runRes.status).toBe(200);
      const runBody = runRes.body as Record<string, unknown>;
      expect(runBody.estimated_cost_usd).toBeDefined();
      expect(runBody.cost_is_estimated).toBe(true);

      await srv.stop();
    });
  });
});
