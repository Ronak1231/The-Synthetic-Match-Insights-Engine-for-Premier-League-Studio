"""Personalizer agent: shapes one match into a feed for a specific viewer."""
from __future__ import annotations

from ..domain.narration import filter_insights, overlay_cue


class PersonalizerAgent:
    name = "personalizer"

    def feed(self, insights: list[dict], *, lang: str, mode: str, fav: str, focus: str | None, metric: str,
             limit: int = 50, up_to: int | None = None) -> list[dict]:
        pool = [i for i in insights if up_to is None or i["t"] <= up_to]
        chosen = filter_insights(pool, mode=mode, fav=fav, focus=focus, metric=metric)
        chosen = sorted(chosen, key=lambda i: i["t"])[-limit:]
        out = []
        for ins in chosen:
            text = ins["narration"].get(lang) or ins["narration"]["en"]
            item = {"id": ins["id"], "minute": ins["minute"], "t": ins["t"], "kind": ins["kind"], "team": ins["team"],
                    "player": ins.get("player"), "importance": ins["importance"], "headline": text["headline"],
                    "source": text["source"]}
            if mode != "broadcast":
                item["why"] = text["why"]
            if mode in ("analyst", "broadcast"):
                item["evidence"] = ins["evidence"]
            if mode == "broadcast":
                item["cue"] = overlay_cue(ins, lang)
            out.append(item)
        return out
