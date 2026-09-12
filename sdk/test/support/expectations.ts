export interface Envelope<T> {
  success: true
  data: T
}

export interface ErrorEnvelope {
  success: false
  error: string
  result?: string
}

export interface ListPage<T> {
  items: T[]
  total: number
}

type HeaderSource = { headers: Headers | Record<string, string> }

export function envelope<T>(data: T): Envelope<T> {
  return { success: true, data }
}

export function errorEnvelope(error: string, result?: string): ErrorEnvelope {
  return result === undefined ? { success: false, error } : { success: false, error, result }
}

function fail(message: string): never {
  throw new Error(message)
}

export function expectEnvelope<T = unknown>(body: unknown, expected?: T): T {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(`expected envelope object, received ${safeStringify(body)}`)
  }
  const record = body as Record<string, unknown>
  if (record.success !== true) {
    return fail(`expected success:true envelope, received ${safeStringify(body)}`)
  }
  if (!('data' in record)) {
    return fail(`envelope missing data field: ${safeStringify(body)}`)
  }
  if (expected !== undefined && stableStringify(record.data) !== stableStringify(expected)) {
    return fail(`envelope data mismatch\nexpected: ${stableStringify(expected)}\nreceived: ${stableStringify(record.data)}`)
  }
  return record.data as T
}

export function expectErrorEnvelope(body: unknown, expected?: Partial<ErrorEnvelope>): ErrorEnvelope {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(`expected error envelope object, received ${safeStringify(body)}`)
  }
  const record = body as Record<string, unknown>
  if (record.success !== false) {
    return fail(`expected success:false envelope, received ${safeStringify(body)}`)
  }
  if (typeof record.error !== 'string' || record.error.length === 0) {
    return fail(`error envelope missing string error field: ${safeStringify(body)}`)
  }
  if (expected?.error !== undefined && record.error !== expected.error) {
    return fail(`error message mismatch: expected "${expected.error}", received "${record.error}"`)
  }
  if (expected?.result !== undefined && record.result !== expected.result) {
    return fail(`error result mismatch: expected "${expected.result}", received "${String(record.result)}"`)
  }
  return body as ErrorEnvelope
}

export function authHeader(req: HeaderSource, token: string): string {
  const raw =
    req.headers instanceof Headers
      ? req.headers.get('authorization')
      : ((req.headers as Record<string, string>)['authorization'] ?? null)
  if (raw === null || raw === undefined) {
    return fail('missing Authorization header')
  }
  if (!/^Bearer\s/i.test(raw)) {
    return fail(`Authorization header does not use Bearer scheme: "${raw}"`)
  }
  const value = raw.replace(/^Bearer\s+/i, '')
  if (value !== token) {
    return fail(`Bearer token mismatch: expected "${token}", received "${value}"`)
  }
  return value
}

export function parseQuery(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams)
}

export function parseListPage<T = unknown>(body: unknown): ListPage<T> {
  const data = expectEnvelope<Record<string, unknown>>(body)
  if (!Array.isArray(data.items)) {
    return fail(`list page data.items must be an array, received ${safeStringify(data.items)}`)
  }
  if (typeof data.total !== 'number' || !Number.isInteger(data.total) || data.total < 0) {
    return fail(`list page data.total must be a non-negative integer, received ${String(data.total)}`)
  }
  return { items: data.items as T[], total: data.total }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function stableStringify(value: unknown): string {
  return safeStringify(sortKeysDeep(value))
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    )
  }
  return value
}
