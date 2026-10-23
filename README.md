# Synthetic Match Insights Engine

[![CI](https://github.com/Ronak1231/The-Synthetic-Match-Insights-Engine-for-Premier-League-Studio/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Ronak1231/The-Synthetic-Match-Insights-Engine-for-Premier-League-Studio/actions/workflows/ci.yml)
[![Open live demo](https://img.shields.io/badge/demo-live-14b8a6)](https://the-synthetic-match-insights-engine.vercel.app/#lab)

An AI-assisted pipeline and studio UI that turns **synthetic football events** into explainable match intelligence,
live-style narratives, automated recaps and broadcast-ready overlay cues. Viewers can explore the same match through
personalized feeds, analytics and a match chatbot. Built for the Microsoft x Premier League *Inside the Game*
hackathon. All clubs, players and match data are fictional.

**Try it:** [Open the live studio](https://the-synthetic-match-insights-engine.vercel.app/#lab) ·
[Check backend health](https://the-synthetic-match-insights-engine-for.onrender.com/api/health) ·
[Test endpoints with Postman](postman/Match%20Insights%20API.postman_collection.json)

> The demo uses synthetic data, not real Premier League matches or video. The free Render backend may take a short
> time to wake after inactivity. Gemini is optional; deterministic templates and built-in chat answers provide
> fallbacks when a model is not configured or unavailable.

```
 synthetic events ──► Ingest ──► Interpreter ──► Explainer ──► Narrator ──► Overlay ──► UI / broadcast graphics
  (seeded, or your    validate    state, xG,      rank + why,   5 languages,  overlay.cue/1   Personalizer shapes
   own via POST)      sequence    momentum        evidence      LLM + check   JSON            the feed per viewer
                         └─────── one orchestrator: shared state · retries · fallbacks · trace ───────┘
```

## How it works
- **Agents** (`backend/app/agents`): ingest, interpreter, explainer, narrator, overlay, personalizer. Shared pipeline
  state, hand-offs, retries, fallbacks, and a trace of every step (visible in the studio under *Show agent trace*).
- **Narrator with a grounding check:** an LLM (optional) writes captions in all five languages in one call; the text is
  accepted only if every number in it is supported by the computed facts. Otherwise the deterministic template stays.
  An LLM failure never blocks the match.
- **Interfaces:** `GET /api/match/{seed}` (bundle), `/feed` (personalised), `/overlay` (cues), `/stream` (SSE replay),
  `POST /api/match/custom` (bring your own events), `/api/profile/{id}`, `/api/config`, `/api/health`, `POST /api/match/{seed}/chat`, `GET /api/match/{seed}/whatif/moments`, `POST /api/match/{seed}/whatif`.
- **Browser engine = backend engine.** Both produce identical matches and insights; `backend/scripts/parity_check.sh`
  proves it on four seeds. The UI starts on its own simulator immediately and adopts the backend's agent output when it arrives.
- **Automated checks:** GitHub Actions runs the backend test suite, frontend lint/build and Python/JavaScript parity checks on pushes and pull requests.

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
  untested against a real account (see `azure/SWITCHING_TO_AZURE.md`). GitHub Models inference was retired on
  July 30, 2026; use Gemini or a supported OpenAI-compatible provider instead.
- No auto-eventing from video (the film is generated *from* events, not the reverse), and one focus player at a time.
- Chat needs the backend; the other lab tabs run in the browser. Without an LLM, chat answers are English templates; with one,
  they follow the selected language. The what-if model covers shots only (not passes, substitutions or formations).

## Run locally

Requirements: Python 3.12, Node.js 22, and npm. No model key or database is required to run the app locally.

### Backend

In PowerShell:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

In `backend/.env`, set `LLM_PROVIDER=template` and leave the API keys empty for a no-key setup. Then start the API:

```powershell
python -m uvicorn app.main:app --reload
```

On macOS/Linux, activate the environment with `source .venv/bin/activate` and copy the example file with
`cp .env.example .env`.

### Frontend

Open a second terminal from the repository root:

```powershell
cd frontend
Copy-Item .env.example .env
npm ci
npm run dev
```

Open the Vite URL printed in the terminal (typically `http://localhost:5173`). The frontend `.env.example` points to
the local API at `http://localhost:8000`.

Useful local endpoints: `http://localhost:8000/api/health`, `http://localhost:8000/api/match/40`,
`http://localhost:8000/api/match/40/feed?mode=broadcast&lang=ar&limit=3`, and `http://localhost:8000/docs`.

## Deployment
The public demo uses Vercel for the frontend and Render for the backend. Neon/Postgres is optional; without a database,
the service uses its configured local store. The free Render service may sleep when idle.

For your own deployment:
1. **LLM (optional):** Configure Gemini for the match pipeline
   (`LLM_PROVIDER=gemini`, `LLM_API_KEY` = Google AI Studio key, `LLM_MODEL=gemini-3.1-flash-lite`) and chat
   (`CHAT_LLM_PROVIDER=gemini`, `CHAT_LLM_API_KEY`, `CHAT_LLM_MODEL=gemini-3.1-flash-lite`). The same Gemini key
   can be used for both. Leave `CHAT_LLM_PROVIDER` empty to make chat share the pipeline model. Without a model key,
   the app can use templates and built-in chat responses. GitHub Models inference has been retired; do not configure it.
2. **Render:** create a Web Service connected to this GitHub repository and `main`.
   Choose **Docker**, set **Root Directory** to `.`, **Dockerfile Path** to `./Dockerfile`, and **Docker Context** to `.`.
   Set the health check path to `/api/health`. Add the model keys if enabling Gemini, `DATABASE_URL` if using Neon,
   and `CORS_ORIGINS` with your exact frontend origin. The `render.yaml` contains Blueprint defaults; manually created
   services need their environment variables set in the dashboard.
3. **Vercel:** import the repository, set **Root Directory** to `frontend`, and set `VITE_API_URL` to your backend URL.

## Configuration
All switches are environment variables, listed in `backend/.env.example`: `LLM_PROVIDER` (`template`, `github` (retired),
`openai_compat`, `gemini`, `azure`), `STORE_PROVIDER` (`auto`, `memory`, `sql`, `cosmos`), `DATABASE_URL`, CORS settings, and
LLM spend guards (`LLM_SEED_ALLOWLIST`, `LLM_MAX_CALLS_PER_MATCH`). Moving to Azure is a change of these values.

## Tech stack and project boundaries
- **Frontend:** React, Vite, GSAP/ScrollTrigger and Lenis.
- **Backend:** Python, FastAPI and a project-specific multi-agent orchestrator.
- **Optional model:** Gemini; GitHub Models inference was retired on July 30, 2026.
- **Hosting:** Vercel frontend and Render API for the public demo; optional SQL/Postgres storage.
- **Azure:** Azure OpenAI/Foundry and Cosmos DB adapters exist but have not been validated against a live Azure account.
- **Not included:** video-based event detection or live-broadcast analysis. The match film is rendered from synthetic events.

## Troubleshooting the AI model
Open the Lab, Ask tab, and press **Check AI connection** (or `GET /api/llm/check` on the backend). It sends one tiny request and
explains the result in plain language, without printing any secret.
- *"GitHub Models inference has been retired"*: use `LLM_PROVIDER=gemini`, set `LLM_API_KEY` to a Google AI Studio
  key, and leave `LLM_BASE_URL` blank. Configure `CHAT_LLM_*` similarly if chat should use a separate Gemini model.
- *"the model is temporarily overloaded (HTTP 503)"* or *"the model request timed out"*: set the affected model
  variable (`LLM_MODEL` or `CHAT_LLM_MODEL`) to `gemini-3.1-flash-lite` and retry shortly.
- *"answered 200 but with plain text"*: verify the provider and its expected API base URL; for Gemini, leave
  `LLM_BASE_URL` blank to use Google's default endpoint.
- *"404"*: wrong base URL or model id. For the Gemini chat provider, use `CHAT_LLM_PROVIDER=gemini`, leave
  `CHAT_LLM_BASE_URL` empty, and use a model available to your API key such as `gemini-3.1-flash-lite`.
- *"rate limited"*: free-tier limit; the match warm-up at startup uses the same quota (`WARM_ON_START=false` saves it).
Chat keeps working while the model is broken: the built-in analyst answers, and a misconfigured model is not retried for 5 minutes.

## Test the deployed API with Postman
Import [`postman/Match Insights API.postman_collection.json`](./postman/Match%20Insights%20API.postman_collection.json)
into Postman. The collection includes health, configuration, model check, match data, and chat requests. Set the
collection variable `baseUrl` to your Render service URL (no trailing slash), then send **Health**, **AI connection
check**, and **Ask about the match** in that order. No provider API key should be entered in Postman; it stays in
Render's environment variables.

The AI connection check tests the match-pipeline model. Check the `chat` object from **Configuration**, then send
**Ask about the match** to test the chatbot itself. A chat response with `"source": "template"` or an `llm.state`
other than `"ok"` means the built-in analyst answered instead of Gemini. A successful HTTP status alone does not
prove the upstream model call succeeded.
