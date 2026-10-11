import ScrollReveal from '../components/reactbits/ScrollReveal';

export default function Story() {
  return (
    <section className="section story" id="story">
      <ScrollReveal baseOpacity={0.12} enableBlur baseRotation={2} blurStrength={6} textClassName="story-text">
        Football stories do not end at the scoreline. Behind every goal is a pressing trigger, a pass that broke a line, a shift in rhythm nobody put on screen. We turn raw match events into explanations people actually want to read, in their language, about their club.
      </ScrollReveal>
      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {Array.from({ length: 2 }).map((_, k) => (
            <div key={k} className="marquee-set">
              {['Ingest', 'Interpret', 'Explain', 'Render', 'Personalize'].map((w) => (
                <span key={w + k}>
                  {w} <i />
                </span>
              ))}
              {['Ingest', 'Interpret', 'Explain', 'Render', 'Personalize'].map((w) => (
                <span key={w + k + 'b'}>
                  {w} <i />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
