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
    secret_key: str = "change-me-in-production"
    credentials_key: str = "change-me-in-production-32-byte-key"
    access_token_expire_minutes: int = 1440
    harness_timeout_seconds: int = 600
    harness_data_dir: Path = BASE_DIR / "storage" / "harnesses"
    uploads_dir: Path = BASE_DIR / "storage" / "uploads"
    allowed_origins: str = "*"
    model_refresh_seconds: int = 300
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    (BASE_DIR / "data").mkdir(parents=True, exist_ok=True)
    settings.harness_data_dir.mkdir(parents=True, exist_ok=True)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    return settings

settings = get_settings()
