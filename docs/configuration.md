# Configuration

Configuration is loaded from `.env` through `pydantic-settings`. Start from `.env.example`, keep `.env` private, and replace development secrets before deployment.

| Variable | Default | Description |
| --- | --- | --- |
| `APP_NAME` | `Afaq Harness Gateway` | Application display name |
| `VERSION` | `0.1.0` | Application version returned by `/health` |
| `HOST` | `0.0.0.0` | Default host setting |
| `PORT` | `3500` | Default application port |
| `DEBUG` | `false` | Debug setting exposed to application configuration |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/afaq.db` | Async SQLAlchemy database URL |
| `SECRET_KEY` | development placeholder | JWT signing secret; replace it |
| `CREDENTIALS_KEY` | development placeholder | Input to the Fernet credentials key derivation; replace it |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | JWT lifetime in minutes |
| `HARNESS_TIMEOUT_SECONDS` | `600` | Maximum duration for a harness process |
| `HARNESS_DATA_DIR` | `storage/harnesses` | Local harness data directory |
| `UPLOADS_DIR` | `storage/uploads` | Local upload directory |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins |
| `MODEL_REFRESH_SECONDS` | `300` | Reserved setting; refresh is currently startup/button driven |

## Secret Generation

Generate random values instead of using the placeholders:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Assign separate values to `SECRET_KEY` and `CREDENTIALS_KEY` in `.env`. Never include those values in a commit, issue, log, or client-side code.
