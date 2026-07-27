# Source-grounded review sessions — design

**Status:** approved · **Date:** 2026-07-27

## Program context

The research agent shipped its three phases (deterministic agent, companion
providers, optional AI layer). Its spec names the next program item outright:
**review-queue question generation from approved sources**
([2026-07-21-research-agent-design.md](2026-07-21-research-agent-design.md)).

Today the two halves of Dusori do not touch. Research approves sources into
`Topics/<slug>/Sources/`; **Review next** schedules topics from
`review.json`. Between them the learner gets no prompt to actually recall
anything — "Got it" is pressed on a feeling, not on an attempt.

This slice connects them:

> roadmap objective → approved readable sources → active-recall session →
> explicit "Got it" / "Needs work" → existing review schedule.

## Goal

From a due (or otherwise queued) topic, one click opens a **review session**:
3–5 deterministic active-recall prompts built from the current roadmap
objective and the topic's own approved sources. Each prompt names the source
it came from and hides a bounded excerpt until the learner has tried to
answer. The session ends on the review actions that already exist. Nothing
about the session changes the schedule except that final, explicit rating.

## Decisions taken during design

- **Deterministic first, and complete.** The baseline uses transparent
  templates over the objective title, source headings, and bounded excerpts.
  With no companion, no model, and no network it is the whole feature, not a
  degraded mode.
- **Ephemeral session.** No new file, no new schema, no writes on start or
  abandon. A session is a projection of files that already exist (roadmap,
  source manifest, source text). Persisting it would buy resumability nobody
  asked for and cost a new machine-owned file, a conflict story, an export
  path, and a way for an abandoned session to look like progress. Re-opening
  rebuilds the same prompts from the same inputs, which is what determinism
  is for.
- **Sources are the gate, not the model.** Only sources with readable local
  text are eligible. A URL reference that was stored without its page is
  named and explained — never fetched automatically, in or out of a session.
- **Evidence stays visible and attributed.** Every prompt carries its source
  title, its workspace-relative path, the heading it came from, and a bounded
  excerpt. The excerpt is revealed on demand so the prompt still tests recall.
- **The schedule has exactly one writer.** `markTopicReviewed` remains the
  only path to `review.json`, called once, from the same "Got it" / "Needs
  work" handler the queue already uses. Opening, navigating, revealing and
  closing a session write nothing at all.
- **No mastery claims.** No score, no streak, no percentage, no "you know
  this". A generated question is a prompt to think, and the copy says so.
- **AI is optional, narrow, and consent-scoped.** It may reword the prompts.
  It may not add, remove or reorder them, touch the evidence, mark a review,
  write a note, or open the schedule.

## The deterministic experience

### Selecting sources

`readSourceManifest` is the input; no second index is built.

1. Records are taken in manifest order (stable, append-only). Reading stops
   at 4 usable sources or 12 examined records, whichever comes first.
2. Each file is read through the storage adapter. A file that is missing or
   unreadable is skipped silently — a broken source must not break review.
3. **Readable** means the body carries real text. The provenance preamble
   that Dusori writes itself (`# Title`, `Original URL: <…>`, `Resolved
URL:`, `Byline:`, `Site:`, `Fetched from … via the local companion.`) and
   the URL-reference sentence (`Dusori stored this reference without fetching
its contents.`) are stripped before measuring. What remains must be at
   least 40 characters — low enough that a short pasted note is still
   reviewable, high enough that a bare reference never is. This is
   content-based, not provenance-based, so a
   pasted note, an imported file, an upgraded page extract, and a future
   provider all qualify on the same terms.
4. Each readable file yields at most 2 excerpt candidates: its first two
   Markdown sections, where a section is a heading plus the prose under it.
   A file with no headings uses the source title as the heading.
5. Candidates are interleaved round-robin across sources, so three prompts
   drawn from three sources beat three prompts drawn from one.

Excerpts are bounded to 320 characters, cut at a word boundary, with an
ellipsis when truncated. Light Markdown is flattened (links to their text,
emphasis and code marks removed) so the excerpt reads as a quotation and is
rendered as **plain text**, never as Markdown or HTML — source text is
untrusted data.

