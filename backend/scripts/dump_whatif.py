"""Dump what-if results (moments + a spread of simulations) as JSON for the JS parity check."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domain.simulator import simulate_match  # noqa: E402
from app.domain.whatif import explain_whatif, list_moments, simulate_whatif  # noqa: E402

seed = int(sys.argv[1]) if len(sys.argv) > 1 else 40
events = simulate_match(seed)
moments = list_moments(events)
ids = [m["eventId"] for m in moments[:4]] + [m["eventId"] for m in moments[-2:]]
runs = []
for i, eid in enumerate(ids):
    include = [None, "carry", "pass", "pass:11"][i % 4]
    r = simulate_whatif(events, eid, n=600, include=include)
    runs.append({"eventId": eid, "include": include, "result": r, "explanation": explain_whatif(r)})
json.dump({"moments": moments, "runs": runs, "upTo": list_moments(events, up_to=1800)}, sys.stdout)
