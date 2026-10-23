"""Interpret + Explain core: ingests raw events, maintains match state, emits insights.

An insight is structured (kind + params + importance). Natural language is rendered
elsewhere so one insight can be re-narrated per language, audience and LLM.
"""
from __future__ import annotations

from .simulator import js_round, to_fixed

WINDOW = 300  # seconds of recent play used for momentum and rhythm


def _empty_team() -> dict:
    return dict(passes=0, passesOk=0, shots=0, onTarget=0, xg=0.0, tackles=0, pressures=0,
                fouls=0, cards=0, possSeconds=0.0, corners=0)


class MatchEngine:
    def __init__(self) -> None:
        self.clock = 0
        self.minute = 1
        self.score = {"home": 0, "away": 0}
        self.team = {"home": _empty_team(), "away": _empty_team()}
        self.players: dict[str, dict] = {}
        self.possession = "home"
        self.last_t = 0
        self.recent: list[dict] = []
        self.series: list[dict] = []
        self.insights: list[dict] = []
        self.ball = {"x": 50, "y": 50}
        self.momentum = 0
        self.changes_recent = 0
        self.cooldown: dict[str, int] = {}
        self.last_momentum_sign = 0

    # -- helpers ---------------------------------------------------------------
    def _player(self, team: str, n: int) -> dict:
        key = f"{team}:{n}"
        if key not in self.players:
            self.players[key] = dict(team=team, n=n, passes=0, passesOk=0, shots=0, xg=0.0, goals=0, tackles=0,
                                     sprints=0, topSpeed=0, distance=0, touches=0, pressures=0, bestPassDiff=0)
        return self.players[key]

    def _emit(self, kind: str, ev: dict, params: dict, importance: float) -> dict:
        insight = dict(id=f"{kind}-{ev['id']}", kind=kind, t=ev["t"], minute=ev["minute"], team=ev["team"],
                       player=ev.get("player"), params=params, importance=importance, eventId=ev["id"])
        self.insights.append(insight)
        return insight

    def _cool(self, name: str, t: int, secs: int) -> bool:
        if name in self.cooldown and t - self.cooldown[name] < secs:
            return False
        self.cooldown[name] = t
        return True

    def _window(self, t: int) -> dict:
        self.recent = [e for e in self.recent if t - e["t"] <= WINDOW]
        m = 0.0
        changes = 0
        press = {"home": 0, "away": 0}
        prog = {"home": 0, "away": 0}
        hold = {"home": 0, "away": 0}
        for e in self.recent:
            sign = 1 if e["team"] == "home" else -1
            kind = e["type"]
            if kind == "pass" and e["success"]:
                forward = e["to"]["x"] - e["from"]["x"] if e["team"] == "home" else e["from"]["x"] - e["to"]["x"]
                if forward > 8:
                    m += sign * 0.9
                    prog[e["team"]] += 1
                else:
                    m += sign * 0.25
                hold[e["team"]] += 1
            if kind == "shot":
                m += sign * (2 + e["xg"] * 14)
            if kind == "pressure":
                m += sign * 0.9
                press[e["team"]] += 1
            if kind == "tackle":
                m += sign * 0.7
            if kind == "possession_change":
                changes += 1
        self.changes_recent = changes
        self.momentum = max(-100, min(100, js_round(m * 2.2)))
        return {"press": press, "prog": prog, "hold": hold, "changes": changes}

    # -- main entry ------------------------------------------------------------
    def ingest(self, ev: dict) -> list[dict]:
        out: list[dict] = []
        dt = max(0, ev["t"] - self.last_t)
        self.team[self.possession]["possSeconds"] += dt
        self.last_t = ev["t"]
        self.clock = ev["t"]
        self.minute = ev["minute"]
        if ev.get("from"):
            self.ball = {"x": ev["from"]["x"], "y": ev["from"]["y"]}
        if ev.get("to") and ev["type"] in ("pass", "shot"):
            self.ball = {"x": ev["to"]["x"], "y": ev["to"]["y"]}

        self.recent.append(ev)
        T = self.team
        kind = ev["type"]

        if kind == "pass":
            T[ev["team"]]["passes"] += 1
            p = self._player(ev["team"], ev["player"])
            p["passes"] += 1
            p["touches"] += 1
            if ev["success"]:
                T[ev["team"]]["passesOk"] += 1
                p["passesOk"] += 1
                self._player(ev["team"], ev["to_player"])["touches"] += 1
                if ev["difficulty"] > p["bestPassDiff"]:
                    p["bestPassDiff"] = ev["difficulty"]
                if ev["distance"] >= 38 and ev["difficulty"] >= 0.62 and self._cool("keypass", ev["t"], 420):
                    out.append(self._emit("key_pass", ev, dict(dist=ev["distance"], diff=js_round(ev["difficulty"] * 10),
                                                               pressure=ev["pressure"]), 0.55))
            if p["passes"] in (40, 70):
                out.append(self._emit("milestone_passes", ev, dict(n=p["passes"]), 0.35))
        elif kind == "shot":
            T[ev["team"]]["shots"] += 1
            T[ev["team"]]["xg"] += ev["xg"]
            if ev["outcome"] in ("goal", "saved"):
                T[ev["team"]]["onTarget"] += 1
            p = self._player(ev["team"], ev["player"])
            p["shots"] += 1
            p["xg"] += ev["xg"]
            if ev["speed"] >= 112 and self._cool("powershot", ev["t"], 900):
                out.append(self._emit("power_shot", ev, dict(speed=ev["speed"]), 0.4))
            if ev["outcome"] != "goal" and ev["xg"] >= 0.25:
                out.append(self._emit("big_chance", ev, dict(xg=ev["xg"], outcome=ev["outcome"]), 0.7 + ev["xg"] * 0.3))
        elif kind == "goal":
            self.score = dict(ev["score"])
            self._player(ev["team"], ev["player"])["goals"] += 1
            out.append(self._emit("goal", ev, dict(xg=ev["xg"], inv=max(2, js_round(1 / max(0.03, ev["xg"]))),
                                                   home=ev["score"]["home"], away=ev["score"]["away"]), 1))
        elif kind == "tackle":
            T[ev["team"]]["tackles"] += 1
            p = self._player(ev["team"], ev["player"])
            p["tackles"] += 1
            if p["tackles"] in (4, 7):
                out.append(self._emit("milestone_tackles", ev, dict(n=p["tackles"]), 0.35))
        elif kind == "pressure":
            T[ev["team"]]["pressures"] += 1
            self._player(ev["team"], ev["player"])["pressures"] += 1
        elif kind == "foul":
            T[ev["team"]]["fouls"] += 1
        elif kind == "card":
            T[ev["team"]]["cards"] += 1
            out.append(self._emit("card", ev, {}, 0.6))
        elif kind == "sprint":
            p = self._player(ev["team"], ev["player"])
            p["sprints"] += 1
            p["distance"] += ev["distance"]
            if ev["speed"] > p["topSpeed"]:
                p["topSpeed"] = ev["speed"]
            if ev["speed"] >= 33 and self._cool(f"sprint-{ev['team']}-{ev['player']}", ev["t"], 900):
                out.append(self._emit("sprint", ev, dict(speed=ev["speed"], distance=ev["distance"]), 0.5))
        elif kind == "possession_change":
            self.possession = ev["team"]

        w = self._window(ev["t"])

        for tm in ("home", "away"):
            if w["press"][tm] >= 8 and self._cool(f"press-{tm}", ev["t"], 900):
                out.append(self._emit("press_wave", {**ev, "team": tm, "player": None}, dict(n=w["press"][tm]), 0.6))

        last_pt = self.series[-1] if self.series else None
        if last_pt is None or ev["t"] - last_pt["t"] >= 60:
            total_poss = (T["home"]["possSeconds"] + T["away"]["possSeconds"]) or 1
            sign = 1 if self.momentum > 22 else -1 if self.momentum < -22 else 0
            if sign != 0 and sign != self.last_momentum_sign and self._cool("shift", ev["t"], 420) and ev["t"] > 480:
                tm = "home" if sign == 1 else "away"
                pct = int(min(95, 50 + abs(self.momentum) / 2))
                out.append(self._emit("momentum_shift", {**ev, "team": tm, "player": None},
                                      dict(pct=pct, prog=w["prog"][tm], press=w["press"][tm]), 0.75))
            if sign != 0:
                self.last_momentum_sign = sign

            last_t = last_pt["t"] if last_pt else 0
            if ev["t"] > 300 and ev["t"] // 300 != last_t // 300:
                home_hold, away_hold = w["hold"]["home"], w["hold"]["away"]
                hold_total = (home_hold + away_hold) or 1
                lead = "home" if home_hold >= away_hold else "away"
                pct = js_round(max(home_hold, away_hold) / hold_total * 100)
                if w["changes"] >= 20 and self._cool("chaos", ev["t"], 900):
                    out.append(self._emit("chaos", {**ev, "team": lead, "player": None}, dict(n=w["changes"]), 0.55))
                elif pct >= 64 and w["changes"] <= 14 and self._cool("control", ev["t"], 900):
                    out.append(self._emit("control", {**ev, "team": lead, "player": None},
                                          dict(pct=pct, n=w["changes"]), 0.55))

            self.series.append(dict(t=ev["t"], minute=ev["minute"], momentum=self.momentum,
                                    homePoss=js_round(T["home"]["possSeconds"] / total_poss * 100),
                                    rhythm=w["changes"], homeXg=to_fixed(T["home"]["xg"], 2),
                                    awayXg=to_fixed(T["away"]["xg"], 2)))
        return out

    def snapshot(self) -> dict:
        total = (self.team["home"]["possSeconds"] + self.team["away"]["possSeconds"]) or 1
        home_pct = js_round(self.team["home"]["possSeconds"] / total * 100)
        return dict(clock=self.clock, minute=self.minute, score=self.score, possession=self.possession,
                    possPct={"home": home_pct, "away": 100 - home_pct}, team=self.team, players=self.players,
                    momentum=self.momentum, series=self.series, insights=self.insights, ball=self.ball,
                    rhythm=self.changes_recent)


def player_rating(p: dict) -> float:
    acc = p["passesOk"] / p["passes"] if p["passes"] else 0.8
    return to_fixed(6 + p["goals"] * 1.4 + p["xg"] * 0.8 + p["tackles"] * 0.18 + p["sprints"] * 0.08
                    + (acc - 0.75) * 1.5 + p["passes"] * 0.01, 1)


def player_of_the_match(players: dict) -> dict | None:
    best = None
    for p in players.values():
        r = player_rating(p)
        if best is None or r > best["rating"]:
            best = {**p, "rating": r}
    return best
