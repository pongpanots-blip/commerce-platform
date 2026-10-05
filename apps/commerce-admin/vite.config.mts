/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

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
  plugins: [react(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
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
