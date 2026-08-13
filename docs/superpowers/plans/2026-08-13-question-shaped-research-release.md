# Question-shaped research and v0.13.0 release plan

## Goal

Make provider consent usable at 320 px, keep the System appearance synchronized while Dusori is
open, and add two evidence sources that answer demonstrated gaps: Europe PMC for biomedical
literature and the Library of Congress for digitized primary-source records. Route providers from
the question locally before any consent prompt or network request, refresh every public surface
from the verified app, publish v0.13.0 from the exact `main` commit, and remove only refs proven
fully integrated.

## Scope decision

The release implements every approved audit outcome:

1. resilient consent layout and focus restoration;
2. live System-theme synchronization;
3. local topic routing with Europe PMC and Library of Congress.

Hugging Face is not in this release. The audit treated it as conditional on a demonstrated
model-or-dataset workflow, and no such product need exists in the current Research Desk. Adding it
would create a new network destination and consent disclosure without an honest user outcome.

## Invariants

- Provider classification is deterministic and local. No provider receives a query before its
  exact device-local consent scope is allowed.
- Europe PMC and Library of Congress each start off independently and acquire no consent from a
  routing match. Classification changes only which rows and already-allowed adapters are relevant;
  it never checks a box, grants, revokes, reuses, or broadens a decision.
- A provider denied for one scope remains denied until the user resets that exact decision.
- Specialist providers never become fallback egress for an unrelated question merely because they
  are the only allowed providers.
- The research sequence remains Ask -> Search allowed relevant providers -> Save shortlist -> Read
  available evidence -> Brief -> Map/Outline.
- Provider availability remains distinct from each run's `found`, `empty`, or `failed` outcome.
- Europe PMC captures only returned metadata and abstracts; it never represents an abstract as a
  full paper or assumes open access.
- Library of Congress results are saved as catalog references, not as page text or proof that an
  item is unrestricted to reuse.
- Canonical URL, DOI, and conservative scholarly-title deduplication keep one result in the shelf,
  preferring an abstract already returned with search over a reference that needs a later fetch,
  while the persisted run trail retains outcomes for every provider that found it.
- System appearance follows `prefers-color-scheme` only while the saved choice is System. Paper,
  Ink, and Night remain stable explicit choices.
- Browser, folder, archive, desktop, updater, and workspace-file contracts remain compatible with
  v0.12.4.
- Existing `.remember/**` changes in the original `main` checkout are user work and remain
  untouched; all release work stays in the isolated integration worktree.

## Chosen design

### 1. Local provider routing remains inside the provider catalog

- Extend the catalog routing classes with biomedical and cultural-heritage audiences.
- Match bounded, reviewed term and phrase sets against `ResearchQuery.searchText` and normalized
  terms. General providers continue to serve every question; developer, Microsoft, biomedical,
  and heritage providers join only when relevant.
- Ambiguous and no-match questions join neither specialist. Classification is a pure local
  function with no prefetch, retry, telemetry, URL probe, or provider request.
- Polysemous single words such as `virus`, `infection`, `archive`, `office`, `windows`, and
  `library` are not sufficient specialist signals. Prefer missing a specialist over surprise
  egress, and cover cross-audience collisions with near-miss fixtures.
- Remove the current “any allowed provider” fallback. `select(query, allowedScopes)` becomes an
  exact intersection of locally relevant providers and allowed scopes.
- Keep the routing table explicit and fail closed: a biomedical or heritage near-miss, unavailable
  adapter, denial, timeout, or failure never reroutes the query to a different specialist.
- Compute the consent candidates from `select(query)` before opening the dialog. A broad question
  therefore no longer asks for every available adapter, and an allowed unrelated specialist is
  never contacted as a fallback.
- Keep the full provider catalog and every prior saved decision reachable outside the
  per-question prompt. The focused prompt may filter/reorder rows but never hides the route to
  inspect or reset any prior provider choice.

