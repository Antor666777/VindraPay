<script module lang="ts">
  import { api, type Features } from '../lib/api';

  let scriptFeatures = $state<Features | null>(null);
  let scriptFeaturesLoaded = false;

  async function ensureScriptFeatures(): Promise<void> {
    if (scriptFeaturesLoaded) return;
    scriptFeaturesLoaded = true;
    try {
      scriptFeatures = await api.getFeatures();
    } catch {
      scriptFeatures = null;
    }
  }
</script>

<script lang="ts">
  import {
    type Direction,
    type MatchMode,
    type Provider,
    type TestResult,
  } from '../lib/api';
  import { pushToast } from '../lib/stores.svelte';
  import { errMessage, fmtDate, focusOnMount } from '../lib/format';
  import Modal from '../components/Modal.svelte';
  import Pagination from '../components/Pagination.svelte';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Spinner from '../components/Spinner.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import { confirm } from '../components/ConfirmDialog.svelte';

  const LIMIT = 20;

  let providers: Provider[] = $state([]);
  let total = $state(0);
  let loading = $state(true);
  let offset = $state(0);

  let modalOpen = $state(false);
  let editing = $state<Provider | null>(null);
  let saving = $state(false);

  let formName = $state('');
  let formSender = $state('');
  let formPriority = $state<number>(100);
  let formDirection = $state<Direction>('credit');
  let formMode = $state<MatchMode>('template');
  let formTemplate = $state('');
  let formScript = $state('');
  let scriptOpen = $state(false);
  let snippetChoice = $state('');
  let businesses: { id: string; name: string }[] = $state([]);
  let formBusinessId = $state('');

  const SCRIPT_SNIPPETS: { label: string; code: string }[] = [
    {
      label: 'Fee subtraction',
      code: `return {\n  amount: amount - 15,\n  meta: { net_reason: 'flat_fee' }\n};`,
    },
    {
      label: 'Percent commission',
      code: `return {\n  amount: round(amount * 0.985, 2),\n  meta: { gross: fixed(amount) }\n};`,
    },
    {
      label: 'MSISDN normalise',
      code: `return {\n  sender: sender.replace('+88', '0'),\n  meta: { original: sender }\n};`,
    },
    {
      label: 'Dust filter',
      code: `if (amount < 10) reject('dust transaction');\nreturn {};`,
    },
  ];

  let testerBody = $state('');
  let testerBusy = $state(false);
  let testerResult = $state<TestResult | null>(null);
  let testerError = $state('');

  const pageItems = $derived(providers.slice(offset, offset + LIMIT));

  $effect(() => {
    void load();
  });

  async function load(): Promise<void> {
    loading = true;
    try {
      const result = await api.listProviders();
      providers = result.items;
      total = result.total;
      offset = Math.min(offset, Math.max(0, total - LIMIT));
      if (total === 0) offset = 0;
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    } finally {
      loading = false;
    }
    try {
      businesses = (await api.listBusinesses({ limit: 100 })).items;
    } catch {
      businesses = [];
    }
  }

  function openCreate(): void {
    editing = null;
    formName = '';
    formSender = '';
    formPriority = 100;
    formDirection = 'credit';
    formMode = 'template';
    formTemplate = '';
    formScript = '';
    scriptOpen = false;
    snippetChoice = '';
    formBusinessId = '';
    resetTester();
    modalOpen = true;
  }

  function openEdit(provider: Provider): void {
    editing = provider;
    formName = provider.name;
    formSender = provider.sender_id ?? '';
    formPriority = provider.priority;
    formDirection = provider.direction;
    formMode = provider.match_mode;
    formTemplate = provider.sms_template;
    formScript = provider.script ?? '';
    scriptOpen = formScript.length > 0;
    snippetChoice = '';
    formBusinessId = provider.business_id ?? '';
    resetTester();
    modalOpen = true;
  }

  function applySnippet(): void {
    const snippet = SCRIPT_SNIPPETS.find((item) => item.label === snippetChoice);
    snippetChoice = '';
    if (!snippet) return;
    scriptOpen = true;
    if (formScript.trim().length > 0 && !window.confirm('Replace current script?')) return;
    formScript = snippet.code;
  }

  function resetTester(): void {
    testerBody = '';
    testerResult = null;
    testerError = '';
  }

  async function runTest(): Promise<void> {
    if (!formTemplate.trim() || !testerBody.trim()) return;
    testerBusy = true;
    testerError = '';
    testerResult = null;
    try {
      testerResult = await api.testProviderTemplate({
        sms_template: formTemplate,
        sample_body: testerBody,
        match_mode: formMode,
        script: formScript || undefined,
      });
    } catch (error) {
      if ((error as { status?: number }).status !== 401) {
        testerError = errMessage(error);
      }
    } finally {
      testerBusy = false;
    }
  }

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    try {
      if (editing) {
        await api.updateProviderTemplate(editing.id, {
          sms_template: formTemplate,
          script: formScript,
          direction: formDirection,
          match_mode: formMode,
        });
        pushToast('success', `Template for "${editing.name}" updated`);
      } else {
        await api.createProvider({
          business_id: formBusinessId || undefined,
          name: formName.trim(),
          sender_id: formSender.trim() || undefined,
          sms_template: formTemplate,
          script: formScript || undefined,
          priority: Number.isFinite(formPriority) ? formPriority : undefined,
          direction: formDirection,
          match_mode: formMode,
        });
        pushToast('success', `Provider "${formName.trim()}" created`);
      }
      modalOpen = false;
      offset = 0;
      await load();
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    } finally {
      saving = false;
    }
  }

  const canSave = $derived(
    formTemplate.trim().length > 0 && (editing !== null || formName.trim().length > 0),
  );

  async function deactivate(provider: Provider): Promise<void> {
    const ok = await confirm({
      title: 'Deactivate provider',
      message: `Deactivate "${provider.name}"? It will no longer match incoming SMS. Historic data is preserved.`,
      confirmLabel: 'Deactivate',
    });
    if (!ok) return;
    try {
      await api.deleteProvider(provider.id);
      pushToast('success', `Provider "${provider.name}" deactivated`);
      await load();
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    }
  }

  const fieldRows = $derived.by(() => {
    if (!testerResult?.fields) return [];
    const fields = testerResult.fields;
    return [
      { key: 'amount', label: 'Amount' },
      { key: 'sender', label: 'Sender' },
      { key: 'trx_id', label: 'Trx ID' },
      { key: 'balance', label: 'Balance' },
    ].map((row) => ({ ...row, value: fields[row.key as keyof typeof fields] ?? null }));
  });

  const transformRows = $derived.by(() => {
    const transformed = testerResult?.transformed;
    if (!transformed) return [];
    const rows: { key: string; label: string; value: string }[] = [];
    for (const [key, label] of [
      ['amount', 'Amount'],
      ['sender', 'Sender'],
      ['balance', 'Balance'],
      ['trx_id', 'Trx ID'],
    ] as const) {
      const value = transformed[key];
      if (typeof value === 'string') rows.push({ key, label, value });
    }
    if (transformed.meta) {
      for (const [key, value] of Object.entries(transformed.meta)) {
        rows.push({ key: `meta.${key}`, label: `meta.${key}`, value: String(value) });
      }
    }
    return rows;
  });

  $effect(() => {
    void ensureScriptFeatures();
  });
