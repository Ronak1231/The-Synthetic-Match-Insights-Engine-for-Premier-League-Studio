import { createContext, useContext } from 'react';

export const PrefsContext = createContext(null);
export const usePrefs = () => useContext(PrefsContext);

export const METRICS = {
  all: { label: 'All', kinds: null },
  xg: { label: 'xG & chances', kinds: ['goal', 'big_chance', 'power_shot'] },
  speed: { label: 'Speed', kinds: ['sprint', 'power_shot'] },
  pass: { label: 'Pass quality', kinds: ['key_pass', 'milestone_passes'] },
  pressure: { label: 'Pressure & rhythm', kinds: ['press_wave', 'momentum_shift', 'chaos', 'control', 'milestone_tackles'] },
};

// Personalize stage: decides which insights this viewer should see.
export function filterInsights(insights, prefs) {
  const { mode, fav, focus, metric } = prefs;
  let list = insights;
  const lens = METRICS[metric]?.kinds;
  if (lens) list = list.filter((i) => lens.includes(i.kind) || i.kind === 'goal');
  if (mode === 'casual') list = list.filter((i) => i.importance >= 0.5);
  if (mode === 'player' && focus) {
    const [team, n] = focus.split(':');
    list = list.filter(
      (i) => (i.team === team && String(i.player) === n) || i.kind === 'goal' || (i.team === team && i.importance >= 0.6 && i.player === null)
    );
  }
  if (fav !== 'none') {
    // Favourite club: keep everything but never hide the fan's own club's moments.
    list = list.filter((i) => i.team === fav || i.importance >= 0.55);
  }
  return list;
}
