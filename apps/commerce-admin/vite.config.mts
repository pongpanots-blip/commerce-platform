/// <reference types='vitest' />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
import tailwind3 from 'tailwindcss3';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

/**
 * Two Tailwinds, kept apart:
 * - commerce-admin's own UI (Stitch redesign, libs/ui) uses Tailwind v4 through @tailwindcss/vite.
 * - josh web-admin pages copied into src/josh-admin and the copied workflow editor keep josh's Tailwind v3
 *   theme (tailwind.config.cjs: scoped to .josh-tw, no preflight). Only their two stylesheets go through v3,
 *   so neither theme leaks into the other.
 */
function joshTailwind3(): Plugin {
  const config = `${import.meta.dirname}/tailwind.config.cjs`;
  return {
    name: 'josh-tailwind3',
    enforce: 'pre',
    async transform(code, id) {
      const file = id.split('?')[0];
      if (!/[\\/](josh-tailwind|josh-admin)\.css$/.test(file)) return null;
      const out = await postcss([tailwind3({ config }), autoprefixer]).process(code, { from: file });
      for (const m of out.messages) if (m.type === 'dependency') this.addWatchFile(m.file as string);
      return { code: out.css, map: null };
    },
  };
}

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/commerce-admin',
  server: {
    port: 4403,
    host: 'localhost',
  },
  preview: {
    port: 4403,
    host: 'localhost',
  },
  plugins: [react(), joshTailwind3(), tailwindcss(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  // No global PostCSS: Tailwind v3 runs only on the josh stylesheets (above).
  css: { postcss: { plugins: [] } },
  // josh web-admin pages copied into src/josh-admin import josh's shared libs by package name.
  resolve: {
    alias: {
      '@josh/shared-api': `${import.meta.dirname}/src/josh-admin/libs/shared-api/index.ts`,
      '@josh/shared-ui-web': `${import.meta.dirname}/src/josh-admin/libs/shared-ui-web/index.ts`,
      '@josh/shared-models': `${import.meta.dirname}/src/josh-admin/libs/shared-models/index.ts`,
    },
  },
  // Uncomment this if you are using workers.
  // worker: {
  //   plugins: () => [ nxViteTsPaths() ],
  // },
  build: {
    outDir: '../../dist/apps/commerce-admin',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
}));
