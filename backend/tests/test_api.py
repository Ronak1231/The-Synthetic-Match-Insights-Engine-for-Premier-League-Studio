from fastapi.testclient import TestClient

from app.config import Settings
from app.llm.base import build_llm
from app.main import create_app
from app.service import MatchService
from app.store.memory import MemoryStore


def client():
    s = Settings(store_provider="memory", llm_provider="template", warm_on_start=False)
    llm, info = build_llm(s)
    return TestClient(create_app(s, MatchService(s, MemoryStore(), llm, info)))


def test_health_and_config():
    with client() as c:
        assert c.get("/api/health").json() == {"status": "ok", "store": True}
        cfg = c.get("/api/config").json()
        assert cfg["llm"]["active"] == "template" and cfg["store"]["active"] == "memory" and len(cfg["agents"]) == 7


def test_match_bundle_and_trace():
    with client() as c:
        b = c.get("/api/match/40").json()
        assert len(b["events"]) == 1343 and len(b["insights"]) == 54 and b["final"]["motm"]
        t = c.get("/api/match/40/trace").json()
        assert not t["degraded"] and any(x["kind"] == "handoff" for x in t["trace"])


def test_seed_and_lang_validation():
    with client() as c:
        assert c.get("/api/match/99999999").status_code == 422
        assert c.get("/api/match/40/feed?lang=xx").status_code == 422
        assert c.get("/api/match/40/feed?mode=nope").status_code == 422


def test_personalized_feeds_differ_by_audience():
    with client() as c:
        casual = c.get("/api/match/40/feed?mode=casual&limit=200").json()
        analyst = c.get("/api/match/40/feed?mode=analyst&limit=200").json()
        broadcast = c.get("/api/match/40/feed?mode=broadcast&limit=200").json()
        assert 0 < casual["count"] < analyst["count"]
        assert all(i["importance"] >= 0.5 for i in casual["items"]) and "why" in casual["items"][0]
        assert "evidence" in analyst["items"][0] and "cue" in broadcast["items"][0] and "why" not in broadcast["items"][0]
        hi = c.get("/api/match/40/feed?lang=hi&limit=3").json()["items"][0]["headline"]
        assert hi != c.get("/api/match/40/feed?lang=en&limit=3").json()["items"][0]["headline"]
        fav = c.get("/api/match/40/feed?mode=analyst&fav=away&metric=speed&limit=200").json()
        assert all(i["kind"] in ("sprint", "power_shot", "goal") for i in fav["items"])


def test_overlay_cues_are_machine_readable():
    with client() as c:
        o = c.get("/api/match/40/overlay?lang=ar").json()
        cue = o["cues"][0]
        assert o["schema"] == "overlay.cue/1" and cue["lang"] == "ar" and cue["style"]["safe_area"] == "lower-third"


def test_custom_events_run_through_the_same_agents():
    with client() as c:
        events = c.get("/api/match/7").json()["events"][:400]
        b = c.post("/api/match/custom", json=events).json()
        assert b["variant"] == "custom" and len(b["events"]) == 400 and b["meta"]["stats"]["ingest"]["source"] == "supplied"
        assert c.post("/api/match/custom", json=[{"nope": 1}]).status_code == 422


def test_profile_roundtrip_and_validation():
    with client() as c:
        assert c.get("/api/profile/viewer-abc123").status_code == 404
        assert c.put("/api/profile/viewer-abc123", json={"mode": "analyst", "lang": "es", "junk": "x"}).json() == {"mode": "analyst", "lang": "es"}
        assert c.get("/api/profile/viewer-abc123").json()["lang"] == "es"
        assert c.put("/api/profile/viewer-abc123", json={"lang": "klingon"}).status_code == 422
        assert c.put("/api/profile/bad id!", json={}).status_code == 422


def test_sse_stream_emits_events_and_fulltime():
    with client() as c:
        with c.stream("GET", "/api/match/40/stream?speed=600&start=5200&lang=fr") as r:
            assert r.headers["content-type"].startswith("text/event-stream")
            body = "".join(r.iter_text())
        assert "event: match_event" in body and "event: fulltime" in body and "overlay.cue/1" in body


def test_cors_allows_vercel_preview_origins():
    with client() as c:
        r = c.options("/api/match/40", headers={"Origin": "https://my-app-git-main.vercel.app", "Access-Control-Request-Method": "GET"})
        assert r.headers.get("access-control-allow-origin") == "https://my-app-git-main.vercel.app"
