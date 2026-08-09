/**
 * Design tokens — implements PRD `09_Design_System.md`.
 *
 * LAW DOCUMENT. Colours, spacing, type and radius come from named tokens only.
 * No ad-hoc hex or px in components (09 §1.4).
 *
 * Direction: Modern SaaS, light. Dark values are declared now so dark mode ships
 * later as configuration, not a refactor (09 §11).
 */

// ─── 09 §2 · Colour foundation ───────────────────────────────────────────────

export const FOUNDATION = {
  light: {
    '--bg-page': '#f9f9f7',
    '--bg-surface': '#ffffff',
    '--bg-raised': '#fcfcfb',
    '--text-primary': '#0b0b0b',
    '--text-secondary': '#52514e',
    '--text-muted': '#898781',
    '--border': 'rgba(11,11,11,0.10)',
    '--grid': '#e1e0d9',
  },
  dark: {
    '--bg-page': '#141413',
    '--bg-surface': '#1a1a19',
    '--bg-raised': '#232322',
    '--text-primary': '#f5f4ef',
    '--text-secondary': '#b8b6ae',
    '--text-muted': '#8a887f',
    '--border': 'rgba(245,244,239,0.12)',
    '--grid': '#33322e',
  },
} as const;

/** 09 §2.1 — a single institutional blue, same hue family as the sequential ramp. */
export const PRIMARY = {
  light: {
    '--primary': '#256abf',
    '--primary-hover': '#1c5cab',
    '--primary-subtle': '#cde2fb',
  },
  dark: {
    '--primary': '#4a90e2',
    '--primary-hover': '#6ba5ea',
    '--primary-subtle': '#1b3354',
  },
} as const;

/**
 * 09 §2.2 — semantic/status. FIXED: never used as a series colour, so a status
 * can never impersonate a data series. Always ships with an icon + label.
 */