### 2. Europe PMC is a biomedical, readable-or-reference provider

- Search the production REST endpoint at `www.ebi.ac.uk` with JSON `resultType=core`, a bounded
  page size of eight, and the exact topic plus objective already disclosed by Dusori. Use one
  request, an abort signal tied to the research agent's 12-second provider timeout, and no
  automatic retry.
- Validate the response with Zod, normalize HTML-bearing title/abstract text, prefer a DOI URL when
  supplied, and otherwise use the Europe PMC article URL keyed by source and identifier.
- Keep the returned abstract only in the run's bounded in-memory candidate until capture writes
  capped Markdown labeled **Abstract**; the persisted research trail stores candidate identity,
  URL, and provider outcomes rather than the transient payload.
- Preserve PMID, PMCID, DOI, journal, authors, date, citation count, and open-access signal as
  metadata without inferring rights.
- If no abstract exists, save a citation reference and make that limitation explicit.

### 3. Library of Congress is a heritage, reference-only provider

- Search `www.loc.gov/search/` through the documented JSON response format with
  `fo=json&at=results&fa=digitized:true&c=24`, then keep at most eight accepted items. Use one
  request, an abort signal tied to the research agent's 12-second provider timeout, and no
  automatic retry.
- Because the search endpoint includes site pages as well as collection items, accept only
  canonical `www.loc.gov/item/` records and normalize historical `http` identifiers to `https`.
- Validate heterogeneous optional fields defensively, preserve format/date/contributor metadata,
  and keep the bounded catalog description only in the run's in-memory candidate until capture.
- Save a capped catalog reference and original item URL. Do not fetch arbitrary item resources,
  images, OCR, or media in this release.
- A per-session three-second start interval enforces at most 20 Library JSON requests/minute.
  `429` plus a valid `Retry-After` records a bounded local backoff for later user-initiated runs;
  there is no automatic retry. CAPTCHA, CORS, malformed JSON, HTML, and timeout responses become
  one isolated provider failure rather than triggering a retry storm or losing other providers'
  results.

### 4. Consent is a fixed shell with one scrollable region

- Bind the research trigger so every dismissal path can restore focus deterministically.
- Split the dialog into a fixed heading, an independently scrollable provider list, and a sticky
  action footer. At narrow widths use a two-column action grid with the primary action spanning
  both columns. Size the shell with dynamic viewport units and safe-area padding so zoom and an
  on-screen keyboard cannot clip the actions.
- Explain that the prompt shows only providers relevant to this question and that the full catalog
  remains available under Research providers and setup.
- `Decide later`, Escape, backdrop dismissal, a saved all-off choice, and a saved selected choice
  all close without leaking focus into the page or causing network activity before persisted
  consent.
- Stress the scroll region with more providers than the current catalog so later provider growth
  cannot move the footer below the viewport again.

### 5. System appearance owns one live media-query subscription

- Add a reusable appearance observer that listens to
  `(prefers-color-scheme: dark)`, reapplies the theme only for the System choice, emits one local
  appearance event, and removes its listener on teardown.
- Start the observer in the application shell rather than Settings so direct launches stay live.
- Keep the header toggle label/icon synchronized with the actual document theme through the same
  event. Explicit appearance choices do not change on later system events.

## Implementation order

1. Add routing tests first, including broad history, biomedical, heritage, ambiguous, developer,
   Microsoft, exact allowed-scope intersection, revocation, and no specialist fallback.
2. Reshape the consent workflow and dialog; add narrow-viewport, provider-growth, keyboard, focus,
   and zero-egress E2E coverage.
3. Add Europe PMC and Library of Congress adapters, stable fixtures, response/error/capture tests,
   catalog registration, CSP parity, cross-provider failure isolation, and DOI/title
   dedup/run-provenance coverage.
