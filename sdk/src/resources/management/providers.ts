import type { HttpRequester, QueryParams } from "../../core/http.js";
import { paginate, type Paged } from "../../core/pagination.js";
import type {
  Provider,
  ProviderMatchMode,
  TestResult,
  TransactionDirection,
} from "../../core/types.js";
import { mapProvider, mapTestResult, toList, toPaged } from "../mapping.js";

/** Filters shared by the manage-domain provider list methods. */
export interface ManageProviderListFilters {
  /** Restrict to this business (management key only). */
  businessId?: string;
  /** Filter by direction (`credit`/`debit`). */
  direction?: string;
  /** Filter by match mode (`template`/`regex`). */
  matchMode?: string;
  /** Max items per page (backend clamps to 1..100). */
  limit?: number;
  /** Zero-based offset into the result set. */
  offset?: number;
}

/** Input for {@link ProvidersManageResource.create}. */
export interface ProviderCreateInput {
  /** Owning business; `null`/omitted creates a global provider (manage key only). */
  businessId?: string | null;
  name: string;
  senderId?: string;
  smsTemplate: string;
  priority?: number;
  direction?: TransactionDirection | "both";
  matchMode?: ProviderMatchMode;
  script?: string;
}

/** Input for {@link ProvidersManageResource.updateTemplate}. */
export interface ProviderTemplateUpdateInput {
  smsTemplate: string;
  direction?: TransactionDirection | "both";
  matchMode?: ProviderMatchMode;
  script?: string;
}

/** Input for the provider template dry-run test endpoint. */
export interface ProviderTestInput {
  smsTemplate: string;
  sampleBody: string;
  matchMode?: ProviderMatchMode;
  script?: string;
}

const DEFAULT_PAGE_SIZE = 50;

function providerQuery(filters: ManageProviderListFilters): QueryParams {
  return {
    business_id: filters.businessId,
    direction: filters.direction,
    match_mode: filters.matchMode,
    limit: filters.limit,
    offset: filters.offset,
  };
}

/**
 * Management-domain access to provider templates (`/manage/v1/providers`).
 *
 * The backend list endpoint has shipped both shapes at different times (a bare
 * array and `{items,total}`); every method here normalizes either shape.
 * Requires a management key.
 */
export class ProvidersManageResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /**
   * List provider templates as a plain array, transparently normalizing the
   * backend's bare-array or `{items,total}` response.
   */
  async list(filters: ManageProviderListFilters = {}): Promise<Provider[]> {
    const payload = await this.http.request<unknown>("GET", "/manage/v1/providers", {
      query: providerQuery(filters),
    });
    return toList<unknown>(payload).map(mapProvider);
  }

  /**
   * List provider templates as `{items,total}`; when the backend answers with
   * a bare array, `total` is computed client-side from the array length.
   */
  async listPaged(filters: ManageProviderListFilters = {}): Promise<Paged<Provider>> {
    const payload = await this.http.request<unknown>("GET", "/manage/v1/providers", {
      query: providerQuery(filters),
    });
    const page = toPaged<unknown>(payload);
    return { items: page.items.map(mapProvider), total: page.total };
  }

  /** Iterate over every provider template across all pages. */
  listAll(filters: ManageProviderListFilters = {}): AsyncGenerator<Provider, void, undefined> {
    const pageSize = filters.limit ?? DEFAULT_PAGE_SIZE;
    return paginate(
      (limit, offset) => this.listPaged({ ...filters, limit, offset }),
      pageSize,
    );
  }

  /** Create a provider template (per-business or global). */
  async create(input: ProviderCreateInput): Promise<Provider> {
    const payload = await this.http.request<unknown>("POST", "/manage/v1/providers", {
      body: {
        ...(input.businessId !== undefined && input.businessId !== null
          ? { business_id: input.businessId }
          : {}),
        name: input.name,
        ...(input.senderId !== undefined && input.senderId !== "" && { sender_id: input.senderId }),
        sms_template: input.smsTemplate,
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.direction !== undefined && { direction: input.direction }),
        ...(input.matchMode !== undefined && { match_mode: input.matchMode }),
        ...(input.script !== undefined && input.script !== "" && { script: input.script }),
      },
    });
    return mapProvider(payload);
  }

  /** Replace a provider's SMS template (and optionally direction/mode/script). */
  async updateTemplate(providerId: string, input: ProviderTemplateUpdateInput): Promise<Provider> {
    const payload = await this.http.request<unknown>(
      "PUT",
      `/manage/v1/providers/${encodeURIComponent(providerId)}/template`,
      {
        body: {
          sms_template: input.smsTemplate,
          ...(input.direction !== undefined && { direction: input.direction }),
          ...(input.matchMode !== undefined && { match_mode: input.matchMode }),
          ...(input.script !== undefined && input.script !== "" && { script: input.script }),
        },
      },
    );
    return mapProvider(payload);
  }

  /** Deactivate a provider; it stops matching new messages immediately. */
  async remove(providerId: string): Promise<Provider> {
    const payload = await this.http.request<unknown>(
      "DELETE",
      `/manage/v1/providers/${encodeURIComponent(providerId)}`,
    );
    return mapProvider(payload);
  }

  /** Dry-run a template against a sample SMS body without persisting anything. */
  async test(input: ProviderTestInput): Promise<TestResult> {
    const payload = await this.http.request<unknown>("POST", "/manage/v1/providers/test", {
      body: {
        sms_template: input.smsTemplate,
        sample_body: input.sampleBody,
        ...(input.matchMode !== undefined && { match_mode: input.matchMode }),
        ...(input.script !== undefined && input.script !== "" && { script: input.script }),
      },
    });
    return mapTestResult(payload);
  }
}
