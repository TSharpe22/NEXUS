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
      }
    }
  },
  plugins: []
}
