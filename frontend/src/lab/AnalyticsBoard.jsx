import { useMemo, useState } from 'react';
import { TEAMS } from '../engine/data';
import { buildAnalytics, nameOf } from './analytics';
import PitchLines from './PitchLines';
import { H, W, sx, sy } from './geometry';

const C = { home: TEAMS.home.color, away: TEAMS.away.color };

function XgRace({ a, clock }) {
  const w = 420;
  const h = 170;
  const pad = { l: 30, r: 10, t: 12, b: 22 };
  const end = Math.max(600, Math.min(5400, clock || 5400));
  const max = Math.max(1, a.totals.home.xg, a.totals.away.xg) * 1.12;
  const X = (t) => pad.l + (t / end) * (w - pad.l - pad.r);
  const Y = (v) => h - pad.b - (v / max) * (h - pad.t - pad.b);
  const path = (team) => {
    let d = '';
    let prev = 0;
    for (const s of a.xgSteps) {
      d += d ? `L${X(s.t)},${Y(prev)}L${X(s.t)},${Y(s[team])}` : `M${X(s.t)},${Y(s[team])}`;
      prev = s[team];
    }
    return d;
  };
  const ticks = [0, 15, 30, 45, 60, 75, 90].filter((m) => m * 60 <= end);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="an-svg" role="img" aria-label="Cumulative expected goals over time">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={w - pad.r} y1={Y(max * f)} y2={Y(max * f)} stroke="rgba(255,255,255,.08)" />
          <text x={pad.l - 5} y={Y(max * f) + 3} textAnchor="end" className="an-t">{(max * f).toFixed(1)}</text>
        </g>
      ))}
      {ticks.map((m) => <text key={m} x={X(m * 60)} y={h - 6} textAnchor="middle" className="an-t">{m}'</text>)}
      <path d={path('home')} fill="none" stroke={C.home} strokeWidth="2" />
      <path d={path('away')} fill="none" stroke={C.away} strokeWidth="2" />
      {a.goals.map((g) => {
        const step = [...a.xgSteps].reverse().find((s) => s.t <= g.t) || a.xgSteps[0];
        return (
          <g key={g.t}>
            <circle cx={X(g.t)} cy={Y(step[g.team])} r="5" fill="#05070d" stroke="#fbbf24" strokeWidth="2" />
            <title>{`${g.minute}' ${nameOf(g.team, g.player)} (${g.score.home}-${g.score.away})`}</title>
          </g>
        );
      })}
    </svg>
  );
}

