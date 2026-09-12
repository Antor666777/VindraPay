import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  AuthenticationError,
  ConflictError,
  HttpRequester,
  OrdersMerchantResource,
  RateLimitError,
  UnprocessableError,
} from '../../src/index.js'
import { createBackendMock, DEFAULT_BASE_URL, FIXTURES } from '../support/backend-mock.js'
import { authHeader } from '../support/expectations.js'

const mock = createBackendMock({ merchantKey: 'vpk_live_correct_merchant' })

beforeAll(() => mock.start())
afterEach(() => mock.reset())
afterAll(() => mock.stop())

const MERCHANT_KEY = 'vpk_live_correct_merchant'
const EXTERNAL_ID = 'order-1001'
const verifyPath = `${DEFAULT_BASE_URL}/api/v1/orders/:external_order_id/verify`

function makeResource(apiKey: string = MERCHANT_KEY) {
  const http = new HttpRequester({
    baseUrl: DEFAULT_BASE_URL,
    apiKey,
    timeoutMs: 2000,
    retry: { retries: 0 },
  })
  return new OrdersMerchantResource(http)
}

describe('merchant OrdersMerchantResource', () => {
  it('creates an order mapping camelCase input to the snake_case wire body', async () => {
    const metadata = { source_app: 'web', cart_id: 42 }
    const order = await makeResource().create({
      externalOrderId: 'ord-9001',
      expectedAmount: '250.50',
      expiresAt: '2026-09-01T00:00:00Z',
      metadata,
    })

    expect(order.id).toBe(FIXTURES.order.id)
    expect(order.externalOrderId).toBe('ord-9001')
    expect(order.expectedAmount).toBe('250.50')

    const call = mock.calls[0]!
    expect(call.method).toBe('POST')
    expect(call.path).toBe('/api/v1/orders')
    expect(call.body).toEqual({
      external_order_id: 'ord-9001',
      expected_amount: '250.50',
      expires_at: '2026-09-01T00:00:00Z',
      metadata,
    })
    expect(authHeader(call, MERCHANT_KEY)).toBe(MERCHANT_KEY)
  })

  it('passes amount strings through untouched and omits absent optionals', async () => {
    await makeResource().create({ externalOrderId: 'ord-2', expectedAmount: '1500.00' })
    expect(mock.calls[0]!.body).toEqual({
      external_order_id: 'ord-2',
      expected_amount: '1500.00',
    })
  })

  it('gets an order by its URL-encoded external id', async () => {
    const order = await makeResource().get(EXTERNAL_ID)

    expect(order.externalOrderId).toBe(EXTERNAL_ID)
    expect(mock.calls[0]!.path).toBe(`/api/v1/orders/${EXTERNAL_ID}`)

    await makeResource().get('order 42/slash')
    expect(mock.calls[1]!.path).toBe('/api/v1/orders/order%2042%2Fslash')
  })

  it('verifies successfully into a typed VerifyResult', async () => {
    const result = await makeResource().verify(EXTERNAL_ID, { trxId: 'TRX8899123' })

    expect(result.result).toBe('success')
    expect(result.order.status).toBe('paid')
    expect(result.transaction.trxId).toBe('TRX8899123')
    expect(result.balance_consistent).toBe(true)

    const call = mock.calls[0]!
    expect(call.method).toBe('POST')
    expect(call.path).toBe(`/api/v1/orders/${EXTERNAL_ID}/verify`)
    expect(call.body).toEqual({ trx_id: 'TRX8899123' })
  })

  it('throws ConflictError carrying the already_used result on 409', async () => {
    mock.server.use(
      http.post(verifyPath, () =>
        HttpResponse.json(FIXTURES.errors.alreadyUsed.body, {
          status: FIXTURES.errors.alreadyUsed.status,
        }),
      ),
    )

    const err = await makeResource()
      .verify(EXTERNAL_ID, { trxId: 'TRX8899123' })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ConflictError)
    const conflict = err as ConflictError
    expect(conflict.status).toBe(409)
    expect(conflict.code).toBe('already_used')
    expect(conflict.result).toBe('already_used')
    expect((conflict.details as { result?: unknown }).result).toBe('already_used')
  })

  it('throws UnprocessableError exposing details.result on 422', async () => {
    mock.server.use(
      http.post(verifyPath, () =>
        HttpResponse.json(FIXTURES.errors.amountMismatch.body, {
          status: FIXTURES.errors.amountMismatch.status,
        }),
      ),
    )

    const err = await makeResource()
      .verify(EXTERNAL_ID, { trxId: 'TRX8899123' })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(UnprocessableError)
    const unprocessable = err as UnprocessableError
    expect(unprocessable.code).toBe('amount_mismatch')
    expect((unprocessable.details as { result?: unknown }).result).toBe('amount_mismatch')
    expect((unprocessable as unknown as { result?: unknown }).result).toBe('amount_mismatch')
  })

  it('maps a wrong merchant key onto AuthenticationError', async () => {
    await expect(makeResource('vpk_live_wrong').get(EXTERNAL_ID)).rejects.toBeInstanceOf(
      AuthenticationError,
    )
  })

  it('captures Retry-After seconds on a rate-limited verify (never retried on POST)', async () => {
    const preset = FIXTURES.errors.rateLimited
    mock.server.use(
      http.post(verifyPath, () =>
        HttpResponse.json(preset.body, {
          status: preset.status ?? 429,
          ...(preset.headers && { headers: preset.headers }),
        }),
      ),
    )

    let attempts = 0
    mock.server.use(
      http.post(verifyPath, () => {
        attempts += 1
        return HttpResponse.json(preset.body, {
          status: preset.status ?? 429,
          ...(preset.headers && { headers: preset.headers }),
        })
      }),
    )

    const err = await makeResource()
      .verify(EXTERNAL_ID, { trxId: 'TRX8899123' })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(RateLimitError)
    expect((err as RateLimitError).retryAfterSeconds).toBe(30)
    expect(attempts).toBe(1)
  })
})
