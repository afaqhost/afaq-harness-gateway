import type { HarnessRunRequest } from "./types.js";

export function serializeMessages(messages: HarnessRunRequest["messages"]): string {
  return messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");
}
