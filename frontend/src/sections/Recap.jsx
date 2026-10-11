import { useMemo, useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import SpotlightCard from '../components/reactbits/SpotlightCard';
import ElectricBorder from '../components/reactbits/ElectricBorder';
import { buildRecap } from '../engine/narrator';
import { TEAMS } from '../engine/data';
import { usePrefs } from '../studio/prefs';

gsap.registerPlugin(useGSAP);

export default function Recap({ match }) {
  const { lang, mode } = usePrefs();
  const root = useRef(null);
  const { snap, motm, finished } = match;
  const recap = useMemo(() => buildRecap(snap, motm, { lang, mode }), [snap, motm, lang, mode]);
  const rtl = lang === 'ar';

  useGSAP(
    () => {
      gsap.from('.recap-reveal', { y: 50, opacity: 0, duration: 0.9, stagger: 0.12, ease: 'power3.out', scrollTrigger: { trigger: root.current, start: 'top 78%' } });
    },
    { scope: root }
  );

  const download = () => {
    const md = [
      `# ${recap.title}`,
      '',
      recap.lead,
      '',
      `## ${recap.labels.moments}`,
      ...recap.moments.map((m) => `- ${m.minute}' ${m.headline}${m.why ? ': ' + m.why : ''}`),
      '',
      '## Stats',
      ...recap.stats.map(([k, h, a]) => `- ${k}: ${h} – ${a}`),
      recap.motm ? `\n**${recap.labels.motm}:** ${recap.motm.name} (${recap.motm.rating})` : '',
      '',
      '_Synthetic data. Fictional clubs and players._',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'match-recap.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="section recap" id="recap" ref={root}>
      <div className="section-head recap-reveal">
        <span className="eyebrow">Automated recap</span>
        <h2>The full-time report writes itself.</h2>
        <p>
          {finished
            ? 'Final report, generated from the match state and its ranked moments. Switch language or mode above and it rewrites.'
            : 'This recap is live: it rebuilds as the match plays and becomes the final report at full time.'}
        </p>
        <div className="recap-actions">
          {!finished && (
            <button className="btn-primary" onClick={() => match.seek(5400)}>
              Skip to full time
            </button>
          )}
          <button className="btn-ghost" onClick={download}>
            Download as Markdown
          </button>
        </div>
      </div>

      <div className="recap-grid" dir={rtl ? 'rtl' : 'ltr'}>
        <SpotlightCard className="panel recap-main recap-reveal" spotlightColor="rgba(56,248,199,.12)">
          <small className="recap-kicker">{finished ? recap.labels.fullTime : `${snap.minute}'`}</small>
          <h3>{recap.title}</h3>
          <p className="recap-lead">{recap.lead}</p>
          <h4>{recap.labels.moments}</h4>
          <ul className="moments">
            {recap.moments.length === 0 && <li className="muted">{recap.labels.quiet}</li>}
            {recap.moments.map((m, i) => (
              <li key={i}>
                <span>{m.minute}'</span>
                <div>
                  <b>{m.headline}</b>
                  {m.why && <p>{m.why}</p>}
                  {m.metrics && <code>{m.metrics}</code>}
                </div>
              </li>
            ))}
          </ul>
        </SpotlightCard>

        <div className="recap-side recap-reveal">
          <SpotlightCard className="panel" spotlightColor="rgba(255,93,143,.12)">
            <table className="stat-table">
              <thead>
                <tr>
                  <th />
                  <th style={{ color: TEAMS.home.color }}>{TEAMS.home.short}</th>
                  <th style={{ color: TEAMS.away.color }}>{TEAMS.away.short}</th>
                </tr>
              </thead>
              <tbody>
                {recap.stats.map(([k, h, a]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{h}</td>
                    <td>{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SpotlightCard>
          {recap.motm && (
            <ElectricBorder color={TEAMS[recap.motm.team].color} speed={1} chaos={0.1} borderRadius={20}>
              <div className="motm">
                <small>{recap.labels.motm}</small>
                <h4>{recap.motm.name}</h4>
                <span>{TEAMS[recap.motm.team].name} · {recap.motm.rating}</span>
              </div>
            </ElectricBorder>
          )}
        </div>
      </div>
    </section>
  );
}
