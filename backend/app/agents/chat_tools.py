"""Tools the chat agent can call. Each tool reads the match and returns computed facts.

The language model never answers from memory: it only phrases what a tool returned, and the
answer is rejected if it contains a number that is not in those facts (see ``chat.py``).

A tool returns ``{"facts": {...}, "evidence": [event ids], "table"?: {...}, "viz"?: {...}}`` or
``{"error": "..."}``. ``as_of`` (match seconds) hides everything after the viewer's live clock, so
chat can be spoiler-free while the match plays.
"""
from __future__ import annotations

import copy
import unicodedata

from ..domain.engine import MatchEngine, player_rating
from ..domain.narration import player_name
from ..domain.simulator import TEAMS, to_fixed
from ..domain.whatif import explain_whatif, list_moments, simulate_whatif

HALF = 2700
WINDOW = 900
METRICS = {
    "rating": ("rating", "rating"), "goals": ("goals", "goals"), "xg": ("xg", "xG"), "shots": ("shots", "shots"),
    "passes": ("passes", "passes"), "tackles": ("tackles", "tackles"), "sprints": ("sprints", "sprints"),
    "top_speed": ("topSpeed", "top speed (km/h)"), "touches": ("touches", "touches"),
    "pressures": ("pressures", "pressures"),
}


def fold(text: str) -> str:
    """Lower-case and strip accents so 'Krüger' matches 'kruger'."""
    return "".join(c for c in unicodedata.normalize("NFKD", text.casefold()) if not unicodedata.combining(c))


def r2(x: float) -> float:
    return to_fixed(x, 2)


def pct(a: float, b: float) -> int:
    return int(a / b * 100 + 0.5) if b else 0


class MatchData:
    """Read-only view of one match, limited to what has happened by ``as_of``."""

    def __init__(self, bundle: dict, as_of: int | None = None) -> None:
        self.as_of = as_of
        self.seed = bundle.get("seed")
        self.events = [e for e in bundle["events"] if as_of is None or e["t"] <= as_of]
        self.insights = [i for i in bundle["insights"] if as_of is None or i["t"] <= as_of]
        self.series = [s for s in bundle["series"] if as_of is None or s["t"] <= as_of]
        self.complete = as_of is None or as_of >= bundle["events"][-1]["t"]
        self._motm = bundle["final"].get("motm") if self.complete else None
        self._snaps: dict[int, dict] = {}
        self._timeline: list[dict] | None = None

    # -- helpers ---------------------------------------------------------------
    def cap(self, minute: int | None) -> int | None:
        """Seconds cut-off combining the viewer's clock and a requested minute."""
        cuts = [c for c in (self.as_of, minute * 60 if minute else None) if c is not None]
        return min(cuts) if cuts else None

    def snapshot(self, up_to_t: int | None = None) -> dict:
        key = -1 if up_to_t is None else int(up_to_t)
        if key not in self._snaps:
            eng = MatchEngine()
            for ev in self.events:
                if up_to_t is not None and ev["t"] > up_to_t:
                    break
                eng.ingest(ev)
            self._snaps[key] = eng.snapshot()
        return self._snaps[key]

    def timeline(self) -> list[dict]:
        """Cumulative team stats at each 15-minute boundary (one pass over the events)."""
        if self._timeline is None:
            eng, out, nxt = MatchEngine(), [], WINDOW
            for ev in self.events:
                while ev["t"] > nxt:
                    out.append({"t": nxt, "team": copy.deepcopy(eng.team)})
                    nxt += WINDOW
                eng.ingest(ev)
            last = self.events[-1]["t"] if self.events else 0
            out.append({"t": last, "team": copy.deepcopy(eng.team)})
            self._timeline = out
        return self._timeline

    def shots(self) -> list[dict]:
        return [e for e in self.events if e["type"] == "shot"]


# ---------------------------------------------------------------- name & team resolution
def team_label(team: str) -> str:
    return TEAMS[team]["name"]


def find_team(text: str) -> str | None:
    t = fold(text)
    for key, info in TEAMS.items():
        words = [fold(info["name"]), fold(info["short"])] + [w for w in fold(info["name"]).split() if len(w) > 4 and w != "united"]
        if any(w in t for w in words):
            return key
    if " home " in f" {t} ":
        return "home"
    if " away " in f" {t} ":
        return "away"
    return None


