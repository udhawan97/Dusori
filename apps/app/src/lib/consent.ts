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

export type ConsentDecision = 'allowed' | 'denied' | 'undecided';
export interface StoredConsentDecision {
  decision: Exclude<ConsentDecision, 'undecided'>;
  scope: string;
}

export function readConsent(scope: string): ConsentDecision {
  try {
    const value = localStorage.getItem(consentKey(scope));
    return value === 'allowed' || value === 'denied' ? value : 'undecided';
  } catch {
    return 'undecided';
  }
}

export function hasConsent(scope: string): boolean {
  return readConsent(scope) === 'allowed';
}

export function hasDeniedConsent(scope: string): boolean {
  return readConsent(scope) === 'denied';
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

/** Explicit denial is distinct from closing the disclosure without choosing. */
export function denyConsent(scope: string): boolean {
  try {
    localStorage.setItem(consentKey(scope), 'denied');
    return true;
  } catch {
    return false;
  }
}

/** Returns a provider to undecided so its full disclosure appears next time. */
export function resetConsent(scope: string): boolean {
  try {
    localStorage.removeItem(consentKey(scope));
    return true;
  } catch {
    return false;
  }
}

export function listConsentDecisions(): StoredConsentDecision[] {
  try {
    const prefix = 'dusori-research-consent:v2:';
    const decisions: StoredConsentDecision[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const decision = localStorage.getItem(key);
      if (decision !== 'allowed' && decision !== 'denied') continue;
      decisions.push({ decision, scope: key.slice(prefix.length) });
    }
    return decisions.sort((left, right) => left.scope.localeCompare(right.scope));
  } catch {
    return [];
  }
}
