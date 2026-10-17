// Backend client. If VITE_API_URL is empty the UI runs entirely on the in-browser simulator.
// Render's free tier sleeps when idle, so the first request can take about a minute: the UI
// never waits for it and keeps playing the local simulation in the meantime.
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const WAKE_TIMEOUT_MS = 150000;

async function getJson(path, signal) {
  const res = await fetch(`${API_URL}${path}`, { signal });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

export async function loadBackend(seed, outerSignal) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), WAKE_TIMEOUT_MS);
  outerSignal?.addEventListener('abort', () => ctl.abort());
  try {
    const [config, bundle] = await Promise.all([getJson('/api/config', ctl.signal), getJson(`/api/match/${seed}`, ctl.signal)]);
    return { config, bundle };
  } catch (err) {
    if (ctl.signal.aborted && !outerSignal?.aborted) throw new Error('timed out waiting for the backend');
    throw new Error(`${err.message || err} (${API_URL})`);
  } finally {
    clearTimeout(timer);
  }
}

// "Ask the match": natural-language questions answered by the backend chat agent (tools + grounding).
export async function askMatch(seed, body, outerSignal) {
  if (!API_URL) throw new Error('The chat needs the backend. Set VITE_API_URL (see the README). Every other lab tab works offline.');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 70000); // a sleeping free-tier backend can take about a minute to wake
  outerSignal?.addEventListener('abort', () => ctl.abort());
  try {
    const res = await fetch(`${API_URL}/api/match/${seed}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (res.status === 429) throw new Error('You are asking too fast. Wait a few seconds and try again.');
    if (!res.ok) throw new Error(`The backend answered ${res.status}`);
    return await res.json();
  } catch (err) {
    if (ctl.signal.aborted) throw new Error(outerSignal?.aborted ? 'cancelled' : 'The backend is still waking up. Try again in a moment.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
