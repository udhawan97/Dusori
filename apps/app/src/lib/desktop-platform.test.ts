import { describe, expect, it } from 'vitest';

import {
  loadDusoriDesktop,
  resolveDesktopStorage,
  startBundledDesktopSession,
} from './desktop-platform';

describe('desktop platform boundary', () => {
  it('does not load native storage or session code in an ordinary browser/server test', async () => {
    await expect(loadDusoriDesktop()).resolves.toBeNull();
    await expect(resolveDesktopStorage()).resolves.toBeNull();
    await expect(startBundledDesktopSession()).resolves.toBeNull();
  });
});
