<script lang="ts">
  import { onDestroy } from 'svelte';

  import type { CompanionResearchClient } from '@dusori/core';

  export let videoId: string;
  export let title: string;
  export let companion: CompanionResearchClient;

  let source = '';

  // The companion fetches the image and the app renders it from an object URL, so the browser
  // never contacts a Google host and the app's img-src needs no new remote origin.
  $: void load(videoId);

  async function load(id: string): Promise<void> {
    release();
    if (!id) return;
    try {
      source = URL.createObjectURL(await companion.fetchYouTubeThumbnail(id));
    } catch {
      source = '';
    }
  }

  function release(): void {
    if (source) URL.revokeObjectURL(source);
    source = '';
  }

  onDestroy(release);
</script>

{#if source}
  <img class="video-thumbnail" src={source} alt={`Thumbnail for ${title}`} loading="lazy" />
{/if}

<style>
  .video-thumbnail {
    display: block;
    width: 100%;
    max-width: 16rem;
    aspect-ratio: 16 / 9;
    border: var(--rule-hair) solid var(--color-rule);
    object-fit: cover;
  }
</style>
