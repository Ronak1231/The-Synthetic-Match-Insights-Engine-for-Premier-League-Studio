"""HTTP API: match bundles, personalized feeds, overlay cues, SSE live replay, viewer profiles."""
from __future__ import annotations

import asyncio
import json
import re
from contextlib import asynccontextmanager

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import StreamingResponse

from .agents.ingest import validate_events
from .config import Settings, get_settings
from .domain.engine import MatchEngine
from .domain.narration import LANGS, overlay_cue, template_text
from .llm.base import build_llm
from .service import MatchService
from .store import build_store

MAX_SEED = 999_999
VIEWER_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
MODES = ("casual", "analyst", "player", "broadcast")


def create_app(settings: Settings | None = None, service: MatchService | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if service is None:
            llm, info = build_llm(settings)
            app.state.svc = MatchService(settings, build_store(settings), llm, info)
        else:
            app.state.svc = service
        warm = None
        if settings.warm_on_start:
            # Build the default match now so the first visitor does not wait for the agents and the LLM.
            async def _warm() -> None:
                try:
                    await app.state.svc.get_bundle(settings.default_seed)
                except Exception:  # noqa: BLE001 - warming is best effort
                    pass
            warm = asyncio.create_task(_warm())
        yield
        if warm and not warm.done():
            warm.cancel()

    app = FastAPI(title="Match Insights Engine", version="1.0.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list,
                       allow_origin_regex=settings.cors_origin_regex or None, allow_methods=["GET", "POST", "PUT"],
                       allow_headers=["*"])
    app.add_middleware(GZipMiddleware, minimum_size=2000)

    def svc(request: Request) -> MatchService:
        return request.app.state.svc

    def check_seed(seed: int) -> int:
        if not 0 <= seed <= MAX_SEED:
            raise HTTPException(422, f"seed must be between 0 and {MAX_SEED}")
        return seed

    def check_lang(lang: str) -> str:
        if lang not in LANGS:
            raise HTTPException(422, f"lang must be one of {LANGS}")
        return lang

    @app.get("/api/health")
    async def health(request: Request):
        return {"status": "ok", "store": await svc(request).store.ping()}

    @app.get("/api/config")
    async def config(request: Request):
        return svc(request).config()

    @app.get("/api/match/{seed}")
    async def match(seed: int, request: Request):
        return await svc(request).get_bundle(check_seed(seed))

    @app.get("/api/match/{seed}/trace")
    async def trace(seed: int, request: Request):
        bundle = await svc(request).get_bundle(check_seed(seed))
        return {"seed": seed, "degraded": bundle["meta"]["degraded"], "stats": bundle["meta"]["stats"],
                "trace": bundle["trace"]}

    @app.get("/api/match/{seed}/feed")
    async def feed(seed: int, request: Request, lang: str = "en", mode: str = "casual", fav: str = "none",
                   focus: str | None = None, metric: str = "all", limit: int = Query(30, ge=1, le=200),
                   up_to: int | None = Query(None, ge=0, le=5400)):
        if mode not in MODES:
            raise HTTPException(422, f"mode must be one of {MODES}")
        bundle = await svc(request).get_bundle(check_seed(seed))
        items = svc(request).personalizer.feed(bundle["insights"], lang=check_lang(lang), mode=mode, fav=fav,
                                               focus=focus, metric=metric, limit=limit, up_to=up_to)
        return {"seed": seed, "lang": lang, "mode": mode, "count": len(items), "items": items}

    @app.get("/api/match/{seed}/overlay")
    async def overlay(seed: int, request: Request, lang: str = "en"):
        bundle = await svc(request).get_bundle(check_seed(seed))
        cues = [overlay_cue(i, check_lang(lang)) for i in bundle["insights"]]
        return {"schema": "overlay.cue/1", "seed": seed, "lang": lang, "cues": cues}

    @app.post("/api/match/custom")
    async def custom(request: Request, events: list[dict] = Body(..., max_length=6000)):
        clean, _ = validate_events(events)
        if not clean:
            raise HTTPException(422, "no valid events in payload")
        return await svc(request).build_custom(events)

    @app.get("/api/match/{seed}/stream")
    async def stream(seed: int, request: Request, speed: float = Query(60, ge=1, le=600), lang: str = "en",
                     start: int = Query(0, ge=0, le=5400)):
        """Server-sent events: replays the match in (accelerated) real time through the live engine."""
        bundle = await svc(request).get_bundle(check_seed(seed))
        check_lang(lang)
        narration = {i["id"]: i["narration"] for i in bundle["insights"]}

        async def gen():
            engine = MatchEngine()
            prev_t = start
            beat = 0.0
            for ev in bundle["events"]:
                new = engine.ingest(ev)
                if ev["t"] < start:
                    continue
                delay = min(2.0, max(0.0, (ev["t"] - prev_t) / speed))
                prev_t = ev["t"]
                if delay:
                    await asyncio.sleep(delay)
                    beat += delay
                if await request.is_disconnected():
                    return
                snap = engine.snapshot()
                payload = {"event": ev, "state": {"clock": snap["clock"], "score": snap["score"],
                                                  "possPct": snap["possPct"], "momentum": snap["momentum"]},
                           "insights": [{**i, "narration": narration.get(i["id"], {}).get(lang) or template_text(i, lang),
                                         "cue": overlay_cue({**i, "narration": narration.get(i["id"], {})}, lang)}
                                        for i in new]}
                yield f"event: match_event\nid: {ev['id']}\ndata: {json.dumps(payload)}\n\n"
                if beat >= 15:
                    beat = 0.0
                    yield ": ping\n\n"
            yield "event: fulltime\ndata: {}\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.get("/api/profile/{viewer_id}")
    async def get_profile(viewer_id: str, request: Request):
        if not VIEWER_RE.match(viewer_id):
            raise HTTPException(422, "viewer_id must be 6-64 chars of letters, digits, _ or -")
        profile = await svc(request).store.get_profile(viewer_id)
        if profile is None:
            raise HTTPException(404, "no profile")
        return profile

    @app.put("/api/profile/{viewer_id}")
    async def put_profile(viewer_id: str, request: Request, profile: dict = Body(...)):
        if not VIEWER_RE.match(viewer_id):
            raise HTTPException(422, "viewer_id must be 6-64 chars of letters, digits, _ or -")
        allowed = {"mode": MODES, "lang": LANGS, "fav": ("none", "home", "away")}
        clean = {k: v for k, v in profile.items() if k in ("mode", "lang", "fav", "focus", "metric")
                 and isinstance(v, str) and len(v) < 24}
        for k, vals in allowed.items():
            if k in clean and clean[k] not in vals:
                raise HTTPException(422, f"invalid {k}")
        await svc(request).store.put_profile(viewer_id, clean)
        return clean

    return app


app = create_app()
