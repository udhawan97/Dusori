export interface ResearchQuery {
  objectiveTitle: string;
  topicTitle: string;
  /** Exactly what a remote provider receives: the topic followed by the objective. */
  searchText: string;
  /** Objective terms followed by the topic terms it does not already carry. */
  terms: string[];
  /** Subject-bearing terms after generic research instructions are removed. */
  subjectTerms?: string[];
  /** Terms from the topic itself. Automatic capture requires at least one when present. */
  topicTerms?: string[];
  /** Structured identifiers that must appear together, e.g. `AI-901` as `ai 901`. */
  requiredPhrases?: string[];
  /** Which research angle seeded this query, recorded on the run so a trail stays readable. */
  angleId?: string;
}

const readableCaptureMethods = new Set([
  'api-abstract',
  'api-extract',
  'page-extract',
  'readme-extract',
]);

/** One shared evidence boundary for every research UI. */
export function isReadableResearchCapture(capturedVia: string): boolean {
  return readableCaptureMethods.has(capturedVia);
}

/**
 * Open by design. Providers arrive as data (one file plus one registry entry), and a
 * workspace written by a newer build must stay readable by an older one, so nothing
 * validates this against a fixed list.
 */
export type ResearchProviderId = string;

/** What a candidate is, used to keep a shortlist from filling up with one kind of thing. */
export type ResearchCandidateKind =
  'article' | 'book' | 'course' | 'docs' | 'paper' | 'qa' | 'repo' | 'video';

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
  /**
   * What this capture actually obtained, when only the capture can know. A provider that may or
   * may not reach the real text (a video with or without captions) reports the truth here rather
   * than letting `capturedVia(candidate)` guess before the attempt.
   */
  capturedVia?: string;
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
  /**
   * Every origin this provider calls from the browser itself. The app's `connect-src` must
   * name each one or the search dies on the deployed build, so it is declared here where a
   * test can read it rather than left implicit in a fetch call. Empty when the companion
   * proxies the request, because that call goes to localhost.
   */
  readonly origins: readonly string[];
  /** Catalog policy enforced by the sequence; reference-only providers cannot create claims. */
  readonly capturePolicy?: 'readable-or-reference' | 'reference-only';
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
