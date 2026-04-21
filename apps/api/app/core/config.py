from __future__ import annotations

from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BASE_DIR.parents[1]


class Settings(BaseSettings):
    app_name: str = "AI Studio API"
    app_env: str = "development"
    app_storage_dir: str = str((REPO_ROOT / "storage").resolve())
    sqlalchemy_database_url: str = f"sqlite:///{(REPO_ROOT / 'storage' / 'sqlite' / 'app.db').resolve()}"
    chroma_persist_dir: str = str((REPO_ROOT / "storage" / "chroma").resolve())
    uploads_dir: str = str((REPO_ROOT / "storage" / "uploads").resolve())
    cors_allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    llm_provider: str = "openrouter"
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = "openai/gpt-4o-mini"
    openrouter_timeout_seconds: float = 30.0
    openrouter_max_retries: int = 2
    embedding_provider: str = "sentence-transformers"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_allow_download: bool = False
    vector_backend: str = "chromadb"
    rag_chunk_size: int = 800
    rag_chunk_overlap: int = 120
    telemetry_enabled: bool = True
    telemetry_service_name: str = "ai-studio-api"

    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @model_validator(mode="after")
    def normalize_local_paths(self) -> "Settings":
        self.app_storage_dir = resolve_repo_path(self.app_storage_dir)
        self.chroma_persist_dir = resolve_repo_path(self.chroma_persist_dir)
        self.uploads_dir = resolve_repo_path(self.uploads_dir)
        self.sqlalchemy_database_url = resolve_sqlite_url(self.sqlalchemy_database_url)
        return self


def resolve_repo_path(value: str) -> str:
    path = Path(value)
    if path.is_absolute():
        return str(path)
    return str((REPO_ROOT / path).resolve())


def resolve_sqlite_url(value: str) -> str:
    prefix = "sqlite:///"
    if not value.startswith(prefix):
        return value

    raw_path = value.replace(prefix, "", 1)
    if raw_path == ":memory:":
        return value

    path = Path(raw_path)
    if not path.is_absolute():
        path = (REPO_ROOT / path).resolve()
    return f"{prefix}{path}"


settings = Settings()
