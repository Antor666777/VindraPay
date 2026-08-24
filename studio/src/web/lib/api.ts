import { lockSession, setBackendReachable } from './stores.svelte';

export type BusinessStatus = 'active' | 'suspended';
export type OrderStatus = 'pending' | 'paid' | 'expired' | 'cancelled';
export type Direction = 'credit' | 'debit';
export type MatchMode = 'template' | 'regex';
export type AttemptResult =
  | 'success'
  | 'not_found'
  | 'already_used'
  | 'amount_mismatch'
  | 'order_expired'
  | 'order_not_pending'
  | 'balance_mismatch'
  | 'wrong_direction';
export type ParseStatus = 'pending' | 'parsed' | 'skipped' | 'unmatched' | 'error';

export interface Business {
  id: string;
  name: string;
  owner_email: string;
  status: BusinessStatus;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  label: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ApiKeyCreated {
  api_key: ApiKey;
  token: string;
}

export interface Device {
  id: string;
  business_id: string;
  business_name: string | null;
  name: string;
  token_prefix: string;
  app_version: string | null;
  os_version: string | null;
  last_ping_at: string | null;
  deactivated_at: string | null;
  online: boolean;
  created_at: string;
}

export interface DeviceCreated {
  device: Device;
  token: string;
}

export interface Order {
  id: string;
  external_order_id: string;
  business_name: string | null;
  expected_amount: string;
  status: OrderStatus;
  matched_transaction_id: string | null;
  expires_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Transaction {
  id: string;
  trx_id: string;
  business_name: string | null;
  provider_name: string | null;
  direction: Direction;
  amount: string;
  sender_msisdn: string | null;
  balance_after: string | null;
  received_at: string;
}

export interface VerificationAttempt {
  submitted_trx_id: string;
  result: AttemptResult;
  submitted_amount: string | null;
  balance_consistent: boolean | null;
  source_ip: string | null;
  created_at: string;
  business_name: string | null;
}

export interface RawMessage {
  id: string;
  sender_id: string | null;
  body: string;
  parse_status: ParseStatus;
  error_code: string | null;
  error_detail: string | null;
  ingested_at: string;
  business_name: string | null;
  matched_pattern?: string | null;
  device_id?: string;
  client_msg_id?: string;
  transaction_id?: string | null;
  device_received_at?: string | null;
  provider_id?: string | null;
}

export interface Provider {
  id: string;
  name: string;
  business_id: string | null;
  business_name?: string | null;
  sender_id: string | null;
  sms_template: string;
  script: string | null;
  priority: number;
  is_active: boolean;
  direction: Direction;
  match_mode: MatchMode;
  created_at: string;
}

export interface ProviderInput {
  business_id?: string | null;
  name: string;
  sender_id?: string;
  sms_template: string;
  script?: string;
  priority?: number;
  direction?: Direction;
  match_mode?: MatchMode;
}

export interface TemplateUpdate {
  sms_template: string;
  script: string;
  direction?: Direction;
  match_mode?: MatchMode;
}

export interface TestFields {
  amount?: string;
  sender?: string;
  trx_id?: string;
  balance?: string;
}

export interface TestTransformed {
  amount?: string;
  sender?: string;
  balance?: string;
  trx_id?: string;
  meta?: Record<string, string | number | boolean>;
}

export interface TestResult {
  match: boolean;
  fields?: Partial<TestFields>;
  transformed?: TestTransformed | null;
  rejected?: boolean;
  reject_reason?: string;
}

export interface Features {
  allow_unsafe_scripts: boolean;
  script_timeout_ms: number;
}

export interface BalancePoint {
  balance: string;
  source: 'transaction' | 'calibration';
  point_at: string;
}

export interface Calibration {
  id: string;
  provider_id: string;
  device_id: string;
  balance: string;
  note: string | null;
  calibrated_at: string;
  created_at: string;
}

export interface Stats {
  businesses_total: number;
  devices_online: number;
  transactions_total: number;
  transactions_today: number;
  orders_pending: number;
  orders_paid: number;
  attempts_today: number;
  messages_unparsed: number;
}

export interface Meta {
  backendUrl: string;
  authenticated: boolean;
  version: string;
}

export interface BackendHealth {
  db?: string;
  app?: string;
  env?: string;
  time?: string;
  success?: boolean;
  [key: string]: unknown;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

const BASE = '/studio-api';
const TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function buildUrl(path: string, query?: QueryParams): string {
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function send(
  url: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, body: parsed };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, 'Request timed out');
    }
    throw new ApiError(0, 'Network request failed');
  } finally {
    clearTimeout(timer);
  }
}

function raiseFailure(status: number, body: unknown): never {
  const message =
    isRecord(body) && typeof body.error === 'string' && body.error.length > 0
      ? body.error
      : `Request failed (${status})`;
  if (status === 401) lockSession();
  if (status === 502) setBackendReachable(false);
  throw new ApiError(status, message);
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: QueryParams } = {},
): Promise<T> {
  const { status, body } = await send(buildUrl(path, options.query), options.method ?? 'GET', options.body);
  if (status >= 400) raiseFailure(status, body);
  setBackendReachable(true);
  if (isRecord(body)) {
    if (body.success === false) raiseFailure(status, body);
    if ('data' in body) return body.data as T;
    if ('result' in body) return body.result as T;
  }
  return body as T;
}

