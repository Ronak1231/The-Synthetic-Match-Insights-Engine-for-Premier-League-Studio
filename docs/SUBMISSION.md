# Submission kit: Inside the Game hackathon

## Before you submit (read this)
- **"New Projects Only"**: the official rules (section 4.3) require the project to be newly created after registration opened
  (29 Sep 2026). If this repository predates that, check with the organisers whether adding these features is enough.
  Do not claim older work as new in the submission.
- The rules reward "innovative use of the Microsoft AI platform". Without Azure, the honest free story is **GitHub Models,
  GitHub Copilot and GitHub Actions** (all Microsoft/GitHub). Say exactly that; do not claim Azure, Foundry or Agent Framework.
- Repository must be **public**; demo video **under 2 minutes**, public URL (YouTube/Vimeo/...), no third-party music or logos.

## Elevator pitch (paste into the form)
Synthetic Match Insights Engine turns synthetic football events into explainable match intelligence. A six-agent pipeline
(ingest, interpret, explain, narrate, overlay, personalise) feeds a live studio in five languages and four audience modes.
New: **Ask the match**, a chat agent whose answers come from tool calls and are rejected if they contain a number that is not
in the facts; **Second Guess**, a seeded Monte Carlo what-if simulator that shows whether a different decision would have
been better, with confidence intervals; an **analytics board**; and an auto-built **highlight film** that records to video in
the browser. Every what-if adds labelled counterfactual rows to an exportable synthetic dataset. Built with GitHub Copilot on
a free stack: GitHub Models, Vercel, Render and Neon. All clubs, players and data are fictional.

## 110-second demo script (record the live site, screen + your voice)
| Time | Show | Say |
|---|---|---|
| 0:00 | Studio playing, switch Casual to Analyst, then Arabic | "One synthetic match, explained differently per viewer and language." |
| 0:15 | Lab > Ask: "Summarise the match", then "What if Mateo Ibarra had squared it in the 23rd minute?" | "Answers come from tools, not model memory. Numbers are checked against the facts." |
| 0:40 | Follow-up "what if he had carried it instead?"; open "How this was answered" | "Follow-ups keep context and every answer shows its working." |
| 0:55 | Second guess tab: top-headroom shot, click bars, pick a team-mate | "Seeded Monte Carlo with intervals. It only claims a better option when the ranges do not overlap." |
| 1:15 | Analytics: click a shot on the map | "Shot map links straight to the what-if." |
| 1:25 | Film tab (Standard length is about 105 s), press Play for 10 seconds, show Record | "A highlight film built from events, recorded in the browser." |
| 1:40 | Export CSV, then backend trace / tests badge | "Every what-if grows a labelled counterfactual dataset. 79 tests plus Python/JS parity." |

## Mapping to the judging rubric
- **Technological implementation**: tests (79) + parity check in CI; model assumptions documented and returned with results.
- **Agentic design**: plan, tool call, answer, grounding verifier; rules-first planner with LLM fallback; sanitised tool arguments; rate limits.
- **Real-world impact**: studio segment generator, fan "what if" debates, labelled counterfactual dataset for research.
- **UX and presentation**: four-tab lab, spoiler-free mode, voice in/out, auto-built film for the demo.
- **Category adherence**: ingest/interpret/explain/render/personalise pipeline, narratives, explainability, data extension, five languages.

## Known limits to state honestly
Chat needs the backend; non-English chat needs an LLM; what-if covers shots only and rests on a simplified model; the UI was
verified by build, lint and Node-side rendering tests, not yet by eye in a browser.
