import type { StorageAdapter } from '@dusori/core';

type DesktopModule = typeof import('@dusori/storage-tauri');

/** Loads native code only inside Tauri; ordinary browsers never request the desktop chunk. */
export async function loadDusoriDesktop(): Promise<DesktopModule | null> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null;
  const desktop = await import('@dusori/storage-tauri');
  return desktop.isDusoriDesktop() ? desktop : null;
}

export async function resolveDesktopStorage(): Promise<StorageAdapter | null> {
  return (await loadDusoriDesktop())?.createTauriStorage() ?? null;
}

export async function startBundledDesktopSession(): Promise<{
  origin: string;
  token: string;
} | null> {
  return (await loadDusoriDesktop())?.startDesktopSession() ?? null;
}
