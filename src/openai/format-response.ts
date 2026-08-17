import type { HarnessEvent, Usage } from "../harness/types.js";

export interface OpenAIChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: "stop" | "length" | null;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface FormatResponseOptions {
  runId: string;
  model: string;
  created?: number;
}

export function formatOpenAIResponse(
  events: HarnessEvent[],
  opts: FormatResponseOptions,
): OpenAIChatCompletion {
  let text = "";
  let usage: Usage | undefined;

  for (const event of events) {
    switch (event.type) {
      case "text_delta":
        text += event.text;
        break;
      case "completed":
        if (event.text) text = event.text;
        if (event.usage) usage = event.usage;
        break;
      case "usage":
        usage = event.usage;
        break;
    }
  }

  return {
    id: `chatcmpl-${opts.runId}`,
    object: "chat.completion",
    created: opts.created ?? Math.floor(Date.now() / 1000),
    model: opts.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: usage?.inputTokens ?? 0,
      completion_tokens: usage?.outputTokens ?? 0,
      total_tokens: usage?.totalTokens ?? 0,
    },
  };
}
