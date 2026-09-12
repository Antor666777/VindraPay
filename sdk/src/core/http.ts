import { NetworkError, RateLimitError, VindraPayError, isRetryable } from "./errors.js";

/**
 * HTTP verbs supported by {@link HttpRequester.request}.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

/**
 * Query-string values accepted by {@link HttpRequester.request}; `undefined` and
 * empty strings are skipped entirely.
 */
export type QueryParams = Record<string, string | number | undefined>;

/**
 * Per-call options for {@link HttpRequester.request}.
 */
export interface RequestOptions {
  /** Query parameters; `undefined` and `""` entries are omitted and the rest URL-encoded. */
  query?: QueryParams;
  /** Payload serialized as JSON (unless GET/HEAD, where it is dropped). */
  body?: unknown;
}

/**
 * Retry policy for {@link HttpRequester}. Only `GET`/`HEAD` requests are ever
 * retried, and only on network errors or `408`/`429`/`5xx` responses.
 */
export interface RetryOptions {
  /** Number of retry attempts after the first try; defaults to `2`. */
  retries?: number;
  /** Base delay in milliseconds for exponential backoff (`base * 2^attempt`, jittered ±20%); defaults to `300`. */
  backoffBaseMs?: number;
}

/**
 * Construction options for {@link HttpRequester}.
 */
export interface HttpRequesterConfig {
  /**
   * API base URL. Must be an absolute `http(s)` URL; trailing slashes are stripped.
   * @example `"https://api.vindrapay.com"`
   */
  baseUrl: string;
  /** API key injected as the `Authorization` header when present. */
  apiKey?: string;
  /** Authorization scheme prefix; defaults to `"Bearer"`. */
  authScheme?: string;
  /**
   * Per-request timeout in milliseconds. The budget covers all retry attempts
   * combined; each attempt receives an abort signal bounded by the remaining
   * time. Defaults to `10_000`.
   */
  timeoutMs?: number;
  /** Retry policy overrides. */
  retry?: RetryOptions;
  /** Fetch implementation override (testing / custom agents); defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface ResolvedConfig {
  baseUrl: string;
  apiKey?: string;
  authScheme: string;
  timeoutMs: number;
  retries: number;
  backoffBaseMs: number;
  fetchImpl: typeof fetch;
}

const DEFAULT_AUTH_SCHEME = "Bearer";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_BASE_MS = 300;
const IDEMPOTENT_METHODS = new Set<HttpMethod>(["GET", "HEAD"]);
const JITTER_FACTOR = 0.2;

function assertNoControlChars(value: string, label: string): void {
  if (/[\r\n]/.test(value)) {
    throw new TypeError(`vindrapay-sdk: ${label} must not contain CR/LF characters`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeQuery(query: QueryParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") {
      continue;
    }
    params.append(key, String(value));
  }
  return params.toString();
}

function unwrapSuccessEnvelope(json: unknown): unknown {
  if (isRecord(json) && json["success"] === true && "data" in json) {
    return json["data"];
  }
  return json;
}

function toNetworkError(cause: unknown): NetworkError {
  const isTimeout =
    cause instanceof Error &&
    (cause.name === "TimeoutError" || cause.name === "AbortError");
  return new NetworkError(isTimeout ? "Request timed out" : "Network request failed", {
    cause,
  });
}

async function parseSuccessBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.trim() === "") {
    return undefined as T;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new NetworkError("Received malformed JSON from the API", { cause });
  }
  return unwrapSuccessEnvelope(json) as T;
}

async function toResponseError(response: Response): Promise<VindraPayError> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  const error = VindraPayError.fromUpstream(response.status, payload);
  if (error instanceof RateLimitError) {
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    if (Number.isFinite(retryAfter)) {
      error.retryAfterSeconds = retryAfter;
    }
  }
  return error;
}

/**
 * Low-level JSON transport shared by every resource client.
 *
 * Responsibilities:
 * - injects `Authorization: <scheme> <apiKey>` (rejecting CR/LF injection);
 * - JSON-encodes request bodies with the correct content type;
 * - builds query strings, skipping `undefined`/empty values and URL-encoding the rest;
 * - unwraps success envelopes of the shape `{ success: true, data }`;
 * - maps non-2xx responses onto the typed error hierarchy in `core/errors.ts`;
 * - retries idempotent (`GET`/`HEAD`) requests on network errors or
 *   `408`/`429`/`5xx` responses with jittered exponential backoff, honoring
 *   `Retry-After` on `429`, all within a single total timeout budget.
 *
 * @example
 * ```ts
 * const http = new HttpRequester({ baseUrl: "https://api.vindrapay.com", apiKey: "vsk_live_..." });
 * const order = await http.request<Order>("GET", "/v1/orders/123");
 * ```
 */
export class HttpRequester {
  private readonly config: ResolvedConfig;

