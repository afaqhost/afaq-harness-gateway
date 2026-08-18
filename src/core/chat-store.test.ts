import { describe, it, expect, beforeEach } from "vitest";
import { ChatStore } from "./chat-store.js";

describe("ChatStore", () => {
  let store: ChatStore;

  beforeEach(() => {
    store = new ChatStore(":memory:");
  });

  it("creates, lists, gets, and updates a conversation", () => {
    const created = store.createConversation("First title");
    expect(created.id).toBeTruthy();
    expect(created.title).toBe("First title");
    expect(created.created_at).toBeTruthy();
    expect(created.updated_at).toBeTruthy();

    const listed = store.listConversations();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);

    expect(store.getConversation(created.id)?.title).toBe("First title");

    const updated = store.updateConversationTitle(created.id, "Renamed");
    expect(updated?.title).toBe("Renamed");
    expect(store.getConversation(created.id)?.title).toBe("Renamed");
  });

  it("defaults an empty title", () => {
    const created = store.createConversation();
    expect(created.title).toBe("New conversation");
    expect(store.createConversation("   ").title).toBe("New conversation");
  });

  it("lists conversations ordered by updated_at descending", async () => {
    const first = store.createConversation("First");
    await new Promise((r) => setTimeout(r, 5));
    const second = store.createConversation("Second");

    const ids = store.listConversations().map((c) => c.id);
    expect(ids).toEqual([second.id, first.id]);
  });

  it("adds and lists messages with deterministic ids and run linkage", () => {
    const conv = store.createConversation("Chat");
    const user = store.addMessage({
      id: "msg-1",
      conversationId: conv.id,
      role: "user",
      content: "hello",
    });
    const assistant = store.addMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "hi there",
      runId: "run-1",
    });

    expect(user.id).toBe("msg-1");
    expect(user.run_id).toBeNull();
    expect(assistant.id).toBeTruthy();
    expect(assistant.run_id).toBe("run-1");

    const messages = store.listMessages(conv.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("hi there");
    expect(messages[1].run_id).toBe("run-1");
  });

  it("cascades message deletes when a conversation is removed", () => {
    const conv = store.createConversation("Chat");
    store.addMessage({ conversationId: conv.id, role: "user", content: "x" });
    store.addMessage({ conversationId: conv.id, role: "assistant", content: "y" });

    store.deleteConversation(conv.id);

    expect(store.getConversation(conv.id)).toBeUndefined();
    expect(store.listMessages(conv.id)).toEqual([]);
  });

  it("orders messages by created_at ascending", async () => {
    const conv = store.createConversation("Chat");
    const a = store.addMessage({ conversationId: conv.id, role: "user", content: "a" });
    await new Promise((r) => setTimeout(r, 5));
    const b = store.addMessage({ conversationId: conv.id, role: "user", content: "b" });
    await new Promise((r) => setTimeout(r, 5));
    const c = store.addMessage({ conversationId: conv.id, role: "user", content: "c" });

    const messages = store.listMessages(conv.id).map((m) => m.content);
    expect(messages).toEqual(["a", "b", "c"]);
    expect(messages).toEqual([a.content, b.content, c.content]);
  });
});
