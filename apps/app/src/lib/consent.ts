/**
 * Per-device egress consent, stored on the device that granted it.
 *
 * Keyed by scope rather than by feature: a variant that widens what leaves the device must
 * declare its own scope so consent given for a narrower disclosure is asked again instead of
 * being silently reused. v2 marks the wording change that made every disclosure name its host
 * and its payload.
 */
export function consentKey(scope: string): string {
  return `dusori-research-consent:v2:${scope}`;
}

export function hasConsent(scope: string): boolean {
  try {
    return localStorage.getItem(consentKey(scope)) === 'allowed';
  } catch {
    return false;
  }
}

/** Returns false when the device refuses to remember the choice, so the caller can say so. */
export function grantConsent(scope: string): boolean {
  try {
    localStorage.setItem(consentKey(scope), 'allowed');
    return true;
  } catch {
    return false;
  }
}
