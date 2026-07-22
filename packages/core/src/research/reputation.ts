export interface HostReputation {
  /** Roughly -0.2..+0.3, added as a small nudge to a candidate's rank score. */
  weight: number;
  /** Short human phrase for the reason list, or null when the host is unknown. */
  reason: string | null;
}

const NEUTRAL: HostReputation = { reason: null, weight: 0 };

/**
 * An editorial, reorder-only list of host suffixes. It never filters anything out: an
 * unlisted host is neutral, and the worst a listed host can do is drop a few places. Keep
 * it short, keep it alphabetical, and treat additions as an opinion rather than a fact.
 */
const HOSTS: Readonly<Record<string, HostReputation>> = {
  'arxiv.org': { reason: 'academic source', weight: 0.2 },
  'developer.mozilla.org': { reason: 'official documentation', weight: 0.3 },
  'docs.python.org': { reason: 'official documentation', weight: 0.3 },
  'geeksforgeeks.org': { reason: 'low-signal aggregator', weight: -0.15 },
  'github.com': { reason: 'primary source repository', weight: 0.15 },
  'learn.microsoft.com': { reason: 'official documentation', weight: 0.3 },
  'nodejs.org': { reason: 'official documentation', weight: 0.3 },
  'rfc-editor.org': { reason: 'primary standards source', weight: 0.3 },
  'tutorialspoint.com': { reason: 'low-signal aggregator', weight: -0.15 },
  'w3.org': { reason: 'primary standards source', weight: 0.3 },
  'w3schools.com': { reason: 'low-signal aggregator', weight: -0.15 },
};

const SUFFIXES: Readonly<Record<string, HostReputation>> = {
  '.edu': { reason: 'academic source', weight: 0.2 },
  '.gov': { reason: 'government source', weight: 0.2 },
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Editorial weight for a candidate's host. Unknown hosts and unparseable urls are neutral. */
export function reputationFor(url: string): HostReputation {
  const host = hostOf(url);
  if (!host) return NEUTRAL;
  for (const [suffix, reputation] of Object.entries(SUFFIXES)) {
    if (host.endsWith(suffix)) return reputation;
  }
  for (const [listed, reputation] of Object.entries(HOSTS)) {
    if (host === listed || host.endsWith(`.${listed}`)) return reputation;
  }
  return NEUTRAL;
}
