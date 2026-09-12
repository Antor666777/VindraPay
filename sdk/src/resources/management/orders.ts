import type { HttpRequester, QueryParams } from "../../core/http.js";
import { paginate, type Paged } from "../../core/pagination.js";
import type { Order } from "../../core/types.js";
import { mapOrder } from "../mapping.js";
import { fetchPaged } from "./paged.js";

/** Filters for {@link OrdersMgmtResource.list}. */
export interface MgmtOrderListFilters {
  /** Restrict to this business. */
  businessId?: string;
  /** Filter by lifecycle status (`pending`/`paid`/`expired`/`cancelled`). */
  status?: string;
  /** Max items per page (backend clamps to 1..100). */
  limit?: number;
  /** Zero-based offset into the result set. */
  offset?: number;
}

const DEFAULT_PAGE_SIZE = 50;

/** Management-domain cross-business order listing (`GET /manage/v1/orders`). */
export class OrdersMgmtResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /** Fetch one page of orders as `{items,total}`. */
  async list(filters: MgmtOrderListFilters = {}): Promise<Paged<Order>> {
    const query: QueryParams = {
      business_id: filters.businessId,
      status: filters.status,
      limit: filters.limit,
      offset: filters.offset,
    };
    return fetchPaged(this.http, "/manage/v1/orders", query, mapOrder);
  }

  /** Iterate over every order across all pages. */
  listAll(filters: MgmtOrderListFilters = {}): AsyncGenerator<Order, void, undefined> {
    const pageSize = filters.limit ?? DEFAULT_PAGE_SIZE;
    return paginate(
      (limit, offset) => this.list({ ...filters, limit, offset }),
      pageSize,
    );
  }
}
