import { useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import SpotlightCard from '../components/reactbits/SpotlightCard';

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Maps the Official Rules section 4.1 to what the demo actually does today.
// status: live = working in the demo, planned = not built yet.
const ITEMS = [
  { group: 'Pipeline', name: 'Ingest', note: 'Validated synthetic events from the backend: passes, shots, tackles, possession, pressure.', status: 'live' },
  { group: 'Pipeline', name: 'Interpret', note: 'xG, pressure index, momentum and possession over rolling windows.', status: 'live' },
  { group: 'Pipeline', name: 'Explain', note: 'Every insight says why it matters, grounded in the computed numbers.', status: 'live' },
  { group: 'Pipeline', name: 'Render', note: 'Pitch overlays, score bug, lower-thirds and timed overlay.cue/1 JSON.', status: 'live' },
  { group: 'Pipeline', name: 'Personalize', note: 'Audience mode, club, metric lens and single-player focus.', status: 'live' },
  { group: 'Intelligence', name: 'Player name tags + speed chips', note: 'Speed chips appear at 33 km/h and above.', status: 'live' },
  { group: 'Intelligence', name: 'Pass quality', note: 'Distance, accuracy and a 0 to 1 difficulty rating.', status: 'live' },
  { group: 'Intelligence', name: 'Ball and shot speed', note: 'Carried on each event and surfaced in analyst mode.', status: 'live' },
  { group: 'Intelligence', name: 'Auto-eventing from video', note: 'A model that tags events from a video feed is not in this demo.', status: 'planned' },
  { group: 'Experience', name: 'Multi-language storytelling', note: 'English, Hindi, Spanish, Arabic (right-to-left) and French.', status: 'live' },
  { group: 'Experience', name: 'Automated recap', note: 'Rewrites per language and mode; exports as Markdown.', status: 'live' },
  { group: 'Experience', name: 'Several favourite players', note: 'One focus player at a time today; a multi-player watchlist is not built.', status: 'planned' },
];

export default function Coverage() {
  const root = useRef(null);
  useGSAP(
    () => {
      gsap.from('.cov-reveal', { y: 40, opacity: 0, duration: 0.7, stagger: 0.05, ease: 'power3.out', scrollTrigger: { trigger: root.current, start: 'top 75%' } });
    },
    { scope: root }
  );
  const live = ITEMS.filter((i) => i.status === 'live').length;

  return (
    <section className="section cov" id="coverage" ref={root}>
      <div className="section-head cov-reveal">
        <span className="eyebrow">Challenge coverage</span>
        <h2>What the demo does, and what it doesn't yet.</h2>
        <p>
          {live} of {ITEMS.length} challenge features work in this demo today. The rest are marked planned so nothing here overclaims.
        </p>
      </div>
      <div className="cov-grid">
        {ITEMS.map((i) => (
          <SpotlightCard key={i.name} className="panel cov-card cov-reveal" spotlightColor="rgba(56,248,199,.14)">
            <small>{i.group}</small>
            <h4>{i.name}</h4>
            <p>{i.note}</p>
            <span className={`cov-status ${i.status}`}>{i.status === 'live' ? 'Working in demo' : 'Planned'}</span>
          </SpotlightCard>
        ))}
      </div>
    </section>
  );
}
