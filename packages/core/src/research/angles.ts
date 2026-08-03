import { buildResearchQuery } from './plan.js';
import type { ResearchQuery } from './types.js';

/**
 * The perspectives a topic is worth approaching from, derived deterministically from its
 * title. Borrowed from STORM's perspective-guided question asking: one query per angle finds
 * material a single "what is X" search never surfaces, without needing a model to invent them.
 */
export interface ResearchAngle {
  id: string;
  title: string;
  /** What is appended to the topic to seed this angle's search. Empty for the overview. */
  suffix: string;
  /** One line explaining what this angle is looking for, shown beside the chip. */
  intent: string;
}

export const researchAngles: readonly ResearchAngle[] = [
  {
    id: 'overview',
    intent: 'Definitions, scope, and the shape of the subject.',
    suffix: '',
    title: 'Definition and scope',
  },
  {
    id: 'mechanism',
    intent: 'How the thing actually works underneath.',
    suffix: 'how it works',
    title: 'How it works',
  },
  {
    id: 'debate',
    intent: 'Where practitioners disagree, and what the limits are.',
    suffix: 'criticism limitations',
    title: 'Debates and criticism',
  },
  {
    id: 'practice',
    intent: 'Applied guides, tools, and worked examples.',
    suffix: 'guide tools practice',
    title: 'Practice and tools',
  },
  {
    id: 'recent',
    intent: 'What changed lately and what is current.',
    suffix: 'recent developments',
    title: 'Recent developments',
  },
];

export function angleById(id: string): ResearchAngle | null {
  return researchAngles.find((angle) => angle.id === id) ?? null;
}

/**
 * Builds the query for one angle. The angle's words seed the search but are scored at half
 * weight, so a page about the wrong subject cannot win by matching "how it works".
 */
export function buildAngleQuery(topicTitle: string, angle: ResearchAngle): ResearchQuery {
  const query = buildResearchQuery(topicTitle, { title: angle.suffix });
  return {
    ...query,
    angleId: angle.id,
    // The objective slot holds the angle's own words, so the trail reads as a question
    // about the topic rather than as a bare repetition of the title.
    objectiveTitle: angle.suffix || angle.title,
  };
}
