import type { ResearchQuery } from './types.js';

export interface CandidateScoreInput {
  popularity?: number;
  summary: string;
  title: string;
}

export interface RankedCandidateScore {
  key: string;
  popularity?: number;
  score: number;
  title: string;
  url: string;
}

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

export function scoreCandidate(query: ResearchQuery, candidate: CandidateScoreInput): number {
  const titleWords = words(candidate.title);
  const summaryWords = words(candidate.summary);
  return query.terms.reduce(
    (score, term) => score + (titleWords.has(term) ? 3 : 0) + (summaryWords.has(term) ? 1 : 0),
    0,
  );
}

function compareText(left: string, right: string): number {
  const normalizedLeft = left.normalize('NFKD').toLowerCase();
  const normalizedRight = right.normalize('NFKD').toLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

export function compareCandidateScores(
  left: RankedCandidateScore,
  right: RankedCandidateScore,
): number {
  const byScore = right.score - left.score;
  if (byScore) return byScore;
  const byPopularity = (right.popularity ?? 0) - (left.popularity ?? 0);
  if (byPopularity) return byPopularity;
  return (
    compareText(left.title, right.title) ||
    compareText(left.url, right.url) ||
    compareText(left.key, right.key)
  );
}
