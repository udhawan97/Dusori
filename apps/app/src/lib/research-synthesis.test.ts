import { describe, expect, it, vi } from 'vitest';

import type { CompanionAiClient, SourceRecord } from '@dusori/core';

import { createAiSynthesisOptions } from './research-synthesis';

describe('AI synthesis payload', () => {
  it('sends only quoted passages and labels the returned model', async () => {
    const writeSynthesis = vi.fn(async () => 'A concise source-grounded overview.');
    const ai = { writeSynthesis } as unknown as CompanionAiClient;
    const sources = [
      {
        claims: [{ heading: 'Mechanism', text: 'Retrieval strengthens later recall.' }],
        title: 'Learning study',
      },
    ] as SourceRecord[];

    await expect(
      createAiSynthesisOptions(ai, 'gemma4:12b-it-qat', 'Memory', sources),
    ).resolves.toEqual({
      aiModel: 'gemma4:12b-it-qat',
      aiOverview: 'A concise source-grounded overview.',
    });
    expect(writeSynthesis).toHaveBeenCalledWith('Memory', [
      {
        heading: 'Mechanism',
        source: 'Learning study',
        text: 'Retrieval strengthens later recall.',
      },
    ]);
  });

  it('does not call a model when no source carries quoted evidence', async () => {
    const writeSynthesis = vi.fn();
    const ai = { writeSynthesis } as unknown as CompanionAiClient;

    await expect(
      createAiSynthesisOptions(ai, 'gemma4:12b-it-qat', 'Memory', [
        { title: 'Reference' } as SourceRecord,
      ]),
    ).resolves.toEqual({});
    expect(writeSynthesis).not.toHaveBeenCalled();
  });
});
