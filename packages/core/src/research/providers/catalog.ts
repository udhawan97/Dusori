import type { CompanionResearchClient, ResearchCapability } from '../companion.js';
import type { ResearchProvider, ResearchQuery } from '../types.js';
import { createArxivProvider } from './arxiv.js';
import { crossrefProvider } from './crossref.js';
import { europePmcProvider } from './europepmc.js';
import { githubProvider } from './github.js';
import { hackerNewsProvider } from './hackernews.js';
import { libraryOfCongressProvider } from './library-of-congress.js';
import { createMsLearnProvider, msLearnProvider } from './mslearn.js';
import { npmProvider } from './npm.js';
import { openAlexProvider } from './openalex.js';
import { openLibraryProvider } from './openlibrary.js';
import { createRedditProvider } from './reddit.js';
import { stackExchangeProvider } from './stackexchange.js';
import { createWebSearchProvider } from './websearch.js';
import { wikipediaProvider } from './wikipedia.js';
import { createYouTubeProvider } from './youtube.js';

export type ResearchProviderMode = 'browser' | 'companion';
export type ResearchProviderLens = 'academic' | 'books' | 'community' | 'docs' | 'video' | 'web';
export type ResearchCapturePolicy = NonNullable<ResearchProvider['capturePolicy']>;
export type ResearchAudience =
  'biomedical' | 'cultural-heritage' | 'developer' | 'general' | 'microsoft';

interface ProviderRegistration {
  id: string;
  mode: ResearchProviderMode;
  audience: ResearchAudience;
  lens: ResearchProviderLens;
  capturePolicy: ResearchCapturePolicy;
  consentLabel: string;
  create(companion: CompanionResearchClient | null): ResearchProvider;
}

export interface ResearchProviderCatalogEntry {
  id: string;
  label: string;
  mode: ResearchProviderMode;
  audience: ResearchAudience;
  lens: ResearchProviderLens;
  capturePolicy: ResearchCapturePolicy;
  consentScope: string;
  consentLabel: string;
  disclosure: string;
  origins: readonly string[];
  available: boolean;
  detail: string;
}

export interface ResearchProviderPolicy {
  browserOrigins: readonly string[];
  consentLabels: Readonly<Record<string, string>>;
  entries: readonly Omit<
    ResearchProviderCatalogEntry,
    'available' | 'detail' | 'disclosure' | 'origins' | 'consentScope'
  >[];
  lensFor(providerId: string): ResearchProviderLens;
}

export interface ResearchProviderSession {
  catalog: readonly ResearchProviderCatalogEntry[];
  providers: readonly ResearchProvider[];
  availableProviders: readonly ResearchProvider[];
  select(query: ResearchQuery, allowedScopes?: ReadonlySet<string>): ResearchProvider[];
}

export interface LoadResearchProviderCatalogOptions {
  companion?: CompanionResearchClient | null;
}

const developerTerms = new Set([
  'api',
  'coding',
  'css',
  'developer',
  'docker',
  'git',
  'github',
  'html',
  'javascript',
  'kubernetes',
  'linux',
  'npm',
  'programming',
  'react',
  'software',
  'svelte',
  'typescript',
]);

const developerPhrases = [
  /\b(?:build|debug|develop|deploy|program|test)\b.{0,32}\b(?:app|application|code|software|website)\b/iu,
  /\b(?:app|application|code|software|website)\b.{0,32}\b(?:bug|development|framework|package|repository|runtime)\b/iu,
  /\bcontainer images?\b/iu,
  /\bnode(?:\.js|js)\b/iu,
  /\bpackage managers?\b/iu,
  /\bpython (?:code|libraries|library|packages?|program(?:ming)?|scripts?|tutorials?)\b/iu,
  /\b(?:code|program|script) (?:in|with) python\b/iu,
  /\brust (?:code|crates?|language|program(?:ming)?|tutorials?)\b/iu,
  /\b(?:code|program) (?:in|with) rust\b/iu,
  /\bsource code\b/iu,
  /\bweb (?:apps?|applications?|development|frameworks?)\b/iu,
];

