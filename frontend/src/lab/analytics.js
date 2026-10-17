// Analytics board data, derived purely from the synthetic event stream (no backend needed).
// `upTo` (match seconds) lets the board follow the live clock without spoiling the future.
import { TEAMS } from '../engine/data';

const GRID_X = 6;
const GRID_Y = 4;
const WINDOW = 900;

export const nameOf = (team, n) => TEAMS[team].players.find((p) => p.n === n)?.name ?? `#${n}`;

export function buildAnalytics(events, upTo = Infinity) {
  const evs = events.filter((e) => e.t <= upTo);
  const shots = [];
  const goals = [];
  const xgSteps = [{ t: 0, home: 0, away: 0 }];
  const cum = { home: 0, away: 0 };
  const zones = Array.from({ length: GRID_Y }, () => Array.from({ length: GRID_X }, () => ({ home: 0, away: 0 })));
  const nodes = { home: {}, away: {} };
  const edges = { home: {}, away: {} };
  const players = {};
  const phases = Array.from({ length: 6 }, (_, i) => ({
    label: `${i * 15}-${i * 15 + 15}`, home: { shots: 0, xg: 0, pressures: 0, passes: 0 }, away: { shots: 0, xg: 0, pressures: 0, passes: 0 },
  }));
  const P = (team, n) => (players[`${team}:${n}`] ??= { team, n, passes: 0, passesOk: 0, shots: 0, xg: 0, goals: 0, tackles: 0 });

  for (const e of evs) {
    const ph = phases[Math.min(5, Math.floor(e.t / WINDOW))];
    if (e.from) {
      const gx = Math.min(GRID_X - 1, Math.max(0, Math.floor((e.from.x / 100) * GRID_X)));
      const gy = Math.min(GRID_Y - 1, Math.max(0, Math.floor((e.from.y / 100) * GRID_Y)));
      if (['pass', 'shot', 'tackle', 'sprint'].includes(e.type)) zones[gy][gx][e.team] += 1;
    }
    if (e.type === 'pass') {
      ph[e.team].passes += 1;
      const p = P(e.team, e.player);
      p.passes += 1;
      const node = (nodes[e.team][e.player] ??= { n: e.player, sx: 0, sy: 0, k: 0 });
      node.sx += e.from.x;
      node.sy += e.from.y;
      node.k += 1;
      if (e.success) {
        p.passesOk += 1;
        const key = `${e.player}>${e.to_player}`;
        edges[e.team][key] = (edges[e.team][key] || 0) + 1;
      }
    } else if (e.type === 'shot') {
      ph[e.team].shots += 1;
      ph[e.team].xg += e.xg;
      cum[e.team] += e.xg;
      xgSteps.push({ t: e.t, home: cum.home, away: cum.away });
      const p = P(e.team, e.player);
      p.shots += 1;
      p.xg += e.xg;
      shots.push({ id: e.id, t: e.t, minute: e.minute, team: e.team, player: e.player, xg: e.xg, outcome: e.outcome, speed: e.speed, from: e.from, to: e.to });
    } else if (e.type === 'goal') {
      P(e.team, e.player).goals += 1;
      goals.push({ t: e.t, minute: e.minute, team: e.team, player: e.player, score: e.score });
    } else if (e.type === 'tackle') {
      P(e.team, e.player).tackles += 1;
    } else if (e.type === 'pressure') {
      ph[e.team].pressures += 1;
    }
  }
  xgSteps.push({ t: Math.min(upTo, 5400), home: cum.home, away: cum.away });

  const network = {};
  for (const team of ['home', 'away']) {
    const list = Object.values(nodes[team]).map((n) => ({ n: n.n, x: n.sx / n.k, y: n.sy / n.k, k: n.k }));
    const pos = Object.fromEntries(list.map((n) => [n.n, n]));
    const links = Object.entries(edges[team])
      .map(([key, c]) => {
        const [a, b] = key.split('>').map(Number);
        return { a, b, c };
      })
      .filter((l) => pos[l.a] && pos[l.b])
      .sort((x, y) => y.c - x.c)
      .slice(0, 14);
    network[team] = { nodes: list, links };
  }

  let zoneMax = 1;
  for (const row of zones) for (const c of row) zoneMax = Math.max(zoneMax, c.home + c.away);

  const table = Object.values(players)
    .map((p) => ({ ...p, acc: p.passes ? Math.round((p.passesOk / p.passes) * 100) : 0 }))
    .sort((a, b) => b.goals * 3 + b.xg - (a.goals * 3 + a.xg));

  return {
    shots, goals, xgSteps, zones, zoneMax, network, phases, table,
    totals: { home: { xg: cum.home, shots: shots.filter((s) => s.team === 'home').length }, away: { xg: cum.away, shots: shots.filter((s) => s.team === 'away').length } },
  };
}

// Labelled counterfactual dataset: one row per (shot, option) so analysts can train decision models.
export function counterfactualRows(events, simulate) {
  const rows = [['seed_event_id', 'minute', 'team', 'player', 'logged_xg', 'outcome', 'option', 'option_kind', 'sim_probability_pct', 'ci95_pct', 'is_original', 'is_best', 'sims']];
  for (const e of events) {
    if (e.type !== 'shot') continue;
    const r = simulate(e.id);
    for (const o of [r.baseline, ...r.alternatives]) {
      rows.push([e.id, e.minute, e.team, nameOf(e.team, e.player), e.xg, e.outcome, o.label, o.kind, o.probability, o.ci, o.key === 'shoot', o.key === r.best, r.sims]);
    }
  }
  return rows;
}

export const toCsv = (rows) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');

export function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
