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
    settings = Settings()
    (BASE_DIR / "data").mkdir(parents=True, exist_ok=True)
    settings.harness_data_dir.mkdir(parents=True, exist_ok=True)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    return settings

settings = get_settings()
