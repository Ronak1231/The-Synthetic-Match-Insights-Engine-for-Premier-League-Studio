"""Synthetic, football-realistic match generator.

Deterministic for a given seed. The PRNG and event rules mirror the browser simulator
so both sides can produce the same match; all clubs and players are fictional.
"""
import json
import math
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

TEAMS: dict = json.loads((Path(__file__).parent.parent / "data" / "teams.json").read_text(encoding="utf-8"))
MASK = 0xFFFFFFFF


def js_round(x: float) -> int:
    """Math.round semantics (half rounds toward +infinity)."""
    return math.floor(x + 0.5)


def to_fixed(x: float, digits: int) -> float:
    """Number.prototype.toFixed semantics (ties round up on the exact binary value)."""
    q = Decimal(1).scaleb(-digits)
    return float(Decimal(x).quantize(q, rounding=ROUND_HALF_UP))


def mulberry32(seed: int):
    a = seed & MASK

    def rng() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & MASK
        t = ((a ^ (a >> 15)) * (1 | a)) & MASK
        t = (((t + (((t ^ (t >> 7)) * (61 | t)) & MASK)) & MASK) ^ t) & MASK
        return ((t ^ (t >> 14)) & MASK) / 4294967296

    return rng


def clamp(v: float, a: float, b: float) -> float:
    return max(a, min(b, v))


def other(team: str) -> str:
    return "away" if team == "home" else "home"


def to_x(team: str, progress: float) -> float:
    return progress if team == "home" else 100 - progress


def home_bias(minute: int) -> float:
    """Share of territory the home side should get: gives the match a story arc."""
    if minute < 12:
        return 0.5
    if minute < 35:
        return 0.66
    if minute < 46:
        return 0.5
    if minute < 58:
        return 0.44
    if minute < 80:
        return 0.32
    return 0.56


