// Second Guess: counterfactual "what if" simulation. JS twin of backend/app/domain/whatif.py.
// Keep both in step: backend/scripts/parity_check.sh compares their output on several seeds.
//
// Estimates only: a seeded Monte Carlo over a small, explicit model of the synthetic match.
// Team-mates are placed from formation slots; attackers push forward as the ball does.
import { TEAMS } from './data';
import { mulberry32 } from './simulator';

export const N_SIMS = 2000;
const BALL_PULL = 0.35;
const RUN_FORWARD = 0.5;
const RECEIVER_PRESSURE = 0.6;
const CARRY_GAIN = 9.0;
const ATTACKERS = ['ST', 'AM', 'RW', 'LW', 'CM'];
export const MODEL_NOTE =
  'Estimate from a simple Monte Carlo model of the synthetic match, not a measurement. Team-mates are placed from formation slots; attackers push forward as the ball does.';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const jsRound = (x) => Math.floor(x + 0.5);
const toFixed = (x, d) => Number(x.toFixed(d));
const attackProgress = (team, x) => (team === 'home' ? x : 100 - x);
const playerName = (team, n) => TEAMS[team].players.find((p) => p.n === n)?.name ?? `#${n}`;
const signed = (x) => (x >= 0 ? '+' : '') + String(x);

export function shotXg(progress, y, pressure) {
  const dx = (100 - progress) * 1.05;
  const dy = (y - 50) * 0.68;
  const d = Math.hypot(dx, dy);
  return clamp(0.52 * Math.exp(-d / 13) * (1 - pressure * 0.35), 0.01, 0.62);
}

export function inferPressure(ev) {
  const prog = attackProgress(ev.team, ev.from.x);
  const clean = shotXg(prog, ev.from.y, 0);
  const raw = clean > 0 ? (1 - ev.xg / clean) / 0.35 : 0;
  return clamp(raw, 0, 1);
}

const passDifficulty = (dist, forward, pressure) => clamp(0.12 + (dist / 60) * 0.4 + (Math.max(0, forward) / 100) * 0.6 + pressure * 0.28, 0, 1);
const passSuccessProb = (difficulty) => clamp(0.95 - difficulty * 0.6, 0.2, 0.97);

function teammates(team, shooter, ball) {
  const ballProg = attackProgress(team, ball.x);
  const out = [];
  for (const p of TEAMS[team].players) {
    if (p.pos === 'GK' || p.n === shooter) continue;
    const slot = attackProgress(team, p.x);
    let prog = slot;
    if (ATTACKERS.includes(p.pos) && ballProg > 50) prog = Math.min(94.0, slot + (ballProg - 50) * RUN_FORWARD);
    const x = team === 'home' ? prog : 100 - prog;
    const y = p.y + (ball.y - p.y) * BALL_PULL;
    out.push({ n: p.n, name: p.name, pos: p.pos, x: toFixed(x, 1), y: toFixed(y, 1) });
  }
  return out;
}

function expectedAlternatives(ev) {
  const { team, from: frm } = ev;
  const prog = attackProgress(team, frm.x);
  const y = frm.y;
  const pressure = inferPressure(ev);
  const base = shotXg(prog, y, pressure);
  const cOk = clamp(0.62 - pressure * 0.35, 0.2, 0.8);
  let best = cOk * shotXg(Math.min(97.0, prog + CARRY_GAIN), y + (50 - y) * 0.25, clamp(pressure * 0.9, 0, 1));
  for (const m of teammates(team, ev.player, { x: frm.x, y: frm.y })) {
    const mProg = attackProgress(team, m.x);
    if (mProg < 55) continue;
    const dist = Math.hypot((m.x - frm.x) * 1.05, (m.y - y) * 0.68);
    const ok = passSuccessProb(passDifficulty(dist, mProg - prog, pressure));
    best = Math.max(best, ok * shotXg(mProg, m.y, pressure * RECEIVER_PRESSURE));
  }
  return [base, best];
}

function mc(rng, n, trial) {
  let hits = 0;
  for (let i = 0; i < n; i++) if (trial(rng)) hits++;
  const p = hits / n;
  return [p, 1.96 * Math.sqrt(Math.max(p * (1 - p), 1e-9) / n)];
}

const shotTrial = (progress, y, pressure) => (rng) => {
  const pr = clamp(pressure + (rng() - 0.5) * 0.3, 0, 1);
  return rng() < shotXg(progress, y + (rng() - 0.5) * 6, pr);
};

const pct = (p) => toFixed(p * 100, 1);

export function listMoments(events, upTo = null) {
  const out = [];
  for (const ev of events) {
    if (ev.type !== 'shot' || (upTo !== null && ev.t > upTo)) continue;
    const [base, best] = expectedAlternatives(ev);
    out.push({
      eventId: ev.id, t: ev.t, minute: ev.minute, team: ev.team, player: ev.player, xg: ev.xg, outcome: ev.outcome,
      headroom: toFixed((best - base) * 100, 1),
    });
  }
  return out.sort((a, b) => b.headroom - a.headroom || a.t - b.t);
}

