export default function Controls({ match }) {
  const { playing, speed, snap, play, pause, reset, seek, setSpeed, jumpToNextMoment, finished } = match;
  const speeds = [30, 60, 120, 300];
  const mm = Math.floor(snap.clock / 60);
  return (
    <div className="controls">
      <button className="btn-primary" onClick={playing ? pause : play} disabled={finished && !playing}>
        {playing ? 'Pause' : finished ? 'Full time' : snap.clock > 0 ? 'Resume' : 'Kick off'}
      </button>
      <button className="btn-ghost" onClick={reset}>Restart</button>
      <button className="btn-ghost" onClick={jumpToNextMoment}>Next key moment</button>
      <div className="speed" role="group" aria-label="Playback speed">
        {speeds.map((s) => (
          <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <div className="scrub">
        <input type="range" min="0" max="5400" step="10" value={Math.round(snap.clock)} onChange={(e) => seek(+e.target.value)} aria-label="Match time" />
        <span>{mm}'</span>
      </div>
    </div>
  );
}
