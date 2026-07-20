<script lang="ts">
  import { onMount } from 'svelte';

  let { source }: { source: string } = $props();
  let sourceDocument = $state('');
  let error = $state('');

  onMount(async () => {
    try {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
      const identifier = `dusori-diagram-${crypto.randomUUID()}`;
      const rendered = await mermaid.render(identifier, source);
      sourceDocument = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;min-height:100%;background:#f7f1e8}body{display:grid;min-height:13rem;overflow:hidden;place-items:center}svg{display:block;width:100%!important;max-width:100%!important;height:auto!important;max-height:12rem;margin:auto}</style></head><body>${rendered.svg}</body></html>`;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The diagram could not be rendered.';
    }
  });
</script>

{#if error}
  <div class="diagram-error" role="status">Diagram unavailable: {error}</div>
{:else if sourceDocument}
  <iframe title="Learning flow diagram" sandbox="" srcdoc={sourceDocument}></iframe>
{:else}
  <div class="diagram-loading" aria-live="polite">Rendering diagram…</div>
{/if}

<style>
  iframe,
  .diagram-error,
  .diagram-loading {
    width: 100%;
    min-height: 13rem;
    border: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper);
  }

  .diagram-error,
  .diagram-loading {
    display: grid;
    place-items: center;
    padding: var(--space-lg);
    color: var(--color-muted);
  }
</style>
