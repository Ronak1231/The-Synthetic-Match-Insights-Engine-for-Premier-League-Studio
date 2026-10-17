"""Second Guess: counterfactual "what if" simulation on the synthetic match.

Given one moment (a shot or a pass) the module lists the realistic alternatives and runs a
seeded Monte Carlo over a small, explicit model, so the answer is an *estimate with a spread*,
not a fact. The model reuses the same shape as the match simulator (distance-decay xG, pass
difficulty from distance / forward progress / pressure), so the numbers stay consistent with
the events the viewer has just watched.

Assumptions (also returned to the caller so they can be shown in the UI):
  * Events carry the ball position and the actors, not all 22 player positions. Team-mates are
    placed at their formation slot, pulled sideways towards the ball (``BALL_PULL``); attackers
    also push forward the further upfield the ball is (``RUN_FORWARD``).
  * The pressure on the shot is not logged; it is recovered from the logged xG.
  * A team-mate receiving a pass faces ``RECEIVER_PRESSURE`` x the shooter's pressure.

The JS twin lives in ``frontend/src/engine/whatif.js`` and must stay in step with this file;
``backend/scripts/parity_check.sh`` compares them.
"""
from __future__ import annotations

import math

from .narration import js_str, player_name
from .simulator import TEAMS, clamp, js_round, mulberry32, to_fixed

N_SIMS = 2000
BALL_PULL = 0.35          # lateral pull of team-mates towards the ball
RUN_FORWARD = 0.5         # attackers push forward in proportion to how far upfield the ball is
RECEIVER_PRESSURE = 0.6
CARRY_GAIN = 9.0          # progress points won by a carry before the shot
MODEL_NOTE = ("Estimate from a simple Monte Carlo model of the synthetic match, not a measurement. "
              "Team-mates are placed from formation slots; attackers push forward as the ball does.")


# ---------------------------------------------------------------- geometry & model
def _attack_progress(team: str, x: float) -> float:
    """0 = own goal line, 100 = the goal being attacked."""
    return x if team == "home" else 100 - x


def shot_xg(progress: float, y: float, pressure: float) -> float:
    """Same functional form as the simulator's shot model (unrounded)."""
    dx = (100 - progress) * 1.05
    dy = (y - 50) * 0.68
    d = math.hypot(dx, dy)
    return clamp(0.52 * math.exp(-d / 13) * (1 - pressure * 0.35), 0.01, 0.62)


def infer_pressure(ev: dict) -> float:
    """Recover the (unlogged) pressure from the logged xG of a shot."""
    prog = _attack_progress(ev["team"], ev["from"]["x"])
    clean = shot_xg(prog, ev["from"]["y"], 0.0)
    raw = (1 - ev["xg"] / clean) / 0.35 if clean > 0 else 0.0
    return clamp(raw, 0.0, 1.0)


def pass_difficulty(dist: float, forward: float, pressure: float) -> float:
    return clamp(0.12 + (dist / 60) * 0.4 + (max(0.0, forward) / 100) * 0.6 + pressure * 0.28, 0, 1)


def pass_success_prob(difficulty: float) -> float:
    return clamp(0.95 - difficulty * 0.6, 0.2, 0.97)


ATTACKERS = ("ST", "AM", "RW", "LW", "CM")


def _teammates(team: str, shooter: int | None, ball: dict) -> list[dict]:
    """Outfield team-mates placed on the pitch from formation slots and the ball position."""
    ball_prog = _attack_progress(team, ball["x"])
    out = []
    for p in TEAMS[team]["players"]:
        if p["pos"] == "GK" or p["n"] == shooter:
            continue
        slot = _attack_progress(team, p["x"])
        prog = slot
        if p["pos"] in ATTACKERS and ball_prog > 50:
            prog = min(94.0, slot + (ball_prog - 50) * RUN_FORWARD)
        x = prog if team == "home" else 100 - prog
        y = p["y"] + (ball["y"] - p["y"]) * BALL_PULL
        out.append({"n": p["n"], "name": p["name"], "pos": p["pos"], "x": to_fixed(x, 1), "y": to_fixed(y, 1)})
    return out


