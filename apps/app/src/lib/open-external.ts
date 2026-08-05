import { loadDusoriDesktop } from '$lib/desktop-platform';

export function isExternalHttpUrl(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Keeps ordinary browser anchors native while routing desktop clicks to the system browser.
 * Returns false when the page is not running inside Dusori desktop, so the caller can leave the
 * anchor's default behavior untouched.
 */
export async function openExternalFromDesktop(url: string): Promise<boolean> {
  const desktop = await loadDusoriDesktop();
  if (!desktop) return false;
  await desktop.openExternalUrl(url);
  return true;
}

/**
 * Click-boundary shared by SourceLibrary and its unit test. Browser links keep their ordinary
 * anchor behavior; desktop links prevent in-webview navigation before handing the URL to Tauri.
 */
export async function handleExternalLink(
  event: Pick<MouseEvent, 'preventDefault'>,
  url: string,
  desktopRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
): Promise<boolean> {
  if (!desktopRuntime) return false;
  event.preventDefault();
  return openExternalFromDesktop(url);
}
