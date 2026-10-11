"""Application service: builds, caches and serves match bundles."""
from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timezone

from .agents.base import Orchestrator, PipelineState
from .agents.explainer import ExplainerAgent
from .agents.ingest import IngestAgent
from .agents.interpreter import InterpreterAgent
from .agents.narrator import NarratorAgent
from .agents.overlay import OverlayAgent
from .agents.personalizer import PersonalizerAgent
from .config import Settings
from .domain.simulator import TEAMS
from .llm.base import LLMInfo, OpenAICompatClient
from .store.base import Store

BUNDLE_VERSION = 1


class MatchService:
    def __init__(self, settings: Settings, store: Store, llm: OpenAICompatClient | None, llm_info: LLMInfo) -> None:
        self.settings = settings
        self.store = store
        self.llm = llm
        self.llm_info = llm_info
        self.personalizer = PersonalizerAgent()
        self._locks: dict[str, asyncio.Lock] = {}
        self._hot: dict[str, dict] = {}  # in-process cache in front of the store

    # -- LLM spend guard: only allow-listed seeds call the model -----------------------
    def _llm_allowed(self, seed: int | None) -> bool:
        if not self.llm:
            return False
        allow = {s.strip() for s in self.settings.llm_seed_allowlist.split(",") if s.strip()}
        return seed is not None and str(seed) in allow

    def variant(self, seed: int | None) -> str:
        return f"{self.llm_info.active}:{self.llm_info.model}" if self._llm_allowed(seed) else "template"

    def _pipeline(self, use_llm: bool) -> Orchestrator:
        agents = [IngestAgent(), InterpreterAgent(), ExplainerAgent(),
                  NarratorAgent(self.llm, self.settings, use_llm=use_llm), OverlayAgent()]
        return Orchestrator(agents, retries=self.settings.agent_retries)

    async def build(self, seed: int, raw_events: list[dict] | None = None) -> dict:
        use_llm = raw_events is None and self._llm_allowed(seed)
        state = PipelineState(seed=seed, raw_events=raw_events)
        await self._pipeline(use_llm).run(state)
        return {
            "version": BUNDLE_VERSION, "seed": seed, "variant": self.variant(seed) if raw_events is None else "custom",
            "meta": {"generated_at": datetime.now(timezone.utc).isoformat(), "degraded": state.degraded,
                     "llm": {"provider": self.llm_info.provider, "active": self.llm_info.active if use_llm else "template",
                             "model": self.llm_info.model if use_llm else "-"},
                     "teams": {k: {"name": v["name"], "short": v["short"], "color": v["color"]} for k, v in TEAMS.items()},
                     "stats": state.stats},
            "events": state.events, "insights": state.insights, "series": state.series,
            "final": state.final, "trace": state.trace,
        }

    async def get_bundle(self, seed: int) -> dict:
        variant = self.variant(seed)
        key = f"{seed}:{variant}"
        if key in self._hot:
            return self._hot[key]
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:  # single-flight: concurrent requests share one build
            if key in self._hot:
                return self._hot[key]
            bundle = await self.store.get_bundle(seed, variant)
            if bundle is None or bundle.get("version") != BUNDLE_VERSION:
                bundle = await self.build(seed)
                if not bundle["meta"]["degraded"]:
                    await self.store.put_bundle(seed, variant, bundle)
            self._hot[key] = bundle
            return bundle

    async def build_custom(self, events: list[dict]) -> dict:
        digest = hashlib.sha1(json.dumps(events, sort_keys=True).encode()).hexdigest()[:12]
        bundle = await self.build(seed=0, raw_events=events)
        bundle["custom_id"] = digest
        return bundle

    def config(self) -> dict:
        return {"version": BUNDLE_VERSION, "env": self.settings.app_env, "default_seed": self.settings.default_seed,
                "llm": {"requested": self.llm_info.provider, "active": self.llm_info.active,
                        "model": self.llm_info.model, "note": self.llm_info.note,
                        "seeds": self.settings.llm_seed_allowlist},
                "store": {"active": self.store.name}, "agents": ["ingest", "interpreter", "explainer", "narrator",
                                                                 "overlay", "personalizer"]}
