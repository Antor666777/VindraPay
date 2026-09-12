/**
 * Options accepted by every {@link VindraPayError} subclass constructor.
 */
export interface VindraPayErrorOptions {
  /** Machine-readable error code supplied by the backend `result` field (e.g. `already_used`). */
  code?: string;
  /** Arbitrary structured payload preserved from the upstream response for debugging. */
  details?: unknown;
  /** Underlying low-level cause (network failure, parse failure, ...). */
  cause?: unknown;
}

/**
 * Options accepted by the {@link ConflictError} constructor.
 */
export interface ConflictErrorOptions extends VindraPayErrorOptions {
  /**
   * Backend conflict discriminator (`result` field), e.g. `already_used` or
   * `wrong_direction`. Mirrored verbatim onto {@link ConflictError.result}.
   */
  result?: unknown;
}

/**
 * Options accepted by the {@link ServerError} constructor.
 */
export interface ServerErrorOptions extends VindraPayErrorOptions {
  /** Concrete HTTP status in the `5xx` range; defaults to `500`. */
  status?: number;
}

const FALLBACK_MESSAGES: Record<number, string> = {
  400: "Bad request",
  401: "Authentication required",
  403: "Permission denied",
  404: "Resource not found",
  409: "Conflict",
  422: "Unprocessable entity",
  429: "Rate limit exceeded",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ExtractedPayload {
  message?: string;
  code?: string;
  details?: unknown;
}

function extractEnvelope(payload: unknown): ExtractedPayload {
  if (!isRecord(payload)) {
    return typeof payload === "string" && payload.length > 0
      ? { message: payload }
      : {};
  }
  const extracted: ExtractedPayload = {};
  if (typeof payload["error"] === "string" && payload["error"].length > 0) {
    extracted.message = payload["error"];
  }
  if ("result" in payload) {
    const result = payload["result"];
    extracted.details = result;
    if (typeof result === "string") {
      extracted.code = result;
    }
  }
  return extracted;
}

/**
 * Base class for every typed error thrown by vindrapay-sdk.
 *
 * HTTP failures always carry the response `status`; connection-level failures
 * are surfaced as {@link NetworkError} instead.
 *
 * @example
 * ```ts
 * try {
 *   await client.request("GET", "/v1/orders/123");
 * } catch (err) {
 *   if (err instanceof VindraPayError) {
 *     console.log(err.status, err.code, err.details);
 *   }
 * }
 * ```
 */
export class VindraPayError extends Error {
  /** HTTP status code returned by the backend. */
  readonly status: number;
  /** Machine-readable backend code from the envelope `result` field, when present. */
  code?: string;
  /** Structured payload preserved from the upstream response, when present. */
  details?: unknown;

  constructor(status: number, message: string, options: VindraPayErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    if (options.code !== undefined) {
      this.code = options.code;
    }
    if (options.details !== undefined) {
      this.details = options.details;
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  /**
   * Map an upstream HTTP status plus parsed JSON body to the correct error
   * subclass. The backend envelope `{ success: false, error, result? }` is
   * decoded here: `error` becomes the message and `result` becomes both
   * {@link VindraPayError.code} (when a string) and {@link VindraPayError.details}.
   *
   * @param status - HTTP status code of the failed response.
   * @param payload - Parsed JSON body (or raw text) of the failed response.
   * @param cause - Optional underlying cause attached to the returned error.
   * @returns The most specific {@link VindraPayError} subclass instance.
   */
  static fromUpstream(
    status: number,
    payload?: unknown,
    cause?: unknown,
  ): VindraPayError {
    const { message, code, details } = extractEnvelope(payload);
    const fallback =
      FALLBACK_MESSAGES[status] ?? `Request failed with status ${status}`;
    const options: VindraPayErrorOptions & { result?: unknown } = {
      ...(code !== undefined && { code }),
      ...(details !== undefined && { details }),
      ...(cause !== undefined && { cause }),
    };
    switch (true) {
      case status === 400:
        return new ValidationError(message ?? fallback, options);
      case status === 401:
        return new AuthenticationError(message ?? fallback, options);
      case status === 403:
        return new PermissionError(message ?? fallback, options);
      case status === 404:
        return new NotFoundError(message ?? fallback, options);
      case status === 409:
        return new ConflictError(message ?? fallback, { ...options, result: details });
      case status === 422:
        return new UnprocessableError(message ?? fallback, options);
      case status === 429:
        return new RateLimitError(message ?? fallback, options);
      default:
        if (status >= 500) {
          return new ServerError(message ?? fallback, { ...options, status });
        }
        return new VindraPayError(status, message ?? fallback, options);
    }
  }
}

/**
 * Thrown when the backend responds with `400 Bad Request`.
 */
export class ValidationError extends VindraPayError {
  constructor(message = FALLBACK_MESSAGES[400]!, options: VindraPayErrorOptions = {}) {
    super(400, message, options);
  }
}

/**
 * Thrown when the backend responds with `401 Unauthorized` (missing or invalid API key).
 */
export class AuthenticationError extends VindraPayError {
  constructor(message = FALLBACK_MESSAGES[401]!, options: VindraPayErrorOptions = {}) {
    super(401, message, options);
  }
}

/**
 * Thrown when the backend responds with `403 Forbidden` (insufficient permissions).
 */
export class PermissionError extends VindraPayError {
  constructor(message = FALLBACK_MESSAGES[403]!, options: VindraPayErrorOptions = {}) {
    super(403, message, options);
  }
}

/**
 * Thrown when the backend responds with `404 Not Found`.
 */
export class NotFoundError extends VindraPayError {
  constructor(message = FALLBACK_MESSAGES[404]!, options: VindraPayErrorOptions = {}) {
    super(404, message, options);
  }
}

/**
 * Thrown when the backend responds with `409 Conflict`.
 *
 * Carries the backend's conflict discriminator (the `result` field, e.g.
 * `already_used`, `wrong_direction`) on {@link ConflictError.result}.
 */
export class ConflictError extends VindraPayError {
  /** Verbatim `result` value from the conflict envelope, when present. */
  readonly result?: unknown;

  constructor(message = FALLBACK_MESSAGES[409]!, options: ConflictErrorOptions = {}) {
    super(409, message, options);
    if (options.result !== undefined) {
      this.result = options.result;
    }
  }
}

/**
 * Thrown when the backend responds with `422 Unprocessable Entity`.
 */
export class UnprocessableError extends VindraPayError {
  constructor(message = FALLBACK_MESSAGES[422]!, options: VindraPayErrorOptions = {}) {
    super(422, message, options);
  }
}

/**
 * Thrown when the backend responds with `429 Too Many Requests`.
 *
 * When the response includes a numeric `Retry-After` header it is exposed on
 * {@link RateLimitError.retryAfterSeconds} and honored by automatic retries.
 */
export class RateLimitError extends VindraPayError {
  /** Retry delay advertised by the backend's `Retry-After` header, in seconds. */
  retryAfterSeconds?: number;

  constructor(message = FALLBACK_MESSAGES[429]!, options: VindraPayErrorOptions = {}) {
    super(429, message, options);
  }
}

/**
 * Thrown when the backend responds with a `5xx` server error.
 */
export class ServerError extends VindraPayError {
  constructor(
    message = FALLBACK_MESSAGES[500] ?? "Internal server error",
    options: ServerErrorOptions = {},
  ) {
    super(options.status ?? 500, message, options);
  }
}

/**
 * Thrown when a request never completed at the HTTP level: DNS failure,
 * connection reset, TLS error, or the per-request timeout elapsed. There is no
 * upstream status; the underlying failure is available via `error.cause`.
 */
export class NetworkError extends Error {
  /** Reserved for symmetry with {@link VindraPayError}; not set today. */
  code?: string;
  /** Reserved for symmetry with {@link VindraPayError}; not set today. */
  details?: unknown;

  constructor(
    message = "Network request failed",
    options: { code?: string; details?: unknown; cause?: unknown } = {},
  ) {
    super(message);
    this.name = new.target.name;
    if (options.code !== undefined) {
      this.code = options.code;
    }
    if (options.details !== undefined) {
      this.details = options.details;
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * Decide whether an error is transient and safe to retry automatically:
 * any {@link NetworkError}, or a {@link VindraPayError} with status
 * `408`, `429`, or `>= 500`.
 *
 * @param error - Arbitrary caught value; anything unrecognized is not retryable.
 * @returns `true` when the error represents a retryable transport/server condition.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return true;
  }
  if (error instanceof VindraPayError) {
    return (
      error.status === 408 || error.status === 429 || error.status >= 500
    );
  }
  return false;
}
