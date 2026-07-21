import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

import { projectBasePath, hostedOrigin } from '../../config/site.mjs';

export default defineConfig({
  base: projectBasePath,
  site: hostedOrigin,
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
            { label: 'v0.2.0 release', slug: 'docs/releases/v0-2-0' },
            { label: 'v0.1.0 release', slug: 'docs/releases/v0-1-0' },
          ],
        },
        {
          label: 'Use Dusori',
          items: [
            { label: 'Workspaces and folders', slug: 'docs/workspaces' },
            { label: 'Sources', slug: 'docs/sources' },
            { label: 'Curriculum import', slug: 'docs/curricula' },
            { label: 'Learning loop', slug: 'docs/learning-loop' },
            { label: 'Knowledge graph', slug: 'docs/knowledge-graph' },
            { label: 'Conflict safety', slug: 'docs/conflict-safety' },
            { label: 'Browser support', slug: 'docs/browser-support' },
          ],
        },
        { label: 'Roadmap', slug: 'docs/roadmap' },
      ],
    }),
  ],
});