def pname(team: str, n: int | None) -> str:
    return player_name(team, n)


# ---------------------------------------------------------------- tools
def match_summary(d: MatchData, up_to_minute: int | None = None) -> dict:
    s = d.snapshot(d.cap(up_to_minute))
    T = s["team"]
    goals = [{"minute": e["minute"], "team": team_label(e["team"]), "player": pname(e["team"], e["player"]),
              "xg": e["xg"], "score": f"{e['score']['home']}-{e['score']['away']}"}
             for e in d.events if e["type"] == "goal" and (d.cap(up_to_minute) is None or e["t"] <= d.cap(up_to_minute))]
    facts = {"minute": s["minute"], "finished": d.complete and up_to_minute is None,
             "home": team_label("home"), "away": team_label("away"),
             "score": {"home": s["score"]["home"], "away": s["score"]["away"]}, "possession": s["possPct"],
             "xg": {k: r2(T[k]["xg"]) for k in T}, "shots": {k: T[k]["shots"] for k in T},
             "onTarget": {k: T[k]["onTarget"] for k in T}, "goals": goals}
    if d._motm and up_to_minute is None:
        m = d._motm
        facts["motm"] = {"player": pname(m["team"], m["n"]), "team": team_label(m["team"]), "rating": m["rating"],
                         "goals": m["goals"]}
    return {"facts": facts, "evidence": [e["id"] for e in d.events if e["type"] == "goal"][:10]}


def team_stats(d: MatchData, team: str, up_to_minute: int | None = None) -> dict:
    if team not in TEAMS:
        return {"error": "unknown team"}
    s = d.snapshot(d.cap(up_to_minute))
    t = s["team"][team]
    facts = {"team": team_label(team), "minute": s["minute"], "possession": s["possPct"][team], "shots": t["shots"],
             "onTarget": t["onTarget"], "xg": r2(t["xg"]), "passes": t["passes"],
             "passAccuracy": pct(t["passesOk"], t["passes"]), "tackles": t["tackles"], "pressures": t["pressures"],
             "fouls": t["fouls"], "cards": t["cards"], "goals": s["score"][team]}
    return {"facts": facts, "evidence": []}


def player_stats(d: MatchData, team: str, n: int, up_to_minute: int | None = None) -> dict:
    s = d.snapshot(d.cap(up_to_minute))
    p = s["players"].get(f"{team}:{n}")
    info = next((x for x in TEAMS.get(team, {}).get("players", []) if x["n"] == n), None)
    if info is None:
        return {"error": "unknown player"}
    if p is None:
        return {"facts": {"player": info["name"], "team": team_label(team), "position": info["pos"], "involved": False},
                "evidence": []}
    cap = d.cap(up_to_minute)
    shots = [e for e in d.shots() if e["team"] == team and e["player"] == n and (cap is None or e["t"] <= cap)]
    facts = {"player": info["name"], "team": team_label(team), "position": info["pos"], "involved": True,
             "rating": player_rating(p), "goals": p["goals"], "shots": p["shots"], "xg": r2(p["xg"]),
             "passes": p["passes"], "passAccuracy": pct(p["passesOk"], p["passes"]), "tackles": p["tackles"],
             "sprints": p["sprints"], "topSpeed": p["topSpeed"], "touches": p["touches"]}
    return {"facts": facts, "evidence": [e["id"] for e in shots][:8]}


def top_players(d: MatchData, metric: str = "rating", team: str | None = None, n: int = 3,
                up_to_minute: int | None = None) -> dict:
    if metric not in METRICS:
        return {"error": f"metric must be one of {sorted(METRICS)}"}
    key, label = METRICS[metric]
    s = d.snapshot(d.cap(up_to_minute))
    rows = []
    for p in s["players"].values():
        if team and p["team"] != team:
            continue
        value = player_rating(p) if metric == "rating" else p[key]
        rows.append((value, p))
    rows.sort(key=lambda r: -r[0])
    n = max(1, min(int(n), 8))
    top = [{"rank": i + 1, "player": pname(p["team"], p["n"]), "team": team_label(p["team"]),
            "value": r2(v) if isinstance(v, float) else v} for i, (v, p) in enumerate(rows[:n])]
    return {"facts": {"metric": label, "team": team_label(team) if team else None, "leaders": top},
            "evidence": [], "table": {"columns": ["#", "Player", "Team", label],
                                      "rows": [[r["rank"], r["player"], r["team"], r["value"]] for r in top]}}


