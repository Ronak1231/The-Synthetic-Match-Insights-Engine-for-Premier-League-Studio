import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { TEAMS, allPlayers } from '../engine/data';
import { narrate, playerName } from '../engine/narrator';
import { usePrefs } from './prefs';

const W = 105;
const H = 68;
const sx = (x) => (x / 100) * W;
const sy = (y) => (y / 100) * H;

const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const PLAYERS = allPlayers();

function Markings() {
  const line = { fill: 'none', stroke: 'rgba(255,255,255,.28)', strokeWidth: 0.25 };
  return (
    <g>
      {Array.from({ length: 12 }).map((_, i) => (
        <rect key={i} x={(W / 12) * i} y={0} width={W / 12} height={H} fill={i % 2 ? 'rgba(255,255,255,.018)' : 'rgba(255,255,255,0)'} />
      ))}
      <rect x="0.4" y="0.4" width={W - 0.8} height={H - 0.8} {...line} />
      <line x1={W / 2} y1="0.4" x2={W / 2} y2={H - 0.4} {...line} />
      <circle cx={W / 2} cy={H / 2} r="9.15" {...line} />
      <circle cx={W / 2} cy={H / 2} r="0.5" fill="rgba(255,255,255,.4)" />
      <rect x="0.4" y="13.84" width="16.5" height="40.32" {...line} />
      <rect x="0.4" y="24.84" width="5.5" height="18.32" {...line} />
      <rect x={W - 16.9} y="13.84" width="16.5" height="40.32" {...line} />
      <rect x={W - 5.9} y="24.84" width="5.5" height="18.32" {...line} />
      <rect x="-1.2" y="30.34" width="1.6" height="7.32" {...line} />
      <rect x={W - 0.4} y="30.34" width="1.6" height="7.32" {...line} />
    </g>
  );
}

