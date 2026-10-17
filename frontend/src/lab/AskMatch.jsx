import { useEffect, useRef, useState } from 'react';
import { askMatch, API_URL } from '../api/client';
import { explainWhatIf } from '../engine/whatif';
import { usePrefs } from '../studio/prefs';
import WhatIfResult from './WhatIfResult';

const STARTERS = ['Summarise the match', 'Who was the best player?', 'What was the biggest missed chance?', 'What if the biggest chance had been a pass?'];
const LOCALE = { en: 'en-GB', hi: 'hi-IN', es: 'es-ES', ar: 'ar-SA', fr: 'fr-FR' };
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

function Bubble({ m }) {
  if (m.role === 'user') return <div className="msg me">{m.text}</div>;
  if (m.error) return <div className="msg bot err">{m.text}</div>;
  const r = m.reply;
  return (
    <div className="msg bot" dir={r.lang === 'ar' ? 'rtl' : 'ltr'}>
      <p>{r.answer}</p>
      {r.table && r.table.rows.length > 0 && (
        <table className="an-table chat-table">
          <thead><tr>{r.table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{r.table.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      )}
      {r.viz?.type === 'whatif' && <WhatIfResult result={r.viz.result} explanation={explainWhatIf(r.viz.result)} compact />}
      <div className="msg-meta">
        <span className={`badge ${r.source === 'llm' ? 'ai' : ''}`} title={r.source === 'llm' ? 'Phrased by a language model; every number was checked against the tool facts' : 'Written from a template over the tool facts'}>
          {r.source === 'llm' ? 'AI · numbers checked' : 'Template answer'}
        </span>
        {r.plan && <span className="badge">{r.plan.tool} · planned by {r.plan.by}</span>}
        {r.grounded === false && <span className="badge warn" title="The model's wording contained a number that was not in the facts, so the template answer is shown">model text rejected</span>}
        <span className="badge">{Math.round(r.ms)} ms</span>
      </div>
      {r.note && <p className="msg-note">{r.note}</p>}
      {(r.facts && Object.keys(r.facts).length > 0) && (
        <details className="msg-facts">
          <summary>How this was answered{r.evidence?.length ? ` · ${r.evidence.length} source events` : ''}</summary>
          <pre>{JSON.stringify({ plan: r.plan, evidence_event_ids: r.evidence, facts: r.facts }, null, 1)}</pre>
        </details>
      )}
    </div>
  );
}

export default function AskMatch({ match, seed }) {
  const { lang, mode } = usePrefs();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [spoilerFree, setSpoilerFree] = useState(false);
  const [speakOn, setSpeakOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [suggestions, setSuggestions] = useState(STARTERS);
  const ctxRef = useRef(null);
  const logRef = useRef(null);
  const abortRef = useRef(null);
  const recRef = useRef(null);
  const clockRef = useRef(0);
  useEffect(() => { clockRef.current = match.clock; }, [match.clock]);

  useEffect(() => () => { abortRef.current?.abort(); recRef.current?.abort?.(); window.speechSynthesis?.cancel(); }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', text: q }]);
    abortRef.current = new AbortController();
    try {
      const reply = await askMatch(seed, { message: q, lang, mode, context: ctxRef.current, as_of: spoilerFree ? Math.round(clockRef.current) : null }, abortRef.current.signal);
      ctxRef.current = reply.context;
      setSuggestions(reply.suggestions?.length ? reply.suggestions : STARTERS);
      setMessages((m) => [...m, { role: 'bot', reply }]);
      if (speakOn && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(reply.answer);
        u.lang = LOCALE[reply.lang] || 'en-GB';
        window.speechSynthesis.speak(u);
      }
    } catch (err) {
      if (err.message !== 'cancelled') setMessages((m) => [...m, { role: 'bot', error: true, text: String(err.message || err) }]);
    } finally {
      setBusy(false);
    }
  };

  const listen = () => {
    if (!SR) return;
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR();
    rec.lang = LOCALE[lang] || 'en-GB';
    rec.interimResults = false;
    rec.onresult = (e) => { const t = e.results[0][0].transcript; setInput(t); send(t); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const offline = !API_URL;
  return (
    <div className="lab-pane ask">
      <div className="lab-toolbar">
        <label className="lab-toggle">
          <input type="checkbox" checked={spoilerFree} onChange={(e) => setSpoilerFree(e.target.checked)} />
          Spoiler-free: answer only from what has happened by the live clock
        </label>
        <label className="lab-toggle">
          <input type="checkbox" checked={speakOn} onChange={(e) => setSpeakOn(e.target.checked)} disabled={!window.speechSynthesis} />
          Read answers aloud
        </label>
        <span className={`lab-status ${offline ? 'off' : match.backend.status}`}>
          {offline ? 'Backend not configured' : match.backend.status === 'live' ? 'Backend live' : match.backend.status === 'offline' ? 'Backend unreachable' : 'Backend waking up…'}
        </span>
      </div>

      <div className="chat-log" ref={logRef} data-lenis-prevent aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-empty">
            <h4>Ask anything about this match</h4>
            <p>Answers are computed from the match events by tools, then phrased. Try “What if Mateo Ibarra had squared it in the 23rd minute?” and follow up with “what if he had carried it instead?”.</p>
            {offline && <p className="msg-note">The chat needs the backend API. Set <code>VITE_API_URL</code>; “Second guess”, “Analytics” and “Match film” work without it.</p>}
          </div>
        )}
        {messages.map((m, i) => <Bubble key={i} m={m} />)}
        {busy && <div className="msg bot typing"><i /><i /><i /></div>}
      </div>

      <div className="chat-suggest">
        {suggestions.slice(0, 4).map((s) => <button key={s} className="chip-btn" onClick={() => send(s)} disabled={busy || offline}>{s}</button>)}
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about players, xG, momentum, or “what if…”" maxLength={300} aria-label="Your question" disabled={offline} />
        {SR && <button type="button" className={`btn-ghost mic ${listening ? 'on' : ''}`} onClick={listen} aria-pressed={listening} title="Speak your question">{listening ? 'Listening…' : 'Speak'}</button>}
        <button className="btn-primary" disabled={busy || !input.trim() || offline}>Ask</button>
      </form>
    </div>
  );
}
