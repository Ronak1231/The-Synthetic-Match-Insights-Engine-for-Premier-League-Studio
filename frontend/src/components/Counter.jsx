import { useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger, useGSAP);

export default function Counter({ to, suffix = '', duration = 1.6 }) {
  const ref = useRef(null);
  useGSAP(
    () => {
      const o = { v: 0 };
      gsap.to(o, {
        v: to,
        duration,
        ease: 'power2.out',
        scrollTrigger: { trigger: ref.current, start: 'top 92%', once: true },
        onUpdate: () => {
          if (ref.current) ref.current.textContent = Math.round(o.v).toLocaleString() + suffix;
        },
      });
    },
    { scope: ref }
  );
  return <span ref={ref}>0{suffix}</span>;
}
