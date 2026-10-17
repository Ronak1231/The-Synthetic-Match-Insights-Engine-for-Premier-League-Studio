"""Second Guess: counterfactual simulation."""
import pytest

from app.domain.simulator import simulate_match
from app.domain.whatif import explain_whatif, infer_pressure, list_moments, shot_xg, simulate_whatif

EVENTS = simulate_match(40)
SHOTS = [e for e in EVENTS if e["type"] == "shot"]


def test_moments_are_shots_ranked_by_headroom():
    ms = list_moments(EVENTS)
    assert len(ms) == len(SHOTS)
    assert [m["headroom"] for m in ms] == sorted((m["headroom"] for m in ms), reverse=True)
    assert all(m["eventId"] in {s["id"] for s in SHOTS} for m in ms)


def test_up_to_hides_the_future():
    ms = list_moments(EVENTS, up_to=1800)
    assert ms and all(m["t"] <= 1800 for m in ms)


def test_simulation_is_deterministic_and_bounded():
    a, b = simulate_whatif(EVENTS, SHOTS[3]["id"]), simulate_whatif(EVENTS, SHOTS[3]["id"])
    assert a == b
    for opt in [a["baseline"], *a["alternatives"]]:
        assert 0 <= opt["probability"] <= 100 and opt["ci"] >= 0
    assert a["sims"] == 2000 and "estimate" in a["note"].lower()


def test_baseline_matches_the_logged_xg():
    """The Monte Carlo baseline should sit near the xG the match engine logged for the same shot."""
    for s in SHOTS[:12]:
        r = simulate_whatif(EVENTS, s["id"], n=4000)
        assert abs(r["baseline"]["probability"] - s["xg"] * 100) < 6, (s["xg"], r["baseline"])


def test_pressure_is_recovered_from_xg():
    for s in SHOTS[:10]:
        assert 0 <= infer_pressure(s) <= 1
    clean = shot_xg(80, 50, 0.0)
    assert shot_xg(80, 50, 1.0) < clean


def test_verdict_requires_non_overlapping_intervals():
    for s in SHOTS:
        r = simulate_whatif(EVENTS, s["id"], n=600)
        best = next((a for a in r["alternatives"] if a["key"] == r["best"]), None)
        if r["verdict"] == "better_alternative":
            assert best["probability"] - best["ci"] > r["baseline"]["probability"] + r["baseline"]["ci"]


def test_include_keeps_the_asked_option_visible():
    r = simulate_whatif(EVENTS, SHOTS[3]["id"], include="carry")
    assert r["focus"] == "carry" and any(a["key"] == "carry" for a in r["alternatives"])
    assert "carry" in explain_whatif(r).lower()


def test_unknown_or_unsupported_moment_is_rejected():
    with pytest.raises(ValueError):
        simulate_whatif(EVENTS, 10_000_000)
    with pytest.raises(ValueError):
        simulate_whatif(EVENTS, 1)  # kickoff


def test_explanation_only_uses_numbers_from_the_result():
    import re
    r = simulate_whatif(EVENTS, SHOTS[5]["id"])
    allowed = {r["minute"], r["baseline"]["probability"], r["delta"], abs(r["delta"])}
    for a in r["alternatives"]:
        allowed |= {a["probability"], round(a["probability"] - r["baseline"]["probability"], 1),
                    abs(round(a["probability"] - r["baseline"]["probability"], 1))}
        allowed |= {int(n) for n in re.findall(r"(\d+)%", a["note"])}
    nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", explain_whatif(r))]
    assert all(any(abs(n - a) < 1e-6 for a in allowed) for n in nums), (nums, explain_whatif(r))
