import asyncio

import pytest

from app.agents.base import Orchestrator, PipelineState
from app.agents.ingest import validate_events
from app.agents.narrator import NarratorAgent, grounded, numbers_in, validate_llm_output
from app.config import Settings
from app.domain.engine import MatchEngine
from app.domain.simulator import simulate_match
from app.llm.base import LLMError, build_chat_llm, build_llm, parse_json_object
from app.service import MatchService
from app.store.memory import MemoryStore
from app.store.sql import SqlStore, normalize_url


def make_service(**kw) -> MatchService:
    s = Settings(store_provider="memory", **kw)
    llm, info = build_llm(s)
    return MatchService(s, MemoryStore(), llm, info)


def test_simulator_is_deterministic_and_complete():
    a, b = simulate_match(40), simulate_match(40)
    assert a == b and a[0]["type"] == "kickoff" and a[-1]["type"] == "fulltime"
    assert [e["t"] for e in a] == sorted(e["t"] for e in a)
    assert simulate_match(41) != a


def test_engine_emits_explainable_insights():
    eng = MatchEngine()
    ids = [i["id"] for ev in simulate_match(40) for i in eng.ingest(ev)]
    assert len(ids) == len(set(ids)) == 54  # same count as the browser engine (checked by parity script)
    assert eng.score == simulate_match(40)[-1]["score"]


def test_ingest_rejects_malformed_events():
    good = simulate_match(40)[:50]
    bad = [{"id": 9999, "t": 10, "minute": 1, "type": "pass", "team": "home"},   # missing fields
           {"id": 1, "t": 0, "minute": 1, "type": "kickoff", "team": "home"},      # duplicate id
           {"id": 10000, "t": 10, "minute": 1, "type": "teleport", "team": "home"}]
    clean, issues = validate_events(good + bad)
    assert len(clean) == 50 and len(issues) == 3


def test_full_pipeline_template_mode():
    bundle = asyncio.run(make_service(llm_provider="template").build(40))
    assert not bundle["meta"]["degraded"]
    assert [t["from"] for t in bundle["trace"] if t["kind"] == "handoff"] == ["ingest", "interpreter", "explainer", "narrator"]
    ins = bundle["insights"][0]
    assert set(ins["narration"]) == {"en", "hi", "es", "ar", "fr"} and ins["evidence"] and ins["tier"]
    assert bundle["meta"]["stats"]["explainer"]["consistent"]


class FakeLLM:
    name = "fake"

    def __init__(self, fn):
        self.fn, self.calls = fn, 0

    async def complete_json(self, system, user, **kw):
        self.calls += 1
        return self.fn(user)


def good_output(_user=None):
    return {l: {"headline": "Big moment", "why": "It shifts the game."} for l in ("en", "hi", "es", "ar", "fr")}


def run_narrator(llm):
    state = PipelineState(seed=40)
    cfg = Settings(store_provider="memory", llm_max_calls_per_match=3)
    svc = make_service()
    bundle = asyncio.run(svc.build(40))
    state.insights, state.events, state.final = bundle["insights"], bundle["events"], bundle["final"]
    asyncio.run(NarratorAgent(llm, cfg).run(state))
    return state


def test_llm_output_accepted_when_grounded():
    llm = FakeLLM(good_output)
    state = run_narrator(llm)
    assert state.stats["narrator"]["accepted"] == 3 and llm.calls == 3
    assert any(i["narration"]["en"]["source"] == "llm" for i in state.insights)


def test_llm_invented_numbers_fall_back_to_template():
    bad = {l: {"headline": "A 99 km/h rocket", "why": "Seen 12 times this year."} for l in ("en", "hi", "es", "ar", "fr")}
    state = run_narrator(FakeLLM(lambda _u: bad))
    assert state.stats["narrator"]["accepted"] == 0 and state.stats["narrator"]["rejected"] == 3
    assert all(i["narration"]["en"]["source"] == "template" for i in state.insights)


def test_llm_errors_never_block_the_run():
    def boom(_u):
        raise LLMError("HTTP 429")
    state = run_narrator(FakeLLM(boom))
    assert state.stats["narrator"]["errors"] == 3
    assert all(i["narration"]["en"]["source"] == "template" for i in state.insights)


def test_grounding_handles_other_digit_systems():
    assert numbers_in("٣١") == [31.0] and numbers_in("0,31") == [0.31] and numbers_in("१२") == [12.0]
    assert grounded("scores in minute 12", {12.0}) and not grounded("scores in minute 13", {12.0})


def test_orchestrator_retries_then_falls_back():
    class Flaky:
        name, critical = "flaky", False
        def __init__(self): self.n = 0
        async def run(self, state):
            self.n += 1
            raise RuntimeError("down")
        async def fallback(self, state): state.stats["fallback"] = True

    flaky = Flaky()
    state = asyncio.run(Orchestrator([flaky], retries=2).run(PipelineState(seed=1)))
    assert flaky.n == 3 and state.degraded and state.stats["fallback"]


def test_critical_agent_failure_aborts():
    class Dead:
        name, critical = "dead", True
        async def run(self, state): raise RuntimeError("x")
    with pytest.raises(RuntimeError):
        asyncio.run(Orchestrator([Dead()], retries=1).run(PipelineState(seed=1)))


