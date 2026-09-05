from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]

class Settings(BaseSettings):
    app_name: str = "Afaq Harness Gateway"
    version: str = "0.1.0"
    host: str = "0.0.0.0"
    port: int = 3500
    debug: bool = False
    database_url: str = f"sqlite+aiosqlite:///{BASE_DIR / 'data' / 'afaq.db'}"
    secret_key: str = ""
    credentials_key: str = ""
    access_token_expire_minutes: int = 1440
    harness_timeout_seconds: int = 600
    harness_concurrency: int = 5  # max concurrent harness subprocesses per replica
    harness_queue_max_wait: int = 30  # seconds waiting for concurrency slot before 429
    harness_data_dir: Path = BASE_DIR / "storage" / "harnesses"
    uploads_dir: Path = BASE_DIR / "storage" / "uploads"
    allowed_origins: str = "http://127.0.0.1:3500,http://localhost:3500"
    model_refresh_seconds: int = 300
    rate_limit_per_minute: int = 60
    rate_limit_enabled: bool = True
    redis_url: str = ""  # e.g. redis://localhost:6379/0 — empty = in-memory fallback
    redis_enabled: bool = False  # set True when REDIS_URL is set and redis is available
    sse_heartbeat_seconds: int = 15
    sse_retry_ms: int = 3000
    default_system_prompt: str = (
        "You are a professional AI assistant operating as a real API (like OpenAI) — not as a Harness or Agent that executes commands. "
        "Strict rules:\n"
        "- Always return the response as text only. Do NOT execute terminal/shell commands, do NOT create actual files, do NOT write to disk, and do NOT modify the system.\n"
        "- You may only search and read if needed (read/search), but the final output must be text.\n"
        "- When asked to write a program or code (Python, JavaScript, or any language), split the code by files/pages and clearly state each file name followed by its code block, exactly as any real API provider does.\n"
        "Required format:\n"
        "File: main.py\n"
        "```python\n"
        "# code here\n"
        "```\n"
        "File: utils.py\n"
        "```python\n"
        "# code here\n"
        "```\n"
        "Keep explanations concise and code complete and copyable inside the text response only. "
        "Respond in the same language as the user (Arabic if user writes Arabic, English if user writes English)."
    )
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

@lru_cache
def get_settings() -> Settings:
    import os
    import sys

    settings = Settings()
    (BASE_DIR / "data").mkdir(parents=True, exist_ok=True)
    settings.harness_data_dir.mkdir(parents=True, exist_ok=True)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    # auto-enable redis if url is provided
    if settings.redis_url and not settings.redis_enabled:
        settings.redis_enabled = True
    # Fail fast if secrets are missing in production (debug==False)
    # Skip check during tests (PYTEST_CURRENT_TEST env set) or when using in-memory DB or pytest imported
    is_test = bool(os.getenv("PYTEST_CURRENT_TEST")) or ":memory:" in settings.database_url or "pytest" in sys.modules
    if not settings.debug and not is_test:
        insecure_secrets = {"", "change-me-in-production", "change-me-in-production-32-byte-key", "replace-with-a-long-random-secret", "replace-with-a-long-random-encryption-secret"}
        if settings.secret_key in insecure_secrets or not settings.secret_key:
            raise RuntimeError("SECRET_KEY must be set to a strong random value in production (debug=false)")
        if settings.credentials_key in insecure_secrets or not settings.credentials_key:
            raise RuntimeError("CREDENTIALS_KEY must be set to a strong random value in production (debug=false)")
    return settings

settings = get_settings()
