import { useMemo, useState } from 'react';
import { TEAMS } from '../engine/data';
import { explainWhatIf, listMoments, simulateWhatIf } from '../engine/whatif';
import { counterfactualRows, download, nameOf, toCsv } from './analytics';
import WhatIfResult from './WhatIfResult';

const FILTERS = { all: 'All shots', missed: 'Missed chances', goals: 'Goals' };

export default function SecondGuess({ match, focusId = null }) {
  const { events, clock } = match;
  const [live, setLive] = useState(false);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(focusId);
  const [mate, setMate] = useState('');

  const bucket = live ? Math.floor(clock / 30) * 30 : null;
  const moments = useMemo(() => listMoments(events, bucket), [events, bucket]);
  const shown = useMemo(
    () => moments.filter((m) => (filter === 'missed' ? m.outcome !== 'goal' : filter === 'goals' ? m.outcome === 'goal' : true)).slice(0, 14),
    [moments, filter]
  );
  const current = moments.find((m) => m.eventId === selected) || shown[0] || null;
  const listed = current && !shown.includes(current) ? [current, ...shown] : shown;

  const include = mate || null;
  const result = useMemo(() => (current ? simulateWhatIf(events, current.eventId, { include }) : null), [events, current, include]);
  const explanation = result ? explainWhatIf(result) : '';
  const mates = current ? TEAMS[current.team].players.filter((p) => p.pos !== 'GK' && p.n !== current.player) : [];

  const exportDataset = () => {
    const rows = counterfactualRows(events, (id) => simulateWhatIf(events, id, { n: 1000 }));
    download('second-guess-counterfactuals.csv', toCsv(rows));
  };

  return (
    <div className="lab-pane">
      <div className="lab-toolbar">
        <div className="seg">
          {Object.entries(FILTERS).map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <label className="lab-toggle">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Spoiler-free: only moments up to the live clock
        </label>
        <button className="btn-ghost btn-sm" onClick={exportDataset} title="One row per shot and option, with simulated probabilities">
          Export counterfactual dataset (CSV)
        </button>
      </div>

      <div className="sg-grid">
        <div className="sg-list" data-lenis-prevent role="listbox" aria-label="Moments to second-guess">
          {listed.length === 0 && <p className="lab-empty">No shots yet. Press play in the studio, or untick spoiler-free.</p>}
          {listed.map((m) => (
            <button key={m.eventId} role="option" aria-selected={current?.eventId === m.eventId} className={`sg-item ${current?.eventId === m.eventId ? 'on' : ''}`} style={{ '--c': TEAMS[m.team].color }} onClick={() => { setSelected(m.eventId); setMate(''); }}>
              <span className="min">{m.minute}'</span>
              <span className="who">{nameOf(m.team, m.player)}</span>
              <span className="sub">{m.xg} xG · {m.outcome.replace('_', ' ')}</span>
              {m.headroom > 3 && <span className="hr" title="How much better the best alternative looks on paper">+{m.headroom}</span>}
            </button>
          ))}
        </div>

        <div className="sg-main">
          {result ? (
            <>
              <div className="sg-head">
                <h4>Minute {result.minute}: {nameOf(result.team, result.player)} shoots ({result.original.xg} xG, {result.original.outcome.replace('_', ' ')})</h4>
                <label className="lab-select">
                  Try a specific team-mate
                  <select value={mate} onChange={(e) => setMate(e.target.value)}>
                    <option value="">Best option</option>
                    {mates.map((p) => <option key={p.n} value={`pass:${p.n}`}>Pass to {p.name}</option>)}
                  </select>
                </label>
              </div>
              <WhatIfResult key={`${result.eventId}-${mate}`} result={result} explanation={explanation} />
            </>
          ) : (
            <p className="lab-empty">Pick a moment.</p>
          )}
        </div>
      </div>
    </div>
  );
}
