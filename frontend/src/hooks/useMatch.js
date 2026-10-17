import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { simulateMatch } from '../engine/simulator';
import { createEngine, playerOfTheMatch } from '../engine/engine';
import { API_URL, loadBackend } from '../api/client';

export const DEFAULT_SEED = 40;

// Drives the live demo: replays the synthetic event stream through the engine in
// "match time", exposing a snapshot plus the most recent events for pitch trails.
export function useMatch(seed = DEFAULT_SEED) {
  const localEvents = useMemo(() => simulateMatch(seed), [seed]);
  const [eventsOverride, setEventsOverride] = useState(null);
  const events = eventsOverride || localEvents;
  const narrationRef = useRef({});
  const [backend, setBackend] = useState({ status: API_URL ? 'connecting' : 'disabled' });
  const engineRef = useRef(null);
  if (engineRef.current === null) engineRef.current = createEngine();
  const idxRef = useRef(0);
  const clockRef = useRef(0);
  const trailRef = useRef([]);
  const playingRef = useRef(false);
  const speedRef = useRef(60);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(60);
  const [snap, setSnap] = useState(() => engineRef.current.snapshot());
  const [trail, setTrail] = useState([]);
  const [finished, setFinished] = useState(false);

  const publish = useCallback(() => {
    setSnap({ ...engineRef.current.snapshot() });
    setTrail([...trailRef.current]);
  }, []);

  const advanceTo = useCallback(
    (seconds) => {
      const eng = engineRef.current;
      while (idxRef.current < events.length && events[idxRef.current].t <= seconds) {
        const ev = events[idxRef.current++];
        const out = eng.ingest(ev);
        // Agent-written narration (LLM or template) from the backend replaces the local copy.
        for (const i of out) if (narrationRef.current[i.id]) i.narration = narrationRef.current[i.id];
        if (ev.type === 'pass' || ev.type === 'shot' || ev.type === 'tackle' || ev.type === 'pressure' || ev.type === 'goal') {
          trailRef.current.push(ev);
          if (trailRef.current.length > 9) trailRef.current.shift();
        }
      }
      if (idxRef.current >= events.length) {
        playingRef.current = false;
        setPlaying(false);
        setFinished(true);
      }
    },
    [events]
  );

  // Frame loop
  useEffect(() => {
    let raf;
    let last = performance.now();
    let sinceUi = 0;
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playingRef.current) {
        clockRef.current += dt * speedRef.current;
        advanceTo(clockRef.current);
        sinceUi += dt;
        if (sinceUi > 0.12) {
          sinceUi = 0;
          publish();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [advanceTo, publish]);

  const play = useCallback(() => {
    if (idxRef.current >= events.length) return;
    playingRef.current = true;
    setPlaying(true);
  }, [events]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    publish();
  }, [publish]);

  const reset = useCallback(() => {
    engineRef.current = createEngine();
    idxRef.current = 0;
    clockRef.current = 0;
    trailRef.current = [];
    setFinished(false);
    publish();
  }, [publish]);

  const seek = useCallback(
    (seconds) => {
      const wasPlaying = playingRef.current;
      engineRef.current = createEngine();
      idxRef.current = 0;
      trailRef.current = [];
      clockRef.current = seconds;
      setFinished(false);
      advanceTo(seconds);
      publish();
      if (wasPlaying && idxRef.current < events.length) {
        playingRef.current = true;
        setPlaying(true);
      }
    },
    [advanceTo, publish, events]
  );

  const setSpeed = useCallback((s) => {
    speedRef.current = s;
    setSpeedState(s);
  }, []);

  const jumpToNextMoment = useCallback(() => {
    const now = clockRef.current;
    // Find the next high-importance moment in the full stream by replaying a scratch engine.
    const scratch = createEngine();
    let target = null;
    for (const ev of events) {
      const out = scratch.ingest(ev);
      const hit = out.find((i) => i.importance >= 0.7 && ev.t > now + 5);
      if (hit) {
        target = Math.max(0, ev.t - 25);
        break;
      }
    }
    if (target === null) target = 5400;
    seek(target);
  }, [events, seek]);

  // Optional backend: agents on the server produce the insights and narration; the browser keeps
  // playing its own identical simulation until they arrive, then adopts them.
  useEffect(() => {
    if (!API_URL) return undefined;
    const ctl = new AbortController();
    loadBackend(seed, ctl.signal)
      .then(({ config, bundle }) => {
        narrationRef.current = Object.fromEntries(bundle.insights.map((i) => [i.id, i.narration]));
        const last = bundle.events[bundle.events.length - 1];
        const localLast = localEvents[localEvents.length - 1];
        if (bundle.events.length !== localEvents.length || last.id !== localLast.id) {
          setEventsOverride(bundle.events);
          engineRef.current = createEngine();
          idxRef.current = 0;
          clockRef.current = 0;
          trailRef.current = [];
          setFinished(false);
        } else {
          for (const i of engineRef.current.state.insights) if (narrationRef.current[i.id]) i.narration = narrationRef.current[i.id];
        }
        publish();
        setBackend({ status: 'live', config, trace: bundle.trace, meta: bundle.meta });
      })
      .catch((err) => {
        if (!ctl.signal.aborted) setBackend({ status: 'offline', error: String(err.message || err) });
      });
    return () => ctl.abort();
  }, [seed, localEvents, publish]);

  const matchOver = finished || snap.clock >= 5399;
  const motm = useMemo(() => (Object.keys(snap.players).length ? playerOfTheMatch(snap.players) : null), [snap]);

  return {
    events,
    snap,
    trail,
    playing,
    speed,
    finished: matchOver,
    clock: snap.clock,
    motm,
    backend,
    play,
    pause,
    reset,
    seek,
    setSpeed,
    jumpToNextMoment,
  };
}