export function simulateWhatIf(events, eventId, { n = N_SIMS, seed = null, include = null } = {}) {
  const ev = events.find((e) => e.id === eventId);
  if (!ev) throw new Error(`no event with id ${eventId}`);
  if (ev.type !== 'shot') throw new Error("what-if supports shots (event type 'shot')");
  n = Math.trunc(clamp(n, 200, 20000));
  const rng = mulberry32((seed ?? eventId) * 7919 + 17);

  const { team, player: shooter, from: frm } = ev;
  const prog = attackProgress(team, frm.x);
  const y = frm.y;
  const pressure = inferPressure(ev);
  const mates = teammates(team, shooter, { x: frm.x, y: frm.y });

  const [pBase, ciBase] = mc(rng, n, shotTrial(prog, y, pressure));
  const baseline = { key: 'shoot', label: 'Shoot (what happened)', probability: pct(pBase), ci: pct(ciBase), kind: 'shoot', to: { x: ev.to.x, y: ev.to.y } };
  const alts = [];

  const cProg = Math.min(97.0, prog + CARRY_GAIN);
  const cOk = clamp(0.62 - pressure * 0.35, 0.2, 0.8);
  const carryTrial = (r) => {
    if (r() >= cOk) return false;
    return shotTrial(cProg, y + (50 - y) * 0.25, clamp(pressure * 0.9, 0, 1))(r);
  };
  let [p, ci] = mc(rng, n, carryTrial);
  alts.push({
    key: 'carry', label: 'Carry the ball closer, then shoot', probability: pct(p), ci: pct(ci), kind: 'carry',
    to: { x: frm.x + (team === 'home' ? CARRY_GAIN : -CARRY_GAIN), y }, note: `${jsRound(cOk * 100)}% to keep the ball while carrying`,
  });

  for (const m of mates) {
    const mProg = attackProgress(team, m.x);
    if (mProg < 55) continue;
    const dist = Math.hypot((m.x - frm.x) * 1.05, (m.y - y) * 0.68);
    const diff = passDifficulty(dist, mProg - prog, pressure);
    const ok = passSuccessProb(diff);
    const rPress = pressure * RECEIVER_PRESSURE;
    const passTrial = (r) => r() < ok && shotTrial(mProg, m.y, rPress)(r);
    [p, ci] = mc(rng, n, passTrial);
    alts.push({
      key: `pass:${m.n}`, label: `Pass to ${m.name}`, probability: pct(p), ci: pct(ci), kind: 'pass', to: { x: m.x, y: m.y },
      player: m.n, note: `${jsRound(ok * 100)}% pass completion, then a shot under lighter pressure`,
    });
  }

  alts.sort((a, b) => b.probability - a.probability);
  let focus = null;
  if (include) {
    const want = include !== 'pass' ? alts.find((a) => a.key === include) : alts.find((a) => a.kind === 'pass');
    focus = want ? want.key : null;
  }
  const best = alts[0] ?? null;
  const top = alts.slice(0, 4);
  if (focus && !top.some((a) => a.key === focus)) top.push(alts.find((a) => a.key === focus));
  const delta = best ? toFixed(best.probability - baseline.probability, 1) : 0;
  const clear = !!best && best.probability - best.ci > baseline.probability + baseline.ci;

  return {
    eventId, minute: ev.minute, t: ev.t, team, player: shooter,
    original: { type: 'shot', xg: ev.xg, outcome: ev.outcome, from: frm, to: ev.to, pressureEstimate: toFixed(pressure, 2) },
    baseline, alternatives: top, best: best ? best.key : null, delta, verdict: clear ? 'better_alternative' : 'decision_was_sound',
    focus, requested: include ?? null, sims: n, unit: '% chance of scoring',
    evidence: [`event #${eventId}`, `minute ${ev.minute}`, `logged xG ${ev.xg}`, `estimated pressure ${toFixed(pressure, 2)}`],
    note: MODEL_NOTE,
  };
}

export function explainWhatIf(result) {
  const who = playerName(result.team, result.player);
  const base = result.baseline;
  const alts = Object.fromEntries(result.alternatives.map((a) => [a.key, a]));
  const best = alts[result.best];
  const focus = result.focus ? alts[result.focus] : undefined;
  const head = `In minute ${result.minute}, ${who}'s shot was ${base.probability}% to score.`;
  if (!best) return `${head} No realistic alternative was found.`;
  const parts = [head];
  const req = result.requested;
  if (req && !focus) {
    if (req.startsWith('pass:')) parts.push(`${playerName(result.team, Number(req.split(':')[1]))} was not in a realistic position to receive a pass there.`);
    else parts.push('No team-mate was in a realistic position to receive a pass there.');
  }
  if (focus) {
    const diff = toFixed(focus.probability - base.probability, 1);
    parts.push(`${focus.label}: ${focus.probability}% (${signed(diff)} points), ${focus.note}.`);
    if (focus.key !== best.key) parts.push(`The strongest option was ${best.label} at ${best.probability}%.`);
    return parts.join(' ');
  }
  if (result.verdict === 'better_alternative') {
    parts.push(`${best.label} raises that to ${best.probability}% (${signed(result.delta)} points): ${best.note}.`);
  } else if (best.probability + best.ci < base.probability - base.ci) {
    parts.push(`Even the best alternative (${best.label}) only reaches ${best.probability}%, so taking the shot was the right call.`);
  } else {
    parts.push(`The best alternative (${best.label}) comes out at ${best.probability}%, within the simulation's margin of error, so it was a close call.`);
  }
  return parts.join(' ');
}
