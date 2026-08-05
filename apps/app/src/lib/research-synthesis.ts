import type { CompanionAiClient, RenderSynthesisOptions, SourceRecord } from '@dusori/core';

/**
 * Sends only the bounded passages already quoted from saved sources. Provider consent stays with
 * the calling UI; this module owns the shared payload and fallback contract.
 */
export async function createAiSynthesisOptions(
  ai: CompanionAiClient,
  model: string,
  topicTitle: string,
  sources: SourceRecord[],
): Promise<RenderSynthesisOptions> {
  const claims = sources.flatMap((record) =>
    (record.claims ?? []).map((claim) => ({
      ...(claim.heading === undefined ? {} : { heading: claim.heading }),
      source: record.title,
      text: claim.text,
    })),
  );
  if (claims.length === 0) return {};
  return {
    aiModel: model,
    aiOverview: await ai.writeSynthesis(topicTitle, claims.slice(0, 60)),
  };
}
