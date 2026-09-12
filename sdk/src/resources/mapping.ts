import type { Paged } from "../core/pagination.js";
import type {
  ApiKey,
  ApiKeyCreated,
  BalancePoint,
  Business,
  Calibration,
  DeviceCreated,
  DeviceView,
  Features,
  HeartbeatResult,
  Order,
  Provider,
  RawMessage,
  StudioStats,
  TestResult,
  Transaction,
  VerificationAttempt,
  VerifyResult,
} from "../core/types.js";

/**
 * Internal wire-format helpers: the backend speaks snake_case JSON while SDK
 * entities are camelCase. These mappers convert in both directions and are not
 * part of the public surface.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

/** Deeply converts every object key from snake_case to camelCase. */
export function fromWire(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(fromWire);
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[snakeToCamelKey(key)] = fromWire(item);
    }
    return out;
  }
  return value;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? raw : {};
}

function mapEntity<T>(raw: unknown): T {
  return fromWire(raw) as T;
}

/**
 * Normalize a list payload that may arrive either as `{items,total}` or as a
 * bare array (backend asymmetry) into the standard paged shape.
 */
export function toPaged<T>(payload: unknown): Paged<T> {
  if (Array.isArray(payload)) {
    return { items: payload as T[], total: payload.length };
  }
  const record = asRecord(payload);
  const items = Array.isArray(record["items"]) ? (record["items"] as T[]) : [];
  const total = typeof record["total"] === "number" ? record["total"] : items.length;
  return { items, total };
}

/**
 * Normalize a list payload that may arrive either as a bare array or wrapped
 * in `{items,total}` into a plain array.
 */
export function toList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  return toPaged<T>(payload).items;
}

export function mapBusiness(raw: unknown): Business {
  return mapEntity<Business>(raw);
}

export function mapApiKey(raw: unknown): ApiKey {
  return mapEntity<ApiKey>(raw);
}

/** Wire shape `{api_key, token}` maps to `{apiKey, token}` generically. */
export function mapApiKeyCreated(raw: unknown): ApiKeyCreated {
  return mapEntity<ApiKeyCreated>(raw);
}

export function mapDeviceView(raw: unknown): DeviceView {
  const device = mapEntity<DeviceView>(raw);
  const record = asRecord(raw);
  // The backend reports connectivity via `last_ping_at`; alias it to the
  // entity's `lastSeenAt` field.
  const ping = record["last_ping_at"] ?? record["last_seen_at"];
  if (ping !== undefined) {
    device.lastSeenAt = ping as string | null;
  }
  return device;
}

export function mapDeviceCreated(raw: unknown): DeviceCreated {
  const created = mapEntity<DeviceCreated>(raw);
  // The backend reports connectivity via `last_ping_at`; alias it to the
  // entity's `lastSeenAt` field.
  const nested = asRecord(asRecord(raw)["device"]);
  const ping = nested["last_ping_at"] ?? nested["last_seen_at"];
  if (ping !== undefined && created.device !== undefined) {
    created.device.lastSeenAt = ping as string | null;
  }
  return created;
}

export function mapOrder(raw: unknown): Order {
  const order = mapEntity<Order>(raw);
  const record = asRecord(raw);
  // Merchant metadata is caller-supplied JSON; preserve its keys verbatim.
  if (record["metadata"] !== undefined) {
    order.metadata = (record["metadata"] ?? null) as Record<string, unknown> | null;
  }
  return order;
}

export function mapTransaction(raw: unknown): Transaction {
  return mapEntity<Transaction>(raw);
}

export function mapVerificationAttempt(raw: unknown): VerificationAttempt {
  return mapEntity<VerificationAttempt>(raw);
}

export function mapRawMessage(raw: unknown): RawMessage {
  return mapEntity<RawMessage>(raw);
}

export function mapProvider(raw: unknown): Provider {
  return mapEntity<Provider>(raw);
}

export function mapCalibration(raw: unknown): Calibration {
  return mapEntity<Calibration>(raw);
}

export function mapHeartbeatResult(raw: unknown): HeartbeatResult {
  return mapEntity<HeartbeatResult>(raw);
}

