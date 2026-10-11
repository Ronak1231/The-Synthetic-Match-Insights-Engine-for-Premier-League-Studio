from ..config import Settings
from .base import Store
from .memory import MemoryStore


def build_store(settings: Settings) -> Store:
    """Choose storage from configuration (see Settings.store_provider)."""
    provider = settings.store_provider
    if provider == "memory":
        return MemoryStore()
    if provider == "cosmos":
        from .cosmos import CosmosStore
        return CosmosStore(settings.cosmos_endpoint, settings.cosmos_key, settings.cosmos_database,
                           settings.cosmos_container)
    from .sql import SqlStore
    if settings.database_url:
        return SqlStore(settings.database_url)
    if provider == "sql":
        raise RuntimeError("STORE_PROVIDER=sql requires DATABASE_URL")
    return SqlStore.sqlite_file(settings.sqlite_path)
