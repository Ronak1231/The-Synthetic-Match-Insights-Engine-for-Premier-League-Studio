import { TEAMS } from '../engine/data';

const W = 640;
const H = 150;
const MID = H / 2;

export default function Momentum({ snap }) {
  const pts = snap.series;
  const x = (t) => (t / 5400) * W;
  const y = (v) => MID - v * 0.62;
  const line = pts.length ? pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.momentum).toFixed(1)}`).join(' ') : `M0,${MID} L0,${MID}`;
  const area = pts.length ? `${line} L${x(pts[pts.length - 1].t).toFixed(1)},${MID} L0,${MID} Z` : '';
  const goals = snap.insights.filter((i) => i.kind === 'goal');
  const shifts = snap.insights.filter((i) => i.kind === 'momentum_shift');

  return (
    <div className="chart">
      <div className="chart-head">
        <h4>Momentum &amp; rhythm</h4>
        <span className="legend">
          <i style={{ background: TEAMS.home.color }} /> {TEAMS.home.short} pressure
          <i style={{ background: TEAMS.away.color, marginLeft: 12 }} /> {TEAMS.away.short} pressure
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Momentum chart over match time">
        <defs>
          <clipPath id="up">
            <rect x="0" y="0" width={W} height={MID} />
          </clipPath>
          <clipPath id="dn">
            <rect x="0" y={MID} width={W} height={MID} />
          </clipPath>
          <linearGradient id="gh" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={TEAMS.home.color} stopOpacity=".55" />
            <stop offset="1" stopColor={TEAMS.home.color} stopOpacity=".02" />
          </linearGradient>
          <linearGradient id="ga" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={TEAMS.away.color} stopOpacity=".55" />
            <stop offset="1" stopColor={TEAMS.away.color} stopOpacity=".02" />
          </linearGradient>
        </defs>
        {[0, 15, 30, 45, 60, 75, 90].map((m) => (
          <g key={m}>
            <line x1={x(m * 60)} x2={x(m * 60)} y1="8" y2={H - 14} stroke="rgba(255,255,255,.06)" />
            <text x={x(m * 60)} y={H - 2} textAnchor="middle" className="axis">
              {m}'
            </text>
          </g>
        ))}
        <line x1="0" x2={W} y1={MID} y2={MID} stroke="rgba(255,255,255,.22)" strokeDasharray="3 4" />
        <line x1={x(2700)} x2={x(2700)} y1="4" y2={H - 14} stroke="rgba(255,255,255,.25)" />
        <text x={x(2700) + 4} y="14" className="axis">HT</text>
        <path d={area} fill="url(#gh)" clipPath="url(#up)" />
        <path d={area} fill="url(#ga)" clipPath="url(#dn)" />
        <path d={line} fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth="1.4" strokeLinejoin="round" />
        {shifts.map((s) => (
          <path key={s.id} d={`M${x(s.t)},${MID - 5} l4,5 l-4,5 l-4,-5 z`} fill={TEAMS[s.team].color} opacity=".95" />
        ))}
        {goals.map((g) => (
          <g key={g.id}>
            <line x1={x(g.t)} x2={x(g.t)} y1="8" y2={H - 14} stroke={TEAMS[g.team].color} strokeOpacity=".5" />
            <circle cx={x(g.t)} cy={g.team === 'home' ? 12 : H - 18} r="5.5" fill={TEAMS[g.team].color} />
            <text x={x(g.t)} y={(g.team === 'home' ? 12 : H - 18) + 3} textAnchor="middle" className="goal-mark">G</text>
          </g>
        ))}
        <line x1={x(snap.clock)} x2={x(snap.clock)} y1="2" y2={H - 14} stroke="#fff" strokeWidth="1" className="playhead" />
      </svg>
      <p className="chart-note">Diamonds mark momentum shifts the engine detected. Each one carries its own explanation in the feed.</p>
    </div>
  );
}