def shots(d: MatchData, team: str | None = None, player: int | None = None, outcome: str | None = None,
          min_xg: float | None = None, limit: int = 8, up_to_minute: int | None = None) -> dict:
    cap = d.cap(up_to_minute)
    rows = [e for e in d.shots() if (cap is None or e["t"] <= cap) and (not team or e["team"] == team)
            and (player is None or e["player"] == player) and (not outcome or (e["outcome"] != "goal" if outcome == "missed" else e["outcome"] == outcome))
            and (min_xg is None or e["xg"] >= min_xg)]
    rows_sorted = sorted(rows, key=lambda e: -e["xg"])[: max(1, min(int(limit), 10))]
    items = [{"eventId": e["id"], "minute": e["minute"], "team": team_label(e["team"]),
              "player": pname(e["team"], e["player"]), "xg": e["xg"], "outcome": e["outcome"].replace("_", " "),
              "speed": e["speed"]} for e in rows_sorted]
    facts = {"count": len(rows), "totalXg": r2(sum(e["xg"] for e in rows)),
             "goals": sum(1 for e in rows if e["outcome"] == "goal"),
             "onTarget": sum(1 for e in rows if e["outcome"] in ("goal", "saved")), "biggest": items}
    return {"facts": facts, "evidence": [i["eventId"] for i in items],
            "table": {"columns": ["Min", "Player", "xG", "Outcome"],
                      "rows": [[i["minute"], i["player"], i["xg"], i["outcome"]] for i in items]}}


def goals(d: MatchData, up_to_minute: int | None = None, from_minute: int | None = None) -> dict:
    res = match_summary(d, up_to_minute)
    g = [x for x in res["facts"]["goals"] if from_minute is None or x["minute"] > from_minute]
    facts = {"count": len(g), "goals": g, "score": res["facts"]["score"], "home": res["facts"]["home"],
             "away": res["facts"]["away"]}
    if g:
        lo = min(g, key=lambda x: x["xg"])
        facts["luckiest"] = {"player": lo["player"], "minute": lo["minute"], "xg": lo["xg"]}
    return {"facts": facts, "evidence": res["evidence"],
            "table": {"columns": ["Min", "Scorer", "Team", "xG", "Score"],
                      "rows": [[x["minute"], x["player"], x["team"], x["xg"], x["score"]] for x in g]}}


def key_moments(d: MatchData, n: int = 5, team: str | None = None) -> dict:
    pool = [i for i in d.insights if not team or i["team"] == team]
    top = sorted(pool, key=lambda i: (-i["importance"], i["t"]))[: max(1, min(int(n), 8))]
    top.sort(key=lambda i: i["t"])
    items = [{"minute": i["minute"], "kind": i["kind"].replace("_", " "), "team": team_label(i["team"]),
              "headline": i["narration"]["en"]["headline"], "eventId": i["eventId"]} for i in top]
    return {"facts": {"count": len(items), "moments": items}, "evidence": [i["eventId"] for i in items],
            "table": {"columns": ["Min", "Moment", "Type"], "rows": [[i["minute"], i["headline"], i["kind"]] for i in items]}}


def _delta(a: dict, b: dict | None) -> dict:
    keys = ("shots", "xg", "pressures", "tackles", "possSeconds", "passes")
    return {k: a[k] - (b[k] if b else 0) for k in keys}


def phases(d: MatchData) -> dict:
    tl = d.timeline()
    rows, prev = [], None
    for i, pt in enumerate(tl):
        h, a = _delta(pt["team"]["home"], prev["team"]["home"] if prev else None), \
            _delta(pt["team"]["away"], prev["team"]["away"] if prev else None)
        poss_total = (h["possSeconds"] + a["possSeconds"]) or 1
        start = i * 15
        rows.append({"window": f"{start}-{min(start + 15, 90)}", "homePossession": pct(h["possSeconds"], poss_total),
                     "homeShots": h["shots"], "awayShots": a["shots"], "homeXg": r2(h["xg"]), "awayXg": r2(a["xg"]),
                     "homePressures": h["pressures"], "awayPressures": a["pressures"]})
        prev = pt
    rows = [r for r in rows if r["homeShots"] + r["awayShots"] + r["homePressures"] + r["awayPressures"] > 0]
    dominant = max(rows, key=lambda r: abs(r["homeXg"] - r["awayXg"]), default=None)
    return {"facts": {"home": team_label("home"), "away": team_label("away"), "windows": rows,
                      "mostOneSided": dominant["window"] if dominant else None}, "evidence": [],
            "table": {"columns": ["Mins", "Home poss %", "Shots H-A", "xG H-A"],
                      "rows": [[r["window"], r["homePossession"], f"{r['homeShots']}-{r['awayShots']}",
                                f"{r['homeXg']}-{r['awayXg']}"] for r in rows]}}


