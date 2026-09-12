import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DeviceResource, HttpRequester, ValidationError } from '../../src/index.js'
import { createBackendMock, DEFAULT_BASE_URL, FIXTURES } from '../support/backend-mock.js'
import { authHeader, envelope } from '../support/expectations.js'

const mock = createBackendMock()

beforeAll(() => mock.start())
afterEach(() => mock.reset())
afterAll(() => mock.stop())

const DEVICE_KEY = 'vdt_live_test_device_token'

function makeResource() {
  const http = new HttpRequester({
    baseUrl: DEFAULT_BASE_URL,
    apiKey: DEVICE_KEY,
    timeoutMs: 2000,
    retry: { retries: 0 },
  })
  return new DeviceResource(http)
}

describe('device DeviceResource', () => {
  it('heartbeats with snake_case metadata and maps providers to camelCase', async () => {
    const result = await makeResource().heartbeat({ appVersion: '1.4.2', osVersion: 'Android 14' })

    expect(result.providers).toHaveLength(2)
    expect(result.providers[0]).toEqual({
      id: FIXTURES.provider.id,
      name: 'MTN MoMo',
      senderId: 'MTN',
      direction: 'credit',
    })
    expect(result.providers[1]!.senderId).toBeNull()

    const call = mock.calls[0]!
    expect(call.method).toBe('POST')
    expect(call.path).toBe('/device/v1/heartbeat')
    expect(call.body).toEqual({ app_version: '1.4.2', os_version: 'Android 14' })
    expect(authHeader(call, DEVICE_KEY)).toBe(DEVICE_KEY)
  })

  it('heartbeat sends an empty body when no metadata is supplied', async () => {
    await makeResource().heartbeat()
    expect(mock.calls[0]!.body).toEqual({})
  })

  it('sendMessages maps InboundMessage fields to the snake_case wire body', async () => {
    const results = await makeResource().sendMessages([
      {
        clientMsgId: 'msg-1',
        senderId: 'MTN',
        body: 'You have received 1500 RWF',
        deviceReceivedAt: '2026-08-26T10:00:00Z',
      },
      { clientMsgId: 'msg-2', body: 'You have sent 200 RWF' },
    ])

    expect(results.map((r) => r.status)).toEqual(['parsed', 'parsed'])
    expect(results[0]!.clientMsgId).toBe('msg-1')

    const call = mock.calls[0]!
    expect(call.method).toBe('POST')
    expect(call.path).toBe('/device/v1/messages')
    expect(call.body).toEqual({
      messages: [
        {
          client_msg_id: 'msg-1',
          sender_id: 'MTN',
          body: 'You have received 1500 RWF',
          device_received_at: '2026-08-26T10:00:00Z',
        },
        { client_msg_id: 'msg-2', body: 'You have sent 200 RWF' },
      ],
    })
  })

  it('surfaces every ingest status including error payloads', async () => {
    mock.server.use(
      http.post(`${DEFAULT_BASE_URL}/device/v1/messages`, () =>
        HttpResponse.json(envelope({ results: FIXTURES.ingestResults })),
      ),
    )

    const results = await makeResource().sendMessages(
      FIXTURES.ingestResults.map((r) => ({
        clientMsgId: String(r.client_msg_id),
        body: 'body',
      })),
    )

    expect(results.map((r) => r.status)).toEqual([
      'parsed',
      'duplicate',
      'unmatched',
      'skipped',
      'error',
    ])
    expect(results[4]!.error).toBe('template compile failed')
  })

  it('rejects an empty batch locally before any network traffic', async () => {
    await expect(makeResource().sendMessages([])).rejects.toBeInstanceOf(ValidationError)
    expect(mock.calls).toHaveLength(0)
  })

  it('rejects a batch over 50 messages locally before any network traffic', async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({ clientMsgId: `m${i}`, body: 'x' }))
    await expect(makeResource().sendMessages(tooMany)).rejects.toBeInstanceOf(ValidationError)
    expect(mock.calls).toHaveLength(0)
  })

  it('rejects messages missing clientMsgId or body locally', async () => {
    await expect(
      makeResource().sendMessages([{ clientMsgId: '', body: 'x' }]),
    ).rejects.toThrow(/clientMsgId/)
    await expect(
      makeResource().sendMessages([{ clientMsgId: 'a', body: '' }]),
    ).rejects.toThrow(/body/)
    expect(mock.calls).toHaveLength(0)
  })
})
