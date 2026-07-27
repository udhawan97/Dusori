import type { CompanionResearchClient } from '../companion.js';
import type { ResearchProvider } from '../types.js';
import { createArxivProvider } from './arxiv.js';
import { githubProvider } from './github.js';
import { hackerNewsProvider } from './hackernews.js';
import { createMsLearnProvider, msLearnProvider } from './mslearn.js';
import { npmProvider } from './npm.js';
import { openAlexProvider } from './openalex.js';
import { stackExchangeProvider } from './stackexchange.js';
import { createWebSearchProvider } from './websearch.js';
import { wikipediaProvider } from './wikipedia.js';
import { createYouTubeProvider } from './youtube.js';

export * from './arxiv.js';
export * from './github.js';
export * from './hackernews.js';
export * from './mslearn.js';
export * from './npm.js';
export * from './openalex.js';
export * from './stackexchange.js';
export * from './websearch.js';
export * from './wikipedia.js';
export * from './youtube.js';

/** Every provider the hosted app can reach on its own: no key, no companion, no configuration. */
export const researchProviders = [
  msLearnProvider,
  wikipediaProvider,
  hackerNewsProvider,
  githubProvider,
  stackExchangeProvider,
  openAlexProvider,
  npmProvider,
] as const;

export interface ResearchProviderOptions {
  companion?: CompanionResearchClient | null;
}

/**
 * The provider list for a session. A companion upgrades Microsoft Learn to ranked search and
 * unlocks the two providers the browser cannot reach itself, so the list is built rather than
 * declared — adding a provider stays one file plus one entry here.
 */
export function createResearchProviders(options: ResearchProviderOptions = {}): ResearchProvider[] {
  const companion = options.companion ?? null;
  if (!companion) return [...researchProviders];
  return [
    createMsLearnProvider({ ranked: (query) => companion.searchMsLearnRanked(query) }),
    wikipediaProvider,
    hackerNewsProvider,
    githubProvider,
    stackExchangeProvider,
    openAlexProvider,
    npmProvider,
    createArxivProvider({ search: (query) => companion.searchArxiv(query) }),
    createWebSearchProvider({ search: (query) => companion.searchWeb(query) }),
    createYouTubeProvider({
      search: (query) => companion.searchYouTube(query),
      transcript: (videoId) => companion.fetchYouTubeTranscript(videoId),
    }),
  ];
}
