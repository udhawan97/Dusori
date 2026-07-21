import { describe, expect, it } from 'vitest';

import { cappedMarkdown } from './capped.js';
import { maxSourceBytes } from './import.js';

describe('cappedMarkdown', () => {
  it('returns prefix, body, and a trailing newline when under the cap', () => {
    expect(cappedMarkdown('# Title\n\n', 'body')).toBe('# Title\n\nbody\n');
  });

  it('truncates to the source cap with a visible marker', () => {
    const result = cappedMarkdown('# Title\n\n', 'x'.repeat(maxSourceBytes + 1024));
    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(maxSourceBytes);
    expect(result.endsWith('\n\n[truncated]\n')).toBe(true);
    expect(result.startsWith('# Title\n\n')).toBe(true);
  });
});
