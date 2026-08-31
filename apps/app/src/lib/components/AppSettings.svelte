<script lang="ts">
  import {
    BookOpen,
    Download,
    HardDrive,
    Palette,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    Upload,
  } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import {
    researchProviderPolicy,
    type AppliedMachineFileRecovery,
    type CompanionAiClient,
    type StorageAdapter,
  } from '@dusori/core';

  import {
    automaticUpdatePreferenceKey,
    readAutomaticDownloadedUpdate,
    resolveUpdatePlatform,
    type AvailableUpdate,
    type UpdatePlatform,
  } from '$lib/app-updates';
  import { readAppearance, setAppearance, type Appearance } from '$lib/appearance';
  import { listConsentDecisions, resetConsent, type StoredConsentDecision } from '$lib/consent';

  import MachineFileRecovery from './MachineFileRecovery.svelte';

  export let storage: StorageAdapter;
  export let storageKind: string;
  export let storageLabel: string;
  export let companionStatus: string;
  export let ai: CompanionAiClient | null = null;
  export let online: boolean;
  export let busy = false;
  export let hasTopic = false;
  export let hasUnsavedWrites = false;
  export let onExportWorkspace: () => void;
  export let onExportTopic: () => void;
  export let onImportWorkspace: (event: Event) => void;
  export let onOpenLegacyLearning: () => void = () => undefined;
  export let providerRecoveryActive = false;
  export let onReturnToResearch: () => void = () => undefined;
  export let onMachineFileRecovered: (
    recovery: AppliedMachineFileRecovery,
  ) => void | Promise<void> = () => undefined;

  let updateStatus = 'Checking update support…';
  let updatePlatform: UpdatePlatform | null = null;
  let availableUpdate: AvailableUpdate | null = null;
  let updateBusy = false;
  let updateDownloaded = false;
  let automaticUpdates = false;
  let appearance: Appearance = 'system';
  let consentDecisions: StoredConsentDecision[] = [];
  let appearanceStatus = '';
  let aiChecking = false;
  let aiProvider = '';
  let aiModel = '';
  let aiStatus: 'configured' | 'model-failed' | 'ready' | '' = '';

  onMount(() => {
    appearance = readAppearance();
    consentDecisions = listConsentDecisions();
    automaticUpdates = localStorage.getItem(automaticUpdatePreferenceKey) === 'true';
    const automaticallyDownloaded = readAutomaticDownloadedUpdate(sessionStorage);
    if (automaticallyDownloaded) {
      availableUpdate = automaticallyDownloaded;
      updateDownloaded = true;
      updateStatus = `Dusori ${automaticallyDownloaded.version ?? 'update'} downloaded after startup and is ready to install.`;
    }
    void prepareUpdates();
    void inspectLocalAi();
  });

  const consentLabels: Record<string, string> = {
    ...researchProviderPolicy.consentLabels,
    'companion-ai': 'AI ranking and synthesis',
  };

  function chooseAppearance(next: Appearance): void {
    appearance = next;
    appearanceStatus = setAppearance(next)
      ? `${next[0]?.toUpperCase()}${next.slice(1)} appearance is active on this device.`
      : 'The appearance changed for this session, but this device could not remember it.';
  }

  function clearProviderDecision(scope: string): void {
    if (!resetConsent(scope)) return;
    consentDecisions = listConsentDecisions();
  }

  async function inspectLocalAi(): Promise<void> {
    aiChecking = true;
    aiProvider = '';
    aiModel = '';
    aiStatus = '';
    try {
      const capability = (await ai?.capabilities())?.[0];
      aiProvider = capability?.id ?? '';
      aiModel = capability?.model ?? '';
      aiStatus = capability?.status ?? (capability ? 'configured' : '');
    } catch {
      aiProvider = '';
      aiModel = '';
      aiStatus = '';
    } finally {
      aiChecking = false;
    }
  }

  async function prepareUpdates(): Promise<void> {
    try {
      updatePlatform = await resolveUpdatePlatform();
      if (updatePlatform.kind === 'browser') {
        updateStatus = 'The hosted app updates when this website is refreshed.';
        return;
      }
      updateStatus = automaticUpdates
        ? 'Automatic checks and downloads are on. Dusori will never install or restart by itself.'
        : 'Automatic checks are off.';
      if (automaticUpdates && !updateDownloaded) await checkForUpdates(true);
    } catch (caught) {
      updateStatus = caught instanceof Error ? caught.message : 'Update support is unavailable.';
    }
  }

  async function checkForUpdates(downloadWhenFound = false): Promise<void> {
    if (!updatePlatform || updatePlatform.kind !== 'desktop') return;
    updateBusy = true;
    updateDownloaded = false;
    updateStatus = 'Checking the signed GitHub release feed…';
    try {
      availableUpdate = await updatePlatform.check();
      if (!availableUpdate.available) {
        updateStatus = `Dusori ${availableUpdate.currentVersion} is up to date.`;
      } else if (downloadWhenFound) {
        await downloadUpdate();
      } else {
        updateStatus = `Dusori ${availableUpdate.version ?? 'update'} is available.`;
      }
    } catch (caught) {
      updateStatus =
        caught instanceof Error ? caught.message : 'Dusori could not check for updates.';
    } finally {
      updateBusy = false;
    }
  }

  async function downloadUpdate(): Promise<void> {
    if (!updatePlatform || updatePlatform.kind !== 'desktop') return;
    updateBusy = true;
    updateStatus = 'Downloading and verifying the update signature…';
    try {
      availableUpdate = await updatePlatform.download();
      updateDownloaded = true;
      updateStatus = `Dusori ${availableUpdate.version ?? 'update'} is ready. It will not install until you choose.`;
    } catch (caught) {
      updateStatus =
        caught instanceof Error ? caught.message : 'The update could not be downloaded.';
    } finally {
      updateBusy = false;
    }
  }

  async function installAndRestart(): Promise<void> {
    if (!updatePlatform || updatePlatform.kind !== 'desktop') return;
    updateBusy = true;
    updateStatus = hasUnsavedWrites
      ? 'Save or resolve current work before installing.'
      : 'Installing the verified update…';
    if (hasUnsavedWrites) {
      updateBusy = false;
      return;
    }
    try {
      await updatePlatform.installAndRestart(false);
    } catch (caught) {
      updateStatus =
        caught instanceof Error ? caught.message : 'The update could not be installed.';
      updateBusy = false;
    }
  }

  async function postponeUpdate(): Promise<void> {
    if (!updatePlatform || updatePlatform.kind !== 'desktop') return;
    await updatePlatform.discard();
    sessionStorage.removeItem('dusori.desktop.update-ready');
    updateDownloaded = false;
    availableUpdate = null;
    updateStatus = 'Update postponed. Check again whenever you are ready.';
  }

  function setAutomaticUpdates(enabled: boolean): void {
    automaticUpdates = enabled;
    localStorage.setItem(automaticUpdatePreferenceKey, String(enabled));
    updateStatus = enabled
      ? 'Automatic checks and downloads are on. Installation and restart always need your click.'
      : 'Automatic checks are off.';
    if (enabled) void checkForUpdates(true);
  }
