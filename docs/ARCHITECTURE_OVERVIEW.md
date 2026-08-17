# Architecture Overview

```text
Clients
  |  OpenAI-compatible HTTP/SSE
  v
Afaq Harness Gateway
  |
  +-- Auth / keys
  +-- Model registry / aliases
  +-- Run service
  +-- Queue / concurrency
  +-- Usage / cost
  +-- Admin + Chat UI
  +-- Adapter registry
           |
           +-- Command-Code
           +-- Codex
           +-- Claude Code
           +-- OpenCode
           +-- future adapters
                    |
                    v
               Local CLI
                    |
                    v
            Account / Model Provider
```

The gateway owns normalized transport and lifecycle behavior. Adapters own CLI-specific integration.
