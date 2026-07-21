import type { ResearchQuery } from './types.js';

const englishStopwords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
]);

function cleanObjectiveTitle(input: string): string {
  return input
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, '$2')
    .replace(/\[\[([^\]]+)\]\]/gu, '$1')
    .replace(/(?:\*\*|__|~~|`)/gu, '')
    .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

function deriveTerms(input: string): string[] {
  const normalized = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
  if (!normalized) return [];
  return [...new Set(normalized.split(/\s+/u).filter((term) => !englishStopwords.has(term)))];
}

export function buildResearchQuery(
  topicTitle: string,
  objective: { title: string },
): ResearchQuery {
  const objectiveTitle = cleanObjectiveTitle(objective.title);
  return {
    objectiveTitle,
    terms: deriveTerms(objectiveTitle),
    topicTitle: topicTitle.trim(),
  };
}
