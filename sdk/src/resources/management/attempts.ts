import type { HttpRequester, QueryParams } from "../../core/http.js";
import { paginate, type Paged } from "../../core/pagination.js";
import type { VerificationAttempt } from "../../core/types.js";
import { mapVerificationAttempt } from "../mapping.js";
import { fetchPaged } from "./paged.js";

/** Filters for {@link AttemptsResource.list}. */
export interface AttemptListFilters {
  /** Restrict to this business. */
  businessId?: string;
  /** Filter by verification outcome (e.g. `success`, `already_used`). */
  result?: string;
  /** Match attempts whose submitted TrxID equals this value (wire param `trx_id`). */
  trxId?: string;
  /** Max items per page (backend clamps to 1..100). */
  limit?: number;
  /** Zero-based offset into the result set. */
  offset?: number;
}

const DEFAULT_PAGE_SIZE = 50;

/** Management-domain verification-attempt listing (`GET /manage/v1/attempts`). */
export class AttemptsResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /** Fetch one page of verification attempts as `{items,total}`. */
  async list(filters: AttemptListFilters = {}): Promise<Paged<VerificationAttempt>> {
    const query: QueryParams = {
      business_id: filters.businessId,
      result: filters.result,
      trx_id: filters.trxId,
      limit: filters.limit,
      offset: filters.offset,
    };
    return fetchPaged(this.http, "/manage/v1/attempts", query, mapVerificationAttempt);
  }

  /** Iterate over every verification attempt across all pages. */
  listAll(filters: AttemptListFilters = {}): AsyncGenerator<VerificationAttempt, void, undefined> {
    const pageSize = filters.limit ?? DEFAULT_PAGE_SIZE;
    return paginate(
      (limit, offset) => this.list({ ...filters, limit, offset }),
      pageSize,
    );
  }
}
