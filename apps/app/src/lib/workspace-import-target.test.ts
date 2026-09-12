import { describe, expect, it } from 'vitest';

import { workspaceImportTarget } from './workspace-import-target';

describe('workspace import target copy', () => {
  it.each([
    ['fsa', 'Coursework', 'selected folder (Coursework)'],
    ['tauri', 'Mac workspace', 'desktop workspace (Mac workspace)'],
    ['companion', 'Local folder', 'companion workspace (Local folder)'],
    ['indexeddb', '', 'browser workspace'],
  ] as const)('names %s storage', (kind, label, expected) => {
    expect(workspaceImportTarget(kind, label)).toBe(expected);
  });
});
