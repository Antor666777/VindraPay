<script lang="ts">
  import { api, type Business, type BusinessStatus } from '../lib/api';
  import { pushToast } from '../lib/stores.svelte';
  import { errMessage, fmtDate, focusOnMount } from '../lib/format';
  import { navigate } from '../lib/router';
  import Modal from '../components/Modal.svelte';
  import Pagination from '../components/Pagination.svelte';
  import StatusBadge from '../components/StatusBadge.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Spinner from '../components/Spinner.svelte';
  import { confirm } from '../components/ConfirmDialog.svelte';

  const LIMIT = 20;

  let items: Business[] = $state([]);
  let total = $state(0);
  let loading = $state(true);
  let offset = $state(0);
  let searchInput = $state('');
  let search = $state('');
  let statusFilter = $state<'' | BusinessStatus>('');

  let createOpen = $state(false);
  let creating = $state(false);
  let newName = $state('');
  let newEmail = $state('');
  let rowBusyId = $state<string | null>(null);

  $effect(() => {
    const value = searchInput;
    const timer = setTimeout(() => {
      search = value.trim();
      offset = 0;
    }, 300);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    void loadPage(search, statusFilter, offset);
  });

  async function loadPage(searchValue: string, status: string, pageOffset: number): Promise<void> {
    loading = true;
    try {
      const result = await api.listBusinesses({
        search: searchValue || undefined,
        status: (status || undefined) as BusinessStatus | undefined,
        limit: LIMIT,
        offset: pageOffset,
      });
      items = result.items;
      total = result.total;
    } catch (error) {
      if ((error as { status?: number }).status !== 401) {
        pushToast('error', errMessage(error));
      }
    } finally {
      loading = false;
    }
  }

  function openCreate(): void {
    newName = '';
    newEmail = '';
    createOpen = true;
  }

  async function submitCreate(): Promise<void> {
    if (!newName.trim() || !newEmail.trim()) return;
    creating = true;
    try {
      const created = await api.createBusiness({ name: newName.trim(), owner_email: newEmail.trim() });
      createOpen = false;
      pushToast('success', `Business "${created.name}" created`);
      offset = 0;
      await loadPage(search, statusFilter, offset);
    } catch (error) {
      if ((error as { status?: number }).status !== 401) {
        pushToast('error', errMessage(error));
      }
    } finally {
      creating = false;
    }
  }

  async function toggleStatus(business: Business): Promise<void> {
    const next: BusinessStatus = business.status === 'active' ? 'suspended' : 'active';
    const ok = await confirm({
      title: next === 'suspended' ? 'Suspend business' : 'Activate business',
      message:
        next === 'suspended'
          ? `"${business.name}" will stop verifying orders until reactivated. Continue?`
          : `Reactivate "${business.name}"? Its API keys and devices will work again.`,
      confirmLabel: next === 'suspended' ? 'Suspend' : 'Activate',
    });
    if (!ok) return;
    rowBusyId = business.id;
    try {
      const updated = await api.setBusinessStatus(business.id, next);
      items = items.map((item) => (item.id === updated.id ? updated : item));
      pushToast('success', `${updated.name} is now ${updated.status}`);
    } catch (error) {
      if ((error as { status?: number }).status !== 401) {
        pushToast('error', errMessage(error));
      }
    } finally {
      rowBusyId = null;
    }
  }
</script>

<div class="page-head">
  <div>
    <h1>Businesses</h1>
    <p class="sub">{total} total</p>
  </div>
  <button type="button" class="btn btn--primary" onclick={openCreate}>New business</button>
</div>

<div class="toolbar">
  <input
    class="input"
    style="max-width:260px;"
    type="search"
    placeholder="Search name or email…"
    maxlength={100}
    bind:value={searchInput}
  />
  <select class="select" style="width:160px;" bind:value={statusFilter} onchange={() => (offset = 0)}>
    <option value="">All statuses</option>
    <option value="active">Active</option>
    <option value="suspended">Suspended</option>
  </select>
  <div class="spacer"></div>
  {#if loading}
    <Spinner size={14} />
  {/if}
</div>

<div class="panel">
  {#if loading && items.length === 0}
    <div>
      {#each Array.from({ length: 6 }, (_, i) => i) as i (i)}
        <div class="skeleton skeleton--row"></div>
      {/each}
    </div>
  {:else if items.length === 0}
    <EmptyState
      title="No businesses found"
      hint={search || statusFilter ? 'Try clearing the search or status filter.' : 'Create your first business to start issuing API keys.'}
    />
  {:else}
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Owner</th>
            <th>Status</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody class:dim={loading}>
          {#each items as business (business.id)}
            <tr class="row--click" onclick={() => navigate(`/businesses/${business.id}`)}>
              <td><span class="cell-main">{business.name}</span></td>
              <td class="mono">{business.owner_email}</td>
              <td><StatusBadge value={business.status} dot /></td>
              <td>{fmtDate(business.created_at)}</td>
              <td class="td-right">
                {#if rowBusyId === business.id}
                  <Spinner size={13} />
                {:else}
                  <button
                    type="button"
                    class="btn btn--small {business.status === 'active' ? 'btn--danger' : ''}"
                    onclick={(event) => {
                      event.stopPropagation();
                      void toggleStatus(business);
                    }}
                  >
                    {business.status === 'active' ? 'Suspend' : 'Activate'}
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

<Modal open={createOpen} title="Create business" onClose={() => (createOpen = false)}>
  <div class="field">
    <label for="biz-name">Name</label>
    <input id="biz-name" class="input" use:focusOnMount maxlength={200} bind:value={newName} placeholder="Acme Payments Ltd" />
  </div>
  <div class="field">
    <label for="biz-email">Owner email</label>
    <input id="biz-email" class="input" type="email" maxlength={254} bind:value={newEmail} placeholder="owner@acme.example" />
  </div>
  {#snippet actions()}
    <button type="button" class="btn btn--ghost" onclick={() => (createOpen = false)}>Cancel</button>
    <button type="button" class="btn btn--primary" disabled={creating || !newName.trim() || !newEmail.trim()} onclick={submitCreate}>
      {#if creating}<Spinner size={13} />{/if}
      Create
    </button>
  {/snippet}
</Modal>
