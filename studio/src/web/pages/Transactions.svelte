<script lang="ts">
  import { api, type Business, type Direction, type Provider, type Transaction } from '../lib/api';
  import { pushToast } from '../lib/stores.svelte';
  import { errMessage, fmtDate } from '../lib/format';
  import Pagination from '../components/Pagination.svelte';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Spinner from '../components/Spinner.svelte';
  import EmptyState from '../components/EmptyState.svelte';

  const LIMIT = 20;

  let items: Transaction[] = $state([]);
  let total = $state(0);
  let loading = $state(true);
  let offset = $state(0);

  let businessOptions: Pick<Business, 'id' | 'name'>[] = $state([]);
  let providerOptions: Provider[] = $state([]);

  let businessId = $state('');
  let providerId = $state('');
  let direction = $state<'' | Direction>('');

  $effect(() => {
    void loadFilters();
  });

  $effect(() => {
    void loadPage(businessId, providerId, direction, offset);
  });

  async function loadFilters(): Promise<void> {
    try {
      const [businesses, providers] = await Promise.all([
        api.listBusinesses({ limit: 100 }),
        api.listProviders(),
      ]);
      businessOptions = businesses.items.map((item) => ({ id: item.id, name: item.name }));
      providerOptions = providers.items;
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    }
  }

  async function loadPage(
    biz: string,
    prov: string,
    dir: string,
    pageOffset: number,
  ): Promise<void> {
    loading = true;
    try {
      const result = await api.listTransactions({
        business_id: biz || undefined,
        provider_id: prov || undefined,
        direction: (dir || undefined) as Direction | undefined,
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
</script>

<div class="page-head">
  <div>
    <h1>Transactions</h1>
    <p class="sub">{total} matched</p>
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
    style="width:190px;"
    bind:value={providerId}
    onchange={() => (offset = 0)}
  >
    <option value="">All providers</option>
    {#each providerOptions as option (option.id)}
      <option value={option.id}>{option.name}</option>
    {/each}
  </select>
  <select
    class="select"
    style="width:150px;"
    bind:value={direction}
    onchange={() => (offset = 0)}
  >
    <option value="">Any direction</option>
    <option value="credit">credit</option>
    <option value="debit">debit</option>
  </select>
  <div class="spacer"></div>
  {#if loading}
    <Spinner size={14} />
  {/if}
</div>

<div class="panel">
  {#if loading && items.length === 0}
    <div class="skeleton skeleton--row"></div>
    <div class="skeleton skeleton--row"></div>
    <div class="skeleton skeleton--row"></div>
  {:else if items.length === 0}
    <EmptyState title="No transactions" hint="Nothing matches these filters yet. Transactions appear once devices ingest provider SMS." />
  {:else}
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Received</th>
            <th>Trx ID</th>
            <th>Business</th>
            <th>Provider</th>
            <th>Direction</th>
            <th class="th-right">Amount</th>
            <th class="th-right">Balance after</th>
            <th>Sender</th>
          </tr>
        </thead>
        <tbody class:dim={loading}>
          {#each items as trx (trx.id)}
            <tr>
              <td>{fmtDate(trx.received_at)}</td>
              <td class="mono">{trx.trx_id}</td>
              <td>{trx.business_name ?? '—'}</td>
              <td>{trx.provider_name ?? '—'}</td>
              <td><StatusBadge value={trx.direction} /></td>
              <td class="num"><span class="cell-main">{trx.amount}</span></td>
              <td class="num" style="color:var(--text-muted);">{trx.balance_after ?? '—'}</td>
              <td class="mono">{trx.sender_msisdn ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pagination {total} limit={LIMIT} {offset} onPage={(value) => (offset = value)} />
  {/if}
</div>
