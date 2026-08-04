import { describe, expect, it } from 'vitest';

import { companionHelp, parseCompanionArguments } from './cli-options.js';

describe('companion command line', () => {
  it('parses the optional workspace root', () => {
    expect(parseCompanionArguments([])).toEqual({
      allowedOrigins: [],
      apiOnly: false,
      kind: 'run',
    });
    expect(parseCompanionArguments(['--root', '/tmp/Dusori'])).toEqual({
      allowedOrigins: [],
      apiOnly: false,
      kind: 'run',
      root: '/tmp/Dusori',
    });
  });

  it('parses API-only startup with exact, normalized origins', () => {
    expect(
      parseCompanionArguments([
        '--api-only',
        '--origin',
        'tauri://localhost/',
        '--origin',
        'http://127.0.0.1:1420',
      ]),
    ).toEqual({
      allowedOrigins: ['tauri://localhost', 'http://127.0.0.1:1420'],
      apiOnly: true,
      kind: 'run',
    });
  });

  it('supports help and version without starting the server', () => {
    expect(parseCompanionArguments(['--help'])).toEqual({ kind: 'help' });
    expect(parseCompanionArguments(['-h'])).toEqual({ kind: 'help' });
    expect(parseCompanionArguments(['--version'])).toEqual({ kind: 'version' });
    expect(companionHelp).toContain('npx @udhawan97/dusori --root /path/to/Dusori');
    expect(companionHelp).toContain('loopback');
  });

  it('rejects missing values and unknown arguments', () => {
    expect(() => parseCompanionArguments(['--root'])).toThrow(/path after --root/u);
    expect(() => parseCompanionArguments(['--origin', 'https://example.com/path'])).toThrow(
      /only a scheme, host/iu,
    );
    expect(() => parseCompanionArguments(['--origin', 'file:///tmp/app'])).toThrow(
      /only a scheme, host/iu,
    );
    expect(() => parseCompanionArguments(['--listen', '0.0.0.0'])).toThrow(/unknown argument/iu);
  });
});
