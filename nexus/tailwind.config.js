/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        nx: {
          bg: 'var(--nx-bg)',
          'bg-base': 'var(--nx-bg-base)',
          'bg-surface': 'var(--nx-bg-surface)',
          'bg-elevated': 'var(--nx-bg-elevated)',
          'bg-secondary': 'var(--nx-bg-secondary)',
          'bg-tertiary': 'var(--nx-bg-tertiary)',
          'bg-hover': 'var(--nx-bg-hover)',
          'bg-active': 'var(--nx-bg-active)',
          border: 'var(--nx-border)',
          'border-subtle': 'var(--nx-border-subtle)',
          'border-default': 'var(--nx-border-default)',
          text: 'var(--nx-text)',
          'text-primary': 'var(--nx-text-primary)',
          'text-secondary': 'var(--nx-text-secondary)',
          'text-tertiary': 'var(--nx-text-tertiary)',
          accent: 'var(--nx-accent)',
          'accent-hover': 'var(--nx-accent-hover)',
          'accent-muted': 'var(--nx-accent-muted)',
          danger: 'var(--nx-danger)',
          'danger-hover': 'var(--nx-danger-hover)',
          success: 'var(--nx-success)',
        }
      },
      fontFamily: {
        sans: ['var(--nx-font-body)'],
        mono: ['var(--nx-font-mono)'],
      },
      fontSize: {
        '2xs': '0.65rem',
      },
      // Bare `rounded` is 4px in Tailwind's defaults — the spec's absolute
      // ceiling. Chips and inputs want 2px, so point the default at the token
      // rather than hunting every `rounded` in the tree.
      borderRadius: {
        DEFAULT: 'var(--nx-radius-sm)',
        sm: 'var(--nx-radius-sm)',
        md: 'var(--nx-radius-md)',
        lg: 'var(--nx-radius-lg)',
        xl: 'var(--nx-radius-xl)',
      },
      // Motion is near-instant: 80-120ms, nothing slower. 150/500 are gone.
      transitionDuration: {
        75: '80ms',
        100: '80ms',
        150: '120ms',
        500: '120ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'ease-out',
      }
    }
  },
  plugins: []
}
