<script lang="ts">
  import {
    BookOpen,
    Bell,
    BellOff,
    CalendarClock,
    ChevronDown,
    Download,
    ExternalLink,
    FileCode2,
    FileText,
    Library,
    Link2,
    Map,
    MessageSquareText,
    Eraser,
    Printer,
    Quote,
    RefreshCw,
    SearchCheck,
    Trash2,
    UserRound,
  } from '@lucide/svelte';

  import {
    evidenceClaims,
    deleteResearchThread,
    lensFor,
    missionLensLabels,
    redactResearchThread,
    recordResearchThreadEvent,
    setResearchThreadFollowed,
    type ResearchOutputStyle,
    type ResearchRunRecord,
    type ResearchThread as ResearchThreadRecord,
    type ResearchThreadEvent,
    type SourceRecord,
    type StorageAdapter,
  } from '@dusori/core';
  import { tick } from 'svelte';

  import { wikilinkTarget } from '$lib/markdown';
  import {
    buildResearchThreadExportBundle,
    researchAnswerRun,
    researchRunQuestion,
    researchSourceState,
    researchThreadPreview,
    researchThreadFilename,
    researchThreadManifestFilename,
    type ResearchThreadExportInput,
  } from '$lib/research-thread';
  import MarkdownView from './MarkdownView.svelte';
  import ResearchTrail from './ResearchTrail.svelte';

  export let topicSlug: string;
  export let topicTitle: string;
  export let synthesisMarkdown: string;
  export let synthesisRunAt: string | undefined = undefined;
  export let outputStyle: ResearchOutputStyle;
  export let sources: SourceRecord[] = [];
  export let runs: ResearchRunRecord[] = [];
  export let threads: ResearchThreadRecord[] = [];
  export let events: ResearchThreadEvent[] = [];
  export let threadId: string | undefined = undefined;
  export let storage: StorageAdapter;
  export let generatedAt: string;
  export let autoRefreshEnabled = false;
  export let busy = false;
  export let onUpdate: () => void = () => undefined;
  export let onToggleAutoRefresh: (enabled: boolean) => void = () => undefined;
  export let onOpenSources: () => void = () => undefined;
  export let onOpenMap: () => void = () => undefined;
  export let onOpenDocument: (path: string) => void = () => undefined;
  export let onOpenExternal: (event: MouseEvent, url: string) => void = () => undefined;
  export let onThreadChanged: () => void = () => undefined;

  type ThreadView = 'thread' | 'document';
  type ExportKind = 'html' | 'markdown' | 'pdf';

  let view: ThreadView = 'thread';
  let showAllSources = false;
  let exporting: ExportKind | '' = '';
  let exportStatus = '';
  let managementStatus = '';
  let managing = false;
  let threadElement: HTMLElement;
  let documentHeading: HTMLHeadingElement;

  $: latestRun = runs.at(-1) ?? null;
  $: answerRun = researchAnswerRun(runs, synthesisRunAt);
  $: answerRunIndex = answerRun ? runs.findLastIndex((run) => run.at === answerRun?.at) : -1;
  $: nonReplacingProposal = [...runs.slice(answerRunIndex + 1)]
    .reverse()
    .find((run) => run.synthesisOutcome === 'proposed');
  $: latestUpdateDidNotReplace = Boolean(
    latestRun &&
    (latestRun.synthesisOutcome === 'proposed' || (answerRun && latestRun.at !== answerRun.at)),
  );
  $: visibleSources = showAllSources ? sources : sources.slice(0, 5);
  $: readCount = sources.filter((source) => evidenceClaims(source).length > 0).length;
  $: claimCount = sources.reduce((total, source) => total + evidenceClaims(source).length, 0);
  $: answerPreview = researchThreadPreview(synthesisMarkdown);
  $: threadEvents = threadId ? events.filter((event) => event.threadId === threadId) : [];
  $: currentThread = threads.find((thread) => thread.threadId === threadId);
  $: exportInput = {
    generatedAt,
    outputStyle,
    runs,
    sources,
    synthesisMarkdown,
    synthesisRunAt,
    topicSlug,
    topicTitle,
    threadId,
    threads,
  } satisfies ResearchThreadExportInput;

  function displayDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function hostOf(value: string | undefined): string {
    if (!value) return 'local source';
    try {
      return new URL(value).hostname.replace(/^www\./u, '');
    } catch {
      return 'original site';
    }
  }

  function sourceLens(source: SourceRecord): string {
    return source.origin?.provider
      ? missionLensLabels[lensFor(source.origin.provider)]
      : 'Your material';
  }

  function savedSourcePath(target: string): string | undefined {
    return sources.find((source) => {
      const filename = source.path
        ?.split('/')
        .at(-1)
        ?.replace(/\.(?:md|txt)$/u, '');
      return filename === target;
    })?.path;
  }

  function followSynthesisLink(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest('a');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const href = anchor.getAttribute('href');
    const target = wikilinkTarget(href);
    if (target) {
      const path = savedSourcePath(target);
      if (!path) return;
      event.preventDefault();
      onOpenDocument(path);
      return;
    }
    if (href && /^https?:\/\//iu.test(href)) onOpenExternal(event, href);
  }

  async function focusThreadTarget(id: string): Promise<void> {
    const target = threadElement.querySelector<HTMLElement>(`#${id}`);
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  async function openFullDocument(): Promise<void> {
    view = 'document';
    await tick();
    documentHeading?.focus({ preventScroll: true });
    documentHeading?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  function downloadText(content: string, filename: string, mediaType: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    queueMicrotask(() => URL.revokeObjectURL(url));
  }

  function activityLabel(event: ResearchThreadEvent): string {
    if (event.type === 'question-created') return 'Question started';
    if (event.type === 'follow-up-created') return 'Follow-up started';
    if (event.type === 'research-completed') return 'Lookup completed';
    if (event.type === 'source-saved') return 'Source saved';
    if (event.type === 'source-read') return 'Evidence read';
    if (event.type === 'quote-added') return 'Quote saved';
    if (event.type === 'note-added') return 'Source note saved';
    if (event.type === 'synthesis-written') return 'Answer written';
    if (event.type === 'synthesis-proposed') return 'Answer proposed';
    if (event.type === 'export-created') return 'Export created';
    return 'Question redacted';
  }

  function activityDetail(event: ResearchThreadEvent): string {
    if (event.type === 'question-created') return 'Local thread identity created.';
    if (event.type === 'follow-up-created') return 'Local child thread linked to its parent.';
    if (event.type === 'research-completed') {
      const found = event.providers.reduce((total, provider) => total + provider.count, 0);
      return `${event.eligibleCount} relevant retained · ${found} returned before ranking. This receipt is discovery history, not evidence.`;
    }
    if (event.type === 'source-saved') {
      return event.readState === 'reference'
        ? 'Reference saved; it cannot support claims until readable text is present.'
        : 'Local reading copy saved.';
    }
    if (event.type === 'source-read') {
      return `${event.claimCount} quoted ${event.claimCount === 1 ? 'passage' : 'passages'} recorded from this exact local content hash.`;
    }
    if (event.type === 'quote-added') return 'Source-linked annotation saved locally.';
    if (event.type === 'note-added') {
      return event.quoteSha256
        ? 'Source-linked note saved with an exact quoted passage.'
        : 'Source-linked note saved as learner interpretation, not evidence.';
    }
    if (event.type === 'synthesis-written') return 'Synthesis.md was updated from eligible quotes.';
    if (event.type === 'synthesis-proposed') {
      return 'Learner edits stayed active; the refreshed answer was saved as a proposal.';
    }
    if (event.type === 'export-created') {
      return `${event.format.toUpperCase()} packet and provenance manifest created.`;
    }
    return 'The stored question and provider query were removed from this local ledger.';
  }

  function activityPath(event: ResearchThreadEvent): string | undefined {
    if (event.type === 'source-saved' || event.type === 'source-read') return event.sourcePath;
    if (event.type === 'quote-added' || event.type === 'note-added') return event.notePath;
    if (event.type === 'synthesis-written' || event.type === 'synthesis-proposed') {
      return event.artifactPath;
    }
    return undefined;
  }

  async function exportThread(kind: ExportKind): Promise<void> {
    if (exporting) return;
    exporting = kind;
    exportStatus = '';
    try {
      const bundle = await buildResearchThreadExportBundle(storage, exportInput, kind);
      if (kind === 'markdown') {
        downloadText(
          bundle.content,
          researchThreadFilename(topicSlug, 'md'),
          'text/markdown;charset=utf-8',
        );
        downloadText(
          bundle.manifestJson,
          researchThreadManifestFilename(topicSlug),
          'application/json;charset=utf-8',
        );
        exportStatus = 'Markdown downloaded. Provenance manifest downloaded separately.';
      } else {
        if (kind === 'html') {
          downloadText(
            bundle.content,
            researchThreadFilename(topicSlug, 'html'),
            'text/html;charset=utf-8',
          );
          downloadText(
            bundle.manifestJson,
            researchThreadManifestFilename(topicSlug),
            'application/json;charset=utf-8',
          );
          exportStatus = 'HTML downloaded. Provenance manifest downloaded separately.';
        } else {
          downloadText(
            bundle.manifestJson,
            researchThreadManifestFilename(topicSlug),
            'application/json;charset=utf-8',
          );
          const frame = document.createElement('iframe');
          frame.title = `Print ${topicTitle} research thread`;
          frame.style.position = 'fixed';
          frame.style.inset = '0';
          frame.style.width = '1px';
          frame.style.height = '1px';
          frame.style.opacity = '0';
          frame.style.pointerEvents = 'none';
          frame.setAttribute('aria-hidden', 'true');
          document.body.append(frame);
          await new Promise<void>((resolve) => {
            frame.addEventListener('load', () => resolve(), { once: true });
            frame.srcdoc = bundle.content;
          });
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          window.setTimeout(() => frame.remove(), 30_000);
          exportStatus =
            'Print dialog opened and the provenance manifest downloaded. Choose Save as PDF for a readable derivative; your local workspace remains the complete record.';
        }
      }
      try {
        await recordResearchThreadEvent(
          storage,
          topicSlug,
          { format: kind, manifestSha256: bundle.manifestSha256, type: 'export-created' },
          new Date(bundle.manifest.createdAt),
          threadId,
        );
        onThreadChanged();
      } catch {
        exportStatus += ' The export succeeded, but thread activity could not be updated.';
      }
    } catch (caught) {
      exportStatus =
        caught instanceof Error
          ? `Export failed: ${caught.message}`
          : 'Export failed. Try Markdown or HTML instead.';
    } finally {
      exporting = '';
    }
  }

  async function toggleFollowing(): Promise<void> {
    if (!threadId || !currentThread || managing) return;
    managing = true;
    managementStatus = '';
    try {
      const followed = !currentThread.followedAt;
      await setResearchThreadFollowed(storage, topicSlug, threadId, followed);
      managementStatus = followed
        ? 'Following locally. Future saved activity will appear in Updates without contacting providers.'
        : 'Thread removed from Updates. Research and provider settings were not changed.';
      onThreadChanged();
    } catch (caught) {
      managementStatus =
        caught instanceof Error ? caught.message : 'Follow state could not be updated.';
    } finally {
      managing = false;
    }
  }

  async function redactQuestion(): Promise<void> {
    if (!threadId || !currentThread || currentThread.redactedAt || managing) return;
    if (
      !window.confirm(
        'Remove this question and its provider query from the local research ledger? Saved sources, notes, and Synthesis.md stay in place. Previously exported archives and packets are independent copies and will not be changed.',
      )
    )
      return;
    managing = true;
    managementStatus = '';
    try {
      await redactResearchThread(storage, topicSlug, threadId);
      managementStatus =
        'Question redacted from the local ledger. Saved artifacts and earlier exports remain separate copies.';
      onThreadChanged();
    } catch (caught) {
      managementStatus =
        caught instanceof Error ? caught.message : 'The question was not redacted.';
    } finally {
      managing = false;
    }
  }

  async function deleteThread(): Promise<void> {
    if (!threadId || !currentThread || managing) return;
    if (
      !window.confirm(
        'Delete this thread identity, its lookup runs, and owned activity from the local ledger? Saved sources, notes, and Synthesis.md stay in place. This cannot change previously exported archives or packets.',
      )
    )
      return;
    managing = true;
    managementStatus = '';
    try {
      await deleteResearchThread(storage, topicSlug, threadId);
      managementStatus =
        'Thread ledger deleted. Saved artifacts remain, and a question-free tombstone preserves any retained child link.';
      onThreadChanged();
    } catch (caught) {
      managementStatus = caught instanceof Error ? caught.message : 'The thread was not deleted.';
    } finally {
      managing = false;
    }
  }
</script>

<section bind:this={threadElement} class="research-thread" aria-labelledby="thread-title">
  <header class="thread-header">
    <div>
      <p class="thread-label"><MessageSquareText aria-hidden="true" size={16} /> Research thread</p>
      <h2 id="thread-title" tabindex="-1">One place for the whole investigation.</h2>
      <p>
        Question, lookup receipt, source links, quoted evidence, and the built answer stay together.
      </p>
    </div>
    <div class="thread-facts" aria-label="Research thread summary">
      <span>{sources.length} saved</span>
      <span>{readCount} read</span>
      <span>{claimCount} quotes</span>
    </div>
  </header>

  <div class="thread-toolbar">
    <div class="view-switcher" aria-label="Research result view">
      <button type="button" aria-pressed={view === 'thread'} onclick={() => (view = 'thread')}>
        <MessageSquareText aria-hidden="true" size={15} /> Thread
      </button>
      <button
        type="button"
        aria-pressed={view === 'document'}
        onclick={() => void openFullDocument()}
      >
        <FileText aria-hidden="true" size={15} /> Document
      </button>
    </div>
    <div class="thread-actions">
      {#if currentThread}
        <button type="button" disabled={busy || managing} onclick={() => void toggleFollowing()}>
          {#if currentThread.followedAt}
            <BellOff aria-hidden="true" size={15} /> Unfollow
          {:else}
            <Bell aria-hidden="true" size={15} /> Follow updates
          {/if}
        </button>
      {/if}
      <button type="button" disabled={busy} onclick={onUpdate}>
        <RefreshCw aria-hidden="true" size={15} />
        {busy ? 'Updating…' : 'Update research'}
      </button>
      <details class="export-menu">
        <summary
          ><Download aria-hidden="true" size={15} /> Export <ChevronDown
            aria-hidden="true"
            size={14}
          /></summary
        >
        <div aria-label="Export research thread">
          <button
            type="button"
            disabled={Boolean(exporting)}
            onclick={() => void exportThread('markdown')}
          >
            <FileText aria-hidden="true" size={15} /> Markdown
          </button>
          <button
            type="button"
            disabled={Boolean(exporting)}
            onclick={() => void exportThread('html')}
          >
            <FileCode2 aria-hidden="true" size={15} /> HTML
          </button>
          <button
            type="button"
            disabled={Boolean(exporting)}
            onclick={() => void exportThread('pdf')}
          >
            <Printer aria-hidden="true" size={15} /> Print / PDF
          </button>
          <small>Shareable copies; your local workspace remains the complete record.</small>
        </div>
      </details>
      {#if currentThread}
        <details class="manage-menu">
          <summary
            ><Eraser aria-hidden="true" size={15} /> Privacy <ChevronDown
              aria-hidden="true"
              size={14}
            /></summary
          >
          <div aria-label="Research thread privacy controls">
            <button
              type="button"
              disabled={managing || Boolean(currentThread.redactedAt)}
              onclick={() => void redactQuestion()}
            >
              <Eraser aria-hidden="true" size={15} />
              {currentThread.redactedAt ? 'Question redacted' : 'Redact question'}
            </button>
            <button type="button" disabled={managing} onclick={() => void deleteThread()}>
              <Trash2 aria-hidden="true" size={15} /> Delete thread ledger
            </button>
            <small>Saved sources, notes, the answer, and previous exports remain independent.</small
            >
          </div>
        </details>
      {/if}
    </div>
  </div>
  <p class="export-status" role="status" aria-live="polite">{exportStatus}</p>
  <p class="management-status" role="status" aria-live="polite">{managementStatus}</p>

  {#if view === 'thread'}
    <nav class="thread-index" aria-label="In this thread">
      <strong>In this thread</strong>
      <div>
        <button type="button" onclick={() => void focusThreadTarget('thread-receipt')}
          >Receipt</button
        >
        <button type="button" onclick={() => void focusThreadTarget('thread-sources')}
          >Sources</button
        >
        <button type="button" onclick={() => void focusThreadTarget('thread-answer')}
          >Answer & gaps</button
        >
        <button type="button" onclick={() => void focusThreadTarget('thread-history')}
          >Updates</button
        >
      </div>
    </nav>
  {/if}

  {#if latestUpdateDidNotReplace && latestRun}
    <p class="update-note" role="status">
      The {displayDate(latestRun.at)} update did not replace this completed answer. Its outcome is preserved
      in research history.{nonReplacingProposal
        ? ' A refreshed proposal is waiting in Needs attention because your synthesis has edits.'
        : ''}
    </p>
  {/if}

  {#if view === 'thread'}
    <ol class="message-list" aria-label={`Research thread for ${topicTitle}`}>
      <li class="message" style="--thread-index: 0">
        <span class="message-avatar user" aria-hidden="true"><UserRound size={17} /></span>
        <article>
          <header><strong>You</strong><span>Research question</span></header>
          <p class="question">{answerRun ? researchRunQuestion(answerRun) : topicTitle}</p>
        </article>
      </li>

      <li class="message" style="--thread-index: 1">
        <span class="message-avatar" aria-hidden="true"><SearchCheck size={17} /></span>
        <article id="thread-receipt" tabindex="-1">
          <header>
            <strong>Dusori</strong>
            <span>{answerRun ? displayDate(answerRun.at) : 'Saved research'}</span>
          </header>
          {#if answerRun?.eligibleCount === undefined}
            <p>
              This older lookup did not record its retained-result count. Of {sources.length} saved
              {sources.length === 1 ? 'source' : 'sources'}, {readCount}
              {readCount === 1 ? 'supports' : 'support'}
              {claimCount} quoted {claimCount === 1 ? 'passage' : 'passages'}.
            </p>
          {:else}
            <p>
              This lookup retained {answerRun.eligibleCount} relevant {answerRun.eligibleCount === 1
                ? 'result'
                : 'results'}. Of {sources.length} saved {sources.length === 1
                ? 'source'
                : 'sources'},
              {readCount}
              {readCount === 1 ? 'supports' : 'support'}
              {claimCount} quoted {claimCount === 1 ? 'passage' : 'passages'}.
            </p>
          {/if}
          {#if answerRun?.providers.length}
            <ul class="provider-receipt" aria-label="Provider receipt">
              {#each answerRun.providers as provider (provider.id)}
                <li data-outcome={provider.outcome}>
                  <span aria-hidden="true"></span>
                  <strong>{provider.label}</strong>
                  <small>
                    {provider.outcome === 'found'
                      ? `${provider.count} found`
                      : provider.outcome === 'empty'
                        ? 'No matches'
                        : 'Failed'}
                  </small>
                </li>
              {/each}
            </ul>
          {/if}
        </article>
      </li>

      <li class="message" style="--thread-index: 2">
        <span class="message-avatar" aria-hidden="true"><Library size={17} /></span>
        <article id="thread-sources" tabindex="-1">
          <header><strong>Sources</strong><span>{sources.length} collected</span></header>
          <p class="message-intro">
            Every item keeps its original link and evidence state. References are not counted as
            support until their text has been read.
          </p>
          <ol class="source-replies" aria-label="Collected research sources">
            {#each visibleSources as source (source.sha256)}
              {@const evidenceState = researchSourceState(source)}
              <li>
                <div class="source-mark" data-state={evidenceState.label} aria-hidden="true">
                  {#if evidenceState.claimCount > 0}
                    <Quote size={15} />
                  {:else if source.readState === 'readable'}
                    <FileText size={15} />
                  {:else}
                    <Link2 size={15} />
                  {/if}
                </div>
                <div class="source-copy">
                  <p class="source-meta">
                    <span>{sourceLens(source)}</span>
                    <span>{evidenceState.label}</span>
                    {#if evidenceState.claimCount > 0}<span>{evidenceState.claimCount} quotes</span
                      >{/if}
                  </p>
                  <strong>{source.title}</strong>
                  <small>
                    {source.author ?? source.publisher ?? hostOf(source.url)}{source.publishedAt
                      ? ` · ${source.publishedAt}`
                      : ''}
                  </small>
                  {#if source.whySelected?.length}
                    <p class="source-reason">{source.whySelected.slice(0, 2).join(' · ')}</p>
                  {/if}
                </div>
                <div class="source-links">
                  {#if source.path}
                    <button type="button" onclick={() => onOpenDocument(source.path!)}
                      >Read saved copy</button
                    >
                  {/if}
                  {#if source.url}
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      onclick={(event) => onOpenExternal(event, source.url!)}
                      >Original <ExternalLink aria-hidden="true" size={13} /></a
                    >
                  {/if}
                </div>
              </li>
            {/each}
          </ol>
          {#if sources.length > 5}
            <button
              class="show-sources"
              type="button"
              onclick={() => (showAllSources = !showAllSources)}
            >
              {showAllSources ? 'Show fewer sources' : `Show all ${sources.length} sources`}
            </button>
          {/if}
        </article>
      </li>

      <li class="message synthesis-message" style="--thread-index: 3">
        <span class="message-avatar answer" aria-hidden="true"><BookOpen size={17} /></span>
        <article id="thread-answer" tabindex="-1">
          <header><strong>Built answer</strong><span>{displayDate(generatedAt)}</span></header>
          <!-- svelte-ignore a11y_click_events_have_key_events (delegation only: rendered links retain native keyboard activation) -->
          <!-- svelte-ignore a11y_no_static_element_interactions (the article body delegates link routing only) -->
          <div class="synthesis-body" onclick={followSynthesisLink}>
            <MarkdownView content={answerPreview} />
          </div>
          <p class="evidence-boundary">
            <strong>Evidence boundary.</strong> This preview uses quoted passages from {readCount}
            read {readCount === 1 ? 'source' : 'sources'}. References are not evidence until read;
            Dusori has not judged whether a quoted claim is true.
          </p>
          <button class="open-document" type="button" onclick={() => void openFullDocument()}>
            <FileText aria-hidden="true" size={15} /> Open full document
          </button>
        </article>
      </li>

      <li class="message" style="--thread-index: 4">
        <span class="message-avatar" aria-hidden="true"><CalendarClock size={17} /></span>
        <article id="thread-history" tabindex="-1">
          <header><strong>Keep it current</strong><span>Local setting</span></header>
          <label class="refresh-choice">
            <input
              type="checkbox"
              checked={autoRefreshEnabled}
              disabled={busy}
              onchange={(event) => onToggleAutoRefresh(event.currentTarget.checked)}
            />
            <span>
              <strong>Recheck after seven days</strong>
              <small
                >Uses only providers already allowed on this device. Turn it off at any time.</small
              >
            </span>
          </label>
          <div class="next-actions">
            <button type="button" onclick={onOpenSources}
              ><Library aria-hidden="true" size={15} /> Manage sources</button
            >
            <button type="button" onclick={onOpenMap}
              ><Map aria-hidden="true" size={15} /> Trace connections</button
            >
          </div>
          {#if threadEvents.length > 0}
            <ol class="activity-list" aria-label="Typed thread activity">
              {#each threadEvents as event (event.eventId)}
                {@const path = activityPath(event)}
                <li>
                  <span>{displayDate(event.at)}</span>
                  <div>
                    <strong>{activityLabel(event)}</strong>
                    <p>{activityDetail(event)}</p>
                    {#if path}
                      <button type="button" onclick={() => onOpenDocument(path)}
                        >Open artifact</button
                      >
                    {/if}
                  </div>
                </li>
              {/each}
            </ol>
          {:else if runs.some((run) => !run.threadId)}
            <p class="legacy-activity">
              Earlier research predates stable thread identity. It stays readable below without an
              invented question ID or parent link.
            </p>
          {/if}
          {#if runs.length > 0}
            <details class="trail-details">
              <summary>View research history</summary>
              <ResearchTrail {runs} />
            </details>
          {/if}
        </article>
      </li>
    </ol>
  {:else}
    <section class="document-view" aria-label="Research document">
      <header>
        <div>
          <p>Portable Markdown</p>
          <h3 bind:this={documentHeading} tabindex="-1">Built answer</h3>
        </div>
        <button type="button" onclick={() => onOpenDocument(`Topics/${topicSlug}/Synthesis.md`)}>
          <FileText aria-hidden="true" size={15} /> Open as note
        </button>
      </header>
      <!-- svelte-ignore a11y_click_events_have_key_events (delegation only: rendered links retain native keyboard activation) -->
      <!-- svelte-ignore a11y_no_static_element_interactions (the document delegates link routing only) -->
      <div class="synthesis-body" onclick={followSynthesisLink}>
        <MarkdownView content={synthesisMarkdown} />
      </div>
    </section>
  {/if}
</section>

<style>
  /* Hallmark · genre: atmospheric editorial · macrostructure: provenance-aware research channel · design-system: design.md · designed-as-app
   * states: default · hover · focus · active · disabled · loading · error · success
   * contrast: pass (40–41) · honest: pass (46) · tokens: pass (48) · responsive: pass (34, 49–57) · Safari print: pass · slop test: pass (1–58)
   * pre-emit critique: P5 H5 E4 S5 R5 V5
   */
  .research-thread {
    display: grid;
    gap: var(--space-md);
    min-width: 0;
    margin-block-start: var(--space-xl);
    padding-block-start: var(--space-xl);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .thread-header {
    display: grid;
    gap: var(--space-md);
  }

  .thread-header h2,
  .thread-header p,
  .message p,
  .document-view p,
  .document-view h3,
  .export-status,
  .management-status,
  .update-note {
    margin: 0;
  }

  .thread-index {
    position: sticky;
    z-index: var(--z-base);
    inset-block-start: var(--space-sm);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-xs) var(--space-md);
    padding: var(--space-xs) var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    background: color-mix(in srgb, var(--color-paper) 94%, transparent);
    box-shadow: 0 0.35rem 1rem color-mix(in srgb, var(--color-ink) 8%, transparent);
    backdrop-filter: blur(0.5rem);
  }

  .thread-index > strong {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .thread-index > div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2xs);
  }

  .thread-index button {
    min-height: 2.35rem;
    border-color: transparent;
    color: var(--color-accent-text);
    font-size: var(--text-xs);
  }

  .thread-header h2 {
    max-width: 22ch;
    margin-block-start: var(--space-xs);
    scroll-margin-block-start: var(--space-sm);
    overflow-wrap: anywhere;
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-style: normal;
    letter-spacing: -0.02em;
    line-height: 1.15;
    text-wrap: balance;
  }

  .thread-header > div:first-child > p:last-child {
    max-width: 62ch;
    margin-block-start: var(--space-xs);
    color: var(--color-muted);
  }

  .thread-label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .thread-facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs) var(--space-md);
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .thread-toolbar,
  .thread-actions,
  .view-switcher,
  .next-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    align-items: center;
  }

  .thread-toolbar {
    justify-content: space-between;
    padding-block: var(--space-sm);
    border-block: var(--rule-hair) solid var(--color-rule);
  }

  button,
  summary,
  a {
    font: inherit;
    touch-action: manipulation;
  }

  button,
  .export-menu summary,
  .manage-menu summary,
  .source-links a {
    min-height: 2.75rem;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    white-space: nowrap;
  }

  button,
  .export-menu summary,
  .manage-menu summary,
  .source-links a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    padding-inline: var(--space-sm);
    transition: transform var(--dur-micro) var(--ease-out);
  }

  button:active,
  .export-menu summary:active,
  .manage-menu summary:active,
  .source-links a:active {
    transform: translateY(1px);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .view-switcher {
    padding: var(--space-2xs);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
  }

  .view-switcher button {
    min-height: 2.35rem;
    border-color: transparent;
  }

  .view-switcher button[aria-pressed='true'] {
    border-color: var(--color-ink);
    background: var(--color-ink);
    color: var(--color-paper);
  }

  .export-menu,
  .manage-menu {
    position: relative;
  }

  .export-menu summary,
  .manage-menu summary {
    list-style: none;
  }

  .export-menu summary::-webkit-details-marker,
  .manage-menu summary::-webkit-details-marker {
    display: none;
  }

  .export-menu[open] summary,
  .manage-menu[open] summary {
    background: var(--color-paper-2);
  }

  .export-menu > div,
  .manage-menu > div {
    position: absolute;
    z-index: var(--z-dropdown);
    inset-block-start: calc(100% + var(--space-xs));
    inset-inline-end: 0;
    display: grid;
    min-width: 11.5rem;
    padding: var(--space-xs);
    border: var(--rule-hair) solid var(--color-border);
    background: var(--color-paper);
  }

  .export-menu > div button,
  .manage-menu > div button {
    justify-content: flex-start;
    border-color: transparent;
  }

  .export-menu > div small,
  .manage-menu > div small {
    max-width: 20ch;
    padding: var(--space-xs) var(--space-sm);
    border-top: var(--rule-hair) solid var(--color-rule);
    color: var(--color-muted);
    line-height: 1.35;
  }

  .export-status,
  .management-status {
    min-height: 1.5em;
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .update-note {
    max-width: 68ch;
    padding: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .message-list,
  .source-replies,
  .provider-receipt {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .message-list {
    position: relative;
    display: grid;
    gap: var(--space-lg);
  }

  .message-list::before {
    position: absolute;
    inset-block: 1.45rem;
    inset-inline-start: 1.35rem;
    inline-size: var(--rule-hair);
    background: var(--color-rule);
    content: '';
  }

  .message {
    position: relative;
    display: grid;
    grid-template-columns: 2.75rem minmax(0, 1fr);
    gap: var(--space-sm);
    min-width: 0;
    animation: thread-settle var(--dur-long) var(--ease-out) both;
    animation-delay: calc(var(--thread-index) * 55ms);
  }

  @keyframes thread-settle {
    from {
      transform: translateY(0.4rem);
    }
    to {
      transform: translateY(0);
    }
  }

  .message-avatar {
    position: relative;
    z-index: var(--z-base);
    display: grid;
    inline-size: 2.75rem;
    block-size: 2.75rem;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-paper-2);
    color: var(--color-accent-text);
    place-items: center;
  }

  .message-avatar.user {
    background: var(--color-ink);
    color: var(--color-paper);
  }

  .message-avatar.answer {
    border-color: var(--color-marigold);
    color: var(--color-marigold);
  }

  .message > article {
    min-width: 0;
    scroll-margin-block-start: 5rem;
    padding-block-start: var(--space-2xs);
  }

  .message > article > header {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2xs) var(--space-xs);
    align-items: baseline;
  }

  .message > article > header strong {
    font-family: var(--font-display);
    font-size: var(--text-md);
  }

  .message > article > header span {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .message > article > p,
  .message-intro {
    max-width: 68ch;
    margin-block-start: var(--space-xs);
    color: var(--color-muted);
  }

  .message .question {
    color: var(--color-ink);
    font-family: var(--font-display);
    font-size: var(--text-md);
    line-height: 1.45;
  }

  .provider-receipt {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs) var(--space-sm);
    margin-block-start: var(--space-sm);
  }

  .provider-receipt li {
    display: inline-grid;
    grid-template-columns: auto auto;
    gap: 0 var(--space-xs);
    align-items: center;
    font-size: var(--text-sm);
  }

  .provider-receipt li > span {
    grid-row: 1 / 3;
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-radius: 50%;
    background: var(--color-success);
  }

  .provider-receipt li[data-outcome='empty'] > span {
    background: var(--color-muted);
  }

  .provider-receipt li[data-outcome='failed'] > span {
    background: var(--color-error);
  }

  .provider-receipt small {
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .source-replies {
    display: grid;
    margin-block-start: var(--space-sm);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .source-replies > li {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: var(--space-xs) var(--space-sm);
    padding-block: var(--space-md);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .source-mark {
    display: grid;
    inline-size: 2rem;
    block-size: 2rem;
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: 50%;
    color: var(--color-muted);
    place-items: center;
  }

  .source-mark[data-state='Read evidence'] {
    border-color: var(--color-success);
    color: var(--color-success);
  }

  .source-copy {
    min-width: 0;
  }

  .source-copy > strong {
    display: block;
    overflow-wrap: anywhere;
    font-family: var(--font-display);
  }

  .source-copy > small,
  .source-reason {
    display: block;
    margin-block-start: var(--space-2xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .source-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2xs) var(--space-xs);
    margin-block-end: var(--space-2xs);
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .source-meta span:not(:last-child)::after {
    margin-inline-start: var(--space-xs);
    color: var(--color-rule);
    content: '·';
  }

  .source-links {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }

  .source-links button,
  .source-links a,
  .show-sources,
  .next-actions button {
    min-height: 2.35rem;
    padding-inline: var(--space-sm);
    font-size: var(--text-sm);
  }

  .source-links a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    text-decoration: none;
  }

  .show-sources {
    margin-block-start: var(--space-sm);
    color: var(--color-accent-text);
  }

  .synthesis-message > article {
    padding: var(--space-md);
    border: var(--rule-hair) solid var(--color-border);
    background: var(--color-paper-2);
    color: var(--color-ink);
  }

  .synthesis-body {
    min-width: 0;
    margin-block-start: var(--space-md);
  }

  .synthesis-body :global(h1) {
    margin-block: 0 var(--space-lg);
    overflow-wrap: anywhere;
    font-size: var(--text-xl);
  }

  .synthesis-body :global(h2) {
    margin-block: var(--space-xl) var(--space-sm);
    padding-block-start: var(--space-sm);
    border-block-start: var(--rule-hair) solid var(--color-rule);
    font-size: var(--text-lg);
  }

  .synthesis-body :global(h3) {
    margin-block: var(--space-lg) var(--space-xs);
    font-size: var(--text-md);
  }

  .synthesis-body :global(p),
  .synthesis-body :global(li) {
    max-width: 72ch;
  }

  .synthesis-body :global(a) {
    color: var(--color-accent-text);
  }

  .evidence-boundary {
    max-width: 68ch;
    margin-block-start: var(--space-md) !important;
    padding-block-start: var(--space-sm);
    border-block-start: var(--rule-hair) solid var(--color-rule);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .evidence-boundary strong {
    color: var(--color-ink);
  }

  .open-document {
    margin-block-start: var(--space-sm);
    border-color: var(--color-accent-text);
    color: var(--color-accent-text);
    font-weight: 700;
  }

  .refresh-choice {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-sm);
    align-items: start;
    max-width: 42rem;
    margin-block-start: var(--space-md);
    padding: var(--space-md);
    border: var(--rule-hair) solid var(--color-rule);
    cursor: pointer;
  }

  .refresh-choice input {
    inline-size: 1.2rem;
    block-size: 1.2rem;
    margin-block-start: var(--space-2xs);
    accent-color: var(--color-accent);
  }

  .refresh-choice span {
    display: grid;
    gap: var(--space-2xs);
  }

  .refresh-choice small {
    color: var(--color-muted);
  }

  .next-actions {
    margin-block-start: var(--space-sm);
  }

  .activity-list {
    display: grid;
    gap: 0;
    margin: var(--space-lg) 0 0;
    padding: 0;
    border-block: var(--rule-hair) solid var(--color-rule);
    list-style: none;
  }

  .activity-list > li {
    display: grid;
    grid-template-columns: minmax(7rem, 9rem) minmax(0, 1fr);
    gap: var(--space-sm);
    padding-block: var(--space-sm);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .activity-list > li:last-child {
    border-block-end: 0;
  }

  .activity-list > li > span {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .activity-list > li > div {
    min-width: 0;
  }

  .activity-list p,
  .legacy-activity {
    margin-block-start: var(--space-2xs) !important;
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .activity-list button {
    min-height: 2.35rem;
    margin-block-start: var(--space-xs);
    color: var(--color-accent-text);
    font-size: var(--text-sm);
  }

  .legacy-activity {
    max-width: 64ch;
    margin-block-start: var(--space-md) !important;
  }

  .trail-details {
    margin-block-start: var(--space-md);
    padding-block-start: var(--space-sm);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .trail-details > summary {
    min-height: 2.75rem;
    color: var(--color-accent-text);
    cursor: pointer;
    font-weight: 700;
  }

  .document-view {
    min-width: 0;
    padding: var(--space-lg);
    border: var(--rule-hair) solid var(--color-border);
    background: var(--color-paper-2);
    color: var(--color-ink);
    animation: thread-settle var(--dur-short) var(--ease-out) both;
  }

  .document-view > header {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-md);
    padding-block-end: var(--space-md);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .document-view > header p {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .document-view > header h3 {
    margin-block-start: var(--space-2xs);
    font-family: var(--font-display);
    font-size: var(--text-lg);
  }

  button:focus-visible,
  summary:focus-visible,
  a:focus-visible,
  input:focus-visible,
  #thread-title:focus-visible,
  .message article:focus-visible,
  .document-view > header h3:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  @media (min-width: 40rem) {
    .thread-header {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
    }

    .source-replies > li {
      grid-template-columns: 2rem minmax(0, 1fr) auto;
      align-items: center;
    }

    .source-links {
      grid-column: auto;
      justify-content: end;
    }
  }

  @media (max-width: 39.99rem) {
    .thread-index {
      position: static;
    }

    .thread-index > div {
      width: 100%;
    }

    .thread-index button {
      flex: 1 1 auto;
      padding-inline: var(--space-xs);
    }

    .activity-list > li {
      grid-template-columns: 1fr;
      gap: var(--space-2xs);
    }
  }

  @media (pointer: coarse) {
    button,
    .export-menu summary,
    .source-links a,
    .refresh-choice {
      min-height: 3rem;
    }
  }

  @media (hover: hover) and (pointer: fine) {
    button:hover,
    .export-menu summary:hover,
    .source-links a:hover {
      background: var(--color-paper-2);
    }

    .view-switcher button[aria-pressed='true']:hover {
      background: var(--color-ink);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .message,
    .document-view {
      animation: none;
    }

    button,
    .export-menu summary,
    .source-links a {
      transition-duration: 0.01ms;
    }
  }
</style>
