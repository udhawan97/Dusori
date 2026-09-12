import { denyConsent, grantConsent } from './consent';

/** A refusal commits only denials; the positive continuation is unreachable from that action. */
export async function applyResearchConsent(
  action: 'allow' | 'deny',
  scopes: string[],
  selectedScopes: string[],
  onConfirm: () => Promise<void>,
): Promise<void> {
  let stored = true;
  for (const scope of new Set(scopes)) {
    const allowed = action === 'allow' && selectedScopes.includes(scope);
    stored = (allowed ? grantConsent(scope) : denyConsent(scope)) && stored;
  }
  if (!stored)
    throw new Error(
      'This device could not remember the provider choices. Check browser storage and try again.',
    );
  if (action === 'allow') await onConfirm();
}
