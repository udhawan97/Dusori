import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appearanceChangeEvent,
  appearanceKey,
  applyAppearance,
  setAppearance,
  startSystemAppearanceSync,
} from './appearance';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  } as Storage;
}

describe('appearance synchronization', () => {
  let dark = true;
  let mediaListener: (() => void) | null = null;
  let windowTarget: EventTarget;
  const root = { dataset: {} as Record<string, string> };

  beforeEach(() => {
    dark = true;
    mediaListener = null;
    root.dataset = {};
    windowTarget = new EventTarget();
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('document', { documentElement: root });
    vi.stubGlobal('window', {
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget),
      matchMedia: () => ({
        addEventListener: (_event: string, listener: () => void) => (mediaListener = listener),
        get matches() {
          return dark;
        },
        removeEventListener: (_event: string, listener: () => void) => {
          if (mediaListener === listener) mediaListener = null;
        },
      }),
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('follows a live system change and removes its one listener on teardown', () => {
    localStorage.setItem(appearanceKey, 'system');
    const changed = vi.fn();
    window.addEventListener(appearanceChangeEvent, changed);

    const stop = startSystemAppearanceSync();
    expect(root.dataset.theme).toBe('dark');
    expect(mediaListener).not.toBeNull();

    dark = false;
    mediaListener?.();
    expect(root.dataset.theme).toBe('light');
    expect(changed).toHaveBeenCalledTimes(2);

    stop();
    expect(mediaListener).toBeNull();
  });

  it.each(['paper', 'ink', 'night'] as const)(
    'does not override the explicit %s choice on a system event',
    (appearance) => {
      setAppearance(appearance);
      const expectedTheme = root.dataset.theme;
      startSystemAppearanceSync();

      dark = !dark;
      mediaListener?.();

      expect(root.dataset.appearance).toBe(appearance);
      expect(root.dataset.theme).toBe(expectedTheme);
    },
  );

  it('emits the resolved theme whenever appearance is applied', () => {
    const changed = vi.fn();
    window.addEventListener(appearanceChangeEvent, changed);

    applyAppearance('system');

    expect(changed).toHaveBeenCalledOnce();
    expect(root.dataset).toMatchObject({ appearance: 'system', theme: 'dark' });
  });
});
