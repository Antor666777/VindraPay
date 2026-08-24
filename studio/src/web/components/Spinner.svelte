<script lang="ts">
  let { size = 18 }: { size?: number } = $props();
</script>

<span
  class="spinner"
  style="width:{size}px;height:{size}px;display:inline-block;"
  role="status"
  aria-label="Loading"
></span>