export default function Pitch({ snap, trail, latest, matchOver }) {
  const prefs = usePrefs();
  const { lang, mode, focus } = prefs;
  const ballRef = useRef(null);
  const lowerRef = useRef(null);
  const shownId = useRef(null);
  const hideTimer = useRef(null);

  const ball = snap.ball;
  const last = snap.lastEvent;

  // Lower-third animation (GSAP) when a new insight arrives.
  useEffect(() => {
    const el = lowerRef.current;
    if (!el || !latest || shownId.current === latest.id) return;
    shownId.current = latest.id;
    clearTimeout(hideTimer.current);
    gsap.killTweensOf(el);
    gsap.fromTo(el, { xPercent: -8, opacity: 0, filter: 'blur(6px)' }, { xPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.6, ease: 'power3.out' });
    hideTimer.current = setTimeout(() => {
      gsap.to(el, { xPercent: -6, opacity: 0, duration: 0.5, ease: 'power2.in' });
    }, 6500);
    return () => clearTimeout(hideTimer.current);
  }, [latest]);

  const n = latest ? narrate(latest, { lang, mode }) : null;
  const accent = latest ? TEAMS[latest.team].color : 'var(--home)';
  const goalBurst = [...trail].reverse().find((e) => e.type === 'shot' && e.outcome === 'goal');

  // name tag for last actor
  let tag = null;
  if (last && last.player && last.from && ['pass', 'shot', 'tackle', 'sprint'].includes(last.type)) {
    tag = {
      x: sx(last.from.x),
      y: sy(last.from.y),
      name: playerName(last.team, last.player),
      team: last.team,
      speed: last.type === 'sprint' ? last.speed : null,
      dist: last.type === 'sprint' ? last.distance : null,
    };
  }

  return (
    <div className="frame">
      <svg className="pitch" viewBox={`-2 -2 ${W + 4} ${H + 4}`} role="img" aria-label="Live pitch view with synthetic player positions and event trails">
        <defs>
          <radialGradient id="grass" cx="50%" cy="50%" r="75%">
            <stop offset="0%" stopColor="#0e2a26" />
            <stop offset="100%" stopColor="#07151a" />
          </radialGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="0.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect x="-2" y="-2" width={W + 4} height={H + 4} fill="url(#grass)" />
        <Markings />

        {/* event trails */}
        {trail.map((e, i) => {
          const age = (i + 1) / trail.length;
          const color = e.type === 'shot' ? '#fbbf24' : TEAMS[e.team].color;
          if (e.to && e.from) {
            return (
              <g key={e.id} opacity={0.15 + age * 0.75}>
                <line
                  className="trail-line"
                  x1={sx(e.from.x)}
                  y1={sy(e.from.y)}
                  x2={sx(e.to.x)}
                  y2={sy(e.to.y)}
                  stroke={e.type === 'pass' && !e.success ? '#ff4d4d' : color}
                  strokeWidth={e.type === 'shot' ? 0.55 : 0.3}
                  strokeDasharray={e.type === 'pass' && !e.success ? '0.8 0.8' : undefined}
                  filter={e.type === 'shot' ? 'url(#glow)' : undefined}
                />
                <circle cx={sx(e.to.x)} cy={sy(e.to.y)} r={e.type === 'shot' ? 0.9 : 0.5} fill={color} />
              </g>
            );
          }
          if (e.type === 'pressure' && e.from) {
            return <circle key={e.id} className="press-ring" cx={sx(e.from.x)} cy={sy(e.from.y)} r="2.6" fill="none" stroke={color} strokeWidth="0.25" opacity={0.2 + age * 0.5} />;
          }
          return null;
        })}

        {goalBurst && goalBurst.id === trail[trail.length - 1]?.id && (
          <circle key={goalBurst.id} className="goal-burst" cx={sx(goalBurst.to.x)} cy={sy(goalBurst.to.y)} r="2" fill="none" stroke="#fbbf24" strokeWidth="0.5" />
        )}

        {/* players */}
        {PLAYERS.map((p) => {
          const bx = ball.x;
          const by = ball.y;
          const pull = p.pos === 'GK' ? 0.02 : 0.14;
          const x = sx(p.x + (bx - p.x) * pull + (p.team === 'home' ? (bx - 50) * 0.08 : (bx - 50) * 0.08));
          const y = sy(p.y + (by - p.y) * pull);
          const isFocus = focus === `${p.team}:${p.n}`;
          const isActor = last && last.team === p.team && last.player === p.n;
          return (
            <g key={`${p.team}${p.n}`} className="pl" style={{ transform: `translate(${x}px, ${y}px)` }}>
              {(isFocus && mode === 'player') && <circle r="3.1" fill="none" stroke="#fff" strokeWidth="0.3" className="focus-ring" />}
              <circle r={isActor ? 2.2 : 1.75} fill={TEAMS[p.team].color} opacity={isActor ? 1 : 0.88} />
              <text className="pn" y="0.62" textAnchor="middle">
                {p.n}
              </text>
            </g>
          );
        })}

        {/* ball */}
        <g className="ball" ref={ballRef} style={{ transform: `translate(${sx(ball.x)}px, ${sy(ball.y)}px)` }}>
          <circle r="1" fill="#fff" filter="url(#glow)" />
        </g>

        {/* name tag + speed chip */}
        {tag && (
          <g className="tag" key={`${last.id}`} style={{ transform: `translate(${Math.min(Math.max(tag.x, 14), W - 14)}px, ${Math.max(tag.y - 5.4, 4)}px)` }}>
            <rect x="-12" y="-2.2" width="24" height="4.4" rx="1.2" fill="rgba(5,7,13,.82)" stroke={TEAMS[tag.team].color} strokeWidth="0.2" />
            <text y="0.9" textAnchor="middle" className="tag-t">
              {tag.name}
            </text>
            {tag.speed && (
              <g transform="translate(0,4.1)">
                <rect x="-11" y="-1.9" width="22" height="3.8" rx="1.2" fill="#fbbf24" />
                <text y="0.8" textAnchor="middle" className="tag-s">
                  {tag.speed} km/h · {tag.dist} m
                </text>
              </g>
            )}
          </g>
        )}
      </svg>

      {/* overlays: score bug, live badge, lower third */}
      <div className="bug">
        <span className="bug-team" style={{ '--c': TEAMS.home.color }}>
          {TEAMS.home.short}
        </span>
        <b className="bug-score">{snap.score.home}</b>
        <i>–</i>
        <b className="bug-score">{snap.score.away}</b>
        <span className="bug-team" style={{ '--c': TEAMS.away.color }}>
          {TEAMS.away.short}
        </span>
        <span className="bug-clock">{matchOver ? 'FT' : fmtClock(snap.clock)}</span>
      </div>
      <div className="live-badge">
        <span className="rec" /> {matchOver ? 'REPLAY' : 'LIVE · SYNTHETIC'}
      </div>

      <div className="lower" ref={lowerRef} style={{ '--accent': accent, opacity: 0 }} dir={LANG_DIR[lang]}>
        {latest && n && (
          <>
            <div className="lower-tag">
              {mode === 'broadcast' ? `${latest.kind.startsWith('milestone') ? 'player_tag' : 'lower_third'} · ${latest.t}s` : `${latest.minute}'`}
            </div>
            <div className="lower-head">{n.headline}</div>
            {(mode === 'casual' || mode === 'player') && n.why && <div className="lower-why">{n.why}</div>}
            {(mode === 'analyst' || mode === 'broadcast') && n.metrics && <div className="lower-metrics">{n.metrics}</div>}
          </>
        )}
      </div>
    </div>
  );
}

const LANG_DIR = { en: 'ltr', hi: 'ltr', es: 'ltr', fr: 'ltr', ar: 'rtl' };
