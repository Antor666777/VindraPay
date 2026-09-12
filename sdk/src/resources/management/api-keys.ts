import type { HttpRequester } from "../../core/http.js";
import { paginate, type Paged } from "../../core/pagination.js";
import type { ApiKey, ApiKeyCreated } from "../../core/types.js";
import { mapApiKey, mapApiKeyCreated } from "../mapping.js";

/** Input for {@link ApiKeysResource.create}. */
export interface ApiKeyCreateInput {
  label: string;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Management-domain access to business API keys.
 *
 * The backend returns api-key listings as a **bare array** (no `{items,total}`
 * envelope), so {@link list} computes `total` client-side. Requires a
 * management key.
 */
export class ApiKeysResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /** List a business's API keys (redacted views; never full secrets). */
  async list(businessId: string): Promise<Paged<ApiKey>> {
    const payload = await this.http.request<unknown>(
      "GET",
      `/manage/v1/businesses/${encodeURIComponent(businessId)}/api-keys`,
    );
    const items = Array.isArray(payload) ? payload.map(mapApiKey) : [];
    return { items, total: items.length };
  }

  /**
   * Iterate over every API key of the business. The endpoint is unpaginated,
   * so pages are sliced client-side from a single fetch.
   */
  listAll(businessId: string, pageSize = DEFAULT_PAGE_SIZE): AsyncGenerator<ApiKey, void, undefined> {
    return paginate(async (limit, offset) => {
      const page = await this.list(businessId);
      return { items: page.items.slice(offset, offset + limit), total: page.total };
    }, pageSize);
  }

  /**
   * Issue a new API key. The raw `token` is returned exactly once and cannot
   * be retrieved afterwards.
   */
  async create(businessId: string, input: ApiKeyCreateInput): Promise<ApiKeyCreated> {
    const payload = await this.http.request<unknown>(
      "POST",
      `/manage/v1/businesses/${encodeURIComponent(businessId)}/api-keys`,
      { body: { label: input.label } },
    );
    return mapApiKeyCreated(payload);
  }

  /** Revoke an API key permanently. */
  async revoke(keyId: string): Promise<ApiKey> {
    const payload = await this.http.request<unknown>(
      "DELETE",
      `/manage/v1/api-keys/${encodeURIComponent(keyId)}`,
    );
    return mapApiKey(payload);
  }
}