const microsoftTerms = new Set(['azure', 'entra', 'microsoft', 'powerbi', 'sharepoint']);

const microsoftPhrases = [
  /\bexcel (?:formulas?|power query|spreadsheets?|vba|workbooks?)\b/iu,
  /\bmicrosoft (?:365|excel|office|teams|windows)\b/iu,
  /\boffice 365\b/iu,
  /\bpower bi\b/iu,
  /\bvisual studio(?: code)?\b/iu,
  /\bwindows (?:10|11|server)\b/iu,
];

// Specialist routing happens entirely on-device. These are intentionally narrow: an ambiguous
// phrase should leave a provider off rather than turn an allowed specialist into surprise egress.
const biomedicalTerms = new Set([
  'anatomy',
  'biomedical',
  'cancer',
  'clinical',
  'disease',
  'diseases',
  'epidemiology',
  'genome',
  'genomic',
  'influenza',
  'malaria',
  'medical',
  'medicine',
  'neuroscience',
  'oncology',
  'pathology',
  'pharmacology',
  'physiology',
  'vaccine',
  'vaccines',
  'virology',
]);

const biomedicalPhrases = [
  /\bhealth care\b/iu,
  /\bpublic health\b/iu,
  /\bpatient outcomes?\b/iu,
  /\bclinical trials?\b/iu,
  /\binfectious diseases?\b/iu,
  /\b(?:hiv|influenza|sars(?:-cov-2)?|covid-?19)\b/iu,
  /\b(?:bacterial|clinical|human|medical|respiratory|viral) infections?\b/iu,
  /\bhospital-acquired infections?\b/iu,
  /\binfection (?:control|prevention|transmission|treatment)\b/iu,
  /\b(?:human|animal|plant|respiratory) (?:virus|viruses)\b/iu,
  /\b(?:virus|viruses) (?:infection|transmission|vaccines?)\b/iu,
  /\bviral (?:disease|infection|transmission)\b/iu,
];

const culturalHeritagePhrases = [
  /\barchival collections?\b/iu,
  /\bcultural heritage\b/iu,
  /\bdigitized (?:archives?|collections?|manuscripts?|maps?|newspapers?|photographs?|posters?)\b/iu,
  /\bhistorical (?:archives?|manuscripts?|maps?|newspapers?|records?|photographs?|posters?)\b/iu,
  /\blibrary of congress\b/iu,
  /\bmuseum collections?\b/iu,
  /\boral histor(?:y|ies)\b/iu,
  /\bprimary[- ]sources?\b/iu,
];

