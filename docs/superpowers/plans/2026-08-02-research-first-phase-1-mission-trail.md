# Research-First Phase 1: Mission Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every research run (including failures) as a durable, inspectable mission trail; keep ranking rationale and bibliographic provenance on saved sources; surface mission state on Today; fix the ~1200 px lane-overlap bug.

**Architecture:** Additive-optional fields on `research.json` (`runs[]`) and `SourceRecord` (`publishedAt`/`publisher`/`author`/`whySelected`) written through the existing hash-guarded machine-file idiom. Mission status is derived from evidence at read time (`deriveMissionOverview`), never stored. New UI is two focused components (`ResearchTrail`, `MissionStrip`) plugged into existing surfaces.

**Tech Stack:** TypeScript, zod, Svelte 5, SvelteKit static SPA, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-02-research-first-missions-design.md` (Phase 1 scope only; `readState`/`claims`/angles/auto-refresh land in later phases).

## Global Constraints

- `schemaVersion` stays `1` everywhere; every new field is optional (spec §2). A mismatch quarantines files (`read-machine-file.ts:18-20`) — never bump.
- Machine-file writes: re-read, zod-parse, write with `expectedHash`, retry ≤3 on `StorageConflictError` (idiom: `research-file.ts:88-115`).
- Bounded arrays: `runs[]` capped at 50, oldest dropped (mirrors `seen[]` cap 500).
- A provider failure is never presented or stored as "no research found" (spec §8).
- All copy follows CONTEXT.md vocabulary; no "task/alert/dashboard" language.
- Run all commands from the repo root. Unit: `pnpm exec vitest run <file>`. E2E needs a fresh build first: `pnpm build` then `pnpm exec playwright test -g "<name>"`.
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Run-ledger schema and `recordResearchRun` rework

**Files:**
- Modify: `packages/core/src/research/research-file.ts`
- Create: `packages/core/src/research/research-file.test.ts`
- Modify: `packages/core/src/research/suggest.test.ts` (one call site, line ~8 import is unchanged; the `recordResearchRun` calls inside change shape)

**Interfaces:**
- Consumes: existing `ResearchFileSchema`, `readMachineFile`, `topicRoot`, `MemoryStorageAdapter`, `createWorkspace(storage, name, now)`, `createTopic(storage, title, now)`.
- Produces (later tasks rely on these exact names):

```ts
export const RunProviderOutcomeSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  outcome: z.enum(['empty', 'failed', 'found']),
  count: z.number().int().nonnegative(),
  message: z.string().min(1).max(300).optional(),
});
export const ResearchRunRecordSchema = z.object({
  at: z.string().datetime(),
  searchText: z.string().min(1).max(400),
  angleId: z.string().min(1).max(40).optional(),
  providers: z.array(RunProviderOutcomeSchema).max(24),
  newKeys: z.number().int().nonnegative(),
});
export type RunProviderOutcome = z.infer<typeof RunProviderOutcomeSchema>;
export type ResearchRunRecord = z.infer<typeof ResearchRunRecordSchema>;

export interface ResearchRunInput {
  searchText: string;
  angleId?: string;
  providers: RunProviderOutcome[];
  /** Ranked candidates that survived dedupe; may be empty on a failed or empty run. */
  candidates: { key: string; url?: string }[];
}
// New signature (breaking for the old positional candidates array):
export async function recordResearchRun(
  storage: StorageAdapter, topicSlug: string, run: ResearchRunInput, now?: Date,
): Promise<ResearchFile>;
```

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/research/research-file.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import {
  readResearchFile,
  recordResearchRun,
  type ResearchRunInput,
} from './research-file.js';

const now = new Date('2026-08-02T10:00:00.000Z');

async function topicStorage(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, 'Spaced repetition learning', now);
  return storage;
}

function run(overrides: Partial<ResearchRunInput> = {}): ResearchRunInput {
  return {
    candidates: [{ key: 'wikipedia:1', url: 'https://en.wikipedia.org/wiki/Spaced_repetition' }],
    providers: [{ count: 1, id: 'wikipedia', label: 'Wikipedia', outcome: 'found' }],
    searchText: 'Spaced repetition learning',
    ...overrides,
  };
}

describe('research run ledger', () => {
  it('persists a run with per-provider outcomes and counts new keys', async () => {
    const storage = await topicStorage();

    await recordResearchRun(storage, 'spaced-repetition-learning', run(), now);

    const file = await readResearchFile(storage, 'spaced-repetition-learning', now);
    expect(file?.lastRunAt).toBe(now.toISOString());
    expect(file?.runs).toHaveLength(1);
    expect(file?.runs?.[0]).toMatchObject({
      at: now.toISOString(),
      newKeys: 1,
      providers: [{ count: 1, id: 'wikipedia', label: 'Wikipedia', outcome: 'found' }],
      searchText: 'Spaced repetition learning',
    });
  });

  it('records a run in which every provider failed, with zero candidates', async () => {
    const storage = await topicStorage();

    await recordResearchRun(
      storage,
      'spaced-repetition-learning',
      run({
        candidates: [],
        providers: [
          {
            count: 0,
            id: 'wikipedia',
            label: 'Wikipedia',
            message: 'Wikipedia took too long to answer and was skipped.',
            outcome: 'failed',
          },
        ],
      }),
      now,
    );

    const file = await readResearchFile(storage, 'spaced-repetition-learning', now);
    expect(file?.runs?.[0]?.providers[0]).toMatchObject({
      message: 'Wikipedia took too long to answer and was skipped.',
      outcome: 'failed',
    });
    expect(file?.runs?.[0]?.newKeys).toBe(0);
    expect(file?.seen ?? []).toHaveLength(0);
  });

  it('counts only genuinely new keys and keeps first-seen timestamps', async () => {
    const storage = await topicStorage();

    await recordResearchRun(storage, 'spaced-repetition-learning', run(), now);
    const later = new Date('2026-08-02T11:00:00.000Z');
    await recordResearchRun(
      storage,
      'spaced-repetition-learning',
      run({ candidates: [{ key: 'wikipedia:1' }, { key: 'wikipedia:2' }] }),
      later,
    );

    const file = await readResearchFile(storage, 'spaced-repetition-learning', later);
    expect(file?.runs?.[1]?.newKeys).toBe(1);
    const first = file?.seen?.find((entry) => entry.key === 'wikipedia:1');
    expect(first?.at).toBe(now.toISOString());
  });

  it('drops the oldest run beyond fifty', async () => {
    const storage = await topicStorage();

    for (let index = 0; index < 51; index += 1) {
      await recordResearchRun(
        storage,
        'spaced-repetition-learning',
        run({ candidates: [], searchText: `query ${index}`, providers: [] }),
        new Date(now.getTime() + index * 60_000),
      );
    }

    const file = await readResearchFile(storage, 'spaced-repetition-learning', now);
    expect(file?.runs).toHaveLength(50);
    expect(file?.runs?.[0]?.searchText).toBe('query 1');
    expect(file?.runs?.at(-1)?.searchText).toBe('query 50');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/core/src/research/research-file.test.ts`
