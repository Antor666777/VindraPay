/**
 * Possible verification outcomes returned by the backend when a submitted
 * transaction is matched against a pending order.
 */
export type ResultUnion =
  | "success"
  | "not_found"
  | "already_used"
  | "amount_mismatch"
  | "order_expired"
  | "order_not_pending"
  | "balance_mismatch"
  | "wrong_direction";

/**
 * Lifecycle states of an {@link Order}.
 */
export type OrderStatus = "pending" | "paid" | "expired" | "cancelled";

/**
 * Direction of money movement for a {@link Transaction} or {@link Provider}.
 */
export type TransactionDirection = "credit" | "debit";

/**
 * How a {@link Provider} extracts fields from raw SMS bodies.
 *
 * `"template"` is the backend's canonical name for placeholder templates;
 * `"exact"`/`"pattern"` are legacy spellings kept for compatibility.
 */
export type ProviderMatchMode = "exact" | "pattern" | "regex" | "template";

/**
 * Parse pipeline state of a {@link RawMessage}.
 */
export type RawMessageParseStatus = "pending" | "parsed" | "unmatched" | "error" | "skipped";

/**
 * A business account registered with VindraPay.
 *
 * All monetary values are decimal strings to avoid floating point loss.
 */
export interface Business {
  id: string;
  name: string;
  ownerEmail?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * An API key issued to a business, in redacted view form (never the full secret).
 */
export interface ApiKey {
  id: string;
  businessId?: string;
  label?: string;
  /** Visible key prefix (e.g. `vsk_live_ab12`); the full token is only shown once at creation. */
  keyPrefix?: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt?: string;
}

/**
 * Payload returned when a new API key is created; the raw `token` is shown exactly once.
 */
export interface ApiKeyCreated {
  apiKey: ApiKey;
  token: string;
}

/**
 * A paired Android device that ingests provider SMS, in view form.
 */
export interface DeviceView {
  id: string;
  name?: string;
  businessId?: string;
  businessName?: string;
  /** Live connectivity flag derived from the device's most recent heartbeat. */
  online: boolean;
  lastSeenAt?: string | null;
  appVersion?: string | null;
  osVersion?: string | null;
  deactivatedAt?: string | null;
  createdAt?: string;
}

/**
 * Payload returned when a new device is paired; the raw `token` is shown exactly once.
 */
export interface DeviceCreated {
  device: DeviceView;
  token: string;
}

/**
 * A payment order that devices' incoming SMS are verified against.
 */
export interface Order {
  id: string;
  businessId?: string;
  /** Caller-supplied identifier from the merchant system. */
  externalOrderId?: string;
  /** Amount the payer must send, as a decimal string (e.g. `"1500.00"`). */
  expectedAmount: string;
  currency?: string;
  status: OrderStatus;
  matchedTransactionId?: string | null;
  expiresAt?: string | null;
  paidAt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A parsed mobile-money transaction extracted from device SMS traffic.
 */
export interface Transaction {
  id: string;
  businessId?: string;
  deviceId?: string | null;
  providerId?: string | null;
  rawMessageId?: string | null;
  orderId?: string | null;
  trxId?: string | null;
  /** Transaction amount as a decimal string. */
  amount: string;
  /** Amount credited after fees, as a decimal string, when known. */
  effectiveAmount?: string | null;
  /** Device balance after the transaction, as a decimal string, when reported. */
  balanceAfter?: string | null;
  direction: TransactionDirection;
  senderMsisdn?: string | null;
  receivedAt?: string;
  createdAt?: string;
}

/**
 * One verification attempt of a submitted transaction against an order.
 */
export interface VerificationAttempt {
  id: string;
  businessId?: string;
  orderId?: string | null;
  submittedTrxId?: string | null;
  matchedTransactionId?: string | null;
  result: ResultUnion;
  /** Amount the user claimed to have sent, as a decimal string, when parseable. */
  submittedAmount?: string | null;
  /** Whether the reported balance arithmetic held up; `null` when not evaluated. */
  balanceConsistent?: boolean | null;
  sourceIp?: string | null;
  createdAt?: string;
}

/**
 * A raw SMS message ingested by a device and its parse outcome.
 */
export interface RawMessage {
  id: string;
  clientMsgId?: string;
  businessId?: string;
  deviceId?: string | null;
  providerId?: string | null;
  senderId?: string | null;
  body?: string;
  parseStatus: RawMessageParseStatus;
  errorCode?: string | null;
  errorDetail?: string | null;
  matchedPattern?: string | null;
  transactionId?: string | null;
  deviceReceivedAt?: string | null;
  ingestedAt?: string;
}

/**
 * A mobile-money provider template used to match and extract SMS content.
 */
export interface Provider {
  id: string;
  businessId?: string | null;
  /** Business name joined by the manage-domain list endpoint, when present. */
  businessName?: string | null;
  name: string;
  senderId?: string | null;
  direction: TransactionDirection | "both";
  matchMode: ProviderMatchMode;
  smsTemplate?: string;
  compiledPattern?: string;
  priority?: number;
  isActive?: boolean;
  script?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A balance calibration recorded against a device/provider pair.
 */
export interface Calibration {
  id: string;
  businessId?: string;
  deviceId?: string | null;
  providerId?: string | null;
  /** Balance reported by the calibrating device, as a decimal string. */
  balance?: string | null;
  note?: string | null;
  calibratedAt?: string;
  createdAt?: string;
}

/**
 * Aggregate counters exposed by the Studio dashboard endpoints.
 *
 * The wire format reports snake_case detail counters; the camelCase summary
 * fields below are always populated (missing wire counters map to `0`), and
 * the raw wire counters are attached verbatim when the backend supplies them.
 */
export interface StudioStats {
  businesses: number;
  apiKeys: number;
  devices: number;
  providers: number;
  orders: number;
  transactions: number;
  rawMessages: number;
  verificationAttempts: number;
  /** Wire counter `businesses_total`. */
  businessesTotal?: number;
  /** Wire counter `devices_online`. */
  devicesOnline?: number;
  /** Wire counter `transactions_today`. */
  transactionsToday?: number;
  /** Wire counter `orders_pending`. */
  ordersPending?: number;
  /** Wire counter `orders_paid`. */
  ordersPaid?: number;
  /** Wire counter `attempts_today`. */
  attemptsToday?: number;
  /** Wire counter `messages_unparsed`. */
  messagesUnparsed?: number;
}

/**
 * Feature flags advertised by the backend deployment.
 */
export interface Features {
  allowUnsafeScripts?: boolean;
  scriptTimeoutMs?: number;
}

/**
 * Result of testing an SMS body against a {@link Provider} in the Studio.
 */
export interface TestResult {
  match: boolean;
  fields?: Record<string, string> | null;
  transformed?: Record<string, string> | null;
  rejected?: boolean;
  /** Backend field name kept verbatim (snake_case) to mirror the wire format. */
  reject_reason?: string | null;
}

/**
 * Compact provider descriptor included in device heartbeat responses.
 */
export interface HeartbeatProvider {
  id: string;
  name: string;
  senderId: string | null;
  direction: TransactionDirection;
}

/**
 * Response of the device heartbeat endpoint.
 */
export interface HeartbeatResult {
  /** Active providers the device should listen for, in match-priority order. */
  providers: HeartbeatProvider[];
}

/**
 * One inbound SMS queued by a device for ingestion.
 */
export interface InboundMessage {
  /** Device-generated unique identifier (UUID recommended); deduplicates retries. */
  clientMsgId: string;
  /** SMS sender ID (e.g. `"bKash"`); optional but improves matching. */
  senderId?: string;
  /** Raw SMS body text; max 4096 characters. */
  body: string;
  /** RFC3339 timestamp of when the device received the SMS. */
  deviceReceivedAt?: string;
}

/** Outcome status of a single ingested message. */
export type IngestStatus = "parsed" | "duplicate" | "unmatched" | "skipped" | "error";

/**
 * Per-message result returned by the device message-ingestion endpoint.
 * The `error` field is set only when {@link IngestResult.status} is `"error"`.
 */
export interface IngestResult {
  clientMsgId: string | null;
  status: IngestStatus;
  error?: string | null;
}

/**
 * Latest known balance for a device/provider pair, from either a parsed
 * transaction or an explicit calibration.
 */
export interface BalancePoint {
  deviceId?: string | null;
  providerId?: string | null;
  /** Balance value as a decimal string. */
  balance: string;
  source: "transaction" | "calibration";
  /** RFC3339 timestamp of the balance observation. */
  pointAt: string;
}

/**
 * Typed outcome of a successful merchant verification call
 * (`POST /api/v1/orders/{id}/verify` with HTTP 200).
 *
 * The backend field `balance_consistent` is kept verbatim (snake_case) to
 * mirror the wire format.
 */
export interface VerifyResult {
  result: ResultUnion;
  order: Order;
  transaction: Transaction;
  balance_consistent?: boolean | null;
}
