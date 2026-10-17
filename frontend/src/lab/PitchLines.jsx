import { H, W } from './geometry';

// Pitch markings in a 105 x 68 coordinate space (metres), shared by the lab views.
export default function PitchLines() {
  const line = { fill: 'none', stroke: 'rgba(255,255,255,.3)', strokeWidth: 0.25 };
  return (
    <g>
      <rect width={W} height={H} fill="#07151a" />
      {Array.from({ length: 12 }).map((_, i) => (
        <rect key={i} x={(W / 12) * i} y={0} width={W / 12} height={H} fill={i % 2 ? 'rgba(255,255,255,.02)' : 'rgba(255,255,255,0)'} />
      ))}
      <rect x="0.4" y="0.4" width={W - 0.8} height={H - 0.8} {...line} />
      <line x1={W / 2} y1="0.4" x2={W / 2} y2={H - 0.4} {...line} />
      <circle cx={W / 2} cy={H / 2} r="9.15" {...line} />
      <rect x="0.4" y="13.84" width="16.5" height="40.32" {...line} />
      <rect x="0.4" y="24.84" width="5.5" height="18.32" {...line} />
      <rect x={W - 16.9} y="13.84" width="16.5" height="40.32" {...line} />
      <rect x={W - 5.9} y="24.84" width="5.5" height="18.32" {...line} />
      <rect x="-1.2" y="30.34" width="1.6" height="7.32" {...line} />
      <rect x={W - 0.4} y="30.34" width="1.6" height="7.32" {...line} />
    </g>
  );
}