### Building prompts

Three templates, always in this order:

1. `explain` — _Explain "&lt;objective&gt;" in your own words before revealing
   the source._
2. `contribution`, one per selected excerpt (1–3 of them) — _What does
   "&lt;heading&gt;" in &lt;source title&gt; contribute to "&lt;objective&gt;"?_
3. `compare` — _Compare your explanation with this excerpt. What did you omit
   or misunderstand?_

That is 3 prompts with one excerpt available and 5 with four, which is the
required 3–5 band without any tuning knob. Prompt ids are stable
(`explain`, `contribution-1…3`, `compare`) so a test — and an AI reply — can
be matched positionally without depending on wording.

### Session states

| State                            | What the learner sees                                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ready                            | 3–5 prompts, one at a time, with reveal-on-demand evidence                                                                                                              |
| No sources                       | "This topic has no sources yet." with the route to Research                                                                                                             |
| Only URL references              | Names the count, explains that readable text must be fetched with the companion or pasted in, and states plainly that Dusori will not fetch it for them                 |
| Unreadable / unavailable storage | The read error, with the queue untouched                                                                                                                                |
| Stale                            | The session is a snapshot; the excerpt panel states the local path and that the source may have changed since the session opened. Re-opening rebuilds it.               |
| Conflict                         | Only reachable on the final rating, where `markTopicReviewed`'s existing retry-then-report protocol already applies; the queue refreshes to what was actually persisted |

## Module design

One new core module, `learning/recall.ts`, exported through the existing
barrel. It owns no storage path of its own and no scheduling logic.

```ts
buildRecallSession(storage, { objective, topicSlug, topicTitle }, now?)
  → Promise<RecallSessionResult>            // ready | no-sources | no-readable-sources

recallAiRequest(session)   → RecallAiRequest        // pure: the exact egress payload
applyAiRecallPrompts(session, texts, model) → RecallSession  // pure: validate or keep deterministic
```

`RecallSessionResult` is a discriminated union on `status`, matching
`RoadmapUpdateResult`'s existing idiom. `RecallPrompt` carries
`{ id, kind, prompt, evidence, generatedBy: 'template' | 'ai' }`, and
`RecallEvidence` carries `{ excerpt, heading, path, title, truncated }`.

Reused, not rebuilt: `readSourceManifest` (source list), `readTopicProgress`
(objective), `StorageAdapter` (all reads), `markTopicReviewed` (the only
write), `appendTopicUpdate` (only via that call), `createCompanionAiClient`
(AI transport), and the provider-consent machinery in the app.

## Optional AI

Gated on all four of: the companion is connected, it reports a configured AI
provider, the learner has granted the **`companion-ai-recall`** consent
scope, and a deterministic session already exists.

The recall scope is separate from the existing `companion-ai` ranking scope
because the egress genuinely widens: ranking sends candidate metadata that
came from a public search, while recall sends text out of the learner's own
workspace. Consent to the narrower disclosure must never be reused for the
wider one, so the disclosure names it exactly:

> Sharper prompts send this objective and up to four short excerpts (320
> characters each) from the sources you approved for this topic to the AI
> provider configured in your local companion. Your notes, roadmap, and
> review history are not sent. Allow on this device?

`recallAiRequest(session)` is the whole payload — objective plus the
per-prompt `{ title, heading, excerpt }` — and is a pure function precisely
so a test can assert nothing else can leave. The companion route
`POST /api/ai/recall-prompts` sits behind the same bearer token, origin
allowlist and loopback bind as every other companion route, and returns
`{ prompts: string[] }`.

`applyAiRecallPrompts` replaces **only** prompt text, position by position.
It keeps the deterministic session unchanged when the reply has the wrong
count, an empty entry, or an entry over 400 characters. Evidence, ordering,
prompt count and prompt kinds are structurally untouchable. Network failure,
a non-200, an unparsable body, or a 20-second timeout all fall back to the
deterministic prompts with a visible one-line notice. AI prompt text is
untrusted: rendered as plain text and labelled with the model that wrote it.

