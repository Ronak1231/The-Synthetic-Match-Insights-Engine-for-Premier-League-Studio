import { useEffect, useState } from 'react';
import Magnet from '../components/reactbits/Magnet';

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`nav ${scrolled ? 'nav-scrolled' : ''}`}>
      <a href="#top" className="brand" aria-label="Match Insights Engine home">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="14" fill="none" stroke="#38f8c7" strokeWidth="2" />
          <path d="M16 7l6 4.5-2.3 7h-7.4L10 11.5z" fill="#38f8c7" />
          <path d="M16 7V2M22 11.5l5-2M19.7 18.5l3 4.5M12.3 18.5l-3 4.5M10 11.5l-5-2" stroke="#38f8c7" strokeWidth="1.4" />
        </svg>
        <span>Insights Engine</span>
      </a>
      <nav className="nav-links" aria-label="Sections">
        <a href="#pipeline">Pipeline</a>
        <a href="#studio">Live studio</a>
        <a href="#recap">Recap</a>
        <a href="#coverage">Coverage</a>
        <a href="#architecture">Architecture</a>
      </nav>
      <Magnet padding={40} magnetStrength={3}>
        <a href="#studio" className="btn-primary btn-sm">Watch demo</a>
      </Magnet>
    </header>
  );
}
