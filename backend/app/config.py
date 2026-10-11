"""Environment-driven settings.

Every external dependency (LLM, database, hosting origin) is chosen here, so moving
from Render + Neon + GitHub Models to Azure is a change of environment variables only.
See .env.example for the full list.
"""
from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"

    # --- HTTP -----------------------------------------------------------------
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    cors_origin_regex: str = r"https://.*\.vercel\.app"

    # --- LLM provider ---------------------------------------------------------
    # template     : no LLM, deterministic templates only (always works, costs nothing)
    # github       : GitHub Models (free with a GitHub token)
    # openai_compat: any OpenAI-compatible /chat/completions endpoint
    # azure        : Azure OpenAI / Microsoft Foundry deployment
    llm_provider: Literal["template", "github", "openai_compat", "azure"] = "template"
    llm_model: str = "openai/gpt-4o-mini"
    llm_base_url: str = ""
    llm_api_key: str = ""
    github_token: str = ""
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""
    azure_openai_deployment: str = ""
    llm_timeout_s: float = 25.0
    llm_min_importance: float = 0.7  # only the key moments are sent to the LLM
    llm_max_calls_per_match: int = 12
    llm_concurrency: int = 2
    llm_seed_allowlist: str = "40"  # seeds allowed to call the LLM (spend guard); others use templates

    # --- Storage --------------------------------------------------------------
    # auto   : DATABASE_URL if set (Neon / any SQL), otherwise a local SQLite file
    # memory : process memory only
    # sql    : SQLAlchemy URL in DATABASE_URL (SQLite or Postgres)
    # cosmos : Azure Cosmos DB (NoSQL API)
    store_provider: Literal["auto", "memory", "sql", "cosmos"] = "auto"
    database_url: str = ""
    sqlite_path: str = "data/match_insights.db"
    cosmos_endpoint: str = ""
    cosmos_key: str = ""
    cosmos_database: str = "match-insights"
    cosmos_container: str = "bundles"

    # --- Pipeline -------------------------------------------------------------
    default_seed: int = 40
    agent_retries: int = 2

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def resolved_llm_key(self) -> str:
        if self.llm_provider == "github":
            return self.github_token or self.llm_api_key
        if self.llm_provider == "azure":
            return self.azure_openai_api_key or self.llm_api_key
        return self.llm_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
