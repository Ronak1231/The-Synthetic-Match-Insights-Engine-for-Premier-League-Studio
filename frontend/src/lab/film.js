// Pure rendering code for the analytics film: plan building + canvas drawing (no React).
import { TEAMS } from '../engine/data';
import { createEngine, playerRating } from '../engine/engine';
import { narrate } from '../engine/narrator';
import { explainWhatIf, simulateWhatIf } from '../engine/whatif';
import { nameOf } from './analytics';

// Canvas layout (1280 x 720). The same drawing code feeds the preview and the recorder.
export const CW = 1280;
export const CH = 720;
const PX = 40;
const PY = 100;
const PW = 800;
const PH = Math.round((PW * 68) / 105);
const RX = 870;
const CLIP = 7.5;
const SECOND = 6;
const TITLE = 3.2;
const OUTRO = 3.5;
const CARD = 6.5;
export const LOCALE = { en: 'en-GB', hi: 'hi-IN', es: 'es-ES', ar: 'ar-SA', fr: 'fr-FR' };

const px = (x) => PX + (x / 100) * PW;
const py = (y) => PY + (y / 100) * PH;
const ease = (u) => u * u * (3 - 2 * u);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, x, y, maxW, lh, maxLines = 2) {
  const words = String(text).split(/\s+/);
  let line = '';
  let n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + n * lh);
      line = w;
      if (++n >= maxLines) return;
    } else line = test;
  }
  ctx.fillText(line, x, y + n * lh);
}

