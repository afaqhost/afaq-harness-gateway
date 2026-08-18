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
import type { HarnessAdapter } from "./harness/types.js";

function createAuthEnv() {
  const dir = mkdtempSync(join(tmpdir(), "ahg-hermes-"));
  const dbPath = join(dir, "auth.db");
  const apiKeyStore = new ApiKeyStore(dbPath);
  const userStore = new UserStore(dbPath);
  const sessionStore = new SessionStore(dbPath);
  const authService = new AuthService({ apiKeyStore, userStore, sessionStore });
  const cleanup = () => { try { rmSync(dir, { recursive: true }); } catch {} };
  return { apiKeyStore, userStore, sessionStore, authService, cleanup };
}

function createRunService(adapter: HarnessAdapter) {
  const registry = new AdapterRegistry();
  registry.register(adapter);
  const store = new RunStore(":memory:");
  const runService = new RunService({
    adapterRegistry: registry,
    store,
    defaultTimeoutMs: 30_000,
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
    signal?: AbortSignal;
  } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", ...opts.headers },
  };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  if (opts.signal) {
    init.signal = opts.signal;
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

function buildServer(adapter: HarnessAdapter, env: ReturnType<typeof createAuthEnv>): Srv {
  const { registry, runService } = createRunService(adapter);
  return createGatewayServer({
    runService,
    adapterRegistry: registry,
    authService: env.authService,
    port: 0,
  }) as unknown as Srv;
}

describe("Phase 07: Hermes client verification", () => {
  describe("a. GET /health (unauthenticated)", () => {
    it("returns 200 and {status:\"ok\"}", async () => {
      const env = createAuthEnv();
      const srv = buildServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;

      const res = await http(port, "/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");

      await srv.stop();
    });
  });

  describe("b. GET /v1/models", () => {
    it("returns 401 without Bearer token", async () => {
      const env = createAuthEnv();
      const srv = buildServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;

      const res = await http(port, "/v1/models");
      expect(res.status).toBe(401);

      await srv.stop();
    });

    it("returns 200 with valid key, correct model list shape", async () => {
      const env = createAuthEnv();
      const srv = buildServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);
      const keyRes = await createApiKey(port, cookie, { name: "hermes" });
      const key = keyRes.body as { full_key: string };

      const res = await authedHttp(port, "/v1/models", key.full_key);
      expect(res.status).toBe(200);
      expect(res.body.object).toBe("list");
      const data = res.body.data as Array<Record<string, unknown>>;
      expect(data.length).toBeGreaterThanOrEqual(1);

      const model = data.find((m) => m.id === "fake-harness/fake-model");
      expect(model).toBeDefined();
      expect(Object.keys(model!).sort()).toEqual(["created", "id", "object", "owned_by"]);

      await srv.stop();
    });
  });

  describe("c. POST /v1/chat/completions (non-streaming)", () => {
    it("returns 200 with correct OpenAI shape", async () => {
      const env = createAuthEnv();
      const srv = buildServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);
      const keyRes = await createApiKey(port, cookie, { name: "hermes" });
      const key = keyRes.body as { full_key: string };

      const res = await authedHttp(port, "/v1/chat/completions", key.full_key, {
        method: "POST",
        body: {
          model: "fake-harness/fake-model",
          messages: [{ role: "user", content: "Hello" }],
          stream: false,
        },
      });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.object).toBe("chat.completion");
      expect(typeof body.id).toBe("string");
      expect(body.id as string).toMatch(/^chatcmpl-/);
      expect(body.model).toBe("fake-harness/fake-model");
      const choices = body.choices as Array<Record<string, unknown>>;
      expect(choices).toHaveLength(1);
      expect(choices[0].finish_reason).toBe("stop");
      const usage = body.usage as Record<string, number>;
      expect(typeof usage.prompt_tokens).toBe("number");
      expect(typeof usage.completion_tokens).toBe("number");
      expect(typeof usage.total_tokens).toBe("number");

      await srv.stop();
    });
  });

  describe("d. POST /v1/chat/completions (streaming)", () => {
    it("returns SSE with chat.completion.chunk frames and [DONE]", async () => {
      const env = createAuthEnv();
      const srv = buildServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);
      const keyRes = await createApiKey(port, cookie, { name: "hermes" });
      const key = keyRes.body as { full_key: string };

      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${key.full_key}`,
        },
        body: JSON.stringify({
          model: "fake-harness/fake-model",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const text = await res.text();
      expect(text).toContain('"object":"chat.completion.chunk"');
      expect(text).toContain("data: [DONE]");

      await srv.stop();
    });
  });

  describe("e. Cancellation is clean", () => {
    it("start hanging stream, cancel via API, get 200 cancelling", async () => {
      const harnessPath = new URL("../testing/fixtures/fake-harness/fake-harness.mjs", import.meta.url).pathname;
      const adapter = new FakeHarnessAdapter({ harnessPath, extraArgs: ["--hang"] });
      const env = createAuthEnv();
      const srv = buildServer(adapter, env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);
      const keyRes = await createApiKey(port, cookie, { name: "hermes" });
      const key = keyRes.body as { full_key: string };

      const controller = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${key.full_key}`,
        },
        body: JSON.stringify({
          model: "fake-harness/fake-model",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }),
        signal: controller.signal,
      });

      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const firstChunk = decoder.decode((await reader.read()).value);
      // The first chunk contains the run id as chatcmpl-<runId>
      const idMatch = firstChunk.match(/chatcmpl-([a-f0-9-]+)/);
      expect(idMatch).not.toBeNull();
      const runId = idMatch![1];

      const cancelRes = await authedHttp(port, `/v1/runs/${runId}/cancel`, key.full_key, { method: "POST" });
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.id).toBe(runId);
      expect(cancelRes.body.status).toBe("cancelling");

      controller.abort();
      reader.releaseLock();
      await new Promise((r) => setTimeout(r, 200));

      await srv.stop();
    }, 15000);
  });

  describe("f. Usage isolation by API key", () => {
    it("usage only appears under the key that ran the completion", async () => {
      const env = createAuthEnv();
      const srv = buildServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const { cookie } = await setupAndLogin(port);

      const hermesKeyRes = await createApiKey(port, cookie, { name: "hermes" });
      const hermesKey = hermesKeyRes.body as { full_key: string; key: { id: string } };

      const otherKeyRes = await createApiKey(port, cookie, { name: "other" });
      const otherKey = otherKeyRes.body as { full_key: string; key: { id: string } };

      // Run a completion under the hermes key
      const chatRes = await authedHttp(port, "/v1/chat/completions", hermesKey.full_key, {
        method: "POST",
        body: {
          model: "fake-harness/fake-model",
          messages: [{ role: "user", content: "Hello" }],
          stream: false,
        },
      });
      expect(chatRes.status).toBe(200);

      // Hermes key should see usage
      const hermesUsage = await authedHttp(port, "/v1/usage", hermesKey.full_key);
      expect(hermesUsage.status).toBe(200);
      expect(hermesUsage.body.object).toBe("usage");
      expect(hermesUsage.body.estimated).toBe(true);
      expect(hermesUsage.body.estimated_cost_usd).toBeGreaterThanOrEqual(0);
      expect(hermesUsage.body.key_id).toBe(hermesKey.key.id);

      // Other key should see zero usage
      const otherUsage = await authedHttp(port, "/v1/usage", otherKey.full_key);
      expect(otherUsage.status).toBe(200);
      expect(otherUsage.body.estimated_cost_usd).toBe(0);

      await srv.stop();
    });
  });

  describe("g. Gateway dashboard/UI route", () => {
    it("GET / returns 200 and HTML containing Gateway Chat", async () => {
      const env = createAuthEnv();
      const srv = buildServer(new FakeHarnessAdapter(), env);
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;

      const res = await http(port, "/", { raw: true });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.body).toContain("Gateway Chat");

      await srv.stop();
    });
  });
});
