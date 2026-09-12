import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { VindraPay } from '../../src/index.js'
import { createBackendMock, DEFAULT_BASE_URL, FIXTURES } from '../support/backend-mock.js'
import { authHeader } from '../support/expectations.js'

const mock = createBackendMock()

beforeAll(() => mock.start())
afterEach(() => mock.reset())
afterAll(() => mock.stop())

const MGMT_KEY = 'mgmt_test_management_key'
const MERCHANT_KEY = 'vpk_live_test_merchant_key'
const DEVICE_KEY = 'vdt_live_test_device_token'

describe('VindraPay facade', () => {
  it('rejects a missing options object at construction time', () => {
    expect(() => new VindraPay(null as unknown as { baseUrl: string })).toThrow(TypeError)
    expect(() => new VindraPay(undefined as unknown as { baseUrl: string })).toThrow(TypeError)
  })

  it('reuses one client bundle per credential and isolates different credentials', () => {
    const client = new VindraPay({ baseUrl: DEFAULT_BASE_URL })

    expect(client.merchant(MERCHANT_KEY)).toBe(client.merchant(MERCHANT_KEY))
    expect(client.management(MGMT_KEY)).toBe(client.management(MGMT_KEY))
    expect(client.device(DEVICE_KEY)).toBe(client.device(DEVICE_KEY))
  })

  it('routes management traffic with the management bearer', async () => {
    const client = new VindraPay({ baseUrl: DEFAULT_BASE_URL })

    const stats = await client.management(MGMT_KEY).stats.get()

    expect(stats.businesses).toBe(12)
    expect(mock.calls[0]!.path).toBe('/manage/v1/stats')
    expect(authHeader(mock.calls[0]!, MGMT_KEY)).toBe(MGMT_KEY)
  })

  it('routes merchant traffic with the merchant bearer', async () => {
    const client = new VindraPay({ baseUrl: DEFAULT_BASE_URL })

    const order = await client.merchant(MERCHANT_KEY).orders.create({
      externalOrderId: 'order-1001',
      expectedAmount: '1500.00',
    })

    expect(order.id).toBe(FIXTURES.order.id)
    expect(mock.calls[0]!.path).toBe('/api/v1/orders')
    expect(authHeader(mock.calls[0]!, MERCHANT_KEY)).toBe(MERCHANT_KEY)
  })

  it('routes device traffic with the device token bearer', async () => {
    const client = new VindraPay({ baseUrl: DEFAULT_BASE_URL })

    const heartbeat = await client.device(DEVICE_KEY).heartbeat()

    expect(heartbeat.providers.length).toBeGreaterThanOrEqual(1)
    expect(mock.calls[0]!.path).toBe('/device/v1/heartbeat')
    expect(authHeader(mock.calls[0]!, DEVICE_KEY)).toBe(DEVICE_KEY)
  })
})