function drawPitch(ctx) {
  ctx.fillStyle = '#07151a';
  rrect(ctx, PX, PY, PW, PH, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(PX + 6, PY + 6, PW - 12, PH - 12);
  ctx.beginPath();
  ctx.moveTo(PX + PW / 2, PY + 6);
  ctx.lineTo(PX + PW / 2, PY + PH - 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(PX + PW / 2, PY + PH / 2, PH * 0.135, 0, Math.PI * 2);
  ctx.stroke();
  const bw = PW * 0.157;
  const bh = PH * 0.593;
  ctx.strokeRect(PX + 6, PY + (PH - bh) / 2, bw, bh);
  ctx.strokeRect(PX + PW - 6 - bw, PY + (PH - bh) / 2, bw, bh);
}

// Ball position along the clip's events, eased between consecutive points.
function ballPath(evs) {
  const pts = [];
  for (const e of evs) {
    if (e.from) pts.push({ t: e.t, x: e.from.x, y: e.from.y });
    if (e.to && (e.type === 'pass' || e.type === 'shot')) pts.push({ t: e.t + 1.2, x: e.to.x, y: e.to.y });
  }
  return pts.sort((a, b) => a.t - b.t);
}
function ballAt(pts, mt) {
  if (!pts.length) return { x: 50, y: 50 };
  if (mt <= pts[0].t) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (mt <= pts[i].t) {
      const a = pts[i - 1];
      const b = pts[i];
      const u = ease(clamp((mt - a.t) / Math.max(0.5, b.t - a.t), 0, 1));
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
  }
  return pts[pts.length - 1];
}

export const PRESETS = {
  short: { label: 'Short', moments: 3, hint: 'about 80 seconds' },
  standard: { label: 'Standard', moments: 5, hint: 'about 105 seconds, demo-safe' },
  extended: { label: 'Extended', moments: 9, hint: 'about 2 minutes 40' },
  full: { label: 'Full story', moments: 14, hint: 'about 3 to 4 minutes' },
};
export const DEFAULT_FILM = { preset: 'standard', secondGuess: true, cards: true, focus: 'all' };

const copyStats = (snap) => ({ team: JSON.parse(JSON.stringify(snap.team)), possPct: { ...snap.possPct }, score: { ...snap.score } });

// One pass over the match capturing team stats at the moments the film needs.
function statsAtTimes(events, times) {
  const want = [...new Set(times)].sort((a, b) => a - b);
  const out = {};
  const eng = createEngine();
  let i = 0;
  for (const ev of events) {
    while (i < want.length && ev.t > want[i]) out[want[i++]] = copyStats(eng.snapshot());
    eng.ingest(ev);
  }
  const final = eng.snapshot();
  while (i < want.length) out[want[i++]] = copyStats(final);
  out.final = { ...copyStats(final), players: JSON.parse(JSON.stringify(final.players)) };
  return out;
}

const matchesFocus = (ins, focus) => {
  if (focus === 'all') return true;
  if (focus === 'home' || focus === 'away') return ins.team === focus;
  const [team, n] = focus.split(':');
  return ins.team === team && (String(ins.player) === n || ins.player === null);
};

export function buildFilmPlan(events, lang, mode, options = DEFAULT_FILM) {
  const opt = { ...DEFAULT_FILM, ...options };
  const eng = createEngine();
  const picks = [];
  const floor = opt.preset === 'short' || opt.preset === 'standard' ? 0.7 : 0.5;
  for (const ev of events) for (const ins of eng.ingest(ev)) if (ins.importance >= floor && matchesFocus(ins, opt.focus)) picks.push(ins);
  const n = PRESETS[opt.preset]?.moments ?? 6;
  const top = picks.sort((a, b) => b.importance - a.importance || a.t - b.t).slice(0, n).sort((a, b) => a.t - b.t);
  const goals = events.filter((e) => e.type === 'goal');
  const shotsAll = events.filter((e) => e.type === 'shot');
  const stats = statsAtTimes(events, [...top.map((i) => i.t), 2700, 5400]);

  const segs = [{ kind: 'title', dur: TITLE }];
  let halftimeDone = !opt.cards;
  const halftime = () => { segs.push({ kind: 'stats', dur: CARD, at: 2700, title: 'HALF-TIME STATS', stats: stats[2700] }); halftimeDone = true; };
  for (const ins of top) {
    if (!halftimeDone && ins.t > 2700) halftime();
    const shot = ins.kind === 'big_chance' ? shotsAll.find((s) => s.id === ins.eventId) : ins.kind === 'goal' ? [...shotsAll].reverse().find((s) => s.id < ins.eventId && s.team === ins.team) : null;
    const t0 = Math.max(0, ins.t - 24);
    const t1 = ins.t + 4;
    const evs = events.filter((e) => e.t >= t0 - 6 && e.t <= t1);
    const nar = narrate(ins, { lang, mode: mode === 'analyst' ? 'analyst' : 'casual' });
    segs.push({ kind: 'clip', dur: CLIP, t0, t1, ins, evs, path: ballPath(evs), head: nar.headline, why: nar.why || nar.metrics || '', st: stats[ins.t] });
    if (shot && opt.secondGuess) {
      const result = simulateWhatIf(events, shot.id);
      segs.push({ kind: 'second', dur: SECOND, ins, shot, result, text: explainWhatIf(result) });
    }
  }
  if (opt.cards) {
    if (!halftimeDone) halftime();
    segs.push({ kind: 'xgrace', dur: CARD, title: 'EXPECTED GOALS RACE' });
    segs.push({ kind: 'shotmap', dur: CARD, title: 'EVERY SHOT' });
    const players = Object.values(stats.final.players)
      .map((p) => ({ ...p, rating: playerRating(p) }))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3);
    segs.push({ kind: 'motm', dur: CARD, title: 'TOP PERFORMERS', players });
    segs.push({ kind: 'stats', dur: CARD, at: 5400, title: 'FULL-TIME STATS', stats: stats.final });
  }
  segs.push({ kind: 'outro', dur: OUTRO });
  const total = segs.reduce((sum, x) => sum + x.dur, 0);
  let acc = 0;
  for (const sg of segs) { sg.start = acc; acc += sg.dur; }
  return { segs, total, goals, shotsAll };
}

function scoreAt(goals, t) {
  const s = { home: 0, away: 0 };
  for (const g of goals) if (g.t <= t) s[g.team] += 1;
  return s;
}
function xgAt(shots, t) {
  const x = { home: 0, away: 0 };
  for (const s of shots) if (s.t <= t) x[s.team] += s.xg;
  return x;
}


function drawBars(ctx, rows, x, y, w, u) {
  rows.forEach((r, i) => {
    const yy = y + i * 58;
    const tot = (r.h + r.a) || 1;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8b94ab';
    ctx.font = '600 16px "JetBrains Mono", monospace';
    ctx.fillText(r.label.toUpperCase(), x + w / 2, yy);
    ctx.textAlign = 'left';
    ctx.fillStyle = TEAMS.home.color;
    ctx.font = '700 26px "DM Sans", system-ui, sans-serif';
    ctx.fillText(r.fh, x, yy + 32);
    ctx.textAlign = 'right';
    ctx.fillStyle = TEAMS.away.color;
    ctx.fillText(r.fa, x + w, yy + 32);
    const bw = w - 150;
    const bx = x + 75;
    const e = ease(clamp(u * 2 - i * 0.08, 0, 1));
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    rrect(ctx, bx, yy + 14, bw, 14, 7);
    ctx.fill();
    ctx.fillStyle = TEAMS.home.color;
    rrect(ctx, bx, yy + 14, Math.max(6, (bw * (r.h / tot)) * e), 14, 7);
    ctx.fill();
    ctx.fillStyle = TEAMS.away.color;
    const aw = Math.max(6, (bw * (r.a / tot)) * e);
    rrect(ctx, bx + bw - aw, yy + 14, aw, 14, 7);
    ctx.fill();
  });
}

function drawCard(ctx, seg, u, plan) {
  const accent = '#8b5cf6';
  ctx.textAlign = 'left';
  ctx.font = '700 34px "Bricolage Grotesque", system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(seg.title, 40, 62);
  ctx.textAlign = 'right';
  ctx.fillStyle = accent;
  ctx.font = '600 20px "JetBrains Mono", monospace';
  ctx.fillText('◆ ANALYTICS', CW - 40, 60);
  ctx.fillStyle = 'rgba(255,255,255,.04)';
  rrect(ctx, 40, 96, CW - 80, 600, 18);
  ctx.fill();

  if (seg.kind === 'stats') {
    const T = seg.stats.team;
    const acc = (t) => (T[t].passes ? Math.round((T[t].passesOk / T[t].passes) * 100) : 0);
    const rows = [
      { label: 'Possession', h: seg.stats.possPct.home, a: seg.stats.possPct.away, fh: `${seg.stats.possPct.home}%`, fa: `${seg.stats.possPct.away}%` },
      { label: 'Shots', h: T.home.shots, a: T.away.shots, fh: T.home.shots, fa: T.away.shots },
      { label: 'On target', h: T.home.onTarget, a: T.away.onTarget, fh: T.home.onTarget, fa: T.away.onTarget },
      { label: 'Expected goals', h: T.home.xg, a: T.away.xg, fh: T.home.xg.toFixed(2), fa: T.away.xg.toFixed(2) },
      { label: 'Pass accuracy', h: acc('home'), a: acc('away'), fh: `${acc('home')}%`, fa: `${acc('away')}%` },
      { label: 'Tackles', h: T.home.tackles, a: T.away.tackles, fh: T.home.tackles, fa: T.away.tackles },
      { label: 'Pressures', h: T.home.pressures, a: T.away.pressures, fh: T.home.pressures, fa: T.away.pressures },
    ];
    ctx.textAlign = 'left';
    ctx.fillStyle = TEAMS.home.color;
    ctx.font = '700 30px "Bricolage Grotesque", system-ui, sans-serif';
    ctx.fillText(TEAMS.home.name, 110, 150);
    ctx.textAlign = 'right';
    ctx.fillStyle = TEAMS.away.color;
    ctx.fillText(TEAMS.away.name, CW - 110, 150);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${seg.stats.score.home} – ${seg.stats.score.away}`, CW / 2, 150);
    drawBars(ctx, rows, 110, 190, CW - 220, u);
  } else if (seg.kind === 'xgrace') {
    const X0 = 110;
    const Y0 = 150;
    const w = CW - 220;
    const h = 480;
    const max = Math.max(1, ...plan.shotsAll.map(() => 0), xgAt(plan.shotsAll, 5400).home, xgAt(plan.shotsAll, 5400).away) * 1.1;
    ctx.strokeStyle = 'rgba(255,255,255,.1)';
    ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const y = Y0 + h - (k / 4) * h;
      ctx.beginPath(); ctx.moveTo(X0, y); ctx.lineTo(X0 + w, y); ctx.stroke();
      ctx.fillStyle = '#8b94ab'; ctx.textAlign = 'right'; ctx.font = '14px "JetBrains Mono", monospace';
      ctx.fillText(((k / 4) * max).toFixed(1), X0 - 10, y + 5);
    }
    const reveal = ease(clamp(u * 1.4, 0, 1)) * 5400;
    for (const team of ['home', 'away']) {
      ctx.strokeStyle = TEAMS[team].color; ctx.lineWidth = 4; ctx.beginPath();
      let first = true;
      for (let t = 0; t <= reveal; t += 30) {
        const x = X0 + (t / 5400) * w;
        const y = Y0 + h - (xgAt(plan.shotsAll, t)[team] / max) * h;
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (const g of plan.goals) {
      if (g.t > reveal) continue;
      const x = X0 + (g.t / 5400) * w;
      const y = Y0 + h - (xgAt(plan.shotsAll, g.t)[g.team] / max) * h;
      ctx.fillStyle = '#05070d'; ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.fillStyle = '#8b94ab'; ctx.font = '14px "JetBrains Mono", monospace';
    [0, 15, 30, 45, 60, 75, 90].forEach((m) => ctx.fillText(`${m}'`, X0 + (m / 90) * w, Y0 + h + 26));
    ctx.textAlign = 'left'; ctx.fillStyle = '#b6bfd4'; ctx.font = '400 18px "DM Sans", system-ui, sans-serif';
    ctx.fillText('Gold rings are goals. Higher means more chance quality created.', X0, 118);
  } else if (seg.kind === 'shotmap') {
    const shots = plan.shotsAll;
    const mx = 120;
    const mw = CW - 240;
    const mh = Math.round((mw * 68) / 105);
    const sx0 = mx;
    const sy0 = 110;
    ctx.fillStyle = '#07151a'; rrect(ctx, sx0, sy0, mw, Math.min(mh, 560), 12); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2;
    const H2 = Math.min(mh, 560);
    ctx.strokeRect(sx0 + 6, sy0 + 6, mw - 12, H2 - 12);
    ctx.beginPath(); ctx.moveTo(sx0 + mw / 2, sy0 + 6); ctx.lineTo(sx0 + mw / 2, sy0 + H2 - 6); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx0 + mw / 2, sy0 + H2 / 2, H2 * 0.135, 0, Math.PI * 2); ctx.stroke();
    const shown = Math.floor(ease(clamp(u * 1.3, 0, 1)) * shots.length);
    shots.slice(0, shown).forEach((s) => {
      const x = sx0 + (s.from.x / 100) * mw;
      const y = sy0 + (s.from.y / 100) * H2;
      const r = 6 + s.xg * 46;
      ctx.globalAlpha = s.outcome === 'goal' ? 1 : 0.6;
      ctx.fillStyle = TEAMS[s.team].color;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      if (s.outcome === 'off_target' || s.outcome === 'blocked') { ctx.strokeStyle = TEAMS[s.team].color; ctx.lineWidth = 3; ctx.stroke(); } else ctx.fill();
      if (s.outcome === 'goal') { ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 4; ctx.stroke(); }
      ctx.globalAlpha = 1;
    });
    ctx.textAlign = 'left'; ctx.fillStyle = '#b6bfd4'; ctx.font = '400 17px "DM Sans", system-ui, sans-serif';
    ctx.fillText('Circle size = chance quality (xG) · filled = on target · outline = off target or blocked · gold ring = goal', 120, 100 + H2 + 40);
  } else if (seg.kind === 'motm') {
    seg.players.forEach((p, i) => {
      const y = 150 + i * 160;
      const e = ease(clamp(u * 2 - i * 0.25, 0, 1));
      ctx.globalAlpha = e;
      ctx.fillStyle = 'rgba(255,255,255,.05)'; rrect(ctx, 110, y, CW - 220, 130, 16); ctx.fill();
      ctx.fillStyle = TEAMS[p.team].color; ctx.fillRect(110, y, 8, 130);
      ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = '700 34px "Bricolage Grotesque", system-ui, sans-serif';
      ctx.fillText(`${i + 1}. ${nameOf(p.team, p.n)}`, 150, y + 52);
      ctx.fillStyle = '#b6bfd4'; ctx.font = '400 20px "DM Sans", system-ui, sans-serif';
      ctx.fillText(`${TEAMS[p.team].name} · ${p.goals} goals · ${p.shots} shots (${p.xg.toFixed(2)} xG) · ${p.passes} passes · ${p.tackles} tackles`, 150, y + 92);
      ctx.textAlign = 'right'; ctx.fillStyle = '#fbbf24'; ctx.font = '700 54px "Bricolage Grotesque", system-ui, sans-serif';
      ctx.fillText(p.rating.toFixed(1), CW - 150, y + 82);
      ctx.globalAlpha = 1;
    });
  }
}

