"""LLM provider abstraction. One small interface, several OpenAI-compatible backends."""
from __future__ import annotations

import asyncio
import json
import re
import time
from urllib.parse import quote, urlparse
from dataclasses import dataclass

import httpx

from ..config import Settings


class LLMError(RuntimeError):
    pass


@dataclass
class LLMInfo:
    provider: str          # requested provider
    active: str            # what is actually used ("template" when the LLM is off)
    model: str
    note: str = ""


def parse_json_object(text: str) -> dict:
    """Extract a JSON object from model output, tolerating code fences and prose."""
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise LLMError("no JSON object in model output")
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        raise LLMError(f"invalid JSON from model: {exc}") from exc


class OpenAICompatClient:
    """POST {base_url}/chat/completions with a bearer or api-key header."""

    def __init__(self, *, name: str, url: str, api_key: str, model: str, key_header: str = "Authorization",
                 timeout: float = 25.0, extra_headers: dict | None = None) -> None:
        self.name = name
        self.model = model
        self._url = url
        self._timeout = timeout
        self._headers = {"Accept": "application/json", "Content-Type": "application/json", **(extra_headers or {})}
        self._headers[key_header] = ("Bearer " + api_key) if key_header == "Authorization" else api_key

    @property
    def endpoint(self) -> str:
        """Host and path only (never headers or keys), for diagnostics."""
        u = urlparse(self._url)
        port = f":{u.port}" if u.port else ""
        return f"{u.hostname or ''}{port}{u.path}"

    async def probe(self) -> dict:
        """One tiny request that reports what the provider really answers (for /api/llm/check)."""
        body = {"model": self.model, "max_tokens": 8, "messages": [{"role": "user", "content": "Reply with the word ok."}]}
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=min(self._timeout, 15.0), follow_redirects=False) as client:
                resp = await client.post(self._url, headers=self._headers, json=body)
        except httpx.HTTPError as exc:
            return {"error": f"{type(exc).__name__}: {exc}"[:200]}
        out = {"status": resp.status_code, "contentType": resp.headers.get("content-type", "")[:60],
               "server": resp.headers.get("server", "")[:40], "requestId": resp.headers.get("x-github-request-id", "")[:40],
               "preview": resp.text[:160], "ms": round((time.perf_counter() - t0) * 1000), "json": False}
        try:
            payload = resp.json()
            out["json"] = True
            out["hasChoices"] = bool(payload.get("choices")) if isinstance(payload, dict) else False
        except ValueError:
            pass
        return out

    async def probe_matrix(self, *, github: bool = False, control_url: str = "https://api.github.com/rate_limit") -> list[dict]:
        """Try several request shapes and report what each one gets back (for /api/llm/check?matrix=1).

        Never returns keys or headers sent; only status, content type, server, request id and a short preview.
        """
        u = urlparse(self._url)
        origin = f"{u.scheme}://{u.netloc}"
        auth = self._headers.get("Authorization") or ""
        body = {"model": self.model, "max_tokens": 8, "messages": [{"role": "user", "content": "Reply with the word ok."}]}
        base = {"Content-Type": "application/json", "Authorization": auth}
        variants: list[tuple[str, str, str, dict, dict | None]] = [
            ("configured request", "POST", self._url, dict(self._headers), body),
            ("plain JSON headers only", "POST", self._url, {**base, "Accept": "application/json"}, body),
        ]
        if github:
            gh = {**base, "Accept": "application/vnd.github+json"}
            variants += [
                ("GitHub headers, api version 2022-11-28", "POST", self._url, {**gh, "X-GitHub-Api-Version": "2022-11-28"}, body),
                ("GitHub headers, api version 2026-03-10", "POST", self._url, {**gh, "X-GitHub-Api-Version": "2026-03-10"}, body),
                ("model catalog (token accepted?)", "GET", f"{origin}/catalog/models", {"Authorization": auth, "Accept": "application/vnd.github+json"}, None),
                ("control: api.github.com reachable and token valid?", "GET", control_url, {"Authorization": auth, "Accept": "application/vnd.github+json"}, None),
            ]
        rows: list[dict] = []
        async with httpx.AsyncClient(timeout=min(self._timeout, 15.0), follow_redirects=False) as client:
            for name, method, url, headers, payload in variants:
                t0 = time.perf_counter()
                row: dict = {"variant": name}
                try:
                    resp = await client.request(method, url, headers=headers, json=payload)
                except httpx.HTTPError as exc:
                    row["error"] = f"{type(exc).__name__}: {exc}"[:160]
                    rows.append(row)
                    continue
                row.update({"status": resp.status_code, "contentType": resp.headers.get("content-type", "")[:50],
                            "server": resp.headers.get("server", "")[:40], "requestId": resp.headers.get("x-github-request-id", "")[:40],
                            "preview": resp.text[:80], "ms": round((time.perf_counter() - t0) * 1000)})
                try:
                    data = resp.json()
                    row["json"] = True
                    row["hasChoices"] = isinstance(data, dict) and bool(data.get("choices"))
                except ValueError:
                    row["json"] = False
                rows.append(row)
        return rows

    async def complete_json(self, system: str, user: str, *, temperature: float = 0.3, attempts: int = 3,
                            max_wait: float = 20.0) -> dict:
        body = {"model": self.model, "temperature": temperature,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        last: Exception | None = None
        for attempt in range(attempts):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(self._url, headers=self._headers, json=body)
                if resp.status_code in (429, 500, 502, 503, 504):
                    wait = min(max_wait, float(resp.headers.get("retry-after", 2 ** attempt * 2)))
                    last = LLMError(f"HTTP {resp.status_code}")
                    if attempt + 1 < attempts:
                        await asyncio.sleep(wait)
                    continue
                if resp.status_code >= 400:
                    raise LLMError(f"HTTP {resp.status_code}: {resp.text[:200]}")
                try:
                    payload = resp.json()
                except ValueError as exc:
                    raise LLMError(f"invalid provider response (HTTP {resp.status_code}): {resp.text[:200]}") from exc
                try:
                    content = payload["choices"][0]["message"]["content"]
                except (KeyError, IndexError, TypeError) as exc:
                    raise LLMError(f"invalid provider response shape: {str(payload)[:200]}") from exc
                if isinstance(content, list):
                    content = "".join(
                        part.get("text", "") for part in content
                        if isinstance(part, dict) and isinstance(part.get("text"), str)
                    )
                if not isinstance(content, str) or not content.strip():
                    raise LLMError(f"empty model content in provider response: {str(payload)[:200]}")
                return parse_json_object(content)
            except (httpx.HTTPError, LLMError) as exc:
                last = LLMError(f"{type(exc).__name__}: {exc}")
                if attempt + 1 < attempts:
                    await asyncio.sleep(min(max_wait, 2 ** attempt))
        raise LLMError(str(last))


class GeminiClient(OpenAICompatClient):
    """Client for Google's native Gemini generateContent API."""

    def __init__(self, *, api_key: str, model: str, base_url: str, timeout: float = 25.0) -> None:
        self.name = "gemini"
        self.model = model
        self._url = f"{base_url.rstrip('/')}/models/{quote(model, safe='')}:generateContent?key={quote(api_key, safe='')}"
        self._timeout = timeout
        self._headers = {"Accept": "application/json", "Content-Type": "application/json"}

    async def probe(self) -> dict:
        body = {"contents": [{"role": "user", "parts": [{"text": "Reply with the word ok."}]}],
                "generationConfig": {"maxOutputTokens": 8}}
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=min(self._timeout, 15.0), follow_redirects=False) as client:
                resp = await client.post(self._url, headers=self._headers, json=body)
        except httpx.HTTPError as exc:
            return {"error": f"{type(exc).__name__}: {exc}"[:200]}
        out = {"status": resp.status_code, "contentType": resp.headers.get("content-type", "")[:60],
               "server": resp.headers.get("server", "")[:40], "preview": resp.text[:160],
               "ms": round((time.perf_counter() - t0) * 1000), "json": False}
        try:
            payload = resp.json()
            out["json"] = True
            out["hasContent"] = bool(payload.get("candidates")) if isinstance(payload, dict) else False
        except ValueError:
            pass
        return out

    async def probe_matrix(self, **_: object) -> list[dict]:
        """Native Gemini has no OpenAI-compatible request matrix."""
        return []

    async def complete_json(self, system: str, user: str, *, temperature: float = 0.3, attempts: int = 3,
                            max_wait: float = 20.0) -> dict:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "temperature": temperature,
                "responseMimeType": "application/json",
            },
        }
        last: Exception | None = None
        for attempt in range(attempts):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(self._url, headers=self._headers, json=body)
                if resp.status_code in (429, 500, 502, 503, 504):
                    wait = min(max_wait, float(resp.headers.get("retry-after", 2 ** attempt * 2)))
                    last = LLMError(f"HTTP {resp.status_code}")
                    if attempt + 1 < attempts:
                        await asyncio.sleep(wait)
                    continue
                if resp.status_code >= 400:
                    raise LLMError(f"HTTP {resp.status_code}: {resp.text[:200]}")
                try:
                    payload = resp.json()
                    content = payload["candidates"][0]["content"]["parts"][0]["text"]
                except (ValueError, KeyError, IndexError, TypeError) as exc:
                    raise LLMError(f"invalid Gemini response: {resp.text[:200]}") from exc
                if not isinstance(content, str) or not content.strip():
                    raise LLMError("empty model content in Gemini response")
                return parse_json_object(content)
            except (httpx.HTTPError, LLMError) as exc:
                last = LLMError(f"{type(exc).__name__}: {exc}")
                if attempt + 1 < attempts:
                    await asyncio.sleep(min(max_wait, 2 ** attempt))
        raise LLMError(str(last))


