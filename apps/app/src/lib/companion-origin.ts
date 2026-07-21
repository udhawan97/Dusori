// `URL#hostname` keeps the brackets on an IPv6 literal (e.g. "[::1]"), so both
// forms are listed here rather than stripping brackets to match.
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The `?companion=` query parameter names where the per-launch bearer token
 * is sent and which host backs the upgrade preview's fetched content, so it
 * must not be trusted as an arbitrary URL. Accept it only when it resolves to
 * a loopback origin (localhost / 127.0.0.1 / ::1, any port, plain http) or is
 * exactly the page's own origin. Returns null -- never throws -- for anything
 * else, including a value that fails to parse as a URL.
 */
export function resolveCompanionOrigin(candidate: string, pageOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.origin === pageOrigin) return url.origin;
  if (url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname)) return url.origin;
  return null;
}
