import { http, HttpResponse, type HttpHandler } from 'msw'
import { setupServer } from 'msw/node'
import { envelope, errorEnvelope } from './expectations.js'

export interface RecordedCall {
  method: string
  path: string
  url: string
  query: Record<string, string>
  headers: Record<string, string>
  body: unknown
}

export interface MockOverride {
  method: string
  path: string
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

export type ScenarioPreset = Omit<MockOverride, 'method' | 'path'>

interface ErrorScenario extends ScenarioPreset {
  status: number
  body: Record<string, unknown>
  headers?: Record<string, string>
}

export interface BackendMockOptions {
  baseUrl?: string
  managementKey?: string
  merchantKey?: string
  deviceKey?: string
  overrides?: MockOverride[]
  onUnhandledRequest?: 'bypass' | 'warn' | 'error'
}

export interface BackendMock {
  server: ReturnType<typeof setupServer>
  calls: RecordedCall[]
  start(): void
  stop(): void
  reset(): void
}

export const DEFAULT_BASE_URL = 'http://127.0.0.1:8080'

const NOW = '2026-08-26T10:00:00.000Z'

const BUSINESS_ID = 'b1000000-0000-4000-8000-000000000001'
const API_KEY_ID = 'a2000000-0000-4000-8000-000000000002'
const DEVICE_ID = 'd3000000-0000-4000-8000-000000000003'
const CLIENT_MSG_ID = '33000000-0000-4000-8000-000000000031'
const ORDER_ID = '44000000-0000-4000-8000-000000000041'
const TXN_ID = '55000000-0000-4000-8000-000000000051'
const ATTEMPT_ID = '66000000-0000-4000-8000-000000000061'
const RAW_MESSAGE_ID = '77000000-0000-4000-8000-000000000071'
const PROVIDER_ID = '88000000-0000-4000-8000-000000000081'
const PROVIDER2_ID = '99000000-0000-4000-8000-000000000091'
const CALIBRATION_ID = '22000000-0000-4000-8000-000000000021'

export const FIXTURES = {
  business: {
    id: BUSINESS_ID,
    name: 'Acme Retail',
    owner_email: 'owner@acme.dev',
    status: 'active',
    created_at: NOW,
    updated_at: NOW,
  },
  apiKey: {
    id: API_KEY_ID,
    label: 'production',
    key_prefix: 'vpk_9f2c',
    last_used_at: null,
    revoked_at: null,
    created_at: NOW,
  },
  apiKeyCreated: {
    api_key: {
      id: API_KEY_ID,
      label: 'production',
      key_prefix: 'vpk_9f2c',
      last_used_at: null,
      revoked_at: null,
      created_at: NOW,
    },
    token: 'vpk_live_9f2c7ba1d8e4f6a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2',
  },
  deviceView: {
    id: DEVICE_ID,
    business_id: BUSINESS_ID,
    business_name: 'Acme Retail',
    name: 'store-front-01',
    token_prefix: 'vdt_1a2b',
    app_version: '1.4.2',
    os_version: 'Android 14',
    last_ping_at: NOW,
    deactivated_at: null,
    online: true,
    created_at: NOW,
  },
  deviceCreated: {
    device: {
      id: DEVICE_ID,
      business_id: BUSINESS_ID,
      business_name: 'Acme Retail',
      name: 'store-front-01',
      token_prefix: 'vdt_1a2b',
      app_version: '1.4.2',
      os_version: 'Android 14',
      last_ping_at: null,
      deactivated_at: null,
      online: false,
      created_at: NOW,
    },
    token: 'vdt_live_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d',
  },
  order: {
    id: ORDER_ID,
    business_id: BUSINESS_ID,
    external_order_id: 'order-1001',
    expected_amount: '1500.00',
    status: 'pending',
    matched_transaction_id: null,
    expires_at: null,
    paid_at: null,
    metadata: null,
    created_at: NOW,
    updated_at: NOW,
  },
  transaction: {
    id: TXN_ID,
    provider_id: PROVIDER_ID,
    trx_id: 'TRX8899123',
    business_id: BUSINESS_ID,
    device_id: DEVICE_ID,
    raw_message_id: RAW_MESSAGE_ID,
    amount: '1500.00',
    sender_msisdn: '+250788000111',
    balance_after: '24500.50',
    received_at: NOW,
    created_at: NOW,
    direction: 'credit',
    effective_amount: '1500.00',
    meta: null,
  },
  transactions: [] as unknown[],
  attempt: {
    id: ATTEMPT_ID,
    business_id: BUSINESS_ID,
    order_id: ORDER_ID,
    submitted_trx_id: 'TRX8899123',
    result: 'success',
    matched_transaction_id: TXN_ID,
    submitted_amount: '1500.00',
    balance_consistent: true,
    source_ip: null,
    created_at: NOW,
  },
  rawMessage: {
    id: RAW_MESSAGE_ID,
    client_msg_id: CLIENT_MSG_ID,
    device_id: DEVICE_ID,
    business_id: BUSINESS_ID,
    sender_id: 'MTN',
    body: 'You have received 1,500 RWF from JOHN DOE. Ref TRX8899123. Balance 24,500.50 RWF',
    device_received_at: NOW,
    ingested_at: NOW,
    parse_status: 'parsed',
    error_code: null,
    error_detail: null,
    provider_id: PROVIDER_ID,
    matched_pattern: null,
    transaction_id: TXN_ID,
  },
  provider: {
    id: PROVIDER_ID,
    business_id: BUSINESS_ID,
    name: 'MTN MoMo',
    sender_id: 'MTN',
    sms_template:
      'You have received {amount} RWF from {sender}. Ref {trx_id}. New balance: {balance} RWF',
    compiled_pattern:
      '^You have received\\ (?P<amount>[0-9,\\.]+)\\ RWF\\ from\\ (?P<sender>.+)\\.\\ Ref\\ (?P<trx_id>[A-Z0-9]+)\\.',
    priority: 100,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
    direction: 'credit',
    match_mode: 'template',
    script: null,
  },
  stats: {
    businesses_total: 12,
    devices_online: 34,
    transactions_total: 5678,
    transactions_today: 91,
    orders_pending: 7,
    orders_paid: 430,
    attempts_today: 120,
    messages_unparsed: 3,
  },
  features: {
    allow_unsafe_scripts: false,
    script_timeout_ms: 3000,
  },
  heartbeat: {
    providers: [
      { id: PROVIDER_ID, name: 'MTN MoMo', sender_id: 'MTN', direction: 'credit' },
      { id: PROVIDER2_ID, name: 'Airtel Money', sender_id: null, direction: 'credit' },
    ],
  },
  verifySuccess: {
    result: 'success',
    order: {
      id: ORDER_ID,
      business_id: BUSINESS_ID,
      external_order_id: 'order-1001',
      expected_amount: '1500.00',
      status: 'paid',
      matched_transaction_id: TXN_ID,
      expires_at: null,
      paid_at: NOW,
      metadata: null,
      created_at: NOW,
      updated_at: NOW,
    },
    transaction: {
      id: TXN_ID,
      provider_id: PROVIDER_ID,
      trx_id: 'TRX8899123',
      business_id: BUSINESS_ID,
      device_id: DEVICE_ID,
      raw_message_id: RAW_MESSAGE_ID,
      amount: '1500.00',
      sender_msisdn: '+250788000111',
      balance_after: '24500.50',
      received_at: NOW,
      created_at: NOW,
      direction: 'credit',
      effective_amount: '1500.00',
      meta: null,
    },
    balance_consistent: true,
  },
  verifyConflict: {
    success: false,
    error: 'transaction already used',
    result: 'already_used',
  },
  calibration: {
    id: CALIBRATION_ID,
    business_id: BUSINESS_ID,
    device_id: DEVICE_ID,
    provider_id: PROVIDER_ID,
    balance: '24500.50',
    note: 'manual top-up check',
    calibrated_at: NOW,
    created_at: NOW,
  },
  balancePoint: {
    device_id: DEVICE_ID,
    provider_id: PROVIDER_ID,
    balance: '24500.50',
    source: 'calibration',
    point_at: NOW,
  },
  ingestResults: [
    { client_msg_id: CLIENT_MSG_ID, status: 'parsed' },
    { client_msg_id: '33000000-0000-4000-8000-000000000032', status: 'duplicate' },
    { client_msg_id: '33000000-0000-4000-8000-000000000033', status: 'unmatched' },
    { client_msg_id: '33000000-0000-4000-8000-000000000034', status: 'skipped' },
    { client_msg_id: '33000000-0000-4000-8000-000000000035', status: 'error', error: 'template compile failed' },
  ],
  healthz: {
    success: true,
    app: 'vindrapay-go',
    env: 'test',
    db: 'up',
    time: NOW,
  },
  ping: {
    success: true,
    message: 'Hello, World!',
  },
  errors: {
    invalidBody: {
      status: 400,
      body: { success: false, error: 'invalid request body' },
    } as ErrorScenario,
    unauthorized: {
      status: 401,
      body: { success: false, error: 'unauthorized' },
    } as ErrorScenario,
    forbidden: {
      status: 403,
      body: { success: false, error: 'forbidden' },
    } as ErrorScenario,
    notFound: {
      status: 404,
      body: { success: false, error: 'not found' },
    } as ErrorScenario,
    alreadyUsed: {
      status: 409,
      body: { success: false, error: 'transaction already used', result: 'already_used' },
    } as ErrorScenario,
    orderNotPending: {
      status: 409,
      body: { success: false, error: 'order is not pending', result: 'order_not_pending' },
    } as ErrorScenario,
    amountMismatch: {
      status: 422,
      body: {
        success: false,
        error: 'transaction amount does not match the order',
        result: 'amount_mismatch',
      },
    } as ErrorScenario,
    balanceMismatch: {
      status: 422,
      body: {
        success: false,
        error: 'device balance chain is inconsistent',
        result: 'balance_mismatch',
      },
    } as ErrorScenario,
    wrongDirection: {
      status: 422,
      body: {
        success: false,
        error: 'transaction is not a received payment (it is a debit)',
        result: 'wrong_direction',
      },
    } as ErrorScenario,
    invalidTemplate: {
      status: 422,
      body: {
        success: false,
        error: 'invalid sms_template: unbalanced placeholder',
        result: 'invalid_template',
      },
    } as ErrorScenario,
    rateLimited: {
      status: 429,
      headers: { 'Retry-After': '30' },
      body: { success: false, error: 'rate limit exceeded' },
    } as ErrorScenario,
    internalError: {
      status: 500,
      body: { success: false, error: 'internal server error' },
    } as ErrorScenario,
  },
}

FIXTURES.transactions = [
  FIXTURES.transaction,
  {
    ...FIXTURES.transaction,
    id: '55000000-0000-4000-8000-000000000052',
    trx_id: 'TRX7770001',
    amount: '320.75',
    sender_msisdn: '+250788000222',
    balance_after: '24179.75',
    direction: 'debit',
    effective_amount: '-320.75',
  },
]

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

type MockBody = Record<string, unknown>

interface BuilderInput {
  body: MockBody
  url: URL
}

const toMockBody = (value: unknown): MockBody =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as MockBody)
    : {}

