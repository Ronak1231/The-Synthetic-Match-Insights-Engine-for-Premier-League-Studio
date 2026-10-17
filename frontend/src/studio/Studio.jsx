import { useEffect, useMemo, useRef } from 'react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import SpotlightCard from '../components/reactbits/SpotlightCard';
import Pitch from './Pitch';
import Momentum from './Momentum';
import StatBars from './StatBars';
import Feed from './Feed';
import Personalize from './Personalize';
import PlayerFocus from './PlayerFocus';
import Controls from './Controls';
import BackendPanel from './BackendPanel';
import { filterInsights, usePrefs } from './prefs';

gsap.registerPlugin(ScrollTrigger, useGSAP);

export default function Studio({ match, setPrefs }) {
  const prefs = usePrefs();
  const root = useRef(null);
  const started = useRef(false);
  const { play } = match;

  const visible = useMemo(() => filterInsights(match.snap.insights, prefs), [match.snap, prefs]);
  const latest = visible[visible.length - 1] || null;

  useGSAP(
    () => {
      gsap.from('.studio-reveal', {
        y: 50,
        opacity: 0,
        duration: 0.9,
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: { trigger: root.current, start: 'top 80%' },
      });
    },
    { scope: root }
  );

  // Auto kick-off the first time the studio is mostly on screen.
  useEffect(() => {
    const st = ScrollTrigger.create({
      trigger: root.current,
      start: 'top 45%',
      once: true,
      onEnter: () => {
        if (!started.current) {
          started.current = true;
          play();
        }
      },
    });
    return () => st.kill();
  }, [play]);

  return (
    <section className="section studio" id="studio" ref={root}>
      <div className="section-head studio-reveal">
        <span className="eyebrow">Live match studio</span>
        <h2>One match. Every viewer gets their own story.</h2>
        <p>
          A seeded synthetic match streams through the pipeline in real time. Change the audience mode, language, club or player and the same events are re-explained instantly.
        </p>
      </div>

      <div className="studio-reveal">
        <BackendPanel backend={match.backend} />
      </div>

      <div className="studio-reveal">
        <SpotlightCard className="panel pers-panel" spotlightColor="rgba(56,248,199,.14)">
          <Personalize setPrefs={setPrefs} />
        </SpotlightCard>
      </div>

      <div className="studio-grid">
        <div className="studio-main">
          <div className="studio-reveal">
            <Pitch snap={match.snap} trail={match.trail} latest={latest} matchOver={match.finished} />
            <Controls match={match} />
          </div>
          {prefs.mode === 'player' && (
            <div className="studio-reveal">
              <PlayerFocus snap={match.snap} />
            </div>
          )}
          <div className="two studio-reveal">
            <SpotlightCard className="panel" spotlightColor="rgba(139,92,246,.16)">
              <Momentum snap={match.snap} />
            </SpotlightCard>
            <SpotlightCard className="panel" spotlightColor="rgba(255,93,143,.14)">
              <StatBars snap={match.snap} />
            </SpotlightCard>
          </div>
        </div>
        <aside className="studio-side studio-reveal">
          <div className="side-head">
            <h4>Explainable feed</h4>
            <span>{visible.length} moments · {match.snap.insights.length} detected</span>
          </div>
          <Feed insights={visible} />
        </aside>
      </div>
    </section>
  );
}
