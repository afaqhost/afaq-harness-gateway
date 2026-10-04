from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]

class Settings(BaseSettings):
    app_name: str = "Afaq Harness Gateway"
    version: str = "0.1.0-beta.1"
    host: str = "localhost"
    port: int = 3500
    debug: bool = False
    database_url: str = f"sqlite+aiosqlite:///{BASE_DIR / 'data' / 'afaq.db'}"
    secret_key: str = ""
    credentials_key: str = ""
    access_token_expire_minutes: int = 1440
    harness_timeout_seconds: int = 600
    harness_install_timeout_seconds: int = 600  # max wall-clock for harness install/update scripts (curl|npm|agy update etc.)
    harness_concurrency: int = 5  # max concurrent harness subprocesses per replica
    harness_queue_max_wait: int = 30  # seconds waiting for concurrency slot before 429
    harness_data_dir: Path = BASE_DIR / "storage" / "harnesses"
    uploads_dir: Path = BASE_DIR / "storage" / "uploads"
    allowed_origins: str = "http://127.0.0.1:3500,http://localhost:3500"
    model_refresh_seconds: int = 300
    rate_limit_per_minute: int = 60
    rate_limit_enabled: bool = True
    trusted_proxies: str = ""
    redis_url: str = ""  # e.g. redis://localhost:6379/0 — empty = in-memory fallback
    redis_enabled: bool = False  # set True when REDIS_URL is set and redis is available
    redis_connect_timeout_seconds: float = 2.0  # connect timeout for Redis
    redis_socket_timeout_seconds: float = 2.0  # socket/read timeout for Redis
    sse_heartbeat_seconds: int = 15
    sse_retry_ms: int = 3000
    github_repository: str = Field(default="afaqhost/afaq-harness-gateway", pattern=r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
    github_issues_token: SecretStr = SecretStr("")
    project_update_timeout_seconds: int = Field(default=120, ge=10, le=600)
    default_system_prompt: str = ""  # transparent passthrough: no injected SYSTEM block unless client sends one. Keeps harness as direct model API.
    # To enforce text-only centrally, set via env: DEFAULT_SYSTEM_PROMPT="You are a helpful assistant. Return text only, do not write files."
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

INSECURE_SECRETS = {
    "",
    "change-me-in-production",
    "change-me-in-production-32-byte-key",
    "replace-with-a-long-random-secret",
    "replace-with-a-long-random-encryption-secret",
    "replace-with-a-long-random-secret-generate-with-secrets-token_urlsafe",
    "replace-with-a-long-random-encryption-secret-generate-with-secrets-token_urlsafe",
    "secret",
    "password",
    "admin",
    "test",
}


def validate_production_secret(key: str, name: str) -> None:
    if not key or not key.strip():
        raise RuntimeError(f"{name} must be set to a strong random value in production (debug=false)")
    val = key.strip()
    if len(val) < 32:
        raise RuntimeError(f"{name} is too short; must be at least 32 characters in production (debug=false)")
    low = val.lower()
    if val in INSECURE_SECRETS or any(ph in low for ph in ("replace-with", "change-me", "placeholder")):
        raise RuntimeError(f"{name} must not use example or known weak placeholder values in production (debug=false)")


def validate_production_settings(s: Settings) -> None:
    validate_production_secret(s.secret_key, "SECRET_KEY")
    validate_production_secret(s.credentials_key, "CREDENTIALS_KEY")

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
        validate_production_settings(settings)
    return settings

settings = get_settings()
