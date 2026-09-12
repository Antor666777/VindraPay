import { ConflictError, VindraPayError } from "../../core/errors.js";
import type { HttpRequester } from "../../core/http.js";
import type { Order, VerifyResult } from "../../core/types.js";
import { isRecord, mapOrder, mapVerifyResult } from "../mapping.js";

/** Input for {@link OrdersMerchantResource.create}. */
export interface MerchantOrderCreateInput {
  /** Caller-supplied unique idempotency key from the merchant system. */
  externalOrderId: string;
  /** Amount the payer must send, as a decimal string (e.g. `"1500.00"`); passed through verbatim. */
  expectedAmount: string;
  /** Optional RFC3339 expiry after which the order can no longer be paid. */
  expiresAt?: string;
  /** Optional opaque JSON metadata; stored and echoed back untouched. */
  metadata?: unknown;
}

/** Input for {@link OrdersMerchantResource.verify}. */
export interface MerchantVerifyInput {
  /** TrxID extracted from the payer's SMS confirmation. */
  trxId: string;
}

/**
 * Enrich 409/422 verification failures: the backend's top-level `result`
 * discriminator becomes `error.code`, and `error.details` becomes
 * `{ result }`. Non-string results pass through untouched.
 * @internal
 */
function enrichVerifyFailure(cause: unknown): unknown {
  if (!(cause instanceof VindraPayError) || (cause.status !== 409 && cause.status !== 422)) {
    return cause;
  }
  const current = cause.details;
  let resultValue: unknown;
  if (typeof current === "string") {
    resultValue = current;
  } else if (isRecord(current) && current["result"] !== undefined) {
    resultValue = current["result"];
  }
  if (resultValue === undefined) {
    resultValue = cause.code;
  }
  if (typeof resultValue !== "string") {
    return cause;
  }
  cause.code = resultValue;
  cause.details = { ...(isRecord(current) ? current : {}), result: resultValue };
  if (!(cause instanceof ConflictError)) {
    (cause as { result?: unknown }).result = resultValue;
  }
  return cause;
}

/**
 * Merchant-domain order operations (`/api/v1/orders`).
 *
 * Requires a business API key (`vpk_...`); construct via
 * {@link VindraPay.merchant}.
 */
export class OrdersMerchantResource {
  private readonly http: HttpRequester;

  constructor(http: HttpRequester) {
    this.http = http;
  }

  /**
   * Create (or idempotently fetch) an order for the caller's business.
   * Duplicate external ids return the existing order.
   */
  async create(input: MerchantOrderCreateInput): Promise<Order> {
    const payload = await this.http.request<unknown>("POST", "/api/v1/orders", {
      body: {
        external_order_id: input.externalOrderId,
        expected_amount: input.expectedAmount,
        ...(input.expiresAt !== undefined && { expires_at: input.expiresAt }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
      },
    });
    return mapOrder(payload);
  }

  /** Load an order by its external id. Throws {@link NotFoundError} when absent. */
  async get(externalOrderId: string): Promise<Order> {
    const payload = await this.http.request<unknown>(
      "GET",
      `/api/v1/orders/${encodeURIComponent(externalOrderId)}`,
    );
    return mapOrder(payload);
  }

  /**
   * Verify a transaction TrxID against an order.
   *
   * On success returns the typed {@link VerifyResult}. On failure the backend's
   * `{success:false, result}` envelope is thrown as {@link ConflictError}
   * (HTTP 409) or {@link UnprocessableError} (HTTP 422) with:
   * - `error.code` set to the backend result discriminator (e.g. `already_used`);
   * - `error.details.result` exposing the same value structurally;
   * - `error.result` mirroring it as well on conflict errors.
   */
  async verify(externalOrderId: string, input: MerchantVerifyInput): Promise<VerifyResult> {
    try {
      const payload = await this.http.request<unknown>(
        "POST",
        `/api/v1/orders/${encodeURIComponent(externalOrderId)}/verify`,
        { body: { trx_id: input.trxId } },
      );
      return mapVerifyResult(payload);
    } catch (cause) {
      throw enrichVerifyFailure(cause);
    }
  }
}
