<script lang="ts">
  import { api, ApiError, backendHealth } from './lib/api';
  import { auth, backend, pushToast, session, lockSession } from './lib/stores.svelte';
  import { isActive, navigate, route } from './lib/router';

  import Businesses from './pages/Businesses.svelte';
  import BusinessDetail from './pages/BusinessDetail.svelte';
  import Attempts from './pages/Attempts.svelte';
  import Dashboard from './pages/Dashboard.svelte';
  import Inbox from './pages/Inbox.svelte';
  import Login from './pages/Login.svelte';
  import Providers from './pages/Providers.svelte';
  import Settings from './pages/Settings.svelte';
  import Transactions from './pages/Transactions.svelte';
  import Guide from './pages/Guide.svelte';
  import Spinner from './components/Spinner.svelte';
  import StatusBadge from './components/StatusBadge.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import { toasts, dismissToast } from './lib/stores.svelte';

  interface NavItem {
    path: string;
    label: string;
    icon: string;
  }

  const NAV: NavItem[] = [
    {
      path: '/dashboard',
      label: 'Dashboard',
      icon: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    },
    {
      path: '/businesses',
      label: 'Businesses',
      icon: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01',
    },
    {
      path: '/transactions',
      label: 'Transactions',
      icon: 'M17 3l4 4-4 4M21 7H9M7 21l-4-4 4-4M3 17h12',
    },
    {
      path: '/inbox',
      label: 'Inbox',
      icon: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    },
    {
      path: '/attempts',
      label: 'Attempts',
      icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
    },
    {
      path: '/providers',
      label: 'Providers',
      icon: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
    },
    {
      path: '/guide',
      label: 'Guide',
      icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-2M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
    },
    {
      path: '/settings',
      label: 'Settings',
      icon: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
    },
  ];

  let booting = $state(true);

  const pillTone = $derived.by(() => {
    if (!backend.online) return backend.online === false ? 'red' : 'grey';
    if (session.health?.db === 'up') return 'green';
    if (session.health?.db === 'down') return 'red';
    return 'grey';
  });

  const pillLabel = $derived.by(() => {
    if (backend.online === false) return 'Offline';
    if (session.health?.db === 'up') return 'Healthy';
    if (session.health?.db === 'down') return 'DB down';
    return 'Checking…';
  });

  const pageTitle = $derived.by(() => {
    if (route.name === 'business-detail') return 'Business';
    const match = NAV.find((item) => item.path === `/${route.name}`);
    return match?.label ?? 'Dashboard';
  });

  $effect(() => {
    void refresh(false);
    const timer = setInterval(() => void refresh(false), 20_000);
    return () => clearInterval(timer);
  });

  async function refresh(manual: boolean): Promise<void> {
    const metaJob = (async () => {
      try {
        session.meta = await api.getMeta();
        backend.online = true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 502) {
          backend.online = false;
        }
      }
    })();

    const healthJob = (async () => {
      const result = await backendHealth();
      session.health = result.body;
    })();

    const statsJob = auth.unlocked
      ? (async () => {
          try {
            session.stats = await api.getStats();
          } catch {
            session.stats = null;
          }
        })()
      : Promise.resolve();

    await Promise.allSettled([metaJob, healthJob, statsJob]);
    session.refreshedAt = new Date().toISOString();
    booting = false;
    if (manual) pushToast('success', 'Refreshed');
  }

  function onLockClick(): void {
    if (!auth.unlocked) return;
    lockSession();
    session.stats = null;
    pushToast('info', 'Session locked');
  }
</script>

{#if booting}
  <div class="login-screen">
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px;color:var(--text-muted);">
      <Spinner size={26} />
      <span style="font-size:12px;">Connecting to studio…</span>
    </div>
  </div>
{:else if !auth.unlocked}
  <Login />
{:else}
  <div class="shell">
    <aside class="sidebar">
      <div class="sidebar__brand">
        <span class="sidebar__logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
        </span>
        <div>
          <div class="sidebar__name">VindraPay</div>
          <div class="sidebar__sub">Studio</div>
        </div>
      </div>
      <nav class="nav">
        {#each NAV as item (item.path)}
          <a class="nav-link" class:active={isActive(item.path)} href="#{item.path}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={item.icon} /></svg>
            {item.label}
          </a>
        {/each}
      </nav>
      <div class="sidebar__foot">
        v{session.meta?.version ?? '?'}
        {#if !backend.online}
          · offline
        {/if}
      </div>
    </aside>

    <div class="main-col">
      <header class="topbar">
        <span class="topbar__title">{pageTitle}</span>
        <div class="topbar__actions">
          <span class="pill pill--{pillTone}" title="Backend health">
            <span class="dot dot--online"></span>
            {pillLabel}
          </span>
          <button type="button" class="btn btn--ghost btn--icon" title="Refresh data" onclick={() => void refresh(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
          </button>
          <button type="button" class="btn btn--ghost btn--icon" title={auth.mode === 'locked' ? 'Session protected' : 'No gate configured'} onclick={onLockClick}>
            {#if auth.mode === 'locked'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
            {/if}
          </button>
        </div>
      </header>

      {#if backend.online === false}
        <div class="offline-banner">Backend unreachable — retrying…</div>
      {/if}

      <main class="content">
        {#if route.name === 'dashboard'}
          <Dashboard />
        {:else if route.name === 'businesses'}
          <Businesses />
        {:else if route.name === 'business-detail'}
          <BusinessDetail />
        {:else if route.name === 'providers'}
          <Providers />
        {:else if route.name === 'transactions'}
          <Transactions />
        {:else if route.name === 'inbox'}
          <Inbox />
        {:else if route.name === 'attempts'}
          <Attempts />
        {:else if route.name === 'settings'}
          <Settings />
        {:else if route.name === 'guide'}
          <Guide />
        {/if}
      </main>
    </div>
  </div>

  <div class="toast-stack">
    {#each toasts.items as toast (toast.id)}
      <button
        type="button"
        class="toast toast--{toast.kind}"
        onclick={() => dismissToast(toast.id)}
      >
        <span class="toast__msg">{toast.message}</span>
      </button>
    {/each}
  </div>

  <ConfirmDialog />
{/if}
