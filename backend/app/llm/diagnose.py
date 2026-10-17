"""Turn a raw provider probe into a plain-language diagnosis (no secrets in the output)."""
from __future__ import annotations


def diagnose(provider: str, probe: dict) -> dict:
    """Return {ok, problem, hint}. ``provider`` is the configured LLM_PROVIDER."""
    if "error" in probe:
        return {"ok": False, "problem": "the provider could not be reached",
                "hint": "Check LLM_BASE_URL (it must be an https URL) and that the host is reachable from Render. " + probe["error"]}
    st = probe["status"]
    if st == 200 and probe.get("hasChoices"):
        return {"ok": True, "problem": "", "hint": ""}
    gh = ("With LLM_PROVIDER=github, leave LLM_BASE_URL empty: the default https://models.github.ai/inference is used. "
          if provider == "github" else "")
    if st == 200 and not probe["json"]:
        return {"ok": False, "problem": f"the URL answered 200 but with plain text ({probe['preview'][:40]!r}), not a chat completion",
                "hint": gh + "LLM_BASE_URL is probably pointing at a web page or health endpoint instead of the model API. "
                            "It should be the API root that serves /chat/completions."}
    if st == 200:
        return {"ok": False, "problem": "the provider answered 200 with JSON that has no 'choices'",
                "hint": "That is not an OpenAI-compatible chat-completions response. Check LLM_BASE_URL and LLM_MODEL."}
    if st in (401, 403):
        return {"ok": False, "problem": f"the provider rejected the token (HTTP {st})",
                "hint": ("Create a GitHub token that can use GitHub Models (permission 'models: read') and set it as GITHUB_TOKEN. "
                         if provider == "github" else "Check LLM_API_KEY.") + "Redeploy after changing it."}
    if st == 404:
        return {"ok": False, "problem": "the provider answered 404 (not found)",
                "hint": gh + "The base URL or the model name is wrong. For GitHub Models the model id looks like openai/gpt-4o-mini."}
    if st == 400:
        return {"ok": False, "problem": "the provider rejected the request (HTTP 400)",
                "hint": "The model name is usually the cause. " + probe["preview"][:100]}
    if st == 429:
        return {"ok": False, "problem": "rate limited (HTTP 429)",
                "hint": "The free tier is at its limit. Wait a minute; the match warm-up at startup uses the same quota (set WARM_ON_START=false to save it)."}
    return {"ok": False, "problem": f"unexpected HTTP {st}", "hint": probe["preview"][:120]}
