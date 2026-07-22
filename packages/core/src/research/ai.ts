import { z } from 'zod';

import type { BriefSource } from './brief.js';
import { CompanionFetchError, type CompanionClientOptions } from './companion.js';
import type { RankedCandidate } from './rank.js';
import type { ResearchQuery } from './types.js';

const CapabilitiesSchema = z.object({
  providers: z.array(z.object({ id: z.string(), model: z.string() })),
});

const RerankResponseSchema = z.object({
  results: z.array(z.object({ aiScore: z.number(), key: z.string(), note: z.string() })),
});

const BriefResponseSchema = z.object({ brief: z.string().min(1) });

export type AiCapability = z.infer<typeof CapabilitiesSchema>['providers'][number];

export interface AiRerankEntry {
  key: string;
  aiScore: number;
  note: string;
}

export interface CompanionAiClient {
  capabilities(): Promise<AiCapability[]>;
  rerank(query: ResearchQuery, candidates: RankedCandidate[]): Promise<AiRerankEntry[]>;
  writeBrief(query: ResearchQuery, sources: BriefSource[]): Promise<string>;
}

const unavailable = 'AI ranking could not be reached through the companion.';

export function createCompanionAiClient(options: CompanionClientOptions): CompanionAiClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/+$/u, '');
  const authorization = { Authorization: `Bearer ${options.token}` };

  async function readJson(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { ...authorization, 'Content-Type': 'application/json' },
    }).catch(() => null);
    if (!response?.ok) throw new CompanionFetchError(unavailable, 'ai-failed');
    return response.json().catch(() => null);
  }

  return {
    async capabilities() {
      // No providers, an unreachable companion, and an unreadable answer all look the same
      // to the app: no AI affordances.
      const body = await readJson('/api/ai/capabilities').catch(() => null);
      const parsed = CapabilitiesSchema.safeParse(body);
      return parsed.success ? parsed.data.providers : [];
    },

    async rerank(query, candidates) {
      const parsed = RerankResponseSchema.safeParse(
        await readJson('/api/ai/rerank', {
          body: JSON.stringify({
            candidates: candidates.map((candidate) => ({
              key: candidate.key,
              ...(candidate.kind === undefined ? {} : { kind: candidate.kind }),
              snippet: candidate.snippet,
              title: candidate.title,
              url: candidate.url,
            })),
            query: query.searchText,
          }),
          method: 'POST',
        }),
      );
      if (!parsed.success) throw new CompanionFetchError(unavailable, 'ai-failed');
      return parsed.data.results;
    },

    async writeBrief(query, sources) {
      const parsed = BriefResponseSchema.safeParse(
        await readJson('/api/ai/brief', {
          body: JSON.stringify({
            query: query.searchText,
            sources: sources.map((source) => ({
              ...(source.kind === undefined ? {} : { kind: source.kind }),
              reasons: source.reasons,
              title: source.title,
              url: source.url,
            })),
          }),
          method: 'POST',
        }),
      );
      if (!parsed.success) throw new CompanionFetchError(unavailable, 'ai-failed');
      return parsed.data.brief;
    },
  };
}

/**
 * Applies an AI verdict to an already-ranked list. Advisory only: every candidate stays, the
 * AI's order and one-line notes are layered on, and anything it did not score keeps its
 * deterministic position after the scored ones.
 */
export function applyAiRerank(
  ranked: RankedCandidate[],
  entries: AiRerankEntry[],
): RankedCandidate[] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  return [...ranked]
    .map((candidate) => {
      const entry = byKey.get(candidate.key);
      return entry
        ? { ...candidate, aiNote: entry.note || undefined, aiScore: entry.aiScore }
        : candidate;
    })
    .sort((left, right) => {
      const byAi = (right.aiScore ?? -1) - (left.aiScore ?? -1);
      if (byAi) return byAi;
      return right.rankScore - left.rankScore;
    });
}
