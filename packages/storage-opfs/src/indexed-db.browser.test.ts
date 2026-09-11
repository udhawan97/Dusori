import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { webkit } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import type { Vite } from 'vitest/node';

import type { IndexedDbStorageAdapter } from './indexed-db.js';

declare global {
  interface Window {
    DusoriStorage: { IndexedDbStorageAdapter: typeof IndexedDbStorageAdapter };
    testStorage: IndexedDbStorageAdapter;
  }
}

// This opt-in integration test uses the installed browser; it never downloads one or contacts
// a server. Keep the ordinary Node-only unit suite usable on machines without browser binaries.
describe.skipIf(process.env.DUSORI_STORAGE_BROWSER_TEST !== '1')(
  'IndexedDB browser transactions',
  () => {
    it('rejects competing guarded writes across tabs and survives a later retry', async () => {
      const require = createRequire(import.meta.resolve('vitest/config'));
      const vite = (await import(require.resolve('vite'))) as typeof Vite;
      const build = await vite.build({
        configFile: false,
        logLevel: 'silent',
        build: {
          write: false,
          minify: false,
          lib: {
            entry: fileURLToPath(new URL('./indexed-db.ts', import.meta.url)),
            formats: ['iife'],
            name: 'DusoriStorage',
          },
        },
      });
      const bundle = Array.isArray(build) ? build[0] : build;
      if (!bundle || !('output' in bundle)) throw new Error('Expected one browser bundle.');
      const chunk = bundle.output.find((output) => output.type === 'chunk');
      if (!chunk || chunk.type !== 'chunk') throw new Error('Missing browser bundle.');
      const browser = await webkit.launch();
      try {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        const unexpected: string[] = [];
        await context.route('**/*', async (route) => {
          if (route.request().url() !== 'https://dusori-fixture.test/') {
            unexpected.push(route.request().url());
            await route.abort();
            return;
          }
          await route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><title>Storage test</title>',
          });
        });
        const pages = await Promise.all([context.newPage(), context.newPage()]);
        for (const page of pages) {
          await page.goto('https://dusori-fixture.test/');
          await page.addScriptTag({ content: chunk.code });
          await page.evaluate(async () => {
            window.testStorage =
              await window.DusoriStorage.IndexedDbStorageAdapter.open('concurrency');
          });
        }
        for (const create of [false, true]) {
          const path = create ? 'new.md' : 'existing.md';
          const expectedHash = create
            ? null
            : await pages[0]!.evaluate(
                async (path) => (await window.testStorage.write(path, 'original')).hash,
                path,
              );
          // Force both public writes to observe the same old snapshot before either transaction
          // starts, without mocking IndexedDB transaction semantics.
          await Promise.all(
            pages.map((page) =>
              page.evaluate(() => {
                const read = window.testStorage.read.bind(window.testStorage);
                window.testStorage.read = async (path) => {
                  const snapshot = await read(path);
                  localStorage.setItem(`ready:${path}:${sessionStorage.getItem('writer')}`, 'yes');
                  while (localStorage.getItem(`release:${path}`) !== 'yes') {
                    await new Promise((resolve) => setTimeout(resolve, 1));
                  }
                  return snapshot;
                };
              }),
            ),
          );
          await Promise.all(
            pages.map((page, index) =>
              page.evaluate((index) => {
                sessionStorage.setItem('writer', String(index));
              }, index),
            ),
          );
          const pending = pages.map((page, index) =>
            page.evaluate(
              async ({ path, expectedHash, index }) => {
                try {
                  return {
                    status: 'written',
                    file: await window.testStorage.write(path, `writer-${index}`, { expectedHash }),
                  };
                } catch (error) {
                  return {
                    status: 'failed',
                    name: error instanceof Error ? error.name : String(error),
                  };
                }
              },
              { path, expectedHash, index },
            ),
          );
          await pages[0]!.waitForFunction(
            (path) =>
              localStorage.getItem(`ready:${path}:0`) && localStorage.getItem(`ready:${path}:1`),
            path,
          );
          await pages[0]!.evaluate((path) => localStorage.setItem(`release:${path}`, 'yes'), path);
          const outcomes = await Promise.all(pending);
          expect(outcomes.filter((outcome) => outcome.status === 'written')).toHaveLength(1);
          expect(outcomes.filter((outcome) => outcome.status === 'failed')).toEqual([
            { status: 'failed', name: 'StorageConflictError' },
          ]);
          const winner = outcomes.find((outcome) => outcome.status === 'written')!;
          expect(await pages[0]!.evaluate((path) => window.testStorage.read(path), path)).toEqual(
            winner.file,
          );
          expect(
            await pages[1]!.evaluate(async (path) => {
              const file = (await window.testStorage.read(path))!;
              return (await window.testStorage.write(path, 'retry', { expectedHash: file.hash }))
                .content;
            }, path),
          ).toBe('retry');
          // Restore the ordinary read path before the next fixture.
          await Promise.all(
            pages.map((page) =>
              page.evaluate(async () => {
                window.testStorage =
                  await window.DusoriStorage.IndexedDbStorageAdapter.open('concurrency');
              }),
            ),
          );
        }
        expect(unexpected).toEqual([]);
        await context.close();
      } finally {
        await browser.close();
      }
    }, 30_000);
  },
);
