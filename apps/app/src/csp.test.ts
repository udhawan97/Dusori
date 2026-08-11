import { readFileSync } from 'node:fs';

import { researchProviderPolicy } from '@dusori/core';
import { describe, expect, it } from 'vitest';

const appHtml = readFileSync(new URL('./app.html', import.meta.url), 'utf8');
const tauriConfig = JSON.parse(
  readFileSync(new URL('../../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
) as { app?: { security?: { csp?: string } } };

function connectSrc(policy: string, surface: string): string[] {
  const directive = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('connect-src'));
  if (!directive) throw new Error(`${surface} declares no connect-src policy.`);
  return directive.split(/\s+/u).slice(1);
}

const hostedPolicy = /http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/su.exec(
  appHtml,
)?.[1];
if (!hostedPolicy) throw new Error('app.html declares no Content-Security-Policy.');
const desktopPolicy = tauriConfig.app?.security?.csp;
if (!desktopPolicy) throw new Error('tauri.conf.json declares no Content-Security-Policy.');

/**
 * A provider that reaches its API from the browser is dead on the deployed app unless the
 * policy names its origin, and the failure only shows up at search time. Deriving the list
 * from the registry means adding a provider cannot quietly skip this.
 */
describe.each([
  ['hosted app', hostedPolicy],
  ['desktop app', desktopPolicy],
])('%s policy', (surface, policy) => {
  const allowed = connectSrc(policy, surface);
  for (const origin of researchProviderPolicy.browserOrigins) {
    it(`allows provider calls to reach ${origin}`, () => {
      expect(allowed).toContain(origin);
    });
  }
});
