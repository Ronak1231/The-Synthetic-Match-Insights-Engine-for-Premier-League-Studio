import { useState } from 'react';
import { usePrefs } from '../studio/prefs';
import { DEFAULT_SEED } from '../hooks/useMatch';
import AskMatch from './AskMatch';
import SecondGuess from './SecondGuess';
import AnalyticsBoard from './AnalyticsBoard';
import MatchFilm from './MatchFilm';
import './lab.css';

const TABS = [
  ['ask', 'Ask the match', 'Natural-language questions'],
  ['guess', 'Second guess', 'Change the decision, see the odds'],
  ['analytics', 'Analytics', 'Shot map, xG race, pass network'],
  ['film', 'Match film', 'Auto-built highlight video'],
];

export default function Lab({ match }) {
  const prefs = usePrefs();
  const [tab, setTab] = useState('ask');
  const [focusId, setFocusId] = useState(null);

  return (
    <section className="section lab" id="lab">
      <div className="section-head">
        <span className="eyebrow">Intelligence lab</span>
        <h2>Ask it. Second-guess it. Watch it.</h2>
        <p>
          Chat with the match, rewind a decision and see a simulated alternative, explore the analytics, or render a highlight film. Everything is computed from the synthetic events and every number shows its working.
        </p>
      </div>
      <div className="lab-tabs" role="tablist">
        {TABS.map(([k, label, sub]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <b>{label}</b>
            <small>{sub}</small>
          </button>
        ))}
      </div>
      <div className="lab-body">
        {tab === 'ask' && <AskMatch match={match} seed={DEFAULT_SEED} />}
        {tab === 'guess' && <SecondGuess key={focusId ?? 'none'} match={match} focusId={focusId} />}
        {tab === 'analytics' && <AnalyticsBoard match={match} onSecondGuess={(id) => { setFocusId(id); setTab('guess'); }} />}
        {tab === 'film' && <MatchFilm match={match} lang={prefs.lang} mode={prefs.mode} />}
      </div>
    </section>
  );
}