def compare_halves(d: MatchData) -> dict:
    tl = d.timeline()
    halves = {"first": {"home": {}, "away": {}}, "second": {"home": {}, "away": {}}}
    cut = max(1, min(len(tl), 3))  # boundaries at 15/30/45
    first_end = tl[cut - 1]["team"] if tl else None
    last = tl[-1]["team"] if tl else None
    if not first_end or not last:
        return {"error": "not enough of the match has been played"}
    for tm in ("home", "away"):
        f, s = _delta(first_end[tm], None), _delta(last[tm], first_end[tm])
        for name, x in (("first", f), ("second", s)):
            halves[name][tm] = {"shots": x["shots"], "xg": r2(x["xg"]), "pressures": x["pressures"]}
    return {"facts": {"home": team_label("home"), "away": team_label("away"), "halves": halves,
                      "halvesComplete": d.complete}, "evidence": []}


def momentum(d: MatchData, minute: int | None = None) -> dict:
    if not d.series:
        return {"error": "no data yet"}
    t = (minute or d.series[-1]["minute"]) * 60
    pt = min(d.series, key=lambda s: abs(s["t"] - t))
    lean = "home" if pt["momentum"] > 22 else "away" if pt["momentum"] < -22 else "balanced"
    near = [i for i in d.insights if abs(i["t"] - pt["t"]) <= 300
            and i["kind"] in ("momentum_shift", "press_wave", "control", "chaos")]
    facts = {"minute": pt["minute"], "momentum": pt["momentum"], "leaning": team_label(lean) if lean != "balanced" else "balanced",
             "homePossession": pt["homePoss"], "rhythm": pt["rhythm"], "home": team_label("home"), "away": team_label("away"),
             "context": [{"minute": i["minute"], "headline": i["narration"]["en"]["headline"]} for i in near[:3]]}
    return {"facts": facts, "evidence": [i["eventId"] for i in near[:3]]}


def _resolve_shot(d: MatchData, team: str | None, player: int | None, minute: int | None,
                  event_id: int | None) -> dict | str:
    shots_ = d.shots()
    if event_id is not None:
        ev = next((e for e in shots_ if e["id"] == event_id), None)
        return ev or "no such shot has happened yet"
    pool = [e for e in shots_ if (not team or e["team"] == team) and (player is None or e["player"] == player)]
    if not pool:
        return "no matching shot has happened yet"
    if minute is not None:
        ev = min(pool, key=lambda e: abs(e["minute"] - minute))
        if abs(ev["minute"] - minute) > 4:
            near = ", ".join(str(e["minute"]) for e in pool[:6])
            return f"no matching shot near minute {minute} (matching shots at minutes {near})"
        return ev
    missed = [m for m in list_moments(pool) if m["outcome"] != "goal"] or list_moments(pool)
    return next(e for e in pool if e["id"] == missed[0]["eventId"])


def whatif(d: MatchData, team: str | None = None, player: int | None = None, minute: int | None = None,
           event_id: int | None = None, alternative: str | None = None) -> dict:
    ev = _resolve_shot(d, team, player, minute, event_id)
    if isinstance(ev, str):
        return {"error": ev}
    result = simulate_whatif(d.events, ev["id"], include=alternative)
    best = next((a for a in result["alternatives"] if a["key"] == result["best"]), None)
    focus = next((a for a in result["alternatives"] if a["key"] == result["focus"]), None)
    facts = {"minute": result["minute"], "player": pname(result["team"], result["player"]),
             "team": team_label(result["team"]), "loggedXg": result["original"]["xg"],
             "outcome": result["original"]["outcome"].replace("_", " "),
             "actualChance": result["baseline"]["probability"],
             "alternatives": [{"option": a["label"], "chance": a["probability"]} for a in result["alternatives"]],
             "bestOption": best["label"] if best else None, "bestChance": best["probability"] if best else None,
             "pointsGained": result["delta"], "verdict": result["verdict"], "simulations": result["sims"]}
    if focus:
        facts["asked"] = {"option": focus["label"], "chance": focus["probability"]}
    return {"facts": facts, "evidence": [result["eventId"]], "viz": {"type": "whatif", "result": result},
            "explanation": explain_whatif(result)}


