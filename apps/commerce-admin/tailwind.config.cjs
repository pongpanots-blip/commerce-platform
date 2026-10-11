/**
 * Tailwind only for the josh pages copied into commerce-admin (marketing workflow editor), with josh
 * web-admin's theme. No preflight and everything scoped under `.josh-tw`, so the rest of
 * commerce-admin's own CSS is untouched.
 */
/** A CSS-variable colour that still takes opacity modifiers (bg-primary/10); `mix` < 100 lightens it toward white. */
const tone = (name, mix = 100) => mix === 100
  ? `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`
  : `color-mix(in srgb, color-mix(in srgb, var(${name}) ${mix}%, white) calc(<alpha-value> * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [__dirname + '/src/app/pages/workflow-editor/josh/**/*.{ts,tsx}', __dirname + '/src/josh-admin/**/*.{ts,tsx}'],
  important: '.josh-tw',
  corePlugins: { preflight: false },
  theme: {
    extend: {
      fontFamily: { sans: ['"Noto Sans Thai"', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        // The shared tokens (libs/ui/theme.css, overridden by the workspace shell), so josh pages match the rest.
        primary: { DEFAULT: tone('--color-primary'), dark: tone('--color-primary-dim'), light: tone('--color-primary', 70), soft: tone('--color-primary-container'), border: 'var(--color-secondary-container)' },
        // josh pages use blue/indigo as their link and action colour: map them onto the brand colour too.
        blue: { 50: tone('--color-primary-container'), 100: tone('--color-primary-container'), 200: tone('--color-primary-fixed-dim'), 500: tone('--color-primary'), 600: tone('--color-primary'), 700: tone('--color-primary-dim'), 800: tone('--color-primary-dim') },
        indigo: { 50: tone('--color-primary-container'), 600: tone('--color-primary'), 700: tone('--color-primary-dim') },
        // Status tones (design.md), so josh pages can use text-danger / bg-ok-container like the rest of the app.
        ok: { DEFAULT: tone('--color-ok'), container: tone('--color-ok-container') },
        info: { DEFAULT: tone('--color-info'), container: tone('--color-info-container') },
        warn: { DEFAULT: tone('--color-warn'), container: tone('--color-warn-container') },
        danger: { DEFAULT: tone('--color-danger'), dim: tone('--color-danger-dim'), container: tone('--color-danger-container') },
        outline: { DEFAULT: 'var(--color-outline)', variant: 'var(--color-outline-variant)' },
        alert: { DEFAULT: tone('--color-danger'), dark: tone('--color-danger-dim'), soft: tone('--color-danger-container'), light: tone('--color-danger', 70) },
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
