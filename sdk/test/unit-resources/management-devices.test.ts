import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  AuthenticationError,
  DevicesResource,
  HttpRequester,
} from '../../src/index.js'
import { createBackendMock, DEFAULT_BASE_URL, FIXTURES } from '../support/backend-mock.js'
import { authHeader } from '../support/expectations.js'

const mock = createBackendMock()

beforeAll(() => mock.start())
afterEach(() => mock.reset())
afterAll(() => mock.stop())

const MGMT_KEY = 'mgmt_test_management_key'
const BUSINESS_ID = FIXTURES.business.id
const DEVICE_ID = FIXTURES.deviceView.id
const PROVIDER_ID = FIXTURES.provider.id

function makeResource(apiKey: string = MGMT_KEY) {
  const http = new HttpRequester({
    baseUrl: DEFAULT_BASE_URL,
    apiKey,
    timeoutMs: 2000,
    retry: { retries: 0 },
  })
  return new DevicesResource(http)
}

describe('management DevicesResource', () => {
  it('lists devices filtered by business_id', async () => {
    const page = await makeResource().list({ businessId: BUSINESS_ID, limit: 3 })

    expect(page.total).toBe(1)
    const device = page.items[0]!
    expect(device.id).toBe(DEVICE_ID)
    expect(device.online).toBe(true)
    expect(device.businessId).toBe(BUSINESS_ID)
    expect(device.lastSeenAt).toBe(FIXTURES.deviceView.last_ping_at)
    expect(device.appVersion).toBe('1.4.2')

    const call = mock.calls[0]!
    expect(call.path).toBe('/manage/v1/devices')
    expect(call.query).toEqual({ business_id: BUSINESS_ID, limit: '3' })
    expect(authHeader(call, MGMT_KEY)).toBe(MGMT_KEY)
  })

  it('forwards offset for pagination', async () => {
    await makeResource().list({ businessId: BUSINESS_ID, limit: 3, offset: 5 })

    const call = mock.calls[0]!
    expect(call.query).toEqual({ business_id: BUSINESS_ID, limit: '3', offset: '5' })
  })

  it('registers a device and returns the one-time token with camelCase device view', async () => {
    const created = await makeResource().register(BUSINESS_ID, { name: 'store-front-02' })

    expect(created.token).toMatch(/^vdt_/)
    expect(created.device.name).toBe('store-front-02')
    expect(created.device.businessId).toBe(BUSINESS_ID)

    const call = mock.calls[0]!
    expect(call.method).toBe('POST')
    expect(call.path).toBe(`/manage/v1/businesses/${BUSINESS_ID}/devices`)
    expect(call.body).toEqual({ name: 'store-front-02' })
  })

  it('deactivates a device via DELETE', async () => {
    const device = await makeResource().deactivate(DEVICE_ID)

    expect(device.id).toBe(DEVICE_ID)
    expect(device.deactivatedAt).not.toBeNull()
    expect(device.online).toBe(false)
    expect(mock.calls[0]!.method).toBe('DELETE')
    expect(mock.calls[0]!.path).toBe(`/manage/v1/devices/${DEVICE_ID}`)
  })

  it('fetches the balance point for a provider pair', async () => {
    const point = await makeResource().balance(DEVICE_ID, PROVIDER_ID)

    expect(point.balance).toBe('24500.50')
    expect(point.source).toBe('calibration')
    expect(point.pointAt).toBe(FIXTURES.balancePoint.point_at)

    const call = mock.calls[0]!
    expect(call.method).toBe('GET')
    expect(call.path).toBe(`/manage/v1/devices/${DEVICE_ID}/balance`)
    expect(call.query).toEqual({ provider_id: PROVIDER_ID })
  })

  it('calibrates a balance mapping the body to snake_case', async () => {
    const calibration = await makeResource().calibrate(DEVICE_ID, {
      providerId: PROVIDER_ID,
      balance: '24000.00',
      note: 'top-up',
    })

    expect(calibration.id).toBe(FIXTURES.calibration.id)
    expect(calibration.balance).toBe('24000.00')
    expect(calibration.note).toBe('top-up')
    expect(calibration.calibratedAt).toBe(FIXTURES.calibration.calibrated_at)

    const call = mock.calls[0]!
    expect(call.method).toBe('POST')
    expect(call.path).toBe(`/manage/v1/devices/${DEVICE_ID}/calibrate-balance`)
    expect(call.body).toEqual({ provider_id: PROVIDER_ID, balance: '24000.00', note: 'top-up' })
  })

  it('rejects calls made with a non-management credential', async () => {
    await expect(makeResource('vpk_live_wrong_domain').list()).rejects.toBeInstanceOf(
      AuthenticationError,
    )
  })
})
