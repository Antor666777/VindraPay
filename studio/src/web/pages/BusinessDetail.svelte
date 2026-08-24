<script lang="ts">
  import {
    api,
    type ApiKey,
    type BalancePoint,
    type Business,
    type Device,
    type Provider,
  } from '../lib/api';
  import { pushToast } from '../lib/stores.svelte';
  import { errMessage, fmtDate, focusOnMount } from '../lib/format';
  import { navigate, route } from '../lib/router';
  import Modal from '../components/Modal.svelte';
  import Pagination from '../components/Pagination.svelte';
  import StatusBadge from '../components/StatusBadge.svelte';
  import Spinner from '../components/Spinner.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import SecretReveal from '../components/SecretReveal.svelte';
  import { confirm } from '../components/ConfirmDialog.svelte';

  const LIMIT = 20;

  let tab = $state<'overview' | 'keys' | 'devices'>('overview');

  let business: Business | null = $state(null);
  let loadError = $state('');

  let keys: ApiKey[] = $state([]);
  let keysTotal = $state(0);
  let keysLoading = $state(false);
  let keysOffset = $state(0);
  let keyCreateOpen = $state(false);
  let newKeyLabel = $state('');
  let newKeyBusy = $state(false);
  let reveal = $state<{ kind: 'API key' | 'Device token'; token: string } | null>(null);
  let revokingKeyId = $state<string | null>(null);

  let devices: Device[] = $state([]);
  let devicesTotal = $state(0);
  let devicesLoading = $state(false);
  let devicesOffset = $state(0);
  let deviceCreateOpen = $state(false);
  let newDeviceName = $state('');
  let newDeviceBusy = $state(false);
  let deactivatingDeviceId = $state<string | null>(null);

  let expandedDeviceId = $state<string | null>(null);
  interface BalanceRow {
    providerId: string;
    providerName: string;
    loading: boolean;
    point: BalancePoint | null;
    error: string;
  }
  let balancesByDevice: Record<string, BalanceRow[]> = $state({});

  let providersCache: Provider[] = $state([]);
  let providersLoaded = $state(false);

  let calibrateOpen = $state(false);
  let calibrateDeviceId = $state('');
  let calibrateProviderId = $state('');
  let calibrateBalanceInput = $state('');
  let calibrateNote = $state('');
  let calibrateBusy = $state(false);

  const businessId = $derived(route.params.id ?? '');

  $effect(() => {
    const id = businessId;
    if (!id) return;
    tab = 'overview';
    business = null;
    keys = [];
    devices = [];
    balancesByDevice = {};
    void loadBusiness(id);
  });

  $effect(() => {
    const id = businessId;
    if (!id || tab !== 'keys') return;
    void loadKeys(id, keysOffset);
  });

  $effect(() => {
    const id = businessId;
    if (!id || tab !== 'devices') return;
    void loadDevices(id, devicesOffset);
  });

  async function loadBusiness(id: string): Promise<void> {
    try {
      business = await api.getBusiness(id);
    } catch (error) {
      loadError = errMessage(error);
      if ((error as { status?: number }).status !== 401) pushToast('error', loadError);
    }
  }

  async function loadKeys(id: string, offset: number): Promise<void> {
    keysLoading = true;
    try {
      const result = await api.listApiKeys(id);
      keysTotal = result.total;
      keys = result.items.slice(offset, offset + LIMIT);
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    } finally {
      keysLoading = false;
    }
  }

  async function loadDevices(id: string, offset: number): Promise<void> {
    devicesLoading = true;
    try {
      const result = await api.listDevices({ business_id: id, limit: LIMIT, offset });
      devicesTotal = result.total;
      devices = result.items;
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    } finally {
      devicesLoading = false;
    }
  }

  async function ensureProviders(): Promise<void> {
    if (providersLoaded) return;
    try {
      const result = await api.listProviders();
      providersCache = result.items;
      providersLoaded = true;
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    }
  }

  async function toggleExpand(device: Device): Promise<void> {
    await ensureProviders();
    if (expandedDeviceId === device.id) {
      expandedDeviceId = null;
      return;
    }
    expandedDeviceId = device.id;
    await loadBalances(device);
  }

  async function loadBalances(device: Device): Promise<void> {
    if (!providersCache.length) {
      balancesByDevice[device.id] = [];
      return;
    }
    balancesByDevice[device.id] = providersCache.map((provider) => ({
      providerId: provider.id,
      providerName: provider.name,
      loading: true,
      point: null,
      error: '',
    }));
    await Promise.all(
      providersCache.map(async (provider, index) => {
        try {
          const point = await api.deviceBalance(device.id, provider.id);
          balancesByDevice[device.id][index] = {
            ...balancesByDevice[device.id][index],
            loading: false,
            point,
          };
        } catch (error) {
          balancesByDevice[device.id][index] = {
            ...balancesByDevice[device.id][index],
            loading: false,
            error:
              (error as { status?: number }).status === 404
                ? 'No history yet'
                : errMessage(error),
          };
        }
      }),
    );
  }

  function openKeyCreate(): void {
    newKeyLabel = '';
    keyCreateOpen = true;
  }

  async function submitKeyCreate(): Promise<void> {
    if (!newKeyLabel.trim()) return;
    newKeyBusy = true;
    try {
      const created = await api.createApiKey(businessId, newKeyLabel.trim());
      keyCreateOpen = false;
      reveal = { kind: 'API key', token: created.token };
      await loadKeys(businessId, keysOffset);
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    } finally {
      newKeyBusy = false;
    }
  }

  async function revokeKey(key: ApiKey): Promise<void> {
    const ok = await confirm({
      title: 'Revoke API key',
      message: `Revoke "${key.label}" (${key.key_prefix}…)? Requests using it will immediately fail. This cannot be undone.`,
      confirmLabel: 'Revoke',
    });
    if (!ok) return;
    revokingKeyId = key.id;
    try {
      await api.revokeApiKey(key.id);
      pushToast('success', 'API key revoked');
      await loadKeys(businessId, keysOffset);
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    } finally {
      revokingKeyId = null;
    }
  }

  function openDeviceCreate(): void {
    newDeviceName = '';
    deviceCreateOpen = true;
  }

  async function submitDeviceCreate(): Promise<void> {
    if (!newDeviceName.trim()) return;
    newDeviceBusy = true;
    try {
      const created = await api.createDevice(businessId, newDeviceName.trim());
      deviceCreateOpen = false;
      reveal = { kind: 'Device token', token: created.token };
      await loadDevices(businessId, devicesOffset);
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    } finally {
      newDeviceBusy = false;
    }
  }

  async function deactivateDevice(device: Device): Promise<void> {
    const ok = await confirm({
      title: 'Deactivate device',
      message: `Deactivate "${device.name}" (${device.token_prefix}…)? Its SMS ingestion token will stop being accepted.`,
      confirmLabel: 'Deactivate',
    });
    if (!ok) return;
    deactivatingDeviceId = device.id;
    try {
      await api.deactivateDevice(device.id);
      pushToast('success', `Device "${device.name}" deactivated`);
      await loadDevices(businessId, devicesOffset);
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    } finally {
      deactivatingDeviceId = null;
    }
  }

  function openCalibrate(device: Device, providerId: string): void {
    calibrateDeviceId = device.id;
    calibrateProviderId = providerId || (providersCache[0]?.id ?? '');
    calibrateBalanceInput = '';
    calibrateNote = '';
    calibrateOpen = true;
  }

  async function submitCalibrate(): Promise<void> {
    if (!calibrateProviderId || !calibrateBalanceInput.trim()) return;
    calibrateBusy = true;
    try {
      await api.calibrateBalance(calibrateDeviceId, {
        provider_id: calibrateProviderId,
        balance: calibrateBalanceInput.trim(),
        note: calibrateNote.trim() || undefined,
      });
      calibrateOpen = false;
      pushToast('success', 'Balance calibrated');
      const device = devices.find((item) => item.id === calibrateDeviceId);
      if (device) {
        expandedDeviceId = device.id;
        await loadBalances(device);
      }
    } catch (error) {
      if ((error as { status?: number }).status !== 401) pushToast('error', errMessage(error));
    } finally {
      calibrateBusy = false;
    }
  }
