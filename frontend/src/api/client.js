// Backend client. If VITE_API_URL is empty the UI runs entirely on the in-browser simulator.
// Render's free tier sleeps when idle, so the first request can take about a minute: the UI
// never waits for it and keeps playing the local simulation in the meantime.
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const WAKE_TIMEOUT_MS = 75000;

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
  } finally {
    clearTimeout(timer);
  }
}