## App surface

`ReviewSession.svelte`, opened from a **Start review** button on each
**Review next** queue item, as a native modal dialog using the existing
`modal` action (top-layer, inert background, contained Tab, restored
invoker).

- One prompt at a time: position (`Prompt 2 of 4`), the question, a
  **Reveal source** button, then Back / Next.
- Revealed evidence shows the source title, the workspace path in monospace,
  the heading, and the excerpt as plain text in a blockquote.
- Every prompt card is labelled — `Deterministic prompt` or
  `Written by <model> · unverified` — and the dialog footer states that the
  session is not saved and nothing is written to the workspace.
- The last step shows the existing **Got it** / **Needs work** actions, which
  call the queue's existing `markReviewed` handler exactly once and then
  close the session.
- **Close without rating** is always available (button, Escape, backdrop
  `cancel`) and says explicitly that the schedule did not change.
- Keyboard: the dialog takes focus on open, Escape closes, every control is
  reachable, prompt changes are announced through `aria-live="polite"`, and
  the excerpt region is focusable and named so it can be scrolled.
- Narrow widths: single column from 320px up, actions wrap, the excerpt
  scrolls inside its own bounded region rather than the page.
- Reduced motion: the component adds no animation at all, so there is
  nothing to disable.
- Offline: every deterministic path is local file reads. The AI chip only
  appears when a companion has already reported a provider.

## Data contract

Unchanged. No new file, no new schema, `schemaVersion` stays 1. The only
write in the whole feature is the existing `markTopicReviewed` (`review.json`
plus its dated update line).

## Testing

- **Core (unit):** prompt construction across 1/2/4+ excerpt counts; stable
  ordering and round-robin source diversity; excerpt bounding and word-cut;
  readable-vs-reference classification (paste, file, upgraded extract, URL
  stub, provenance-preamble-only); `no-sources` and `no-readable-sources`
  results; missing/unreadable file skipped; `recallAiRequest` carries the
  objective and excerpts and nothing else; `applyAiRecallPrompts` accepts a
  well-formed reply and rejects wrong-count, empty, and over-long replies.
- **Core (client):** `recallPrompts` posts to the companion route with the
  bounded body, parses the reply, and raises the shared companion error on a
  non-200, an unparsable body, or an abort/timeout.
- **Companion:** the new route's zod gate, success, `not-configured` (503),
  and provider-failure (502) paths, with an injected upstream fake.
- **App (unit):** a session started and abandoned leaves `review.json`
  absent; a final rating calls `markTopicReviewed` exactly once.
- **E2E:** the full journey — seed a source, open **Today**, **Start
  review**, walk the prompts, reveal the evidence and see the source path,
  rate **Got it**, and land on the next due date; plus the URL-reference-only
  state, keyboard-only operation with focus restoration, 320px layout, and
  axe on the open dialog.

## Out of scope

Chat tutoring, `TUTOR.md`, mastery scoring or streaks, automatic fetching,
hosted-app AI or key storage, scheduled or closed-app work, Reddit/YouTube
providers, new curriculum adapters, release or deployment.

## Risks

| Risk                                                           | Mitigation                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A generated question is mistaken for the learner's own writing | Nothing is written to the workspace; every prompt is labelled in place, AI prompts additionally by model     |
| A prompt reads as an authoritative test of understanding       | Copy states the session is prompts and excerpts only; no score, streak, or mastery signal exists to display  |
| AI text smuggles instructions out of a source                  | Plain-text rendering, bounded length, structural fields never taken from the model                           |
| Excerpt egress surprises a learner who allowed AI ranking      | A separate consent scope with its own disclosure; ranking consent grants nothing here                        |
| Sessions bloat the review schedule                             | Only the explicit final rating writes; start, navigate, reveal, and abandon write nothing, asserted in tests |
| A topic's sources are all URL references                       | Explicit named state with the two manual routes; automatic fetching stays forbidden                          |
