#!/usr/bin/env bash
# Verifies the Python simulator + engine match the browser's JS simulator + engine exactly.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
for f in simulator engine data whatif; do cp "$ROOT/frontend/src/engine/$f.js" "$TMP/"; done
sed -i "s#from './data'#from './data.js'#" "$TMP/simulator.js" "$TMP/whatif.js"
sed -i "s#from './simulator'#from './simulator.js'#" "$TMP/whatif.js"
echo '{"type":"module"}' > "$TMP/package.json"
cat > "$TMP/parity.mjs" <<JS
import { execSync } from 'child_process';
import { simulateMatch } from './simulator.js';
import { createEngine } from './engine.js';
import { listMoments, simulateWhatIf, explainWhatIf } from './whatif.js';
let failed = false;
const norm2 = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
for (const seed of [40, 7, 123, 2026]) {
  const py = JSON.parse(execSync('python scripts/dump_events.py ' + seed, { cwd: '$ROOT/backend', maxBuffer: 1 << 28 }).toString());
  const js = simulateMatch(seed);
  const norm = (e) => JSON.stringify(e, Object.keys(e).sort());
  const sameEvents = js.length === py.events.length && js.every((e, i) => norm(e) === norm(py.events[i]));
  const eng = createEngine(); const ids = [];
  for (const e of js) ids.push(...eng.ingest(e).map((i) => i.id));
  const sameInsights = JSON.stringify(ids) === JSON.stringify(py.insight_ids);
  console.log('seed', seed, 'events', js.length, 'identical:', sameEvents, '| insights', ids.length, 'identical:', sameInsights);
  if (!sameEvents || !sameInsights) failed = true;

  // Second Guess: the browser what-if model must match the backend, number for number.
  const wf = JSON.parse(execSync('python scripts/dump_whatif.py ' + seed, { cwd: '$ROOT/backend', maxBuffer: 1 << 28 }).toString());
  const sameMoments = JSON.stringify(listMoments(js)) === JSON.stringify(wf.moments) && JSON.stringify(listMoments(js, 1800)) === JSON.stringify(wf.upTo);
  let sameRuns = true;
  for (const run of wf.runs) {
    const r = simulateWhatIf(js, run.eventId, { n: 600, include: run.include });
    const ok = norm2(r) === norm2(run.result) && explainWhatIf(r) === run.explanation;
    if (!ok) { sameRuns = false; console.log('  what-if mismatch at event', run.eventId, run.include, '\n   js:', explainWhatIf(r), '\n   py:', run.explanation); }
  }
  console.log('seed', seed, 'what-if moments', wf.moments.length, 'identical:', sameMoments, '| simulations', wf.runs.length, 'identical:', sameRuns);
  if (!sameMoments || !sameRuns) failed = true;
}
process.exit(failed ? 1 : 0);
JS
node "$TMP/parity.mjs"
