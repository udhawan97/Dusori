import type { SourceRecord } from '../schemas/workspace.js';

/**
 * The single evidence boundary for every research surface. A saved reference may retain legacy
 * claim-shaped data, but it cannot support a claim until its text was actually read.
 */
export function evidenceClaims(record: SourceRecord): NonNullable<SourceRecord['claims']> {
  return record.readState === 'read' ? (record.claims ?? []) : [];
}
