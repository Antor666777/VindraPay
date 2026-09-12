import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface Endpoint {
  method: string
  path: string
}

const ROUTER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../backend/internal/router/router.go',
)

export const EXPECTED_ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/healthz' },
  { method: 'GET', path: '/api/v1/ping' },

  { method: 'POST', path: '/api/v1/orders' },
  { method: 'GET', path: '/api/v1/orders/{external_order_id}' },
  { method: 'POST', path: '/api/v1/orders/{external_order_id}/verify' },
  { method: 'POST', path: '/api/v1/providers' },
  { method: 'GET', path: '/api/v1/providers' },
  { method: 'GET', path: '/api/v1/providers/{id}' },
  { method: 'PUT', path: '/api/v1/providers/{id}/template' },
  { method: 'DELETE', path: '/api/v1/providers/{id}' },
  { method: 'POST', path: '/api/v1/providers/test' },
  { method: 'POST', path: '/api/v1/devices/{device_id}/calibrate-balance' },
  { method: 'GET', path: '/api/v1/devices/{device_id}/balance' },

  { method: 'POST', path: '/device/v1/heartbeat' },
  { method: 'POST', path: '/device/v1/messages' },

  { method: 'GET', path: '/manage/v1/features' },
  { method: 'GET', path: '/manage/v1/businesses' },
  { method: 'POST', path: '/manage/v1/businesses' },
  { method: 'GET', path: '/manage/v1/businesses/{business_id}' },
  { method: 'PATCH', path: '/manage/v1/businesses/{business_id}/status' },
  { method: 'GET', path: '/manage/v1/businesses/{business_id}/api-keys' },
  { method: 'POST', path: '/manage/v1/businesses/{business_id}/api-keys' },
  { method: 'DELETE', path: '/manage/v1/api-keys/{key_id}' },
  { method: 'GET', path: '/manage/v1/devices' },
  { method: 'POST', path: '/manage/v1/businesses/{business_id}/devices' },
  { method: 'DELETE', path: '/manage/v1/devices/{device_id}' },
  { method: 'GET', path: '/manage/v1/orders' },
  { method: 'GET', path: '/manage/v1/transactions' },
  { method: 'GET', path: '/manage/v1/attempts' },
  { method: 'GET', path: '/manage/v1/messages' },
  { method: 'GET', path: '/manage/v1/stats' },
  { method: 'GET', path: '/manage/v1/providers' },
  { method: 'POST', path: '/manage/v1/providers' },
  { method: 'PUT', path: '/manage/v1/providers/{id}/template' },
  { method: 'DELETE', path: '/manage/v1/providers/{id}' },
  { method: 'POST', path: '/manage/v1/providers/test' },
  { method: 'POST', path: '/manage/v1/devices/{device_id}/calibrate-balance' },
  { method: 'GET', path: '/manage/v1/devices/{device_id}/balance' },
]

const keyOf = (e: Endpoint) => `${e.method} ${e.path}`

function normalizeGinPath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
}

const GROUP_OPEN = /(\w+)\s*:?=\s*r\.Group\(\s*"([^"]+)"/
const GROUP_ROUTE = /\b(\w+)\.(GET|POST|PUT|PATCH|DELETE)\(\s*"([^"]+)"/
const ROOT_ROUTE = /\br\.(GET|POST|PUT|PATCH|DELETE)\(\s*"([^"]+)"/

export function extractRouterEndpoints(source: string): Endpoint[] {
  const endpoints: Endpoint[] = []
  let groupVar = ''
  let groupPrefix = ''
  for (const line of source.split(/\r?\n/)) {
    const open = line.match(GROUP_OPEN)
    if (open && !groupVar) {
      groupVar = open[1]!
      groupPrefix = open[2]!
      continue
    }
    if (groupVar) {
      if (line.trim() === '}') {
        groupVar = ''
        groupPrefix = ''
        continue
      }
      const reg = line.match(GROUP_ROUTE)
      if (reg && reg[1] === groupVar) {
        endpoints.push({ method: reg[2]!, path: normalizeGinPath(groupPrefix + reg[3]!) })
      }
      continue
    }
    const root = line.match(ROOT_ROUTE)
    if (root) {
      endpoints.push({ method: root[1]!, path: normalizeGinPath(root[2]!) })
    }
  }
  return endpoints
}

describe('contract parity: backend/internal/router/router.go vs frozen endpoint table', () => {
  const source = readFileSync(ROUTER_PATH, 'utf8')

  it('finds a gin router Setup function at the expected location', () => {
    expect(source).toContain('func Setup(')
    expect(source).toContain('gin.Default()')
  })

  it('extracts routes from every group plus top-level registrations', () => {
    const extracted = extractRouterEndpoints(source)
    expect(extracted.length).toBeGreaterThanOrEqual(EXPECTED_ENDPOINTS.length)
    expect(extracted.some((e) => e.path === '/healthz')).toBe(true)
    expect(extracted.some((e) => e.path.startsWith('/device/v1'))).toBe(true)
    expect(extracted.some((e) => e.path.startsWith('/manage/v1'))).toBe(true)
  })

  it('every expected endpoint is registered in router.go', () => {
    const actualKeys = new Set(extractRouterEndpoints(source).map(keyOf))
    const missing = EXPECTED_ENDPOINTS.filter((e) => !actualKeys.has(keyOf(e))).map(keyOf)
    expect(missing, `frozen-contract endpoints missing from router.go:\n${missing.join('\n')}`).toEqual([])
  })

  it('every route in router.go appears in the frozen endpoint table', () => {
    const expectedKeys = new Set(EXPECTED_ENDPOINTS.map(keyOf))
    const extra = extractRouterEndpoints(source)
      .filter((e) => !expectedKeys.has(keyOf(e)))
      .map(keyOf)
    expect(extra, `router.go routes missing from EXPECTED_ENDPOINTS:\n${extra.join('\n')}`).toEqual([])
  })

  it('registered route set equals the frozen table exactly (no dupes, no drift)', () => {
    const actual = extractRouterEndpoints(source).map(keyOf).sort()
    const expected = EXPECTED_ENDPOINTS.map(keyOf).sort()
    expect(actual).toEqual(expected)
  })
})