export function mapBalancePoint(raw: unknown): BalancePoint {
  return mapEntity<BalancePoint>(raw);
}

/** `reject_reason` is kept verbatim (snake_case) per the public type. */
export function mapTestResult(raw: unknown): TestResult {
  const record = asRecord(raw);
  const out: { match: boolean } & Partial<TestResult> = { match: record["match"] === true };
  if (record["fields"] !== undefined) {
    out.fields = record["fields"] as Record<string, string> | null;
  }
  if (record["transformed"] !== undefined) {
    out.transformed = record["transformed"] as Record<string, string> | null;
  }
  if (record["rejected"] !== undefined) {
    out.rejected = record["rejected"] === true;
  }
  if (record["reject_reason"] !== undefined) {
    out.reject_reason = record["reject_reason"] as string | null;
  }
  return out as TestResult;
}

/** `balance_consistent` is kept verbatim (snake_case) per the public type. */
export function mapVerifyResult(raw: unknown): VerifyResult {
  const record = asRecord(raw);
  const out: { result: VerifyResult["result"]; order: Order; transaction: Transaction } &
    Partial<VerifyResult> = {
    result: record["result"] as VerifyResult["result"],
    order: mapOrder(record["order"]),
    transaction: mapTransaction(record["transaction"]),
  };
  if (record["balance_consistent"] !== undefined) {
    out.balance_consistent = record["balance_consistent"] as boolean | null;
  }
  return out as VerifyResult;
}

export function mapFeatures(raw: unknown): Features {
  const record = asRecord(raw);
  const out: Features = {};
  if (typeof record["allow_unsafe_scripts"] === "boolean") {
    out.allowUnsafeScripts = record["allow_unsafe_scripts"];
  } else if (typeof record["allowUnsafeScripts"] === "boolean") {
    out.allowUnsafeScripts = record["allowUnsafeScripts"];
  }
  if (typeof record["script_timeout_ms"] === "number") {
    out.scriptTimeoutMs = record["script_timeout_ms"];
  } else if (typeof record["scriptTimeoutMs"] === "number") {
    out.scriptTimeoutMs = record["scriptTimeoutMs"];
  }
  return out;
}

export function mapStudioStats(raw: unknown): StudioStats {
  const record = asRecord(raw);
  const wireNumber = (key: string): number | undefined => {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const businessesTotal = wireNumber("businesses_total");
  const devicesOnline = wireNumber("devices_online");
  const transactionsTotal = wireNumber("transactions_total");
  const ordersPaid = wireNumber("orders_paid");
  const ordersPending = wireNumber("orders_pending");
  const attemptsToday = wireNumber("attempts_today");
  const messagesUnparsed = wireNumber("messages_unparsed");

  const out: StudioStats = {
    businesses: businessesTotal ?? wireNumber("businesses") ?? 0,
    apiKeys: wireNumber("api_keys") ?? wireNumber("apiKeys") ?? 0,
    devices: devicesOnline ?? wireNumber("devices") ?? 0,
    providers: wireNumber("providers") ?? 0,
    orders:
      ordersPaid !== undefined || ordersPending !== undefined
        ? (ordersPaid ?? 0) + (ordersPending ?? 0)
        : wireNumber("orders") ?? 0,
    transactions: transactionsTotal ?? wireNumber("transactions") ?? 0,
    rawMessages: messagesUnparsed ?? wireNumber("rawMessages") ?? 0,
    verificationAttempts: attemptsToday ?? wireNumber("verificationAttempts") ?? 0,
  };

  const attach = (key: keyof StudioStats, value: number | undefined): void => {
    if (value !== undefined) {
      out[key] = value;
    }
  };
  attach("businessesTotal", businessesTotal);
  attach("devicesOnline", devicesOnline);
  attach("transactionsToday", wireNumber("transactions_today"));
  attach("ordersPaid", ordersPaid);
  attach("ordersPending", ordersPending);
  attach("attemptsToday", attemptsToday);
  attach("messagesUnparsed", messagesUnparsed);
  return out;
}
