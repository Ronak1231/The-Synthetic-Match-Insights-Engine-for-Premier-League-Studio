"""Explainer agent: ranks moments and attaches the grounded evidence for why each matters."""
from __future__ import annotations

from .base import PipelineState


def _evidence(ins: dict) -> list[str]:
    ctx, p, kind = ins["context"], ins["params"], ins["kind"]
    facts = [f"minute {ins['minute']}", f"score {ctx['score']['home']}-{ctx['score']['away']}",
             f"momentum {ctx['momentum']:+d} (positive favours home)"]
    if kind in ("goal", "big_chance"):
        facts.append(f"chance quality {p['xg']} xG")
    if kind in ("sprint", "power_shot"):
        facts.append(f"peak speed {p['speed']} km/h")
    if kind == "key_pass":
        facts.append(f"{p['dist']} m pass, difficulty {p['diff']}/10, pressure {p['pressure']}")
    if kind in ("press_wave", "chaos"):
        facts.append(f"{p['n']} events in the last 300 s")
    if kind in ("momentum_shift", "control"):
        facts.append(f"possession {ctx['possPct']['home']}%-{ctx['possPct']['away']}% so far")
    return facts


class ExplainerAgent:
    name = "explainer"
    critical = False

    async def run(self, state: PipelineState) -> None:
        event_ids = {e["id"] for e in state.events}
        ranked = sorted(state.insights, key=lambda i: (-i["importance"], i["t"]))
        rank = {i["id"]: n + 1 for n, i in enumerate(ranked)}
        orphans = 0
        for ins in state.insights:
            if ins["eventId"] not in event_ids:
                orphans += 1
            ins["rank"] = rank[ins["id"]]
            ins["tier"] = "headline" if ins["importance"] >= 0.7 else "standard" if ins["importance"] >= 0.5 else "minor"
            ins["evidence"] = _evidence(ins)
        goals = sum(1 for i in state.insights if i["kind"] == "goal")
        final_goals = sum(state.final["score"].values())
        consistent = goals == final_goals and orphans == 0
        state.stats["explainer"] = {"consistent": consistent, "goal_insights": goals, "final_goals": final_goals}
        state.log(self.name, "explain", "ok" if consistent else "warn", insights=len(state.insights),
                  consistent=consistent)
