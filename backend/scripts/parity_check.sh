#!/usr/bin/env bash
# Verifies the Python simulator + engine match the browser's JS simulator + engine exactly.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
for f in simulator engine data; do cp "$ROOT/frontend/src/engine/$f.js" "$TMP/"; done
sed -i "s#from './data'#from './data.js'#" "$TMP/simulator.js"
echo '{"type":"module"}' > "$TMP/package.json"
cat > "$TMP/parity.mjs" <<JS
import { execSync } from 'child_process';
import { simulateMatch } from './simulator.js';
import { createEngine } from './engine.js';
let failed = false;
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
}
process.exit(failed ? 1 : 0);
JS
node "$TMP/parity.mjs"
