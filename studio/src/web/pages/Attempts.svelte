<script lang="ts">
  import { api, type AttemptResult, type Business, type VerificationAttempt } from '../lib/api';
  import { pushToast } from '../lib/stores.svelte';
  import { errMessage, fmtDate, focusOnMount } from '../lib/format';
  import Pagination from '../components/Pagination.svelte';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Spinner from '../components/Spinner.svelte';
  import EmptyState from '../components/EmptyState.svelte';

  const LIMIT = 20;

  const RESULTS: AttemptResult[] = [
    'success',
    'not_found',
    'already_used',
    'amount_mismatch',
    'order_expired',
    'order_not_pending',
    'balance_mismatch',
    'wrong_direction',
  ];

  let items: VerificationAttempt[] = $state([]);
  let total = $state(0);
  let loading = $state(true);
  let offset = $state(0);

  let businessOptions: Pick<Business, 'id' | 'name'>[] = $state([]);
  let businessId = $state('');
  let resultFilter = $state<'' | AttemptResult>('');
  let trxInput = $state('');
  let trx = $state('');

  $effect(() => {
    void loadFilters();
  });

  $effect(() => {
    const value = trxInput;
    const timer = setTimeout(() => {
      trx = value.trim();
      offset = 0;
    }, 300);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    void loadPage(businessId, resultFilter, trx, offset);
  });

  async function loadFilters(): Promise<void> {
    try {
      const result = await api.listBusinesses({ limit: 100 });
      businessOptions = result.items.map((item) => ({ id: item.id, name: item.name }));
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    }
  }

  async function loadPage(
    biz: string,
    result: string,
    trxValue: string,
    pageOffset: number,
  ): Promise<void> {
    loading = true;
    try {
      const found = await api.listAttempts({
        business_id: biz || undefined,
        result: (result || undefined) as AttemptResult | undefined,
        trx_id: trxValue || undefined,
        limit: LIMIT,
        offset: pageOffset,
      });
      items = found.items;
      total = found.total;
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    } finally {
      loading = false;
    }
  }
</script>

<div class="page-head">
  <div>
    <h1>Verification Attempts</h1>
    <p class="sub">{total} attempts</p>
  </div>
</div>

<div class="toolbar">
  <select
    class="select"
    style="width:190px;"
    bind:value={businessId}
    onchange={() => (offset = 0)}
  >
    <option value="">All businesses</option>
    {#each businessOptions as option (option.id)}
      <option value={option.id}>{option.name}</option>
    {/each}
  </select>
  <select
    class="select"
    style="width:200px;"
    bind:value={resultFilter}
    onchange={() => (offset = 0)}
  >
    <option value="">Any result</option>
    {#each RESULTS as result (result)}
      <option value={result}>{result}</option>
    {/each}
  </select>
  <input
    class="input mono"
    style="max-width:240px;"
    use:focusOnMount
    type="search"
    placeholder="Search by Trx ID…"
    maxlength={64}
    bind:value={trxInput}
  />
  <div class="spacer"></div>
  {#if loading}<Spinner size={14} />{/if}
</div>

<div class="panel">
  {#if loading && items.length === 0}
    <div class="skeleton skeleton--row"></div>
    <div class="skeleton skeleton--row"></div>
    <div class="skeleton skeleton--row"></div>
  {:else if items.length === 0}
    <EmptyState title="No attempts found" hint="Verification attempts land here whenever a client submits a transaction ID against an order." />
  {:else}
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Submitted Trx ID</th>
            <th>Business</th>
            <th>Result</th>
            <th class="th-right">Submitted amount</th>
            <th>Balance consistent</th>
            <th>Source IP</th>
          </tr>
        </thead>
        <tbody class:dim={loading}>
          {#each items as attempt (attempt.created_at + attempt.submitted_trx_id)}
            <tr>
              <td>{fmtDate(attempt.created_at)}</td>
              <td class="mono">{attempt.submitted_trx_id}</td>
              <td>{attempt.business_name ?? '—'}</td>
              <td><StatusBadge value={attempt.result} /></td>
              <td class="num">{attempt.submitted_amount ?? '—'}</td>
              <td>
                {#if attempt.balance_consistent === null}
                  <span style="color:var(--text-dim);">—</span>
                {:else if attempt.balance_consistent}
                  <StatusBadge value="success" />
                {:else}
                  <StatusBadge value="balance_mismatch" />
                {/if}
              </td>
              <td class="mono">{attempt.source_ip ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pagination {total} limit={LIMIT} {offset} onPage={(value) => (offset = value)} />
  {/if}
</div>
