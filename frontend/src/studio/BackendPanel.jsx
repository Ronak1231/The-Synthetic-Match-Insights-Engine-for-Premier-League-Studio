import { useState } from 'react';
import SpotlightCard from '../components/reactbits/SpotlightCard';

const ORDER = ['ingest', 'interpreter', 'explainer', 'narrator', 'overlay'];

function summarize(trace) {
  // One row per agent: status and time from the orchestrator's "run" step, plus the agent's own note.
  return ORDER.map((name) => {
    const steps = trace.filter((t) => t.kind === 'step' && t.agent === name);
    const run = steps.find((t) => t.step === 'run' && t.status === 'ok') || steps[steps.length - 1];
    const note = steps.find((t) => t.step !== 'run');
    const retried = steps.filter((t) => t.status === 'error').length;
    const d = note?.detail || {};
    let text = '';
    if (name === 'ingest') text = `${d.accepted ?? '–'} events accepted, ${d.rejected ?? 0} rejected`;
    if (name === 'interpreter') text = `${d.insights ?? '–'} insights from ${d.events ?? '–'} events`;
    if (name === 'explainer') text = d.consistent ? 'evidence attached, totals consistent' : 'inconsistency flagged';
    if (name === 'narrator') text = d.llm ? `${d.accepted}/${d.attempted} LLM captions accepted, ${d.rejected} rejected by grounding check` : 'template narration in 5 languages';
    if (name === 'overlay') text = `${d.cues ?? '–'} overlay.cue/1 cues validated`;
    return { name, status: run?.status || 'ok', ms: run?.ms ?? 0, text, retried };
  });
}

export default function BackendPanel({ backend }) {
  const [open, setOpen] = useState(false);
  const live = backend.status === 'live';
  const cfg = backend.config;

  let label;
  if (backend.status === 'disabled') label = 'Browser simulator · no backend configured';
  else if (backend.status === 'connecting') label = 'Waking the backend… the simulator keeps playing meanwhile';
  else if (backend.status === 'offline') label = 'Backend unreachable · running on the browser simulator';
  else label = `Backend live · LLM: ${cfg.llm.active}${cfg.llm.active === 'template' && cfg.llm.note ? ` (${cfg.llm.note})` : ''} · store: ${cfg.store.active}`;

  return (
    <SpotlightCard className={`panel backend-panel ${live ? 'is-live' : ''}`} spotlightColor="rgba(56,248,199,.12)">
      <div className="backend-row">
        <span className={`dot ${backend.status}`} aria-hidden="true" />
        <span className="backend-label">{label}</span>
        {live && (
          <button type="button" className="trace-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Hide agent trace' : 'Show agent trace'}
          </button>
        )}
      </div>
      {live && open && (
        <ol className="trace" data-lenis-prevent>
          {summarize(backend.trace).map((a) => (
            <li key={a.name} className={a.status}>
              <b>{a.name}</b>
              <span>{a.text}</span>
              <em>
                {a.retried > 0 ? `${a.retried} retr${a.retried > 1 ? 'ies' : 'y'} · ` : ''}
                {a.ms} ms
              </em>
            </li>
          ))}
        </ol>
      )}
    </SpotlightCard>
  );
}
