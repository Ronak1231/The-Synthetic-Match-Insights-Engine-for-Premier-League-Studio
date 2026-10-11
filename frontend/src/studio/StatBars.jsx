import { TEAMS } from '../engine/data';
import { usePrefs } from './prefs';

export default function StatBars({ snap }) {
  const { mode } = usePrefs();
  const T = snap.team;
  const acc = (t) => (T[t].passes ? Math.round((T[t].passesOk / T[t].passes) * 100) : 0);
  const rows = [
    ['xG', T.home.xg.toFixed(2), T.away.xg.toFixed(2), T.home.xg, T.away.xg],
    ['Possession', snap.possPct.home + '%', snap.possPct.away + '%', snap.possPct.home, snap.possPct.away],
    ['Shots (on target)', `${T.home.shots} (${T.home.onTarget})`, `${T.away.shots} (${T.away.onTarget})`, T.home.shots, T.away.shots],
    ['Pass accuracy', acc('home') + '%', acc('away') + '%', acc('home'), acc('away')],
  ];
  if (mode === 'analyst' || mode === 'broadcast') {
    rows.push(
      ['Pressure actions', T.home.pressures, T.away.pressures, T.home.pressures, T.away.pressures],
      ['Tackles', T.home.tackles, T.away.tackles, T.home.tackles, T.away.tackles],
      ['Passes', T.home.passes, T.away.passes, T.home.passes, T.away.passes]
    );
  }
  return (
    <div className="stats">
      <div className="chart-head">
        <h4>Match intelligence</h4>
        <span className="legend">{mode === 'casual' || mode === 'player' ? 'Fan view' : 'Analyst view'}</span>
      </div>
      {rows.map(([label, hv, av, h, a]) => {
        const total = h + a || 1;
        return (
          <div className="stat" key={label}>
            <div className="stat-top">
              <b style={{ color: TEAMS.home.color }}>{hv}</b>
              <span>{label}</span>
              <b style={{ color: TEAMS.away.color }}>{av}</b>
            </div>
            <div className="bar">
              <i style={{ width: `${(h / total) * 100}%`, background: TEAMS.home.color }} />
              <i style={{ width: `${(a / total) * 100}%`, background: TEAMS.away.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