function ShotMap({ a, onPick }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="an-pitch" role="img" aria-label="Shot map. Circle size shows expected goals.">
      <PitchLines />
      {a.shots.map((s) => {
        const r = 0.9 + s.xg * 5;
        const col = C[s.team];
        return (
          <g key={s.id} className="shot-dot" onClick={() => onPick?.(s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onPick?.(s.id)}>
            <circle cx={sx(s.from.x)} cy={sy(s.from.y)} r={r} fill={s.outcome === 'off_target' || s.outcome === 'blocked' ? 'none' : col} fillOpacity={s.outcome === 'goal' ? 1 : 0.55} stroke={s.outcome === 'goal' ? '#fbbf24' : col} strokeWidth={s.outcome === 'goal' ? 0.6 : 0.3} strokeDasharray={s.outcome === 'blocked' ? '0.5 0.4' : undefined} />
            <title>{`${s.minute}' ${nameOf(s.team, s.player)}: ${s.xg} xG, ${s.outcome.replace('_', ' ')}${onPick ? ' (click to second-guess)' : ''}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

function PassNetwork({ a, team }) {
  const { nodes, links } = a.network[team];
  const pos = Object.fromEntries(nodes.map((n) => [n.n, n]));
  const maxC = Math.max(1, ...links.map((l) => l.c));
  const maxK = Math.max(1, ...nodes.map((n) => n.k));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="an-pitch" role="img" aria-label={`${TEAMS[team].name} pass network`}>
      <PitchLines />
      {links.map((l) => (
        <line key={`${l.a}-${l.b}`} x1={sx(pos[l.a].x)} y1={sy(pos[l.a].y)} x2={sx(pos[l.b].x)} y2={sy(pos[l.b].y)} stroke={C[team]} strokeWidth={0.2 + (l.c / maxC) * 1.1} opacity={0.25 + (l.c / maxC) * 0.55} />
      ))}
      {nodes.map((n) => (
        <g key={n.n}>
          <circle cx={sx(n.x)} cy={sy(n.y)} r={1.6 + (n.k / maxK) * 1.9} fill={C[team]} stroke="#05070d" strokeWidth="0.3" />
          <text x={sx(n.x)} y={sy(n.y) + 0.75} textAnchor="middle" className="an-n">{n.n}</text>
          <title>{`${nameOf(team, n.n)}: ${n.k} passes attempted`}</title>
        </g>
      ))}
    </svg>
  );
}

function ZoneControl({ a }) {
  const gx = a.zones[0].length;
  const gy = a.zones.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="an-pitch" role="img" aria-label="Zone control: which team acted more in each area">
      <PitchLines />
      {a.zones.map((row, j) => row.map((c, i) => {
        const tot = c.home + c.away;
        if (!tot) return null;
        const homeShare = c.home / tot;
        const team = homeShare >= 0.5 ? 'home' : 'away';
        const strength = Math.abs(homeShare - 0.5) * 2;
        return (
          <g key={`${i}-${j}`}>
            <rect x={(i * W) / gx} y={(j * H) / gy} width={W / gx} height={H / gy} fill={C[team]} opacity={0.1 + strength * 0.5 * (0.4 + 0.6 * (tot / a.zoneMax))} />
            <title>{`${Math.round(homeShare * 100)}% ${TEAMS.home.short} / ${Math.round((1 - homeShare) * 100)}% ${TEAMS.away.short} (${tot} actions)`}</title>
          </g>
        );
      }))}
    </svg>
  );
}

function Phases({ a }) {
  const w = 420;
  const h = 170;
  const max = Math.max(0.5, ...a.phases.flatMap((p) => [p.home.xg, p.away.xg])) * 1.15;
  const bw = (w - 40) / a.phases.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="an-svg" role="img" aria-label="Expected goals in each 15 minute period">
      {a.phases.map((p, i) => {
        const x = 30 + i * bw;
        const hh = (v) => (v / max) * (h - 40);
        return (
          <g key={p.label}>
            <rect x={x + 4} y={h - 22 - hh(p.home.xg)} width={bw / 2 - 5} height={hh(p.home.xg)} fill={C.home} rx="2"><title>{`${TEAMS.home.short} ${p.home.xg.toFixed(2)} xG, ${p.home.shots} shots, ${p.home.pressures} pressures`}</title></rect>
            <rect x={x + bw / 2} y={h - 22 - hh(p.away.xg)} width={bw / 2 - 5} height={hh(p.away.xg)} fill={C.away} rx="2"><title>{`${TEAMS.away.short} ${p.away.xg.toFixed(2)} xG, ${p.away.shots} shots, ${p.away.pressures} pressures`}</title></rect>
            <text x={x + bw / 2} y={h - 7} textAnchor="middle" className="an-t">{p.label}'</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function AnalyticsBoard({ match, onSecondGuess }) {
  const { events, clock } = match;
  const [live, setLive] = useState(false);
  const [team, setTeam] = useState('home');
  const bucket = live ? Math.floor(clock / 20) * 20 : Infinity;
  const a = useMemo(() => buildAnalytics(events, bucket), [events, bucket]);

  return (
    <div className="lab-pane">
      <div className="lab-toolbar">
        <div className="an-score">
          <b style={{ color: C.home }}>{TEAMS.home.short} {a.totals.home.xg.toFixed(2)} xG</b>
          <span>from {a.totals.home.shots} shots</span>
          <i>vs</i>
          <b style={{ color: C.away }}>{TEAMS.away.short} {a.totals.away.xg.toFixed(2)} xG</b>
          <span>from {a.totals.away.shots} shots</span>
        </div>
        <label className="lab-toggle">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          Follow the live clock
        </label>
      </div>
      <div className="an-grid">
        <section className="an-card"><h5>Expected-goals race <small>gold rings are goals</small></h5><XgRace a={a} clock={live ? clock : 5400} /></section>
        <section className="an-card"><h5>Chances by period <small>xG per 15 minutes</small></h5><Phases a={a} /></section>
        <section className="an-card wide"><h5>Shot map <small>size = xG · filled = on target · ring = goal{onSecondGuess ? ' · click to second-guess' : ''}</small></h5><ShotMap a={a} onPick={onSecondGuess} /></section>
        <section className="an-card">
          <h5>Pass network
            <span className="seg mini">
              {['home', 'away'].map((t) => <button key={t} className={team === t ? 'on' : ''} onClick={() => setTeam(t)}>{TEAMS[t].short}</button>)}
            </span>
          </h5>
          <PassNetwork a={a} team={team} />
          <small className="an-foot">Average passing position, node size = passes, line width = completed passes between two players.</small>
        </section>
        <section className="an-card"><h5>Zone control <small>who acted more in each area</small></h5><ZoneControl a={a} /></section>
        <section className="an-card wide">
          <h5>Player leaders</h5>
          <table className="an-table">
            <thead><tr><th>Player</th><th>Goals</th><th>Shots</th><th>xG</th><th>Pass %</th><th>Tackles</th></tr></thead>
            <tbody>
              {a.table.slice(0, 7).map((p) => (
                <tr key={`${p.team}${p.n}`}>
                  <td><i className="dot" style={{ background: C[p.team] }} /> {nameOf(p.team, p.n)}</td>
                  <td>{p.goals}</td><td>{p.shots}</td><td>{p.xg.toFixed(2)}</td><td>{p.acc}</td><td>{p.tackles}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
