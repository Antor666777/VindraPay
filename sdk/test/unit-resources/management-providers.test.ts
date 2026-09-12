import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  HttpRequester,
  ProvidersManageResource,
  ValidationError,
} from '../../src/index.js'
import { createBackendMock, DEFAULT_BASE_URL, FIXTURES } from '../support/backend-mock.js'
import { authHeader, envelope, errorEnvelope } from '../support/expectations.js'

const mock = createBackendMock()

beforeAll(() => mock.start())
afterEach(() => mock.reset())
afterAll(() => mock.stop())

const MGMT_KEY = 'mgmt_test_management_key'
const PROVIDER_ID = FIXTURES.provider.id

function makeResource() {
  const http = new HttpRequester({
    baseUrl: DEFAULT_BASE_URL,
    apiKey: MGMT_KEY,
    timeoutMs: 2000,
    retry: { retries: 0 },
  })
  return new ProvidersManageResource(http)
}

describe('management ProvidersManageResource', () => {
  it('normalizes the paged envelope into a bare Provider array', async () => {
    const providers = await makeResource().list({ businessId: FIXTURES.business.id })

    expect(Array.isArray(providers)).toBe(true)
    expect(providers).toHaveLength(1)
    const provider = providers[0]!
    expect(provider.name).toBe('MTN MoMo')
    expect(provider.matchMode).toBe('template')
    expect(provider.isActive).toBe(true)

    const call = mock.calls[0]!
    expect(call.path).toBe('/manage/v1/providers')
    expect(call.query).toEqual({ business_id: FIXTURES.business.id })
    expect(authHeader(call, MGMT_KEY)).toBe(MGMT_KEY)
  })

  it('listPaged returns {items,total} even for a bare-array backend', async () => {
    let seenQuery: Record<string, string> | undefined
    mock.server.use(
      http.get(`${DEFAULT_BASE_URL}/manage/v1/providers`, ({ request }) => {
        seenQuery = Object.fromEntries(new URL(request.url).searchParams)
        return HttpResponse.json(envelope([FIXTURES.provider, { ...FIXTURES.provider, id: 'p2' }]))
      }),
    )

    const page = await makeResource().listPaged({ direction: 'credit', matchMode: 'template' })

    expect(page.total).toBe(2)
    expect(page.items).toHaveLength(2)
    expect(seenQuery).toEqual({ direction: 'credit', match_mode: 'template' })
  })

  it('listAll iterates providers until the reported total is collected', async () => {
    const collected: string[] = []
    for await (const provider of makeResource().listAll()) {
      collected.push(provider.id)
    }
    expect(collected).toEqual([PROVIDER_ID])
  })

  it('creates a provider passing every field through as snake_case', async () => {
    const provider = await makeResource().create({
      businessId: FIXTURES.business.id,
      name: 'Airtel Money',
      senderId: 'AIRTEL',
      smsTemplate: 'Received {amount} from {sender}',
      priority: 42,
      direction: 'credit',
      matchMode: 'template',
      script: 'return { amount: fields.amount }',
    })

    expect(provider.name).toBe('Airtel Money')

    const call = mock.calls[0]!
    expect(call.method).toBe('POST')
    expect(call.path).toBe('/manage/v1/providers')
    expect(call.body).toEqual({
      business_id: FIXTURES.business.id,
      name: 'Airtel Money',
      sender_id: 'AIRTEL',
      sms_template: 'Received {amount} from {sender}',
      priority: 42,
      direction: 'credit',
      match_mode: 'template',
      script: 'return { amount: fields.amount }',
    })
  })

  it('omits empty optional strings (global provider without sender/script)', async () => {
    await makeResource().create({ name: 'Global', smsTemplate: '{amount}' })
    expect(mock.calls[0]!.body).toEqual({ name: 'Global', sms_template: '{amount}' })
  })

  it('surfaces invalid templates as ValidationError with the 400 status the backend sends', async () => {
    mock.server.use(
      http.post(`${DEFAULT_BASE_URL}/manage/v1/providers`, () =>
        HttpResponse.json(errorEnvelope('invalid sms_template: unbalanced placeholder'), {
          status: 400,
        }),
      ),
    )

    const err = await makeResource()
      .create({ name: 'Broken', smsTemplate: '{amount' })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ValidationError)
    expect((err as Error).message).toContain('invalid sms_template')
  })

  it('updates a template via PUT including optional fields', async () => {
    const provider = await makeResource().updateTemplate(PROVIDER_ID, {
      smsTemplate: 'New template {trx_id}',
      direction: 'debit',
      matchMode: 'regex',
    })

    expect(provider.smsTemplate).toBe('New template {trx_id}')

    const call = mock.calls[0]!
    expect(call.method).toBe('PUT')
    expect(call.path).toBe(`/manage/v1/providers/${PROVIDER_ID}/template`)
    expect(call.body).toEqual({
      sms_template: 'New template {trx_id}',
      direction: 'debit',
      match_mode: 'regex',
    })
  })

  it('removes (deactivates) a provider via DELETE', async () => {
    const provider = await makeResource().remove(PROVIDER_ID)

    expect(provider.id).toBe(PROVIDER_ID)
    expect(provider.isActive).toBe(false)
    expect(mock.calls[0]!.method).toBe('DELETE')
    expect(mock.calls[0]!.path).toBe(`/manage/v1/providers/${PROVIDER_ID}`)
  })

  it('tests a template and maps the successful result', async () => {
    const result = await makeResource().test({
      smsTemplate: FIXTURES.provider.sms_template!,
      sampleBody: 'You have received 1500 RWF',
      matchMode: 'template',
    })

    expect(result.match).toBe(true)
    expect(result.fields?.trx_id).toBe('TRX8899123')
    expect(result.transformed).toBeUndefined()

    const call = mock.calls[0]!
    expect(call.method).toBe('POST')
    expect(call.path).toBe('/manage/v1/providers/test')
    expect(call.body).toEqual({
      sms_template: FIXTURES.provider.sms_template,
      sample_body: 'You have received 1500 RWF',
      match_mode: 'template',
    })
  })

  it('keeps reject_reason verbatim when the backend rejects the sample', async () => {
    mock.server.use(
      http.post(`${DEFAULT_BASE_URL}/manage/v1/providers/test`, () =>
        HttpResponse.json(
          envelope({ match: false, rejected: true, reject_reason: 'script_rejected' }),
        ),
      ),
    )

    const result = await makeResource().test({
      smsTemplate: '{amount}',
      sampleBody: 'nothing',
      script: 'if true then end',
    })

    expect(result.match).toBe(false)
    expect(result.rejected).toBe(true)
    expect(result.reject_reason).toBe('script_rejected')
    expect(result).not.toHaveProperty('rejectReason')
  })
})
