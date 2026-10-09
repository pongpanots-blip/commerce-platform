/**
 * Tailwind only for the josh pages copied into commerce-admin (marketing workflow editor), with josh
 * web-admin's theme. No preflight and everything scoped under `.josh-tw`, so the rest of
 * commerce-admin's own CSS is untouched.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [__dirname + '/src/app/pages/workflow-editor/josh/**/*.{ts,tsx}', __dirname + '/src/josh-admin/**/*.{ts,tsx}'],
  important: '.josh-tw',
  corePlugins: { preflight: false },
  theme: {
    extend: {
      fontFamily: { sans: ['"Noto Sans Thai"', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        primary: { DEFAULT: '#365cf5', dark: '#2948d4', light: '#6b86ff', soft: '#e8edff', border: 'var(--color-secondary-container)' },
        alert: { DEFAULT: '#BF0013', dark: '#7B0008', soft: '#FFF2F0', light: '#FF5E54' },
        ink: { DEFAULT: 'var(--color-on-surface)', secondary: 'var(--color-on-surface-variant)', muted: 'var(--color-outline)', disabled: 'var(--color-outline-variant)' },
        surface: { disabled: 'var(--color-surface-container-low)', 'container-lowest': 'var(--color-surface-container-lowest)', 'container-low': 'var(--color-surface-container-low)' },
        'on-surface': 'var(--color-on-surface)',
        'on-surface-variant': 'var(--color-on-surface-variant)',
        'secondary-container': 'var(--color-secondary-container)',
        line: 'var(--color-secondary-container)',
      },
      boxShadow: { 'level-1': '0 1px 3px rgba(20,30,60,0.06)' },
    },
  },
  plugins: [],
};
