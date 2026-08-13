export type Appearance = 'system' | 'paper' | 'ink' | 'night';

export const appearanceKey = 'dusori-appearance';
export const appearanceChangeEvent = 'dusori-appearance-change';
const legacyThemeKey = 'dusori-theme';

export function readAppearance(): Appearance {
  try {
    const value = localStorage.getItem(appearanceKey);
    if (value === 'system' || value === 'paper' || value === 'ink' || value === 'night') {
      return value;
    }
    const legacy = localStorage.getItem(legacyThemeKey);
    if (legacy === 'light') return 'paper';
    if (legacy === 'dark') return 'night';
  } catch {
    // System remains the non-persisted fallback.
  }
  return 'system';
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  root.dataset.appearance = appearance;
  root.dataset.theme =
    appearance === 'paper'
      ? 'light'
      : appearance === 'system'
        ? prefersDark
          ? 'dark'
          : 'light'
        : 'dark';
  window.dispatchEvent(
    new CustomEvent(appearanceChangeEvent, {
      detail: { appearance, theme: root.dataset.theme },
    }),
  );
}

export function setAppearance(appearance: Appearance): boolean {
  applyAppearance(appearance);
  try {
    localStorage.setItem(appearanceKey, appearance);
    localStorage.setItem('dusori-theme', appearance === 'paper' ? 'light' : 'dark');
    return true;
  } catch {
    return false;
  }
}

/** Keep the System choice live for the lifetime of the application shell. */
export function startSystemAppearanceSync(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const sync = (): void => {
    if (readAppearance() === 'system') applyAppearance('system');
  };
  media.addEventListener('change', sync);
  sync();
  return () => media.removeEventListener('change', sync);
}
