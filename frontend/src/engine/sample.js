// Precomputed from the same seeded match so the marketing sections show real engine output.
import { simulateMatch } from './simulator';
import { createEngine } from './engine';

function build() {
  const events = simulateMatch();
  const eng = createEngine();
  let goal = null;
  let atGoal = null;
  const byKind = {};
  for (const ev of events) {
    const out = eng.ingest(ev);
    for (const i of out) {
      if (!byKind[i.kind]) byKind[i.kind] = i;
      if (!goal && i.kind === 'goal') {
        goal = i;
        const s = eng.snapshot();
        atGoal = {
          minute: ev.minute,
          possPct: { ...s.possPct },
          momentum: s.momentum,
          xg: { home: +s.team.home.xg.toFixed(2), away: +s.team.away.xg.toFixed(2) },
          shots: { home: s.team.home.shots, away: s.team.away.shots },
          pressures: { home: s.team.home.pressures, away: s.team.away.pressures },
        };
      }
    }
  }
  const final = eng.snapshot();
  const passEvent = events.find((e) => e.type === 'pass' && e.success && e.difficulty > 0.5 && e.minute > 8 && e.minute < 40);
  return {
    events,
    eventCount: events.length,
    insightCount: final.insights.length,
    goal,
    atGoal,
    byKind,
    passEvent,
  };
}

export const SAMPLE = build();
