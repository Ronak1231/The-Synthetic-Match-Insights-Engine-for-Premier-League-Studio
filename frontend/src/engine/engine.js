// Interpret + Explain stages.
// Ingests raw synthetic events and maintains match state, then emits structured
// "insights" (kind + params + importance). Natural-language rendering is in narrator.js
// so the same insight can be re-rendered per language and audience mode.

const WINDOW = 300; // seconds of recent play used for momentum / rhythm
const other = (t) => (t === 'home' ? 'away' : 'home');
const key = (team, n) => `${team}:${n}`;

const emptyTeam = () => ({
  passes: 0,
  passesOk: 0,
  shots: 0,
  onTarget: 0,
  xg: 0,
  tackles: 0,
  pressures: 0,
  fouls: 0,
  cards: 0,
  possSeconds: 0,
  corners: 0,
});

export function createEngine() {
  const state = {
    clock: 0,
    minute: 1,
    score: { home: 0, away: 0 },
    team: { home: emptyTeam(), away: emptyTeam() },
    players: {},
    possession: 'home',
    lastT: 0,
    recent: [],
    series: [], // one point per match minute
    insights: [],
    ball: { x: 50, y: 50 },
    lastEvent: null,
    momentum: 0,
    changesRecent: 0,
    cooldown: {},
    lastMomentumSign: 0,
  };

  const P = (team, n) => {
    const k = key(team, n);
    if (!state.players[k]) {
      state.players[k] = {
        team,
        n,
        passes: 0,
        passesOk: 0,
        shots: 0,
        xg: 0,
        goals: 0,
        tackles: 0,
        sprints: 0,
        topSpeed: 0,
        distance: 0,
        touches: 0,
        pressures: 0,
        bestPassDiff: 0,
      };
    }
    return state.players[k];
  };

  const emit = (kind, ev, params, importance) => {
    const insight = {
      id: `${kind}-${ev.id}`,
      kind,
      t: ev.t,
      minute: ev.minute,
      team: ev.team,
      player: ev.player ?? null,
      params,
      importance,
      eventId: ev.id,
    };
    state.insights.push(insight);
    return insight;
  };

  const cool = (name, t, secs) => {
    if (state.cooldown[name] !== undefined && t - state.cooldown[name] < secs) return false;
    state.cooldown[name] = t;
    return true;
  };

  function recomputeWindow(t) {
    state.recent = state.recent.filter((e) => t - e.t <= WINDOW);
    let m = 0;
    let changes = 0;
    const press = { home: 0, away: 0 };
    const prog = { home: 0, away: 0 };
    const hold = { home: 0, away: 0 };
    for (const e of state.recent) {
      const sign = e.team === 'home' ? 1 : -1;
      if (e.type === 'pass' && e.success) {
        const forward = e.team === 'home' ? e.to.x - e.from.x : e.from.x - e.to.x;
        if (forward > 8) {
          m += sign * 0.9;
          prog[e.team]++;
        } else m += sign * 0.25;
        hold[e.team]++;
      }
      if (e.type === 'shot') m += sign * (2 + e.xg * 14);
      if (e.type === 'pressure') {
        m += sign * 0.9;
        press[e.team]++;
      }
      if (e.type === 'tackle') m += sign * 0.7;
      if (e.type === 'possession_change') changes++;
    }
    state.changesRecent = changes;
    state.momentum = Math.max(-100, Math.min(100, Math.round(m * 2.2)));
    return { press, prog, hold, changes };
  }

  function ingest(ev) {
    const out = [];
    const dt = Math.max(0, ev.t - state.lastT);
    state.team[state.possession].possSeconds += dt;
    state.lastT = ev.t;
    state.clock = ev.t;
    state.minute = ev.minute;
    state.lastEvent = ev;
    if (ev.from) state.ball = { x: ev.from.x, y: ev.from.y };
    if (ev.to && (ev.type === 'pass' || ev.type === 'shot')) state.ball = { x: ev.to.x, y: ev.to.y };

    state.recent.push(ev);
    const T = state.team;

    switch (ev.type) {
      case 'pass': {
        T[ev.team].passes++;
        const p = P(ev.team, ev.player);
        p.passes++;
        p.touches++;
        if (ev.success) {
          T[ev.team].passesOk++;
          p.passesOk++;
          const r = P(ev.team, ev.to_player);
          r.touches++;
          if (ev.difficulty > p.bestPassDiff) p.bestPassDiff = ev.difficulty;
          if (ev.distance >= 38 && ev.difficulty >= 0.62 && cool('keypass', ev.t, 420)) {
            out.push(
              emit('key_pass', ev, { dist: ev.distance, diff: Math.round(ev.difficulty * 10), pressure: ev.pressure }, 0.55)
            );
          }
        }
        if (p.passes === 40 || p.passes === 70) {
          out.push(emit('milestone_passes', ev, { n: p.passes }, 0.35));
        }
        break;
      }
      case 'shot': {
        T[ev.team].shots++;
        T[ev.team].xg += ev.xg;
        if (ev.outcome === 'goal' || ev.outcome === 'saved') T[ev.team].onTarget++;
        const p = P(ev.team, ev.player);
        p.shots++;
        p.xg += ev.xg;
        if (ev.speed >= 112 && cool('powershot', ev.t, 900)) {
          out.push(emit('power_shot', ev, { speed: ev.speed }, 0.4));
        }
        if (ev.outcome !== 'goal' && ev.xg >= 0.25) {
          out.push(emit('big_chance', ev, { xg: ev.xg, outcome: ev.outcome }, 0.7 + ev.xg * 0.3));
        }
        break;
      }
      case 'goal': {
        state.score = { ...ev.score };
        P(ev.team, ev.player).goals++;
        out.push(emit('goal', ev, { xg: ev.xg, inv: Math.max(2, Math.round(1 / Math.max(0.03, ev.xg))), home: ev.score.home, away: ev.score.away }, 1));
        break;
      }
      case 'tackle': {
        T[ev.team].tackles++;
        const p = P(ev.team, ev.player);
        p.tackles++;
        if (p.tackles === 4 || p.tackles === 7) out.push(emit('milestone_tackles', ev, { n: p.tackles }, 0.35));
        break;
      }
      case 'pressure': {
        T[ev.team].pressures++;
        P(ev.team, ev.player).pressures++;
        break;
      }
      case 'foul':
        T[ev.team].fouls++;
        break;
      case 'card':
        T[ev.team].cards++;
        out.push(emit('card', ev, {}, 0.6));
        break;
      case 'sprint': {
        const p = P(ev.team, ev.player);
        p.sprints++;
        p.distance += ev.distance;
        if (ev.speed > p.topSpeed) p.topSpeed = ev.speed;
        if (ev.speed >= 33 && cool(`sprint-${ev.team}-${ev.player}`, ev.t, 900)) {
          out.push(emit('sprint', ev, { speed: ev.speed, distance: ev.distance }, 0.5));
        }
        break;
      }
      case 'possession_change':
        state.possession = ev.team;
        break;
      default:
    }

    if (ev.type === 'pass' && !ev.success) {
      // possession flips with the following possession_change event
    }

    // Window analytics every event (cheap).
    const w = recomputeWindow(ev.t);

    // Pressure wave
    for (const tm of ['home', 'away']) {
      if (w.press[tm] >= 8 && cool(`press-${tm}`, ev.t, 900)) {
        out.push(emit('press_wave', { ...ev, team: tm, player: null }, { n: w.press[tm] }, 0.6));
      }
    }

    // Momentum shift, evaluated once a minute
    const lastPt = state.series[state.series.length - 1];
    if (!lastPt || ev.t - lastPt.t >= 60) {
      const totalPoss = T.home.possSeconds + T.away.possSeconds || 1;
      const sign = state.momentum > 22 ? 1 : state.momentum < -22 ? -1 : 0;
      if (sign !== 0 && sign !== state.lastMomentumSign && state.lastMomentumSign !== undefined && cool('shift', ev.t, 420) && ev.t > 480) {
        const tm = sign === 1 ? 'home' : 'away';
        out.push(
          emit(
            'momentum_shift',
            { ...ev, team: tm, player: null },
            { pct: Math.min(95, 50 + Math.abs(state.momentum) / 2) | 0, prog: w.prog[tm], press: w.press[tm] },
            0.75
          )
        );
      }
      if (sign !== 0) state.lastMomentumSign = sign;

      // Control vs chaos, every 5 min
      if (ev.t > 300 && Math.floor(ev.t / 300) !== Math.floor((lastPt?.t ?? 0) / 300)) {
        const homeHold = w.hold.home;
        const awayHold = w.hold.away;
        const holdTotal = homeHold + awayHold || 1;
        const lead = homeHold >= awayHold ? 'home' : 'away';
        const pct = Math.round((Math.max(homeHold, awayHold) / holdTotal) * 100);
        if (w.changes >= 20 && cool('chaos', ev.t, 900)) {
          out.push(emit('chaos', { ...ev, team: lead, player: null }, { n: w.changes }, 0.55));
        } else if (pct >= 64 && w.changes <= 14 && cool('control', ev.t, 900)) {
          out.push(emit('control', { ...ev, team: lead, player: null }, { pct, n: w.changes }, 0.55));
        }
      }

      state.series.push({
        t: ev.t,
        minute: ev.minute,
        momentum: state.momentum,
        homePoss: Math.round((T.home.possSeconds / totalPoss) * 100),
        rhythm: w.changes,
        homeXg: +T.home.xg.toFixed(2),
        awayXg: +T.away.xg.toFixed(2),
      });
    }

    return out;
  }

  function snapshot() {
    const total = state.team.home.possSeconds + state.team.away.possSeconds || 1;
    return {
      clock: state.clock,
      minute: state.minute,
      score: state.score,
      possession: state.possession,
      possPct: {
        home: Math.round((state.team.home.possSeconds / total) * 100),
        away: 100 - Math.round((state.team.home.possSeconds / total) * 100),
      },
      team: state.team,
      players: state.players,
      momentum: state.momentum,
      series: state.series,
      insights: state.insights,
      ball: state.ball,
      rhythm: state.changesRecent,
      lastEvent: state.lastEvent,
    };
  }

  return { ingest, snapshot, state };
}

export function playerRating(p) {
  const acc = p.passes ? p.passesOk / p.passes : 0.8;
  return +(6 + p.goals * 1.4 + p.xg * 0.8 + p.tackles * 0.18 + p.sprints * 0.08 + (acc - 0.75) * 1.5 + p.passes * 0.01).toFixed(1);
}

export function playerOfTheMatch(players) {
  let best = null;
  for (const p of Object.values(players)) {
    const r = playerRating(p);
    if (!best || r > best.rating) best = { ...p, rating: r };
  }
  return best;
}

export { other };
