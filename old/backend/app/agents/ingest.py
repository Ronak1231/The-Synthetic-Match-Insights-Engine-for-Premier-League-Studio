"""Ingest agent: obtains synthetic match events, validates and sequences them."""
from __future__ import annotations

import time

from ..domain.simulator import simulate_match
from .base import PipelineState

REQUIRED = {
    "kickoff": {"team"}, "fulltime": {"team", "score"}, "goal": {"team", "player", "score", "xg"},
    "pass": {"team", "player", "to_player", "distance", "ballSpeed", "difficulty", "success", "pressure", "from", "to"},
    "shot": {"team", "player", "xg", "speed", "outcome", "from", "to"},
    "tackle": {"team", "player", "target", "from"}, "pressure": {"team", "player", "target", "level", "from"},
    "foul": {"team", "player", "from"}, "card": {"team", "player", "card", "from"},
    "sprint": {"team", "player", "speed", "distance", "from"}, "possession_change": {"team", "reason", "from"},
}
MAX_EVENTS = 6000


def validate_events(events: list[dict]) -> tuple[list[dict], list[str]]:
    """Drop malformed events, enforce monotonic time and unique ids. Returns (clean, issues)."""
    issues: list[str] = []
    clean: list[dict] = []
    seen: set[int] = set()
    last_t = 0
    for ev in sorted(events[:MAX_EVENTS], key=lambda e: (e.get("t", 0), e.get("id", 0))):
        kind = ev.get("type")
        if kind not in REQUIRED:
            issues.append(f"unknown type {kind!r} (id {ev.get('id')})")
            continue
        missing = REQUIRED[kind] - ev.keys()
        if missing or not {"id", "t", "minute"} <= ev.keys():
            issues.append(f"{kind} id {ev.get('id')}: missing {sorted(missing | ({'id', 't', 'minute'} - ev.keys()))}")
            continue
        if ev["team"] not in ("home", "away") or ev["id"] in seen or ev["t"] < last_t:
            issues.append(f"{kind} id {ev['id']}: bad team, duplicate id or time went backwards")
            continue
        seen.add(ev["id"])
        last_t = ev["t"]
        clean.append(ev)
    return clean, issues


class IngestAgent:
    name = "ingest"
    critical = True

    async def run(self, state: PipelineState) -> None:
        started = time.perf_counter()
        source = "supplied" if state.raw_events is not None else "synthetic-simulator"
        raw = state.raw_events if state.raw_events is not None else simulate_match(state.seed)
        clean, issues = validate_events(raw)
        if not clean:
            raise ValueError("no valid events after validation")
        state.events = clean
        state.stats["ingest"] = {"source": source, "received": len(raw), "accepted": len(clean), "rejected": len(raw) - len(clean)}
        state.log(self.name, "validate", "ok" if not issues else "warn", (time.perf_counter() - started) * 1000,
                  source=source, accepted=len(clean), rejected=len(raw) - len(clean), issues=issues[:5])
