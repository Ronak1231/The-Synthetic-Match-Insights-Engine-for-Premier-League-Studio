import { useMemo, useState } from 'react';
import './App.css';
import { useLenis } from './hooks/useLenis';
import { useMatch } from './hooks/useMatch';
import { PrefsContext } from './studio/prefs';
import ClickSpark from './components/reactbits/ClickSpark';
import Nav from './sections/Nav';
import Hero from './sections/Hero';
import Story from './sections/Story';
import Pipeline from './sections/Pipeline';
import Studio from './studio/Studio';
import Recap from './sections/Recap';
import Coverage from './sections/Coverage';
import Architecture from './sections/Architecture';
import Footer from './sections/Footer';

export default function App() {
  useLenis();
  const match = useMatch();
  const [prefs, setPrefs] = useState({ mode: 'casual', lang: 'en', fav: 'none', focus: 'home:10', metric: 'all' });
  const value = useMemo(() => prefs, [prefs]);

  return (
    <PrefsContext.Provider value={value}>
      <Nav />
      <main>
        <ClickSpark sparkColor="#38f8c7" sparkSize={9} sparkRadius={22} sparkCount={9} duration={450}>
          <Hero />
        </ClickSpark>
        <Story />
        <Pipeline />
        <ClickSpark sparkColor="#8b5cf6" sparkSize={8} sparkRadius={20} sparkCount={8} duration={450}>
          <Studio match={match} setPrefs={setPrefs} />
        </ClickSpark>
        <Recap match={match} />
        <Coverage />
        <Architecture />
      </main>
      <Footer />
    </PrefsContext.Provider>
  );
}
