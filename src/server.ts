import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { RunService } from "./core/run-service.js";
import type { ChatMessage } from "./harness/types.js";
import { formatOpenAIResponse } from "./openai/format-response.js";

export interface CreateGatewayServerOptions {
  runService: RunService;
  port?: number;
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
  runService: RunService,
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

  const result = await runService.run({
    model: parsed.model,
    messages: parsed.messages as ChatMessage[],
  });

  switch (result.status) {
    case "completed": {
      const completion = formatOpenAIResponse(result.events, { runId: result.runId, model: parsed.model });
      sendJson(res, 200, completion);
      return;
    }
    case "failed":
    case "timed_out":
    case "cancelled": {
      sendJson(res, 502, {
        error: { message: result.message, type: "server_error" },
      });
      return;
    }
    default:
      sendJson(res, 500, {
        error: { message: "Unknown run outcome", type: "server_error" },
      });
  }
}

export function createGatewayServer(opts: CreateGatewayServerOptions) {
  const port = opts.port ?? 3000;

  const server = createServer(async (req, res) => {
    if (req.url === "/v1/chat/completions") {
      try {
        await handleChatCompletions(req, res, opts.runService);
      } catch (err) {
        const runServiceError = err as { code?: string; message?: string };
        const code = runServiceError.code;

        if (code === "invalid_model" || code === "unknown_harness") {
          sendJson(res, 400, {
            error: { message: runServiceError.message ?? "Invalid model", type: "invalid_request_error" },
          });
        } else if (code === "queue_full") {
          sendJson(res, 429, {
            error: { message: runServiceError.message ?? "Queue is full", type: "rate_limit_error" },
          });
        } else {
          sendJson(res, 500, {
            error: { message: `Internal error: ${runServiceError.message ?? String(err)}`, type: "server_error" },
          });
        }
      }
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
