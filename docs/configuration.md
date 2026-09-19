# Configuration

Configuration is loaded from `.env` through `pydantic-settings`. Start from `.env.example`, keep `.env` private, and replace development secrets before deployment.

| Variable | Default | Description |
| --- | --- | --- |
| `APP_NAME` | `Afaq Harness Gateway` | Application display name |
| `VERSION` | `0.1.0` | Application version returned by `/health` |
| `HOST` | `localhost` | Default host setting |
| `PORT` | `3500` | Default application port |
| `DEBUG` | `false` | Debug setting exposed to application configuration |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/afaq.db` | Async SQLAlchemy database URL |
| `SECRET_KEY` | `""` (empty, must be set) | JWT signing secret; **required in production** (fails fast if empty when `DEBUG=false`) |
| `CREDENTIALS_KEY` | `""` (empty, must be set) | Input to the Fernet credentials key derivation; **required in production** |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | JWT lifetime in minutes |
| `HARNESS_TIMEOUT_SECONDS` | `600` | Maximum duration for a harness process |
| `HARNESS_DATA_DIR` | `storage/harnesses` | Local harness data directory |
| `UPLOADS_DIR` | `storage/uploads` | Local upload directory |
| `ALLOWED_ORIGINS` | `http://127.0.0.1:3500,http://localhost:3500` | Comma-separated CORS origins (tightened from `*` in S1) |
| `MODEL_REFRESH_SECONDS` | `300` | Reserved; refresh is startup + `POST /api/admin/harnesses/refresh` |
| `RATE_LIMIT_PER_MINUTE` | `60` | Global per-bucket rate limit (requests/minute) |
| `RATE_LIMIT_ENABLED` | `true` | Set `false` to disable rate limiting (e.g., for load tests) |
| `HARNESS_CONCURRENCY` | `5` | Max concurrent harness subprocesses per replica (backpressure via `app/services/harness_queue.py`) |
| `HARNESS_QUEUE_MAX_WAIT` | `30` | Seconds to wait for a concurrency slot before `429` |
| `SSE_HEARTBEAT_SECONDS` | `15` | SSE keepalive interval (`: keepalive` every N seconds) |
| `SSE_RETRY_MS` | `3000` | SSE `retry:` field (milliseconds) |
| `REDIS_URL` | `""` | `redis://host:6379/0` for multi-replica rate limit/history/jobs; empty → in-memory fallback |
| `REDIS_ENABLED` | `false` | Auto-enabled when `REDIS_URL` is set; set explicitly if needed |

## Secret Generation

Generate random values instead of using the placeholders:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Assign separate values to `SECRET_KEY` and `CREDENTIALS_KEY` in `.env`. Never include those values in a commit, issue, log, or client-side code.
