"""LLM provider abstraction. One small interface, several OpenAI-compatible backends."""
from __future__ import annotations

import asyncio
import json
import re
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
        self._headers = {"Content-Type": "application/json", **(extra_headers or {})}
        self._headers[key_header] = f"Bearer {api_key}" if key_header == "Authorization" else api_key

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
                return parse_json_object(content)
            except (httpx.HTTPError, LLMError) as exc:
                last = LLMError(f"{type(exc).__name__}: {exc}")
                if attempt + 1 < attempts:
                    await asyncio.sleep(min(max_wait, 2 ** attempt))
        raise LLMError(str(last))


def build_llm(settings: Settings) -> tuple[OpenAICompatClient | None, LLMInfo]:
    """Pick the LLM from configuration. Returns (client or None, status for /api/config)."""
    provider = settings.llm_provider
    key = settings.resolved_llm_key()
    if provider == "template":
        return None, LLMInfo(provider, "template", "-", "LLM disabled; deterministic templates only")
    if provider == "github":
        if not key:
            return None, LLMInfo(provider, "template", settings.llm_model, "GITHUB_TOKEN not set; using templates")
        base = (settings.llm_base_url or "https://models.github.ai/inference").rstrip("/")
        client = OpenAICompatClient(name="github-models", url=f"{base}/chat/completions", api_key=key,
                                    model=settings.llm_model, timeout=settings.llm_timeout_s)
        return client, LLMInfo(provider, "github-models", settings.llm_model)
    if provider == "openai_compat":
        if not (key and settings.llm_base_url):
            return None, LLMInfo(provider, "template", settings.llm_model, "LLM_BASE_URL or LLM_API_KEY missing; using templates")
        base = settings.llm_base_url.rstrip("/")
        client = OpenAICompatClient(name="openai-compatible", url=f"{base}/chat/completions", api_key=key,
                                    model=settings.llm_model, timeout=settings.llm_timeout_s)
        return client, LLMInfo(provider, "openai-compatible", settings.llm_model)
    if provider == "azure":
        endpoint, deployment = settings.azure_openai_endpoint.rstrip("/"), settings.azure_openai_deployment
        if not (key and endpoint and deployment):
            return None, LLMInfo(provider, "template", deployment or "-",
                                 "AZURE_OPENAI_ENDPOINT, _API_KEY or _DEPLOYMENT missing; using templates")
        client = OpenAICompatClient(name="azure-openai", url=f"{endpoint}/openai/v1/chat/completions", api_key=key,
                                    model=deployment, key_header="api-key", timeout=settings.llm_timeout_s)
        return client, LLMInfo(provider, "azure-openai", deployment)
    return None, LLMInfo(provider, "template", "-", "unknown provider")
