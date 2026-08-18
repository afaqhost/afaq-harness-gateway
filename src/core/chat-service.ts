import type { ChatMessage, HarnessEvent } from "../harness/types.js";
import type { RunService, RunStreamHandle } from "./run-service.js";
import { ChatStore, type ConversationRow, type MessageRow } from "./chat-store.js";

export interface ChatServiceOptions {
  runService: RunService;
  chatStore: ChatStore;
}

export interface SendMessageInput {
  content: string;
  model?: string;
}

export interface ChatSendResult {
  runId: string;
  events: AsyncGenerator<HarnessEvent>;
}

export class ChatService {
  private readonly runService: RunService;
  private readonly chatStore: ChatStore;

  constructor(options: ChatServiceOptions) {
    this.runService = options.runService;
    this.chatStore = options.chatStore;
  }

  listConversations(): ConversationRow[] {
    return this.chatStore.listConversations();
  }

  createConversation(title?: string): ConversationRow {
    return this.chatStore.createConversation(title);
  }

  getConversation(id: string): ConversationRow | undefined {
    return this.chatStore.getConversation(id);
  }

  listMessages(conversationId: string): MessageRow[] {
    return this.chatStore.listMessages(conversationId);
  }

  updateTitle(conversationId: string, title: string): ConversationRow | undefined {
    return this.chatStore.updateConversationTitle(conversationId, title);
  }

  async sendMessage(conversationId: string, input: SendMessageInput): Promise<ChatSendResult> {
    const conversation = this.chatStore.getConversation(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found.");
    }

    this.chatStore.addMessage({
      conversationId,
      role: "user",
      content: input.content,
    });

    const history = this.buildHistory(conversationId);

    if (conversation.title === "New conversation") {
      this.chatStore.updateConversationTitle(conversationId, input.content.slice(0, 80));
    }

    const model = input.model ?? "fake-harness/fake-model";
    const handle = await this.runService.stream({
      model,
      messages: history,
    });

    return this.wrapHandle(conversationId, handle);
  }

  private buildHistory(conversationId: string): ChatMessage[] {
    return this.chatStore.listMessages(conversationId).map((message) => ({
      role: message.role as ChatMessage["role"],
      content: message.content,
    }));
  }

  private wrapHandle(conversationId: string, handle: RunStreamHandle): ChatSendResult {
    let assistantText = "";
    let assistantPersisted = false;

    const persistAssistant = async () => {
      if (assistantPersisted) return;
      assistantPersisted = true;
      this.chatStore.addMessage({
        conversationId,
        role: "assistant",
        content: assistantText,
        runId: handle.runId,
      });
    };

    let sawError = false;

    const events = (async function* (): AsyncGenerator<HarnessEvent> {
      try {
        for await (const event of handle.events) {
          if (event.type === "text_delta") assistantText += event.text;
          if (event.type === "completed" && event.text) assistantText = event.text;
          yield event;
        }
      } catch (err) {
        sawError = true;
        throw err;
      } finally {
        if (!sawError) await persistAssistant();
      }
    })();

    return { runId: handle.runId, events };
  }
}
