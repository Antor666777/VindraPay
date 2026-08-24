<script lang="ts">
  let {
    label,
    value,
    tone = 'default',
  }: {
    label: string;
    value: string | number;
    tone?: 'default' | 'accent' | 'danger';
  } = $props();
</script>

<div class="stat-card" class:stat-card--accent={tone === 'accent'} class:stat-card--danger={tone === 'danger'}>
  <div class="stat-card__label">{label}</div>
  <div class="stat-card__value">{value}</div>
</div>
