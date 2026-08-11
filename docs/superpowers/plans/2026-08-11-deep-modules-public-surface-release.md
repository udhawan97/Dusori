# Deep modules, public surface, and v0.12.4 release plan

## Goal

Concentrate Dusori's research, provider, Today, and navigation policy behind four deep modules without changing the v0.12.3 product contract, then refresh the README, website, docs, screenshots, and release guidance from the verified result. Integrate the five current dependency updates as one coherent lockfile, publish v0.12.4, verify the exact shipped surfaces, and clean only refs proven safe.

## Invariants

- No provider egress before its device-local consent decision; optional AI keeps the separate `companion-ai` scope.
- The research sequence remains Ask -> Search allowed providers -> Save shortlist -> Read available evidence -> Brief -> Map/Outline.
- Provider availability remains distinct from each run's `found`, `empty`, or `failed` outcome.
- Automatic capture remains provider-bounded; arbitrary result pages stay references until a separate host-named fetch confirmation.
- Deterministic ranking, evidence extraction, synthesis structure, and graph derivation remain useful without AI.
- User-authored Markdown is never overwritten after a hash conflict; a Pending proposal preserves the alternative.
- Today and workspace navigation stay derived and nonpersisted. Opening a destination never changes progress.
- Browser history, storage reads, scrolling, and focus remain at the Svelte edge.
- Browser, folder, Tauri, and archive workspace contracts remain compatible with v0.12.3.

## Chosen interfaces

1. `loadResearchProviderCatalog(...)`
   - One registration owns provider identity, disclosure, consent scope, mode, capability state, origins, research lens, routing class, and capture classification.
   - The Research Desk, Settings consent labels, mission lenses, hosted CSP test, and desktop CSP test consume its derived facts.
2. `runResearchSequence(...)`
   - Accepts only already-allowed provider adapters and an optional separately authorized synthesis enhancer.
   - Hides search, run recording, ranking, bounded capture, source persistence, claim reading, deterministic fallback, and guarded brief writing.
   - Reports a coarse monotonic stage callback and one discriminated outcome.
3. `projectToday(...)`
   - Returns summaries, Continue learning, Needs attention, missions, recap, next review, and totals from one captured time.
   - Writes nothing and leaves every repair or mutation with its owning workflow.
4. `transitionWorkspaceNavigation(...)`
   - Purely maps workspace-specific intents to valid state and browser-edge effects.
   - Owns URL parsing/serialization, topic/path invariants, view reset policy, and history/orientation intent.

## Implementation order

1. Add the provider catalog and interface-level tests; add desktop CSP parity; migrate Research Desk, Settings, and mission lenses.
2. Add the complete research sequence with memory-storage and fake-provider tests; replace UI-owned orchestration.
3. Add the Today projection with one interface-level test; replace caller-owned Promise choreography.
4. Add the navigation transition with table tests; migrate the route's repeated view mutations through one dispatcher.
5. Apply the five verified direct dependency changes and regenerate one lockfile with pinned pnpm under Node 24.
6. Bump every authoritative version to 0.12.4; update the product contract, changelog, release note, README, docs navigation, website copy/design, release/download links, and visual artifacts.
7. Run targeted tests after each module, then formatting, lint, types, unit tests, builds, E2E, companion package smoke, desktop release config checks, link/asset checks, responsive/keyboard/reduced-motion inspection, and Graphify incremental refresh/query.
8. Run exactly two four-role council rounds and address valid findings before the first commit or push.
9. Re-fetch, commit the verified integration tree, fast-forward/push `main`, create `v0.12.4`, verify CI and desktop draft assets/checksums, publish the GitHub release, verify npm and live Pages, then close/delete only fully integrated automation refs and prune stale worktree metadata.

## Public-surface coverage ledger

| Claim or surface                     | Source of truth                            | Status                    | Destination                              | Verification                                      |
| ------------------------------------ | ------------------------------------------ | ------------------------- | ---------------------------------------- | ------------------------------------------------- |
| Research sequence and trust boundary | Product spec + `runResearchSequence` tests | Shipped                   | README, site, research docs              | Unit + E2E + runtime capture                      |
| Provider availability/disclosure     | Provider catalog + companion capabilities  | Shipped                   | Research Desk, Settings, provider matrix | Catalog + CSP parity + E2E                        |
| Today orientation                    | `projectToday` + workspace files           | Optional learning tool    | README/docs only where relevant          | Unit + E2E                                        |
| Browser/PWA                          | Pages artifact                             | Shipped                   | Hero and run matrix                      | Local build + live HTTP/browser                   |
| macOS Apple silicon and Windows x64  | Desktop workflow and release assets        | Shipped                   | README/site/download docs                | CI assets + checksums; macOS smoke when available |
| Installer signing caveat             | Release contract and artifacts             | Shipped limitation        | Near every desktop download              | Copy closure search                               |
| Screenshots and social preview       | Seeded E2E workspace                       | Current                   | README, site, metadata                   | Deterministic capture + visual inspection         |
| v0.12.4 links and package            | Tag/release/npm evidence                   | Pending until publication | README/site/release notes                | Exact-SHA remote and served checks                |

## Acceptance

- The four Svelte callers no longer assemble the deep policy they consume.
- Tests cross the same four interfaces as production callers and cover consent, source-level continuation, edited-brief conflict, nonpersistence, traversal-safe/global URLs, and CSP invariants.
- The public story answers what Dusori is, who it helps, what it really looks like, its trust boundary, and the correct way to start on each supported platform.
- No stale 0.12.3 download, release-note, screenshot, or social-preview claim remains in an authoritative current surface after publication.
- Local and remote `main`, the `v0.12.4` tag, successful workflows, release assets, npm `latest`, and live Pages all point to the intended release.
