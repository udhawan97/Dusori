import type { CompanionResearchClient } from '../companion.js';
import type { ResearchProvider, ResearchQuery } from '../types.js';
import { createArxivProvider } from './arxiv.js';
import { githubProvider } from './github.js';
import { hackerNewsProvider } from './hackernews.js';
import { createMsLearnProvider, msLearnProvider } from './mslearn.js';
import { npmProvider } from './npm.js';
import { openAlexProvider } from './openalex.js';
import { createRedditProvider } from './reddit.js';
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
export * from './reddit.js';
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

const generalResearchProviders = new Set([
  'arxiv',
  'openalex',
  'reddit',
  'websearch',
  'wikipedia',
  'youtube',
]);

const developerTerms = new Set([
  'api',
  'app',
  'azure',
  'code',
  'coding',
  'container',
  'css',
  'database',
  'developer',
  'docker',
  'framework',
  'git',
  'github',
  'html',
  'javascript',
  'kubernetes',
  'library',
  'linux',
  'node',
  'npm',
  'package',
  'programming',
  'python',
  'react',
  'repository',
  'rust',
  'software',
  'svelte',
  'typescript',
  'web',
]);

const microsoftTerms = new Set([
  'azure',
  'entra',
  'excel',
  'microsoft',
  'office',
  'powerbi',
  'sharepoint',
  'teams',
  'windows',
]);

/**
 * Keeps specialist catalogs out of broad questions. A package registry is valuable for a
 * programming question and actively misleading for “history of the printing press”, even when a
 * package happens to repeat those words in its name.
 */
export function selectProvidersForQuery(
  providers: ResearchProvider[],
  query: ResearchQuery,
): ResearchProvider[] {
  const terms = new Set(query.terms);
  const searchText = query.searchText;
  const hasMicrosoftCertificationCode = /\b(?:AI|AZ|DP|MB|MD|MS|PL|SC)-\d{3}\b/iu.test(searchText);
  const isDeveloperQuestion = [...terms].some((term) => developerTerms.has(term));
  const isMicrosoftQuestion =
    hasMicrosoftCertificationCode || [...terms].some((term) => microsoftTerms.has(term));
  const selected = providers.filter((provider) => {
    if (generalResearchProviders.has(provider.id)) return true;
    if (provider.id === 'mslearn') return isMicrosoftQuestion;
    if (['github', 'hackernews', 'npm', 'stackexchange'].includes(provider.id)) {
      return isDeveloperQuestion;
    }
    return true;
  });
  return selected.length > 0 ? selected : providers;
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
    createRedditProvider({ search: (query) => companion.searchReddit(query) }),
    createWebSearchProvider({ search: (query) => companion.searchWeb(query) }),
    createYouTubeProvider({
      search: (query) => companion.searchYouTube(query),
    }),
  ];
}
