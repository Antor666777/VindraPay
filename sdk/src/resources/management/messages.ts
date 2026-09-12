import type { HttpRequester, QueryParams } from "../../core/http.js";
import { paginate, type Paged } from "../../core/pagination.js";
import type { RawMessage } from "../../core/types.js";
import { mapRawMessage } from "../mapping.js";
import { fetchPaged } from "./paged.js";

/** Filters for {@link MessagesResource.list}. */
export interface MessageListFilters {
  /** Restrict to this business. */
  businessId?: string;
  /** Filter by parse pipeline state (`pending`/`parsed`/`unmatched`/`error`/`skipped`). */
  parseStatus?: string;
  /** Max items per page (backend clamps to 1..100). */
  limit?: number;
  /** Zero-based offset into the result set. */
  offset?: number;
}

const DEFAULT_PAGE_SIZE = 50;

/** Management-domain raw-message listing (`GET /manage/v1/messages`). */
export class MessagesResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /** Fetch one page of raw messages as `{items,total}`. */
  async list(filters: MessageListFilters = {}): Promise<Paged<RawMessage>> {
    const query: QueryParams = {
      business_id: filters.businessId,
      parse_status: filters.parseStatus,
      limit: filters.limit,
      offset: filters.offset,
    };
    return fetchPaged(this.http, "/manage/v1/messages", query, mapRawMessage);
  }

  /** Iterate over every raw message across all pages. */
  listAll(filters: MessageListFilters = {}): AsyncGenerator<RawMessage, void, undefined> {
    const pageSize = filters.limit ?? DEFAULT_PAGE_SIZE;
    return paginate(
      (limit, offset) => this.list({ ...filters, limit, offset }),
      pageSize,
    );
  }
}
