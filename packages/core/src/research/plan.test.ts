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
      questionText: '**Configure** [[Microsoft Entra ID|Microsoft Entra ID]] for the _tenant_',
      searchText: 'Azure administration Configure Microsoft Entra ID for the tenant',
      subjectTerms: ['azure', 'administration', 'configure', 'microsoft', 'entra', 'id', 'tenant'],
      terms: ['configure', 'microsoft', 'entra', 'id', 'tenant', 'azure', 'administration'],
      topicTerms: ['azure', 'administration'],
      topicTitle: 'Azure administration',
    });
  });

  it('carries the topic into a scaffold objective that names no subject', () => {
    const query = buildResearchQuery('AI Fundamentals', {
      title: 'Explain the central mechanism in your own words.',
    });

    expect(query.searchText).toBe(
      'AI Fundamentals Explain the central mechanism in your own words.',
    );
    expect(query.terms).toEqual([
      'explain',
      'central',
      'mechanism',
      'your',
      'own',
      'words',
      'ai',
      'fundamentals',
    ]);
    expect(query.subjectTerms).toEqual(['ai', 'fundamentals']);
    expect(query.topicTerms).toEqual(['ai', 'fundamentals']);
  });

  it('never repeats a term the objective already carries', () => {
    const query = buildResearchQuery('Machine learning', {
      title: 'Explain supervised machine models',
    });

    expect(query.terms).toEqual(['explain', 'supervised', 'machine', 'models', 'learning']);
  });

  it('falls back to the objective alone when the topic title is blank', () => {
    const query = buildResearchQuery('   ', { title: 'Describe neural networks' });

    expect(query.searchText).toBe('Describe neural networks');
    expect(query.terms).toEqual(['describe', 'neural', 'networks']);
  });

  it('does not send the same topic twice when the question has not been expanded yet', () => {
    const query = buildResearchQuery('History of the printing press', {
      title: 'History of the printing press',
    });

    expect(query.searchText).toBe('History of the printing press');
    expect(query.questionText).toBe('History of the printing press');
    expect(query.terms).toEqual(['history', 'printing', 'press']);
  });

  it('keeps the visible question separate from the provider-expanded search text', () => {
    const query = buildResearchQuery('TypeScript', {
      title: 'How does its compiler preserve type safety?',
    });

    expect(query.questionText).toBe('How does its compiler preserve type safety?');
    expect(query.searchText).toBe('TypeScript How does its compiler preserve type safety?');
  });

  it('keeps question grammar out of the subject gate', () => {
    const query = buildResearchQuery('Spaced repetition', {
      title: 'How does spaced repetition improve durable learning?',
    });

    expect(query.subjectTerms).toEqual(['spaced', 'repetition', 'improve', 'durable', 'learning']);
    expect(query.subjectTerms).not.toContain('does');
  });

  it('preserves a certification code as a required phrase for ranking', () => {
    const query = buildResearchQuery('AI-901', { title: 'Prepare for AI-901' });

    expect(query.requiredPhrases).toEqual(['ai 901']);
  });
});
