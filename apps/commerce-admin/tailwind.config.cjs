/**
 * Tailwind only for the josh pages copied into commerce-admin (marketing workflow editor), with josh
 * web-admin's theme. No preflight and everything scoped under `.josh-tw`, so the rest of
 * commerce-admin's own CSS is untouched.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [__dirname + '/src/app/pages/workflow-editor/josh/**/*.{ts,tsx}'],
  important: '.josh-tw',
  corePlugins: { preflight: false },
  theme: {
    extend: {
      fontFamily: { sans: ['"Noto Sans Thai"', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        primary: { DEFAULT: '#0A4BC5', dark: '#002E88', light: '#548FFF', soft: '#F0F5FF', border: '#DEEAFF' },
        alert: { DEFAULT: '#BF0013', dark: '#7B0008', soft: '#FFF2F0', light: '#FF5E54' },
        ink: { DEFAULT: '#041A3D', secondary: '#354764', muted: '#808C9F', disabled: '#B1B9C5' },
        surface: { disabled: '#FBFBFB' },
        line: '#D5F2F2',
      },
      boxShadow: { 'level-1': '0 2px 40px 8px rgba(9,70,73,0.08)' },
    },
  },
  plugins: [],
};
