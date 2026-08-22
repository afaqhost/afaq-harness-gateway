import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { RunService } from "./core/run-service.js";
import type { ChatService } from "./core/chat-service.js";
import type { AdapterRegistry } from "./core/adapter-registry.js";
import type { AuthService } from "./core/auth-service.js";
import type { UsageLimiter } from "./core/limits.js";
import type { ApiKeyRow } from "./core/api-key-store.js";
import type { ChatMessage, HarnessEvent } from "./harness/types.js";
import { UsageLimitError } from "./core/limits.js";
import { logger } from "./core/logger.js";
import { formatOpenAIResponse } from "./openai/format-response.js";
import { sseDone, createSSEStreamMapper } from "./openai/sse.js";

export interface CreateGatewayServerOptions {
  runService: RunService;
  chatService?: ChatService;
  adapterRegistry?: AdapterRegistry;
  authService?: AuthService;
  usageLimiter?: UsageLimiter;
  host?: string;
  port?: number;
  maxBodyBytes?: number;
}

export class RequestTooLargeError extends Error {
  constructor(public readonly maxBodyBytes: number) {
    super(`Request body exceeds ${maxBodyBytes} bytes.`);
    this.name = "RequestTooLargeError";
  }
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_PATH = resolve(__dirname, "./ui/index.html");

function readBody(req: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        req.removeAllListeners("data");
        req.pause();
        reject(new RequestTooLargeError(maxBodyBytes));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
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
  } else if (code === "model_not_allowed") {
    sendPermissionError(res, runServiceError.message ?? "Model not allowed.");
  } else {
    sendJson(res, 500, {
      error: { message: `Internal error: ${runServiceError.message ?? String(err)}`, type: "server_error" },
    });
  }
}

function getBearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function readCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) cookies[key] = val;
  }
  return cookies;
}

function sendAuthError(res: ServerResponse, message: string) {
  sendJson(res, 401, { error: { message, type: "authentication_error" } });
}

function sendPermissionError(res: ServerResponse, message: string) {
  sendJson(res, 403, { error: { message, type: "permission_error" } });
}

function sendRateLimitError(res: ServerResponse, message: string) {
  sendJson(res, 429, { error: { message, type: "rate_limit_error" } });
}

function publicApiKey(row: ApiKeyRow) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    enabled: row.enabled,
    model_allowlist: row.model_allowlist_json ? JSON.parse(row.model_allowlist_json) : null,
    rpm_limit: row.rpm_limit,
    max_concurrency: row.max_concurrency,
    monthly_budget_usd: row.monthly_budget_usd,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function currentMonthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function streamSSE(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { runId: string; model: string; events: AsyncGenerator<HarnessEvent>; onClose: () => void; onDone?: () => void },
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
      opts.onDone?.();
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
      opts.onDone?.();
    }
  })();
}

