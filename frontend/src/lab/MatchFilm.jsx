import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TEAMS } from '../engine/data';
import { CH, CW, DEFAULT_FILM, LOCALE, PRESETS, buildFilmPlan, drawFrame } from './film';

export default function MatchFilm({ match, lang, mode }) {
  const [opts, setOpts] = useState(DEFAULT_FILM);
  const plan = useMemo(() => buildFilmPlan(match.events, lang, mode, opts), [match.events, lang, mode, opts]);
  const canvasRef = useRef(null);
  const tRef = useRef(0);
  const playRef = useRef(false);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const lastSeg = useRef(-1);
  const voiceRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voice, setVoice] = useState(false);
  const [progress, setProgress] = useState(0);
  const [video, setVideo] = useState(null);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  const canRecord = typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;

  const stopRecorder = useCallback(() => {
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    tRef.current = 0;
    playRef.current = false;
    lastSeg.current = -1;
    let raf;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playRef.current) {
        tRef.current += dt;
        if (tRef.current >= plan.total) {
          tRef.current = plan.total - 0.001;
          playRef.current = false;
          setPlaying(false);
          stopRecorder();
        }
        const idx = plan.segs.findIndex((s) => tRef.current >= s.start && tRef.current < s.start + s.dur);
        if (idx !== lastSeg.current) {
          lastSeg.current = idx;
          const s = plan.segs[idx];
          if (voiceRef.current && window.speechSynthesis && s?.kind !== 'title' && s?.kind !== 'outro') {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(s.kind === 'clip' ? s.head : s.text);
            u.lang = LOCALE[lang] || 'en-GB';
            u.rate = 1.05;
            window.speechSynthesis.speak(u);
          }
        }
        setProgress(tRef.current / plan.total);
      }
      drawFrame(ctx, plan, tRef.current, lang);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); playRef.current = false; window.speechSynthesis?.cancel(); stopRecorder(); };
  }, [plan, lang, stopRecorder]);

  const toggle = () => {
    if (tRef.current >= plan.total - 0.01) tRef.current = 0;
    playRef.current = !playRef.current;
    setPlaying(playRef.current);
    if (!playRef.current) window.speechSynthesis?.cancel();
  };

  const record = () => {
    const canvas = canvasRef.current;
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) return;
    setVideo((v) => { if (v) URL.revokeObjectURL(v.url); return null; });
    chunksRef.current = [];
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 5_000_000 });
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = () => {
      setRecording(false);
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      setVideo({ url: URL.createObjectURL(blob), size: blob.size });
    };
    recRef.current = rec;
    tRef.current = 0;
    lastSeg.current = -1;
    rec.start(250);
    setRecording(true);
    playRef.current = true;
    setPlaying(true);
  };

  const scrub = (e) => { tRef.current = Number(e.target.value) * plan.total; setProgress(Number(e.target.value)); };
  const secs = Math.round(plan.total);
  const set = (patch) => { if (!recording) { setPlaying(false); setProgress(0); setOpts((o) => ({ ...o, ...patch })); } };
  const count = (k) => plan.segs.filter((x) => x.kind === k).length;

  return (
    <div className="lab-pane film">
      <div className="lab-toolbar">
        <span className="film-info">{count('clip')} key moments · {count('second')} second guesses · {count('stats') + count('xgrace') + count('shotmap') + count('motm')} analytics cards · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}{secs > 120 ? ' (over the 2 min hackathon limit)' : ''}</span>
        <label className="lab-toggle">
          <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} disabled={!window.speechSynthesis} />
          Voice-over in preview (not captured in the recording)
        </label>
      </div>
      <div className="film-opts">
        <div className="seg" role="group" aria-label="Film length">
          {Object.entries(PRESETS).map(([k, v]) => (
            <button key={k} className={opts.preset === k ? 'on' : ''} onClick={() => set({ preset: k })} title={v.hint}>{v.label}</button>
          ))}
        </div>
        <label className="lab-toggle"><input type="checkbox" checked={opts.secondGuess} onChange={(e) => set({ secondGuess: e.target.checked })} /> Second-guess cards</label>
        <label className="lab-toggle"><input type="checkbox" checked={opts.cards} onChange={(e) => set({ cards: e.target.checked })} /> Analytics cards (stats, xG race, shot map, top performers)</label>
        <label className="lab-select">
          Focus
          <select value={opts.focus} onChange={(e) => set({ focus: e.target.value })}>
            <option value="all">Whole match</option>
            <option value="home">{TEAMS.home.name}</option>
            <option value="away">{TEAMS.away.name}</option>
            {['home', 'away'].map((t) => (
              <optgroup key={t} label={TEAMS[t].name}>
                {TEAMS[t].players.filter((pl) => pl.pos !== 'GK').map((pl) => <option key={`${t}${pl.n}`} value={`${t}:${pl.n}`}>{pl.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      <div className="film-frame">
        <canvas ref={canvasRef} width={CW} height={CH} aria-label="Analytics film preview" />
      </div>
      <div className="film-controls">
        <button className="btn-primary" onClick={toggle} disabled={recording}>{playing ? 'Pause' : progress > 0.99 ? 'Replay' : 'Play film'}</button>
        <input type="range" min="0" max="1" step="0.001" value={progress} onChange={scrub} disabled={recording} aria-label="Film position" />
        {canRecord ? (
          <button className="btn-ghost" onClick={record} disabled={recording}>{recording ? `Recording… ${Math.round(progress * 100)}%` : 'Record as video (WebM)'}</button>
        ) : (
          <span className="lab-empty">Recording needs a browser with MediaRecorder (Chrome, Edge, Firefox).</span>
        )}
        {video && <a className="btn-primary" href={video.url} download="second-guess-analytics-film.webm">Download video ({(video.size / 1e6).toFixed(1)} MB)</a>}
      </div>
      <p className="lab-note">The film is rendered live in your browser from the match events and the what-if model, in the language and audience mode chosen in the studio. Choose Standard for a demo-safe length. No video service, no upload: record the WebM and upload it to YouTube.</p>
    </div>
  );
}