def records(d: MatchData, up_to_minute: int | None = None) -> dict:
    """Standout numbers: hardest shot, longest and hardest-to-complete passes, fastest sprint, biggest chance."""
    cap = d.cap(up_to_minute)
    ev = [e for e in d.events if cap is None or e["t"] <= cap]
    shots_ = [e for e in ev if e["type"] == "shot"]
    passes_ = [e for e in ev if e["type"] == "pass"]
    ok = [e for e in passes_ if e["success"]]
    sprints = [e for e in ev if e["type"] == "sprint"]
    facts: dict = {}
    if shots_:
        e = max(shots_, key=lambda x: x["speed"])
        facts["hardestShot"] = {"player": pname(e["team"], e["player"]), "team": team_label(e["team"]), "speedKmh": e["speed"],
                                "minute": e["minute"], "outcome": e["outcome"].replace("_", " ")}
        e = max(shots_, key=lambda x: x["xg"])
        facts["biggestChance"] = {"player": pname(e["team"], e["player"]), "team": team_label(e["team"]), "xg": e["xg"],
                                  "minute": e["minute"], "outcome": e["outcome"].replace("_", " ")}
    if ok:
        e = max(ok, key=lambda x: x["distance"])
        facts["longestPass"] = {"player": pname(e["team"], e["player"]), "to": pname(e["team"], e["to_player"]),
                                "metres": e["distance"], "minute": e["minute"]}
        e = max(ok, key=lambda x: x["difficulty"])
        facts["hardestPassCompleted"] = {"player": pname(e["team"], e["player"]), "difficulty": e["difficulty"],
                                         "metres": e["distance"], "minute": e["minute"]}
        e = max(ok, key=lambda x: x["ballSpeed"])
        facts["fastestPass"] = {"player": pname(e["team"], e["player"]), "speedKmh": e["ballSpeed"], "minute": e["minute"]}
    if sprints:
        e = max(sprints, key=lambda x: x["speed"])
        facts["fastestSprint"] = {"player": pname(e["team"], e["player"]), "team": team_label(e["team"]),
                                  "speedKmh": e["speed"], "metres": e["distance"], "minute": e["minute"]}
    if not facts:
        return {"error": "no events yet"}
    return {"facts": facts, "evidence": [],
            "table": {"columns": ["Record", "Who", "Value", "Min"], "rows": [
                [k, v.get("player"), v.get("speedKmh") or v.get("xg") or v.get("metres") or v.get("difficulty"), v.get("minute")]
                for k, v in facts.items()]}}


def compare_players(d: MatchData, team_a: str, n_a: int, team_b: str, n_b: int) -> dict:
    a, b = player_stats(d, team_a, n_a), player_stats(d, team_b, n_b)
    if "error" in a or "error" in b:
        return {"error": "unknown player"}
    fa, fb = a["facts"], b["facts"]
    if not (fa.get("involved") and fb.get("involved")):
        return {"error": "one of the players has not been involved yet"}
    keys = ["rating", "goals", "shots", "xg", "passes", "passAccuracy", "tackles", "sprints", "topSpeed"]
    return {"facts": {"a": fa, "b": fb}, "evidence": a["evidence"][:4] + b["evidence"][:4],
            "table": {"columns": ["", fa["player"], fb["player"]], "rows": [[k, fa[k], fb[k]] for k in keys]}}


def discipline(d: MatchData, up_to_minute: int | None = None) -> dict:
    s = d.snapshot(d.cap(up_to_minute))
    cap = d.cap(up_to_minute)
    cards = [{"minute": e["minute"], "player": pname(e["team"], e["player"]), "team": team_label(e["team"]), "card": e["card"]}
             for e in d.events if e["type"] == "card" and (cap is None or e["t"] <= cap)]
    facts = {"fouls": {k: s["team"][k]["fouls"] for k in ("home", "away")}, "cards": cards,
             "home": team_label("home"), "away": team_label("away")}
    return {"facts": facts, "evidence": [e["id"] for e in d.events if e["type"] == "card"][:6]}


