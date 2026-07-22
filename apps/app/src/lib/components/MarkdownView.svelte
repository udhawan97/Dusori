<script lang="ts">
  import { renderMarkdown } from '../markdown';
  import MermaidFrame from './MermaidFrame.svelte';

  let { content }: { content: string } = $props();
  let html = $state('');
  let diagrams = $state<string[]>([]);

  $effect(() => {
    void renderMarkdown(content).then((rendered) => {
      html = rendered.html;
      diagrams = rendered.mermaid;
    });
  });
</script>

<article class="markdown">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- Sanitized by rehype-sanitize. -->
  {@html html}
  {#each diagrams as diagram (diagram)}
    <MermaidFrame source={diagram} />
  {/each}
</article>

<style>
  .markdown :global(h1) {
    max-width: 18ch;
    font-size: clamp(2.25rem, 5vw, 4.5rem);
  }

  .markdown :global(h2) {
    margin-block-start: var(--space-2xl);
    font-size: var(--text-lg);
  }

  .markdown :global(p),
  .markdown :global(li) {
    font-size: clamp(1rem, 0.96rem + 0.18vw, 1.125rem);
  }

  .markdown :global(a) {
    color: var(--color-accent-text);
    text-decoration-thickness: 1px;
    text-underline-offset: 0.22em;
  }

  .markdown :global(hr) {
    border: 0;
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .markdown :global(pre) {
    overflow: auto;
    padding: var(--space-md);
    border: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
  }

  .markdown :global(pre:focus-visible) {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
  }
</style>
