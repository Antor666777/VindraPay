<script lang="ts">
  import { api, type Business, type ParseStatus, type RawMessage } from '../lib/api';
  import { pushToast, session } from '../lib/stores.svelte';
  import { errMessage, fmtDate, truncate } from '../lib/format';
  import Pagination from '../components/Pagination.svelte';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Spinner from '../components/Spinner.svelte';
  import EmptyState from '../components/EmptyState.svelte';

  const LIMIT = 20;

  let items: RawMessage[] = $state([]);
  let total = $state(0);
  let loading = $state(true);
  let offset = $state(0);
  let expandedId = $state<string | null>(null);

  let businessOptions: Pick<Business, 'id' | 'name'>[] = $state([]);
  let businessId = $state('');
  let statusFilter = $state<'' | ParseStatus>('');

  $effect(() => {
    void loadFilters();
  });

  $effect(() => {
    void loadPage(businessId, statusFilter, offset);
  });

  async function loadFilters(): Promise<void> {
    try {
      const result = await api.listBusinesses({ limit: 100 });
      businessOptions = result.items.map((item) => ({ id: item.id, name: item.name }));
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    }
  }

  async function loadPage(biz: string, status: string, pageOffset: number): Promise<void> {
    loading = true;
    try {
      const result = await api.listMessages({
        business_id: biz || undefined,
        parse_status: (status || undefined) as ParseStatus | undefined,
        limit: LIMIT,
        offset: pageOffset,
      });
      items = result.items;
      total = result.total;
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    } finally {
      loading = false;
    }
  }

  function toggle(id: string): void {
    expandedId = expandedId === id ? null : id;
  }

  const chips: { value: '' | ParseStatus; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'parsed', label: 'Parsed' },
    { value: 'skipped', label: 'Skipped' },
    { value: 'unmatched', label: 'Unmatched' },
    { value: 'error', label: 'Error' },
  ];
</script>

<div class="page-head">
  <div>
    <h1>Inbox</h1>
    <p class="sub">{total} raw SMS messages</p>
  </div>
</div>

<div class="chip-row">
  {#each chips as chip (chip.label)}
    <button
      type="button"
      class="chip"
      class:active={statusFilter === chip.value}
      onclick={() => {
        statusFilter = chip.value;
        offset = 0;
      }}
    >
      {chip.label}
      {#if chip.value === 'unmatched' && session.stats}
        <span class="chip__count">{session.stats.messages_unparsed}</span>
      {/if}
    </button>
  {/each}
  <select class="select" style="width:190px; margin-left:auto;" bind:value={businessId} onchange={() => (offset = 0)}>
    <option value="">All businesses</option>
    {#each businessOptions as option (option.id)}
      <option value={option.id}>{option.name}</option>
    {/each}
  </select>
</div>

<div class="toolbar">
  <div class="spacer"></div>
  {#if loading}<Spinner size={14} />{/if}
</div>

<div class="panel">
  {#if loading && items.length === 0}
    <div class="skeleton skeleton--row"></div>
    <div class="skeleton skeleton--row"></div>
    <div class="skeleton skeleton--row"></div>
  {:else if items.length === 0}
    <EmptyState title="Inbox is empty" hint="No raw messages match this view. Devices push SMS here as they arrive." />
  {:else}
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th style="width:24px;"></th>
            <th>Ingested</th>
            <th>Business</th>
            <th>Sender ID</th>
            <th>Status</th>
            <th>Body</th>
          </tr>
        </thead>
        <tbody class:dim={loading}>
          {#each items as message (message.id)}
            <tr class="row--click" onclick={() => toggle(message.id)}>
              <td>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:{expandedId === message.id ? 'rotate(90deg)' : 'none'};transition:transform 120ms;"><path d="m9 18 6-6-6-6"/></svg>
              </td>
              <td>{fmtDate(message.ingested_at)}</td>
              <td>{message.business_name ?? '—'}</td>
              <td class="mono">{message.sender_id ?? '—'}</td>
              <td><StatusBadge value={message.parse_status} /></td>
              <td class="body-preview" title={message.body}>{truncate(message.body.replace(/\s+/g, ' ').trim())}</td>
            </tr>
            {#if expandedId === message.id}
              <tr>
                <td colspan="6" class="expand-cell">
                  <div class="inbox-detail">
                    {#if message.parse_status === 'skipped'}
                      <div class="skip-banner">
                        <strong>REJECTED BY SCRIPT:</strong>
                        <span>{message.error_detail || 'no reason given'}</span>
                      </div>
                    {/if}
                    <pre class="inbox-pre">{message.body}</pre>
                    <dl class="kv" style="grid-template-columns:150px 1fr;">
                      <dt>Error code</dt>
                      <dd class="mono">{message.error_code ?? '—'}</dd>
                      <dt>Error detail</dt>
                      <dd>{message.error_detail ?? '—'}</dd>
                      <dt>Matched pattern</dt>
                      <dd class="mono">{message.matched_pattern ?? '—'}</dd>
                      <dt>Device received</dt>
                      <dd>{fmtDate(message.device_received_at ?? null)}</dd>
                      <dt>Device ID</dt>
                      <dd class="mono">{message.device_id ?? '—'}</dd>
                      <dt>Client msg ID</dt>
                      <dd class="mono">{message.client_msg_id ?? '—'}</dd>
                      <dt>Transaction ID</dt>
                      <dd class="mono">{message.transaction_id ?? '—'}</dd>
                    </dl>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
    <Pagination {total} limit={LIMIT} {offset} onPage={(value) => (offset = value)} />
  {/if}
</div>

<style>
  .skip-banner {
    display: flex;
    gap: 8px;
    align-items: baseline;
    border: 1px solid rgba(251, 191, 36, 0.35);
    background: var(--amber-dim);
    color: var(--amber);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12.5px;
    margin-bottom: 10px;
  }
</style>
