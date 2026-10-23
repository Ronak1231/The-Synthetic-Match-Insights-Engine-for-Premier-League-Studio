"""Dump simulator events + engine insight ids as JSON (used by the JS parity check)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domain.engine import MatchEngine  # noqa: E402
from app.domain.simulator import simulate_match  # noqa: E402

seed = int(sys.argv[1]) if len(sys.argv) > 1 else 40
events = simulate_match(seed)
eng = MatchEngine()
ids = []
for ev in events:
    ids += [i["id"] for i in eng.ingest(ev)]
json.dump({"events": events, "insight_ids": ids, "score": eng.score}, sys.stdout)
