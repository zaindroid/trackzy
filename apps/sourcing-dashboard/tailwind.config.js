/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: 'rgb(var(--color-paper) / <alpha-value>)',
          raised: 'rgb(var(--color-paper-raised) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
          muted: 'rgb(var(--color-ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--color-ink-faint) / <alpha-value>)',
        },
        rule: 'rgb(var(--color-rule) / <alpha-value>)',
        signal: {
          DEFAULT: 'rgb(var(--color-signal) / <alpha-value>)',
          ink: 'rgb(var(--color-signal-ink) / <alpha-value>)',
        },
        freight: 'rgb(var(--color-freight) / <alpha-value>)',
        moss: 'rgb(var(--color-moss) / <alpha-value>)',
        ochre: 'rgb(var(--color-ochre) / <alpha-value>)',
        brick: 'rgb(var(--color-brick) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Big Shoulders Display"', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        raised: '0 1px 3px rgb(0 0 0 / 0.04)',
      },
      keyframes: {
        creditsEnter: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        creditsEnter: 'creditsEnter 180ms cubic-bezier(0.23,1,0.32,1)',
      },
    },
  },
  plugins: [],
};
