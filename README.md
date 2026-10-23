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
- **Tests:** `cd backend && pytest` (89 tests: simulator, engine, agents, grounding, retries, LLM budget, providers, storage, API, SSE, CORS, what-if model, chat planning, tool facts, grounding rejection, spoiler safety, rate limits, prompt-injection handling). `parity_check.sh` also proves the Python and JS what-if models agree.

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
2. **LLM (optional):** GitHub Models inference was retired on July 30, 2026. Configure Gemini for the match pipeline
   (`LLM_PROVIDER=gemini`, `LLM_API_KEY` = Google AI Studio key, `LLM_MODEL=gemini-3.1-flash-lite`) and chat
   (`CHAT_LLM_PROVIDER=gemini`, `CHAT_LLM_API_KEY`, `CHAT_LLM_MODEL=gemini-3.1-flash-lite`). The same Gemini key
   can be used for both. Leave `CHAT_LLM_PROVIDER` empty to make chat share the pipeline model. Without keys,
   the backend uses templates.
3. **Render (free, dashboard setup):** create a **New Web Service** connected to this GitHub repository and `main`.
   Choose **Docker**, set **Root Directory** to `.`, **Dockerfile Path** to `./Dockerfile`, and **Docker Context** to `.`.
   Select the Free instance. Add `LLM_API_KEY`, `CHAT_LLM_API_KEY`, `DATABASE_URL` (if using Neon), and
   `CORS_ORIGINS` (your exact Vercel URL) as environment variables. The `LLM_*` and `CHAT_LLM_*` defaults are
   in `render.yaml`; set them manually in the dashboard because this setup does not require a Blueprint.
   The free service sleeps when idle; the UI keeps playing on its simulator while it wakes.
4. **Vercel:** import the repo, set **Root Directory** to `frontend`, add `VITE_API_URL` = your Render URL.
5. Open the site: the studio panel should say *Backend live*.

## Configuration
All switches are environment variables, listed in `backend/.env.example`: `LLM_PROVIDER` (`template`, `github` (retired),
`openai_compat`, `gemini`, `azure`), `STORE_PROVIDER` (`auto`, `memory`, `sql`, `cosmos`), `DATABASE_URL`, CORS settings, and
LLM spend guards (`LLM_SEED_ALLOWLIST`, `LLM_MAX_CALLS_PER_MATCH`). Moving to Azure is a change of these values.

## Frontend
React + Vite, GSAP and ScrollTrigger (pinned pipeline walkthrough, reveals, lower-thirds), Lenis smooth scrolling kept in
sync with GSAP, and React Bits components (Aurora, SplitText, GradientText, ShinyText, ScrollReveal, SpotlightCard,
BorderGlow, GlareHover, ElectricBorder, Magnet, ClickSpark; MIT with Commons Clause). The UI has not been checked in a
real browser by its author yet.

## Free stack (no Azure account needed)
| Need | Free option used |
|---|---|
| LLM (optional) | Gemini via Google AI Studio for the match pipeline (`LLM_PROVIDER=gemini`, `LLM_API_KEY`) and chat (`CHAT_LLM_PROVIDER=gemini`, `CHAT_LLM_API_KEY`). |
| Hosting | Vercel (frontend), Render free web service (API), Neon free Postgres. Ping `/api/health` every 10 minutes with a free monitor to stop the API sleeping during judging. |
| Voice, video | Browser Web Speech API, canvas + MediaRecorder |
| Dev tooling | GitHub, GitHub Copilot, GitHub Actions (CI in `.github/workflows/ci.yml`) |

With no Gemini key the app still works end to end on templates.

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
