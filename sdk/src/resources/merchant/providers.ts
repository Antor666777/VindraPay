import type { HttpRequester } from "../../core/http.js";
import { paginate } from "../../core/pagination.js";
import type { Provider, ProviderMatchMode, TestResult, TransactionDirection } from "../../core/types.js";
import { mapProvider, mapTestResult, toList } from "../mapping.js";

/** Input for {@link ProvidersMerchantResource.create}. */
export interface MerchantProviderCreateInput {
  name: string;
  senderId?: string;
  smsTemplate: string;
  priority?: number;
  direction?: TransactionDirection | "both";
  matchMode?: ProviderMatchMode;
  script?: string;
}

/** Input for {@link ProvidersMerchantResource.updateTemplate}. */
export interface MerchantProviderTemplateUpdateInput {
  smsTemplate: string;
  direction?: TransactionDirection | "both";
  matchMode?: ProviderMatchMode;
  script?: string;
}

/** Input for {@link ProvidersMerchantResource.test}; identical to the manage-domain variant. */
export interface MerchantProviderTestInput {
  smsTemplate: string;
  sampleBody: string;
  matchMode?: ProviderMatchMode;
  script?: string;
}

const DEFAULT_PAGE_SIZE = 50;

function providerBody(input: MerchantProviderCreateInput): Record<string, unknown> {
  return {
    name: input.name,
    ...(input.senderId !== undefined && input.senderId !== "" && { sender_id: input.senderId }),
    sms_template: input.smsTemplate,
    ...(input.priority !== undefined && { priority: input.priority }),
    ...(input.direction !== undefined && { direction: input.direction }),
    ...(input.matchMode !== undefined && { match_mode: input.matchMode }),
    ...(input.script !== undefined && input.script !== "" && { script: input.script }),
  };
}

/**
 * Merchant-domain access to the caller's own (plus global) provider templates
 * under `/api/v1/providers`.
 *
 * The backend returns `GET /api/v1/providers` as a **bare array** (own +
 * global providers); {@link list} normalizes either a bare array or an
 * `{items,total}` payload into a plain array. Requires a business API key.
 */
export class ProvidersMerchantResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /** List the business's own plus global providers as a plain array. */
  async list(): Promise<Provider[]> {
    const payload = await this.http.request<unknown>("GET", "/api/v1/providers");
    return toList<unknown>(payload).map(mapProvider);
  }

  /**
   * Iterate over every visible provider. The endpoint is unpaginated, so
   * pages are sliced client-side from a single fetch.
   */
  listAll(pageSize = DEFAULT_PAGE_SIZE): AsyncGenerator<Provider, void, undefined> {
    return paginate(async (limit, offset) => {
      const items = await this.list();
      return { items: items.slice(offset, offset + limit), total: items.length };
    }, pageSize);
  }

  /** Load a single visible provider by id. */
  async get(providerId: string): Promise<Provider> {
    const payload = await this.http.request<unknown>(
      "GET",
      `/api/v1/providers/${encodeURIComponent(providerId)}`,
    );
    return mapProvider(payload);
  }

  /** Create a provider template owned by the authenticated business. */
  async create(input: MerchantProviderCreateInput): Promise<Provider> {
    const payload = await this.http.request<unknown>("POST", "/api/v1/providers", {
      body: providerBody(input),
    });
    return mapProvider(payload);
  }

  /** Replace a provider's SMS template. */
  async updateTemplate(providerId: string, input: MerchantProviderTemplateUpdateInput): Promise<Provider> {
    const payload = await this.http.request<unknown>(
      "PUT",
      `/api/v1/providers/${encodeURIComponent(providerId)}/template`,
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

  /** Deactivate one of the business's providers. */
  async remove(providerId: string): Promise<Provider> {
    const payload = await this.http.request<unknown>(
      "DELETE",
      `/api/v1/providers/${encodeURIComponent(providerId)}`,
    );
    return mapProvider(payload);
  }

  /** Dry-run a template against a sample SMS body; identical semantics to the manage endpoint. */
  async test(input: MerchantProviderTestInput): Promise<TestResult> {
    const payload = await this.http.request<unknown>("POST", "/api/v1/providers/test", {
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
