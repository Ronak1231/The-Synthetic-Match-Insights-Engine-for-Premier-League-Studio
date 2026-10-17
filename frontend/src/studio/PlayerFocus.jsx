import { TEAMS, allPlayers } from '../engine/data';
import { playerRating } from '../engine/engine';
import { usePrefs } from './prefs';

export default function PlayerFocus({ snap }) {
  const { focus } = usePrefs();
  const [team, n] = focus.split(':');
  const info = allPlayers().find((p) => p.team === team && String(p.n) === n);
  const s = snap.players[focus] || { passes: 0, passesOk: 0, shots: 0, xg: 0, goals: 0, tackles: 0, sprints: 0, topSpeed: 0, distance: 0, touches: 0, pressures: 0 };
  const acc = s.passes ? Math.round((s.passesOk / s.passes) * 100) : 0;
  const cells = [
    ['Rating', s.passes + s.touches ? playerRating({ ...s }).toFixed(1) : '–'],
    ['Passes', `${s.passesOk}/${s.passes}`],
    ['Accuracy', s.passes ? acc + '%' : '–'],
    ['Shots · xG', `${s.shots} · ${s.xg.toFixed(2)}`],
    ['Tackles', s.tackles],
    ['Top speed', s.topSpeed ? s.topSpeed.toFixed(1) + ' km/h' : '–'],
    ['Sprint dist.', s.distance + ' m'],
    ['Pressures', s.pressures],
  ];
  return (
    <div className="pfocus" style={{ '--c': TEAMS[team].color }}>
      <div className="pf-top">
        <span className="pf-num">{info.n}</span>
        <div>
          <h4>{info.name}</h4>
          <small>{TEAMS[team].name} · {info.pos} · following all match</small>
        </div>
      </div>
      <div className="pf-grid">
        {cells.map(([k, v]) => (
          <div key={k}>
            <small>{k}</small>
            <b>{v}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
