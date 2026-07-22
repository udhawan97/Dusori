import { describe, expect, it } from 'vitest';

import { companionHelp, parseCompanionArguments } from './cli-options.js';

describe('companion command line', () => {
  it('parses the optional workspace root', () => {
    expect(parseCompanionArguments([])).toEqual({ kind: 'run' });
    expect(parseCompanionArguments(['--root', '/tmp/Dusori'])).toEqual({
      kind: 'run',
      root: '/tmp/Dusori',
    });
  });

  it('supports help and version without starting the server', () => {
    expect(parseCompanionArguments(['--help'])).toEqual({ kind: 'help' });
    expect(parseCompanionArguments(['-h'])).toEqual({ kind: 'help' });
    expect(parseCompanionArguments(['--version'])).toEqual({ kind: 'version' });
    expect(companionHelp).toContain('npx dusori --root /path/to/Dusori');
    expect(companionHelp).toContain('loopback');
  });

  it('rejects missing values and unknown arguments', () => {
    expect(() => parseCompanionArguments(['--root'])).toThrow(/path after --root/u);
    expect(() => parseCompanionArguments(['--listen', '0.0.0.0'])).toThrow(/unknown argument/iu);
  });
});