type Builder = (input: BuilderInput) => unknown

type Guard = (request: Request) => Response | null

export function createBackendMock(options: BackendMockOptions = {}): BackendMock {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const managementKey = options.managementKey ?? 'mgmt_test_management_key'
  const merchantKey = options.merchantKey ?? 'vpk_live_test_merchant_key'
  const deviceKey = options.deviceKey ?? 'vdt_live_test_device_token'
  const calls: RecordedCall[] = []

  const overrides = (options.overrides ?? []).map((o) => ({
    method: o.method.toUpperCase(),
    pattern: globToRegExp(o.path),
    status: o.status,
    hasBody: 'body' in o,
    body: o.body,
    headers: o.headers,
  }))

  const bearerToken = (request: Request): string | null => {
    const header = request.headers.get('authorization')
    if (!header) return null
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    return match?.[1] ?? null
  }

  const readJson = async (request: Request): Promise<unknown> => {
    try {
      return await request.json()
    } catch {
      return null
    }
  }

  const record = (request: Request, body: unknown): void => {
    const url = new URL(request.url)
    calls.push({
      method: request.method,
      path: url.pathname,
      url: request.url,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
  }

  const segment = (url: URL, index: number): string => {
    const parts = url.pathname.split('/').filter(Boolean)
    return parts[index < 0 ? parts.length + index : index] ?? ''
  }

  const deny = (status: number, body: Record<string, unknown>): Response =>
    HttpResponse.json(body, { status })

  const noAuth: Guard = () => null

  const mgmtGuard: Guard = (request) => {
    const token = bearerToken(request)
    if (!token) return deny(404, { success: false, error: 'not found' })
    if (token !== managementKey) return deny(401, { success: false, error: 'unauthorized' })
    return null
  }

  const bearerGuard = (key: string): Guard => (request) => {
    const token = bearerToken(request)
    if (token !== key) return deny(401, { success: false, error: 'unauthorized' })
    return null
  }

  const page = (items: unknown[], url: URL) => {
    const rawLimit = Number(url.searchParams.get('limit'))
    const rawOffset = Number(url.searchParams.get('offset'))
    const start = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0
    const end = Number.isFinite(rawLimit) && rawLimit >= 1 ? start + rawLimit : items.length
    return { items: items.slice(start, end), total: items.length }
  }

  const providerFrom = (body: MockBody) => {
    const priority = body.priority
    const script = body.script
    return {
      ...FIXTURES.provider,
      name: body?.name ?? FIXTURES.provider.name,
      sender_id: body?.sender_id ?? FIXTURES.provider.sender_id,
      sms_template: body?.sms_template ?? FIXTURES.provider.sms_template,
      priority:
        typeof priority === 'number' && priority >= 0 && priority <= 10000
          ? priority
          : FIXTURES.provider.priority,
      direction: body?.direction ?? FIXTURES.provider.direction,
      match_mode: body?.match_mode ?? FIXTURES.provider.match_mode,
      script: typeof script === 'string' && script !== '' ? script : null,
      business_id: body?.business_id ?? FIXTURES.provider.business_id,
    }
  }

  const templateUpdateFrom = (body: MockBody, url: URL) => {
    const script = body.script
    return {
      ...FIXTURES.provider,
      id: segment(url, -2),
      sms_template: body?.sms_template ?? FIXTURES.provider.sms_template,
      direction: body?.direction ?? FIXTURES.provider.direction,
      match_mode: body?.match_mode ?? FIXTURES.provider.match_mode,
      script: typeof script === 'string' && script !== '' ? script : null,
    }
  }

  const testProvider = ({ body }: BuilderInput) => {
    const fields = { amount: '1500.00', sender: 'MTN', trx_id: 'TRX8899123', balance: '24500.50' }
    const data: Record<string, unknown> = { match: true, fields }
    const script = body.script
    if (typeof script === 'string' && script !== '') {
      data.transformed = { amount: fields.amount }
    }
    return envelope(data)
  }

  const calibrationFrom = ({ body, url }: BuilderInput) => {
    const note = body.note
    return envelope({
      ...FIXTURES.calibration,
      device_id: segment(url, -2),
      provider_id: body?.provider_id ?? FIXTURES.calibration.provider_id,
      balance: body?.balance ?? FIXTURES.calibration.balance,
      note: typeof note === 'string' && note !== '' ? note : FIXTURES.calibration.note,
    })
  }

  const balancePointFor = ({ url }: BuilderInput) => {
    const providerId = url.searchParams.get('provider_id')
    if (!providerId) {
      return HttpResponse.json(errorEnvelope('provider_id query parameter is required'), { status: 400 })
    }
    return envelope({ ...FIXTURES.balancePoint, provider_id: providerId })
  }

  const bind = (
    method: string,
    path: string,
    guard: Guard,
    defaultStatus: number,
    build: Builder,
  ): HttpHandler => {
    const resolver = async ({ request }: { request: Request }): Promise<Response> => {
      const requestBody = await readJson(request)
      record(request, requestBody)
      const denied = guard(request)
      if (denied) return denied
      const url = new URL(request.url)
      const ov = overrides.find((o) => o.method === method && o.pattern.test(request.url))
      const payload =
        ov && ov.hasBody ? ov.body : build({ body: toMockBody(requestBody), url })
      if (payload instanceof Response) return payload
      const status = ov?.status ?? defaultStatus
      const headers = ov?.headers ?? undefined
      return headers
        ? HttpResponse.json(payload as Record<string, unknown>, { status, headers })
        : HttpResponse.json(payload as Record<string, unknown>, { status })
    }
    const p = `${base}${path}`
    switch (method) {
      case 'GET':
        return http.get(p, resolver)
      case 'POST':
        return http.post(p, resolver)
      case 'PUT':
        return http.put(p, resolver)
      case 'PATCH':
        return http.patch(p, resolver)
      default:
        return http.delete(p, resolver)
    }
  }

  const handlers: HttpHandler[] = [
    bind('GET', '/healthz', noAuth, 200, () => FIXTURES.healthz),
    bind('GET', '/api/v1/ping', noAuth, 200, () => FIXTURES.ping),

    bind('GET', '/manage/v1/features', mgmtGuard, 200, () => envelope(FIXTURES.features)),
    bind('GET', '/manage/v1/businesses', mgmtGuard, 200, ({ url }) => envelope(page([FIXTURES.business], url))),
    bind('POST', '/manage/v1/businesses', mgmtGuard, 201, ({ body }) =>
      envelope({
        ...FIXTURES.business,
        name: body?.name ?? FIXTURES.business.name,
        owner_email: body?.owner_email ?? FIXTURES.business.owner_email,
      }),
    ),
    bind('GET', '/manage/v1/businesses/:business_id', mgmtGuard, 200, ({ url }) =>
      envelope({ ...FIXTURES.business, id: segment(url, -1) }),
    ),
    bind('PATCH', '/manage/v1/businesses/:business_id/status', mgmtGuard, 200, ({ body, url }) =>
      envelope({ ...FIXTURES.business, id: segment(url, -2), status: body?.status ?? 'active' }),
    ),
    bind('GET', '/manage/v1/businesses/:business_id/api-keys', mgmtGuard, 200, () =>
      envelope([FIXTURES.apiKey]),
    ),
    bind('POST', '/manage/v1/businesses/:business_id/api-keys', mgmtGuard, 201, () =>
      envelope(FIXTURES.apiKeyCreated),
    ),
    bind('DELETE', '/manage/v1/api-keys/:key_id', mgmtGuard, 200, ({ url }) =>
      envelope({ ...FIXTURES.apiKey, id: segment(url, -1), revoked_at: NOW }),
    ),
    bind('GET', '/manage/v1/devices', mgmtGuard, 200, ({ url }) => envelope(page([FIXTURES.deviceView], url))),
    bind('POST', '/manage/v1/businesses/:business_id/devices', mgmtGuard, 201, ({ body, url }) =>
      envelope({
        ...FIXTURES.deviceCreated,
        device: {
          ...FIXTURES.deviceCreated.device,
          business_id: segment(url, -2),
          name: body?.name ?? FIXTURES.deviceCreated.device.name,
        },
      }),
    ),
    bind('DELETE', '/manage/v1/devices/:device_id', mgmtGuard, 200, ({ url }) =>
      envelope({ ...FIXTURES.deviceView, id: segment(url, -1), deactivated_at: NOW, online: false }),
    ),
    bind('GET', '/manage/v1/orders', mgmtGuard, 200, ({ url }) => envelope(page([FIXTURES.order], url))),
    bind('GET', '/manage/v1/transactions', mgmtGuard, 200, ({ url }) =>
      envelope(page(FIXTURES.transactions, url)),
    ),
    bind('GET', '/manage/v1/attempts', mgmtGuard, 200, ({ url }) => envelope(page([FIXTURES.attempt], url))),
    bind('GET', '/manage/v1/messages', mgmtGuard, 200, ({ url }) => envelope(page([FIXTURES.rawMessage], url))),
    bind('GET', '/manage/v1/stats', mgmtGuard, 200, () => envelope(FIXTURES.stats)),
    bind('GET', '/manage/v1/providers', mgmtGuard, 200, ({ url }) => envelope(page([FIXTURES.provider], url))),
    bind('POST', '/manage/v1/providers', mgmtGuard, 201, ({ body }) => envelope(providerFrom(body))),
    bind('PUT', '/manage/v1/providers/:id/template', mgmtGuard, 200, ({ body, url }) =>
      envelope(templateUpdateFrom(body, url)),
    ),
    bind('DELETE', '/manage/v1/providers/:id', mgmtGuard, 200, ({ url }) =>
      envelope({ ...FIXTURES.provider, id: segment(url, -1), is_active: false }),
    ),
    bind('POST', '/manage/v1/providers/test', mgmtGuard, 200, testProvider),
    bind('POST', '/manage/v1/devices/:device_id/calibrate-balance', mgmtGuard, 201, calibrationFrom),
    bind('GET', '/manage/v1/devices/:device_id/balance', mgmtGuard, 200, balancePointFor),

    bind('POST', '/api/v1/orders', bearerGuard(merchantKey), 201, ({ body }) =>
      envelope({
        ...FIXTURES.order,
        external_order_id: body?.external_order_id ?? FIXTURES.order.external_order_id,
        expected_amount: body?.expected_amount ?? FIXTURES.order.expected_amount,
      }),
    ),
    bind('GET', '/api/v1/orders/:external_order_id', bearerGuard(merchantKey), 200, ({ url }) =>
      envelope({ ...FIXTURES.order, external_order_id: decodeURIComponent(segment(url, -1)) }),
    ),
    bind('POST', '/api/v1/orders/:external_order_id/verify', bearerGuard(merchantKey), 200, () =>
      envelope(FIXTURES.verifySuccess),
    ),
    bind('POST', '/api/v1/providers', bearerGuard(merchantKey), 201, ({ body }) =>
      envelope(providerFrom(body)),
    ),
    bind('GET', '/api/v1/providers', bearerGuard(merchantKey), 200, () => envelope([FIXTURES.provider])),
    bind('GET', '/api/v1/providers/:id', bearerGuard(merchantKey), 200, ({ url }) =>
      envelope({ ...FIXTURES.provider, id: segment(url, -1) }),
    ),
    bind('PUT', '/api/v1/providers/:id/template', bearerGuard(merchantKey), 200, ({ body, url }) =>
      envelope(templateUpdateFrom(body, url)),
    ),
    bind('DELETE', '/api/v1/providers/:id', bearerGuard(merchantKey), 200, ({ url }) =>
      envelope({ ...FIXTURES.provider, id: segment(url, -1), is_active: false }),
    ),
    bind('POST', '/api/v1/providers/test', bearerGuard(merchantKey), 200, testProvider),
    bind(
      'POST',
      '/api/v1/devices/:device_id/calibrate-balance',
      bearerGuard(merchantKey),
      201,
      calibrationFrom,
    ),
    bind('GET', '/api/v1/devices/:device_id/balance', bearerGuard(merchantKey), 200, balancePointFor),

    bind('POST', '/device/v1/heartbeat', bearerGuard(deviceKey), 200, () => envelope(FIXTURES.heartbeat)),
    bind('POST', '/device/v1/messages', bearerGuard(deviceKey), 200, ({ body }) => {
      const messages = body.messages
      if (!Array.isArray(messages) || messages.length < 1 || messages.length > 50) {
        return HttpResponse.json(errorEnvelope('messages must contain 1-50 items'), { status: 400 })
      }
      return envelope({
        results: messages.map((m: MockBody) => ({
          client_msg_id: m?.client_msg_id ?? null,
          status: 'parsed',
        })),
      })
    }),
  ]

  const server = setupServer(...handlers)

  return {
    server,
    calls,
    start() {
      server.listen({ onUnhandledRequest: options.onUnhandledRequest ?? 'error' })
    },
    stop() {
      server.close()
    },
    reset() {
      calls.length = 0
      server.resetHandlers()
    },
  }
}
