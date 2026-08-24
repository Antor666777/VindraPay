<script lang="ts">
  import { api, backendHealth, type Features } from '../lib/api';
  import { auth, backend, session } from '../lib/stores.svelte';
  import { fmtDate } from '../lib/format';
  import StatusBadge from '../components/StatusBadge.svelte';

  let checking = $state(false);
  let features = $state<Features | null>(null);

  async function recheck(): Promise<void> {
    checking = true;
    await backendHealth();
    checking = false;
  }

  async function loadFeatures(): Promise<void> {
    try {
      features = await api.getFeatures();
    } catch {
      features = null;
    }
  }

  $effect(() => {
    void loadFeatures();
  });

  const dbValue = $derived(session.health?.db ?? null);
</script>

<div class="page-head">
  <div>
    <h1>Settings</h1>
    <p class="sub">Read-only deployment information</p>
  </div>
</div>

<div class="panel">
  <div class="panel__head"><span class="panel__title">Studio</span></div>
  <div class="panel__body">
    <dl class="kv">
      <dt>Studio version</dt>
      <dd class="mono">{session.meta?.version ?? '—'}</dd>
      <dt>Password gate</dt>
      <dd><StatusBadge value={auth.mode === 'locked' ? 'active' : 'pending'} /></dd>
      <dt>Session</dt>
      <dd>{auth.unlocked ? 'Unlocked' : 'Locked'}</dd>
    </dl>
  </div>
</div>

<div class="panel">
  <div class="panel__head"><span class="panel__title">Backend</span></div>
  <div class="panel__body">
    <dl class="kv">
      <dt>Backend URL</dt>
      <dd class="mono">{session.meta?.backendUrl ?? '—'}</dd>
      <dt>Management API key</dt>
      <dd class="mono">{session.meta?.authenticated ? '•••••••• configured' : 'not configured'}</dd>
      <dt>Database</dt>
      <dd><StatusBadge value={dbValue} dot /></dd>
      <dt>Last health check</dt>
      <dd>{fmtDate(session.refreshedAt)}</dd>
      <dt>Script engine</dt>
      <dd class="mono">{features?.script_timeout_ms ?? '—'} ms · unsafe {features?.allow_unsafe_scripts ? 'unlocked' : 'locked'}</dd>
    </dl>
    <div style="margin-top:14px; display:flex; gap:10px; align-items:center;">
      <button type="button" class="btn btn--small" disabled={checking} onclick={recheck}>
        Re-check health
      </button>
      {#if backend.online === false}
        <span style="color:var(--danger);font-size:12px;">Backend currently unreachable.</span>
      {/if}
    </div>
  </div>
</div>

<div class="panel">
  <div class="panel__head"><span class="panel__title">Documentation</span></div>
  <div class="panel__body" style="font-size:12.5px; color:var(--text-muted);">
    The Management API proxied here mirrors <code class="mono">/manage/v1</code> on the Go backend.
    Endpoint reference lives in the repository under <code class="mono">backend/docs</code> and
    <code class="mono">docs/</code>. Device and orders API docs ship with the SDK sources in
    <code class="mono">sdk/</code>.
  </div>
</div>
