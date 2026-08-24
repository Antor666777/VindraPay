<script lang="ts">
  let { title, hint }: { title: string; hint?: string } = $props();
</script>

<div class="empty-state">
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
  <div class="empty-state__title">{title}</div>
  {#if hint}<div class="empty-state__hint">{hint}</div>{/if}
</div>
