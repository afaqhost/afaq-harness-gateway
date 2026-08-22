import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createGatewayServer } from "./server.js";
import { RunService } from "./core/run-service.js";
import { RunStore } from "./core/store.js";
import { AdapterRegistry } from "./core/adapter-registry.js";
import { AuthService } from "./core/auth-service.js";
import { ApiKeyStore } from "./core/api-key-store.js";
import { UserStore } from "./core/user-store.js";
import { SessionStore } from "./core/session-store.js";
import { ChatService } from "./core/chat-service.js";
import { ChatStore } from "./core/chat-store.js";
import { CommandCodeAdapter } from "./harness/command-code.js";
import { CodexAdapter } from "./harness/codex.js";
import { ClaudeCodeAdapter } from "./harness/claude-code.js";
import { OpenCodeAdapter } from "./harness/opencode.js";
import { GATEWAY_VERSION } from "./version.js";

const host = process.env.AHG_HOST ?? "127.0.0.1";
const port = Number(process.env.AHG_PORT ?? 3000);
const dataDir = process.env.AHG_DATA_DIR ?? ".data";

mkdirSync(dataDir, { recursive: true });

const runStore = new RunStore(join(dataDir, "runs.db"));

const adapterRegistry = new AdapterRegistry();
adapterRegistry.register(new CommandCodeAdapter());
adapterRegistry.register(new CodexAdapter());
adapterRegistry.register(new ClaudeCodeAdapter());
adapterRegistry.register(new OpenCodeAdapter());

const runService = new RunService({ adapterRegistry, store: runStore });

const authDbPath = join(dataDir, "auth.db");
const authService = new AuthService({
  apiKeyStore: new ApiKeyStore(authDbPath),
  userStore: new UserStore(authDbPath),
  sessionStore: new SessionStore(authDbPath),
});

const chatStore = new ChatStore(join(dataDir, "chat.db"));
const chatService = new ChatService({ runService, chatStore });

const server = createGatewayServer({ runService, adapterRegistry, authService, chatService, host, port });

process.on("unhandledRejection", (err) => {
  console.error(err);
  process.exit(1);
});

await server.start();
console.error(`afaq-harness-gateway v${GATEWAY_VERSION} listening on ${host}:${port}`);