const registrations: readonly ProviderRegistration[] = [
  {
    audience: 'microsoft',
    capturePolicy: 'reference-only',
    consentLabel: 'Microsoft Learn catalog',
    create: (companion) =>
      companion
        ? createMsLearnProvider({ ranked: (query) => companion.searchMsLearnRanked(query) })
        : msLearnProvider,
    id: 'mslearn',
    lens: 'docs',
    mode: 'browser',
  },
  {
    audience: 'general',
    capturePolicy: 'readable-or-reference',
    consentLabel: 'Wikipedia',
    create: () => wikipediaProvider,
    id: 'wikipedia',
    lens: 'docs',
    mode: 'browser',
  },
  {
    audience: 'developer',
    capturePolicy: 'reference-only',
    consentLabel: 'Hacker News',
    create: () => hackerNewsProvider,
    id: 'hackernews',
    lens: 'community',
    mode: 'browser',
  },
  {
    audience: 'developer',
    capturePolicy: 'readable-or-reference',
    consentLabel: 'GitHub',
    create: () => githubProvider,
    id: 'github',
    lens: 'docs',
    mode: 'browser',
  },
  {
    audience: 'developer',
    capturePolicy: 'readable-or-reference',
    consentLabel: 'Stack Exchange',
    create: () => stackExchangeProvider,
    id: 'stackexchange',
    lens: 'community',
    mode: 'browser',
  },
  {
    audience: 'biomedical',
    capturePolicy: 'readable-or-reference',
    consentLabel: 'Europe PMC',
    create: () => europePmcProvider,
    id: 'europepmc',
    lens: 'academic',
    mode: 'browser',
  },
  {
    audience: 'general',
    capturePolicy: 'readable-or-reference',
    consentLabel: 'OpenAlex',
    create: () => openAlexProvider,
    id: 'openalex',
    lens: 'academic',
    mode: 'browser',
  },
  {
    audience: 'cultural-heritage',
    capturePolicy: 'reference-only',
    consentLabel: 'Library of Congress',
    create: () => libraryOfCongressProvider,
    id: 'loc',
    lens: 'web',
    mode: 'browser',
  },
  {
    audience: 'general',
    capturePolicy: 'readable-or-reference',
    consentLabel: 'Crossref',
    create: () => crossrefProvider,
    id: 'crossref',
    lens: 'academic',
    mode: 'browser',
  },
  {
    audience: 'general',
    capturePolicy: 'reference-only',
    consentLabel: 'Open Library',
    create: () => openLibraryProvider,
    id: 'openlibrary',
    lens: 'books',
    mode: 'browser',
  },
  {
    audience: 'developer',
    capturePolicy: 'readable-or-reference',
    consentLabel: 'npm registry',
    create: () => npmProvider,
    id: 'npm',
    lens: 'docs',
    mode: 'browser',
  },
  {
    audience: 'general',
    capturePolicy: 'readable-or-reference',
    consentLabel: 'arXiv',
    create: (companion) =>
      createArxivProvider({
        search: (query) => requiredCompanion(companion).searchArxiv(query),
      }),
    id: 'arxiv',
    lens: 'academic',
    mode: 'companion',
  },
  {
    audience: 'general',
    capturePolicy: 'readable-or-reference',
    consentLabel: 'Reddit',
    create: (companion) =>
      createRedditProvider({
        search: (query) => requiredCompanion(companion).searchReddit(query),
      }),
    id: 'reddit',
    lens: 'community',
    mode: 'companion',
  },
  {
    audience: 'general',
    capturePolicy: 'reference-only',
    consentLabel: 'Configured web search',
    create: (companion) =>
      createWebSearchProvider({
        search: (query) => requiredCompanion(companion).searchWeb(query),
      }),
    id: 'websearch',
    lens: 'web',
    mode: 'companion',
  },
  {
    audience: 'general',
    capturePolicy: 'reference-only',
    consentLabel: 'YouTube metadata',
    create: (companion) =>
      createYouTubeProvider({
        search: (query) => requiredCompanion(companion).searchYouTube(query),
      }),
    id: 'youtube',
    lens: 'video',
    mode: 'companion',
  },
];

function requiredCompanion(companion: CompanionResearchClient | null): CompanionResearchClient {
  if (!companion) throw new Error('This provider requires the local companion.');
  return companion;
}

const catalogCompanion = new Proxy(
  {},
  {
    get: () => () => Promise.reject(new Error('Catalog metadata does not call the companion.')),
  },
) as CompanionResearchClient;

function isRelevantProvider(registration: ProviderRegistration, query: ResearchQuery): boolean {
  const terms = new Set(query.terms);
  const hasMicrosoftCertificationCode = /\b(?:AI|AZ|DP|MB|MD|MS|PL|SC)-\d{3}\b/iu.test(
    query.searchText,
  );
  const isDeveloperQuestion =
    [...terms].some((term) => developerTerms.has(term)) ||
    developerPhrases.some((phrase) => phrase.test(query.searchText));
  const isMicrosoftQuestion =
    hasMicrosoftCertificationCode ||
    [...terms].some((term) => microsoftTerms.has(term)) ||
    microsoftPhrases.some((phrase) => phrase.test(query.searchText));
  const isBiomedicalQuestion =
    [...terms].some((term) => biomedicalTerms.has(term)) ||
    biomedicalPhrases.some((phrase) => phrase.test(query.searchText));
  const isCulturalHeritageQuestion = culturalHeritagePhrases.some((phrase) =>
    phrase.test(query.searchText),
  );
  if (registration.audience === 'biomedical') return isBiomedicalQuestion;
  if (registration.audience === 'cultural-heritage') return isCulturalHeritageQuestion;
  if (registration.audience === 'microsoft') return isMicrosoftQuestion;
  if (registration.audience === 'developer') return isDeveloperQuestion;
  return registration.audience === 'general';
}

