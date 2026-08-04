import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

import { appBasePath } from '../../config/site.mjs';

export default defineConfig({
  plugins: [
    sveltekit(),
    SvelteKitPWA({
      base: `${appBasePath}/`,
      filename: 'service-worker.ts',
      injectRegister: false,
      manifest: {
        name: 'Dusori',
        short_name: 'Dusori',
        description: 'A local-first research desk for source-backed briefs.',
        display: 'standalone',
        background_color: '#14100d',
        theme_color: '#14100d',
        start_url: `${appBasePath}/`,
        scope: `${appBasePath}/`,
        icons: [
          { src: `${appBasePath}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${appBasePath}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
        ],
      },
      registerType: 'autoUpdate',
      srcDir: 'src',
      strategies: 'injectManifest',
      injectManifest: {
        globPatterns: ['**/*.{css,html,js,svg,woff2,webmanifest}'],
      },
    }),
  ],
  server: {
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
});
