"""Azure Cosmos DB (NoSQL API) store. Install with: pip install azure-cosmos

Switch on with STORE_PROVIDER=cosmos plus COSMOS_ENDPOINT / COSMOS_KEY. Untested against a
live account in this repository: validate it before relying on it.
"""
from __future__ import annotations

import asyncio


class CosmosStore:
    name = "cosmos"

    def __init__(self, endpoint: str, key: str, database: str, container: str) -> None:
        from azure.cosmos import CosmosClient, PartitionKey  # imported lazily: optional dependency

        client = CosmosClient(endpoint, credential=key)
        db = client.create_database_if_not_exists(database)
        self._c = db.create_container_if_not_exists(id=container, partition_key=PartitionKey(path="/pk"))

    def _read(self, item_id: str, pk: str) -> dict | None:
        from azure.cosmos.exceptions import CosmosResourceNotFoundError
        try:
            return self._c.read_item(item=item_id, partition_key=pk)["data"]
        except CosmosResourceNotFoundError:
            return None

    async def get_bundle(self, seed: int, variant: str) -> dict | None:
        return await asyncio.to_thread(self._read, f"bundle:{seed}:{variant}", "bundle")

    async def put_bundle(self, seed: int, variant: str, bundle: dict) -> None:
        item = {"id": f"bundle:{seed}:{variant}", "pk": "bundle", "data": bundle}
        await asyncio.to_thread(self._c.upsert_item, item)

    async def get_profile(self, viewer_id: str) -> dict | None:
        return await asyncio.to_thread(self._read, f"profile:{viewer_id}", "profile")

    async def put_profile(self, viewer_id: str, profile: dict) -> None:
        await asyncio.to_thread(self._c.upsert_item, {"id": f"profile:{viewer_id}", "pk": "profile", "data": profile})

    async def ping(self) -> bool:
        try:
            await asyncio.to_thread(lambda: list(self._c.query_items("select top 1 c.id from c", enable_cross_partition_query=True)))
            return True
        except Exception:
            return False