def _expected_alternatives(ev: dict) -> tuple[float, float]:
    """Deterministic (baseline, best-alternative) scoring chance, used to rank moments cheaply."""
    team, frm = ev["team"], ev["from"]
    prog, y = _attack_progress(team, frm["x"]), frm["y"]
    pressure = infer_pressure(ev)
    base = shot_xg(prog, y, pressure)
    c_ok = clamp(0.62 - pressure * 0.35, 0.2, 0.8)
    best = c_ok * shot_xg(min(97.0, prog + CARRY_GAIN), y + (50 - y) * 0.25, clamp(pressure * 0.9, 0, 1))
    for m in _teammates(team, ev["player"], {"x": frm["x"], "y": frm["y"]}):
        m_prog = _attack_progress(team, m["x"])
        if m_prog < 55:
            continue
        dist = math.hypot((m["x"] - frm["x"]) * 1.05, (m["y"] - y) * 0.68)
        ok = pass_success_prob(pass_difficulty(dist, m_prog - prog, pressure))
        best = max(best, ok * shot_xg(m_prog, m["y"], pressure * RECEIVER_PRESSURE))
    return base, best


# ---------------------------------------------------------------- monte carlo helpers
def _mc(rng, n: int, trial) -> tuple[float, float]:
    """Run ``trial(rng) -> bool`` n times. Returns (probability, 95% half-width)."""
    hits = sum(1 for _ in range(n) if trial(rng))
    p = hits / n
    return p, 1.96 * math.sqrt(max(p * (1 - p), 1e-9) / n)


def _shot_trial(progress: float, y: float, pressure: float):
    def trial(rng) -> bool:
        pr = clamp(pressure + (rng() - 0.5) * 0.3, 0, 1)   # pressure is uncertain, so sample it
        return rng() < shot_xg(progress, y + (rng() - 0.5) * 6, pr)
    return trial


def _pct(p: float) -> float:
    return to_fixed(p * 100, 1)


# ---------------------------------------------------------------- public API
def list_moments(events: list[dict], *, up_to: int | None = None) -> list[dict]:
    """Every shot, ranked by headroom: how much better the best alternative looks on paper."""
    out = []
    for ev in events:
        if ev["type"] != "shot" or (up_to is not None and ev["t"] > up_to):
            continue
        base, best = _expected_alternatives(ev)
        out.append({"eventId": ev["id"], "t": ev["t"], "minute": ev["minute"], "team": ev["team"],
                    "player": ev["player"], "xg": ev["xg"], "outcome": ev["outcome"],
                    "headroom": to_fixed((best - base) * 100, 1)})
    return sorted(out, key=lambda m: (-m["headroom"], m["t"]))


def _find(events: list[dict], event_id: int) -> dict | None:
    return next((e for e in events if e["id"] == event_id), None)