def test_llm_provider_selection_from_config():
    assert build_llm(Settings(llm_provider="template"))[0] is None
    c, info = build_llm(Settings(llm_provider="github", github_token="t"))
    assert c and info.active == "github-models" and "models.github.ai" in c._url
    assert c._headers["Authorization"] == "Bearer " + "t"
    c, info = build_llm(Settings(llm_provider="github"))
    assert c is None and "GITHUB_TOKEN" in info.note
    c, info = build_llm(Settings(llm_provider="azure", azure_openai_endpoint="https://x.openai.azure.com",
                                 azure_openai_api_key="k", azure_openai_deployment="gpt-4o-mini"))
    assert c and c._url.endswith("/openai/v1/chat/completions") and c._headers["api-key"] == "k"
    c, info = build_llm(Settings(llm_provider="gemini", llm_api_key="k"))
    assert c and info.active == "gemini" and c.endpoint.endswith("/v1beta/models/gemini-3.8-flash:generateContent")
    assert "key=k" not in c.endpoint


def test_pipeline_and_chat_can_use_separate_providers():
    settings = Settings(
        llm_provider="github",
        llm_model="openai/gpt-4o-mini",
        github_token="github-secret",
        chat_llm_provider="gemini",
        chat_llm_model="gemini-3.1-flash-lite",
        chat_llm_api_key="google-secret",
    )
    pipeline, pipeline_info = build_llm(settings)
    chat, chat_info = build_chat_llm(settings)

    assert pipeline is not None and pipeline_info.active == "github-models"
    assert pipeline._headers["Authorization"] == "Bearer github-secret"
    assert chat is not None and chat_info.active == "gemini"
    assert chat.model == "gemini-3.1-flash-lite"
    assert "google-secret" not in chat.endpoint

    service = MatchService(settings, MemoryStore(), pipeline, pipeline_info, chat, chat_info)
    assert service.llm is pipeline and service.chat.llm is chat
    config = service.config()
    assert config["llm"]["active"] == "github-models"
    assert config["chat"]["llm"] == "gemini"
    assert config["chat"]["model"] == "gemini-3.1-flash-lite"


def test_chat_provider_empty_reuses_pipeline_model():
    settings = Settings(llm_provider="github", github_token="token")
    pipeline, pipeline_info = build_llm(settings)
    chat, chat_info = build_chat_llm(settings)
    assert chat is not None and pipeline is not None
    assert chat._url == pipeline._url and chat_info.active == pipeline_info.active


def test_parse_json_object_tolerates_fences():
    assert parse_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    with pytest.raises(LLMError):
        parse_json_object("no json here")


def test_llm_only_for_allowlisted_seeds():
    svc = make_service(llm_provider="github", github_token="t", llm_seed_allowlist="40")
    assert svc.variant(40).startswith("github-models") and svc.variant(41) == "template"


def test_sql_store_roundtrip_and_url_normalisation(tmp_path):
    assert normalize_url("postgresql://u:p@h/db?sslmode=require").startswith("postgresql+psycopg://")
    assert normalize_url("postgres://u:p@h/db").startswith("postgresql+psycopg://")
    store = SqlStore.sqlite_file(str(tmp_path / "t.db"))
    asyncio.run(store.put_bundle(1, "v", {"a": 1}))
    asyncio.run(store.put_bundle(1, "v", {"a": 2}))  # upsert
    assert asyncio.run(store.get_bundle(1, "v")) == {"a": 2} and asyncio.run(store.get_bundle(2, "v")) is None
    asyncio.run(store.put_profile("viewer-123", {"lang": "hi"}))
    assert asyncio.run(store.get_profile("viewer-123")) == {"lang": "hi"} and asyncio.run(store.ping())


def test_bundle_is_cached_after_first_build():
    svc = make_service()
    a = asyncio.run(svc.get_bundle(40))
    assert asyncio.run(svc.store.get_bundle(40, "template"))["meta"]["generated_at"] == a["meta"]["generated_at"]


def test_slow_llm_cannot_exceed_its_time_budget():
    import time

    class Slow:
        name = "slow"
        async def complete_json(self, system, user, **kw):
            await asyncio.sleep(5)
            return good_output()

    state = PipelineState(seed=40)
    cfg = Settings(store_provider="memory", llm_max_calls_per_match=3, llm_budget_s=0.2)
    bundle = asyncio.run(make_service().build(40))
    state.insights, state.events, state.final = bundle["insights"], bundle["events"], bundle["final"]
    started = time.perf_counter()
    asyncio.run(NarratorAgent(Slow(), cfg).run(state))
    assert time.perf_counter() - started < 2 and state.stats["narrator"]["timed_out"]
    assert all(i["narration"]["en"]["source"] == "template" for i in state.insights)


def test_default_match_is_warmed_at_startup():
    import time
    from fastapi.testclient import TestClient
    from app.main import create_app
    s = Settings(store_provider="memory", llm_provider="template", warm_on_start=True, default_seed=40)
    llm, info = build_llm(s)
    svc = MatchService(s, MemoryStore(), llm, info)
    with TestClient(create_app(s, svc)):
        for _ in range(50):
            if svc._hot:
                break
            time.sleep(0.1)
    assert any(k.startswith("40:") for k in svc._hot)