async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  runService: RunService,
  auth: { key: ApiKeyRow; usageLimiter?: UsageLimiter } | undefined,
  maxBodyBytes: number,
): Promise<void> {
  if (req.method !== "POST") {
    methodNotAllowed(res);
    return;
  }

  const raw = await readBody(req, maxBodyBytes);
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
  const allowlist = auth?.key?.model_allowlist_json ? JSON.parse(auth.key.model_allowlist_json) as string[] : [];

  if (auth) {
    const { key, usageLimiter } = auth;
    try {
      if (usageLimiter) {
        usageLimiter.checkRpm(key.id, key.rpm_limit);
        const monthStart = currentMonthStart();
        usageLimiter.checkBudget(runService.getEstimatedCostSince(key.id, monthStart), key.monthly_budget_usd);
      }
    } catch (err) {
      if (err instanceof UsageLimitError) {
        sendRateLimitError(res, err.message);
        return;
      }
      throw err;
    }

    try {
      if (parsed.stream === true) {
        let release: (() => void) | undefined;
        if (usageLimiter) {
          release = usageLimiter.acquireConcurrency(key.id, key.max_concurrency);
        }
        try {
          const handle = await runService.stream({
            model: parsed.model,
            messages,
            apiKeyId: key.id,
            allowedModels: allowlist.length > 0 ? allowlist : undefined,
          });
          streamSSE(req, res, {
            runId: handle.runId,
            model: parsed.model,
            events: handle.events,
            onClose: () => {
              void handle.cancel();
            },
            onDone: () => {
              release?.();
            },
          });
        } catch (err) {
          release?.();
          if (err instanceof UsageLimitError) {
            sendRateLimitError(res, err.message);
            return;
          }
          throw err;
        }
      } else {
        let release: (() => void) | undefined;
        if (usageLimiter) {
          release = usageLimiter.acquireConcurrency(key.id, key.max_concurrency);
        }
        try {
          const result = await runService.run({
            model: parsed.model,
            messages,
            apiKeyId: key.id,
            allowedModels: allowlist.length > 0 ? allowlist : undefined,
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
        } finally {
          release?.();
        }
      }
    } catch (err) {
      if (err instanceof UsageLimitError) {
        sendRateLimitError(res, err.message);
        return;
      }
      throw err;
    }
    return;
  }

  // No auth — existing behavior
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
    estimated_cost_usd: row.estimated_cost_usd,
    cost_is_estimated: true,
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
  allowlist?: string[],
): Promise<void> {
  if (req.method !== "GET") {
    methodNotAllowed(res);
    return;
  }

  if (!adapterRegistry) {
    notImplemented(res, "Model listing is not available.");
    return;
  }

  let data: Array<{ id: string; object: "model"; created: number; owned_by: string }> = [];
  const created = Math.floor(Date.now() / 1000);
  for (const adapterId of adapterRegistry.ids()) {
    const adapter = adapterRegistry.get(adapterId);
    if (!adapter) continue;
    const models = await adapter.listModels();
    for (const model of models) {
      data.push({ id: `${adapterId}/${model}`, object: "model", created, owned_by: adapterId });
    }
  }

  if (allowlist && allowlist.length > 0) {
    data = data.filter((m) => allowlist.includes(m.id));
  }

  sendJson(res, 200, { object: "list", data });
}

async function handleConversations(
  req: IncomingMessage,
  res: ServerResponse,
  chatService: ChatService | undefined,
  maxBodyBytes: number,
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
    const raw = await readBody(req, maxBodyBytes);
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
  maxBodyBytes: number,
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
    const raw = await readBody(req, maxBodyBytes);
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
  maxBodyBytes: number,
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
    const raw = await readBody(req, maxBodyBytes);
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
  const authService = opts.authService;
  const usageLimiter = opts.usageLimiter;
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  async function healthResponse(): Promise<{ status: string; harnesses?: Record<string, { ok: boolean; message?: string }> }> {
    if (!opts.adapterRegistry) {
      return { status: "ok" };
    }
    const harnesses: Record<string, { ok: boolean; message?: string }> = {};
    for (const adapterId of opts.adapterRegistry.ids()) {
      const adapter = opts.adapterRegistry.get(adapterId);
      if (!adapter) continue;
      const health = await adapter.health();
      harnesses[adapterId] = health.ok ? { ok: true } : { ok: false, message: health.message };
    }
    const allOk = Object.values(harnesses).every((h) => h.ok);
    return { status: allOk ? "ok" : "degraded", harnesses };
  }

  function requireApiKey(req: IncomingMessage, res: ServerResponse): ApiKeyRow | undefined {
    if (!authService) return undefined;
    const token = getBearerToken(req);
    if (!token) {
      sendAuthError(res, "Missing API key.");
      return undefined;
    }
    const result = authService.authenticateApiKey(token);
    if (!result.ok) {
      const messages = {
        invalid: "Invalid API key.",
        disabled: "API key is disabled.",
        expired: "API key has expired.",
      };
      sendAuthError(res, messages[result.reason]);
      return undefined;
    }
    authService.setLastUsed(result.key.id);
    return result.key;
  }

  async function requireSession(req: IncomingMessage, res: ServerResponse): Promise<{ id: string; username: string } | undefined> {
    if (!authService) {
      notImplemented(res, "Authentication is not available.");
      return undefined;
    }
    const cookies = readCookies(req);
    const token = cookies["ahg_session"];
    if (!token) {
      sendAuthError(res, "Session required.");
      return undefined;
    }
    const user = await authService.getUserBySession(token);
    if (!user) {
      sendAuthError(res, "Invalid or expired session.");
      return undefined;
    }
    return { id: user.id, username: user.username };
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const requestId = randomUUID();
    const startedAt = Date.now();
    res.setHeader("x-request-id", requestId);

    const logRequest = (status: number, keyId?: string) => {
      logger.info("http_request", {
        request_id: requestId,
        method: req.method ?? "",
        path: url,
        status,
        duration_ms: Date.now() - startedAt,
        key_id: keyId ?? null,
      });
    };

    try {
      if (url === "/health") {
        const health = await healthResponse();
        sendJson(res, health.status === "ok" ? 200 : 503, health);
        logRequest(health.status === "ok" ? 200 : 503);
        return;
      }

      if (url === "/v1/chat/completions") {
        const key = requireApiKey(req, res);
        if (authService && !key) return;
        await handleChatCompletions(req, res, opts.runService, key ? { key, usageLimiter } : undefined, maxBodyBytes);
        logRequest(res.statusCode, key?.id);
        return;
      }

      if (url.startsWith("/v1/runs/") && url.endsWith("/cancel")) {
        const key = requireApiKey(req, res);
        if (authService && !key) return;
        await handleCancelRun(req, res, opts.runService);
        logRequest(res.statusCode, key?.id);
        return;
      }

      if (url.startsWith("/v1/runs/")) {
        const key = requireApiKey(req, res);
        if (authService && !key) return;
        await handleGetRun(req, res, opts.runService);
        logRequest(res.statusCode, key?.id);
        return;
      }

      if (url === "/v1/models") {
        const key = requireApiKey(req, res);
        if (authService && !key) return;
        const allowlist = key?.model_allowlist_json ? JSON.parse(key.model_allowlist_json) as string[] : undefined;
        await handleModels(req, res, opts.adapterRegistry, allowlist);
        logRequest(res.statusCode, key?.id);
        return;
      }

      if (url === "/v1/usage") {
        if (!authService) {
          notImplemented(res, "Usage tracking is not available.");
          return;
        }
        const key = requireApiKey(req, res);
        if (!key) return;
        const monthStart = currentMonthStart();
        const estimatedCost = opts.runService.getEstimatedCostSince(key.id, monthStart);
        sendJson(res, 200, {
          object: "usage",
          key_id: key.id,
          period_start: monthStart,
          period_end: new Date().toISOString(),
          estimated_cost_usd: estimatedCost,
          currency: "USD",
          estimated: true,
        });
        logRequest(res.statusCode, key.id);
        return;
      }

      // Auth routes
      if (url === "/auth/setup" && req.method === "POST") {
        if (!authService) {
          notImplemented(res, "Authentication is not available.");
          return;
        }
        const raw = await readBody(req, maxBodyBytes);
        const parsed = parseJsonBody(raw);
        if (!parsed || typeof parsed.username !== "string" || typeof parsed.password !== "string") {
          sendJson(res, 400, { error: { message: "Username and password are required.", type: "invalid_request_error" } });
          return;
        }
        const hasUsers = authService.hasUsers();
        if (hasUsers) {
          sendJson(res, 409, { error: { message: "Setup disabled: users already exist.", type: "invalid_request_error" } });
          return;
        }
        try {
          const user = await authService.createUser(parsed.username, parsed.password);
          sendJson(res, 201, { id: user.id, username: user.username });
        } catch (err) {
          sendJson(res, 400, { error: { message: (err as Error).message, type: "invalid_request_error" } });
        }
        return;
      }

      if (url === "/auth/login" && req.method === "POST") {
        if (!authService) {
          notImplemented(res, "Authentication is not available.");
          return;
        }
        const raw = await readBody(req, maxBodyBytes);
        const parsed = parseJsonBody(raw);
        if (!parsed || typeof parsed.username !== "string" || typeof parsed.password !== "string") {
          sendJson(res, 400, { error: { message: "Username and password are required.", type: "invalid_request_error" } });
          return;
        }
        const result = await authService.login(parsed.username, parsed.password);
        if (!result) {
          sendAuthError(res, "Invalid username or password.");
          return;
        }
        res.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": `ahg_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(result.expiresAt).toUTCString()}`,
        });
        const user = await authService.getUserBySession(result.token);
        res.end(JSON.stringify({ id: user!.id, username: user!.username }));
        return;
      }

      if (url === "/auth/logout" && req.method === "POST") {
        if (!authService) {
          notImplemented(res, "Authentication is not available.");
          return;
        }
        const cookies = readCookies(req);
        const token = cookies["ahg_session"];
        if (token) {
          await authService.logout(token);
        }
        res.writeHead(204, {
          "set-cookie": "ahg_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        });
        res.end();
        return;
      }

      // Key management routes
      if (url === "/v1/keys" && req.method === "GET") {
        const user = await requireSession(req, res);
        if (!user) return;
        const keys = authService!.listApiKeys();
        sendJson(res, 200, { object: "list", data: keys.map(publicApiKey) });
        return;
      }

      if (url === "/v1/keys" && req.method === "POST") {
        const user = await requireSession(req, res);
        if (!user) return;
        const raw = await readBody(req, maxBodyBytes);
        const parsed = parseJsonBody(raw);
        if (!parsed || typeof parsed.name !== "string") {
          sendJson(res, 400, { error: { message: "name is required.", type: "invalid_request_error" } });
          return;
        }
        const { fullKey, row } = authService!.createApiKey({
          name: parsed.name,
          modelAllowlist: parsed.model_allowlist as string[] | undefined,
          rpmLimit: parsed.rpm_limit as number | undefined,
          maxConcurrency: parsed.max_concurrency as number | undefined,
          monthlyBudgetUsd: parsed.monthly_budget_usd as number | undefined,
          expiresAt: parsed.expires_at as string | undefined,
        });
        sendJson(res, 201, { full_key: fullKey, key: publicApiKey(row) });
        return;
      }

      if (url.match(/^\/v1\/keys\/[^/]+\/disable$/) && req.method === "POST") {
        const user = await requireSession(req, res);
        if (!user) return;
        const keyId = url.split("/")[3];
        authService!.disableApiKey(keyId);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.match(/^\/v1\/keys\/[^/]+\/enable$/) && req.method === "POST") {
        const user = await requireSession(req, res);
        if (!user) return;
        const keyId = url.split("/")[3];
        authService!.enableApiKey(keyId);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.match(/^\/v1\/keys\/[^/]+$/) && req.method === "DELETE") {
        const user = await requireSession(req, res);
        if (!user) return;
        const keyId = url.split("/")[3];
        authService!.deleteApiKey(keyId);
        sendJson(res, 200, { ok: true });
        return;
      }

      // Conversation and UI routes
      if (url === "/v1/conversations") {
        if (authService) {
          const user = await requireSession(req, res);
          if (!user) return;
        }
        await handleConversations(req, res, opts.chatService, maxBodyBytes);
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
          if (authService) {
            const user = await requireSession(req, res);
            if (!user) return;
          }
          await handleConversationMessages(req, res, { chatService: opts.chatService, runService: opts.runService }, conversationId, maxBodyBytes);
          return;
        }

        if (rest !== "" && !rest.includes("/")) {
          if (authService) {
            const user = await requireSession(req, res);
            if (!user) return;
          }
          await handleConversationItem(req, res, opts.chatService, rest, maxBodyBytes);
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
      logRequest(res.statusCode);
    } catch (err) {
      if (err instanceof RequestTooLargeError) {
        sendJson(res, 413, { error: { message: err.message, type: "invalid_request_error" } });
        logRequest(413);
        return;
      }
      sendServerError(res, err);
      logRequest(res.statusCode);
    }
  });

  return {
    server,
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(port, opts.host ?? "127.0.0.1", resolve);
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    port,
  };
}
