import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

import { projectBasePath, hostedOrigin } from '../../config/site.mjs';

export default defineConfig({
  base: projectBasePath,
  site: hostedOrigin,
  vite: {
    build: {
      // The landing page ships a strict CSP (script-src 'self'); inlined module
      // scripts are blocked there, so every script must emit as an external file.
      assetsInlineLimit: 0,
    },
  },
  integrations: [
    starlight({
      title: 'Dusori',
      description: 'Documentation for the local-first Dusori learning workspace.',
      customCss: ['./src/styles/global.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/udhawan97/Dusori' }],
      sidebar: [
        {
          label: 'Start',
          items: [
            { label: 'Documentation', slug: 'docs' },
            { label: 'Getting started', slug: 'docs/getting-started' },
            { label: 'v0.12.1 release', slug: 'docs/releases/v0-12-1' },
          ],
        },
        {
          label: 'Use Dusori',
          items: [
            { label: 'Workspaces and folders', slug: 'docs/workspaces' },
            { label: 'Sources and research', slug: 'docs/sources' },
            { label: 'Research providers', slug: 'docs/research-providers' },
            { label: 'Curriculum import', slug: 'docs/curricula' },
            { label: 'Learning loop', slug: 'docs/learning-loop' },
            { label: 'Map and Outline', slug: 'docs/knowledge-graph' },
            { label: 'Local insights', slug: 'docs/insights' },
            { label: 'Conflict safety', slug: 'docs/conflict-safety' },
            { label: 'Browser and desktop support', slug: 'docs/browser-support' },
            { label: 'Updates and recovery', slug: 'docs/updates' },
          ],
        },
        {
          label: 'Release history',
          collapsed: true,
          items: [
            { label: 'v0.12.0', slug: 'docs/releases/v0-12-0' },
            { label: 'v0.11.3', slug: 'docs/releases/v0-11-3' },
            { label: 'v0.11.2', slug: 'docs/releases/v0-11-2' },
            { label: 'v0.11.1', slug: 'docs/releases/v0-11-1' },
            { label: 'v0.11.0', slug: 'docs/releases/v0-11-0' },
            { label: 'v0.10.0', slug: 'docs/releases/v0-10-0' },
            { label: 'v0.9.1', slug: 'docs/releases/v0-9-1' },
            { label: 'v0.9.0', slug: 'docs/releases/v0-9-0' },
            { label: 'v0.8.1', slug: 'docs/releases/v0-8-1' },
            { label: 'v0.8.0', slug: 'docs/releases/v0-8-0' },
            { label: 'v0.7.1', slug: 'docs/releases/v0-7-1' },
            { label: 'v0.7.0', slug: 'docs/releases/v0-7-0' },
            { label: 'v0.6.0', slug: 'docs/releases/v0-6-0' },
            { label: 'v0.5.0', slug: 'docs/releases/v0-5-0' },
            { label: 'v0.4.0', slug: 'docs/releases/v0-4-0' },
            { label: 'v0.3.0', slug: 'docs/releases/v0-3-0' },
            { label: 'v0.2.0', slug: 'docs/releases/v0-2-0' },
            { label: 'v0.1.0', slug: 'docs/releases/v0-1-0' },
          ],
        },
        { label: 'Roadmap', slug: 'docs/roadmap' },
      ],
    }),
  ],
});