</script>

<div class="page-head">
  <div>
    <h1>SMS Providers</h1>
    <p class="sub">Templates and regex rules used to parse provider SMS into transactions</p>
  </div>
  <button type="button" class="btn btn--primary" onclick={openCreate}>New provider</button>
</div>

<div class="panel">
  {#if loading && providers.length === 0}
    <div class="skeleton skeleton--row"></div>
    <div class="skeleton skeleton--row"></div>
    <div class="skeleton skeleton--row"></div>
  {:else if providers.length === 0}
    <EmptyState title="No providers yet" hint="Create a template or regex rule so ingested SMS can be matched to transactions." />
  {:else}
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Scope</th>
            <th>Sender</th>
            <th>Direction</th>
            <th>Mode</th>
            <th class="th-right">Priority</th>
            <th>Status</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody class:dim={loading}>
          {#each pageItems as provider (provider.id)}
            <tr>
              <td><span class="cell-main">{provider.name}</span></td>
              <td style="white-space:normal;">
                {#if provider.business_id === null}
                  <span class="badge badge--muted">global builtin</span>
                {:else}
                  {provider.business_name ?? provider.business_id.slice(0, 8)}
                {/if}
              </td>
              <td class="mono">{provider.sender_id ?? '—'}</td>
              <td><StatusBadge value={provider.direction} /></td>
              <td><StatusBadge value={provider.match_mode} /></td>
              <td class="num">{provider.priority}</td>
              <td>
                <span class="dot" class:dot--online={provider.is_active} title={provider.is_active ? 'Active' : 'Inactive'}></span>
              </td>
              <td>{fmtDate(provider.created_at)}</td>
              <td class="td-right" style="white-space:nowrap;">
                <button type="button" class="btn btn--small" onclick={() => openEdit(provider)}>Edit</button>
                {#if provider.is_active}
                  <button type="button" class="btn btn--danger btn--small" style="margin-left:6px;" onclick={() => deactivate(provider)}>
                    Deactivate
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pagination {total} limit={LIMIT} {offset} onPage={(value) => (offset = value)} />
  {/if}
</div>

<Modal open={modalOpen} title={editing ? `Edit ${editing.name}` : 'New provider'} wide onClose={() => (modalOpen = false)}>
  <div class="form-grid">
    <div class="field">
      <label for="p-business">Business scope</label>
      <select id="p-business" class="select" bind:value={formBusinessId} disabled={editing !== null}>
        <option value="">Global — visible to every business</option>
        {#each businesses as b (b.id)}
          <option value={b.id}>{b.name}</option>
        {/each}
      </select>
      {#if editing !== null}
        <span style="font-size:11px;color:var(--text-muted);">Scope cannot change after creation</span>
      {/if}
    </div>
    <div class="field">
      <label for="p-name">Name</label>
      <input id="p-name" class="input" use:focusOnMount maxlength={100} bind:value={formName} disabled={editing !== null} placeholder="MTN MoMo" />
    </div>
    <div class="field">
      <label for="p-sender">Sender ID</label>
      <input id="p-sender" class="input mono" maxlength={32} bind:value={formSender} disabled={editing !== null} placeholder="MOMO" />
    </div>
    <div class="field">
      <label for="p-priority">Priority (0–10000)</label>
      <input id="p-priority" class="input" type="number" min={0} max={10000} bind:value={formPriority} disabled={editing !== null} />
    </div>
    <div class="field">
      <label for="p-direction">Direction</label>
      <select id="p-direction" class="select" bind:value={formDirection}>
        <option value="credit">credit</option>
        <option value="debit">debit</option>
      </select>
    </div>
    <div class="field full">
      <span class="field-label" id="p-mode-label">Match mode</span>
      <div class="radio-row" role="radiogroup" aria-labelledby="p-mode-label">
        <label><input type="radio" bind:group={formMode} value="template" />template</label>
        <label><input type="radio" bind:group={formMode} value="regex" />regex</label>
      </div>
    </div>
    <div class="field full">
      <label for="p-template">SMS template ({formMode === 'regex' ? 'regular expression' : '{placeholders} syntax'}) · max 1024</label>
      <textarea
        id="p-template"
        class="textarea"
        rows={3}
        maxlength={1024}
        bind:value={formTemplate}
        placeholder="{formMode === 'regex' ? '^You have received .* (?P<trx_id>\\d{10}).*Amount: (?P<amount>[\\d,.]+)' : 'You have received {amount} RWF from {sender}. TrxID {trx_id}. Balance {balance}'}"
      ></textarea>
    </div>
    <div class="field full script-section">
      <button type="button" class="script-head" aria-expanded={scriptOpen} onclick={() => (scriptOpen = !scriptOpen)}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="script-chevron"
          class:open={scriptOpen}
        ><path d="m9 18 6-6-6-6" /></svg>
        <span>Custom logic (JavaScript)</span>
        {#if formScript.trim().length > 0}
          <span class="badge badge--accent">active</span>
        {/if}
      </button>
      {#if scriptOpen}
        <div class="script-body">
          <div class="field">
            <label for="p-script-snippet">Insert example</label>
            <select id="p-script-snippet" class="select" bind:value={snippetChoice} onchange={applySnippet}>
              <option value="">Choose an example…</option>
              {#each SCRIPT_SNIPPETS as snippet (snippet.label)}
                <option value={snippet.label}>{snippet.label}</option>
              {/each}
            </select>
          </div>
          <textarea
            id="p-script"
            class="textarea mono"
            rows={8}
            maxlength={4096}
            bind:value={formScript}
            placeholder={'return { amount: amount - 15 };'}
          ></textarea>
          <p class="script-foot">
            {#if scriptFeatures}
              trxId / balance overrides are {scriptFeatures.allow_unsafe_scripts ? 'ENABLED' : 'ignored'} on this instance · timeout {scriptFeatures.script_timeout_ms}ms
            {:else}
              Instance script limits unavailable
            {/if}
          </p>
        </div>
      {/if}
    </div>
  </div>

  <div class="tester">
    <span class="tester__head">Test against a sample SMS body · max 4096</span>
    <div style="display:flex; gap:8px; align-items:flex-start;">
      <textarea
        class="textarea"
        style="min-height:56px;"
        rows={2}
        maxlength={4096}
        bind:value={testerBody}
        placeholder="Paste an example SMS here…"
      ></textarea>
      <button type="button" class="btn" style="flex-shrink:0;" disabled={testerBusy || !formTemplate.trim() || !testerBody.trim()} onclick={runTest}>
        {#if testerBusy}<Spinner size={13} />{:else}Run test{/if}
      </button>
    </div>
    {#if testerError}
      <div class="tester-error">{testerError}</div>
    {:else if testerResult}
      {#if testerResult.match}
        <div class="tester-result tester-result--match">
          <strong style="color:var(--ok);">Match</strong>
          <div class="tester-sub">Extracted</div>
          {#each fieldRows as row (row.key)}
            <div style="display:flex; justify-content:space-between; gap:12px; margin-top:4px;">
              <span style="color:var(--text-muted);">{row.label}</span>
              <span class="mono" style="color:{row.value === null ? 'var(--text-dim)' : 'var(--text)'};">{row.value ?? 'not captured'}</span>
            </div>
          {/each}
          {#if testerResult.rejected}
            <div class="script-reject">REJECTED BY SCRIPT: {testerResult.reject_reason || 'no reason given'}</div>
          {:else if testerResult.transformed}
            <div class="tester-sub">Transformed</div>
            {#each transformRows as row (row.key)}
              <div style="display:flex; justify-content:space-between; gap:12px; margin-top:4px;">
                <span style="color:var(--text-muted);">{row.label}</span>
                <span class="mono" style="color:{row.value === '' ? 'var(--text-dim)' : 'var(--text)'};">{row.value === '' ? '(empty)' : row.value}</span>
              </div>
            {/each}
          {/if}
        </div>
      {:else}
        <div class="tester-result tester-result--nomatch" style="color:var(--amber);">No match — the sample body does not satisfy this rule.</div>
      {/if}
    {/if}
  </div>

  {#snippet actions()}
    <button type="button" class="btn btn--ghost" onclick={() => (modalOpen = false)}>Cancel</button>
    <button type="button" class="btn btn--primary" disabled={!canSave || saving} onclick={save}>
      {#if saving}<Spinner size={13} />{/if}
      {editing ? 'Save changes' : 'Create provider'}
    </button>
  {/snippet}
</Modal>

<style>
  .script-section {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.015);
  }
  .script-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .script-chevron {
    flex-shrink: 0;
    transition: transform 120ms;
    color: var(--text-muted);
  }
  .script-chevron.open {
    transform: rotate(90deg);
  }
  .script-body {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .script-foot {
    margin: 0;
    font-size: 11px;
    color: var(--text-muted);
  }
  .tester-sub {
    margin-top: 8px;
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    font-weight: 600;
  }
  .script-reject {
    margin-top: 8px;
    border: 1px solid rgba(248, 113, 113, 0.35);
    background: var(--danger-dim);
    color: var(--danger);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 600;
  }
</style>
