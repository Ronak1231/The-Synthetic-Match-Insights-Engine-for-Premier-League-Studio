import { LANGS, MODES, TEAMS, allPlayers } from '../engine/data';
import { METRICS, usePrefs } from './prefs';

export default function Personalize({ setPrefs }) {
  const prefs = usePrefs();
  const set = (k) => (v) => setPrefs((p) => ({ ...p, [k]: v }));
  const players = allPlayers();

  return (
    <div className="pers">
      <div className="pers-group">
        <label>Audience mode</label>
        <div className="seg" role="tablist">
          {Object.entries(MODES).map(([k, m]) => (
            <button key={k} role="tab" aria-selected={prefs.mode === k} className={prefs.mode === k ? 'on' : ''} onClick={() => set('mode')(k)} title={m.blurb}>
              {m.label}
            </button>
          ))}
        </div>
        <small>{MODES[prefs.mode].blurb}</small>
      </div>

      <div className="pers-group">
        <label>Language</label>
        <div className="seg">
          {Object.entries(LANGS).map(([k, l]) => (
            <button key={k} className={prefs.lang === k ? 'on' : ''} onClick={() => set('lang')(k)} aria-pressed={prefs.lang === k}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pers-group">
        <label>Favourite club</label>
        <div className="seg">
          <button className={prefs.fav === 'none' ? 'on' : ''} onClick={() => set('fav')('none')}>Neutral</button>
          {['home', 'away'].map((t) => (
            <button key={t} className={prefs.fav === t ? 'on' : ''} onClick={() => set('fav')(t)} style={{ '--c': TEAMS[t].color }}>
              <i className="dot" style={{ background: TEAMS[t].color }} /> {TEAMS[t].short}
            </button>
          ))}
        </div>
      </div>

      <div className="pers-group">
        <label>Metric lens</label>
        <div className="seg">
          {Object.entries(METRICS).map(([k, m]) => (
            <button key={k} className={prefs.metric === k ? 'on' : ''} onClick={() => set('metric')(k)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pers-group">
        <label htmlFor="focus">Player focus</label>
        <select id="focus" value={prefs.focus} onChange={(e) => setPrefs((p) => ({ ...p, focus: e.target.value, mode: 'player' }))}>
          {['home', 'away'].map((t) => (
            <optgroup key={t} label={TEAMS[t].name}>
              {players
                .filter((p) => p.team === t)
                .map((p) => (
                  <option key={`${t}:${p.n}`} value={`${t}:${p.n}`}>
                    #{p.n} {p.name} · {p.pos}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  );
}
