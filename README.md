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
  `POST /api/match/custom` (bring your own events), `/api/profile/{id}`, `/api/config`, `/api/health`, `POST /api/match/{seed}/chat`, `GET /api/match/{seed}/whatif/moments`, `POST /api/match/{seed}/whatif`.
- **Browser engine = backend engine.** Both produce identical matches and insights; `backend/scripts/parity_check.sh`
  proves it on four seeds. The UI starts on its own simulator immediately and adopts the backend's agent output when it arrives.
- **Tests:** `cd backend && pytest` (79 tests: simulator, engine, agents, grounding, retries, LLM budget, providers, storage, API, SSE, CORS, what-if model, chat planning, tool facts, grounding rejection, spoiler safety, rate limits, prompt-injection handling). `parity_check.sh` also proves the Python and JS what-if models agree.

## Intelligence Lab (chat, Second Guess, analytics, film)
A new section of the UI (`#lab`) with four tabs. Everything is computed from the synthetic events and shows its working.
- **Ask the match** (`POST /api/match/{seed}/chat`): ask in your own words. Rules answer common questions instantly with an
  insight-driven analyst voice (`nlg.py`: "wasteful finishing", "had the ball but not the chances", comebacks), and say plainly
  when something is outside the data (fixtures, real clubs). With an LLM configured, one call writes a natural answer from a
  digest of the whole match plus a tool result, so unexpected questions work too; the model may request one tool (a what-if,
  a player comparison) in the same exchange. LLM text is accepted only if every number, and every scoreline pair, exists in
  the data; otherwise the built-in answer is used. A failing LLM (429, bad token) trips a cooldown so answers stay instant, and
  the UI says why the AI was not used. Tools: summary, goals, timeline, team and player stats, comparisons, leaders, shots,
  records, cards and fouls, phases, halves, momentum, key moments, what-if. Follow-ups work, spoiler-free mode hides the
  future, voice in/out uses the browser's Web Speech API.
- **Second guess** (`backend/app/domain/whatif.py`, JS twin `frontend/src/engine/whatif.js`): pick a shot, see seeded
  Monte Carlo odds for shooting versus carrying or passing to each team-mate, with 95% intervals. A better option is only
  claimed when the intervals do not overlap. Runs in the browser, so it works without the backend. The CSV export is a
  labelled counterfactual dataset (one row per shot and option).
- **Analytics**: xG race, chances per 15 minutes, shot map (click a shot to second-guess it), pass network, zone control,
  player leaders. Follows the live clock if you tick the box.
- **Match film**: a canvas-rendered analytics film built from the events. Options: length (Short ~80 s, Standard ~105 s,
  Extended ~2:40, Full story ~3-4 min), second-guess cards on/off, analytics cards (half-time and full-time stats, xG race,
  shot map, top performers) on/off, and a focus on one team or player. Each key moment shows a live stats panel; the language
  and audience mode follow the studio. "Record as video" saves a WebM with the browser's MediaRecorder; nothing is uploaded.

Model assumptions are stated in `whatif.py` and returned with every result: the events log the ball and the actors, not all
22 players, so team-mates are placed from formation slots, attackers push forward as the ball does, and pressure is
recovered from the logged xG. Results are estimates of a model, not measurements. About half of the synthetic shots show
a "better option", which is a property of this simplified model and the generated shots, not a football finding.

## What is not
- Not built on Microsoft Agent Framework: the orchestrator is a small in-repo implementation.
- Nothing is deployed to Azure. Azure OpenAI/Foundry and Cosmos DB adapters exist behind configuration but are
  untested against a real account (see `azure/SWITCHING_TO_AZURE.md`). The GitHub Models and Azure endpoints used
  by the LLM client should be checked against current documentation before relying on them.
- No auto-eventing from video (the film is generated *from* events, not the reverse), and one focus player at a time.
- Chat needs the backend; the other lab tabs run in the browser. Without an LLM, chat answers are English templates; with one,
  they follow the selected language. The what-if model covers shots only (not passes, substitutions or formations).

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

## Free stack (no Azure account needed)
| Need | Free option used |
|---|---|
| LLM (optional) | GitHub Models via a GitHub token with `models: read` (`LLM_PROVIDER=github`); rate-limited free tier. Or local Ollama via `LLM_PROVIDER=openai_compat`, `LLM_BASE_URL=http://localhost:11434/v1`, any `LLM_API_KEY`. |
| Hosting | Vercel (frontend), Render free web service (API), Neon free Postgres. Ping `/api/health` every 10 minutes with a free monitor to stop the API sleeping during judging. |
| Voice, video | Browser Web Speech API, canvas + MediaRecorder |
| Dev tooling | GitHub, GitHub Copilot, GitHub Actions (CI in `.github/workflows/ci.yml`) |

Check current GitHub Models limits before the demo; they change. With no token the app still works end to end on templates.
