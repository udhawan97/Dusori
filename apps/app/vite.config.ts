import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

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
        description: 'Local-first learning notes that work without AI.',
        display: 'standalone',
        background_color: '#f7f1e8',
        theme_color: '#f7f1e8',
        start_url: `${appBasePath}/`,
        scope: `${appBasePath}/`,
        icons: [
          { src: `${appBasePath}/icons/icon-192.svg`, sizes: '192x192', type: 'image/svg+xml' },
          { src: `${appBasePath}/icons/icon-512.svg`, sizes: '512x512', type: 'image/svg+xml' },
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
});
