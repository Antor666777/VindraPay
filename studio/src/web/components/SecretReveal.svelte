<script lang="ts">
  import { copyText, focusOnMount } from '../lib/format';
  import { pushToast } from '../lib/stores.svelte';

  let {
    token,
    kindLabel = 'Token',
    onDone,
  }: {
    token: string;
    kindLabel?: string;
    onDone?: () => void;
  } = $props();

  let saved = $state(false);
  let copied = $state(false);

  async function copy(): Promise<void> {
    const ok = await copyText(token);
    copied = ok;
    if (ok) {
      pushToast('success', `${kindLabel} copied to clipboard`);
    } else {
      pushToast('error', 'Copy failed — select the text manually');
    }
  }
</script>

<div class="secret">
  <div class="secret__warn">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>
    <span>This {kindLabel.toLowerCase()} is shown only once. Store it somewhere safe — it cannot be recovered.</span>
  </div>
  <code class="secret__token mono" use:focusOnMount>{token}</code>
  <div class="secret__row">
    <label class="secret__save">
      <input type="checkbox" bind:checked={saved} />
      I saved it
    </label>
    <div style="display:flex; gap:8px;">
      <button type="button" class="btn btn--small" onclick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button type="button" class="btn btn--primary btn--small" disabled={!saved} onclick={onDone}>
        Done
      </button>
    </div>
  </div>
</div>
