import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGatewayServer } from "./server.js";
import { FakeHarnessAdapter } from "./harness/fake-harness.js";
import { AdapterRegistry } from "./core/adapter-registry.js";
import { RunService } from "./core/run-service.js";
import { RunStore } from "./core/store.js";
import { ChatStore } from "./core/chat-store.js";
import { ChatService } from "./core/chat-service.js";
import { AuthService } from "./core/auth-service.js";
import { ApiKeyStore } from "./core/api-key-store.js";
import { UserStore } from "./core/user-store.js";
import { SessionStore } from "./core/session-store.js";
import type { HarnessAdapter } from "./harness/types.js";

type Srv = { server: import("node:http").Server; start: () => Promise<void>; stop: () => Promise<void>; port: number };

function buildServer(opts: { adapters?: HarnessAdapter[]; auth?: boolean; maxBodyBytes?: number; chat?: boolean } = {}): Srv {
  const registry = new AdapterRegistry();
  for (const adapter of opts.adapters ?? []) registry.register(adapter);
  const store = new RunStore(":memory:");
  const runService = new RunService({ adapterRegistry: registry, store });

  let authService: AuthService | undefined;
  if (opts.auth) {
    const dir = mkdtempSync(join(tmpdir(), "ahg-harden-"));
    const dbPath = join(dir, "auth.db");
    authService = new AuthService({
      apiKeyStore: new ApiKeyStore(dbPath),
      userStore: new UserStore(dbPath),
      sessionStore: new SessionStore(dbPath),
    });
  }

  let chatService: ChatService | undefined;
  if (opts.chat) {
    chatService = new ChatService({ runService, chatStore: new ChatStore(":memory:") });
  }

  return createGatewayServer({
    runService,
    adapterRegistry: registry,
    authService,
    chatService,
    maxBodyBytes: opts.maxBodyBytes,
    port: 0,
  }) as unknown as Srv;
}

async function http(port: number, path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", ...opts.headers },
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any, headers: res.headers };
}

describe("Phase 09: hardening", () => {
  describe("health aggregation", () => {
    it("returns ok with per-harness health when all adapters are healthy", async () => {
      const srv = buildServer({ adapters: [new FakeHarnessAdapter()] });
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const res = await http(port, "/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.harnesses["fake-harness"].ok).toBe(true);
      await srv.stop();
    });

    it("returns degraded 503 when an adapter is unhealthy", async () => {
      const unhealthy: HarnessAdapter = {
        id: "unhealthy",
        health: async () => ({ ok: false, message: "broken" }),
        listModels: async () => [],
        async *run() {},
        async cancel() {},
      };
      const srv = buildServer({ adapters: [unhealthy] });
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const res = await http(port, "/health");
      expect(res.status).toBe(503);
      expect(res.body.status).toBe("degraded");
      expect(res.body.harnesses.unhealthy).toMatchObject({ ok: false, message: "broken" });
      await srv.stop();
    });

    it("returns ok with no harnesses when no registry is present", async () => {
      const srv = buildServer();
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const res = await http(port, "/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      await srv.stop();
    });
  });

  describe("request body size limit", () => {
    it("rejects an oversized body with 413", async () => {
      const srv = buildServer({ adapters: [new FakeHarnessAdapter()], maxBodyBytes: 100 });
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const res = await http(port, "/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "fake-harness/fake-model", messages: [{ role: "user", content: "x".repeat(500) }] }),
      });
      expect(res.status).toBe(413);
      expect(res.body.error.type).toBe("invalid_request_error");
      await srv.stop();
    });
  });

  describe("conversation route auth", () => {
    async function setupAuth(srv: Srv) {
      const port = (srv.server.address() as { port: number }).port;
      await http(port, "/auth/setup", { method: "POST", body: { username: "admin", password: "password123" } });
      const login = await http(port, "/auth/login", { method: "POST", body: { username: "admin", password: "password123" } });
      const cookie = (login.headers.get("set-cookie") ?? "").match(/ahg_session=[^;]+/)![0];
      return { port, cookie };
    }

    it("returns 401 for conversations without a session when auth is configured", async () => {
      const srv = buildServer({ adapters: [new FakeHarnessAdapter()], auth: true, chat: true });
      await srv.start();
      const port = (srv.server.address() as { port: number }).port;
      const res = await http(port, "/v1/conversations");
      expect(res.status).toBe(401);
      await srv.stop();
    });

    it("returns 200 for conversations with a valid session", async () => {
      const srv = buildServer({ adapters: [new FakeHarnessAdapter()], auth: true, chat: true });
      await srv.start();
      const { port, cookie } = await setupAuth(srv);
      const res = await http(port, "/v1/conversations", { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      await srv.stop();
    });
  });
});