export function drawFrame(ctx, plan, T, lang) {
  const rtl = lang === 'ar';
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, CW, CH);
  const seg = plan.segs.find((s) => T >= s.start && T < s.start + s.dur) || plan.segs[plan.segs.length - 1];
  const u = clamp((T - seg.start) / seg.dur, 0, 1);
  ctx.textBaseline = 'alphabetic';
  ctx.direction = rtl ? 'rtl' : 'ltr';

  if (seg.kind === 'title' || seg.kind === 'outro') {
    const g = ctx.createRadialGradient(CW / 2, CH / 2, 40, CW / 2, CH / 2, 640);
    g.addColorStop(0, 'rgba(56,248,199,.18)');
    g.addColorStop(1, 'rgba(5,7,13,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CW, CH);
    ctx.globalAlpha = clamp(u * 4, 0, 1) * clamp((1 - u) * 6, 0, 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#38f8c7';
    ctx.font = '600 20px "JetBrains Mono", monospace';
    ctx.fillText(seg.kind === 'title' ? 'SYNTHETIC MATCH · ANALYTICS FILM' : 'ALL CLUBS, PLAYERS AND DATA ARE FICTIONAL', CW / 2, 300);
    ctx.fillStyle = '#e9edf7';
    ctx.font = '700 64px "Bricolage Grotesque", system-ui, sans-serif';
    ctx.fillText(seg.kind === 'title' ? `${TEAMS.home.name} vs ${TEAMS.away.name}` : 'Second Guess', CW / 2, 385);
    ctx.fillStyle = '#8b94ab';
    ctx.font = '400 26px "DM Sans", system-ui, sans-serif';
    ctx.fillText(seg.kind === 'title' ? 'The key moments, and what could have happened instead' : 'Every “what if” is a simulation estimate, not a fact', CW / 2, 438);
    ctx.globalAlpha = 1;
    return;
  }

  if (seg.kind === 'stats' || seg.kind === 'xgrace' || seg.kind === 'shotmap' || seg.kind === 'motm') {
    drawCard(ctx, seg, u, plan);
    return;
  }
  const clip = seg.kind === 'clip';
  const mt = clip ? seg.t0 + (seg.t1 - seg.t0) * u : seg.ins.t;
  const score = scoreAt(plan.goals, mt);
  const xg = xgAt(plan.shotsAll, mt);

  // scoreboard
  ctx.textAlign = 'left';
  ctx.font = '700 34px "Bricolage Grotesque", system-ui, sans-serif';
  ctx.fillStyle = TEAMS.home.color;
  ctx.fillText(TEAMS.home.short, 40, 62);
  ctx.fillStyle = '#fff';
  ctx.fillText(`${score.home} – ${score.away}`, 130, 62);
  ctx.fillStyle = TEAMS.away.color;
  ctx.fillText(TEAMS.away.short, 250, 62);
  ctx.fillStyle = '#8b94ab';
  ctx.font = '500 22px "JetBrains Mono", monospace';
  const m = Math.floor(mt / 60);
  const s = Math.floor(mt % 60);
  ctx.fillText(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`, 350, 60);
  ctx.textAlign = 'right';
  ctx.fillStyle = clip ? '#ff5d8f' : '#fbbf24';
  ctx.fillText(clip ? '● KEY MOMENT' : '◆ SECOND GUESS', CW - 40, 60);

  drawPitch(ctx);

  if (clip) {
    const evs = seg.evs.filter((e) => e.t <= mt);
    const trail = evs.filter((e) => e.from && e.to && (e.type === 'pass' || e.type === 'shot')).slice(-7);
    trail.forEach((e, i) => {
      const age = (i + 1) / trail.length;
      ctx.globalAlpha = 0.2 + age * 0.7;
      ctx.strokeStyle = e.type === 'shot' ? '#fbbf24' : TEAMS[e.team].color;
      ctx.lineWidth = e.type === 'shot' ? 5 : 2.5;
      if (e.type === 'pass' && !e.success) ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(px(e.from.x), py(e.from.y));
      ctx.lineTo(px(e.to.x), py(e.to.y));
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.globalAlpha = 1;
    const b = ballAt(seg.path, mt);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(px(b.x), py(b.y), 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    const last = [...evs].reverse().find((e) => e.player && e.from && ['pass', 'shot', 'tackle', 'sprint'].includes(e.type));
    if (last) {
      const name = nameOf(last.team, last.player);
      ctx.font = '600 20px "DM Sans", system-ui, sans-serif';
      const w = ctx.measureText(name).width + 24;
      const tx = clamp(px(last.from.x) - w / 2, PX + 8, PX + PW - w - 8);
      const ty = clamp(py(last.from.y) - 52, PY + 8, PY + PH - 40);
      ctx.fillStyle = 'rgba(5,7,13,.85)';
      rrect(ctx, tx, ty, w, 32, 8);
      ctx.fill();
      ctx.strokeStyle = TEAMS[last.team].color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(name, tx + 12, ty + 22);
    }
    if (seg.ins.kind === 'goal' && u > 0.78) {
      ctx.fillStyle = `rgba(251,191,36,${0.35 * Math.sin(((u - 0.78) / 0.22) * Math.PI)})`;
      ctx.fillRect(PX, PY, PW, PH);
    }
  } else {
    // dim the pitch and show what happened vs the best alternative
    ctx.fillStyle = 'rgba(5,7,13,.45)';
    ctx.fillRect(PX, PY, PW, PH);
    const r = seg.result;
    const col = TEAMS[r.team].color;
    const draw = clamp(u * 2.2, 0, 1);
    const alt = r.alternatives.find((a) => a.key === r.best);
    const f = r.original.from;
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#fbbf24';
    ctx.beginPath();
    ctx.moveTo(px(f.x), py(f.y));
    ctx.lineTo(px(r.original.to.x), py(r.original.to.y));
    ctx.stroke();
    if (alt) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 5;
      ctx.setLineDash([16, 12]);
      ctx.beginPath();
      ctx.moveTo(px(f.x), py(f.y));
      ctx.lineTo(px(f.x + (alt.to.x - f.x) * draw), py(f.y + (alt.to.y - f.y) * draw));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(px(alt.to.x), py(alt.to.y), 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(px(f.x), py(f.y), 13, 0, Math.PI * 2);
    ctx.fill();
  }

  // right panel: xG race, then the second-guess bars
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,.04)';
  rrect(ctx, RX, PY, 370, PH, 16);
  ctx.fill();
  ctx.fillStyle = '#8b94ab';
  ctx.font = '600 15px "JetBrains Mono", monospace';
  if (clip) {
    ctx.fillText('EXPECTED GOALS SO FAR', RX + 22, PY + 36);
    const mx = Math.max(1, xg.home, xg.away) * 1.05;
    ['home', 'away'].forEach((t, i) => {
      const y = PY + 70 + i * 70;
      ctx.fillStyle = TEAMS[t].color;
      ctx.font = '700 22px "DM Sans", system-ui, sans-serif';
      ctx.fillText(`${TEAMS[t].short}  ${xg[t].toFixed(2)}`, RX + 22, y);
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      rrect(ctx, RX + 22, y + 12, 326, 14, 7);
      ctx.fill();
      ctx.fillStyle = TEAMS[t].color;
      rrect(ctx, RX + 22, y + 12, Math.max(8, 326 * (xg[t] / mx)), 14, 7);
      ctx.fill();
    });
    const T = seg.st.team;
    const acc = (t) => (T[t].passes ? Math.round((T[t].passesOk / T[t].passes) * 100) : 0);
    ctx.fillStyle = '#8b94ab';
    ctx.font = '600 15px "JetBrains Mono", monospace';
    ctx.fillText('MATCH STATS', RX + 22, PY + 262);
    [['Possession', `${seg.st.possPct.home}%`, `${seg.st.possPct.away}%`], ['Shots', T.home.shots, T.away.shots], ['On target', T.home.onTarget, T.away.onTarget],
      ['Pass accuracy', `${acc('home')}%`, `${acc('away')}%`], ['Pressures', T.home.pressures, T.away.pressures]].forEach((row, i) => {
      const y = PY + 296 + i * 34;
      ctx.font = '700 20px "DM Sans", system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.fillStyle = TEAMS.home.color; ctx.fillText(String(row[1]), RX + 22, y);
      ctx.textAlign = 'right'; ctx.fillStyle = TEAMS.away.color; ctx.fillText(String(row[2]), RX + 348, y);
      ctx.textAlign = 'center'; ctx.fillStyle = '#8b94ab'; ctx.font = '400 16px "DM Sans", system-ui, sans-serif'; ctx.fillText(row[0], RX + 185, y);
    });
    ctx.textAlign = 'left';
  } else {
    const r = seg.result;
    ctx.fillText('WHAT COULD HAVE HAPPENED', RX + 22, PY + 36);
    const opts = [r.baseline, ...r.alternatives.slice(0, 3)];
    const mx = Math.max(...opts.map((o) => o.probability)) * 1.1;
    opts.forEach((o, i) => {
      const y = PY + 78 + i * 76;
      const isBest = o.key === r.best && r.verdict === 'better_alternative';
      ctx.fillStyle = o.key === 'shoot' ? '#fbbf24' : isBest ? TEAMS[r.team].color : '#b6bfd4';
      ctx.font = '600 17px "DM Sans", system-ui, sans-serif';
      ctx.fillText(o.label.length > 34 ? `${o.label.slice(0, 33)}…` : o.label, RX + 22, y);
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      rrect(ctx, RX + 22, y + 10, 270, 16, 8);
      ctx.fill();
      ctx.fillStyle = o.key === 'shoot' ? '#fbbf24' : TEAMS[r.team].color;
      rrect(ctx, RX + 22, y + 10, Math.max(8, 270 * ease(clamp(u * 2, 0, 1)) * (o.probability / mx)), 16, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 20px "DM Sans", system-ui, sans-serif';
      ctx.fillText(`${o.probability}%`, RX + 302, y + 26);
    });
    ctx.fillStyle = '#8b94ab';
    ctx.font = '400 15px "DM Sans", system-ui, sans-serif';
    wrap(ctx, `${r.sims} simulations · estimate, not a fact`, RX + 22, PY + PH - 24, 326, 20, 1);
  }

  // lower third
  const accent = TEAMS[seg.ins.team].color;
  ctx.globalAlpha = clamp(u * 8, 0, 1);
  ctx.fillStyle = 'rgba(5,7,13,.92)';
  rrect(ctx, 40, 632, CW - 80, 74, 14);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(rtl ? CW - 46 : 40, 632, 6, 74);
  ctx.textAlign = rtl ? 'right' : 'left';
  const tx = rtl ? CW - 66 : 66;
  ctx.fillStyle = '#fff';
  ctx.font = '700 26px "Bricolage Grotesque", "Noto Sans Devanagari", "Noto Sans Arabic", system-ui, sans-serif';
  ctx.fillText(clip ? seg.head : `What if ${nameOf(seg.shot.team, seg.shot.player)} had chosen differently?`, tx, 665, CW - 140);
  ctx.fillStyle = '#b6bfd4';
  ctx.font = '400 17px "DM Sans", "Noto Sans Devanagari", "Noto Sans Arabic", system-ui, sans-serif';
  const sub = clip ? seg.why : seg.text;
  wrap(ctx, sub, tx, 692, CW - 140, 20, 1);
  ctx.globalAlpha = 1;
}

