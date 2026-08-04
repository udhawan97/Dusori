import { loadDusoriDesktop } from './desktop-platform';

export interface AvailableUpdate {
  available: boolean;
  body: string | null;
  currentVersion: string;
  date: string | null;
  version: string | null;
}

export interface UpdatePlatform {
  kind: 'browser' | 'desktop';
  check(): Promise<AvailableUpdate>;
  discard(): Promise<void>;
  download(): Promise<AvailableUpdate>;
  installAndRestart(hasUnsavedWrites: boolean): Promise<void>;
}

export const automaticUpdatePreferenceKey = 'dusori.desktop.auto-updates';
export const automaticUpdateReadyKey = 'dusori.desktop.update-ready';

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter extends StorageReader {
  setItem(key: string, value: string): void;
}

export interface AutomaticUpdateResult {
  kind: 'browser' | 'disabled' | 'downloaded' | 'up-to-date';
  update?: AvailableUpdate;
}

interface AutomaticUpdateOptions {
  preferenceStorage?: StorageReader;
  resolvePlatform?: () => Promise<UpdatePlatform>;
  stateStorage?: StorageWriter;
}

const browserPlatform: UpdatePlatform = {
  kind: 'browser',
  async check() {
    throw new Error('The hosted app updates when the website is refreshed.');
  },
  async discard() {},
  async download() {
    throw new Error('Downloads are available in the Dusori desktop app.');
  },
  async installAndRestart() {
    throw new Error('Installation is available in the Dusori desktop app.');
  },
};

/**
 * Keeps the web build independent from Tauri. Vite leaves the variable import for runtime, and
 * browser sessions return before resolving it. The desktop package owns every native call.
 */
export async function resolveUpdatePlatform(): Promise<UpdatePlatform> {
  const desktop = await loadDusoriDesktop();
  if (!desktop) return browserPlatform;

  return {
    kind: 'desktop',
    check: desktop.checkForDesktopUpdate,
    discard: desktop.discardDesktopUpdate,
    download: desktop.downloadDesktopUpdate,
    async installAndRestart(hasUnsavedWrites: boolean) {
      await desktop.installDesktopUpdate({ hasUnsavedWrites });
      await desktop.restartDesktopApp({ hasUnsavedWrites });
    },
  };
}

/**
 * Runs once from the application shell, not from Settings, so an opted-in desktop learner gets
 * the promised check and verified download even when they open straight into Learn. Installation
 * and restart remain separate, explicit actions in Settings.
 */
export async function runAutomaticUpdateCheck(
  options: AutomaticUpdateOptions = {},
): Promise<AutomaticUpdateResult> {
  if (typeof window === 'undefined' && !options.preferenceStorage) return { kind: 'disabled' };
  const preferenceStorage = options.preferenceStorage ?? window.localStorage;
  if (preferenceStorage.getItem(automaticUpdatePreferenceKey) !== 'true') {
    return { kind: 'disabled' };
  }

  const platform = await (options.resolvePlatform ?? resolveUpdatePlatform)();
  if (platform.kind !== 'desktop') return { kind: 'browser' };
  const available = await platform.check();
  if (!available.available) return { kind: 'up-to-date', update: available };

  const downloaded = await platform.download();
  const stateStorage = options.stateStorage ?? window.sessionStorage;
  stateStorage.setItem(automaticUpdateReadyKey, JSON.stringify(downloaded));
  return { kind: 'downloaded', update: downloaded };
}

export function readAutomaticDownloadedUpdate(storage: StorageReader): AvailableUpdate | null {
  const value = storage.getItem(automaticUpdateReadyKey);
  if (!value) return null;
  try {
    const update = JSON.parse(value) as AvailableUpdate;
    return update.available && typeof update.currentVersion === 'string' ? update : null;
  } catch {
    return null;
  }
}
