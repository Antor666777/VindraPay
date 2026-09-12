/**
 * Standard list-endpoint payload returned by the backend.
 */
export interface Paged<T> {
  items: T[];
  total: number;
}

/** Safety valve: paginate() throws once more than this many items are collected. */
const MAX_COLLECTED_ITEMS = 10_000;

/**
 * Iterate over every item of a paginated list endpoint using an async generator.
 *
 * `fetchPage` is called repeatedly with `(limit, offset)` until either the
 * reported `total` has been collected or an empty page is returned. A runaway
 * loop (more than 10 000 collected items) aborts with a `RangeError`.
 *
 * @typeParam T - Entity type produced by the endpoint.
 * @param fetchPage - Fetches one page for the given limit/offset pair.
 * @param pageSize - Page size requested per call; defaults to `50`.
 * @yields Individual items across all pages, in backend order.
 * @example
 * ```ts
 * for await (const order of paginate((limit, offset) => listOrders({ limit, offset }))) {
 *   console.log(order.id);
 * }
 * ```
 */
export async function* paginate<T>(
  fetchPage: (limit: number, offset: number) => Promise<Paged<T>>,
  pageSize = 50,
): AsyncGenerator<T, void, undefined> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new RangeError(`vindrapay-sdk: pageSize must be a positive integer, got ${pageSize}`);
  }
  let offset = 0;
  let collected = 0;
  for (;;) {
    const page = await fetchPage(pageSize, offset);
    const items = Array.isArray(page?.items) ? page.items : [];
    for (const item of items) {
      yield item;
      collected += 1;
      if (collected > MAX_COLLECTED_ITEMS) {
        throw new RangeError(
          `vindrapay-sdk: pagination aborted after collecting more than ${MAX_COLLECTED_ITEMS} items`,
        );
      }
    }
    if (items.length === 0) {
      return;
    }
    offset += items.length;
    if (typeof page.total === "number" && collected >= page.total) {
      return;
    }
  }
}

/**
 * Collect every item of a paginated list endpoint into a single array.
 *
 * Convenience wrapper that drains {@link paginate}; inherits its termination
 * rules (reported `total`, empty page) and runaway guard.
 *
 * @typeParam T - Entity type produced by the endpoint.
 * @param fetchPage - Fetches one page for the given limit/offset pair.
 * @param pageSize - Page size requested per call; defaults to `50`.
 * @returns All items across every page, in backend order.
 * @example
 * ```ts
 * const allOrders = await paginateAll((limit, offset) => listOrders({ limit, offset }));
 * ```
 */
export async function paginateAll<T>(
  fetchPage: (limit: number, offset: number) => Promise<Paged<T>>,
  pageSize = 50,
): Promise<T[]> {
  const out: T[] = [];
  for await (const item of paginate(fetchPage, pageSize)) {
    out.push(item);
  }
  return out;
}
