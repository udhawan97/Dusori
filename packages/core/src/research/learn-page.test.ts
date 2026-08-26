import { describe, expect, it } from 'vitest';

import type { SourceRecord } from '../schemas/workspace.js';
import { renderLearnPage, withLearnPageTheme } from './learn-page.js';
import { buildTopicSynthesis } from './synthesis.js';

const now = new Date('2026-08-02T10:00:00.000Z');
const at = now.toISOString();

function source(overrides: Partial<SourceRecord>): SourceRecord {
  return {
    claims: [{ at, heading: 'Forgetting curve', text: 'Reviews at increasing intervals help.' }],
    fetchedAt: at,
    method: 'url',
    origin: { capturedAt: at, capturedVia: 'api-extract', provider: 'wikipedia' },
    path: 'Topics/t/Sources/items/abc123456789-spaced.md',
    readState: 'read',
    sha256: 'a'.repeat(64),
    title: 'Spaced repetition',
    url: 'https://en.wikipedia.org/wiki/Spaced_repetition',
    ...overrides,
  };
}

function pageFor(sources: SourceRecord[]): string {
  return renderLearnPage(
    buildTopicSynthesis({ now, sources, topicTitle: 'Spaced repetition learning' }),
  );
}

describe('learn page', () => {
  it('is entirely self-contained: no request leaves the file', () => {
    const html = pageFor([source({})]);

    // Only anchor hrefs may name a remote origin; nothing may be *fetched*.
    expect(html).not.toMatch(/<(?:script|link|img|iframe|source)\b[^>]*\b(?:src|href)=/iu);
    expect(html).not.toMatch(/@import|url\(\s*https?:/iu);
    expect(html).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket/u);
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('quotes each passage with a link back to its source', () => {
    const html = pageFor([source({})]);

    expect(html).toContain('Reviews at increasing intervals help.');
    expect(html).toContain(
      '<a href="https://en.wikipedia.org/wiki/Spaced_repetition" target="_blank" rel="noreferrer noopener">Spaced repetition</a>',
    );
  });

  it('escapes source text rather than trusting it as markup', () => {
    const html = pageFor([
      source({
        claims: [{ at, text: 'A <script>alert(1)</script> tag & "quotes" appear here.' }],
        title: 'Hostile <b>title</b>',
      }),
    ]);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Hostile &lt;b&gt;title&lt;/b&gt;');
  });

  it('refuses a javascript: source link, keeping the title as text', () => {
    const html = pageFor([source({ url: undefined })]);

    expect(html).not.toContain('javascript:');
    expect(html).toContain('<cite>Spaced repetition');
  });

  it('marks a single-source concept as unconfirmed', () => {
    expect(pageFor([source({})])).toContain('Only one source supports this so far');
  });

  it('offers check-yourself prompts that store nothing', () => {
    const html = pageFor([source({})]);

    expect(html).toContain('<h2>Check yourself</h2>');
    expect(html).toContain('No score is kept and nothing is stored.');
    expect(html).toContain('<details class="check">');
  });

  it('carries no theme of its own but honours one an embedder stamps on', () => {
    const html = pageFor([source({})]);

    expect(html).toContain('<html lang="en">');
    expect(html).toContain(':root[data-theme="dark"]');
    expect(withLearnPageTheme(html, 'dark')).toContain('<html lang="en" data-theme="dark">');
    expect(withLearnPageTheme(html, 'light')).toContain('<html lang="en" data-theme="light">');
  });

  it('says plainly when nothing has been read, and ships no script', () => {
    const html = pageFor([source({ claims: undefined })]);

    expect(html).toContain('Nothing has been read into quotable passages yet.');
    expect(html).not.toContain('<script>');
  });
});
