from __future__ import annotations


class MemoryStore:
    name = "memory"

    def __init__(self) -> None:
        self._bundles: dict[tuple[int, str], dict] = {}
        self._profiles: dict[str, dict] = {}

    async def get_bundle(self, seed: int, variant: str) -> dict | None:
        return self._bundles.get((seed, variant))

    async def put_bundle(self, seed: int, variant: str, bundle: dict) -> None:
        self._bundles[(seed, variant)] = bundle

    async def get_profile(self, viewer_id: str) -> dict | None:
        return self._profiles.get(viewer_id)

    async def put_profile(self, viewer_id: str, profile: dict) -> None:
        self._profiles[viewer_id] = profile

    async def ping(self) -> bool:
        return True
