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
        primary: { DEFAULT: '#365cf5', dark: '#2648d8', light: '#6b86ff', soft: '#eef2ff', border: '#dce3ef' },
        alert: { DEFAULT: '#BF0013', dark: '#7B0008', soft: '#FFF2F0', light: '#FF5E54' },
        ink: { DEFAULT: '#041A3D', secondary: '#354764', muted: '#808C9F', disabled: '#B1B9C5' },
        surface: { disabled: '#FBFBFB' },
        line: '#D5F2F2',
      },
      boxShadow: { 'level-1': '0 1px 3px rgba(20,30,60,0.06)' },
    },
  },
  plugins: [],
};
