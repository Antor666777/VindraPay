import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createBackendMock, DEFAULT_BASE_URL, FIXTURES } from '../support/backend-mock.js'
import {
  authHeader,
  expectEnvelope,
  expectErrorEnvelope,
  parseListPage,
  parseQuery,
} from '../support/expectations.js'

const mock = createBackendMock()

beforeAll(() => mock.start())
afterEach(() => mock.reset())
afterAll(() => mock.stop())

const url = (path: string) => `${DEFAULT_BASE_URL}${path}`
const mgmtHeaders = { Authorization: 'Bearer mgmt_test_management_key' }
const merchantHeaders = { Authorization: 'Bearer vpk_live_test_merchant_key' }
const deviceHeaders = { Authorization: 'Bearer vdt_live_test_device_token' }
const bodyOf = async (r: Response) => r.json()

describe('backend mock harness: management domain', () => {
  it('serves /healthz and /api/v1/ping without auth', async () => {
    const health = await fetch(url('/healthz')).then(bodyOf)
    expect(health).toEqual(FIXTURES.healthz)
    const ping = await fetch(url('/api/v1/ping')).then(bodyOf)
    expect(ping).toEqual(FIXTURES.ping)
  })

  it('enforces the management key: missing bearer is 404, wrong key is 401', async () => {
    const missing = await fetch(url('/manage/v1/stats'))
    expect(missing.status).toBe(404)
    expectErrorEnvelope(await missing.json(), { error: 'not found' })

    const wrong = await fetch(url('/manage/v1/stats'), {
      headers: { Authorization: 'Bearer nope' },
    })
    expect(wrong.status).toBe(401)
    expectErrorEnvelope(await wrong.json(), { error: 'unauthorized' })
    expect(mock.calls.map((c) => c.path)).toEqual(['/manage/v1/stats', '/manage/v1/stats'])
  })

  it('returns features envelope and records the auth header', async () => {
    const r = await fetch(url('/manage/v1/features'), { headers: mgmtHeaders })
    expect(r.status).toBe(200)
    expectEnvelope(await r.json(), FIXTURES.features)
    expect(mock.calls).toHaveLength(1)
    expect(authHeader(mock.calls[0]!, 'mgmt_test_management_key')).toBeTruthy()
  })

  it('shapes filtered lists as {items,total} and serializes query params', async () => {
    const r = await fetch(url('/manage/v1/transactions?limit=1&offset=1&direction=debit'), {
      headers: mgmtHeaders,
    })
    const page = parseListPage<{ trx_id: string }>(await r.json())
    expect(page.total).toBe(2)
    expect(page.items).toEqual([FIXTURES.transactions[1]])
    const call = mock.calls[0]!
    expect(parseQuery(call.url)).toEqual({ limit: '1', offset: '1', direction: 'debit' })
    expect(call.query.limit).toBe('1')
  })

  it('returns stats with all eight counters', async () => {
    const data = expectEnvelope<Record<string, number>>(
      await fetch(url('/manage/v1/stats'), { headers: mgmtHeaders }).then(bodyOf),
    )
    expect(Object.keys(data).sort()).toEqual([
      'attempts_today',
      'businesses_total',
      'devices_online',
      'messages_unparsed',
      'orders_paid',
      'orders_pending',
      'transactions_today',
      'transactions_total',
    ])
  })

  it('hands out the api-key token exactly once in the created payload', async () => {
    const r = await fetch(url('/manage/v1/businesses/b1000000-0000-4000-8000-000000000001/api-keys'), {
      method: 'POST',
      headers: { ...mgmtHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'ci' }),
    })
    expect(r.status).toBe(201)
    const data = expectEnvelope<{ api_key: unknown; token: string }>(await r.json())
    expect(data.token.startsWith('vpk_')).toBe(true)
    expect(data.api_key).toMatchObject({ label: 'production', revoked_at: null })
    expect(mock.calls[0]!.body).toEqual({ label: 'ci' })
  })

  it('supports runtime-handler overrides for status and body', async () => {
    mock.server.use(
      http.get(`${DEFAULT_BASE_URL}/manage/v1/businesses`, () =>
        HttpResponse.json({ success: false, error: 'db down' }, { status: 500 }),
      ),
    )
    const r = await fetch(url('/manage/v1/businesses'), { headers: mgmtHeaders })
    expect(r.status).toBe(500)
    expectErrorEnvelope(await r.json(), { error: 'db down' })
  })
})

