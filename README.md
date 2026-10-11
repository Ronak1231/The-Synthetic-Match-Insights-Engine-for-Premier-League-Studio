# Synthetic Match Insights Engine

An AI pipeline and studio UI that turns **synthetic football events** into explainable match intelligence,
live narratives, automated recaps and overlay cues, personalised per viewer and available in five languages.
Built for the Microsoft x Premier League *Inside the Game* hackathon. All clubs, players and data are fictional.

```
 synthetic events ──► Ingest ──► Interpreter ──► Explainer ──► Narrator ──► Overlay ──► UI / broadcast graphics
  (seeded, or your    validate    state, xG,      rank + why,   5 languages,  overlay.cue/1   Personalizer shapes
   own via POST)      sequence    momentum        evidence      LLM + check   JSON            the feed per viewer
                         └─────── one orchestrator: shared state · retries · fallbacks · trace ───────┘
```

## What is real
- **Agents** (`backend/app/agents`): ingest, interpreter, explainer, narrator, overlay, personalizer. Shared pipeline
  state, hand-offs, retries, fallbacks, and a trace of every step (visible in the studio under *Show agent trace*).
- **Narrator with a grounding check:** an LLM (optional) writes captions in all five languages in one call; the text is
  accepted only if every number in it is supported by the computed facts. Otherwise the deterministic template stays.
  An LLM failure never blocks the match.
- **Interfaces:** `GET /api/match/{seed}` (bundle), `/feed` (personalised), `/overlay` (cues), `/stream` (SSE replay),
  `POST /api/match/custom` (bring your own events), `/api/profile/{id}`, `/api/config`, `/api/health`.
- **Browser engine = backend engine.** Both produce identical matches and insights; `backend/scripts/parity_check.sh`
  proves it on four seeds. The UI starts on its own simulator immediately and adopts the backend's agent output when it arrives.
- **Tests:** `cd backend && pytest` (24 tests: simulator, engine, agents, grounding, retries, providers, storage, API, SSE, CORS).

## What is not
- Not built on Microsoft Agent Framework: the orchestrator is a small in-repo implementation.
- Nothing is deployed to Azure. Azure OpenAI/Foundry and Cosmos DB adapters exist behind configuration but are
  untested against a real account (see `azure/SWITCHING_TO_AZURE.md`). The GitHub Models and Azure endpoints used
  by the LLM client should be checked against current documentation before relying on them.
- No auto-eventing from video, and one focus player at a time (no multi-player watchlist).

## Run locally
```bash
# backend (http://localhost:8000)
cd backend && python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env        # LLM_PROVIDER=template works with no keys
uvicorn app.main:app --reload

# frontend (http://localhost:5173)
cd frontend && cp .env.example .env && npm install && npm run dev
```
Try it: `curl -N "localhost:8000/api/match/40/stream?speed=300&start=5000"` and
`curl "localhost:8000/api/match/40/feed?mode=broadcast&lang=ar&limit=3"`.

## Deploy: Neon + Render + Vercel
1. **Neon:** create a project, copy the connection string (`postgresql://...?sslmode=require`).
2. **GitHub Models (optional LLM):** create a token with access to GitHub Models. Without it the backend uses templates.
3. **Render:** New > Blueprint, point at this repo (`render.yaml`). Set `DATABASE_URL`, `GITHUB_TOKEN` and
   `CORS_ORIGINS` (your Vercel URL). The free service sleeps when idle; the UI keeps playing on its simulator while it wakes.
4. **Vercel:** import the repo, set **Root Directory** to `frontend`, add `VITE_API_URL` = your Render URL.
5. Open the site: the studio panel should say *Backend live*.

## Configuration
All switches are environment variables, listed in `backend/.env.example`: `LLM_PROVIDER` (`template`, `github`,
`openai_compat`, `azure`), `STORE_PROVIDER` (`auto`, `memory`, `sql`, `cosmos`), `DATABASE_URL`, CORS settings, and
LLM spend guards (`LLM_SEED_ALLOWLIST`, `LLM_MAX_CALLS_PER_MATCH`). Moving to Azure is a change of these values.

## Frontend
React + Vite, GSAP and ScrollTrigger (pinned pipeline walkthrough, reveals, lower-thirds), Lenis smooth scrolling kept in
sync with GSAP, and React Bits components (Aurora, SplitText, GradientText, ShinyText, ScrollReveal, SpotlightCard,
BorderGlow, GlareHover, ElectricBorder, Magnet, ClickSpark; MIT with Commons Clause). The UI has not been checked in a
real browser by its author yet.
