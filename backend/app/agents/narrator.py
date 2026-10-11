"""Narrator agent: multi-language copy for every insight.

Every insight gets deterministic template text in all languages. When an LLM is configured,
the most important moments are re-written by the model in all languages in a single call, and
the result is only accepted if it passes a grounding check (no numbers beyond the facts).
If the model fails or invents numbers, the template text stays: the match is never blocked.
"""
from __future__ import annotations

import asyncio
import re
import time
import unicodedata

from ..config import Settings
from ..domain.narration import LANGS, TEMPLATES, fact_params, js_str, template_text
from ..llm.base import LLMError, OpenAICompatClient
from .base import PipelineState

SYSTEM = (
    "You are a football commentator writing short match-intelligence captions. "
    "Use ONLY the facts provided. Never invent players, numbers, minutes or outcomes. "
    "Explain why the moment matters, in plain language. Reply with a single JSON object only."
)
NUM = re.compile(r"\d+(?:[.,]\d+)?")


def normalize_digits(text: str) -> str:
    out = []
    for c in text:
        d = unicodedata.decimal(c, None) if c.isdigit() and not c.isascii() else None
        out.append(str(d) if d is not None else c)
    return "".join(out)


def numbers_in(text: str) -> list[float]:
    return [float(m.replace(",", ".")) for m in NUM.findall(normalize_digits(text))]


def allowed_numbers(insight: dict) -> set[float]:
    ctx = insight["context"]
    allowed = {0.0, 1.0, 5.0, float(insight["minute"]), float(ctx["score"]["home"]), float(ctx["score"]["away"])}
    for v in insight["params"].values():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            allowed.add(float(v))
            if isinstance(v, float) and v < 1:
                allowed.add(float(round(v * 100)))          # "0.31 xG" may be said as "31%"
    return allowed


def grounded(text: str, allowed: set[float]) -> bool:
    return all(any(abs(n - a) < 1e-6 for a in allowed) for n in numbers_in(text))


def validate_llm_output(data: dict, insight: dict) -> dict:
    """Return {lang: {headline, why}} if every language is present and grounded, else raise."""
    allowed = allowed_numbers(insight)
    out = {}
    for lang in LANGS:
        entry = data.get(lang)
        if not isinstance(entry, dict):
            raise LLMError(f"missing language {lang}")
        head, why = str(entry.get("headline", "")).strip(), str(entry.get("why", "")).strip()
        if not head or not why or len(head) > 110 or len(why) > 320:
            raise LLMError(f"bad length or empty text for {lang}")
        if not grounded(head + " " + why, allowed):
            raise LLMError(f"ungrounded number in {lang}")
        out[lang] = {"headline": head, "why": why, "source": "llm"}
    return out


def build_prompt(insight: dict) -> str:
    p = fact_params(insight)
    facts = {"kind": insight["kind"], "minute": insight["minute"], "team": p["team"], "player": p["player"] or None,
             "numbers": {k: v for k, v in insight["params"].items()}, "score": insight["context"]["score"],
             "evidence": insight["evidence"]}
    style = {k: " / ".join(v) for k, v in TEMPLATES["en"].items() if k == insight["kind"]}
    return (f"Facts (JSON): {facts}\nStyle reference (English template): {style}\n"
            f"Write a headline (max 90 chars) and a 'why it matters' line (max 260 chars) in each of: "
            f"{', '.join(LANGS)}. Arabic must be natural Modern Standard Arabic. Keep every number consistent with "
            f'the facts. Return JSON: {{"en": {{"headline": "", "why": ""}}, "hi": {{...}}, ...}}')


class NarratorAgent:
    name = "narrator"
    critical = False

    def __init__(self, llm: OpenAICompatClient | None, settings: Settings, use_llm: bool = True) -> None:
        self.llm = llm if use_llm else None
        self.settings = settings

    async def run(self, state: PipelineState) -> None:
        started = time.perf_counter()
        for ins in state.insights:
            ins["narration"] = {lang: template_text(ins, lang) for lang in LANGS}
        stats = {"llm": self.llm.name if self.llm else None, "attempted": 0, "accepted": 0, "rejected": 0, "errors": 0}
        if self.llm:
            await self._llm_pass(state, stats)
        state.stats["narrator"] = stats
        status = "ok" if stats["errors"] == 0 and stats["rejected"] == 0 else "warn"
        state.log(self.name, "narrate", status, (time.perf_counter() - started) * 1000, **stats)

    async def fallback(self, state: PipelineState) -> None:
        for ins in state.insights:
            ins.setdefault("narration", {lang: template_text(ins, lang) for lang in LANGS})

    async def _llm_pass(self, state: PipelineState, stats: dict) -> None:
        cfg = self.settings
        picks = sorted((i for i in state.insights if i["importance"] >= cfg.llm_min_importance),
                       key=lambda i: (-i["importance"], i["t"]))[: cfg.llm_max_calls_per_match]
        sem = asyncio.Semaphore(cfg.llm_concurrency)

        async def one(ins: dict) -> None:
            async with sem:
                stats["attempted"] += 1
                for attempt in (1, 2):
                    try:
                        data = await self.llm.complete_json(SYSTEM, build_prompt(ins))
                        ins["narration"] = validate_llm_output(data, ins)
                        stats["accepted"] += 1
                        return
                    except LLMError as exc:
                        if attempt == 2:
                            kind = "rejected" if "ungrounded" in str(exc) or "missing" in str(exc) or "bad length" in str(exc) else "errors"
                            stats[kind] += 1
                            state.log(self.name, "llm_fallback", "warn", insight=ins["id"], reason=str(exc)[:160])

        await asyncio.gather(*(one(i) for i in picks))
