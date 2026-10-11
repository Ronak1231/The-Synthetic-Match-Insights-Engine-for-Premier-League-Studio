import { useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import SpotlightCard from '../components/reactbits/SpotlightCard';
import BorderGlow from '../components/reactbits/BorderGlow';
import GlareHover from '../components/reactbits/GlareHover';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const AGENTS = [
  { n: '01', name: 'Ingest agent', role: 'Validates and sequences the event stream, rejects malformed events.', svc: ['Runs today: Python on Render', 'Azure option: Event Hubs + Functions'] },
  { n: '02', name: 'Interpreter agent', role: 'Maintains match state, xG, pressure and momentum over rolling windows.', svc: ['Runs today: Python on Render', 'Azure option: Fabric Real-Time Intelligence'] },
  { n: '03', name: 'Explainer agent', role: 'Ranks moments and attaches the evidence for why each one matters.', svc: ['Runs today: Python on Render', 'Azure option: Foundry Agent Service'] },
  { n: '04', name: 'Narrator agent', role: 'Writes captions in five languages; LLM output must pass a grounding check.', svc: ['Runs today: GitHub Models or templates', 'Azure option: Foundry model deployment'] },
  { n: '05', name: 'Personalizer agent', role: 'Applies club, player, metric and mode preferences per viewer.', svc: ['Runs today: Python on Render + Neon', 'Azure option: Cosmos DB'] },
  { n: '06', name: 'Overlay renderer', role: 'Emits timed, machine-readable overlay.cue/1 cues for graphics.', svc: ['Runs today: Python on Render (REST + SSE)', 'Azure option: Container Apps + SignalR'] },
];

const RUBRIC = [
  ['Technological implementation', 'Seeded synthetic data, a tested Python backend, and a front end that falls back to a browser simulator.'],
  ['Agentic design', 'Single-purpose agents, shared state, retries, fallbacks and an LLM grounding check, all traceable in the studio.'],
  ['Real-world impact', 'Studio overlays, streaming second-screen and recaps from one explainable pipeline.'],
  ['User experience', 'Four audience modes from one stream, with live scrubbing and instant re-narration in five languages.'],
  ['Category fit', 'A multi-agent pipeline with hand-offs and failure recovery. Not built on Microsoft Agent Framework or Azure.'],
];

export default function Architecture() {
  const root = useRef(null);
  useGSAP(
    () => {
      gsap.from('.arch-reveal', { y: 50, opacity: 0, duration: 0.8, stagger: 0.09, ease: 'power3.out', scrollTrigger: { trigger: root.current, start: 'top 75%' } });
      gsap.from('.flow-line', { scaleX: 0, transformOrigin: 'left center', duration: 1.4, ease: 'power2.inOut', scrollTrigger: { trigger: '.flow', start: 'top 85%' } });
    },
    { scope: root }
  );

  return (
    <section className="section arch" id="architecture" ref={root}>
      <div className="section-head arch-reveal">
        <span className="eyebrow">Architecture</span>
        <h2>Real agents. Hosting you can swap.</h2>
        <p>
          Each stage is its own agent in a Python backend, run by an orchestrator with shared state, retries and fallbacks. It runs on Vercel, Render and Neon today. LLM, database and hosting are chosen by configuration, so each can move to the Azure service listed without changing the agents. Nothing here is deployed to Azure yet.
        </p>
      </div>

      <div className="flow arch-reveal" aria-hidden="true">
        <div className="flow-line" />
        {['Events', 'State', 'Reason', 'Voice', 'Viewer', 'Screen'].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="arch-orch arch-reveal">
        <BorderGlow backgroundColor="#0a0e19" borderRadius={22} glowColor="160 90 70" colors={['#38f8c7', '#8b5cf6', '#ff5d8f']} animated>
          <div className="orch">
            <small>Orchestrator</small>
            <h3>Orchestrator · shared state · retries · fallbacks</h3>
            <p>Routes the match through the agents, shares one pipeline state, retries failed steps, falls back to deterministic templates if the language model fails, and records a trace of every hand-off.</p>
          </div>
        </BorderGlow>
      </div>

      <div className="agent-grid">
        {AGENTS.map((a) => (
          <SpotlightCard key={a.n} className="panel agent arch-reveal" spotlightColor="rgba(139,92,246,.16)">
            <span className="agent-n">{a.n}</span>
            <h4>{a.name}</h4>
            <p>{a.role}</p>
            <div className="chips">
              {a.svc.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          </SpotlightCard>
        ))}
      </div>

      <div className="rubric arch-reveal">
        <h3>How it maps to the judging criteria</h3>
        <div className="rubric-grid">
          {RUBRIC.map(([k, v]) => (
            <GlareHover key={k} background="rgba(255,255,255,.03)" borderRadius="16px" borderColor="rgba(255,255,255,.09)" glareColor="#38f8c7" glareOpacity={0.18} width="100%" height="100%">
              <div className="rubric-card">
                <b>{k}</b>
                <p>{v}</p>
              </div>
            </GlareHover>
          ))}
        </div>
      </div>
    </section>
  );
}