async function list<T>(path: string, query?: QueryParams): Promise<Paged<T>> {
  const payload = await request<unknown>(path, { query });
  return normalizePaged<T>(payload);
}

function normalizePaged<T>(payload: unknown): Paged<T> {
  if (Array.isArray(payload)) return { items: payload as T[], total: payload.length };
  if (isRecord(payload) && Array.isArray(payload.items)) {
    const total = typeof payload.total === 'number' ? payload.total : payload.items.length;
    return { items: payload.items as T[], total };
  }
  return { items: [], total: 0 };
}

export async function backendHealth(): Promise<{
  reachable: boolean;
  dbUp: boolean | null;
  body: BackendHealth | null;
}> {
  try {
    const { status, body } = await send(buildUrl('/backend-health'), 'GET');
    if (status === 502 || (isRecord(body) && body.error === 'backend unreachable')) {
      setBackendReachable(false);
      return { reachable: false, dbUp: null, body: null };
    }
    setBackendReachable(true);
    const health = (isRecord(body) ? body : {}) as BackendHealth;
    return { reachable: true, dbUp: health.db === 'up', body: health };
  } catch {
    setBackendReachable(false);
    return { reachable: false, dbUp: null, body: null };
  }
}

export const api = {
  getMeta: (): Promise<Meta> => request<Meta>('/meta'),

  login: (password: string): Promise<void> =>
    request<void>('/login', { method: 'POST', body: { password } }),

  getStats: (): Promise<Stats> => request<Stats>('/stats'),

  listBusinesses: (query: { limit?: number; offset?: number; status?: BusinessStatus | ''; search?: string } = {}): Promise<Paged<Business>> =>
    list<Business>('/businesses', query),

  getBusiness: (id: string): Promise<Business> => request<Business>(`/businesses/${id}`),

  createBusiness: (input: { name: string; owner_email: string }): Promise<Business> =>
    request<Business>('/businesses', { method: 'POST', body: input }),

  setBusinessStatus: (id: string, status: BusinessStatus): Promise<Business> =>
    request<Business>(`/businesses/${id}/status`, { method: 'PATCH', body: { status } }),

  listApiKeys: (businessId: string): Promise<Paged<ApiKey>> =>
    list<ApiKey>(`/businesses/${businessId}/api-keys`),

  createApiKey: (businessId: string, label: string): Promise<ApiKeyCreated> =>
    request<ApiKeyCreated>(`/businesses/${businessId}/api-keys`, { method: 'POST', body: { label } }),

  revokeApiKey: (keyId: string): Promise<ApiKey> =>
    request<ApiKey>(`/api-keys/${keyId}`, { method: 'DELETE' }),

  listDevices: (query: { business_id?: string; limit?: number; offset?: number } = {}): Promise<Paged<Device>> =>
    list<Device>('/devices', query),

  createDevice: (businessId: string, name: string): Promise<DeviceCreated> =>
    request<DeviceCreated>(`/businesses/${businessId}/devices`, { method: 'POST', body: { name } }),

  deactivateDevice: (deviceId: string): Promise<Device> =>
    request<Device>(`/devices/${deviceId}`, { method: 'DELETE' }),

  deviceBalance: (deviceId: string, providerId: string): Promise<BalancePoint> =>
    request<BalancePoint>(`/devices/${deviceId}/balance`, { query: { provider_id: providerId } }),

  calibrateBalance: (
    deviceId: string,
    input: { provider_id: string; balance: string; note?: string },
  ): Promise<Calibration> =>
    request<Calibration>(`/devices/${deviceId}/calibrate-balance`, { method: 'POST', body: input }),

  listOrders: (query: { business_id?: string; status?: OrderStatus | ''; limit?: number; offset?: number } = {}): Promise<Paged<Order>> =>
    list<Order>('/orders', query),

  listTransactions: (query: { business_id?: string; provider_id?: string; direction?: Direction | ''; limit?: number; offset?: number } = {}): Promise<Paged<Transaction>> =>
    list<Transaction>('/transactions', query),

  listAttempts: (query: { business_id?: string; result?: AttemptResult | ''; trx_id?: string; limit?: number; offset?: number } = {}): Promise<Paged<VerificationAttempt>> =>
    list<VerificationAttempt>('/attempts', query),

  listMessages: (query: { business_id?: string; parse_status?: ParseStatus | ''; limit?: number; offset?: number } = {}): Promise<Paged<RawMessage>> =>
    list<RawMessage>('/messages', query),

  listProviders: (query: { business_id?: string; direction?: Direction | ''; match_mode?: MatchMode | '' } = {}): Promise<Paged<Provider>> =>
    list<Provider>('/providers', query),

  createProvider: (input: ProviderInput): Promise<Provider> =>
    request<Provider>('/providers', { method: 'POST', body: input }),

  updateProviderTemplate: (id: string, input: TemplateUpdate): Promise<Provider> =>
    request<Provider>(`/providers/${id}/template`, { method: 'PUT', body: input }),

  deleteProvider: (id: string): Promise<Provider> =>
    request<Provider>(`/providers/${id}`, { method: 'DELETE' }),

  testProviderTemplate: (input: { sms_template: string; sample_body: string; match_mode?: MatchMode; script?: string }): Promise<TestResult> =>
    request<TestResult>('/providers/test', { method: 'POST', body: input }),

  getFeatures: (): Promise<Features> => request<Features>('/features'),
};