DEFAULT_MODELS = {"github": "openai/gpt-4o-mini", "gemini": "gemini-3.1-flash-lite",
                  "openai_compat": "gpt-4o-mini", "azure": ""}


def _model_for(provider: str, model: str) -> tuple[str, str]:
    """Return (model, note). Fills in a default and repairs a model id that belongs to another provider."""
    model = (model or "").strip()
    if not model:
        return DEFAULT_MODELS.get(provider, "-"), ""
    if provider == "github" and "/" not in model:
        return DEFAULT_MODELS["github"], f"model {model!r} is not a GitHub Models id (publisher/name); using {DEFAULT_MODELS['github']}"
    if provider == "gemini" and "/" in model:
        return DEFAULT_MODELS["gemini"], f"model {model!r} is not a Gemini id; using {DEFAULT_MODELS['gemini']}"
    return model, ""


def build_chat_llm(settings: Settings) -> tuple[OpenAICompatClient | None, LLMInfo]:
    """LLM used only by the "Ask the match" chat. Falls back to the main LLM when CHAT_LLM_PROVIDER is empty."""
    return build_llm(settings.for_chat())


def build_llm(settings: Settings) -> tuple[OpenAICompatClient | None, LLMInfo]:
    """Pick the LLM from configuration. Returns (client or None, status for /api/config)."""
    provider = settings.llm_provider
    key = settings.resolved_llm_key()
    model, model_note = _model_for(provider, settings.llm_model)
    settings = settings.model_copy(update={"llm_model": model})
    if provider == "template":
        return None, LLMInfo(provider, "template", "-", "LLM disabled; deterministic templates only")
    if provider == "github":
        if not key:
            return None, LLMInfo(provider, "template", settings.llm_model, "GITHUB_TOKEN not set; using templates")
        base = (settings.llm_base_url or "https://models.github.ai/inference").rstrip("/")
        # Headers as documented for the GitHub Models REST API.
        gh_headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        client = OpenAICompatClient(name="github-models", url=f"{base}/chat/completions", api_key=key,
                                    model=settings.llm_model, timeout=settings.llm_timeout_s, extra_headers=gh_headers)
        return client, LLMInfo(provider, "github-models", settings.llm_model, model_note)
    if provider == "openai_compat":
        if not (key and settings.llm_base_url):
            return None, LLMInfo(provider, "template", settings.llm_model, "LLM_BASE_URL or LLM_API_KEY missing; using templates")
        base = settings.llm_base_url.rstrip("/")
        client = OpenAICompatClient(name="openai-compatible", url=f"{base}/chat/completions", api_key=key,
                                    model=settings.llm_model, timeout=settings.llm_timeout_s)
        return client, LLMInfo(provider, "openai-compatible", settings.llm_model)
    if provider == "gemini":
        if not key:
            return None, LLMInfo(provider, "template", settings.llm_model, "LLM_API_KEY not set; using templates")
        base = (settings.llm_base_url or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
        client = GeminiClient(api_key=key, model=settings.llm_model, base_url=base, timeout=settings.llm_timeout_s)
        return client, LLMInfo(provider, "gemini", settings.llm_model, model_note)
    if provider == "azure":
        endpoint, deployment = settings.azure_openai_endpoint.rstrip("/"), settings.azure_openai_deployment
        if not (key and endpoint and deployment):
            return None, LLMInfo(provider, "template", deployment or "-",
                                 "AZURE_OPENAI_ENDPOINT, _API_KEY or _DEPLOYMENT missing; using templates")
        client = OpenAICompatClient(name="azure-openai", url=f"{endpoint}/openai/v1/chat/completions", api_key=key,
                                    model=deployment, key_header="api-key", timeout=settings.llm_timeout_s)
        return client, LLMInfo(provider, "azure-openai", deployment)
    return None, LLMInfo(provider, "template", "-", "unknown provider")