describe('backend mock harness: merchant domain', () => {
  it('creates orders with 201 and echoes the external id on get', async () => {
    const created = await fetch(url('/api/v1/orders'), {
      method: 'POST',
      headers: { ...merchantHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ external_order_id: 'ord-42', expected_amount: '250.00' }),
    })
    expect(created.status).toBe(201)
    expectEnvelope(await created.json(), { ...FIXTURES.order, external_order_id: 'ord-42', expected_amount: '250.00' })

    const got = await fetch(url('/api/v1/orders/ord-42'), { headers: merchantHeaders })
    expectEnvelope(await got.json(), { ...FIXTURES.order, external_order_id: 'ord-42' })
  })

  it('verifies successfully by default', async () => {
    const r = await fetch(url('/api/v1/orders/order-1001/verify'), {
      method: 'POST',
      headers: { ...merchantHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trx_id: 'TRX8899123' }),
    })
    expect(r.status).toBe(200)
    const data = expectEnvelope<typeof FIXTURES.verifySuccess>(await r.json())
    expect(data.result).toBe('success')
    expect(data.balance_consistent).toBe(true)
  })

  it('replays the already_used conflict via override preset', async () => {
    mock.server.use(
      http.post(`${DEFAULT_BASE_URL}/api/v1/orders/:external_order_id/verify`, () =>
        HttpResponse.json(FIXTURES.errors.alreadyUsed.body, {
          status: FIXTURES.errors.alreadyUsed.status,
        }),
      ),
    )
    const r = await fetch(url('/api/v1/orders/order-1001/verify'), {
      method: 'POST',
      headers: merchantHeaders,
      body: JSON.stringify({ trx_id: 'TRX8899123' }),
    })
    expect(r.status).toBe(409)
    expectErrorEnvelope(await r.json(), { result: 'already_used', error: 'transaction already used' })
  })

  it('surfaces the 429 rate-limit contract with Retry-After via override preset', async () => {
    const preset = FIXTURES.errors.rateLimited
    mock.server.use(
      http.post(`${DEFAULT_BASE_URL}/api/v1/orders/:external_order_id/verify`, () =>
        HttpResponse.json(preset.body, {
          status: preset.status ?? 429,
          ...(preset.headers && { headers: preset.headers }),
        }),
      ),
    )
    const r = await fetch(url('/api/v1/orders/order-1001/verify'), {
      method: 'POST',
      headers: merchantHeaders,
      body: JSON.stringify({ trx_id: 'TRX8899123' }),
    })
    expect(r.status).toBe(429)
    expect(r.headers.get('retry-after')).toBe('30')
    expectErrorEnvelope(await r.json(), { error: 'rate limit exceeded' })
  })

  it('returns a bare array for merchant providers but {items,total} for manage providers', async () => {
    const merchant = expectEnvelope<string[]>(
      await fetch(url('/api/v1/providers'), { headers: merchantHeaders }).then(bodyOf),
    )
    expect(Array.isArray(merchant)).toBe(true)

    const managed = parseListPage(await fetch(url('/manage/v1/providers'), { headers: mgmtHeaders }).then(bodyOf))
    expect(managed.total).toBe(1)
    expect(managed.items[0]).toMatchObject({ name: 'MTN MoMo' })
  })

  it('requires provider_id for device balance and echoes it back when given', async () => {
    const bad = await fetch(url('/api/v1/devices/d3000000-0000-4000-8000-000000000003/balance'), {
      headers: merchantHeaders,
    })
    expect(bad.status).toBe(400)
    expectErrorEnvelope(await bad.json(), { error: 'provider_id query parameter is required' })

    const good = await fetch(
      url('/api/v1/devices/d3000000-0000-4000-8000-000000000003/balance?provider_id=88000000-0000-4000-8000-000000000081'),
      { headers: merchantHeaders },
    )
    const data = expectEnvelope<typeof FIXTURES.balancePoint>(await good.json())
    expect(data.provider_id).toBe('88000000-0000-4000-8000-000000000081')
    expect(mock.calls.at(-1)?.query.provider_id).toBe('88000000-0000-4000-8000-000000000081')
  })
})

describe('backend mock harness: device domain', () => {
  it('returns heartbeat providers including null sender_id entries', async () => {
    const r = await fetch(url('/device/v1/heartbeat'), {
      method: 'POST',
      headers: { ...deviceHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_version: '1.4.2' }),
    })
    const data = expectEnvelope<typeof FIXTURES.heartbeat>(await r.json())
    expect(data.providers).toHaveLength(2)
    expect(data.providers[1]!.sender_id).toBeNull()
    expect(authHeader(mock.calls[0]!, 'vdt_live_test_device_token')).toBeTruthy()
  })

  it('echoes parsed results per client_msg_id and rejects batches over 50', async () => {
    const messages = Array.from({ length: 3 }, (_, i) => ({
      client_msg_id: `33000000-0000-4000-8000-00000000004${i}`,
      sender_id: 'MTN',
      body: `You have received ${i} RWF`,
    }))
    const ok = await fetch(url('/device/v1/messages'), {
      method: 'POST',
      headers: { ...deviceHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    })
    const data = expectEnvelope<{ results: Array<{ client_msg_id: string; status: string }> }>(await ok.json())
    expect(data.results.map((x) => x.client_msg_id)).toEqual(messages.map((m) => m.client_msg_id))
    expect(data.results.every((x) => x.status === 'parsed')).toBe(true)

    const tooMany = Array.from({ length: 51 }, (_, i) => ({ client_msg_id: String(i), body: 'x' }))
    const rejected = await fetch(url('/device/v1/messages'), {
      method: 'POST',
      headers: { ...deviceHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: tooMany }),
    })
    expect(rejected.status).toBe(400)
    expectErrorEnvelope(await rejected.json(), { error: 'messages must contain 1-50 items' })
  })

  it('rejects device endpoints with the wrong domain key', async () => {
    const r = await fetch(url('/device/v1/heartbeat'), {
      method: 'POST',
      headers: { Authorization: merchantHeaders.Authorization },
    })
    expect(r.status).toBe(401)
  })
})
