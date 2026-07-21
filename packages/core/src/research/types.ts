export interface ResearchQuery {
  objectiveTitle: string;
  topicTitle: string;
  /** Exactly what a remote provider receives: the topic followed by the objective. */
  searchText: string;
  /** Objective terms followed by the topic terms it does not already carry. */
  terms: string[];
}

export type ResearchProviderId = 'mslearn' | 'wikipedia';

export interface ResearchCandidate {
  key: string;
  provider: ResearchProviderId;
  title: string;
  url: string;
  snippet: string;
  score: number;
  meta: Record<string, string>;
}

export interface ResearchCapture {
  title: string;
  url: string;
  content: string;
}

export interface ResearchProvider {
  readonly id: ResearchProviderId;
  readonly label: string;
  readonly disclosure: string;
  /**
   * Identifies what this provider's consent actually covers. Defaults to `id`.
   * A variant that widens egress must set its own scope so consent given for the
   * narrower disclosure is asked again rather than silently reused.
   */
  readonly consentScope?: string;
  search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]>;
  capture(candidate: ResearchCandidate, fetchImpl: typeof fetch): Promise<ResearchCapture>;
}
