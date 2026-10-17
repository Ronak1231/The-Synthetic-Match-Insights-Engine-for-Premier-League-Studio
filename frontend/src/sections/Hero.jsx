import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import Aurora from '../components/reactbits/Aurora';
import SplitText from '../components/reactbits/SplitText';
import GradientText from '../components/reactbits/GradientText';
import ShinyText from '../components/reactbits/ShinyText';
import Magnet from '../components/reactbits/Magnet';
import Counter from '../components/Counter';
import { SAMPLE } from '../engine/sample';
import { narrate } from '../engine/narrator';
import { TEAMS } from '../engine/data';

gsap.registerPlugin(useGSAP);

const showcase = ['goal', 'momentum_shift', 'sprint'].map((k) => SAMPLE.byKind[k]).filter(Boolean);

export default function Hero() {
  const root = useRef(null);

  useGSAP(
    () => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from('.hero-badge', { y: 20, opacity: 0, duration: 0.7 })
        .from('.hero-sub', { y: 24, opacity: 0, duration: 0.8 }, '+=0.35')
        .from('.hero-cta > *', { y: 20, opacity: 0, duration: 0.6, stagger: 0.1 }, '-=0.5')
        .from('.hero-stats > div', { y: 24, opacity: 0, duration: 0.6, stagger: 0.08 }, '-=0.4')
        .from('.hero-card', { y: 60, opacity: 0, rotate: 3, duration: 0.9, stagger: 0.15 }, '-=0.8');

      gsap.to('.hero-card', {
        y: '+=10',
        duration: 2.6,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        stagger: { each: 0.5, from: 'start' },
        delay: 1.8,
      });

      gsap.to('.hero-bg', {
        yPercent: 18,
        opacity: 0.35,
        ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: true },
      });
    },
    { scope: root }
  );

  return (
    <section className="hero" id="top" ref={root}>
      <div className="hero-bg" aria-hidden="true">
        <Aurora colorStops={['#38f8c7', '#8b5cf6', '#ff5d8f']} amplitude={1.15} blend={0.65} />
      </div>
      <div className="hero-fade" aria-hidden="true" />

      <div className="hero-inner">
        <div className="hero-copy">
          <div className="hero-badge">
            <ShinyText text="Inside the Game · Developer Hackathon" color="#9fb0c9" shineColor="#ffffff" speed={3} />
          </div>
          <SplitText
            text="Beyond the scoreline."
            tag="h1"
            className="hero-title"
            textAlign="left"
            delay={35}
            duration={1.1}
            from={{ opacity: 0, y: 60, rotateX: -50 }}
            to={{ opacity: 1, y: 0, rotateX: 0 }}
            rootMargin="0px"
            threshold={0}
          />
          <div className="hero-title hero-title-2">
            <GradientText colors={['#38f8c7', '#8b5cf6', '#ff5d8f', '#38f8c7']} animationSpeed={7}>
              Every pass, explained.
            </GradientText>
          </div>
          <p className="hero-sub">
            An AI insights engine that ingests football events as they happen, explains why moments matter, and renders it for studio, stream and fan in their own language, club and style.
          </p>
          <div className="hero-cta">
            <Magnet padding={60} magnetStrength={3}>
              <a className="btn-primary" href="#studio">
                Watch the live demo
              </a>
            </Magnet>
            <a className="btn-ghost" href="#pipeline">
              How it works
            </a>
          </div>
          <div className="hero-stats">
            <div>
              <b>
                <Counter to={SAMPLE.eventCount} />
              </b>
              <span>synthetic events per match</span>
            </div>
            <div>
              <b>
                <Counter to={SAMPLE.insightCount} />
              </b>
              <span>explained moments</span>
            </div>
            <div>
              <b>
                <Counter to={5} />
              </b>
              <span>languages</span>
            </div>
            <div>
              <b>
                <Counter to={4} />
              </b>
              <span>audience modes</span>
            </div>
          </div>
        </div>

        <div className="hero-cards" aria-hidden="true">
          {showcase.map((ins, i) => {
            const n = narrate(ins, { lang: 'en', mode: 'casual' });
            return (
              <div key={ins.id} className="hero-card" style={{ '--c': TEAMS[ins.team].color, '--i': i }}>
                <span className="hc-min">{ins.minute}'</span>
                <h5>{n.headline}</h5>
                <p>{n.why}</p>
              </div>
            );
          })}
        </div>
      </div>

      <a className="scroll-hint" href="#story" aria-label="Scroll to content">
        <span />
      </a>
    </section>
  );
}
