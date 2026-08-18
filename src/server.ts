import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { RunService } from "./core/run-service.js";
import type { ChatService } from "./core/chat-service.js";
import type { AdapterRegistry } from "./core/adapter-registry.js";
import type { ChatMessage, HarnessEvent } from "./harness/types.js";
import { formatOpenAIResponse } from "./openai/format-response.js";
import { sseDone, createSSEStreamMapper } from "./openai/sse.js";

export interface CreateGatewayServerOptions {
  runService: RunService;
  chatService?: ChatService;
  adapterRegistry?: AdapterRegistry;
  port?: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_PATH = resolve(__dirname, "./ui/index.html");

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

function methodNotAllowed(res: ServerResponse) {
  sendJson(res, 405, { error: { message: "Method not allowed", type: "invalid_request_error" } });
}

function notFound(res: ServerResponse) {
  sendJson(res, 404, { error: { message: "Not found", type: "invalid_request_error" } });
}

function notImplemented(res: ServerResponse, message: string) {
  sendJson(res, 501, { error: { message, type: "server_error" } });
}

function parseJsonBody(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function sendServerError(res: ServerResponse, err: unknown) {
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

function streamSSE(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { runId: string; model: string; events: AsyncGenerator<HarnessEvent>; onClose: () => void },
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const mapEvent = createSSEStreamMapper({ runId: opts.runId, model: opts.model });
  let closed = false;
  let finished = false;

  const closeOnce = () => {
    if (!closed && !finished) {
      closed = true;
      opts.onClose();
    }
  };

  req.on("close", closeOnce);
  res.on("close", closeOnce);

  (async () => {
    try {
      for await (const event of opts.events) {
        if (closed) return;
        const frame = mapEvent(event);
        if (frame) res.write(frame);
      }
    } catch {
      // Terminal framing is still emitted; harness internals are not leaked.
    } finally {
      finished = true;
      if (!closed) {
        res.write(sseDone());
        res.end();
      }
    }
  })();
}

async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  runService: RunService,
): Promise<void> {
  if (req.method !== "POST") {
    methodNotAllowed(res);
    return;
  }

  const raw = await readBody(req);
  const parsed = parseJsonBody(raw);
  if (!parsed) {
    sendJson(res, 400, { error: { message: "Invalid JSON body", type: "invalid_request_error" } });
    return;
  }

  if (typeof parsed.model !== "string" || !Array.isArray(parsed.messages)) {
    sendJson(res, 400, {
      error: { message: "Invalid request: 'model' (string) and 'messages' (array) are required.", type: "invalid_request_error" },
    });
    return;
  }

  const messages = parsed.messages as ChatMessage[];

  if (parsed.stream === true) {
    const handle = await runService.stream({ model: parsed.model, messages });
    streamSSE(req, res, {
      runId: handle.runId,
      model: parsed.model,
      events: handle.events,
      onClose: () => {
        void handle.cancel();
      },
    });
    return;
  }

  const result = await runService.run({ model: parsed.model, messages });

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

function runIdFromPath(path: string, prefix: string, suffix = ""): string | undefined {
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  if (!suffix) {
    if (rest === "" || rest.includes("/")) return undefined;
    return rest;
  }
  if (!rest.endsWith(suffix)) return undefined;
  const id = rest.slice(0, -suffix.length);
  if (id === "" || id.includes("/")) return undefined;
  return id;
}

async function handleCancelRun(
  req: IncomingMessage,
  res: ServerResponse,
  runService: RunService,
): Promise<void> {
  if (req.method !== "POST") {
    methodNotAllowed(res);
    return;
  }

  const runId = runIdFromPath(req.url ?? "", "/v1/runs/", "/cancel");
  if (!runId || !runService.getRun(runId)) {
    notFound(res);
    return;
  }

  await runService.cancel(runId);
  sendJson(res, 200, { id: runId, status: "cancelling" });
}

async function handleGetRun(
  req: IncomingMessage,
  res: ServerResponse,
  runService: RunService,
): Promise<void> {
  if (req.method !== "GET") {
    methodNotAllowed(res);
    return;
  }

  const runId = runIdFromPath(req.url ?? "", "/v1/runs/");
  const row = runId ? runService.getRun(runId) : undefined;
  if (!row) {
    notFound(res);
    return;
  }

  sendJson(res, 200, {
    id: row.id,
    status: row.status,
    requested_model: row.requested_model,
    resolved_model: row.resolved_model,
    harness: row.harness,
    session_id: row.session_id,
    duration_ms: row.duration_ms,
    usage: row.usage_json ? JSON.parse(row.usage_json) : null,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    error_message: row.error_message,
  });
}

async function handleModels(
  req: IncomingMessage,
  res: ServerResponse,
  adapterRegistry: AdapterRegistry | undefined,
): Promise<void> {
  if (req.method !== "GET") {
    methodNotAllowed(res);
    return;
  }

  if (!adapterRegistry) {
    notImplemented(res, "Model listing is not available.");
    return;
  }

  const data: Array<{ id: string; object: "model"; created: number; owned_by: string }> = [];
  const created = Math.floor(Date.now() / 1000);
  for (const adapterId of adapterRegistry.ids()) {
    const adapter = adapterRegistry.get(adapterId);
    if (!adapter) continue;
    const models = await adapter.listModels();
    for (const model of models) {
      data.push({ id: `${adapterId}/${model}`, object: "model", created, owned_by: adapterId });
    }
  }

  sendJson(res, 200, { object: "list", data });
}

async function handleConversations(
  req: IncomingMessage,
  res: ServerResponse,
  chatService: ChatService | undefined,
): Promise<void> {
  if (!chatService) {
    notImplemented(res, "Conversation support is not available.");
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, chatService.listConversations());
    return;
  }

  if (req.method === "POST") {
    const raw = await readBody(req);
    const parsed = parseJsonBody(raw);
    if (!parsed || (parsed.title !== undefined && typeof parsed.title !== "string")) {
      sendJson(res, 400, { error: { message: "Invalid title", type: "invalid_request_error" } });
      return;
    }
    const conversation = chatService.createConversation(parsed.title as string | undefined);
    sendJson(res, 201, conversation);
    return;
  }

  methodNotAllowed(res);
}

async function handleConversationItem(
  req: IncomingMessage,
  res: ServerResponse,
  chatService: ChatService | undefined,
  conversationId: string,
): Promise<void> {
  if (!chatService) {
    notImplemented(res, "Conversation support is not available.");
    return;
  }

  const conversation = chatService.getConversation(conversationId);
  if (!conversation) {
    notFound(res);
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, { ...conversation, messages: chatService.listMessages(conversationId) });
    return;
  }

  if (req.method === "PATCH") {
    const raw = await readBody(req);
    const parsed = parseJsonBody(raw);
    if (!parsed || typeof parsed.title !== "string") {
      sendJson(res, 400, { error: { message: "Invalid title", type: "invalid_request_error" } });
      return;
    }
    const updated = chatService.updateTitle(conversationId, parsed.title);
    sendJson(res, 200, updated);
    return;
  }

  methodNotAllowed(res);
}

async function handleConversationMessages(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { chatService: ChatService | undefined; runService: RunService },
  conversationId: string,
): Promise<void> {
  const { chatService, runService } = opts;
  if (!chatService) {
    notImplemented(res, "Conversation support is not available.");
    return;
  }

  const conversation = chatService.getConversation(conversationId);
  if (!conversation) {
    notFound(res);
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, chatService.listMessages(conversationId));
    return;
  }