function capabilityDetail(capability: ResearchCapability | undefined): string {
  if (capability?.available) return 'Ready through the local companion';
  if (capability?.reason === 'not-configured') return 'Not configured in the local companion';
  return capability?.reason || 'Not configured in the local companion';
}

const browserProviders = registrations
  .filter((entry) => entry.mode === 'browser')
  .map((entry) => entry.create(null));

const consentLabels = Object.fromEntries(
  registrations.map((entry) => [entry.id, entry.consentLabel]),
) as Record<string, string>;
consentLabels['mslearn-ranked'] = 'Microsoft Learn ranked search';

const lensByProvider = new Map(registrations.map((entry) => [entry.id, entry.lens]));
const registrationByProvider = new Map(registrations.map((entry) => [entry.id, entry]));

function registeredProvider(
  registration: ProviderRegistration,
  companion: CompanionResearchClient | null,
): ResearchProvider {
  return { ...registration.create(companion), capturePolicy: registration.capturePolicy };
}

export const researchProviderPolicy: ResearchProviderPolicy = {
  browserOrigins: [...new Set(browserProviders.flatMap((provider) => provider.origins))],
  consentLabels,
  entries: registrations.map(
    ({ audience, capturePolicy, consentLabel, create, id, lens, mode }) => ({
      audience,
      capturePolicy,
      consentLabel,
      id,
      label: create(mode === 'companion' ? catalogCompanion : null).label,
      lens,
      mode,
    }),
  ),
  lensFor(providerId) {
    return lensByProvider.get(providerId) ?? 'web';
  },
};

/**
 * Builds one capability-aware provider session. Browser catalogs remain usable when the local
 * companion is absent or unhealthy; companion-only providers become available only when their
 * reported capability is ready.
 */
export async function loadResearchProviderCatalog(
  options: LoadResearchProviderCatalogOptions = {},
): Promise<ResearchProviderSession> {
  const companion = options.companion ?? null;
  const capabilities = new Map(
    companion
      ? await companion
          .capabilities()
          .then((items) => items.map((capability) => [capability.id, capability] as const))
          .catch(() => [])
      : [],
  );
  const providers = registrations
    .filter((entry) => entry.mode === 'browser' || companion)
    .map((entry) =>
      entry.id === 'mslearn' && capabilities.get('mslearn')?.available !== true
        ? registeredProvider(entry, null)
        : registeredProvider(entry, companion),
    );
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  const availableProviders = providers.filter((provider) => {
    const registration = registrations.find((entry) => entry.id === provider.id);
    return registration?.mode === 'browser' || capabilities.get(provider.id)?.available === true;
  });
  const availableIds = new Set(availableProviders.map((provider) => provider.id));
  const catalog = registrations.map((registration): ResearchProviderCatalogEntry => {
    const provider = providersById.get(registration.id) ?? registration.create(catalogCompanion);
    const consentScope = provider.consentScope ?? provider.id;
    const available = availableIds.has(registration.id);
    return {
      audience: registration.audience,
      available,
      capturePolicy: registration.capturePolicy,
      consentLabel: consentLabels[consentScope] ?? registration.consentLabel,
      consentScope,
      detail:
        registration.mode === 'browser'
          ? 'Ready in this app'
          : companion
            ? capabilityDetail(capabilities.get(registration.id))
            : 'Requires the free local companion',
      disclosure: provider.disclosure,
      id: registration.id,
      label: provider.label,
      lens: registration.lens,
      mode: registration.mode,
      origins: provider.origins,
    };
  });

  return {
    availableProviders,
    catalog,
    providers,
    select(query, allowedScopes) {
      const allowed = availableProviders.filter((provider) => {
        const scope = provider.consentScope ?? provider.id;
        return !allowedScopes || allowedScopes.has(scope);
      });
      const selected = allowed.filter((provider) => {
        const registration = registrationByProvider.get(provider.id);
        return registration ? isRelevantProvider(registration, query) : true;
      });
      return selected;
    },
  };
}
