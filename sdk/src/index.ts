import { HttpRequester } from "./core/http.js";
import type { RetryOptions } from "./core/http.js";
import type {
  HeartbeatResult,
  InboundMessage,
  IngestResult,
} from "./core/types.js";
import { DeviceResource } from "./resources/device/device.js";
import type { HeartbeatInput } from "./resources/device/device.js";
import { ApiKeysResource } from "./resources/management/api-keys.js";
import { AttemptsResource } from "./resources/management/attempts.js";
import { BusinessesResource } from "./resources/management/businesses.js";
import { DevicesResource } from "./resources/management/devices.js";
import { FeaturesResource } from "./resources/management/features.js";
import { MessagesResource } from "./resources/management/messages.js";
import { OrdersMgmtResource } from "./resources/management/orders.js";
import { ProvidersManageResource } from "./resources/management/providers.js";
import { StatsResource } from "./resources/management/stats.js";
import { TransactionsResource } from "./resources/management/transactions.js";
import { DevicesMerchantResource } from "./resources/merchant/devices.js";
import { OrdersMerchantResource } from "./resources/merchant/orders.js";
import { ProvidersMerchantResource } from "./resources/merchant/providers.js";

export { HttpRequester } from "./core/http.js";
export type {
  HttpMethod,
  HttpRequesterConfig,
  QueryParams,
  RequestOptions,
  RetryOptions,
} from "./core/http.js";

export {
  AuthenticationError,
  ConflictError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  UnprocessableError,
  ValidationError,
  VindraPayError,
  isRetryable,
} from "./core/errors.js";
export type {
  ConflictErrorOptions,
  ServerErrorOptions,
  VindraPayErrorOptions,
} from "./core/errors.js";

export { paginate, paginateAll } from "./core/pagination.js";
export type { Paged } from "./core/pagination.js";

export type {
  ApiKey,
  ApiKeyCreated,
  BalancePoint,
  Business,
  Calibration,
  DeviceCreated,
  DeviceView,
  Features,
  HeartbeatProvider,
  HeartbeatResult,
  InboundMessage,
  IngestResult,
  IngestStatus,
  Order,
  OrderStatus,
  Provider,
  ProviderMatchMode,
  RawMessage,
  RawMessageParseStatus,
  ResultUnion,
  StudioStats,
  TestResult,
  Transaction,
  TransactionDirection,
  VerificationAttempt,
  VerifyResult,
} from "./core/types.js";

export { VERSION } from "./version.js";

export {
  ApiKeysResource,
  AttemptsResource,
  BusinessesResource,
  DeviceResource,
  DevicesMerchantResource,
  DevicesResource,
  FeaturesResource,
  MessagesResource,
  OrdersMerchantResource,
  OrdersMgmtResource,
  ProvidersManageResource,
  ProvidersMerchantResource,
  StatsResource,
  TransactionsResource,
} from "./resources/index.js";

export type {
  AttemptListFilters,
  BusinessCreateInput,
  BusinessListFilters,
  CalibrateBalanceInput,
  DeviceListFilters,
  DeviceRegisterInput,
  ManageProviderListFilters,
  MessageListFilters,
  MerchantCalibrateBalanceInput,
  MerchantOrderCreateInput,
  MerchantProviderCreateInput,
  MerchantProviderTemplateUpdateInput,
  MerchantProviderTestInput,
  MerchantVerifyInput,
  MgmtOrderListFilters,
  ProviderCreateInput,
  ProviderTemplateUpdateInput,
  ProviderTestInput,
  TransactionListFilters,
} from "./resources/index.js";

/**
 * Per-credential bundle of resource clients for the management domain
 * (authenticates with the platform management key).
 */
export interface ManagementClient {
  businesses: BusinessesResource;
  apiKeys: ApiKeysResource;
  devices: DevicesResource;
  orders: OrdersMgmtResource;
  transactions: TransactionsResource;
  attempts: AttemptsResource;
  messages: MessagesResource;
  stats: StatsResource;
  features: FeaturesResource;
  providers: ProvidersManageResource;
}

/** Per-credential bundle of resource clients for the merchant domain. */
export interface MerchantClient {
  orders: OrdersMerchantResource;
  providers: ProvidersMerchantResource;
  devices: DevicesMerchantResource;
}

