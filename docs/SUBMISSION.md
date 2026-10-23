# Submission notes: Inside the Game hackathon

## Verify before submitting
- The official rules require a new project created after the registration period opened. If this repository or its
  foundations predate that period, ask the organizers whether the work qualifies; do not describe earlier work as new.
- Keep the repository public and provide a working demo link, a public demonstration video under two minutes, and
  English submission materials. Do not use third-party footage, music, marks or other materials without permission.
- Describe only technologies actually used. The deployed app uses Vercel, Render and optional Gemini. It is not deployed
  on Azure, does not use Microsoft Agent Framework, and does not use GitHub Models inference (retired July 30, 2026).
- The Azure OpenAI/Foundry and Cosmos DB adapters in the repository have not been validated against live Azure services.
- The app uses fictional synthetic clubs, players and event data. It does not analyze real Premier League matches or
  detect events from video.

## Project links
- **Live demo:** https://the-synthetic-match-insights-engine.vercel.app/#lab
- **API health:** https://the-synthetic-match-insights-engine-for.onrender.com/api/health
- **Repository:** https://github.com/Ronak1231/The-Synthetic-Match-Insights-Engine-for-Premier-League-Studio

## Elevator pitch
The Synthetic Match Insights Engine transforms synthetic football events into explainable match intelligence,
live-style narratives and broadcast-ready overlay cues. Its coordinated agents ingest and interpret events, explain
why moments matter, render viewer-facing outputs and personalize feeds by language and viewing mode. A React studio
adds chat, analytics, shot-based what-if exploration and an event-generated match film. Model-generated wording is
checked against match facts, with deterministic fallbacks when a model is unavailable. All match data is fictional.

## Suggested demo video (about 100-110 seconds)
| Time | Show | Explain |
|---|---|---|
| 0:00 | Open the live studio and show a match playing | "This is a synthetic match, not real match footage or data." |
| 0:12 | Switch viewing mode or language; show a key insight | "The same event stream becomes an insight tailored to a viewer." |
| 0:28 | Open the agent trace | "The trace shows how the pipeline processes and explains events." |
| 0:40 | Lab > Ask; ask for a match summary | "Chat answers are grounded in match tools and computed facts." |
| 0:55 | Second Guess; select a shot and show the estimated outcomes | "This is a simplified simulation with uncertainty, not a real-world prediction." |
| 1:12 | Analytics or Match film | "The visuals and film are generated from synthetic event data." |
| 1:30 | Show API or repository/CI briefly | "The API and automated checks support the demo." |

Keep the finished video below the two-minute limit in the official rules. Use your own narration and only assets you
have permission to include.

## How the project maps to the challenge
- **Pipeline:** ingest, interpret, explain, render and personalize synthetic football events.
- **Real-time-style intelligence:** compute match state, xG, shot patterns and momentum from event data and replay it
  through the studio. This is not live broadcast ingestion.
- **Narratives and recaps:** create key-moment captions, chat answers and match-film views from the synthetic match.
- **Explainability:** rank moments with reasons and supporting evidence; expose agent traces in the UI.
- **Data innovation:** generate seeded fictional matches and accept custom event data through the API.
- **Personalization and language:** present feeds through viewing modes and language options; narration templates cover
  five languages.

## Honest limitations
The orchestrator is a small project implementation, not Microsoft Agent Framework. Video event detection, player
identification from footage, ball/player speed measurement and pass-difficulty estimation are not implemented.
Second Guess is a simplified shot counterfactual model; its outputs are estimates, not claims about what would have
happened. Non-English generated chat responses depend on a functioning language model; built-in fallback responses
remain available.
