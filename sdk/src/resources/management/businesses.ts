import type { HttpRequester, QueryParams } from "../../core/http.js";
import { paginate, type Paged } from "../../core/pagination.js";
import type { Business } from "../../core/types.js";
import { mapBusiness } from "../mapping.js";

/** Filters for {@link BusinessesResource.list}. */
export interface BusinessListFilters {
  /** Max items per page (backend clamps to 1..100). */
  limit?: number;
  /** Zero-based offset into the result set. */
  offset?: number;
  /** Filter by lifecycle status (`active`/`suspended`). */
  status?: string;
  /** Case-insensitive substring match on business name/email. */
  search?: string;
}

/** Input for {@link BusinessesResource.create}. */
export interface BusinessCreateInput {
  name: string;
  ownerEmail: string;
}

const BASE = "/manage/v1/businesses";
const DEFAULT_PAGE_SIZE = 50;

/**
 * Management-domain access to business accounts (`/manage/v1/businesses`).
 *
 * Requires a management key; construct via {@link VindraPay.management} or with
 * an {@link HttpRequester} configured with the management credential.
 */
export class BusinessesResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /** Fetch one page of businesses as `{items,total}`. */
  async list(filters: BusinessListFilters = {}): Promise<Paged<Business>> {
    const query: QueryParams = {
      limit: filters.limit,
      offset: filters.offset,
      status: filters.status,
      search: filters.search,
    };
    const payload = await this.http.request<unknown>("GET", BASE, { query });
    const record = payload as { items?: unknown[]; total?: number };
    return {
      items: (record.items ?? []).map(mapBusiness),
      total: record.total ?? record.items?.length ?? 0,
    };
  }

  /** Iterate over every business across all pages. */
  listAll(filters: BusinessListFilters = {}): AsyncGenerator<Business, void, undefined> {
    const pageSize = filters.limit ?? DEFAULT_PAGE_SIZE;
    return paginate(
      (limit, offset) => this.list({ ...filters, limit, offset }),
      pageSize,
    );
  }

  /** Load a single business by id. */
  async get(businessId: string): Promise<Business> {
    const payload = await this.http.request<unknown>("GET", `${BASE}/${encodeURIComponent(businessId)}`);
    return mapBusiness(payload);
  }

  /** Register a new business owned by `ownerEmail`. */
  async create(input: BusinessCreateInput): Promise<Business> {
    const payload = await this.http.request<unknown>("POST", BASE, {
      body: { name: input.name, owner_email: input.ownerEmail },
    });
    return mapBusiness(payload);
  }

  /** Activate or suspend a business. */
  async setStatus(businessId: string, status: "active" | "suspended"): Promise<Business> {
    const payload = await this.http.request<unknown>(
      "PATCH",
      `${BASE}/${encodeURIComponent(businessId)}/status`,
      { body: { status } },
    );
    return mapBusiness(payload);
  }
}
