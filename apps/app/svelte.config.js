import adapter from '@sveltejs/adapter-static';

import { appBasePath } from '../../config/site.mjs';

export default {
  kit: {
    adapter: adapter({ fallback: '404.html' }),
    paths: { base: appBasePath },
    serviceWorker: { register: false },
  },
};
