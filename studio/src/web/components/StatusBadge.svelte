<script lang="ts">
  type Tone = 'ok' | 'accent' | 'warn' | 'danger' | 'info' | 'muted';

  const TONES: Record<string, Tone> = {
    active: 'ok',
    paid: 'ok',
    parsed: 'ok',
    success: 'ok',
    up: 'ok',
    online: 'ok',
    pending: 'warn',
    unmatched: 'warn',
    skipped: 'warn',
    not_found: 'warn',
    credit: 'accent',
    template: 'accent',
    calibration: 'accent',
    transaction: 'info',
    regex: 'info',
    debit: 'info',
    error: 'danger',
    suspended: 'danger',
    amount_mismatch: 'danger',
    balance_mismatch: 'danger',
    wrong_direction: 'danger',
    order_not_pending: 'danger',
    order_expired: 'danger',
    already_used: 'danger',
    down: 'danger',
    expired: 'muted',
    cancelled: 'muted',
    revoked: 'muted',
  };

  let { value, dot = false }: { value: string | null | undefined; dot?: boolean } = $props();

  const tone = $derived((value && TONES[value]) || 'muted');
</script>

{#if value}
  <span class="badge badge--{tone}">
    {#if dot}<span class="dot" class:dot--online={tone === 'ok'}></span>{/if}
    {value}
  </span>
{:else}
  <span class="badge badge--muted">—</span>
{/if}
