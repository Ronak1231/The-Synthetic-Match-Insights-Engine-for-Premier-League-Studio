"""SQLAlchemy store: SQLite locally, Postgres (Neon) in production. Same code for both."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, Text, create_engine, delete, insert, select, text


def normalize_url(url: str) -> str:
    """Neon hands out postgresql:// URLs; use the psycopg 3 driver for them."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


meta = MetaData()
bundles = Table("bundles", meta,
                Column("seed", Integer, primary_key=True), Column("variant", String(120), primary_key=True),
                Column("payload", Text, nullable=False), Column("created_at", DateTime(timezone=True)))
profiles = Table("profiles", meta,
                 Column("viewer_id", String(80), primary_key=True), Column("payload", Text, nullable=False),
                 Column("updated_at", DateTime(timezone=True)))


class SqlStore:
    def __init__(self, url: str) -> None:
        url = normalize_url(url)
        kwargs: dict = {"pool_pre_ping": True}  # Neon scales to zero; drop dead connections
        if url.startswith("postgresql"):
            kwargs.update(pool_recycle=300, pool_size=3, max_overflow=2)
        self.name = "postgres" if url.startswith("postgresql") else "sqlite"
        self.engine = create_engine(url, **kwargs)
        meta.create_all(self.engine)

    @classmethod
    def sqlite_file(cls, path: str) -> "SqlStore":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        return cls(f"sqlite:///{path}")

    def _get(self, table, key_clause):
        with self.engine.connect() as conn:
            row = conn.execute(select(table.c.payload).where(key_clause)).first()
        return json.loads(row[0]) if row else None

    def _put_bundle(self, seed: int, variant: str, bundle: dict) -> None:
        with self.engine.begin() as conn:
            conn.execute(delete(bundles).where((bundles.c.seed == seed) & (bundles.c.variant == variant)))
            conn.execute(insert(bundles).values(seed=seed, variant=variant, payload=json.dumps(bundle),
                                                created_at=datetime.now(timezone.utc)))

    def _put_profile(self, viewer_id: str, profile: dict) -> None:
        with self.engine.begin() as conn:
            conn.execute(delete(profiles).where(profiles.c.viewer_id == viewer_id))
            conn.execute(insert(profiles).values(viewer_id=viewer_id, payload=json.dumps(profile),
                                                 updated_at=datetime.now(timezone.utc)))

    async def get_bundle(self, seed: int, variant: str) -> dict | None:
        return await asyncio.to_thread(self._get, bundles, (bundles.c.seed == seed) & (bundles.c.variant == variant))

    async def put_bundle(self, seed: int, variant: str, bundle: dict) -> None:
        await asyncio.to_thread(self._put_bundle, seed, variant, bundle)

    async def get_profile(self, viewer_id: str) -> dict | None:
        return await asyncio.to_thread(self._get, profiles, profiles.c.viewer_id == viewer_id)

    async def put_profile(self, viewer_id: str, profile: dict) -> None:
        await asyncio.to_thread(self._put_profile, viewer_id, profile)

    async def ping(self) -> bool:
        def _ping() -> bool:
            with self.engine.connect() as conn:
                conn.execute(text("select 1"))
            return True
        try:
            return await asyncio.to_thread(_ping)
        except Exception:
            return False
