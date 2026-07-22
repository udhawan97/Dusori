import { describe, expect, it } from 'vitest';

import { reputationFor } from './reputation.js';

describe('host reputation', () => {
  it('boosts official documentation', () => {
    const developer = reputationFor('https://developer.mozilla.org/en-US/docs/Web/CSS');
    expect(developer.weight).toBeGreaterThan(0);
    expect(developer.reason).toBe('official documentation');
  });

  it('boosts a primary standards source', () => {
    expect(reputationFor('https://www.rfc-editor.org/rfc/rfc9110')).toEqual({
      reason: 'primary standards source',
      weight: 0.3,
    });
  });

  it('treats any .edu or .gov host as an academic or government source', () => {
    expect(reputationFor('https://web.stanford.edu/class/cs106a/').reason).toBe('academic source');
    expect(reputationFor('https://www.nist.gov/publications').reason).toBe('government source');
  });

  it('matches a host suffix but not a lookalike domain', () => {
    expect(reputationFor('https://docs.github.com/en/actions').weight).toBeGreaterThan(0);
    expect(reputationFor('https://github.com.phish.example/repo')).toEqual({
      reason: null,
      weight: 0,
    });
  });

  it('applies a small penalty to low-signal aggregators', () => {
    const penalised = reputationFor('https://www.w3schools.com/js/js_arrays.asp');
    expect(penalised.weight).toBeLessThan(0);
    expect(penalised.weight).toBeGreaterThanOrEqual(-0.2);
    expect(penalised.reason).toBe('low-signal aggregator');
  });

  it('stays neutral on an unknown host', () => {
    expect(reputationFor('https://some-random-blog.example/post')).toEqual({
      reason: null,
      weight: 0,
    });
  });

  it('never throws on an unparseable url', () => {
    expect(reputationFor('not a url')).toEqual({ reason: null, weight: 0 });
    expect(reputationFor('')).toEqual({ reason: null, weight: 0 });
  });

  it('keeps every weight inside the documented range', () => {
    const urls = [
      'https://arxiv.org/abs/1706.03762',
      'https://developer.mozilla.org/',
      'https://docs.python.org/3/',
      'https://example.gov/',
      'https://geeksforgeeks.org/',
      'https://learn.microsoft.com/',
      'https://nodejs.org/api/',
      'https://tutorialspoint.com/',
      'https://w3.org/TR/',
    ];
    for (const url of urls) {
      const { weight } = reputationFor(url);
      expect(weight).toBeGreaterThanOrEqual(-0.2);
      expect(weight).toBeLessThanOrEqual(0.3);
    }
  });
});
