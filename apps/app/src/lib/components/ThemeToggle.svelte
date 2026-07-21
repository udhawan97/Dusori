<script lang="ts">
  import { Moon, Sun } from '@lucide/svelte';
  import { onMount } from 'svelte';

  type Theme = 'dark' | 'light';
  type State = 'idle' | 'loading' | 'error' | 'success';

  export let disabled = false;
  export let state: State = 'idle';

  let theme: Theme = 'dark';

  onMount(() => {
    theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  });

  function switchTheme(): void {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('dusori-theme', theme);
  }
</script>

<button
  class="theme-toggle"
  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
  aria-pressed={theme === 'light'}
  aria-busy={state === 'loading'}
  data-state={state}
  disabled={disabled || state === 'loading'}
  onclick={switchTheme}
>
  {#if theme === 'dark'}
    <Sun aria-hidden="true" size={18} strokeWidth={1.5} />
  {:else}
    <Moon aria-hidden="true" size={18} strokeWidth={1.5} />
  {/if}
</button>

<style>
  /* Hallmark · component: theme toggle · genre: atmospheric editorial · theme: design.md
   * states: default · hover · focus · active · disabled · loading · error · success
   * contrast: pass · pre-emit critique: P5 H5 E5 S5 R5 V5
   */
  .theme-toggle {
    display: grid;
    inline-size: 2.75rem;
    min-block-size: 2.75rem;
    padding: 0;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    outline: 2px solid transparent;
    outline-offset: 1px;
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    place-items: center;
  }

  .theme-toggle:focus-visible {
    outline-color: var(--color-focus);
  }

  .theme-toggle:active {
    transform: translateY(1px);
  }

  .theme-toggle:disabled,
  .theme-toggle[aria-busy='true'] {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .theme-toggle[data-state='error'] {
    border-color: var(--color-error);
    color: var(--color-error);
  }

  .theme-toggle[data-state='success'] {
    border-color: var(--color-success);
    color: var(--color-success);
  }

  @media (hover: hover) and (pointer: fine) {
    .theme-toggle:hover {
      background: var(--color-paper-2);
      color: var(--color-accent-text);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .theme-toggle:active {
      transform: none;
    }
  }
</style>
