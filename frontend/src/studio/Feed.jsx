import { TEAMS } from '../engine/data';
import { narrate, toOverlayCue, ui } from '../engine/narrator';
import { usePrefs } from './prefs';

const KIND_LABEL = {
  goal: 'Goal', big_chance: 'Chance', momentum_shift: 'Momentum', press_wave: 'Pressing', chaos: 'Rhythm', control: 'Control',
  sprint: 'Speed', power_shot: 'Shot speed', milestone_passes: 'Milestone', milestone_tackles: 'Milestone', card: 'Discipline', key_pass: 'Pass quality',
};

export default function Feed({ insights }) {
  const { lang, mode, fav } = usePrefs();
  const items = [...insights].reverse().slice(0, 16);
  const rtl = lang === 'ar';

  return (
    <div className="feed" data-lenis-prevent dir={rtl ? 'rtl' : 'ltr'} aria-live="polite">
      {items.length === 0 && <p className="feed-empty">{ui(lang).quiet}</p>}
      {items.map((ins) => {
        const n = narrate(ins, { lang, mode });
        const mine = fav !== 'none' && fav === ins.team;
        return (
          <article key={ins.id} className={`card ${ins.kind === 'goal' ? 'card-goal' : ''}`} style={{ '--c': TEAMS[ins.team].color }}>
            <header>
              <span className="min">{ins.minute}'</span>
              <span className="kind">{KIND_LABEL[ins.kind]}</span>
              {mine && <span className="mine">Your club</span>}
              {n.source === 'llm' && <span className="ai-tag" title="Written by the narrator agent's language model and checked against the match facts">AI</span>}
            </header>
            <h5>{n.headline}</h5>
            {mode !== 'broadcast' && n.why && <p>{n.why}</p>}
            {mode === 'analyst' && n.metrics && <code className="metrics">{n.metrics}</code>}
            {mode === 'broadcast' && <pre className="cue">{JSON.stringify(toOverlayCue(ins, lang), null, 1)}</pre>}
          </article>
        );
      })}
    </div>
  );
}
