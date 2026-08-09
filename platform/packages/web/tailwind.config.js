/**
 * Tailwind wired directly to the design tokens in `09_Design_System.md`.
 *
 * Every colour, size and radius resolves to a CSS custom property emitted by
 * `src/styles/tokens.css`. Components therefore never contain an ad-hoc hex or
 * px value (09 §1.4), and dark mode is a re-theme rather than a rebuild (09 §11).
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        page: 'var(--bg-page)',
        surface: 'var(--bg-surface)',
        raised: 'var(--bg-raised)',
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          subtle: 'var(--primary-subtle)',
        },
        ink: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        hairline: 'var(--border)',
        grid: 'var(--grid)',
        status: {
          good: 'var(--status-good)',
          warn: 'var(--status-warn)',
          serious: 'var(--status-serious)',
          critical: 'var(--status-critical)',
        },
        series: {
          1: 'var(--series-1)',
          2: 'var(--series-2)',
          3: 'var(--series-3)',
          4: 'var(--series-4)',
          5: 'var(--series-5)',
          6: 'var(--series-6)',
          7: 'var(--series-7)',
          8: 'var(--series-8)',
        },
      },
      fontFamily: {
        sans: ['var(--font-stack)'],
      },
      fontSize: {
        // 09 §4 type scale — [size, { lineHeight, fontWeight }]
        display: ['40px', { lineHeight: '44px', fontWeight: '600' }],
        h1: ['28px', { lineHeight: '34px', fontWeight: '600' }],
        h2: ['22px', { lineHeight: '28px', fontWeight: '600' }],
        h3: ['18px', { lineHeight: '24px', fontWeight: '600' }],
        body: ['15px', { lineHeight: '22px', fontWeight: '400' }],
        label: ['13px', { lineHeight: '18px', fontWeight: '500' }],
        caption: ['12px', { lineHeight: '16px', fontWeight: '400' }],
        kpi: ['32px', { lineHeight: '36px', fontWeight: '700' }],
      },
      spacing: {
        // 09 §5 — 4px base
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        5: '24px',
        6: '32px',
        7: '48px',
        8: '64px',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        'elev-0': 'none',
        'elev-1': 'var(--elev-1)',
        'elev-2': 'var(--elev-2)',
        'elev-3': 'var(--elev-3)',
      },
      maxWidth: {
        container: '1440px',
      },
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1440px',
      },
      transitionDuration: {
        DEFAULT: 'var(--motion-duration)',
      },
    },
  },
  plugins: [],
};
