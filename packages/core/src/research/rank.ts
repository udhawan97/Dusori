import { reputationFor } from './reputation.js';
import { compareCandidateScores, scoreCandidate } from './score.js';
import type { ResearchCandidate, ResearchQuery } from './types.js';

export interface RankedCandidate extends ResearchCandidate {
  rankScore: number;
  reasons: string[];
  isNew: boolean;
  /** Set only when an AI provider re-ranked the run; advisory, never a filter. */
  aiScore?: number;
  aiNote?: string;
}

export interface RankOptions {
  now: Date;
  /** Candidate keys already shown. Undefined means "no history", so nothing is new. */
  seen?: ReadonlySet<string>;
}

/**
 * Component weights. Relevance dominates because a beautiful, recent, well-regarded page
 * about the wrong thing is still the wrong thing. Community and recency are normalised to
 * 0..1; reputation is a signed nudge in -1..1 so an unknown host stays genuinely neutral.
 */
const WEIGHTS = { community: 0.2, recency: 0.15, relevance: 0.5, reputation: 0.15 } as const;

/** A candidate with no date sits mid-scale: unknown is not the same as old. */
const NEUTRAL_RECENCY = 0.5;
const RECENCY_FLOOR = 0.2;
const FRESH_YEARS = 1;
const STALE_YEARS = 5;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Largest magnitude `reputationFor` can return, used to normalise it into -1..1. */
const MAX_REPUTATION = 0.3;

/** Pre-formatted community phrase in the provider's own unit, e.g. "40,231 stars". */
const COMMUNITY_META_KEY = 'community';

// Mirrors the tokeniser in score.ts, which does not export it.
function words(input: string): Set<string> {
  return new Set(
    input
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .filter(Boolean),
  );
}

function matchedTermCount(query: ResearchQuery, candidate: ResearchCandidate): number {
  const found = words(`${candidate.title} ${candidate.snippet}`);
  return query.terms.filter((term) => found.has(term)).length;
}

/** Full credit under a year old, decaying to a floor by five; missing or unusable is neutral. */
function recencyOf(
  candidate: ResearchCandidate,
  now: Date,
): { recency: number; year: number | null } {
  const published = candidate.publishedAt ? new Date(candidate.publishedAt) : null;
  if (!published || Number.isNaN(published.getTime()))
    return { recency: NEUTRAL_RECENCY, year: null };
  const years = (now.getTime() - published.getTime()) / MS_PER_YEAR;
  const decayed = (years - FRESH_YEARS) / (STALE_YEARS - FRESH_YEARS);
  return {
    recency: 1 - (1 - RECENCY_FLOOR) * Math.min(Math.max(decayed, 0), 1),
    year: published.getUTCFullYear(),
  };
}

/**
 * Points, stars and votes are different units, so a candidate is only ever compared with
 * others from the same provider. Without this a 40k-star repo would bury every discussion.
 */
function communityCeilings(candidates: ResearchCandidate[]): Map<string, number> {
  const ceilings = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.communityScore === undefined) continue;
    const value = Math.log10(1 + Math.max(candidate.communityScore, 0));
    ceilings.set(candidate.provider, Math.max(ceilings.get(candidate.provider) ?? 0, value));
  }
  return ceilings;
}

export function rankCandidates(
  query: ResearchQuery,
  candidates: ResearchCandidate[],
  options: RankOptions,
): RankedCandidate[] {
  const scored = candidates.map((candidate) => ({
    candidate,
    termScore: scoreCandidate(query, { summary: candidate.snippet, title: candidate.title }),
  }));
  const topRelevance = Math.max(0, ...scored.map((item) => item.termScore));
  const ceilings = communityCeilings(candidates);

  return scored
    .map(({ candidate, termScore }): RankedCandidate => {
      const reasons: string[] = [];

      const relevance = topRelevance > 0 ? termScore / topRelevance : 0;
      if (relevance > 0) {
        const terms = matchedTermCount(query, candidate);
        reasons.push(`matches ${terms} objective ${terms === 1 ? 'term' : 'terms'}`);
      }

      const ceiling = ceilings.get(candidate.provider) ?? 0;
      const community =
        candidate.communityScore === undefined || ceiling === 0
          ? 0
          : Math.log10(1 + Math.max(candidate.communityScore, 0)) / ceiling;
      if (community > 0) {
        reasons.push(
          candidate.meta[COMMUNITY_META_KEY] ?? `${candidate.communityScore} community points`,
        );
      }

      const { recency, year } = recencyOf(candidate, options.now);
      if (year !== null && recency !== NEUTRAL_RECENCY) reasons.push(`published ${year}`);

      const reputation = reputationFor(candidate.url);
      if (reputation.reason) reasons.push(reputation.reason);

      return {
        ...candidate,
        isNew: options.seen ? !options.seen.has(candidate.key) : false,
        rankScore:
          WEIGHTS.relevance * relevance +
          WEIGHTS.community * community +
          WEIGHTS.recency * recency +
          WEIGHTS.reputation * (reputation.weight / MAX_REPUTATION),
        reasons,
      };
    })
    .sort((left, right) =>
      compareCandidateScores(
        { key: left.key, score: left.rankScore, title: left.title, url: left.url },
        { key: right.key, score: right.rankScore, title: right.title, url: right.url },
      ),
    );
}

/**
 * Picks the best candidate of each kind before filling the rest by score, so one provider's
 * ten repositories cannot own the whole shortlist. Candidates with no kind share one bucket.
 */
export function selectDiverse(
  ranked: RankedCandidate[],
  limit = 5,
): { shortlist: RankedCandidate[]; overflow: RankedCandidate[] } {
  const picked = new Set<string>();
  const kinds = new Set<string>();
  for (const candidate of ranked) {
    if (picked.size >= limit) break;
    const kind = candidate.kind ?? '';
    if (kinds.has(kind)) continue;
    kinds.add(kind);
    picked.add(candidate.key);
  }
  for (const candidate of ranked) {
    if (picked.size >= limit) break;
    picked.add(candidate.key);
  }
  return {
    overflow: ranked.filter((candidate) => !picked.has(candidate.key)),
    shortlist: ranked.filter((candidate) => picked.has(candidate.key)),
  };
}
