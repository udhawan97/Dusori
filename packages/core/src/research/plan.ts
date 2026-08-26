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
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
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
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
]);

const researchInstructionTerms = new Set([
  'central',
  'describe',
  'explain',
  'guide',
  'introduction',
  'mechanism',
  'overview',
  'own',
  'words',
  'your',
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

function requiredPhrases(input: string): string[] {
  return [
    ...new Set(
      [...input.matchAll(/\b(?:AI|AZ|DP|MB|MD|MS|PL|SC)-\d{3}\b/giu)].map((match) =>
        deriveTerms(match[0]).join(' '),
      ),
    ),
  ].filter(Boolean);
}

export function buildResearchQuery(
  topicTitle: string,
  objective: { title: string },
): ResearchQuery {
  const questionText = objective.title.trim() || topicTitle.trim();
  const objectiveTitle = cleanObjectiveTitle(objective.title);
  const topic = cleanObjectiveTitle(topicTitle);
  const objectiveTerms = deriveTerms(objectiveTitle);
  // The user's real question is the topic plus the objective. Dusori's own scaffold objectives
  // ("Explain the central mechanism in your own words") name no subject, so an objective-only
  // query matches on filler words and returns unrelated sources.
  const allTopicTerms = deriveTerms(topic).filter((term) => !researchInstructionTerms.has(term));
  const topicTerms = allTopicTerms.filter((term) => !objectiveTerms.includes(term));
  const subjectTerms = [...new Set([...allTopicTerms, ...objectiveTerms])].filter(
    (term) => !researchInstructionTerms.has(term),
  );
  const searchText = [topic, objectiveTitle === topic ? '' : objectiveTitle]
    .filter(Boolean)
    .join(' ');
  const phrases = requiredPhrases(searchText);
  return {
    objectiveTitle,
    ...(questionText ? { questionText } : {}),
    ...(phrases.length ? { requiredPhrases: phrases } : {}),
    searchText,
    ...(subjectTerms.length ? { subjectTerms } : {}),
    terms: [...objectiveTerms, ...topicTerms],
    ...(allTopicTerms.length ? { topicTerms: allTopicTerms } : {}),
    topicTitle: topic,
  };
}
