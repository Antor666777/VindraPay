import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HttpRequester } from '../../src/index.js'
import {
  BusinessesResource,
  NotFoundError,
} from '../../src/index.js'
import { createBackendMock, DEFAULT_BASE_URL, FIXTURES } from '../support/backend-mock.js'
import { authHeader, envelope } from '../support/expectations.js'

const mock = createBackendMock()

beforeAll(() => mock.start())
afterEach(() => mock.reset())
afterAll(() => mock.stop())

const MGMT_KEY = 'mgmt_test_management_key'

function makeResource() {
  const http = new HttpRequester({
    baseUrl: DEFAULT_BASE_URL,
    apiKey: MGMT_KEY,
    timeoutMs: 2000,
    retry: { retries: 0 },
  })
  return new BusinessesResource(http)
}

describe('management BusinessesResource', () => {
  it('lists businesses with query serialization and camelCase mapping', async () => {
    const page = await makeResource().list({ limit: 5, status: 'active', search: 'acme' })

    expect(page.total).toBe(1)
    expect(page.items).toHaveLength(1)
    const business = page.items[0]!
    expect(business.id).toBe(FIXTURES.business.id)
    expect(business.name).toBe('Acme Retail')
    expect(business.ownerEmail).toBe('owner@acme.dev')
    expect(business.status).toBe('active')

    const call = mock.calls[0]!
    expect(call.method).toBe('GET')
    expect(call.path).toBe('/manage/v1/businesses')
    expect(call.query).toEqual({ limit: '5', status: 'active', search: 'acme' })
    expect(authHeader(call, MGMT_KEY)).toBe(MGMT_KEY)
  })

  it('omits unset filters from the query string', async () => {
    await makeResource().list()
    expect(mock.calls[0]!.url).not.toContain('?status=')
    expect(mock.calls[0]!.query).toEqual({})
  })

  it('iterates every business across pages via listAll', async () => {
    const source = [
      { ...FIXTURES.business },
      { ...FIXTURES.business, id: 'b1000000-0000-4000-8000-0000000000aa', name: 'Beta Co' },
      { ...FIXTURES.business, id: 'b1000000-0000-4000-8000-0000000000bb', name: 'Gamma Ltd' },
    ]
    mock.server.use(
      http.get(`${DEFAULT_BASE_URL}/manage/v1/businesses`, ({ request }) => {
        const u = new URL(request.url)
        const limit = Number(u.searchParams.get('limit') ?? '50')
        const offset = Number(u.searchParams.get('offset') ?? '0')
        return HttpResponse.json(
          envelope({ items: source.slice(offset, offset + limit), total: source.length }),
        )
      }),
    )

    const collected: string[] = []
    for await (const business of makeResource().listAll({ limit: 2 })) {
      collected.push(business.id)
    }

    expect(collected).toEqual(source.map((b) => b.id))
  })

  it('gets a business by id', async () => {
    const business = await makeResource().get(FIXTURES.business.id)

    expect(business.id).toBe(FIXTURES.business.id)
    expect(mock.calls[0]!.path).toBe(`/manage/v1/businesses/${FIXTURES.business.id}`)
  })

  it('creates a business mapping ownerEmail to owner_email', async () => {
    const business = await makeResource().create({ name: 'New Biz', ownerEmail: 'new@biz.dev' })

    expect(business.name).toBe('New Biz')
    expect(business.ownerEmail).toBe('new@biz.dev')
    const call = mock.calls[0]!
    expect(call.method).toBe('POST')
    expect(call.path).toBe('/manage/v1/businesses')
    expect(call.body).toEqual({ name: 'New Biz', owner_email: 'new@biz.dev' })
    expect(authHeader(call, MGMT_KEY)).toBe(MGMT_KEY)
  })

  it('sets business status via PATCH with a snake-free body', async () => {
    const business = await makeResource().setStatus(FIXTURES.business.id, 'suspended')

    expect(business.status).toBe('suspended')
    const call = mock.calls[0]!
    expect(call.method).toBe('PATCH')
    expect(call.path).toBe(`/manage/v1/businesses/${FIXTURES.business.id}/status`)
    expect(call.body).toEqual({ status: 'suspended' })
  })

  it('maps upstream 404 onto NotFoundError', async () => {
    mock.server.use(
      http.get(`${DEFAULT_BASE_URL}/manage/v1/businesses/nope`, () =>
        HttpResponse.json({ success: false, error: 'business not found' }, { status: 404 }),
      ),
    )

    await expect(makeResource().get('nope')).rejects.toBeInstanceOf(NotFoundError)
  })
})
