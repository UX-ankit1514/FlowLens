/**
 * Hero illustration: a user's journey runs across the page, and a lens hovers
 * over the one place it loops back on itself. Inside the lens the path is
 * magnified, and the amber point marks the friction found.
 *
 * Pure SVG with no state. It renders on the server, so the geometry below is
 * computed once and never re-run (or re-hydrated) in the browser. The grainy
 * "spray" look comes from an SVG filter that dithers soft shapes against noise.
 */

const VIEW = { w: 1440, h: 600 };
const LENS = { cx: 744, cy: 192, r: 150, magnify: 1.5 };
const TILT = (-11 * Math.PI) / 180; // the journey rises gently to the right
const UNIT = 22; // px per curve unit
const LOOP = { a: 1, b: 2.7, spread: 4 }; // one trochoid loop, faded out by a Gaussian window
const STEP_AT = [-30, -21, -12.5, 12.5, 21.5, 30]; // journey steps outside the lens

type Point = [number, number];

const round = (n: number) => Math.round(n * 10) / 10;
const dir: Point = [Math.cos(TILT), Math.sin(TILT)];
const left: Point = [dir[1], -dir[0]];

function local(t: number): Point {
  const w = Math.exp(-((t / LOOP.spread) ** 2));
  const along = LOOP.a * t - LOOP.b * Math.sin(t) * w;
  const across = (LOOP.b * Math.cos(t) - LOOP.a) * w + 0.9 * Math.sin(t / 8);
  return [UNIT * (along * dir[0] + across * left[0]), UNIT * (along * dir[1] + across * left[1])];
}

// Where the loop crosses itself (t > 0), by Newton's method on the along-track position.
function crossingT(): number {
  const along = (t: number) => LOOP.a * t - LOOP.b * Math.sin(t) * Math.exp(-((t / LOOP.spread) ** 2));
  let t = 2;
  for (let i = 0; i < 40; i++) {
    const h = 1e-4;
    t -= along(t) / ((along(t + h) - along(t - h)) / (2 * h));
  }
  return t;
}

// Place the loop so its centre sits exactly under the lens centre.
const loopTop = local(0);
const loopCross = local(crossingT());
const offset: Point = [LENS.cx - (loopTop[0] + loopCross[0]) / 2, LENS.cy - (loopTop[1] + loopCross[1]) / 2];
const at = (t: number): Point => {
  const p = local(t);
  return [p[0] + offset[0], p[1] + offset[1]];
};

/** Catmull-Rom through the samples, as cubic Béziers. */
function smoothPath(points: Point[]): string {
  let d = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    d += `C${round(p1[0] + (p2[0] - p0[0]) / 6)} ${round(p1[1] + (p2[1] - p0[1]) / 6)} ${round(p2[0] - (p3[0] - p1[0]) / 6)} ${round(p2[1] - (p3[1] - p1[1]) / 6)} ${round(p2[0])} ${round(p2[1])}`;
  }
  return d;
}

const samples: Point[] = [];
for (let t = -36; t <= 36.0001; t += Math.abs(t) < 7 ? 0.3 : 1) samples.push(at(t));
const JOURNEY = smoothPath(samples);
const STEPS = STEP_AT.map(at).map(([x, y]) => [round(x), round(y)] as Point);
const MAGNIFY = `translate(${LENS.cx} ${LENS.cy}) scale(${LENS.magnify}) translate(${-LENS.cx} ${-LENS.cy})`;

const { cx, cy, r } = LENS;

export function JourneyArt() {
  return (
    <>
      <svg className="fl-art" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMin slice" aria-hidden="true" focusable="false">
        <defs>
          <filter id="fl-spray" x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="soft" />
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={11} result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="noiseAlpha" />
            <feComponentTransfer in="noiseAlpha" result="spread">
              <feFuncA type="linear" slope="2.6" intercept="-0.8" />
            </feComponentTransfer>
            <feComposite in="soft" in2="spread" operator="arithmetic" k1="0" k2="1" k3="-1" k4="0.48" result="diff" />
            <feComponentTransfer in="diff" result="dots">
              <feFuncA type="discrete" tableValues="0 1" />
            </feComponentTransfer>
            <feFlood floodColor="#fff" result="white" />
            <feComposite in="white" in2="dots" operator="in" />
          </filter>
          <linearGradient id="fl-road" x1="0" y1="0" x2={VIEW.w} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff" stopOpacity="0.18" />
            <stop offset="0.38" stopColor="#fff" stopOpacity="0.8" />
            <stop offset="0.62" stopColor="#fff" stopOpacity="0.8" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.22" />
          </linearGradient>
          <linearGradient id="fl-rim" x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.55" stopColor="#fff" stopOpacity="0.75" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.3" />
          </linearGradient>
          <radialGradient id="fl-glass" cx={cx} cy={cy} r={r} gradientUnits="userSpaceOnUse">
            <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.2" />
          </radialGradient>
          <radialGradient id="fl-shadow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#0A1A5C" stopOpacity="0.45" />
            <stop offset="1" stopColor="#0A1A5C" stopOpacity="0" />
          </radialGradient>
          <mask id="fl-outside-lens">
            <rect width={VIEW.w} height={VIEW.h} fill="#fff" />
            <circle cx={cx} cy={cy} r={r + 16} fill="#000" />
          </mask>
          <clipPath id="fl-inside-lens">
            <circle cx={cx} cy={cy} r={r - 10} />
          </clipPath>
        </defs>

        <ellipse cx={cx + 60} cy={cy + r + 70} rx={r * 1.05} ry="46" fill="url(#fl-shadow)" />

        <g filter="url(#fl-spray)">
          <g mask="url(#fl-outside-lens)">
            <path d={JOURNEY} stroke="url(#fl-road)" strokeWidth="26" strokeLinecap="round" fill="none" />
            {STEPS.map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="17" fill="#fff" fillOpacity="0.95" />
            ))}
          </g>
          <g clipPath="url(#fl-inside-lens)">
            <circle cx={cx} cy={cy} r={r} fill="url(#fl-glass)" />
            <g transform={MAGNIFY}>
              <path d={JOURNEY} stroke="#fff" strokeOpacity="0.95" strokeWidth="22" strokeLinecap="round" fill="none" />
            </g>
            <path
              d={`M${cx - 104} ${cy - 30} A ${r - 36} ${r - 36} 0 0 1 ${cx - 30} ${cy - 108}`}
              stroke="#fff"
              strokeOpacity="0.8"
              strokeWidth="12"
              strokeLinecap="round"
              fill="none"
            />
          </g>
          <circle cx={cx} cy={cy} r={r} stroke="url(#fl-rim)" strokeWidth="22" fill="none" />
        </g>
      </svg>
      {/* The focus point lives in its own layer so its pulse never repaints the filtered art. */}
      <svg className="fl-art fl-focus" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMin slice" aria-hidden="true" focusable="false">
        <circle className="fl-ping" cx={cx} cy={cy} r="16" fill="none" stroke="#FFB547" strokeWidth="4" />
        <circle cx={cx} cy={cy} r="15" fill="#FFB547" />
      </svg>
    </>
  );
}
