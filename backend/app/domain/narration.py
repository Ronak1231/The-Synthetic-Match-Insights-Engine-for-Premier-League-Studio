"""Template narration (five languages), overlay cues and audience filtering."""
from __future__ import annotations

import json
import re
from pathlib import Path

from .simulator import TEAMS

_DATA = json.loads((Path(__file__).parent.parent / "data" / "templates.json").read_text(encoding="utf-8"))
TEMPLATES: dict[str, dict[str, list[str]]] = _DATA["narration"]
UI_STRINGS: dict[str, dict[str, str]] = _DATA["ui"]
LANGS = list(TEMPLATES.keys())
_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def js_str(v) -> str:
    """Render numbers the way the browser does (33.0 -> '33')."""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def player_name(team: str, n: int | None) -> str:
    if n is None:
        return ""
    for p in TEAMS[team]["players"]:
        if p["n"] == n:
            return p["name"]
    return f"#{n}"


def fact_params(insight: dict) -> dict:
    return {**insight["params"], "player": player_name(insight["team"], insight.get("player")),
            "team": TEAMS[insight["team"]]["name"]}


def template_text(insight: dict, lang: str) -> dict:
    head, why = (TEMPLATES.get(lang) or TEMPLATES["en"])[insight["kind"]]
    params = fact_params(insight)
    fmt = lambda s: _PLACEHOLDER.sub(lambda m: js_str(params[m.group(1)]) if m.group(1) in params else m.group(0), s)  # noqa: E731
    return {"headline": fmt(head), "why": fmt(why), "source": "template"}


def overlay_cue(insight: dict, lang: str = "en") -> dict:
    text = insight.get("narration", {}).get(lang) or template_text(insight, lang)
    imp = insight["importance"]
    kind = insight["kind"]
    template = ("goal_banner" if kind == "goal" else "player_tag" if kind.startswith("milestone")
                else "speed_chip" if kind in ("sprint", "power_shot") else "lower_third")
    subline = None
    p = insight["params"]
    bits = []
    if "xg" in p:
        bits.append(f"xG {js_str(p['xg'])}")
    if "speed" in p:
        bits.append(f"{js_str(p['speed'])} km/h")
    if "diff" in p:
        bits.append(f"difficulty {p['diff']}/10")
    if "pct" in p:
        bits.append(f"{p['pct']}%")
    if bits:
        subline = " · ".join(bits)
    return {
        "schema": "overlay.cue/1", "id": insight["id"], "template": template, "in_match_second": insight["t"],
        "duration_s": 9 if imp >= 0.9 else 7 if imp >= 0.6 else 5, "lang": lang, "team": insight["team"],
        "player": insight.get("player"), "priority": js_round_pct(imp),
        "text": {"headline": text["headline"], "subline": subline},
        "style": {"accent": TEAMS[insight["team"]]["color"], "safe_area": "lower-third"},
    }


def js_round_pct(x: float) -> int:
    return int(x * 100 + 0.5)


METRIC_LENSES = {
    "all": None,
    "xg": ["goal", "big_chance", "power_shot"],
    "speed": ["sprint", "power_shot"],
    "pass": ["key_pass", "milestone_passes"],
    "pressure": ["press_wave", "momentum_shift", "chaos", "control", "milestone_tackles"],
}


def filter_insights(insights: list[dict], mode: str = "casual", fav: str = "none", focus: str | None = None,
                    metric: str = "all") -> list[dict]:
    """Personalize stage: which insights this viewer should see."""
    out = insights
    lens = METRIC_LENSES.get(metric)
    if lens:
        out = [i for i in out if i["kind"] in lens or i["kind"] == "goal"]
    if mode == "casual":
        out = [i for i in out if i["importance"] >= 0.5]
    if mode == "player" and focus and ":" in focus:
        team, n = focus.split(":", 1)
        out = [i for i in out if (i["team"] == team and str(i.get("player")) == n) or i["kind"] == "goal"
               or (i["team"] == team and i["importance"] >= 0.6 and i.get("player") is None)]
    if fav in ("home", "away"):
        out = [i for i in out if i["team"] == fav or i["importance"] >= 0.55]
    return out
