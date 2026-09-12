import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  DevicesMerchantResource,
  HttpRequester,
  ProvidersMerchantResource,
} from '../../src/index.js'
import { createBackendMock, DEFAULT_BASE_URL, FIXTURES } from '../support/backend-mock.js'
import { authHeader } from '../support/expectations.js'

const mock = createBackendMock()

beforeAll(() => mock.start())
afterEach(() => mock.reset())
afterAll(() => mock.stop())

const MERCHANT_KEY = 'vpk_live_test_merchant_key'
const PROVIDER_ID = FIXTURES.provider.id
const DEVICE_ID = FIXTURES.deviceView.id

function make<T>(ctor: new (http: HttpRequester) => T): T {
  const http = new HttpRequester({
    baseUrl: DEFAULT_BASE_URL,
    apiKey: MERCHANT_KEY,
    timeoutMs: 2000,
    retry: { retries: 0 },
  })
  return new ctor(http)
}

describe('merchant ProvidersMerchantResource', () => {
  it('normalizes the bare-array listing to Provider[] with the merchant key', async () => {
    const providers = await make(ProvidersMerchantResource).list()

    expect(Array.isArray(providers)).toBe(true)
    expect(providers[0]!.id).toBe(PROVIDER_ID)
    expect(authHeader(mock.calls[0]!, MERCHANT_KEY)).toBe(MERCHANT_KEY)
    expect(mock.calls[0]!.path).toBe('/api/v1/providers')
  })

  it('gets a single provider by id', async () => {
    const provider = await make(ProvidersMerchantResource).get(PROVIDER_ID)

    expect(provider.id).toBe(PROVIDER_ID)
    expect(mock.calls[0]!.path).toBe(`/api/v1/providers/${PROVIDER_ID}`)
  })

  it('creates a provider mirroring the manage-domain body mapping', async () => {
    await make(ProvidersMerchantResource).create({
      name: 'Own Provider',
      senderId: 'OWN',
      smsTemplate: '{amount} received',
      matchMode: 'template',
      direction: 'credit',
    })

    expect(mock.calls[0]!.method).toBe('POST')
    expect(mock.calls[0]!.path).toBe('/api/v1/providers')
    expect(mock.calls[0]!.body).toEqual({
      name: 'Own Provider',
      sender_id: 'OWN',
      sms_template: '{amount} received',
      match_mode: 'template',
      direction: 'credit',
    })
  })

  it('updates and removes templates on the merchant paths', async () => {
    const updated = await make(ProvidersMerchantResource).updateTemplate(PROVIDER_ID, {
      smsTemplate: 'Merchant template {trx_id}',
    })
    expect(updated.id).toBe(PROVIDER_ID)
    expect(mock.calls[0]!).toMatchObject({
      method: 'PUT',
      path: `/api/v1/providers/${PROVIDER_ID}/template`,
    })
    expect(mock.calls[0]!.body).toEqual({ sms_template: 'Merchant template {trx_id}' })

    const removed = await make(ProvidersMerchantResource).remove(PROVIDER_ID)
    expect(removed.isActive).toBe(false)
    expect(mock.calls[1]!).toMatchObject({ method: 'DELETE', path: `/api/v1/providers/${PROVIDER_ID}` })
  })

  it('runs the identical test passthrough', async () => {
    const result = await make(ProvidersMerchantResource).test({
      smsTemplate: FIXTURES.provider.sms_template!,
      sampleBody: 'You have received 1500 RWF from MTN. Ref TRX8899123.',
    })

    expect(result.match).toBe(true)
    expect(result.fields?.amount).toBe('1500.00')
    expect(mock.calls[0]!.path).toBe('/api/v1/providers/test')
    expect(mock.calls[0]!.body).toEqual({
      sms_template: FIXTURES.provider.sms_template,
      sample_body: 'You have received 1500 RWF from MTN. Ref TRX8899123.',
    })
  })

  it('listAll slices the unpaginated array client-side', async () => {
    const collected: string[] = []
    for await (const provider of make(ProvidersMerchantResource).listAll(10)) {
      collected.push(provider.id)
    }
    expect(collected).toEqual([PROVIDER_ID])
    expect(mock.calls).toHaveLength(1)
  })
})

describe('merchant DevicesMerchantResource', () => {
  it('fetches the device balance point for a provider', async () => {
    const point = await make(DevicesMerchantResource).balance(DEVICE_ID, PROVIDER_ID)

    expect(point.balance).toBe('24500.50')
    expect(point.source).toBe('calibration')
    expect(point.pointAt).toBeDefined()
    expect(mock.calls[0]!.path).toBe(`/api/v1/devices/${DEVICE_ID}/balance`)
    expect(mock.calls[0]!.query).toEqual({ provider_id: PROVIDER_ID })
  })

  it('calibrates the device balance with a snake_case body', async () => {
    const calibration = await make(DevicesMerchantResource).calibrate(DEVICE_ID, {
      providerId: PROVIDER_ID,
      balance: '10000.00',
    })

    expect(calibration.id).toBe(FIXTURES.calibration.id)
    expect(mock.calls[0]!).toMatchObject({
      method: 'POST',
      path: `/api/v1/devices/${DEVICE_ID}/calibrate-balance`,
    })
    expect(mock.calls[0]!.body).toEqual({ provider_id: PROVIDER_ID, balance: '10000.00' })
  })
})