def simulate_match(seed: int = 40) -> list[dict]:
    rng = mulberry32(seed)

    def rand(a: float, b: float) -> float:
        return a + rng() * (b - a)

    events: list[dict] = []
    counter = 0
    t = 0.0
    poss = "home"
    progress = 50.0
    y = 50.0
    score = {"home": 0, "away": 0}
    last_actor = None

    def pick_player(team: str, prog: float) -> dict:
        players = TEAMS[team]["players"]
        weights = []
        for p in players:
            pp = p["x"] if team == "home" else 100 - p["x"]
            weights.append(math.exp(-abs(pp - prog) / 22) * (0.15 if p["pos"] == "GK" else 1))
        r = rng() * sum(weights)
        for i, w in enumerate(weights):
            r -= w
            if r <= 0:
                return players[i]
        return players[-1]

    def push(**ev) -> None:
        nonlocal counter
        counter += 1
        events.append({"id": counter, "t": js_round(t), "minute": math.floor(t / 60) + 1, **ev})

    counter += 1
    events.append({"id": counter, "t": 0, "minute": 1, "type": "kickoff", "team": "home"})

    while t < 5400:
        minute = math.floor(t / 60) + 1
        bias = home_bias(minute)
        own_share = bias if poss == "home" else 1 - bias
        defender = other(poss)
        actor = pick_player(poss, progress)

        pressure = clamp(rand(0, 1) * (1.15 - own_share) + (0.12 if progress > 65 else 0), 0, 1)
        if rng() < 0.16 + (1 - own_share) * 0.2:
            presser = pick_player(defender, 100 - progress)
            push(type="pressure", team=defender, player=presser["n"], target=actor["n"],
                 level=to_fixed(pressure, 2), **{"from": {"x": to_x(defender, 100 - progress), "y": y}})

        roll = rng()

        if roll < 0.03:
            speed = to_fixed(rand(29, 36.5), 1)
            push(type="sprint", team=poss, player=actor["n"], speed=speed,
                 distance=js_round(rand(18, 55)), **{"from": {"x": to_x(poss, progress), "y": y}})

        if roll > 0.985:
            fouler = pick_player(defender, 100 - progress)
            push(type="foul", team=defender, player=fouler["n"], **{"from": {"x": to_x(poss, progress), "y": y}})
            if rng() < 0.18:
                push(type="card", team=defender, player=fouler["n"], card="yellow",
                     **{"from": {"x": to_x(poss, progress), "y": y}})
            t += rand(14, 24)
            continue

        shot_prob = 0.09 + (progress - 72) / 170 if progress > 72 else 0.04 if progress > 60 else 0.003
        if rng() < shot_prob:
            dx = (100 - progress) * 1.05
            dy = (y - 50) * 0.68
            d = math.hypot(dx, dy)
            xg = to_fixed(clamp(0.52 * math.exp(-d / 13) * (1 - pressure * 0.35), 0.01, 0.62), 2)
            speed = js_round(rand(72, 124))
            r = rng()
            if r < xg:
                outcome = "goal"
            elif r < xg + 0.34:
                outcome = "saved"
            elif r < xg + 0.64:
                outcome = "off_target"
            else:
                outcome = "blocked"
            frm = {"x": to_x(poss, progress), "y": y}
            to = {"x": to_x(poss, 100), "y": clamp(50 + rand(-9, 9), 38, 62)}
            push(type="shot", team=poss, player=actor["n"], xg=xg, speed=speed, outcome=outcome,
                 to=to, **{"from": frm})
            if outcome == "goal":
                score[poss] += 1
                push(type="goal", team=poss, player=actor["n"], score=dict(score), xg=xg)
                t += rand(40, 60)
                poss = defender
                progress = 50.0
                y = 50.0
                last_actor = None
                continue
            t += rand(6, 12)
            poss = defender
            progress = rand(6, 14) if outcome == "saved" else rand(8, 30)
            y = rand(30, 70)
            push(type="possession_change", team=poss, reason=outcome,
                 **{"from": {"x": to_x(poss, progress), "y": y}})
            continue

        if 0.8 < roll <= 0.9 and last_actor is not None:
            tackler = pick_player(defender, 100 - progress)
            push(type="tackle", team=defender, player=tackler["n"], target=actor["n"],
                 **{"from": {"x": to_x(poss, progress), "y": y}})
            poss = defender
            progress = clamp(100 - progress, 4, 96)
            push(type="possession_change", team=poss, reason="tackle",
                 **{"from": {"x": to_x(poss, progress), "y": y}})
            t += rand(3, 7)
            last_actor = None
            continue

        p2 = clamp(progress + rand(-14, 20) + (own_share - 0.5) * 12, 2, 98)
        y2 = clamp(y + rand(-30, 30), 6, 94)
        dist = math.hypot((p2 - progress) * 1.05, (y2 - y) * 0.68)
        forward = max(0.0, p2 - progress)
        difficulty = to_fixed(clamp(0.12 + (dist / 60) * 0.4 + (forward / 100) * 0.6 + pressure * 0.28, 0, 1), 2)
        success_prob = clamp(0.95 - difficulty * 0.6 + (own_share - 0.5) * 0.45, 0.2, 0.97)
        ok = rng() < success_prob
        receiver = pick_player(poss, p2)
        push(type="pass", team=poss, player=actor["n"], to_player=receiver["n"], distance=js_round(dist),
             ballSpeed=js_round(clamp(28 + dist * 0.9 + rand(-4, 6), 25, 98)), difficulty=difficulty,
             success=ok, pressure=to_fixed(pressure, 2),
             to={"x": to_x(poss, p2), "y": y2}, **{"from": {"x": to_x(poss, progress), "y": y}})
        last_actor = actor["n"]
        if ok:
            progress = p2
            y = y2
        else:
            poss = defender
            progress = clamp(100 - p2, 4, 96)
            y = y2
            push(type="possession_change", team=poss, reason="interception",
                 **{"from": {"x": to_x(poss, progress), "y": y}})
            last_actor = None
        t += rand(3.5, 8.5)

    counter += 1
    events.append({"id": counter, "t": 5400, "minute": 90, "type": "fulltime", "team": "home", "score": dict(score)})
    return events
