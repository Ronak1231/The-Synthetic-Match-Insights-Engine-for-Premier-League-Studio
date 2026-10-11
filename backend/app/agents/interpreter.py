"""Interpreter agent: turns events into match state, statistics and raw insights."""
from __future__ import annotations

from ..domain.engine import MatchEngine, player_of_the_match
from .base import PipelineState


class InterpreterAgent:
    name = "interpreter"
    critical = True

    async def run(self, state: PipelineState) -> None:
        engine = MatchEngine()
        insights: list[dict] = []
        for ev in state.events:
            for ins in engine.ingest(ev):
                snap = engine.snapshot()
                # Context at the moment of emission: lets the explainer ground its reasons.
                ins["context"] = {"score": dict(snap["score"]), "possPct": dict(snap["possPct"]),
                                  "momentum": snap["momentum"], "rhythm": snap["rhythm"],
                                  "xg": {"home": round(snap["team"]["home"]["xg"], 2), "away": round(snap["team"]["away"]["xg"], 2)}}
                insights.append(ins)
        snap = engine.snapshot()
        state.insights = insights
        state.series = snap["series"]
        motm = player_of_the_match(snap["players"])
        state.final = {"score": snap["score"], "possPct": snap["possPct"], "team": snap["team"], "motm": motm,
                       "clock": snap["clock"]}
        state.log(self.name, "interpret", "ok", events=len(state.events), insights=len(insights))
