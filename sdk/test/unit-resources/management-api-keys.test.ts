import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ApiKeysResource, HttpRequester } from '../../src/index.js'
import { createBackendMock, DEFAULT_BASE_URL, FIXTURES } from '../support/backend-mock.js'
import { authHeader } from '../support/expectations.js'

const mock = createBackendMock()

beforeAll(() => mock.start())
afterEach(() => mock.reset())
afterAll(() => mock.stop())

const MGMT_KEY = 'mgmt_test_management_key'
const BUSINESS_ID = FIXTURES.business.id

function makeResource() {
  const http = new HttpRequester({
    baseUrl: DEFAULT_BASE_URL,
    apiKey: MGMT_KEY,
    timeoutMs: 2000,
    retry: { retries: 0 },
  })
  return new ApiKeysResource(http)
}

describe('management ApiKeysResource', () => {
  it('normalizes the bare-array listing into {items,total}', async () => {
    const page = await makeResource().list(BUSINESS_ID)

    expect(page).toEqual({ items: [expect.objectContaining({ id: FIXTURES.apiKey.id })], total: 1 })
    const key = page.items[0]!
    expect(key.keyPrefix).toBe('vpk_9f2c')
    expect(key.lastUsedAt).toBeNull()
    expect(key.revokedAt).toBeNull()

    const call = mock.calls[0]!
    expect(call.method).toBe('GET')
    expect(call.path).toBe(`/manage/v1/businesses/${BUSINESS_ID}/api-keys`)
    expect(authHeader(call, MGMT_KEY)).toBe(MGMT_KEY)
  })

  it('slices the unpaginated listing client-side via listAll', async () => {
    const collected: string[] = []
    for await (const key of makeResource().listAll(BUSINESS_ID, 2)) {
      collected.push(key.id)
    }
    expect(collected).toEqual([FIXTURES.apiKey.id])
    expect(mock.calls).toHaveLength(1)
  })

  it('creates a key with snake-free body and surfaces the one-time token', async () => {
    const created = await makeResource().create(BUSINESS_ID, { label: 'ci' })

    expect(created.token).toMatch(/^vpk_/)
    expect(created.apiKey.id).toBe(FIXTURES.apiKeyCreated.api_key.id)
    expect(created.apiKey.label).toBe('production')
    const call = mock.calls[0]!
    expect(call.method).toBe('POST')
    expect(call.path).toBe(`/manage/v1/businesses/${BUSINESS_ID}/api-keys`)
    expect(call.body).toEqual({ label: 'ci' })
    expect(authHeader(call, MGMT_KEY)).toBe(MGMT_KEY)
  })

  it('revokes a key by id via DELETE', async () => {
    const keyId = FIXTURES.apiKey.id
    const key = await makeResource().revoke(keyId)

    expect(key.id).toBe(keyId)
    expect(key.revokedAt).not.toBeNull()
    const call = mock.calls[0]!
    expect(call.method).toBe('DELETE')
    expect(call.path).toBe(`/manage/v1/api-keys/${keyId}`)
    expect(authHeader(call, MGMT_KEY)).toBe(MGMT_KEY)
  })
})
