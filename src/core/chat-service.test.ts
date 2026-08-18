import { describe, it, expect } from "vitest";
import { AdapterRegistry } from "./adapter-registry.js";
import { RunService } from "./run-service.js";
import { RunStore } from "./store.js";
import { ChatStore } from "./chat-store.js";
import { ChatService } from "./chat-service.js";
import type { HarnessAdapter, HarnessRunRequest } from "../harness/types.js";

function buildHarness(): HarnessAdapter {
  return {
    id: "fake-harness",
    health: async () => ({ ok: true }),
    listModels: async () => ["fake-model"],
    async *run(request: HarnessRunRequest) {
      yield { type: "started", sessionId: "s1" };
      yield { type: "text_delta", text: "Hello" };
      yield { type: "completed", text: "Hello", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } };
    },
    async cancel() {},
  };
}

async function collect(events: AsyncGenerator<unknown>) {
  const out: unknown[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("ChatService", () => {
  it("persists user + assistant messages and links run_id", async () => {
    const registry = new AdapterRegistry();
    registry.register(buildHarness());
    const runStore = new RunStore(":memory:");
    const runService = new RunService({ adapterRegistry: registry, store: runStore });
    const chatStore = new ChatStore(":memory:");
    const service = new ChatService({ runService, chatStore });

    const conversation = service.createConversation();
    const result = await service.sendMessage(conversation.id, {
      content: "hi",
      model: "fake-harness/fake-model",
    });

    await collect(result.events);

    const messages = chatStore.listMessages(conversation.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("hi");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Hello");
    expect(messages[1].run_id).toBe(result.runId);
  });

  it("auto-sets title from the first user message and preserves existing titles", async () => {
    const registry = new AdapterRegistry();
    registry.register(buildHarness());
    const runService = new RunService({ adapterRegistry: registry, store: new RunStore(":memory:") });
    const chatStore = new ChatStore(":memory:");
    const service = new ChatService({ runService, chatStore });

    const conv = service.createConversation();
    const result = await service.sendMessage(conv.id, {
      content: "How do streams work?",
      model: "fake-harness/fake-model",
    });
    await collect(result.events);

    expect(service.getConversation(conv.id)?.title).toBe("How do streams work?");

    const named = service.createConversation("Keep me");
    const second = await service.sendMessage(named.id, {
      content: "Another message",
      model: "fake-harness/fake-model",
    });
    await collect(second.events);
    expect(service.getConversation(named.id)?.title).toBe("Keep me");
  });

  it("passes the full conversation history to the adapter", async () => {
    const seen: string[][] = [];
    const registry = new AdapterRegistry();
    registry.register({
      id: "spy",
      health: async () => ({ ok: true }),
      listModels: async () => ["model"],
      async *run(request: HarnessRunRequest) {
        seen.push(request.messages.map((m) => `${m.role}:${m.content}`));
        yield { type: "completed", text: "ok" };
      },
      async cancel() {},
    });
    const runService = new RunService({ adapterRegistry: registry, store: new RunStore(":memory:") });
    const chatStore = new ChatStore(":memory:");
    const service = new ChatService({ runService, chatStore });

    const conv = service.createConversation("History test");
    const first = await service.sendMessage(conv.id, { content: "one", model: "spy/model" });
    await collect(first.events);
    const second = await service.sendMessage(conv.id, { content: "two", model: "spy/model" });
    await collect(second.events);

    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual([
      "user:one",
      "assistant:ok",
      "user:two",
    ]);
  });

  it("does not persist duplicate assistant messages when the stream throws", async () => {
    const registry = new AdapterRegistry();
    registry.register({
      id: "boom",
      health: async () => ({ ok: true }),
      listModels: async () => ["model"],
      async *run(_request: HarnessRunRequest) {
        yield { type: "text_delta", text: "partial" };
        throw new Error("boom");
      },
      async cancel() {},
    });
    const runService = new RunService({ adapterRegistry: registry, store: new RunStore(":memory:") });
    const chatStore = new ChatStore(":memory:");
    const service = new ChatService({ runService, chatStore });

    const conv = service.createConversation();
    const result = await service.sendMessage(conv.id, { content: "x", model: "boom/model" });
    await expect(collect(result.events)).rejects.toThrow("boom");

    const messages = chatStore.listMessages(conv.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });
});
