import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { SAMPLE } from '../engine/sample';
import { narrate, toOverlayCue, playerName } from '../engine/narrator';
import { TEAMS } from '../engine/data';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const goal = SAMPLE.goal;
const ev = SAMPLE.passEvent;
const gN = {
  casual: narrate(goal, { lang: 'en', mode: 'casual' }),
  analyst: narrate(goal, { lang: 'en', mode: 'analyst' }),
  hi: narrate(goal, { lang: 'hi', mode: 'casual' }),
};

const ingestJson = JSON.stringify(
  {
    id: ev.id,
    t: ev.t,
    type: ev.type,
    team: TEAMS[ev.team].short,
    player: playerName(ev.team, ev.player),
    to_player: playerName(ev.team, ev.to_player),
    distance_m: ev.distance,
    ball_speed_kmh: ev.ballSpeed,
    difficulty: ev.difficulty,
    success: ev.success,
    from: ev.from,
    to: ev.to,
  },
  null,
  2
);

const STAGES = [
  {
    key: 'ingest',
    name: 'Ingest',
    line: 'Match events arrive as a stream: passes, shots, tackles, pressure, possession.',
    artifact: (
      <>
        <div className="art-label">Raw synthetic event · {SAMPLE.eventCount.toLocaleString()} per match</div>
        <pre className="code">{ingestJson}</pre>
      </>
    ),
  },
  {
    key: 'interpret',
    name: 'Interpret',
    line: 'Events aggregate into football state: possession, xG, pressure and momentum.',
    artifact: (
      <>
        <div className="art-label">Match state at minute {SAMPLE.atGoal.minute}</div>
        <div className="kv">
          <div><small>Possession</small><b>{SAMPLE.atGoal.possPct.home}% · {SAMPLE.atGoal.possPct.away}%</b></div>
          <div><small>xG</small><b>{SAMPLE.atGoal.xg.home} · {SAMPLE.atGoal.xg.away}</b></div>
          <div><small>Shots</small><b>{SAMPLE.atGoal.shots.home} · {SAMPLE.atGoal.shots.away}</b></div>
          <div><small>Pressure actions</small><b>{SAMPLE.atGoal.pressures.home} · {SAMPLE.atGoal.pressures.away}</b></div>
          <div><small>Momentum index</small><b>{SAMPLE.atGoal.momentum > 0 ? '+' : ''}{SAMPLE.atGoal.momentum}</b></div>
          <div><small>Pass difficulty</small><b>{ev.difficulty} (rated 0 to 1)</b></div>
        </div>
      </>
    ),
  },
  {
    key: 'explain',
    name: 'Explain',
    line: 'The engine says why a moment matters, not only that it happened.',
    artifact: (
      <>
        <div className="art-label">Insight · {goal.kind} · importance {goal.importance}</div>
        <div className="quote">
          <h4>{gN.casual.headline}</h4>
          <p>{gN.casual.why}</p>
        </div>
      </>
    ),
  },
  {
    key: 'render',
    name: 'Render',
    line: 'Insights become timed, machine-readable cues for a broadcast overlay.',
    artifact: (
      <>
        <div className="art-label">overlay.cue/1 · ready for a graphics renderer</div>
        <pre className="code">{JSON.stringify(toOverlayCue(goal, 'en'), null, 2)}</pre>
      </>
    ),
  },
  {
    key: 'personalize',
    name: 'Personalize',
    line: 'The same moment, three genuinely different experiences.',
    artifact: (
      <>
        <div className="art-label">One insight · three viewers</div>
        <div className="trio">
          <div><small>Casual fan · English</small><h5>{gN.casual.headline}</h5><p>{gN.casual.why}</p></div>
          <div><small>Analyst · English</small><h5>{gN.analyst.headline}</h5><code>{gN.analyst.metrics}</code></div>
          <div><small>Casual fan · हिन्दी</small><h5>{gN.hi.headline}</h5><p>{gN.hi.why}</p></div>
        </div>
      </>
    ),
  },
];

export default function Pipeline() {
  const root = useRef(null);
  const [active, setActive] = useState(0);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(min-width: 960px)', () => {
        const el = root.current;
        el.classList.add('pinned');
        const st = ScrollTrigger.create({
          trigger: el,
          start: 'top top',
          end: `+=${STAGES.length * 75}%`,
          pin: true,
          scrub: true,
          onUpdate: (self) => {
            setActive(Math.min(STAGES.length - 1, Math.floor(self.progress * STAGES.length * 0.999)));
            gsap.set('.pl-fill', { scaleY: self.progress });
          },
        });
        return () => {
          el.classList.remove('pinned');
          st.kill();
        };
      });
      mm.add('(max-width: 959px)', () => {
        gsap.from('.stage-item', { y: 40, opacity: 0, duration: 0.7, stagger: 0.12, scrollTrigger: { trigger: root.current, start: 'top 75%' } });
      });
    },
    { scope: root }
  );

  useEffect(() => {
    gsap.fromTo('.panel-item.active .artifact', { y: 34, opacity: 0, filter: 'blur(10px)' }, { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.6, ease: 'power3.out' });
  }, [active]);

  return (
    <section className="pipeline" id="pipeline" ref={root}>
      <div className="pipe-inner">
        <div className="pipe-left">
          <span className="eyebrow">One pipeline, five stages</span>
          <h2>From raw event to personal story.</h2>
          <div className="pl-track" aria-hidden="true">
            <div className="pl-fill" />
          </div>
          <ol className="stages">
            {STAGES.map((s, i) => (
              <li key={s.key} className={`stage-item ${i === active ? 'on' : ''} ${i < active ? 'done' : ''}`}>
                <span className="stage-n">0{i + 1}</span>
                <div>
                  <h3>{s.name}</h3>
                  <p>{s.line}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="pipe-right">
          {STAGES.map((s, i) => (
            <div key={s.key} className={`panel-item ${i === active ? 'active' : ''}`}>
              <div className="artifact">
                <div className="art-head">
                  <span>0{i + 1}</span> {s.name}
                </div>
                {s.artifact}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