  constructor(config: HttpRequesterConfig) {
    if (!isRecord(config)) {
      throw new TypeError("vindrapay-sdk: config object is required");
    }
    if (typeof config.baseUrl !== "string" || config.baseUrl.trim() === "") {
      throw new TypeError("vindrapay-sdk: baseUrl must be a non-empty string");
    }
    const normalizedBase = config.baseUrl.replace(/\/+$/, "");
    let parsed: URL;
    try {
      parsed = new URL(normalizedBase);
    } catch {
      throw new TypeError(`vindrapay-sdk: baseUrl is not a valid URL: ${config.baseUrl}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TypeError(
        `vindrapay-sdk: baseUrl must use http or https, got '${parsed.protocol}'`,
      );
    }

    const authScheme = config.authScheme ?? DEFAULT_AUTH_SCHEME;
    assertNoControlChars(authScheme, "authScheme");

    let apiKey: string | undefined;
    if (config.apiKey !== undefined) {
      assertNoControlChars(config.apiKey, "apiKey");
      apiKey = config.apiKey;
    }

    this.config = {
      baseUrl: normalizedBase,
      ...(apiKey !== undefined && { apiKey }),
      authScheme,
      timeoutMs: resolvePositiveInt(config.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs"),
      retries: Math.max(0, Math.trunc(config.retry?.retries ?? DEFAULT_RETRIES)),
      backoffBaseMs: Math.max(0, config.retry?.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS),
      fetchImpl: config.fetchImpl ?? fetch,
    };
  }

  /**
   * Perform an HTTP request against the configured base URL.
   *
   * @typeParam T - Expected shape of the response payload.
   * @param method - HTTP verb.
   * @param path - Endpoint path relative to the base URL (leading slash optional).
   * @param opts - Optional query parameters and JSON body.
   * @returns The parsed response body; `{ success: true, data }` envelopes are
   * unwrapped to their `data` payload, other bodies are returned verbatim.
   * @throws {ValidationError} On `400`.
   * @throws {AuthenticationError} On `401`.
   * @throws {PermissionError} On `403`.
   * @throws {NotFoundError} On `404`.
   * @throws {ConflictError} On `409`.
   * @throws {UnprocessableError} On `422`.
   * @throws {RateLimitError} On `429`.
   * @throws {ServerError} On `5xx`.
   * @throws {NetworkError} When no HTTP response could be obtained (including timeout).
   */
  async request<T>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const cfg = this.config;
    const url = this.buildUrl(path, opts.query);
    const idempotent = IDEMPOTENT_METHODS.has(method);
    const deadline = Date.now() + cfg.timeoutMs;
    const maxAttempts = cfg.retries + 1;

    const headers: Record<string, string> = { Accept: "application/json" };
    if (cfg.apiKey !== undefined) {
      headers.Authorization = `${cfg.authScheme} ${cfg.apiKey}`;
    }
    let requestBody: string | undefined;
    if (!idempotent && opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      requestBody = JSON.stringify(opts.body);
    }

    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new NetworkError(`Request timed out after ${cfg.timeoutMs}ms`);
      }

      let response: Response;
      try {
        response = await cfg.fetchImpl.call(globalThis, url, {
          method,
          headers,
          ...(requestBody !== undefined && { body: requestBody }),
          signal: AbortSignal.timeout(remaining),
        });
      } catch (cause) {
        const error = toNetworkError(cause);
        if (!idempotent || attempt >= maxAttempts - 1) {
          throw error;
        }
        await this.delayFor(attempt, deadline, error);
        continue;
      }

      if (response.ok) {
        return parseSuccessBody<T>(response);
      }

      const error = await toResponseError(response);
      if (!isRetryable(error) || !idempotent || attempt >= maxAttempts - 1) {
        throw error;
      }
      await this.delayFor(attempt, deadline, error);
    }
  }

  private buildUrl(path: string, query?: QueryParams): string {
    const cleanedPath = path.replace(/^\/+/, "");
    let url = `${this.config.baseUrl}/${cleanedPath}`;
    if (query) {
      const queryString = encodeQuery(query);
      if (queryString.length > 0) {
        url += (url.includes("?") ? "&" : "?") + queryString;
      }
    }
    return url;
  }

  private async delayFor(attempt: number, deadline: number, error: VindraPayError | NetworkError): Promise<void> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return;
    }
    let delayMs: number;
    if (error instanceof RateLimitError && error.retryAfterSeconds !== undefined) {
      delayMs = error.retryAfterSeconds * 1000;
    } else {
      delayMs = this.config.backoffBaseMs * 2 ** attempt;
    }
    const jitter = 1 + (Math.random() * 2 - 1) * JITTER_FACTOR;
    delayMs = Math.min(delayMs * jitter, remaining);
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }
}

function resolvePositiveInt(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0 || !Number.isInteger(resolved)) {
    throw new RangeError(`vindrapay-sdk: ${label} must be a positive integer`);
  }
  return resolved;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