Expected: FAIL — `recordResearchRun` rejects the object argument (type error at runtime: `run.candidates` shape) / `runs` undefined.

- [ ] **Step 3: Implement the schema and writer**

In `packages/core/src/research/research-file.ts`:

1. After `SeenResearchCandidateSchema`, add `RunProviderOutcomeSchema`, `ResearchRunRecordSchema`, and the two inferred types exactly as in **Interfaces** above.
2. Extend `ResearchFileSchema` with `runs: z.array(ResearchRunRecordSchema).optional(),` beside `seen` (same "optional so older files parse unchanged" comment style).
3. Add `const maxRunEntries = 50;` beside `maxSeenEntries`.
4. Replace the whole `recordResearchRun` body with the object-input version. Keep the 3-attempt hash-guard loop identical; inside the loop compute:

```ts
export interface ResearchRunInput {
  searchText: string;
  angleId?: string;
  providers: RunProviderOutcome[];
  candidates: { key: string; url?: string }[];
}

export async function recordResearchRun(
  storage: StorageAdapter,
  topicSlug: string,
  run: ResearchRunInput,
  now = new Date(),
): Promise<ResearchFile> {
  const normalizedSlug = topicRoot(topicSlug).slice('Topics/'.length);
  const path = researchFilePath(topicSlug);
  await readMachineFile(storage, `${topicRoot(topicSlug)}/state.json`, TopicStateSchema, now);
  const at = now.toISOString();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentSnapshot = await storage.read(path);
    const current = currentSnapshot
      ? await readMachineFile(storage, path, ResearchFileSchema, now)
      : ResearchFileSchema.parse({ dismissed: [], schemaVersion, topicSlug: normalizedSlug });
    // An already-seen key keeps its original `at`: re-stamping it every run
    // would make nothing ever count as new again.
    const merged = new Map((current.seen ?? []).map((entry) => [entry.key, entry]));
    let newKeys = 0;
    for (const candidate of run.candidates) {
      if (merged.has(candidate.key)) continue;
      newKeys += 1;
      merged.set(candidate.key, { at, key: candidate.key, url: candidate.url });
    }
    const record = ResearchRunRecordSchema.parse({
      angleId: run.angleId,
      at,
      newKeys,
      providers: run.providers,
      searchText: run.searchText,
    });
    const next = ResearchFileSchema.parse({
      ...current,
      lastRunAt: at,
      runs: [...(current.runs ?? []), record].slice(-maxRunEntries),
      seen: [...merged.values()]
        .sort((left, right) => left.at.localeCompare(right.at))
        .slice(-maxSeenEntries),
    });
    try {
      await storage.write(path, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: currentSnapshot?.hash ?? null,
      });
      return next;
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
    }
  }

  throw new Error('Research run history changed repeatedly. Try running research again.');
}
```

5. Fix the compile break in `packages/core/src/research/agent.ts` minimally for now (Task 2 does the real work): change the call at the bottom to

```ts
  if (ranked.length > 0) {
    await recordResearchRun(
      input.storage,
      input.topicSlug,
      {
        candidates: ranked.map((candidate) => ({ key: candidate.key, url: candidate.url })),
        providers: [],
        searchText: input.query.searchText,
      },
      now,
    );
  }
```