def simulate_whatif(events: list[dict], event_id: int, *, n: int = N_SIMS, seed: int | None = None,
                    include: str | None = None) -> dict:
    """Baseline vs alternatives for one shot. Raises ValueError for unknown or unsupported moments.

    ``include`` ("carry", "pass" or "pass:<shirt>") keeps that option in the output even when it is
    not among the top four, and is echoed back as ``focus`` so the caller can answer the exact question.
    """
    ev = _find(events, event_id)
    if ev is None:
        raise ValueError(f"no event with id {event_id}")
    if ev["type"] != "shot":
        raise ValueError("what-if supports shots (event type 'shot')")
    n = int(clamp(n, 200, 20000))
    rng = mulberry32((seed if seed is not None else event_id) * 7919 + 17)

    team, shooter = ev["team"], ev["player"]
    frm = ev["from"]
    prog, y = _attack_progress(team, frm["x"]), frm["y"]
    pressure = infer_pressure(ev)
    mates = _teammates(team, shooter, {"x": frm["x"], "y": frm["y"]})

    p_base, ci_base = _mc(rng, n, _shot_trial(prog, y, pressure))
    baseline = {"key": "shoot", "label": "Shoot (what happened)", "probability": _pct(p_base),
                "ci": _pct(ci_base), "kind": "shoot", "to": {"x": ev["to"]["x"], "y": ev["to"]["y"]}}
    alts = []

    # Alternative A: a carry that wins ground before the shot.
    c_prog = min(97.0, prog + CARRY_GAIN)
    c_ok = clamp(0.62 - pressure * 0.35, 0.2, 0.8)

    def carry_trial(r) -> bool:
        if r() >= c_ok:
            return False
        return _shot_trial(c_prog, y + (50 - y) * 0.25, clamp(pressure * 0.9, 0, 1))(r)

    p, ci = _mc(rng, n, carry_trial)
    alts.append({"key": "carry", "label": "Carry the ball closer, then shoot", "probability": _pct(p), "ci": _pct(ci),
                 "kind": "carry", "to": {"x": frm["x"] + (CARRY_GAIN if team == "home" else -CARRY_GAIN), "y": y},
                 "note": f"{js_round(c_ok * 100)}% to keep the ball while carrying"})

    # Alternative B: pass to each team-mate who sits in a better position than the shooter.
    for m in mates:
        m_prog = _attack_progress(team, m["x"])
        if m_prog < 55:
            continue
        dist = math.hypot((m["x"] - frm["x"]) * 1.05, (m["y"] - y) * 0.68)
        diff = pass_difficulty(dist, m_prog - prog, pressure)
        ok = pass_success_prob(diff)
        r_press = pressure * RECEIVER_PRESSURE

        def pass_trial(r, m_prog=m_prog, m=m, ok=ok, r_press=r_press) -> bool:
            return r() < ok and _shot_trial(m_prog, m["y"], r_press)(r)

        p, ci = _mc(rng, n, pass_trial)
        alts.append({"key": f"pass:{m['n']}", "label": f"Pass to {m['name']}", "probability": _pct(p), "ci": _pct(ci),
                     "kind": "pass", "to": {"x": m["x"], "y": m["y"]}, "player": m["n"],
                     "note": f"{js_round(ok * 100)}% pass completion, then a shot under lighter pressure"})

    alts.sort(key=lambda a: -a["probability"])
    focus = None
    if include:
        want = next((a for a in alts if a["key"] == include), None) if include != "pass" else \
            next((a for a in alts if a["kind"] == "pass"), None)
        focus = want["key"] if want else None
    best = alts[0] if alts else None
    top = alts[:4]
    if focus and not any(a["key"] == focus for a in top):
        top.append(next(a for a in alts if a["key"] == focus))
    alts = top
    delta = to_fixed(best["probability"] - baseline["probability"], 1) if best else 0.0
    # Only claim a better option when the intervals do not overlap.
    clear = bool(best) and best["probability"] - best["ci"] > baseline["probability"] + baseline["ci"]
    verdict = "better_alternative" if clear else "decision_was_sound"

    return {
        "eventId": event_id, "minute": ev["minute"], "t": ev["t"], "team": team, "player": shooter,
        "original": {"type": "shot", "xg": ev["xg"], "outcome": ev["outcome"], "from": frm, "to": ev["to"],
                     "pressureEstimate": to_fixed(pressure, 2)},
        "baseline": baseline, "alternatives": alts, "best": best["key"] if best else None,
        "delta": delta, "verdict": verdict, "focus": focus, "requested": include, "sims": n, "unit": "% chance of scoring",
        "evidence": [f"event #{event_id}", f"minute {ev['minute']}", f"logged xG {js_str(ev['xg'])}",
                     f"estimated pressure {js_str(to_fixed(pressure, 2))}"],
        "note": MODEL_NOTE,
    }


def _signed(x: float) -> str:
    return ("+" if x >= 0 else "") + js_str(x)


def explain_whatif(result: dict) -> str:
    """Plain-language explanation, built only from the numbers in ``result`` (twin: whatif.js)."""
    who = player_name(result["team"], result["player"])
    base = result["baseline"]
    alts = {a["key"]: a for a in result["alternatives"]}
    best, focus = alts.get(result["best"]), alts.get(result.get("focus") or "")
    head = f"In minute {result['minute']}, {who}'s shot was {js_str(base['probability'])}% to score."
    if best is None:
        return f"{head} No realistic alternative was found."
    parts = [head]
    req = result.get("requested")
    if req and not focus:
        if req.startswith("pass:"):
            name = player_name(result["team"], int(req.split(":")[1]))
            parts.append(f"{name} was not in a realistic position to receive a pass there.")
        else:
            parts.append("No team-mate was in a realistic position to receive a pass there.")
    if focus:
        diff = to_fixed(focus["probability"] - base["probability"], 1)
        parts.append(f"{focus['label']}: {js_str(focus['probability'])}% ({_signed(diff)} points), {focus['note']}.")
        if focus["key"] != best["key"]:
            parts.append(f"The strongest option was {best['label']} at {js_str(best['probability'])}%.")
        return " ".join(parts)
    if result["verdict"] == "better_alternative":
        parts.append(f"{best['label']} raises that to {js_str(best['probability'])}% "
                     f"({_signed(result['delta'])} points): {best['note']}.")
    elif best["probability"] + best["ci"] < base["probability"] - base["ci"]:
        parts.append(f"Even the best alternative ({best['label']}) only reaches {js_str(best['probability'])}%, "
                     f"so taking the shot was the right call.")
    else:
        parts.append(f"The best alternative ({best['label']}) comes out at {js_str(best['probability'])}%, "
                     f"within the simulation's margin of error, so it was a close call.")
    return " ".join(parts)
