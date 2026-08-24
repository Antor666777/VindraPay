<script lang="ts">
  import { api } from '../lib/api';
  import { session, pushToast } from '../lib/stores.svelte';
  import StatCard from '../components/StatCard.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import { fmtDate } from '../lib/format';

  const cards = $derived.by(() => {
    const s = session.stats;
    return [
      { key: 'businesses', label: 'Businesses', value: s?.businesses_total ?? '·' },
      { key: 'devices', label: 'Devices Online', value: s?.devices_online ?? '·', tone: 'accent' as const },
      { key: 'trx_total', label: 'Transactions', value: s?.transactions_total ?? '·' },
      { key: 'trx_today', label: 'Transactions (24h)', value: s?.transactions_today ?? '·' },
      { key: 'orders_pending', label: 'Orders Pending', value: s?.orders_pending ?? '·', tone: (s?.orders_pending ?? 0) > 0 ? ('accent' as const) : ('default' as const) },
      { key: 'orders_paid', label: 'Orders Paid', value: s?.orders_paid ?? '·' },
      { key: 'attempts', label: 'Attempts (24h)', value: s?.attempts_today ?? '·' },
      {
        key: 'messages',
        label: 'Unparsed Messages',
        value: s?.messages_unparsed ?? '·',
        tone: (s?.messages_unparsed ?? 0) > 0 ? ('danger' as const) : ('default' as const),
      },
    ];
  });

  async function reloadStats(): Promise<void> {
    try {
      session.stats = await api.getStats();
    } catch (error) {
      if ((error as { status?: number }).status !== 401) {
        pushToast('error', (error as Error).message);
      }
    }
  }
</script>

<div class="page-head">
  <div>
    <h1>Dashboard</h1>
    <p class="sub">
      Live platform overview
      {#if session.refreshedAt}
        · refreshed {fmtDate(session.refreshedAt)}
      {/if}
    </p>
  </div>
</div>

{#if session.stats === null}
  <div class="stat-grid">
    {#each Array.from({ length: 8 }, (_, i) => i) as i (i)}
      <div class="stat-card">
        <div class="skeleton" style="height:11px;width:60%;"></div>
        <div class="skeleton" style="height:24px;width:40%;margin-top:10px;"></div>
      </div>
    {/each}
  </div>
{:else if cards.every((card) => card.value === 0)}
  <EmptyState title="Everything is quiet" hint="No data yet — create a business and register its first device to start ingesting SMS verifications." />
{/if}

<div class="stat-grid">
  {#each cards as card (card.key)}
    <StatCard label={card.label} value={card.value} tone={card.tone ?? 'default'} />
  {/each}
</div>

<button type="button" class="btn btn--small" onclick={reloadStats}>
  Reload stats
</button>