  if (req.method === "POST") {
    const raw = await readBody(req);
    const parsed = parseJsonBody(raw);
    if (!parsed || typeof parsed.content !== "string" || (parsed.model !== undefined && typeof parsed.model !== "string")) {
      sendJson(res, 400, { error: { message: "Invalid message body", type: "invalid_request_error" } });
      return;
    }

    const result = await chatService.sendMessage(conversationId, {
      content: parsed.content,
      model: parsed.model as string | undefined,
    });

    streamSSE(req, res, {
      runId: result.runId,
      model: parsed.model ?? "fake-harness/fake-model",
      events: result.events,
      onClose: () => {
        void runService.cancel(result.runId);
      },
    });
    return;
  }

  methodNotAllowed(res);
}

async function serveUI(res: ServerResponse): Promise<void> {
  try {
    const html = await readFile(UI_PATH, "utf-8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    sendJson(res, 500, { error: { message: "UI not found", type: "server_error" } });
  }
}

export function createGatewayServer(opts: CreateGatewayServerOptions) {
  const port = opts.port ?? 3000;

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";

    try {
      if (url === "/v1/chat/completions") {
        await handleChatCompletions(req, res, opts.runService);
        return;
      }

      if (url.startsWith("/v1/runs/") && url.endsWith("/cancel")) {
        await handleCancelRun(req, res, opts.runService);
        return;
      }

      if (url.startsWith("/v1/runs/")) {
        await handleGetRun(req, res, opts.runService);
        return;
      }

      if (url === "/v1/models") {
        await handleModels(req, res, opts.adapterRegistry);
        return;
      }

      if (url === "/v1/conversations") {
        await handleConversations(req, res, opts.chatService);
        return;
      }

      if (url.startsWith("/v1/conversations/")) {
        const rest = url.slice("/v1/conversations/".length);
        if (rest.endsWith("/messages")) {
          const conversationId = rest.slice(0, -"/messages".length);
          if (!conversationId || conversationId.includes("/")) {
            notFound(res);
            return;
          }
          await handleConversationMessages(req, res, { chatService: opts.chatService, runService: opts.runService }, conversationId);
          return;
        }

        if (rest !== "" && !rest.includes("/")) {
          await handleConversationItem(req, res, opts.chatService, rest);
          return;
        }

        notFound(res);
        return;
      }

      if (url === "/" || url === "/index.html") {
        await serveUI(res);
        return;
      }

      notFound(res);
    } catch (err) {
      sendServerError(res, err);
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
