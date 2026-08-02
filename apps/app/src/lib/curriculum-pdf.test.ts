import { parseCurriculum } from '@dusori/core';
import { describe, expect, it } from 'vitest';

import { assemblePdfText } from './pdf-text';

/** One page of an AWS exam guide as pdfjs reports it: lines of glyph runs. */
const examGuidePage: string[][] = [
  ['AWS Certified Solutions Architect', ' - Associate (SAA-C03)'],
  ['Domain 1: Design Secure Architectures (30% of scored content)'],
  ['Task Statement 1.1: Design secure access to AWS resources.'],
  ['Task Statement 1.2: Design secure workloads and'],
  ['applications.'],
  ['Knowledge of:'],
  ['• Access controls and management across multiple accounts'],
  ['Domain 2: Design Resilient Architectures (26% of scored content)'],
  ['Task Statement 2.1: Design scalable and loosely coupled architectures.'],
];

describe('an extracted pdf exam guide', () => {
  it('parses into the domains and task statements of a roadmap', () => {
    const draft = parseCurriculum({
      adapterId: 'auto',
      content: assemblePdfText([examGuidePage]),
      sourceTitle: 'AWS SAA-C03 exam guide',
    });

    expect(draft.adapterId).toBe('aws-exam-guide');
    expect(draft.objectives).toEqual([
      { depth: 1, title: 'Design Secure Architectures', weight: '30%' },
      { depth: 2, title: 'Design secure access to AWS resources' },
      { depth: 2, title: 'Design secure workloads and applications' },
      { depth: 1, title: 'Design Resilient Architectures', weight: '26%' },
      { depth: 2, title: 'Design scalable and loosely coupled architectures' },
    ]);
  });

  it('finds no structure at all once those line breaks are collapsed away', () => {
    const collapsed = assemblePdfText([[examGuidePage.flat()]]);

    expect(() =>
      parseCurriculum({ adapterId: 'auto', content: collapsed, sourceTitle: 'Exam guide' }),
    ).toThrow(/could not recognize/iu);
  });
});
