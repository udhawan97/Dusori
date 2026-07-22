export interface ResearchQuery {
  objectiveTitle: string;
  topicTitle: string;
  /** Exactly what a remote provider receives: the topic followed by the objective. */
  searchText: string;
  /** Objective terms followed by the topic terms it does not already carry. */
  terms: string[];
}

/**
 * Open by design. Providers arrive as data (one file plus one registry entry), and a
 * workspace written by a newer build must stay readable by an older one, so nothing
 * validates this against a fixed list.
 */
export type ResearchProviderId = string;

/** What a candidate is, used to keep a shortlist from filling up with one kind of thing. */
export type ResearchCandidateKind = 'article' | 'course' | 'docs' | 'paper' | 'qa' | 'repo';

export interface ResearchCandidate {
  key: string;
  provider: ResearchProviderId;
  title: string;
  url: string;
  snippet: string;
  score: number;
  meta: Record<string, string>;
  kind?: ResearchCandidateKind;
  /** ISO date the artifact itself was published, when the provider reports one. */
  publishedAt?: string;
  /** Raw community signal in the provider's own unit: points, stars, or votes. */
  communityScore?: number;
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
  /**
   * How this candidate's content was obtained, recorded in the source's provenance.
   * Lives on the provider so adding one never means editing a switch in the UI.
   */
  capturedVia(candidate: ResearchCandidate): string;
  /** One short line of provider-specific detail for the candidate card. */
  describeMeta(candidate: ResearchCandidate): string;
}