</script>

{#snippet balanceRows(deviceId: string)}
  {#each balancesByDevice[deviceId] ?? [] as row, index (`${row.providerId}-${index}`)}
    <tr>
      <td>{row.providerName}</td>
      <td class="num">
        {#if row.loading}
          <Spinner size={12} />
        {:else if row.point}
          {row.point.balance}
        {:else}
          <span style="color:var(--text-dim);">{row.error || '—'}</span>
        {/if}
      </td>
      <td>
        {#if row.point}
          <StatusBadge value={row.point.source} />
        {:else}
          <span style="color:var(--text-dim);">—</span>
        {/if}
      </td>
      <td>{row.point ? fmtDate(row.point.point_at) : '—'}</td>
      <td class="td-right">
        <button
          type="button"
          class="btn btn--small"
          onclick={() => openCalibrate(devices.find((d) => d.id === deviceId)!, row.providerId)}
        >
          Calibrate
        </button>
      </td>
    </tr>
  {/each}
{/snippet}

{#if !business && !loadError}
  <div class="panel"><div class="skeleton skeleton--row"></div><div class="skeleton skeleton--row"></div></div>
{:else if loadError && !business}
  <EmptyState title="Could not load business" hint={loadError} />
{:else if business}
  <div class="page-head">
    <div>
      <h1 style="display:flex;align-items:center;gap:10px;">
        {business.name}
        <StatusBadge value={business.status} dot />
      </h1>
      <p class="sub mono">{business.owner_email}</p>
    </div>
    <button type="button" class="btn" onclick={() => navigate('/businesses')}>← All businesses</button>
  </div>

  <div class="tabs">
    <button type="button" class="tab" class:active={tab === 'overview'} onclick={() => (tab = 'overview')}>Overview</button>
    <button type="button" class="tab" class:active={tab === 'keys'} onclick={() => (tab = 'keys')}>API Keys</button>
    <button type="button" class="tab" class:active={tab === 'devices'} onclick={() => (tab = 'devices')}>Devices</button>
  </div>

  {#if tab === 'overview'}
    <div class="panel">
      <div class="panel__body">
        <dl class="kv">
          <dt>ID</dt>
          <dd class="mono">{business.id}</dd>
          <dt>Status</dt>
          <dd><StatusBadge value={business.status} dot /></dd>
          <dt>Created</dt>
          <dd>{fmtDate(business.created_at)}</dd>
          <dt>Updated</dt>
          <dd>{fmtDate(business.updated_at)}</dd>
        </dl>
      </div>
    </div>
  {:else if tab === 'keys'}
    <div class="panel">
      <div class="panel__head">
        <span class="panel__title">API Keys · {keysTotal}</span>
        <button type="button" class="btn btn--primary btn--small" onclick={openKeyCreate}>Create key</button>
      </div>
      {#if keysLoading && keys.length === 0}
        <div class="skeleton skeleton--row"></div>
        <div class="skeleton skeleton--row"></div>
      {:else if keys.length === 0}
        <EmptyState title="No API keys" hint="Issue a key so this business can call the orders API." />
      {:else}
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr><th>Label</th><th>Prefix</th><th>Last used</th><th>Created</th><th>Status</th><th></th></tr>
            </thead>
            <tbody class:dim={keysLoading}>
              {#each keys as key (key.id)}
                <tr>
                  <td><span class="cell-main">{key.label}</span></td>
                  <td class="mono">{key.key_prefix}…</td>
                  <td>{key.last_used_at ? fmtDate(key.last_used_at) : 'Never'}</td>
                  <td>{fmtDate(key.created_at)}</td>
                  <td>
                    {#if key.revoked_at}
                      <StatusBadge value="revoked" />
                    {:else}
                      <StatusBadge value="active" dot />
                    {/if}
                  </td>
                  <td class="td-right">
                    {#if !key.revoked_at}
                      {#if revokingKeyId === key.id}
                        <Spinner size={13} />
                      {:else}
                        <button type="button" class="btn btn--danger btn--small" onclick={() => revokeKey(key)}>Revoke</button>
                      {/if}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <Pagination total={keysTotal} limit={LIMIT} offset={keysOffset} onPage={(value) => (keysOffset = value)} />
      {/if}
    </div>
  {:else if tab === 'devices'}
    <div class="panel">
      <div class="panel__head">
        <span class="panel__title">Devices · {devicesTotal}</span>
        <button type="button" class="btn btn--primary btn--small" onclick={openDeviceCreate}>Register device</button>
      </div>
      {#if devicesLoading && devices.length === 0}
        <div class="skeleton skeleton--row"></div>
        <div class="skeleton skeleton--row"></div>
      {:else if devices.length === 0}
        <EmptyState title="No devices" hint="Register an Android SMS-relay device to ingest provider SMS for this business." />
      {:else}
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr><th></th><th>Name</th><th>Token prefix</th><th>Last ping</th><th>Versions</th><th>Registered</th><th></th></tr>
            </thead>
            <tbody class:dim={devicesLoading}>
              {#each devices as device (device.id)}
                <tr>
                  <td style="width:24px;">
                    <span class="dot" class:dot--online={device.online} title={device.online ? 'Online' : 'Offline'}></span>
                  </td>
                  <td>
                    <span class="cell-main">{device.name}</span>
                    {#if device.deactivated_at}<StatusBadge value="revoked" />{/if}
                  </td>
                  <td class="mono">{device.token_prefix}…</td>
                  <td>{device.last_ping_at ? fmtDate(device.last_ping_at) : 'Never'}</td>
                  <td style="white-space:normal;color:var(--text-dim);font-size:11px;">app {device.app_version ?? '?'} · os {device.os_version ?? '?'}</td>
                  <td>{fmtDate(device.created_at)}</td>
                  <td class="td-right" style="white-space:nowrap;">
                    <button type="button" class="expander-btn" onclick={() => toggleExpand(device)}>
                      Balances {expandedDeviceId === device.id ? '▲' : '▼'}
                    </button>
                    {#if !device.deactivated_at}
                      {#if deactivatingDeviceId === device.id}
                        <Spinner size={13} />
                      {:else}
                        <button type="button" class="btn btn--danger btn--small" onclick={() => deactivateDevice(device)} style="margin-left:10px;">Deactivate</button>
                      {/if}
                    {/if}
                  </td>
                </tr>
                {#if expandedDeviceId === device.id}
                  <tr>
                    <td colspan="7" class="expand-cell">
                      <div class="inbox-detail">
                        {#if (balancesByDevice[device.id] ?? []).length === 0}
                          <span style="color:var(--text-dim);font-size:12px;">
                            No providers configured yet — create one on the Providers page to track balances.
                          </span>
                        {:else}
                          <table class="subtable">
                            <thead>
                              <tr><th>Provider</th><th style="text-align:right;">Balance</th><th>Source</th><th>As of</th><th></th></tr>
                            </thead>
                            <tbody>
                              {@render balanceRows(device.id)}
                            </tbody>
                          </table>
                        {/if}
                      </div>
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
        <Pagination total={devicesTotal} limit={LIMIT} offset={devicesOffset} onPage={(value) => (devicesOffset = value)} />
      {/if}
    </div>
  {/if}
{/if}

<Modal open={keyCreateOpen} title="Create API key" onClose={() => (keyCreateOpen = false)}>
  <div class="field">
    <label for="key-label">Label</label>
    <input id="key-label" class="input" use:focusOnMount maxlength={100} bind:value={newKeyLabel} placeholder="production-server" />
  </div>
  {#snippet actions()}
    <button type="button" class="btn btn--ghost" onclick={() => (keyCreateOpen = false)}>Cancel</button>
    <button type="button" class="btn btn--primary" disabled={newKeyBusy || !newKeyLabel.trim()} onclick={submitKeyCreate}>
      {#if newKeyBusy}<Spinner size={13} />{/if}
      Create
    </button>
  {/snippet}
</Modal>

<Modal open={deviceCreateOpen} title="Register device" onClose={() => (deviceCreateOpen = false)}>
  <div class="field">
    <label for="device-name">Device name</label>
    <input id="device-name" class="input" use:focusOnMount maxlength={100} bind:value={newDeviceName} placeholder="warehouse-phone-1" />
  </div>
  {#snippet actions()}
    <button type="button" class="btn btn--ghost" onclick={() => (deviceCreateOpen = false)}>Cancel</button>
    <button type="button" class="btn btn--primary" disabled={newDeviceBusy || !newDeviceName.trim()} onclick={submitDeviceCreate}>
      {#if newDeviceBusy}<Spinner size={13} />{/if}
      Register
    </button>
  {/snippet}
</Modal>

<Modal open={reveal !== null} title="{reveal?.kind ?? ''} created" onClose={() => (reveal = null)}>
  {#if reveal}
    <SecretReveal token={reveal.token} kindLabel={reveal.kind} onDone={() => (reveal = null)} />
  {/if}
</Modal>

<Modal open={calibrateOpen} title="Calibrate balance" onClose={() => (calibrateOpen = false)}>
  <div class="field">
    <label for="cal-provider">Provider</label>
    <select id="cal-provider" class="select" use:focusOnMount bind:value={calibrateProviderId}>
      {#each providersCache as provider (provider.id)}
        <option value={provider.id}>{provider.name}</option>
      {/each}
    </select>
  </div>
  <div class="field">
    <label for="cal-balance">Balance</label>
    <input id="cal-balance" class="input mono" maxlength={32} bind:value={calibrateBalanceInput} placeholder="1250000.00" />
  </div>
  <div class="field">
    <label for="cal-note">Note (optional)</label>
    <input id="cal-note" class="input" maxlength={255} bind:value={calibrateNote} placeholder="manual top-up check" />
  </div>
  {#snippet actions()}
    <button type="button" class="btn btn--ghost" onclick={() => (calibrateOpen = false)}>Cancel</button>
    <button
      type="button"
      class="btn btn--primary"
      disabled={calibrateBusy || !calibrateProviderId || !calibrateBalanceInput.trim()}
      onclick={submitCalibrate}
    >
      {#if calibrateBusy}<Spinner size={13} />{/if}
      Save calibration
    </button>
  {/snippet}
</Modal>

<svelte:head><title>{business?.name ?? 'Business'} · VindraPay Studio</title></svelte:head>