6. Update the `recordResearchRun` calls in `packages/core/src/research/suggest.test.ts` to the object shape (`{ candidates: [...], providers: [], searchText: 'query' }`). Do not change what those tests assert.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/core/src/research/research-file.test.ts packages/core/src/research/suggest.test.ts packages/core/src/research/agent.test.ts`
Expected: PASS (agent tests unaffected: they assert shortlist/skips, not the record call shape).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/research/research-file.ts packages/core/src/research/research-file.test.ts packages/core/src/research/suggest.test.ts packages/core/src/research/agent.ts
git commit -m "feat(core): persist research runs with per-provider outcomes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Agent records outcomes for every run, including total failure

**Files:**
- Modify: `packages/core/src/research/agent.ts`
- Modify: `packages/core/src/research/agent.test.ts`

**Interfaces:**
- Consumes: `recordResearchRun(storage, topicSlug, ResearchRunInput, now)`, `RunProviderOutcome`, `ResearchRunRecord` from Task 1.
- Produces: `ResearchRunResult` gains `run: ResearchRunRecord | null` (the persisted record for this scan; `null` only when persistence itself failed). `SkippedProvider` stays for UI compatibility.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/research/agent.test.ts` (reuse that file's existing provider/storage helpers — it already builds fake providers that resolve or reject):

```ts
it('persists per-provider outcomes for a mixed run', async () => {
  // Arrange with the file's existing helpers: one provider returning two
  // candidates, one returning none, one rejecting with new Error('boom').
  const result = await runResearchAgent({ providers, query, storage, topicSlug });

  expect(result.run?.providers).toEqual([
    expect.objectContaining({ count: 2, outcome: 'found' }),
    expect.objectContaining({ count: 0, outcome: 'empty' }),
    expect.objectContaining({ count: 0, message: 'boom', outcome: 'failed' }),
  ]);
  const file = await readResearchFile(storage, topicSlug);
  expect(file?.runs).toHaveLength(1);
});

it('persists a run even when every provider fails', async () => {
  // Providers: two, both rejecting.
  const result = await runResearchAgent({ providers, query, storage, topicSlug });

  expect(result.shortlist).toHaveLength(0);
  expect(result.run?.providers.every((provider) => provider.outcome === 'failed')).toBe(true);
  const file = await readResearchFile(storage, topicSlug);
  expect(file?.runs).toHaveLength(1);
  expect(file?.lastRunAt).toBeDefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/core/src/research/agent.test.ts`
Expected: FAIL — `result.run` is `undefined`; `runs` empty on all-failed.

- [ ] **Step 3: Implement**

In `agent.ts`:

1. Import `recordResearchRun, type ResearchRunRecord, type RunProviderOutcome` and add `run: ResearchRunRecord | null;` to `ResearchRunResult`.
2. While walking `settled` (existing forEach), also build outcomes:

```ts
  const outcomes: RunProviderOutcome[] = [];
  settled.forEach((result, index) => {
    const provider = input.providers[index];
    if (!provider) return;
    if (result.status === 'fulfilled') {
      found.push(...result.value);
      outcomes.push({
        count: result.value.length,
        id: provider.id,
        label: provider.label,
        outcome: result.value.length > 0 ? 'found' : 'empty',
      });
      return;
    }
    const message = skipMessage(result.reason, provider.label);
    skipped.push({ id: provider.id, label: provider.label, message });
    outcomes.push({
      count: 0,
      id: provider.id,
      label: provider.label,
      message,
      outcome: 'failed',
    });
  });
```

3. Replace the guarded record call with an always-record (a run that asked zero providers never reaches here — `runWith` guards `providerList.length === 0`):

```ts
  // The run itself is evidence: a failure trail must survive reload exactly like a
  // success, or "no research found" and "research broke" become indistinguishable.
  let run: ResearchRunRecord | null = null;
  try {
    const file = await recordResearchRun(
      input.storage,
      input.topicSlug,
      {
        candidates: ranked.map((candidate) => ({ key: candidate.key, url: candidate.url })),
        providers: outcomes,
        searchText: input.query.searchText,
      },
      now,
    );
    run = file.runs?.at(-1) ?? null;
  } catch {
    run = null;
  }

  return { overflow, run, shortlist, skipped };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/core/src/research/agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/research/agent.ts packages/core/src/research/agent.test.ts
git commit -m "feat(core): research agent records every run outcome durably

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Source provenance fields survive acceptance

**Files:**
- Modify: `packages/core/src/schemas/workspace.ts:43-54` (`SourceRecordSchema`)
- Modify: `packages/core/src/sources/import.ts` (`AddSourceInput` url variant, `addSource` record build)
- Modify: `packages/core/src/sources/import.test.ts`

**Interfaces:**
- Produces on `SourceRecordSchema` (tolerant strings like `origin`, spec §2):

```ts
publishedAt: z.string().min(4).max(40).optional(),   // provider-reported; may be date-only
publisher: z.string().min(1).max(160).optional(),
author: z.string().min(1).max(160).optional(),
whySelected: z.array(z.string().min(1).max(160)).max(8).optional(),
```

- `AddSourceInput` url variant gains `provenance?: { author?: string; publishedAt?: string; publisher?: string; whySelected?: string[] }`.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/sources/import.test.ts` (reuse its existing workspace/topic setup helper):

```ts
it('keeps research provenance on an accepted url source', async () => {
  const storage = await topicStorage(); // the file's existing seed helper

  const added = await addSource(storage, {
    content: '# Spaced repetition\n\nExtract.',
    method: 'url',
    origin: { capturedAt: now.toISOString(), capturedVia: 'api-extract', provider: 'wikipedia' },
    provenance: {
      author: 'Wikipedia contributors',
      publishedAt: '2026-05-01',
      publisher: 'Wikipedia',
      whySelected: ['matches 3 objective terms', 'published 2026'],
    },
    title: 'Spaced repetition',
    topicSlug: 'azure-administration',
    url: 'https://en.wikipedia.org/wiki/Spaced_repetition',
  });

  expect(added.record).toMatchObject({
    author: 'Wikipedia contributors',
    publishedAt: '2026-05-01',
    publisher: 'Wikipedia',
    whySelected: ['matches 3 objective terms', 'published 2026'],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/sources/import.test.ts`
Expected: FAIL — unknown `provenance` key is a TS error / record lacks the fields (zod strips unknown keys).

- [ ] **Step 3: Implement**

1. Add the four optional fields to `SourceRecordSchema` (after `origin`), with a one-line comment: `// Research provenance. Tolerant strings for the same reason as origin above.`
2. Add `provenance?: {...}` to the url variant of `AddSourceInput`.
3. In `addSource`'s `SourceRecordSchema.parse({...})` (line ~167), spread the fields:

```ts
      author: input.method === 'url' ? input.provenance?.author : undefined,
      publishedAt: input.method === 'url' ? input.provenance?.publishedAt : undefined,
      publisher: input.method === 'url' ? input.provenance?.publisher : undefined,
      whySelected: input.method === 'url' ? input.provenance?.whySelected : undefined,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/core/src/sources/import.test.ts packages/core/src/portable.test.ts`
Expected: PASS (portable import validation must still accept manifests without the new fields; it parses with the same schema, so no change is needed — the run proves it).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas/workspace.ts packages/core/src/sources/import.ts packages/core/src/sources/import.test.ts
git commit -m "feat(core): keep ranking rationale and bibliography on saved sources

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Mission overview derivation and lens map

**Files:**
- Create: `packages/core/src/research/mission.ts`
- Create: `packages/core/src/research/mission.test.ts`
- Modify: `packages/core/src/research/index.ts` (re-export), `packages/core/src/index.ts` if that is where the public barrel lives (check how `readResearchFile` is exported and mirror it)

**Interfaces:**
- Consumes: `readResearchFile`, `readSourceManifest`, `createResearchProviders` (for the totality test), Task 1's `ResearchRunRecord`.
- Produces:

```ts
export type MissionLens = 'academic' | 'community' | 'docs' | 'video' | 'web';
export function lensFor(providerId: string): MissionLens;
export interface MissionOverview {
  topicSlug: string;
  savedSources: number;
  discovered: number;                       // seen[].length (bounded history)
  lastRunAt: string | null;
  lastRun: ResearchRunRecord | null;
  lensCounts: Record<MissionLens, number>;  // saved sources per lens via origin.provider
}
export async function deriveMissionOverview(
  storage: StorageAdapter, topicSlug: string, now?: Date,
): Promise<MissionOverview>;
```

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/research/mission.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { addSource } from '../sources/import.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { deriveMissionOverview, lensFor } from './mission.js';
import { createResearchProviders } from './providers/index.js';
import { recordResearchRun } from './research-file.js';

const now = new Date('2026-08-02T10:00:00.000Z');

async function topicStorage(): Promise<MemoryStorageAdapter> {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, 'Spaced repetition learning', now);
  return storage;
}