export const STATUS = {
  good: '#0ca30c',
  warn: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;
export type StatusKey = keyof typeof STATUS;

/**
 * 09 §3 · Categorical data-viz palette — validated, colourblind-safe.
 * Assigned in ORDER, never cycled. Colour follows the entity, not its rank.
 */
export const SERIES_PALETTE = [
  { slot: 1, hue: 'blue', light: '#2a78d6', dark: '#3987e5' },
  { slot: 2, hue: 'orange', light: '#eb6834', dark: '#d95926' },
  { slot: 3, hue: 'aqua', light: '#1baf7a', dark: '#199e70' },
  { slot: 4, hue: 'yellow', light: '#eda100', dark: '#c98500' },
  { slot: 5, hue: 'magenta', light: '#e87ba4', dark: '#d55181' },
  { slot: 6, hue: 'green', light: '#008300', dark: '#008300' },
  { slot: 7, hue: 'violet', light: '#4a3aa7', dark: '#9085e9' },
  { slot: 8, hue: 'red', light: '#e34948', dark: '#e66767' },
] as const;

/**
 * Slots 3, 4 and 5 sit below 3:1 on white → the RELIEF RULE applies (09 §3):
 * ship visible direct labels or the table view. Both are required by 04 §8 anyway.
 */
export const RELIEF_REQUIRED_SLOTS = [3, 4, 5] as const;

/** Scatter/bubble/small-multiples cap at the first three slots (09 §3). */
export const SCATTER_MAX_SLOTS = 3;

/** 09 §3 — sequential (utilisation intensity, heat maps): one hue, light→dark. */
export const SEQUENTIAL_BLUE = [
  '#cde2fb',
  '#a6c9f2',
  '#7aade8',
  '#4f8fdb',
  '#2a78d6',
  '#1c5cab',
  '#134a8c',
  '#0d366b',
] as const;

/** 09 §3 — diverging (variance vs plan): blue ↔ red, neutral grey midpoint. */
export const DIVERGING = {
  negative: ['#0d366b', '#2a78d6', '#a6c9f2'],
  midpoint: '#f0efec',
  positive: ['#f2a9a8', '#e34948', '#a32423'],
} as const;

/**
 * Entity-stable colour assignment (09 §3, non-negotiable rule 1).
 * A filter that drops series must not repaint the survivors, so the slot is
 * derived from a stable hash of the entity key, not from its position.
 */
export function colourSlotFor(entityKey: string): number {
  let h = 0;
  for (let i = 0; i < entityKey.length; i++) {
    h = (h * 31 + entityKey.charCodeAt(i)) >>> 0;
  }
  return (h % SERIES_PALETTE.length) + 1;
}

export function seriesColour(slot: number, theme: 'light' | 'dark' = 'light'): string {
  const entry = SERIES_PALETTE[(slot - 1) % SERIES_PALETTE.length];
  return theme === 'dark' ? entry.dark : entry.light;
}

/** Utilisation band → sequential ramp step. Intensity, not identity. */
export function utilisationRamp(pct: number): string {
  const idx = Math.min(SEQUENTIAL_BLUE.length - 1, Math.max(0, Math.round(pct * (SEQUENTIAL_BLUE.length - 1))));
  return SEQUENTIAL_BLUE[idx];
}

// ─── 09 §4 · Typography ──────────────────────────────────────────────────────

export const TYPE_SCALE = {
  display: { size: 40, line: 44, weight: 600 },
  h1: { size: 28, line: 34, weight: 600 },
  h2: { size: 22, line: 28, weight: 600 },
  h3: { size: 18, line: 24, weight: 600 },
  body: { size: 15, line: 22, weight: 400 },
  label: { size: 13, line: 18, weight: 500 },
  caption: { size: 12, line: 16, weight: 400 },
  kpi: { size: 32, line: 36, weight: 700 },
} as const;

export const FONT_STACK = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// ─── 09 §5 · Spacing, radius, grid ───────────────────────────────────────────

export const SPACING = [4, 8, 12, 16, 24, 32, 48, 64] as const;
export const RADIUS = { sm: 6, md: 10, lg: 14, bar: 4 } as const;
export const CONTAINER_MAX = 1440;
export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1440 } as const;

// ─── 09 §6 · Elevation ───────────────────────────────────────────────────────

export const ELEVATION = {
  0: 'none',
  1: '0 1px 2px rgba(11,11,11,.06)',
  2: '0 4px 12px rgba(11,11,11,.08)',
  3: '0 12px 32px rgba(11,11,11,.12)',
} as const;

// ─── 09 §10 · Motion ─────────────────────────────────────────────────────────

export const MOTION = { duration: '160ms', easing: 'cubic-bezier(0.4, 0, 0.2, 1)' } as const;

/** Emit the full token set as CSS custom properties for a theme. */
export function tokensToCSS(theme: 'light' | 'dark'): string {
  const vars: Record<string, string> = {
    ...FOUNDATION[theme],
    ...PRIMARY[theme],
    '--status-good': STATUS.good,
    '--status-warn': STATUS.warn,
    '--status-serious': STATUS.serious,
    '--status-critical': STATUS.critical,
    '--elev-0': ELEVATION[0],
    '--elev-1': ELEVATION[1],
    '--elev-2': ELEVATION[2],
    '--elev-3': ELEVATION[3],
    '--radius-sm': `${RADIUS.sm}px`,
    '--radius-md': `${RADIUS.md}px`,
    '--radius-lg': `${RADIUS.lg}px`,
    '--font-stack': FONT_STACK,
    '--motion-duration': MOTION.duration,
    '--motion-easing': MOTION.easing,
  };
  for (const s of SERIES_PALETTE) {
    vars[`--series-${s.slot}`] = theme === 'dark' ? s.dark : s.light;
  }
  SEQUENTIAL_BLUE.forEach((c, i) => {
    vars[`--seq-${i + 1}`] = c;
  });
  return Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
}
