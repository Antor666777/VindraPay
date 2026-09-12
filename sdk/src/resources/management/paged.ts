import type { HttpRequester, QueryParams } from "../../core/http.js";
import type { Paged } from "../../core/pagination.js";

/** Fetch one `{items,total}` page and map each wire item to its entity. @internal */
export async function fetchPaged<T>(
  http: HttpRequester,
  path: string,
  query: QueryParams,
  mapItem: (raw: unknown) => T,
): Promise<Paged<T>> {
  const payload = await http.request<unknown>("GET", path, { query });
  const record = (typeof payload === "object" && payload !== null ? payload : {}) as {
    items?: unknown[];
    total?: number;
  };
  return {
    items: (record.items ?? []).map(mapItem),
    total: record.total ?? record.items?.length ?? 0,
  };
}