describe('mission overview', () => {
  it('assigns every registered provider to a lens', () => {
    for (const provider of createResearchProviders({ companion: null })) {
      expect(['academic', 'community', 'docs', 'video', 'web']).toContain(lensFor(provider.id));
    }
    expect(lensFor('somebody-new')).toBe('web');
  });

  it('derives zeroed state for a topic that never ran research', async () => {
    const storage = await topicStorage();

    const overview = await deriveMissionOverview(storage, 'spaced-repetition-learning', now);

    expect(overview).toEqual({
      discovered: 0,
      lastRun: null,
      lastRunAt: null,
      lensCounts: { academic: 0, community: 0, docs: 0, video: 0, web: 0 },
      savedSources: 0,
      topicSlug: 'spaced-repetition-learning',
    });
  });

  it('counts saved sources per lens and reports the last run', async () => {
    const storage = await topicStorage();
    await addSource(storage, {
      content: '# Extract',
      method: 'url',
      origin: { capturedAt: now.toISOString(), capturedVia: 'api-extract', provider: 'wikipedia' },
      title: 'Spaced repetition',
      topicSlug: 'spaced-repetition-learning',
      url: 'https://en.wikipedia.org/wiki/Spaced_repetition',
    });
    await recordResearchRun(
      storage,
      'spaced-repetition-learning',
      {
        candidates: [{ key: 'wikipedia:1' }],
        providers: [{ count: 1, id: 'wikipedia', label: 'Wikipedia', outcome: 'found' }],
        searchText: 'Spaced repetition learning',
      },
      now,
    );

    const overview = await deriveMissionOverview(storage, 'spaced-repetition-learning', now);

    expect(overview.savedSources).toBe(1);
    expect(overview.discovered).toBe(1);
    expect(overview.lensCounts.docs).toBe(1);
    expect(overview.lastRunAt).toBe(now.toISOString());
    expect(overview.lastRun?.providers[0]?.outcome).toBe('found');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/core/src/research/mission.test.ts`
Expected: FAIL — module `./mission.js` does not exist.

- [ ] **Step 3: Implement `mission.ts`**

```ts
import type { StorageAdapter } from '../adapters.js';
import { readSourceManifest } from '../sources/import.js';
import { readResearchFile, type ResearchRunRecord } from './research-file.js';

export type MissionLens = 'academic' | 'community' | 'docs' | 'video' | 'web';

// Spec §5: fixed map over provider ids. An unknown provider lands in `web`
// rather than vanishing, because a lens must never hide a saved source.
const lensByProvider: Record<string, MissionLens> = {
  arxiv: 'academic',
  github: 'docs',
  hackernews: 'community',
  mslearn: 'docs',
  npm: 'docs',
  openalex: 'academic',
  reddit: 'community',
  stackexchange: 'community',
  websearch: 'web',
  wikipedia: 'docs',
  youtube: 'video',
};

export function lensFor(providerId: string): MissionLens {
  return lensByProvider[providerId] ?? 'web';
}

export interface MissionOverview {
  topicSlug: string;
  savedSources: number;
  discovered: number;
  lastRunAt: string | null;
  lastRun: ResearchRunRecord | null;
  lensCounts: Record<MissionLens, number>;
}

/**
 * Mission status is always derived from current evidence, never stored, so it
 * can go stale or lie only if the files themselves do.
 */
export async function deriveMissionOverview(
  storage: StorageAdapter,
  topicSlug: string,
  now = new Date(),
): Promise<MissionOverview> {
  const lensCounts: Record<MissionLens, number> = {
    academic: 0,
    community: 0,
    docs: 0,
    video: 0,
    web: 0,
  };
  let savedSources = 0;
  try {
    const manifest = await readSourceManifest(storage, topicSlug, now);
    savedSources = manifest.sources.length;
    for (const source of manifest.sources) {
      if (source.origin) lensCounts[lensFor(source.origin.provider)] += 1;
    }
  } catch {
    // A missing or invalid manifest is already a Needs attention condition;
    // the mission strip reports zero rather than failing Today.
  }
  const research = await readResearchFile(storage, topicSlug, now).catch(() => null);
  return {
    discovered: research?.seen?.length ?? 0,
    lastRun: research?.runs?.at(-1) ?? null,
    lastRunAt: research?.lastRunAt ?? null,
    lensCounts,
    savedSources,
    topicSlug,
  };
}
```

Then re-export from the same barrel that exports `readResearchFile` (check `packages/core/src/research/index.ts` and the root `packages/core/src/index.ts`; mirror exactly how `research-file.js` symbols are exposed): `lensFor`, `deriveMissionOverview`, `type MissionLens`, `type MissionOverview`, and Task 1's `type ResearchRunRecord`, `type RunProviderOutcome`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/core/src/research/mission.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/research/mission.ts packages/core/src/research/mission.test.ts packages/core/src/research/index.ts packages/core/src/index.ts
git commit -m "feat(core): derive mission overview with lens coverage

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Research trail UI and provenance pass-through in the panel

**Files:**
- Create: `apps/app/src/lib/components/ResearchTrail.svelte`
- Modify: `apps/app/src/lib/components/ResearchPanel.svelte` (imports ~line 5-28; state ~line 79; `runWith` ~line 186-213; `addPreviewToSources` ~line 336-348; template after the skipped-list block ~line 550)

**Interfaces:**
- Consumes: `readResearchFile`, `type ResearchRunRecord` from `@dusori/core`; `runResult.run` from Task 2; `provenance` input from Task 3.
- Produces: `ResearchTrail` props: `{ runs: ResearchRunRecord[] }` (already newest-first).

- [ ] **Step 1: Create `ResearchTrail.svelte`**

```svelte
<script lang="ts">
  import type { ResearchRunRecord } from '@dusori/core';

  export let runs: ResearchRunRecord[] = [];

  let showAll = false;
  $: visible = showAll ? runs : runs.slice(0, 5);

  function dayOf(iso: string): string {
    return iso.slice(0, 10);
  }
  function timeOf(iso: string): string {
    return iso.slice(11, 16);
  }
  function outcomeLabel(outcome: 'empty' | 'failed' | 'found', count: number): string {
    if (outcome === 'found') return `found ${count}`;
    if (outcome === 'empty') return 'nothing matched';
    return 'failed';
  }
</script>

{#if runs.length > 0}
  <section class="research-trail" aria-labelledby="research-trail-title">
    <h3 id="research-trail-title">Research trail</h3>
    <p class="trail-explainer">
      Every scan this topic has run, kept in the workspace. A failed provider is reported as a
      failure, never as an empty result.
    </p>
    <ol class="trail-list" aria-label="Research trail runs">
      {#each visible as run (run.at)}
        <li>
          <p class="trail-when">
            <time datetime={run.at}>{dayOf(run.at)} · {timeOf(run.at)}</time>
            <span class="trail-query">“{run.searchText}”</span>
            {#if run.newKeys > 0}<span class="trail-new">{run.newKeys} new</span>{/if}
          </p>
          <ul class="trail-providers">
            {#each run.providers as outcome (outcome.id)}
              <li data-outcome={outcome.outcome}>
                <strong>{outcome.label}</strong>
                {outcomeLabel(outcome.outcome, outcome.count)}{#if outcome.message}
                  · {outcome.message}{/if}
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ol>
    {#if runs.length > 5}
      <button class="trail-toggle" onclick={() => (showAll = !showAll)}>
        {showAll ? 'Show recent runs only' : `Show all ${runs.length} runs`}
      </button>
    {/if}
  </section>
{/if}

<style>
  .research-trail {
    margin-block-start: var(--space-lg);
    padding-block-start: var(--space-md);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }
  .research-trail h3 {
    font-family: var(--font-display);
    font-size: var(--text-md);
  }
  .trail-explainer {
    margin-block: var(--space-2xs) var(--space-sm);
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }
  .trail-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .trail-list > li {
    padding-block: var(--space-sm);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }
  .trail-when {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    align-items: baseline;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-muted);
  }
  .trail-query {
    color: var(--color-ink);
  }
  .trail-new {
    color: var(--color-accent-text);
  }
  .trail-providers {
    margin: var(--space-2xs) 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }
  .trail-providers li {
    padding-block: var(--space-3xs, 0.125rem);
  }
  .trail-providers li[data-outcome='failed'] {
    color: var(--color-accent-text);
  }
  .trail-toggle {
    min-height: 2.75rem;
    margin-block-start: var(--space-xs);
    padding-inline: var(--space-sm);
    background: var(--color-paper);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
</style>
```

Check `var(--space-3xs)` exists in `tokens.css`; if not, use `0.125rem` directly.

- [ ] **Step 2: Wire the panel**

In `ResearchPanel.svelte`:

1. Imports: add `readResearchFile, type ResearchRunRecord` to the `@dusori/core` import; add `import ResearchTrail from './ResearchTrail.svelte';`.
2. State (near `let runResult` ~line 79): `let trailRuns: ResearchRunRecord[] = [];`
3. In `loadObjectives()` (or a new `onMount` body beside it), load the persisted trail:

```ts
    try {
      const file = await readResearchFile(storage, topicSlug);
      trailRuns = [...(file?.runs ?? [])].reverse();
    } catch {
      trailRuns = [];
    }
```

4. In `runWith`, after `runResult = await withAiRanking(query, result);` add:

```ts
      if (result.run) trailRuns = [result.run, ...trailRuns];
```

5. In `addPreviewToSources`, extend the `addSource` call (Task 3 input):

```ts
        provenance: {
          author:
            candidate.meta['author'] ?? candidate.meta['channel'] ?? candidate.meta['byline'],
          publishedAt: candidate.publishedAt,
          publisher: provider.label,
          whySelected: candidate.reasons,
        },
```

   (`candidate` is in scope from the destructure at the top of the function; `meta` values are `string | undefined` — the record schema strips `undefined` cleanly.)
6. Template: render `<ResearchTrail runs={trailRuns} />` immediately after the `{#if runResult?.skipped.length}` block (~line 550), still inside the `{:else}` objectives branch.

- [ ] **Step 3: Typecheck and unit-test the app**

Run: `pnpm --filter @dusori/app typecheck && pnpm exec vitest run apps/app`
Expected: PASS (no app unit test targets the panel; this guards compile and the token test).

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/lib/components/ResearchTrail.svelte apps/app/src/lib/components/ResearchPanel.svelte
git commit -m "feat(app): show the durable research trail in the panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Mission strip on Today

**Files:**
- Create: `apps/app/src/lib/components/MissionStrip.svelte`
- Modify: `apps/app/src/lib/components/LearningLoop.svelte` (imports ~line 13-37; load path where `summaries`/`focus` are read; template immediately before `<div class="today-lanes">` ~line 354)

**Interfaces:**
- Consumes: `deriveMissionOverview`, `type MissionOverview`, `lensFor` types from Task 4; `TodayTopicSummary` (existing).
- Produces: `MissionStrip` props: `{ missions: Array<MissionOverview & { title: string }>; onOpenResearch: (slug: string) => void }`.

- [ ] **Step 1: Create `MissionStrip.svelte`**

```svelte
<script lang="ts">
  import { Search } from '@lucide/svelte';

  import type { MissionOverview } from '@dusori/core';

  export let missions: Array<MissionOverview & { title: string }> = [];
  export let onOpenResearch: (slug: string) => void = () => undefined;

  const lensLabels = {
    academic: 'Academic',
    community: 'Community',
    docs: 'Docs',
    video: 'Video',
    web: 'Web',
  } as const;
  const lensOrder = ['docs', 'academic', 'community', 'video', 'web'] as const;

  function freshness(mission: MissionOverview): string {
    if (!mission.lastRunAt) return 'Never scanned';
    return `Refreshed ${mission.lastRunAt.slice(0, 10)}`;
  }

  function lastRunSummary(mission: MissionOverview): string {
    const failed = mission.lastRun?.providers.filter((p) => p.outcome === 'failed') ?? [];
    if (failed.length === 0) return '';
    return `${failed.map((p) => p.label).join(', ')} failed on the last scan`;
  }
</script>

{#if missions.length > 0}
  <section class="mission-strip" aria-labelledby="missions-title">
    <p class="section-label">Derived from research and source files</p>
    <h2 id="missions-title">Research missions</h2>
    <ol class="mission-list" aria-label="Research missions">
      {#each missions as mission (mission.topicSlug)}
        <li>
          <div class="mission-copy">
            <strong>{mission.title}</strong>
            <p>
              {mission.discovered} discovered · {mission.savedSources}
              {mission.savedSources === 1 ? 'source' : 'sources'} saved
            </p>
            <small>{freshness(mission)}</small>
            {#if lastRunSummary(mission)}
              <small class="mission-warn" role="status">{lastRunSummary(mission)}</small>
            {/if}
            <ul class="lens-dots" aria-label={`Coverage for ${mission.title}`}>
              {#each lensOrder as lens (lens)}
                <li
                  class:filled={mission.lensCounts[lens] > 0}
                  aria-label={`${lensLabels[lens]}: ${mission.lensCounts[lens]} saved`}
                  title={`${lensLabels[lens]}: ${mission.lensCounts[lens]} saved`}
                ></li>
              {/each}
            </ul>
          </div>
          <button
            class="lane-action"
            aria-label={`Open research — ${mission.title}`}
            onclick={() => onOpenResearch(mission.topicSlug)}
          >
            <Search aria-hidden="true" size={16} />
            Open research
          </button>
        </li>
      {/each}
    </ol>
  </section>
{/if}

<style>
  .mission-strip {
    margin-block-start: var(--space-xl);
    padding: var(--space-lg);
    border-block: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
  }
  .mission-strip h2 {
    font-family: var(--font-display);
    font-size: var(--text-lg);
  }
  .mission-list {
    margin: var(--space-md) 0 0;
    padding: 0;
    list-style: none;
  }
  .mission-list > li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-sm);
    align-items: start;
    padding-block: var(--space-sm);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }
  .mission-copy strong {
    display: block;
    font-family: var(--font-display);
  }
  .mission-copy p {
    margin-block: var(--space-2xs);
    font-size: var(--text-sm);
  }
  .mission-copy small {
    display: block;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .mission-warn {
    color: var(--color-accent-text);
  }
  .lens-dots {
    display: flex;
    gap: var(--space-xs);
    margin: var(--space-xs) 0 0;
    padding: 0;
    list-style: none;
  }
  .lens-dots li {
    width: 0.6rem;
    height: 0.6rem;
    border: var(--rule-hair) solid var(--color-muted);
    border-radius: 50%;
  }
  .lens-dots li.filled {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .lane-action {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    gap: var(--space-xs);
    padding-inline: var(--space-sm);
    background: var(--color-paper);
    color: var(--color-accent-text);
    font-family: var(--font-mono);
  }
  @container (max-width: 40rem) {
    .mission-list > li {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
```

- [ ] **Step 2: Wire `LearningLoop.svelte`**

1. Import `deriveMissionOverview, type MissionOverview` in the `@dusori/core` block and `import MissionStrip from './MissionStrip.svelte';`.
2. State: `let missions: Array<MissionOverview & { title: string }> = [];`
3. In the existing load function (the one that fills `summaries` and `focus` — find it by `summaries =`), after summaries resolve add:

```ts
    const activeSummaries = summaries.filter((summary) => summary.status !== 'complete');
    missions = await Promise.all(
      activeSummaries.map(async (summary) => ({
        ...(await deriveMissionOverview(storage, summary.slug)),
        title: summary.title,
      })),
    );
```

4. Template, `view === 'today'` branch, directly before `<div class="today-lanes">`:

```svelte
      <MissionStrip
        {missions}
        onOpenResearch={(slug) => onOpenResearch(slug)}
      />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @dusori/app typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/lib/components/MissionStrip.svelte apps/app/src/lib/components/LearningLoop.svelte
git commit -m "feat(app): open Today with derived research missions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Lanes stack by container width, not viewport width

**Files:**
- Modify: `apps/app/src/lib/components/LearningLoop.svelte` (`.today-lanes` rules ~line 769-778 and the `@media (max-width: 50rem)` block ~line 1308-1317; the component's outermost `view === 'today'` wrapper element)

The bug: `.today-lanes` stacks via a *viewport* media query, but the inspector drawer overlays ~350 px of the main column at ≥1200 px viewports, so the lanes render two-up in ~600 px and the Continue-learning actions overlap the copy (verified in the rendered app, 2026-08-02).

- [ ] **Step 1: Make the loop's Today wrapper a size container**

Find the outermost element the Today branch renders into (the element whose class the `.today-lanes` selector nests under — likely a `<section>` or `<div>` wrapping the whole view). Add to its existing style rule:

```css
    container-type: inline-size;
```

If the wrapper has no class yet, give it `class="today-view"` and the rule above.

- [ ] **Step 2: Convert the stacking rule**

Replace the `.today-lanes` part of the `@media (max-width: 50rem)` block with a container query (keep any other selectors in that media block where they are):

```css
  @container (max-width: 50rem) {
    .today-lanes {
      background: var(--color-paper-2);
      grid-template-columns: minmax(0, 1fr);
    }

    .focus-lane + .focus-lane {
      border-block-start: var(--rule-hair) solid var(--color-rule);
    }
  }
```

- [ ] **Step 3: Verify in the rendered app**

Run: `pnpm build && pnpm preview` (or reuse a running preview server), open
`http://127.0.0.1:4173/Dusori/app/`, create a workspace + topic, open Today at 1200×800 with the
inspector open. The lanes must stack; actions must not overlap the item copy. Also verify 375×812
still stacks and full desktop with the inspector closed still shows two lanes.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/lib/components/LearningLoop.svelte
git commit -m "fix(app): stack Today lanes by container width so the inspector never overlaps them

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: E2E — the trail, the strip, and honest failure survive reload

**Files:**
- Modify: `tests/e2e/dusori.spec.ts` (new tests after the research block ending ~line 1288; extend the all-failed test at ~line 1260)

**Interfaces:**
- Consumes: existing helpers `createBrowserWorkspace(page)`, `createTopic(page, { remainInResearch: true })`, `wikipediaSearch` fixture (exactly 1 result: "Microsoft Entra Connect"), `expectNoSeriousA11yViolations(page)`.

- [ ] **Step 1: Add the trail persistence test**

```ts
test('a research run leaves a durable trail on disk and a mission strip on Today', async ({
  page,
}) => {
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    await route.fulfill({ contentType: 'application/json', json: wikipediaSearch });
  });
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });

  await page.getByRole('button', { name: 'Allow Wikipedia' }).click();
  await page
    .getByRole('dialog', { name: 'Allow Wikipedia search?' })
    .getByRole('button', { name: 'Allow search' })
    .click();
  await expect(page.getByRole('heading', { name: 'Microsoft Entra Connect' })).toBeVisible();

  const trail = page.getByRole('list', { name: 'Research trail runs' });
  await expect(trail).toContainText('Wikipedia');
  await expect(trail).toContainText('found 1');

  await page.reload();
  await expect(page.getByRole('list', { name: 'Research trail runs' })).toContainText('found 1');
  await expectNoSeriousA11yViolations(page);

  await page.getByRole('button', { name: 'Today' }).click();
  const missions = page.getByRole('list', { name: 'Research missions' });
  await expect(missions).toContainText('1 discovered');
  await expect(missions).toContainText('Refreshed');
  await expectNoSeriousA11yViolations(page);

  await page.setViewportSize({ height: 812, width: 375 });
  await expect(missions).toBeVisible();
  await expect(missions.getByRole('button', { name: /Open research/ })).toBeVisible();
});
```

- [ ] **Step 2: Extend the all-failed test (~line 1275, after the existing expectations and before `unroute`)**

```ts
  await page.reload();
  const failedTrail = page.getByRole('list', { name: 'Research trail runs' });
  await expect(failedTrail).toContainText('Wikipedia');
  await expect(failedTrail).toContainText('failed');
  await expect(page.getByText('No new suggestions matched this objective.')).toBeHidden();
```

Note: after the reload the retry flow continues; re-establish the fulfilled route *after* these
assertions exactly where the existing `unroute`/`route`/`retry` sequence sits, and click
'Scan for strong sources' instead of the pre-reload 'Retry scan' button if the retry button only
renders with an in-memory failed run — adjust to whichever button the reloaded view shows, the
assertion that matters is the persisted `failed` outcome.

- [ ] **Step 3: Add the lanes-stacking regression test**

```ts
test('today lanes stack instead of overlapping when the inspector narrows them', async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 1200 });
  await createBrowserWorkspace(page);
  await createTopic(page, {});

  await page.getByRole('button', { name: 'Today' }).click();
  const continueLane = page.locator('.continue-lane');
  const attentionLane = page.locator('.attention-lane');
  await expect(continueLane).toBeVisible();
  const continueBox = (await continueLane.boundingBox())!;
  const attentionBox = (await attentionLane.boundingBox())!;
  // With the inspector open at 1200px the lanes must stack (attention below continue),
  // not fight for width until actions overlap the copy.
  expect(attentionBox.y).toBeGreaterThan(continueBox.y + continueBox.height - 1);
});
```

(If `createTopic`'s default flow leaves the Research view open, keep the existing helper options —
check its signature at the top of the spec; `{ remainInResearch: false }` may be the default.
The inspector is open by default; do not close it in this test.)

- [ ] **Step 4: Build and run the new tests**

Run: `pnpm build && pnpm exec playwright test -g "durable trail|stack instead of overlapping|all-provider failure"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/dusori.spec.ts
git commit -m "test(e2e): mission trail, strip, and failure honesty survive reload

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Contract docs, changelog, and the full gate

**Files:**
- Modify: `docs/adr/003-portable-file-contract.md` (the `research.json` example and the source-record field list)
- Modify: `CHANGELOG.md` (new Unreleased section at top)
- Modify: `docs/product/spec.md` (research paragraph: one sentence that runs, outcomes, and ranking reasons persist in `research.json` / the manifest)

- [ ] **Step 1: Update ADR-003**

In the `research.json` literal example add `runs` with one representative entry (copy the shape from Task 1) and note the 50-run bound; in the source-record section list `publishedAt`, `publisher`, `author`, `whySelected` as optional research provenance with the same tolerant-string rationale as `origin`.

- [ ] **Step 2: Update CHANGELOG.md and spec.md**

CHANGELOG (top):

```markdown
## Unreleased

### Added

- Research runs persist as a durable trail in `research.json`: per-provider found/empty/failed
  outcomes, counts, the exact query, and how many results were new. A failed provider is stored
  and shown as a failure, never as an empty result.
- Saved research sources keep their ranking rationale (`whySelected`) and reported
  `publishedAt`/`publisher`/`author`.
- Today opens with a Research missions strip: discovered/saved counts, freshness, and
  per-lens coverage derived from workspace files.

### Fixed

- Today's lanes stack by available width, so the open inspector no longer squeezes
  Continue-learning actions over their copy at ~1200 px.
```

spec.md: in the "shipped Research workspace" paragraph (§ current milestone body, the paragraph beginning "Each provider is blocked behind an exact egress disclosure"), append: *"Every run — including one in which every provider failed — is recorded in the topic's `research.json` with per-provider outcomes and shown as a durable research trail; accepted sources keep the ranking reasons and any reported publication metadata."*

- [ ] **Step 3: Run the full gate**

Run: `pnpm check`
Expected: format, lint, typecheck, all unit tests, and the build PASS. (In this worktree, lint may need `pnpm exec eslint . --no-ignore` per the workspace notes if `eslint .` reports nothing checked; the `.remember/` formatting failure is a known pre-existing CI skip.)

Then: `pnpm exec playwright test`
Expected: full e2e suite PASS (64 existing + 2 new + 1 extended).

- [ ] **Step 4: Commit**

```bash
git add docs/adr/003-portable-file-contract.md CHANGELOG.md docs/product/spec.md
git commit -m "docs: record the durable research trail contract

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Deferred out of this phase (spec-tracked)

- `readState`, `claims[]`, angles, auto-refresh, deep pass, synthesis, Learn mode → Phases 2-5.
- Lens *unavailability reasons* on the strip ("Community — Reddit not configured") need provider-availability plumbing into `LearningLoop`; lands with Phase 2's provider work.
- Showing `whySelected` per source in the library UI rides with Phase 3's evidence table.