def timeline(d: MatchData) -> dict:
    score = {"home": 0, "away": 0}
    steps, lead_changes, prev_lead, last_leader, trailed = [], 0, 0, 0, set()
    for e in d.events:
        if e["type"] != "goal":
            continue
        score = dict(e["score"])
        lead = (score["home"] > score["away"]) - (score["home"] < score["away"])
        if lead != 0:
            if last_leader and lead != last_leader:
                lead_changes += 1
            last_leader = lead
        if prev_lead == 1 and lead <= 0:
            trailed.add("away")
        if prev_lead == -1 and lead >= 0:
            trailed.add("home")
        prev_lead = lead
        steps.append({"minute": e["minute"], "score": f"{score['home']}-{score['away']}", "team": team_label(e["team"]),
                      "player": pname(e["team"], e["player"])})
    facts = {"home": team_label("home"), "away": team_label("away"), "goals": steps, "leadChanges": lead_changes,
             "fightBack": [team_label(x) for x in sorted(trailed)], "finalScore": score,
             "firstGoal": steps[0] if steps else None, "lastGoal": steps[-1] if steps else None}
    return {"facts": facts, "evidence": [], "table": {"columns": ["Min", "Score", "Scorer"],
                                                       "rows": [[s["minute"], s["score"], s["player"]] for s in steps]}}


def digest(d: MatchData) -> dict:
    """Compact picture of the whole match (as of ``as_of``). The LLM answers open questions from this and
    from a tool result; its answer must only use numbers found here."""
    out: dict = {"asOfMinute": d.snapshot()["minute"], "complete": d.complete,
                 "teams": {k: {"name": team_label(k), "short": TEAMS[k]["short"]} for k in TEAMS},
                 "summary": match_summary(d)["facts"],
                 "teamStats": {k: team_stats(d, k)["facts"] for k in TEAMS},
                 "topPlayers": top_players(d, "rating", n=6)["facts"]["leaders"],
                 "biggestChances": shots(d, limit=5)["facts"]["biggest"],
                 "keyMoments": key_moments(d, n=8)["facts"]["moments"],
                 "records": records(d).get("facts", {}), "discipline": discipline(d)["facts"]}
    ph = phases(d)
    out["periods"] = ph["facts"]["windows"]
    if d.events and d.complete:
        out["timeline"] = timeline(d)["facts"]
    out["roster"] = {k: [f"{p['n']} {p['name']} ({p['pos']})" for p in TEAMS[k]["players"]] for k in TEAMS}
    return out


TOOLS = {
    "match_summary": match_summary, "team_stats": team_stats, "player_stats": player_stats,
    "top_players": top_players, "shots": shots, "goals": goals, "key_moments": key_moments,
    "phases": phases, "compare_halves": compare_halves, "momentum": momentum, "whatif": whatif,
    "records": records, "compare_players": compare_players, "discipline": discipline, "timeline": timeline,
}

# Argument schemas shown to the LLM planner and enforced on its output.
TOOL_SPEC = {
    "match_summary": {"up_to_minute": "int?"},
    "team_stats": {"team": "home|away", "up_to_minute": "int?"},
    "player_stats": {"team": "home|away", "n": "shirt number int"},
    "top_players": {"metric": "|".join(sorted(METRICS)), "team": "home|away?", "n": "int?"},
    "shots": {"team": "home|away?", "player": "shirt number?", "outcome": "goal|saved|off_target|blocked|missed(any non-goal)?",
              "min_xg": "float?"},
    "goals": {"up_to_minute": "int?", "from_minute": "int?"},
    "key_moments": {"n": "int?", "team": "home|away?"},
    "phases": {},
    "compare_halves": {},
    "momentum": {"minute": "int?"},
    "whatif": {"team": "home|away?", "player": "shirt number?", "minute": "int?", "alternative": "pass|carry?"},
    "records": {"up_to_minute": "int?"},
    "compare_players": {"team_a": "home|away", "n_a": "shirt number", "team_b": "home|away", "n_b": "shirt number"},
    "discipline": {"up_to_minute": "int?"},
    "timeline": {},
}