4. Add the live appearance subscription and unit/E2E coverage for System versus explicit choices.
5. Record the routing/privacy decision in ADR-014 and update the product contract.
6. Bump every authoritative version to 0.13.0 and regenerate the lockfile only as required by those
   workspace manifests.
7. Refresh the README, landing page, provider/source/getting-started/update/browser/roadmap docs,
   docs index/navigation, changelog, release note, current app screenshot, download badge, and
   metadata. Keep installer-signing and updater-signature claims clearly separate.
8. Run targeted tests throughout, then the full formatter, lint, typecheck, unit, build, E2E,
   companion smoke, desktop config, link/asset, responsive, keyboard, contrast, reduced-motion,
   and Graphify gates.
9. Run the mandatory final two-round four-role council, resolve valid blockers, and re-run affected
   verification.
10. Re-fetch and require a fast-forward path from the verified integration commit to `origin/main`;
    push without force, wait for green CI/Pages, tag that exact commit as v0.13.0, verify draft
    desktop assets and checksums before publication, publish, and then verify npm `latest`, the live
    site, update feed, release links, and downloaded macOS artifact.
11. Remove the temporary worktree and integration branch only after the commit is reachable from
    `origin/main`. Leave the original dirty checkout and its local `main` worktree files untouched.

## Test matrix

| Boundary                 | Required proof                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Routing                  | An explicit positive/near-miss table proves health adds Europe PMC; heritage adds Library of Congress; ambiguous and broad unrelated questions add neither; disabled, denied, unavailable, failed, or allowed-only unrelated specialists are never fallback egress                                                                   |
| Consent                  | Only relevant undecided providers appear; all providers/prior decisions remain reachable elsewhere; no request or classification side effect before saved allow; denial/revocation stays local; all three actions remain visible without scrolling the whole dialog at 320 x 568 even with a growth-sized provider list              |
| Focus                    | Initial checkbox receives focus; Escape, Decide later, Keep all off, and Save choices restore the Research topic button; Tab and Shift+Tab remain contained                                                                                                                                                                          |
| Europe PMC               | Query encoding, one request/eight-result bound, aborting timeout, 429/malformed/CORS isolation, HTML cleanup, DOI/PMID URL, abstract/reference capture, disclosure and origin                                                                                                                                                        |
| Library of Congress      | Query encoding, exact JSON/digitized facets, one request/24-result fetch bound with eight accepted items, aborting timeout, three-second start throttle, Retry-After backoff, 429/HTML/CAPTCHA isolation, heterogeneous/missing fields, canonical item-only filtering, HTTPS normalization, reference capture, disclosure and origin |
| Dedup/provenance         | One canonical DOI or normalized-title shelf item; every answering provider outcome remains in the persisted run trail                                                                                                                                                                                                                |
| Appearance               | System reacts live in both directions; explicit Paper/Ink/Night ignore system changes; observer cleanup and toggle label/icon stay correct                                                                                                                                                                                           |
| CSP                      | Hosted and Tauri `connect-src` contain both declared origins and no unrelated wildcard                                                                                                                                                                                                                                               |
| Responsive/accessibility | 320, 375, 414, 768, and desktop; keyboard-only; visible focus; 44 px coarse targets; reduced motion; no horizontal overflow                                                                                                                                                                                                          |
| Compatibility            | Existing workspace fixtures, research sequence, companion providers, desktop config, and archive/folder/browser modes remain green                                                                                                                                                                                                   |

## Public-surface coverage ledger

