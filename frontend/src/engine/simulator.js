import { TEAMS } from './data';

// Deterministic PRNG so the demo match is repeatable.
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const other = (t) => (t === 'home' ? 'away' : 'home');
const toX = (team, progress) => (team === 'home' ? progress : 100 - progress);

// Share of territory/possession the home side "should" get at each match minute.
// Gives the synthetic match a story: home surge, away comeback pressure, late push.
function homeBias(min) {
  if (min < 12) return 0.5;
  if (min < 35) return 0.66;
  if (min < 46) return 0.5;
  if (min < 58) return 0.44;
  if (min < 80) return 0.32;
  return 0.56;
}

export function simulateMatch(seed = 40) {
  const rng = mulberry32(seed);
  const rand = (a, b) => a + rng() * (b - a);

  const events = [];
  let id = 0;
  let t = 0;
  let poss = 'home';
  let progress = 50; // 0..100 from the possessing team's own goal
  let y = 50;
  const score = { home: 0, away: 0 };
  let lastActor = null;

  const pickPlayer = (team, prog) => {
    const list = TEAMS[team].players;
    const weights = list.map((p) => {
      const pp = team === 'home' ? p.x : 100 - p.x;
      const w = Math.exp(-Math.abs(pp - prog) / 22) * (p.pos === 'GK' ? 0.15 : 1);
      return w;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < list.length; i++) {
      r -= weights[i];
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  };

  const push = (ev) => {
    const minute = Math.floor(t / 60) + 1;
    events.push({ id: ++id, t: Math.round(t), minute, ...ev });
  };

  events.push({ id: ++id, t: 0, minute: 1, type: 'kickoff', team: 'home' });

  while (t < 5400) {
    const minute = Math.floor(t / 60) + 1;
    const bias = homeBias(minute);
    const ownShare = poss === 'home' ? bias : 1 - bias;
    const defender = other(poss);
    const actor = pickPlayer(poss, progress);

    // Pressure by defender: higher when the defender has momentum.
    const pressure = clamp(rand(0, 1) * (1.15 - ownShare) + (progress > 65 ? 0.12 : 0), 0, 1);
    if (rng() < 0.16 + (1 - ownShare) * 0.2) {
      const presser = pickPlayer(defender, 100 - progress);
      push({
        type: 'pressure',
        team: defender,
        player: presser.n,
        target: actor.n,
        level: +pressure.toFixed(2),
        from: { x: toX(defender, 100 - progress), y },
      });
    }

    const roll = rng();

    // Rare sprint indicator events
    if (roll < 0.03) {
      const speed = +rand(29, 36.5).toFixed(1);
      push({
        type: 'sprint',
        team: poss,
        player: actor.n,
        speed,
        distance: Math.round(rand(18, 55)),
        from: { x: toX(poss, progress), y },
      });
    }

    // Fouls and cards
    if (roll > 0.985) {
      const fouler = pickPlayer(defender, 100 - progress);
      push({
        type: 'foul',
        team: defender,
        player: fouler.n,
        from: { x: toX(poss, progress), y },
      });
      if (rng() < 0.18) {
        push({ type: 'card', team: defender, player: fouler.n, card: 'yellow', from: { x: toX(poss, progress), y } });
      }
      t += rand(14, 24);
      continue;
    }

    // Shot
    const shotProb = progress > 72 ? 0.09 + (progress - 72) / 170 : progress > 60 ? 0.04 : 0.003;
    if (rng() < shotProb) {
      const dx = (100 - progress) * 1.05;
      const dy = (y - 50) * 0.68;
      const d = Math.hypot(dx, dy);
      const xg = +clamp(0.52 * Math.exp(-d / 13) * (1 - pressure * 0.35), 0.01, 0.62).toFixed(2);
      const speed = Math.round(rand(72, 124));
      const r = rng();
      let outcome = 'blocked';
      if (r < xg) outcome = 'goal';
      else if (r < xg + 0.34) outcome = 'saved';
      else if (r < xg + 0.64) outcome = 'off_target';
      push({
        type: 'shot',
        team: poss,
        player: actor.n,
        xg,
        speed,
        outcome,
        from: { x: toX(poss, progress), y },
        to: { x: toX(poss, 100), y: clamp(50 + rand(-9, 9), 38, 62) },
      });
      if (outcome === 'goal') {
        score[poss]++;
        push({ type: 'goal', team: poss, player: actor.n, score: { ...score }, xg });
        t += rand(40, 60);
        poss = defender;
        progress = 50;
        y = 50;
        lastActor = null;
        continue;
      }
      t += rand(6, 12);
      poss = defender;
      progress = outcome === 'saved' ? rand(6, 14) : rand(8, 30);
      y = rand(30, 70);
      push({
        type: 'possession_change',
        team: poss,
        reason: outcome,
        from: { x: toX(poss, progress), y },
      });
      continue;
    }

    // Tackle by the defender
    if (roll > 0.8 && roll <= 0.9 && lastActor !== null) {
      const tackler = pickPlayer(defender, 100 - progress);
      push({
        type: 'tackle',
        team: defender,
        player: tackler.n,
        target: actor.n,
        from: { x: toX(poss, progress), y },
      });
      poss = defender;
      progress = clamp(100 - progress, 4, 96);
      push({
        type: 'possession_change',
        team: poss,
        reason: 'tackle',
        from: { x: toX(poss, progress), y },
      });
      t += rand(3, 7);
      lastActor = null;
      continue;
    }

    // Pass
    const p2 = clamp(progress + rand(-14, 20) + (ownShare - 0.5) * 12, 2, 98);
    const y2 = clamp(y + rand(-30, 30), 6, 94);
    const dist = Math.hypot((p2 - progress) * 1.05, (y2 - y) * 0.68);
    const forward = Math.max(0, p2 - progress);
    const difficulty = +clamp(0.12 + (dist / 60) * 0.4 + (forward / 100) * 0.6 + pressure * 0.28, 0, 1).toFixed(2);
    const successProb = clamp(0.95 - difficulty * 0.6 + (ownShare - 0.5) * 0.45, 0.2, 0.97);
    const ok = rng() < successProb;
    const receiver = pickPlayer(poss, p2);
    push({
      type: 'pass',
      team: poss,
      player: actor.n,
      to_player: receiver.n,
      distance: Math.round(dist),
      ballSpeed: Math.round(clamp(28 + dist * 0.9 + rand(-4, 6), 25, 98)),
      difficulty,
      success: ok,
      pressure: +pressure.toFixed(2),
      from: { x: toX(poss, progress), y },
      to: { x: toX(poss, p2), y: y2 },
    });
    lastActor = actor.n;
    if (ok) {
      progress = p2;
      y = y2;
    } else {
      poss = defender;
      progress = clamp(100 - p2, 4, 96);
      y = y2;
      push({
        type: 'possession_change',
        team: poss,
        reason: 'interception',
        from: { x: toX(poss, progress), y },
      });
      lastActor = null;
    }
    t += rand(3.5, 8.5);
  }

  events.push({ id: ++id, t: 5400, minute: 90, type: 'fulltime', team: 'home', score: { ...score } });
  return events;
}
