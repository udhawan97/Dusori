import { StorageConflictError, type StorageAdapter } from '../adapters.js';
import { readableSections } from '../learning/recall.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import {
  SourceManifestSchema,
  TopicStateSchema,
  schemaVersion,
  type SourceClaim,
  type SourceRecord,
} from '../schemas/workspace.js';
import { topicRoot } from '../workspace/paths.js';

/** How many excerpts one source contributes. The manifest schema caps this too. */
export const maxClaimsPerSource = 12;
const minClaimCharacters = 60;
const maxClaimCharacters = 600;

/**
 * Splits prose into sentences without a tokenizer. Abbreviations are left attached rather than
 * split wrongly: an over-long quote is honest, a mangled one is not.
 */
function sentences(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * A claim must carry information, not navigation. Sentences that are too short, or that read
 * as boilerplate Dusori itself wrote, never become claims.
 */
function isClaimWorthy(sentence: string): boolean {
  if (sentence.length < minClaimCharacters || sentence.length > maxClaimCharacters) return false;
  if (/^(?:see also|references|external links|further reading|contents)\b/iu.test(sentence)) {
    return false;
  }
  // Needs a verb-ish shape: a bare noun pile is a heading, not a statement.
  return /\s(?:is|are|was|were|has|have|had|can|could|may|might|will|would|does|do|did|uses|used|shows|showed|found|requires|allows|means|makes|made|provides|produces|becomes|remains|includes|reduces|increases|improves|supports|suggests|argues|reports)\s/iu.test(
    sentence,
  );
}

export interface ExtractClaimsInput {
  content: string;
  title: string;
  at: string;
  limit?: number;
}

/**
 * Verbatim excerpts from a source's own text, each tagged with the heading it sat under.
 * Nothing is paraphrased and no model is involved: a claim the workspace cannot quote back
 * is not a claim, it is an assertion.
 */
export function extractClaims(input: ExtractClaimsInput): SourceClaim[] {
  const limit = input.limit ?? maxClaimsPerSource;
  const claims: SourceClaim[] = [];
  const seen = new Set<string>();

  for (const section of readableSections(input.content, input.title)) {
    for (const sentence of sentences(section.body)) {
      if (claims.length >= limit) return claims;
      if (!isClaimWorthy(sentence)) continue;
      const key = sentence.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push({
        at: input.at,
        ...(section.heading === input.title ? {} : { heading: section.heading }),
        text: sentence,
      });
    }
  }
  return claims;
}

export interface ReadSourceResult {
  /** Records that gained claims in this pass. */
  read: { path: string; title: string; claims: number }[];
  /** Sources whose stored text held no quotable prose — a URL reference, or a stub. */
  unreadable: { title: string; reason: string }[];
}

/**
 * Reads every saved source's local text into claims and records the result on the manifest.
 * Idempotent: a source already read at the same content stays untouched, so a repeated deep
 * pass never churns the file or duplicates evidence.
 */
export async function readSourcesIntoClaims(
  storage: StorageAdapter,
  topicSlug: string,
  now = new Date(),
): Promise<ReadSourceResult> {
  const root = topicRoot(topicSlug);
  const manifestPath = `${root}/Sources/manifest.json`;
  await readMachineFile(storage, `${root}/state.json`, TopicStateSchema, now);
  const at = now.toISOString();
  const result: ReadSourceResult = { read: [], unreadable: [] };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const manifestFile = await storage.read(manifestPath);
    if (!manifestFile) throw new Error(`Missing source manifest: ${manifestPath}`);
    const manifest = await readMachineFile(storage, manifestPath, SourceManifestSchema, now);

    result.read = [];
    result.unreadable = [];
    const next: SourceRecord[] = [];
    let changed = false;

    for (const record of manifest.sources) {
      // A provider reference may contain ranking metadata or a search snippet, but it is not the
      // source's readable text. Never turn that metadata into evidence. Older workspaces that did
      // attach claims to a reference are repaired in place.
      if (record.readState === 'reference') {
        result.unreadable.push({
          reason:
            record.fetchMessage ?? 'Only a reference is stored. Open or read the original page.',
          title: record.title,
        });
        if ((record.claims?.length ?? 0) > 0) {
          const { claims: _claims, ...withoutClaims } = record;
          void _claims;
          next.push(withoutClaims);
          changed = true;
        } else next.push(record);
        continue;
      }
      if (!record.path) {
        next.push(record);
        continue;
      }
      const file = await storage.read(record.path);
      if (!file) {
        result.unreadable.push({
          reason: 'Its saved text is missing from this workspace.',
          title: record.title,
        });
        next.push(record);
        continue;
      }
      const claims = extractClaims({ at, content: file.content, title: record.title });
      const previousClaims = new Map((record.claims ?? []).map((claim) => [claim.text, claim]));
      const compatibleClaims = claims.map((claim) => ({
        ...previousClaims.get(claim.text),
        ...claim,
      }));
      if (claims.length === 0) {
        result.unreadable.push({
          reason:
            record.method === 'url'
              ? 'Only a reference is stored. Run the companion to fetch the page text.'
              : 'Its stored text holds no quotable prose.',
          title: record.title,
        });
        // A source with no quotable prose is readable-but-thin, not read.
        if (record.readState !== 'readable') {
          next.push({ ...record, readState: 'readable' });
          changed = true;
        } else next.push(record);
        continue;
      }
      result.read.push({ claims: claims.length, path: record.path, title: record.title });
      const unchanged =
        record.readState === 'read' &&
        record.claims?.length === compatibleClaims.length &&
        record.claims.every((claim, index) => claim.text === compatibleClaims[index]?.text);
      if (unchanged) {
        next.push(record);
        continue;
      }
      next.push({ ...record, claims: compatibleClaims, readState: 'read' });
      changed = true;
    }

    if (!changed) return result;

    const nextManifest = SourceManifestSchema.parse({
      ...manifest,
      schemaVersion,
      sources: next,
      synthesisStaleAt: now.toISOString(),
      synthesisStaleReason: 'Quoted passages changed after reading saved source text.',
    });
    try {
      await storage.write(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, {
        expectedHash: manifestFile.hash,
      });
      return result;
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
    }
  }

  throw new Error('The source manifest changed repeatedly. Try reading the sources again.');
}
