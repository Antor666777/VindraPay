import type { HttpRequester, QueryParams } from "../../core/http.js";
import { paginate, type Paged } from "../../core/pagination.js";
import type { Transaction } from "../../core/types.js";
import { mapTransaction } from "../mapping.js";
import { fetchPaged } from "./paged.js";

/** Filters for {@link TransactionsResource.list}. */
export interface TransactionListFilters {
  /** Restrict to this business. */
  businessId?: string;
  /** Restrict to transactions parsed by this provider template. */
  providerId?: string;
  /** Filter by money-movement direction (`credit`/`debit`). */
  direction?: string;
  /** Max items per page (backend clamps to 1..100). */
  limit?: number;
  /** Zero-based offset into the result set. */
  offset?: number;
}

const DEFAULT_PAGE_SIZE = 50;

/** Management-domain transaction listing (`GET /manage/v1/transactions`). */
export class TransactionsResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /** Fetch one page of transactions as `{items,total}`. */
  async list(filters: TransactionListFilters = {}): Promise<Paged<Transaction>> {
    const query: QueryParams = {
      business_id: filters.businessId,
      provider_id: filters.providerId,
      direction: filters.direction,
      limit: filters.limit,
      offset: filters.offset,
    };
    return fetchPaged(this.http, "/manage/v1/transactions", query, mapTransaction);
  }

  /** Iterate over every transaction across all pages. */
  listAll(filters: TransactionListFilters = {}): AsyncGenerator<Transaction, void, undefined> {
    const pageSize = filters.limit ?? DEFAULT_PAGE_SIZE;
    return paginate(
      (limit, offset) => this.list({ ...filters, limit, offset }),
      pageSize,
    );
  }
}
