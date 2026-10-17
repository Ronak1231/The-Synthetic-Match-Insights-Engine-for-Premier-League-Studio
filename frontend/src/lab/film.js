// Pure rendering code for the analytics film: plan building + canvas drawing (no React).
import { TEAMS } from '../engine/data';
import { createEngine } from '../engine/engine';
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

export function buildFilmPlan(events, lang, mode) {
  {
    const eng = createEngine();
    const picks = [];
    for (const ev of events) for (const ins of eng.ingest(ev)) if (ins.importance >= 0.7) picks.push(ins);
    const top = picks.sort((a, b) => b.importance - a.importance || a.t - b.t).slice(0, 6).sort((a, b) => a.t - b.t);
    const goals = events.filter((e) => e.type === 'goal');
    const shotsAll = events.filter((e) => e.type === 'shot');
    const segs = [{ kind: 'title', dur: TITLE }];
    for (const ins of top) {
      const shot = ins.kind === 'big_chance' ? shotsAll.find((s) => s.id === ins.eventId) : ins.kind === 'goal' ? [...shotsAll].reverse().find((s) => s.id < ins.eventId && s.team === ins.team) : null;
      const t0 = Math.max(0, ins.t - 24);
      const t1 = ins.t + 4;
      const evs = events.filter((e) => e.t >= t0 - 6 && e.t <= t1);
      const n = narrate(ins, { lang, mode: mode === 'analyst' ? 'analyst' : 'casual' });
      segs.push({ kind: 'clip', dur: CLIP, t0, t1, ins, evs, path: ballPath(evs), head: n.headline, why: n.why || n.metrics || '' });
      if (shot) {
        const result = simulateWhatIf(events, shot.id);
        segs.push({ kind: 'second', dur: SECOND, ins, shot, result, text: explainWhatIf(result) });
      }
    }
    segs.push({ kind: 'outro', dur: OUTRO });
    const total = segs.reduce((s, x) => s + x.dur, 0);
    let acc = 0;
    for (const s of segs) { s.start = acc; acc += s.dur; }
    return { segs, total, goals, shotsAll };
  }
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
    ctx.fillStyle = '#8b94ab';
    ctx.font = '400 18px "DM Sans", system-ui, sans-serif';
    wrap(ctx, 'Computed from every shot so far. Switch the language and audience mode above to change the narration.', RX + 22, PY + 260, 326, 26, 5);
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

