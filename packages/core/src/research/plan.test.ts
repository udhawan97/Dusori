import { describe, expect, it } from 'vitest';

import { buildResearchQuery } from './plan.js';

describe('research query planning', () => {
  it('cleans objective markup and derives deterministic search terms', () => {
    expect(
      buildResearchQuery('Azure administration', {
        title: '**Configure** [[Microsoft Entra ID|Microsoft Entra ID]] for the _tenant_',
      }),
    ).toEqual({
      objectiveTitle: 'Configure Microsoft Entra ID for the tenant',
      terms: ['configure', 'microsoft', 'entra', 'id', 'tenant'],
      topicTitle: 'Azure administration',
    });
  });
});
