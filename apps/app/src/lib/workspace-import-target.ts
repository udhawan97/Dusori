import type { StorageKind } from '@dusori/core';

export function workspaceImportTarget(kind: StorageKind, label: string): string {
  const target =
    kind === 'fsa'
      ? 'selected folder'
      : kind === 'tauri'
        ? 'desktop workspace'
        : kind === 'companion'
          ? 'companion workspace'
          : 'browser workspace';
  return label ? `${target} (${label})` : target;
}
