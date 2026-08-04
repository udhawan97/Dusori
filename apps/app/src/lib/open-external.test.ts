import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadDusoriDesktop, openExternalUrl } = vi.hoisted(() => ({
  loadDusoriDesktop: vi.fn(),
  openExternalUrl: vi.fn<(url: string) => Promise<void>>(),
}));

vi.mock('$lib/desktop-platform', () => ({ loadDusoriDesktop }));

import { handleExternalLink } from './open-external';

describe('desktop external link boundary', () => {
  beforeEach(() => {
    openExternalUrl.mockReset();
    loadDusoriDesktop.mockReset();
  });

  it('keeps an ordinary browser anchor native', async () => {
    const preventDefault = vi.fn();

    await expect(
      handleExternalLink({ preventDefault }, 'https://example.org/paper', false),
    ).resolves.toBe(false);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(loadDusoriDesktop).not.toHaveBeenCalled();
  });

  it('prevents webview navigation and hands a SourceLibrary link to the desktop browser', async () => {
    loadDusoriDesktop.mockResolvedValue({ openExternalUrl });
    openExternalUrl.mockResolvedValue();
    const preventDefault = vi.fn();

    await expect(
      handleExternalLink({ preventDefault }, 'https://example.org/paper', true),
    ).resolves.toBe(true);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.org/paper');
  });
});
