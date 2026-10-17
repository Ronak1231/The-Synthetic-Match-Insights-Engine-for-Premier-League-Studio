"""The AI connection check and how chat reacts to a misconfigured provider."""
import asyncio

import pytest
from fastapi.testclient import TestClient

from app.agents.chat import ChatAgent
from app.agents.chat_tools import MatchData
from app.config import Settings
from app.llm.base import LLMError, OpenAICompatClient, build_llm
from app.llm.diagnose import diagnose
from app.main import create_app
from app.service import MatchService
from app.store.memory import MemoryStore

S = Settings(store_provider="memory", llm_provider="template", warm_on_start=False)


def test_plain_text_200_is_diagnosed_as_a_wrong_base_url():
    v = diagnose("github", {"status": 200, "json": False, "preview": "OK", "contentType": "text/plain"})
    assert not v["ok"] and "plain text" in v["problem"] and "Models: Read" in v["hint"]
    other = diagnose("openai_compat", {"status": 200, "json": False, "preview": "OK", "contentType": "text/plain"})
    assert "LLM_BASE_URL" in other["hint"]


@pytest.mark.parametrize("probe,word", [
    ({"status": 401, "json": True, "preview": ""}, "token"), ({"status": 404, "json": True, "preview": ""}, "model name"),
    ({"status": 429, "json": True, "preview": ""}, "rate limited"), ({"error": "ConnectError: boom"}, "reached"),
])
def test_other_failures_have_plain_hints(probe, word):
    v = diagnose("github", probe)
    assert not v["ok"] and word in (v["problem"] + v["hint"])


def test_a_good_response_is_ok():
    assert diagnose("github", {"status": 200, "json": True, "hasChoices": True, "preview": ""})["ok"]


class StubLLM:
    model = "stub-model"
    endpoint = "example.test/v1/chat/completions"

    def __init__(self, probe):
        self._probe = probe

    async def probe(self):
        return self._probe


def app_with(llm):
    info = build_llm(S)[1]
    return TestClient(create_app(S, MatchService(S, MemoryStore(), llm, info)))


def test_check_endpoint_without_a_model_says_so():
    with app_with(None) as c:
        r = c.get("/api/llm/check").json()
        assert r["configured"] is False and r["ok"] is False


def test_check_endpoint_reports_the_exact_problem_without_secrets():
    with app_with(StubLLM({"status": 200, "json": False, "preview": "OK", "contentType": "text/plain", "ms": 80})) as c:
        r = c.get("/api/llm/check").json()
        assert r["ok"] is False and r["httpStatus"] == 200 and r["endpoint"] == "example.test/v1/chat/completions"
        assert "plain text" in r["problem"]


def test_misconfigured_provider_cools_down_for_minutes_with_a_friendly_message():
    class Bad:
        calls = 0

        async def complete_json(self, *a, **k):
            Bad.calls += 1
            raise LLMError("LLMError: invalid provider response (HTTP 200): OK")

    from app.config import Settings as St
    from app.domain.simulator import simulate_match  # noqa: F401
    svc = MatchService(S, MemoryStore(), None, build_llm(S)[1])
    bundle = asyncio.run(svc.get_bundle(40))
    agent = ChatAgent(Bad(), St(store_provider="memory", llm_provider="template"))
    first = asyncio.run(agent.respond(MatchData(bundle), "Who scored?"))
    second = asyncio.run(agent.respond(MatchData(bundle), "Who scored?"))
    assert Bad.calls == 1 and first["source"] == "template"
    assert "chat API" in first["llm"]["detail"] and "LLMError" not in first["llm"]["detail"]
    assert first["llm"]["technical"].startswith("invalid provider response")
    assert second["llm"]["state"] == "cooldown" and agent._cool_until - __import__("time").monotonic() > 200


def test_client_endpoint_hides_credentials():
    c = OpenAICompatClient(name="x", url="https://user:pw@host.test/inference/chat/completions?key=secret", api_key="tok", model="m")
    assert "tok" not in c.endpoint and "secret" not in c.endpoint and "pw" not in c.endpoint


def test_github_provider_sends_the_documented_headers():
    s = Settings(store_provider="memory", llm_provider="github", github_token="t", warm_on_start=False)
    client, _ = build_llm(s)
    assert client._headers["Accept"] == "application/vnd.github+json"
    assert client._headers["X-GitHub-Api-Version"] == "2022-11-28"
    assert client._headers["Authorization"] == "Bearer t"
