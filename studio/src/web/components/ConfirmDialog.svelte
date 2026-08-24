<script module lang="ts">
  export interface ConfirmOptions {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
  }

  type Ask = (options: ConfirmOptions) => Promise<boolean>;

  let ask: Ask | null = null;

  export function confirm(options: ConfirmOptions): Promise<boolean> {
    if (!ask) return Promise.resolve(false);
    return ask(options);
  }
</script>

<script lang="ts">
  import Modal from './Modal.svelte';

  let open = $state(false);
  let options = $state<ConfirmOptions>({ title: '', message: '' });
  let resolver: ((value: boolean) => void) | null = null;

  ask = (opts: ConfirmOptions) => {
    options = opts;
    open = true;
    return new Promise<boolean>((resolve) => {
      resolver = resolve;
    });
  };

  function answer(value: boolean): void {
    open = false;
    resolver?.(value);
    resolver = null;
  }
</script>

<Modal {open} title={options.title} onClose={() => answer(false)}>
  <p class="confirm__message">{options.message}</p>
  {#snippet actions()}
    <button type="button" class="btn btn--ghost" onclick={() => answer(false)}>Cancel</button>
    <button
      type="button"
      class="btn {options.danger === false ? 'btn--primary' : 'btn--danger'}"
      onclick={() => answer(true)}
    >
      {options.confirmLabel ?? 'Confirm'}
    </button>
  {/snippet}
</Modal>