/** Per-credential bundle of resource clients for the device domain. */
export interface DeviceClient {
  /** Report liveness and fetch active providers; see {@link DeviceResource.heartbeat}. */
  heartbeat(input?: HeartbeatInput): Promise<HeartbeatResult>;
  /** Submit 1..50 inbound SMS for parsing; see {@link DeviceResource.sendMessages}. */
  sendMessages(messages: readonly InboundMessage[]): Promise<IngestResult[]>;
}

/**
 * Construction options for {@link VindraPay}.
 */
export interface VindraPayOptions {
  /** API base URL, e.g. `"https://api.vindrapay.com"`. */
  baseUrl: string;
  /** Per-request timeout in milliseconds; defaults to `10_000`. */
  timeoutMs?: number;
  /** Retry policy overrides applied to every request made by this client. */
  retry?: Partial<RetryOptions>;
  /** Fetch implementation override (testing / custom agents); defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface CredentialBundle {
  requester: HttpRequester;
  management?: ManagementClient;
  merchant?: MerchantClient;
  device?: DeviceClient;
}

/**
 * Entry point of vindrapay-sdk.
 *
 * One `VindraPay` instance holds a single shared {@link HttpRequester} per
 * credential string, so calling an accessor repeatedly with the same key
 * reuses the same underlying client bundle.
 *
 * @example
 * ```ts
 * const vindra = new VindraPay({ baseUrl: "https://api.vindrapay.com" });
 *
 * const order = await vindra.merchant("vpk_live_...").orders.create({
 *   externalOrderId: "order-1001",
 *   expectedAmount: "1500.00",
 * });
 * ```
 */
export class VindraPay {
  private readonly options: VindraPayOptions;
  private readonly bundles = new Map<string, CredentialBundle>();

  constructor(options: VindraPayOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("vindrapay-sdk: options object is required");
    }
    this.options = options;
  }

  /**
   * Merchant-domain clients keyed by a business API key (`vpk_...`):
   * `orders`, `providers`, `devices`.
   */
  merchant(apiKey: string): MerchantClient {
    const bundle = this.bundleFor(apiKey);
    bundle.merchant ??= {
      orders: new OrdersMerchantResource(bundle.requester),
      providers: new ProvidersMerchantResource(bundle.requester),
      devices: new DevicesMerchantResource(bundle.requester),
    };
    return bundle.merchant;
  }

  /**
   * Device-domain client keyed by a device pairing token (`vdt_...`):
   * `heartbeat`, `sendMessages`.
   */
  device(token: string): DeviceClient {
    const bundle = this.bundleFor(token);
    if (bundle.device === undefined) {
      const resource = new DeviceResource(bundle.requester);
      bundle.device = {
        heartbeat: (input: HeartbeatInput = {}) => resource.heartbeat(input),
        sendMessages: (messages: readonly InboundMessage[]) => resource.sendMessages(messages),
      };
    }
    return bundle.device;
  }

  /**
   * Management-domain clients keyed by the platform management key:
   * `businesses`, `apiKeys`, `devices`, `orders`, `transactions`, `attempts`,
   * `messages`, `stats`, `features`, `providers`.
   */
  management(key: string): ManagementClient {
    const bundle = this.bundleFor(key);
    bundle.management ??= {
      businesses: new BusinessesResource(bundle.requester),
      apiKeys: new ApiKeysResource(bundle.requester),
      devices: new DevicesResource(bundle.requester),
      orders: new OrdersMgmtResource(bundle.requester),
      transactions: new TransactionsResource(bundle.requester),
      attempts: new AttemptsResource(bundle.requester),
      messages: new MessagesResource(bundle.requester),
      stats: new StatsResource(bundle.requester),
      features: new FeaturesResource(bundle.requester),
      providers: new ProvidersManageResource(bundle.requester),
    };
    return bundle.management;
  }

  private bundleFor(credential: string): CredentialBundle {
    let bundle = this.bundles.get(credential);
    if (bundle === undefined) {
      bundle = { requester: this.buildRequester(credential) };
      this.bundles.set(credential, bundle);
    }
    return bundle;
  }

  private buildRequester(apiKey: string): HttpRequester {
    return new HttpRequester({
      baseUrl: this.options.baseUrl,
      apiKey,
      ...(this.options.timeoutMs !== undefined && { timeoutMs: this.options.timeoutMs }),
      ...(this.options.retry !== undefined && { retry: this.options.retry }),
      ...(this.options.fetchImpl !== undefined && { fetchImpl: this.options.fetchImpl }),
    });
  }
}
