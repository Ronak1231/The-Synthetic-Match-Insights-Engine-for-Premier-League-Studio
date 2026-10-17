import { useState } from 'react';
import { TEAMS } from '../engine/data';
import PitchLines from './PitchLines';
import { H, sx, sy } from './geometry';

const lastName = (label) => label.replace('Pass to ', '').split(' ').slice(-1)[0];

// Attacking half of the pitch: what happened (solid) versus the option being tested (dashed).
export function WhatIfPitch({ result, drawKey }) {
  const { team, original, alternatives } = result;
  const color = TEAMS[team].color;
  const right = team === 'home';
  const x0 = right ? 46 : 0;
  const goal = { x: right ? 100 : 0, y: 50 };
  const chosen = alternatives.find((a) => a.key === drawKey);
  const shooter = original.from;
  const arrowId = `wi-arrow-${result.eventId}`;
  return (
    <svg className="wi-pitch" viewBox={`${x0} 0 59 ${H}`} role="img" aria-label={`Attacking half showing the original shot and the tested option`}>
      <defs>
        <marker id={arrowId} markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
          <path d="M0 0L4 2L0 4z" fill={color} />
        </marker>
      </defs>
      <PitchLines />
      {alternatives.filter((a) => a.kind === 'pass').map((a) => (
        <g key={a.key} opacity={a.key === drawKey ? 1 : 0.55}>
          <circle cx={sx(a.to.x)} cy={sy(a.to.y)} r="1.7" fill="rgba(5,7,13,.7)" stroke={color} strokeWidth="0.3" />
          <text x={sx(a.to.x)} y={sy(a.to.y) - 2.6} textAnchor="middle" className="wi-t">{lastName(a.label)}</text>
        </g>
      ))}
      {/* what happened */}
      <line x1={sx(shooter.x)} y1={sy(shooter.y)} x2={sx(original.to.x)} y2={sy(original.to.y)} stroke="#fbbf24" strokeWidth="0.5" />
      <circle cx={sx(original.to.x)} cy={sy(original.to.y)} r="0.9" fill="#fbbf24" />
      {/* the option being tested */}
      {chosen && (
        <g key={drawKey} className="wi-draw">
          <line pathLength="1" x1={sx(shooter.x)} y1={sy(shooter.y)} x2={sx(chosen.to.x)} y2={sy(chosen.to.y)} stroke={color} strokeWidth="0.55" strokeDasharray="1.2 0.9" markerEnd={`url(#${arrowId})`} />
          <line className="wi-then" x1={sx(chosen.to.x)} y1={sy(chosen.to.y)} x2={sx(goal.x)} y2={sy(goal.y)} stroke={color} strokeWidth="0.35" strokeDasharray="0.4 0.8" />
        </g>
      )}
      <circle cx={sx(shooter.x)} cy={sy(shooter.y)} r="1.9" fill={color} stroke="#fff" strokeWidth="0.3" />
      <text x={sx(shooter.x)} y={sy(shooter.y) + 0.7} textAnchor="middle" className="wi-n">{result.player}</text>
    </svg>
  );
}

export function WhatIfBars({ result, drawKey, onPick }) {
  const opts = [result.baseline, ...result.alternatives];
  const max = Math.max(...opts.map((o) => o.probability + o.ci), 1);
  return (
    <div className="wi-bars" role="list">
      {opts.map((o) => (
        <button
          key={o.key}
          role="listitem"
          className={`wi-row ${o.key === drawKey ? 'on' : ''} ${o.key === result.best && result.verdict === 'better_alternative' ? 'best' : ''} ${o.key === 'shoot' ? 'orig' : ''}`}
          onClick={() => onPick?.(o.key)}
          title={o.note || 'What actually happened'}
        >
          <span className="wi-label">{o.label}</span>
          <span className="wi-track">
            <i style={{ width: `${(o.probability / max) * 100}%` }} />
            <u style={{ left: `${(Math.max(0, o.probability - o.ci) / max) * 100}%`, width: `${((Math.min(max, o.probability + o.ci) - Math.max(0, o.probability - o.ci)) / max) * 100}%` }} />
          </span>
          <b>{o.probability}%</b>
          <small>±{o.ci}</small>
        </button>
      ))}
    </div>
  );
}

export default function WhatIfResult({ result, explanation, compact = false }) {
  const [picked, setPicked] = useState(null);
  const valid = picked && result.alternatives.some((a) => a.key === picked);
  const drawKey = valid ? picked : result.focus || result.best;
  const better = result.verdict === 'better_alternative';
  return (
    <div className={`wi-result ${compact ? 'compact' : ''}`}>
      <div className="wi-visual">
        <WhatIfPitch result={result} drawKey={drawKey} />
        <div className="wi-legend">
          <span><i className="lg solid" /> what happened</span>
          <span><i className="lg dash" /> tested option</span>
        </div>
      </div>
      <div className="wi-side">
        <div className={`wi-verdict ${better ? 'yes' : 'no'}`}>
          {better ? `Better option found: +${result.delta} points` : 'Shooting was a sound decision'}
        </div>
        <WhatIfBars result={result} drawKey={drawKey} onPick={setPicked} />
        <p className="wi-explain">{explanation}</p>
        <div className="wi-meta">
          {result.evidence.map((e) => <code key={e}>{e}</code>)}
          <code>{result.sims} simulations</code>
        </div>
        <p className="wi-note">{result.note}</p>
      </div>
    </div>
  );
}
