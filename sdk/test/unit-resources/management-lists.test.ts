import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  AttemptsResource,
  FeaturesResource,
  HttpRequester,
  MessagesResource,
  OrdersMgmtResource,
  StatsResource,
  TransactionsResource,
} from '../../src/index.js'
import { createBackendMock, DEFAULT_BASE_URL, FIXTURES } from '../support/backend-mock.js'
import { authHeader } from '../support/expectations.js'

const mock = createBackendMock()

beforeAll(() => mock.start())
afterEach(() => mock.reset())
afterAll(() => mock.stop())

const MGMT_KEY = 'mgmt_test_management_key'
const BUSINESS_ID = FIXTURES.business.id

function make<T>(ctor: new (http: HttpRequester) => T): T {
  const http = new HttpRequester({
    baseUrl: DEFAULT_BASE_URL,
    apiKey: MGMT_KEY,
    timeoutMs: 2000,
    retry: { retries: 0 },
  })
  return new ctor(http)
}

describe('management filtered lists', () => {
  it('OrdersMgmtResource lists with business_id and status filters', async () => {
    const page = await make(OrdersMgmtResource).list({ businessId: BUSINESS_ID, status: 'pending' })

    expect(page.total).toBe(1)
    const order = page.items[0]!
    expect(order.externalOrderId).toBe('order-1001')
    expect(order.expectedAmount).toBe('1500.00')
    expect(order.status).toBe('pending')

    const call = mock.calls[0]!
    expect(call.path).toBe('/manage/v1/orders')
    expect(call.query).toEqual({ business_id: BUSINESS_ID, status: 'pending' })
    expect(authHeader(call, MGMT_KEY)).toBe(MGMT_KEY)
  })

  it('TransactionsResource maps wire fields to camelCase entities', async () => {
    const page = await make(TransactionsResource).list({
      providerId: FIXTURES.provider.id,
      direction: 'debit',
      limit: 1,
      offset: 1,
    })

    const txn = page.items[0]!
    expect(txn.trxId).toBe('TRX7770001')
    expect(txn.amount).toBe('320.75')
    expect(txn.direction).toBe('debit')
    expect(txn.effectiveAmount).toBe('-320.75')
    expect(txn.senderMsisdn).toBe('+250788000222')

    const call = mock.calls[0]!
    expect(call.path).toBe('/manage/v1/transactions')
    expect(call.query).toEqual({
      provider_id: FIXTURES.provider.id,
      direction: 'debit',
      limit: '1',
      offset: '1',
    })
  })

  it('AttemptsResource serializes the trx_id filter verbatim', async () => {
    const page = await make(AttemptsResource).list({ trxId: 'TRX8899123', result: 'success' })

    const attempt = page.items[0]!
    expect(attempt.result).toBe('success')
    expect(attempt.submittedTrxId).toBe('TRX8899123')
    expect(attempt.balanceConsistent).toBe(true)

    const call = mock.calls[0]!
    expect(call.path).toBe('/manage/v1/attempts')
    expect(call.query).toEqual({ result: 'success', trx_id: 'TRX8899123' })
  })

  it('MessagesResource filters by parse_status', async () => {
    const page = await make(MessagesResource).list({ parseStatus: 'parsed' })

    const message = page.items[0]!
    expect(message.parseStatus).toBe('parsed')
    expect(message.clientMsgId).toBeDefined()
    expect(message.senderId).toBe('MTN')
    expect(message.deviceReceivedAt).toBe(FIXTURES.rawMessage.device_received_at)

    const call = mock.calls[0]!
    expect(call.path).toBe('/manage/v1/messages')
    expect(call.query).toEqual({ parse_status: 'parsed' })
  })

  it('listAll drains paged endpoints across offset arithmetic', async () => {
    const collected: string[] = []
    for await (const order of make(OrdersMgmtResource).listAll({ limit: 1 })) {
      collected.push(order.id)
    }
    expect(collected).toEqual([FIXTURES.order.id])
    expect(mock.calls.map((c) => c.query.offset)).toEqual(['0'])
  })
})

describe('management StatsResource + FeaturesResource', () => {
  it('maps snake_case stat counters onto StudioStats', async () => {
    const stats = await make(StatsResource).get()

    expect(stats.businesses).toBe(12)
    expect(stats.devices).toBe(34)
    expect(stats.transactions).toBe(5678)
    expect(stats.orders).toBe(437)
    expect(stats.verificationAttempts).toBe(120)
    expect(stats.rawMessages).toBe(3)
    expect(stats.businessesTotal).toBe(12)
    expect(stats.ordersPaid).toBe(430)
    expect(stats.attemptsToday).toBe(120)

    const call = mock.calls[0]!
    expect(call.path).toBe('/manage/v1/stats')
    expect(authHeader(call, MGMT_KEY)).toBe(MGMT_KEY)
  })

  it('maps feature flags onto camelCase fields', async () => {
    const features = await make(FeaturesResource).get()

    expect(features.allowUnsafeScripts).toBe(false)
    expect(features.scriptTimeoutMs).toBe(3000)

    expect(mock.calls[0]!.path).toBe('/manage/v1/features')
  })
})
