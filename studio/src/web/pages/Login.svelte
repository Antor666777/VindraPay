<script lang="ts">
  import { api } from '../lib/api';
  import { pushToast, session, unlockSession } from '../lib/stores.svelte';
  import { errMessage, focusOnMount } from '../lib/format';

  let password = $state('');
  let busy = $state(false);
  let error = $state('');

  async function submit(): Promise<void> {
    if (!password || busy) return;
    busy = true;
    error = '';
    try {
      await api.login(password);
      unlockSession();
      pushToast('success', 'Session unlocked');
      password = '';
    } catch (err) {
      const status = (err as { status?: number }).status;
      error =
        status === 401
          ? 'Invalid password.'
          : status === 429
            ? 'Too many attempts — wait a few minutes and retry.'
            : errMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="login-screen">
  <div class="login-card">
    <div class="login-card__brand">
      <span class="sidebar__logo" style="width:44px;height:44px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
      </span>
      <h1>VindraPay Studio</h1>
      <p class="hint">This console is protected. Enter the studio password to continue.</p>
    </div>

    <form onsubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div class="field" style="margin-bottom:12px;">
        <label for="login-password">Password</label>
        <input
          id="login-password"
          class="input"
          type="password"
          use:focusOnMount
          maxlength={256}
          autocomplete="current-password"
          bind:value={password}
        />
      </div>
      {#if error}
        <div class="login-error" style="margin-bottom:12px;">{error}</div>
      {/if}
      <button type="submit" class="btn btn--primary" style="width:100%;" disabled={!password || busy}>
        {#if busy}<Spinner size={13} />{:else}Unlock{/if}
      </button>
    </form>

    <p class="hint">
      {#if session.meta}
        studio v{session.meta.version}
      {:else}
        VindraPay Studio
      {/if}
    </p>
  </div>
</div>
