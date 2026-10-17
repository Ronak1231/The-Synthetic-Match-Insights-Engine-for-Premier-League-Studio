"""Overlay agent: emits timed, machine-readable cues for a graphics renderer."""
from __future__ import annotations

import time

from ..domain.narration import overlay_cue
from .base import PipelineState

REQUIRED = {"schema", "id", "template", "in_match_second", "duration_s", "lang", "team", "priority", "text", "style"}


class OverlayAgent:
    name = "overlay"
    critical = False

    async def run(self, state: PipelineState) -> None:
        started = time.perf_counter()
        cues = [overlay_cue(i, "en") for i in state.insights]
        bad = [c["id"] for c in cues if not REQUIRED <= c.keys() or not c["text"]["headline"]]
        if bad:
            raise ValueError(f"invalid overlay cues: {bad[:3]}")
        state.stats["overlay"] = {"cues": len(cues), "schema": "overlay.cue/1"}
        state.log(self.name, "render", "ok", (time.perf_counter() - started) * 1000, cues=len(cues))
