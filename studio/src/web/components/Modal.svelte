<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    open = false,
    title = '',
    wide = false,
    onClose,
    children,
    actions,
  }: {
    open?: boolean;
    title?: string;
    wide?: boolean;
    onClose?: () => void;
    children?: Snippet;
    actions?: Snippet;
  } = $props();

  function close(): void {
    if (!open) return;
    onClose?.();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) close();
    }}
  >
    <div class="modal" class:modal--wide={wide} role="dialog" aria-modal="true" aria-label={title}>
      <header class="modal__head">
        <h2 class="modal__title">{title}</h2>
        <button type="button" class="btn btn--ghost btn--icon" aria-label="Close" onclick={close}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </header>
      <div class="modal__body">
        {@render children?.()}
      </div>
      {#if actions}
        <footer class="modal__foot">
          {@render actions()}
        </footer>
      {/if}
    </div>
  </div>
{/if}
