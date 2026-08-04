import {
  StorageConflictError,
  type FileSnapshot,
  type StorageAdapter,
  type StorageEntry,
  type WriteOptions,
} from '@dusori/core';
import { invoke, isTauri } from '@tauri-apps/api/core';

export interface DesktopSession {
  origin: string;
  token: string;
}

export interface DesktopUpdate {
  available: boolean;
  body: string | null;
  currentVersion: string;
  date: string | null;
  version: string | null;
}

export interface ProtectedUpdateAction {
  /** The UI must flush or resolve pending writes before setting this to false. */
  hasUnsavedWrites: boolean;
}

const conflictPrefix = 'DUSORI_STORAGE_CONFLICT|';

function commandError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const marker = message.indexOf(conflictPrefix);
  if (marker >= 0) {
    const [path = '', expected = 'missing', actual = 'missing'] = message
      .slice(marker + conflictPrefix.length)
      .split('|');
    throw new StorageConflictError(
      path,
      expected === 'missing' ? null : expected,
      actual === 'missing' ? null : actual,
    );
  }
  throw error instanceof Error ? error : new Error(message);
}

async function desktopInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('This action is available only in the Dusori desktop app.');
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    return commandError(error);
  }
}

export function isDusoriDesktop(): boolean {
  return isTauri();
}

/** Returns the loopback origin and per-launch bearer token over Tauri IPC, never the URL. */
export function startDesktopSession(): Promise<DesktopSession> {
  return desktopInvoke<DesktopSession>('desktop_session');
}

/** Opens one validated HTTP(S) URL in the user's system browser. */
export function openExternalUrl(url: string): Promise<void> {
  return desktopInvoke<void>('open_external_url', { url });
}

export function checkForDesktopUpdate(): Promise<DesktopUpdate> {
  return desktopInvoke<DesktopUpdate>('check_for_update');
}

/** Downloads and signature-verifies the offered release into process memory; it does not install. */
export function downloadDesktopUpdate(): Promise<DesktopUpdate> {
  return desktopInvoke<DesktopUpdate>('download_update');
}

/** Releases a verified download kept in process memory without installing it. */
export function discardDesktopUpdate(): Promise<void> {
  return desktopInvoke<void>('discard_downloaded_update');
}

/** Installs the already downloaded update, but never relaunches the app. */
export function installDesktopUpdate(action: ProtectedUpdateAction): Promise<string> {
  if (action.hasUnsavedWrites) {
    return Promise.reject(new Error('Save or resolve current work before installing this update.'));
  }
  return desktopInvoke<string>('install_downloaded_update', { confirmed: true });
}

/** Relaunches only after the Settings UI has obtained a separate explicit user confirmation. */
export function restartDesktopApp(action: ProtectedUpdateAction): Promise<void> {
  if (action.hasUnsavedWrites) {
    return Promise.reject(new Error('Save or resolve current work before restarting Dusori.'));
  }
  return desktopInvoke<void>('restart_app', { confirmed: true });
}

export class TauriStorageAdapter implements StorageAdapter {
  readonly kind = 'tauri' as const;

  async ensureDirectory(path: string): Promise<void> {
    await desktopInvoke('workspace_ensure_directory', { path });
  }

  async list(path = '', recursive = false): Promise<StorageEntry[]> {
    return desktopInvoke<StorageEntry[]>('workspace_list', { path, recursive });
  }

  async move(from: string, to: string): Promise<void> {
    await desktopInvoke('workspace_move', { from, to });
  }

  async read(path: string): Promise<FileSnapshot | null> {
    return desktopInvoke<FileSnapshot | null>('workspace_read', { path });
  }

  async remove(path: string, recursive = false): Promise<void> {
    await desktopInvoke('workspace_remove', { path, recursive });
  }

  async write(path: string, content: string, options: WriteOptions = {}): Promise<FileSnapshot> {
    return desktopInvoke<FileSnapshot>('workspace_write', {
      content,
      expectMissing: options.expectedHash === null,
      expectedHash: typeof options.expectedHash === 'string' ? options.expectedHash : null,
      path,
    });
  }
}

export function createTauriStorage(): TauriStorageAdapter {
  if (!isTauri()) throw new Error('Native workspace storage requires the Dusori desktop app.');
  return new TauriStorageAdapter();
}