</script>

<section class="settings-studio" aria-labelledby="settings-title">
  <header>
    <p class="kicker">Your workspace, your rules</p>
    <h1 id="settings-title">Settings</h1>
    <p>Storage, network access, updates, and portable backups live in one predictable place.</p>
  </header>

  <div class="settings-grid">
    <section aria-labelledby="appearance-title">
      <div class="section-heading">
        <Palette aria-hidden="true" size={22} strokeWidth={1.5} />
        <div>
          <h2 id="appearance-title">Appearance</h2>
          <p class="detail">One palette, four reading moods. This choice stays on this device.</p>
        </div>
      </div>
      <div class="appearance-options">
        {#each [{ id: 'system', label: 'System', copy: 'Follow the Mac or browser.' }, { id: 'paper', label: 'Paper', copy: 'Warm daylight archive.' }, { id: 'ink', label: 'Ink', copy: 'Quiet, high-contrast black desk.' }, { id: 'night', label: 'Night', copy: 'Dusori’s original nocturnal brown.' }] as option (option.id)}
          <label class:active={appearance === option.id}>
            <input
              type="radio"
              name="appearance"
              value={option.id}
              checked={appearance === option.id}
              onchange={() => chooseAppearance(option.id as Appearance)}
            />
            <span><strong>{option.label}</strong><small>{option.copy}</small></span>
          </label>
        {/each}
      </div>
      {#if appearanceStatus}<p class="status" aria-live="polite">{appearanceStatus}</p>{/if}
    </section>

    <section aria-labelledby="storage-title">
      <div class="section-heading">
        <HardDrive aria-hidden="true" size={22} strokeWidth={1.5} />
        <div>
          <p class="eyebrow">Storage</p>
          <h2 id="storage-title">
            {storageKind === 'tauri'
              ? 'Desktop workspace'
              : storageKind === 'fsa'
                ? 'Connected folder'
                : 'Private browser workspace'}
          </h2>
        </div>
      </div>
      <p>{storageLabel}</p>
      <p class="detail">
        Dusori writes only inside this workspace. Notes remain Markdown and JSON.
      </p>
      <div class="actions">
        <button disabled={busy} onclick={onExportWorkspace}>
          <Download aria-hidden="true" size={17} /> Export workspace
        </button>
        {#if hasTopic}
          <button disabled={busy} onclick={onExportTopic}>
            <Download aria-hidden="true" size={17} /> Export current topic
          </button>
        {/if}
        <label class="file-action">
          <Upload aria-hidden="true" size={17} /> Import workspace
          <input type="file" accept=".zip,application/zip" onchange={onImportWorkspace} />
        </label>
      </div>
    </section>

    <div class="recovery-slot">
      <MachineFileRecovery {storage} onRecovered={onMachineFileRecovered} />
    </div>

    <section aria-labelledby="privacy-title">
      <div class="section-heading">
        <ShieldCheck aria-hidden="true" size={22} strokeWidth={1.5} />
        <div id="provider-choices-title" tabindex="-1">
          <p class="eyebrow">Privacy</p>
          <h2 id="privacy-title">Network access stays explicit</h2>
        </div>
      </div>
      <dl>
        <div>
          <dt>Connection</dt>
          <dd>{online ? 'Online' : 'Offline · local tools ready'}</dd>
        </div>
        <div>
          <dt>Local companion</dt>
          <dd>{companionStatus}</dd>
        </div>
        <div>
          <dt>Telemetry</dt>
          <dd>None</dd>
        </div>
        <div>
          <dt>AI</dt>
          <dd>Optional</dd>
        </div>
      </dl>
      <p class="detail">
        Source providers ask together before the first request, but every decision is stored and
        reset separately. Local search never sends your question away.
      </p>
      {#if providerRecoveryActive}
        <button class="return-to-research" type="button" onclick={onReturnToResearch}>
          Return to research
        </button>
      {/if}
      {#if consentDecisions.length > 0}
        <ul class="consent-decisions" aria-label="Saved provider decisions">
          {#each consentDecisions as item (item.scope)}
            <li>
              <span>
                <strong>{consentLabels[item.scope] ?? item.scope}</strong>
                <small>{item.decision === 'allowed' ? 'Allowed' : 'Denied'}</small>
              </span>
              <button onclick={() => clearProviderDecision(item.scope)}>Reset choice</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="detail">No provider decision is stored yet.</p>
      {/if}
    </section>

    <section aria-labelledby="learning-title">
      <div class="section-heading">
        <BookOpen aria-hidden="true" size={22} strokeWidth={1.5} />
        <div>
          <h2 id="learning-title">Optional learning tools</h2>
        </div>
      </div>
      <p>
        If you want them, objectives, reviews, roadmaps, insights, and certification outline import
        can turn saved evidence into a study path. None of this is required to research a topic.
      </p>
      {#if hasTopic}
        <div class="actions">
          <button onclick={onOpenLegacyLearning}>Open optional learning tools</button>
        </div>
      {/if}
    </section>

    <section aria-labelledby="local-ai-title">
      <div class="section-heading">
        <Sparkles aria-hidden="true" size={22} strokeWidth={1.5} />
        <div>
          <p class="eyebrow">
            {aiProvider && aiProvider !== 'ollama'
              ? 'Optional hosted synthesis'
              : 'Optional local synthesis'}
          </p>
          <h2 id="local-ai-title">
            {aiProvider && aiProvider !== 'ollama'
              ? 'Use the hosted provider you configured'
              : 'Use a model already on this computer'}
          </h2>
        </div>
      </div>
      {#if aiProvider === 'ollama' && aiStatus === 'ready'}
        <p class="ai-ready"><strong>{aiModel}</strong> passed a local generation check.</p>
        <p class="detail">
          After separate AI consent, Dusori may use it to order search results and write a concise
          overview by selecting quoted passages. Source wording, citations, and the deterministic
          fallback remain intact.
        </p>
      {:else if aiProvider === 'ollama' && aiStatus === 'model-failed'}
        <p>
          <strong>{aiModel}</strong> is installed, but it did not pass a small structured generation check.
          Dusori will keep using its deterministic synthesis.
        </p>
        <p class="detail">
          Update Ollama, re-pull that model, or choose another chat-capable model.
        </p>
      {:else if aiProvider === 'ollama' && aiModel}
        <p>
          <strong>{aiModel}</strong> was detected in Ollama, but has not passed Dusori's generation check.
        </p>
        <p class="detail">
          Update the companion, then check again. Dusori will keep using deterministic synthesis
          until the model is verified.
        </p>
      {:else if aiModel}
        <p><strong>{aiModel}</strong> is configured through hosted provider {aiProvider}.</p>
        <p class="detail">
          This is not a model on this computer. Separate AI consent names the payload scope before
          Dusori sends anything through the companion.
        </p>
      {:else}
        <p>
          No model is active right now. Start Ollama with an installed model, then check again.
          Dusori discovers running local chat models automatically, then performs a small structured
          generation check; no API key or app restart is needed.
        </p>
        <ol class="ai-steps">
          <li>Open Ollama and leave it running.</li>
          <li>If you need one, choose and pull a chat-capable model in Ollama yourself.</li>
          <li>Return here and choose Check AI setup.</li>
        </ol>
      {/if}
      <div class="actions">
        <button disabled={aiChecking || !ai} onclick={() => void inspectLocalAi()}>
          <RefreshCw aria-hidden="true" size={17} />
          {aiChecking ? 'Checking…' : 'Check AI setup'}
        </button>
      </div>
      <p class="detail">
        Dusori never downloads a model, starts Ollama, or sends workspace text to a model without
        your action and consent.
      </p>
    </section>

    <section aria-labelledby="updates-title">
      <div class="section-heading">
        <RefreshCw aria-hidden="true" size={22} strokeWidth={1.5} />
        <div>
          <p class="eyebrow">App updates</p>
          <h2 id="updates-title">Update on your terms</h2>
        </div>
      </div>
      <p>
        {updatePlatform?.kind === 'desktop'
          ? 'Dusori checks signed GitHub releases only when you ask or opt in. A downloaded update never installs or restarts by itself.'
          : 'The browser app updates with the hosted website. Download Dusori for automatic signed GitHub release checks.'}
      </p>
      {#if updatePlatform?.kind === 'desktop'}
        <label class="automatic-update">
          <input
            type="checkbox"
            checked={automaticUpdates}
            onchange={(event) => setAutomaticUpdates(event.currentTarget.checked)}
          />
          <span>
            <strong>Automatically check and download</strong>
            <small>Never install or restart without asking.</small>
          </span>
        </label>
        <div class="actions">
          <button class="update-button" disabled={updateBusy} onclick={() => checkForUpdates()}>
            <RefreshCw aria-hidden="true" size={17} />
            {updateBusy ? 'Working…' : 'Check now'}
          </button>
          {#if availableUpdate?.available && !updateDownloaded}
            <button disabled={updateBusy} onclick={downloadUpdate}>Download update</button>
          {/if}
          {#if updateDownloaded}
            <button disabled={updateBusy} onclick={() => void postponeUpdate()}>Later</button>
            <button
              class="update-button"
              disabled={updateBusy || hasUnsavedWrites}
              onclick={installAndRestart}>Install and restart</button
            >
          {/if}
        </div>
      {/if}
      <p class="status" aria-live="polite">{updateStatus}</p>
      {#if availableUpdate?.body && availableUpdate.available}
        <details>
          <summary>What changed in {availableUpdate.version}</summary>
          <p class="release-notes">{availableUpdate.body}</p>
        </details>
      {/if}
    </section>
  </div>
</section>

<style>
  .settings-studio {
    width: min(100%, 64rem);
    margin-inline: auto;
    padding: var(--space-2xl) var(--page-gutter) var(--space-3xl);
  }

  header {
    padding-block-end: var(--space-xl);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  header h1 {
    max-width: 12ch;
    margin-block-start: var(--space-xs);
    font-size: clamp(2.5rem, 7vw, 4.75rem);
  }

  header > p:last-child {
    max-width: 58ch;
    margin-block-start: var(--space-md);
    color: var(--color-muted);
    font-size: var(--text-md);
  }

  .kicker,
  .eyebrow {
    margin: 0;
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .settings-grid {
    display: grid;
    margin-block-start: var(--space-xl);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .settings-grid > section {
    padding-block: var(--space-xl);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .recovery-slot {
    padding-block: var(--space-xl);
    border-block-end: var(--rule-hair) solid var(--color-rule);
    grid-column: 1 / -1;
  }

  .section-heading {
    display: flex;
    align-items: start;
    gap: var(--space-sm);
  }

  h2 {
    margin-block-start: var(--space-2xs);
    font-size: var(--text-lg);
  }

  p {
    max-width: 62ch;
  }

  .detail,
  .status {
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .ai-ready {
    margin-block-end: var(--space-xs);
    color: var(--color-accent-text);
  }

  .ai-steps {
    display: grid;
    gap: var(--space-xs);
    max-width: 62ch;
    padding-inline-start: 1.25rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin-block-start: var(--space-md);
  }

  button,
  .file-action {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    gap: var(--space-xs);
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    font: inherit;
  }

  .file-action {
    position: relative;
  }

  .file-action input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .file-action:focus-within {
    outline: 2px solid var(--color-focus);
    outline-offset: 3px;
  }

  .update-button {
    border-color: var(--color-ink);
    background: var(--color-ink);
    color: var(--color-paper);
  }

  .automatic-update {
    display: grid;
    align-items: start;
    gap: var(--space-sm);
    margin-block: var(--space-md);
    grid-template-columns: auto minmax(0, 1fr);
  }

  .automatic-update input {
    width: 1.1rem;
    height: 1.1rem;
    margin-block-start: 0.25rem;
    accent-color: var(--color-accent);
  }

  .automatic-update span,
  .automatic-update small {
    display: block;
  }

  .automatic-update small,
  .release-notes {
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  dl {
    display: grid;
    margin: var(--space-md) 0 0;
  }

  dl div {
    display: grid;
    min-height: 2.75rem;
    align-items: center;
    gap: var(--space-md);
    border-block-start: var(--rule-hair) solid var(--color-rule);
    grid-template-columns: minmax(7rem, 0.7fr) minmax(0, 1.3fr);
  }

  dt {
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .appearance-options {
    display: grid;
    gap: var(--space-xs);
    margin-block-start: var(--space-md);
  }

  .appearance-options label {
    display: grid;
    min-height: 3.25rem;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    grid-template-columns: auto minmax(0, 1fr);
  }

  .appearance-options label.active {
    border-color: var(--color-accent-text);
    background: var(--color-paper-2);
    color: var(--color-ink);
  }

  .appearance-options input {
    inline-size: 1.2rem;
    block-size: 1.2rem;
    accent-color: var(--color-accent);
  }

  .appearance-options span,
  .appearance-options small {
    display: block;
  }

  .appearance-options small {
    color: var(--color-muted);
  }

  .consent-decisions {
    display: grid;
    gap: 0;
    margin: var(--space-md) 0 0;
    padding: 0;
    border-block-start: var(--rule-hair) solid var(--color-rule);
    list-style: none;
  }

  .return-to-research {
    margin-block-start: var(--space-sm);
    border-color: var(--color-accent-text);
    color: var(--color-accent-text);
    font-weight: 700;
  }

  #provider-choices-title:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 4px;
  }

  .consent-decisions li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-xs);
    padding-block: var(--space-xs);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .consent-decisions span,
  .consent-decisions small {
    display: block;
  }

  .consent-decisions small {
    color: var(--color-muted);
    font-size: var(--text-xs);
    text-transform: capitalize;
  }

  button:focus-visible,
  .appearance-options input:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  @media (min-width: 52rem) {
    .settings-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .settings-grid > section {
      padding-inline: var(--space-xl);
    }

    .settings-grid > section:nth-child(odd) {
      padding-inline-start: 0;
      border-inline-end: var(--rule-hair) solid var(--color-rule);
    }
  }
</style>
