import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { HarnessAdapter, HarnessEvent, HarnessRunRequest } from "./harness/types.js";
import { formatOpenAIResponse } from "./openai/format-response.js";

export interface CreateGatewayServerOptions {
  adapter: HarnessAdapter;
  port?: number;
  defaultTimeoutMs?: number;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  adapter: HarnessAdapter,
  defaultTimeoutMs: number,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: { message: "Method not allowed", type: "invalid_request_error" } });
    return;
  }

  let body: unknown;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: { message: "Invalid JSON body", type: "invalid_request_error" } });
    return;
  }

  const parsed = body as Record<string, unknown>;

  if (parsed.stream === true) {
    sendJson(res, 400, {
      error: {
        message: "Streaming is not supported in this version. Set stream: false.",
        type: "invalid_request_error",
      },
    });
    return;
  }

  if (typeof parsed.model !== "string" || !Array.isArray(parsed.messages)) {
    sendJson(res, 400, {
      error: { message: "Invalid request: 'model' (string) and 'messages' (array) are required.", type: "invalid_request_error" },
    });
    return;
  }

  const runId = randomUUID();
  const request: HarnessRunRequest = {
    runId,
    model: parsed.model,
    messages: parsed.messages as HarnessRunRequest["messages"],
    stream: false,
    timeoutMs: defaultTimeoutMs,
  };

  const events: HarnessEvent[] = [];
  let failed = false;

  try {
    for await (const event of adapter.run(request)) {
      if (event.type === "failed") {
        sendJson(res, 502, {
          error: { message: event.message, type: "server_error" },
        });
        failed = true;
        break;
      }
      events.push(event);
    }
  } catch (err) {
    sendJson(res, 500, {
      error: { message: `Internal error: ${err instanceof Error ? err.message : String(err)}`, type: "server_error" },
    });
    return;
  }

  if (failed) return;

  const completion = formatOpenAIResponse(events, { runId, model: parsed.model });
  sendJson(res, 200, completion);
}

export function createGatewayServer(opts: CreateGatewayServerOptions) {
  const port = opts.port ?? 3000;
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;

  const server = createServer(async (req, res) => {
    if (req.url === "/v1/chat/completions") {
      await handleChatCompletions(req, res, opts.adapter, defaultTimeoutMs);
    } else {
      sendJson(res, 404, { error: { message: "Not found", type: "invalid_request_error" } });
    }
  });

  return {
    server,
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(port, resolve);
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    port,
  };
}