| Claim or surface                       | Source of truth                     | Release state before publication | Destination                           | Verification                                           |
| -------------------------------------- | ----------------------------------- | -------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| Question-shaped provider routing       | Catalog tests + ADR-014             | Candidate                        | README, landing page, provider docs   | Unit + E2E + runtime network log                       |
| 11 browser / 4 companion providers     | Catalog + capability tests          | Candidate                        | README, site, docs, product spec      | Catalog/CSP tests + copy closure search                |
| Europe PMC abstract boundary           | Provider fixture/tests              | Candidate                        | Provider/source docs + disclosure     | Unit + runtime fixture capture                         |
| Library of Congress reference boundary | Provider fixture/tests              | Candidate                        | Provider/source docs + disclosure     | Unit + runtime fixture capture                         |
| Mobile consent behavior                | Research Desk source + E2E          | Candidate                        | Current app screenshot + release note | 320 px runtime screenshot + keyboard checks            |
| Live System appearance                 | Appearance tests + runtime          | Candidate                        | Release note and settings docs        | Emulated media change without reload                   |
| macOS Apple silicon / Windows x64      | Desktop workflow                    | Pending until assets exist       | README/site/download docs             | CI assets + checksums + downloaded artifact inspection |
| Installer signing caveat               | Release workflow and artifact state | Unchanged limitation             | Near each desktop download            | Copy closure search + codesign inspection              |
| v0.13.0 tag, npm, Pages, update feed   | Exact release SHA                   | Pending until publication        | Current-version surfaces              | Remote API, HTTP, npm, and checksum proof              |

## Release and cleanup gates

- The original checkout starts on `main` at `9828881f957bd4c5373c46349e8dda56053c8e1a`
  with five pre-existing `.remember/**` changes. Those paths are never staged, stashed, reset, or
  deleted.
- The isolated branch starts from the same commit and tracks `origin/main`.
- Repository inventory found no open PR, no additional local/remote branch, and no additional
  worktree. Closed Dependabot requests are already present or superseded in `main`, so they require
  no integration ref and no deletion action.
- Immediately before cleanup, inventory every local branch, remote branch, worktree, HEAD, upstream,
  and commit unique to the temporary branch again. Delete only after the tested commit is proven
  reachable from `origin/main`.
- Before push: re-fetch, prove `origin/main` is an ancestor of the candidate commit, inspect the
  exact diff/stat, and require every local gate to pass.
- Before tag: refresh Graphify, verify one scoped provider-routing query against the updated graph,
  and require the pushed `origin/main` SHA and successful main CI/Pages workflow to equal the
  candidate commit.
- Before release publication: download every draft asset, verify `SHA256SUMS.txt`, inspect updater
  signatures/feed structure, and verify the macOS disk image and app metadata.
- After publication: require GitHub latest, npm `latest`, live Pages, release/download links, and
  updater `latest.json` to report 0.13.0 from the intended commit.
- Cleanup is limited to the isolated integration worktree/branch after reachability proof and stale
  metadata pruning. No force push, broad deletion, or original-worktree mutation is allowed.

## Acceptance

- At 320 x 568, browser zoom, and keyboard-open dynamic viewport states, the consent heading and
  actions are simultaneously reachable while only the
  provider list scrolls; no whole-dialog or horizontal scroll is needed to choose an action, even
  with more rows than the current provider catalog.
- Every dialog close path restores focus to the button that opened it, and no request occurs before
  a relevant provider's allow decision is saved.
- Every provider remains individually off by default, and every saved prior choice stays reachable
  and resettable from the full catalog/Settings path regardless of the current question.
- A health question can select Europe PMC; a heritage question can select Library of Congress; an
  unrelated question and an allowed-only unrelated specialist select neither.
- Provider results are typed honestly: Europe PMC abstract or citation reference, Library of
  Congress catalog reference, with exact provider outcomes preserved in the research run.
- System appearance changes live without reload and explicit choices remain unchanged.
- README, website, docs, visuals, changelog, ADRs, product contract, version metadata, and release
  links agree on the verified v0.13.0 behavior and keep current platform/signing limits adjacent to
  their calls to action.
- `origin/main`, v0.13.0, successful workflows, release assets/checksums, npm `latest`, live Pages,
  and the updater feed all point to the same intended release commit.
- The user's existing `.remember/**` changes survive unchanged, and cleanup removes only the proven
  integrated temporary worktree/branch.
