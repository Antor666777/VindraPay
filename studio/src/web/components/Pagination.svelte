<script lang="ts">
  let {
    total = 0,
    limit = 20,
    offset = 0,
    onPage,
  }: {
    total?: number;
    limit?: number;
    offset?: number;
    onPage: (offset: number) => void;
  } = $props();

  const page = $derived(Math.floor(offset / limit) + 1);
  const pageCount = $derived(Math.max(1, Math.ceil(total / limit)));
  const from = $derived(total === 0 ? 0 : offset + 1);
  const to = $derived(Math.min(total, offset + limit));
</script>

{#if total > 0 || offset > 0}
  <div class="pagination">
    <span>
      Showing {from}–{to} of {total}
    </span>
    <div class="pagination__btns">
      <button
        type="button"
        class="btn btn--small"
        disabled={page <= 1}
        onclick={() => onPage(Math.max(0, offset - limit))}
      >
        Prev
      </button>
      <span class="pagination__page">Page {page} of {pageCount}</span>
      <button
        type="button"
        class="btn btn--small"
        disabled={offset + limit >= total}
        onclick={() => onPage(offset + limit)}
      >
        Next
      </button>
    </div>
  </div>
{/if}
