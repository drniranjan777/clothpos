// Inline SVG charts matching the approved design (ui/assets/app.js bars/line/donut).
import { useId } from 'react';

function fmtK(v: number) {
  if (v >= 1e7) return (v / 1e7).toFixed(1).replace('.0', '') + 'Cr';
  if (v >= 1e5) return (v / 1e5).toFixed(1).replace('.0', '') + 'L';
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace('.0', '') + 'k';
  return String(Math.round(v));
}

const Grid = ({ W, H, max, pad }: { W: number; H: number; max: number; pad: number }) => (
  <>
    {[0, 1, 2, 3, 4].map((i) => {
      const y = H - (H * i) / 4;
      return (
        <g key={i}>
          <line x1={pad} x2={W} y1={y} y2={y} stroke="#eef1f6" />
          <text x={pad - 6} y={y + 3} textAnchor="end" fontSize="9.5" fill="#94a3b8">{fmtK((max * i) / 4)}</text>
        </g>
      );
    })}
  </>
);

/** Bar chart; pass `series2` for paired bars. Width is responsive via viewBox. */
export function Bars({ data, series2, labels, height = 180, width = 640, title }: { data: number[]; series2?: number[]; labels: string[]; height?: number; width?: number; title?: (i: number) => string }) {
  const H = height, W = width, pad = 30;
  const max = Math.max(1, ...data, ...(series2 ?? [])) * 1.15;
  const bw = (W - pad) / Math.max(1, data.length);
  return (
    <svg viewBox={`0 -8 ${W} ${H + 30}`} width="100%" height={H + 30} preserveAspectRatio="none" role="img">
      <Grid W={W} H={H} max={max} pad={pad} />
      {data.map((v, i) => {
        const x = pad + i * bw;
        const w = series2 ? bw * 0.32 : bw * 0.56;
        const off = series2 ? bw * 0.16 : bw * 0.22;
        const h = (H * v) / max;
        const last = i === data.length - 1 && !series2;
        return (
          <g key={i}>
            <rect x={x + off} y={H - h} width={w} height={Math.max(h, 0)} rx={3} fill={series2 || last ? '#1d4ed8' : '#bfd0f8'}>
              {title && <title>{title(i)}</title>}
            </rect>
            {series2 && <rect x={x + off + w + 2} y={H - (H * series2[i]) / max} width={w} height={(H * series2[i]) / max} rx={3} fill="#93c5fd" />}
            {labels[i] && <text x={x + bw / 2} y={H + 15} textAnchor="middle" fontSize="9.5" fill="#94a3b8">{labels[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function Line({ data, previous, labels, height = 190, width = 760 }: { data: number[]; previous?: number[]; labels: string[]; height?: number; width?: number }) {
  const gid = useId().replace(/:/g, '');
  const H = height, W = width, pad = 34;
  const max = Math.max(1, ...data, ...(previous ?? [])) * 1.15;
  const step = (W - pad - 6) / Math.max(1, data.length - 1);
  const pts = (a: number[]) => a.map((v, i) => [pad + i * step, H - (H * v) / max] as const);
  const path = (p: readonly (readonly [number, number])[]) => p.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ');
  const p = pts(data);
  const L = p[p.length - 1];
  return (
    <svg viewBox={`0 -8 ${W} ${H + 30}`} width="100%" height={H + 30} preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d4ed8" stopOpacity=".18" />
          <stop offset="1" stopColor="#1d4ed8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <Grid W={W} H={H} max={max} pad={pad} />
      {previous && <path d={path(pts(previous))} fill="none" stroke="#a5b4fc" strokeWidth={2} strokeDasharray="4 4" />}
      {p.length > 1 && <path d={`${path(p)} L${L[0]} ${H} L${pad} ${H}Z`} fill={`url(#${gid})`} />}
      <path d={path(p)} fill="none" stroke="#1d4ed8" strokeWidth={2.4} />
      {L && <circle cx={L[0]} cy={L[1]} r={4.5} fill="#fff" stroke="#1d4ed8" strokeWidth={2.4} />}
      {labels.map((t, i) => t && <text key={i} x={pad + i * step} y={H + 15} textAnchor="middle" fontSize="9.5" fill="#94a3b8">{t}</text>)}
    </svg>
  );
}

export function Donut({ data, colors, r = 60, t = 18, children }: { data: number[]; colors: string[]; r?: number; t?: number; children?: React.ReactNode }) {
  const tot = data.reduce((a, b) => a + b, 0) || 1;
  const C = 2 * Math.PI * r;
  const size = 2 * r + t;
  let off = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef1f6" strokeWidth={t} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {data.map((v, i) => {
            const len = (C * v) / tot;
            const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors[i % colors.length]} strokeWidth={t} strokeDasharray={`${Math.max(len - 2, 0)} ${C}`} strokeDashoffset={-off} />;
            off += len;
            return el;
          })}
        </g>
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{children}</div>
    </div>
  );
}

export const PALETTE = ['#1d4ed8', '#22c55e', '#f59e0b', '#a78bfa', '#06b6d4', '#ef4444', '#64748b'];
