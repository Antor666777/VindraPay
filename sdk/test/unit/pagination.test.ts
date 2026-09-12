import { describe, expect, it, vi } from 'vitest'
import { paginate as corePaginate, paginateAll as corePaginateAll } from '../../src/core/index.js'

interface Paged<T> {
  items: T[]
  total: number
}

type FetchPage<T> = (limit: number, offset: number) => Promise<Paged<T>>

const MAX_ITEMS = 10000

async function paginateAll<T>(fetchPage: FetchPage<T>, limit: number): Promise<T[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`limit must be a positive integer, received ${String(limit)}`)
  }
  const out: T[] = []
  let offset = 0
  let total = Number.POSITIVE_INFINITY
  while (out.length < total) {
    const page = await fetchPage(limit, offset)
    total = page.total
    out.push(...page.items)
    if (page.items.length === 0) break
    if (page.items.length < limit) break
    offset += limit
    if (out.length > MAX_ITEMS) {
      throw new Error(`pagination runaway: fetched ${out.length} items, guard is ${MAX_ITEMS}`)
    }
  }
  return out
}

describe('pagination semantics against injected fetchPage(limit, offset)', () => {
  it('accumulates pages until the reported total is reached', async () => {
    const source = Array.from({ length: 5 }, (_, i) => `item-${i}`)
    const fetchPage = vi.fn(async (limit: number, offset: number) => ({
      items: source.slice(offset, offset + limit),
      total: source.length,
    }))

    const result = await paginateAll(fetchPage, 2)

    expect(result).toEqual(source)
    expect(fetchPage.mock.calls.map((c) => c[1])).toEqual([0, 2, 4])
  })

  it('performs exact offset arithmetic of limit per step', async () => {
    const source = Array.from({ length: 30 }, (_, i) => i)
    const fetchPage = vi.fn(async (limit: number, offset: number) => ({
      items: source.slice(offset, offset + limit),
      total: source.length,
    }))

    await paginateAll(fetchPage, 10)

    expect(fetchPage.mock.calls).toEqual([
      [10, 0],
      [10, 10],
      [10, 20],
    ])
  })

  it('stops early when a short page arrives even if total claims more', async () => {
    const fetchPage = vi.fn(async () => ({
      items: ['a', 'b', 'c'],
      total: 100,
    }))

    const result = await paginateAll(fetchPage, 10)

    expect(result).toEqual(['a', 'b', 'c'])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('returns empty immediately on an empty first page without looping', async () => {
    const fetchPage = vi.fn(async () => ({ items: [], total: 7 }))

    const result = await paginateAll(fetchPage, 25)

    expect(result).toEqual([])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('continues through consecutive exactly-full pages until total terminates the loop', async () => {
    const fetchPage = vi.fn(async (limit: number, offset: number) => ({
      items: offset === 0 ? ['a', 'b'] : ['c', 'd'],
      total: 4,
    }))

    const result = await paginateAll(fetchPage, 2)

    expect(result).toEqual(['a', 'b', 'c', 'd'])
    expect(fetchPage.mock.calls).toEqual([
      [2, 0],
      [2, 2],
    ])
  })

  it('throws the runaway guard once more than MAX_ITEMS accumulate', async () => {
    const fullPage = Array.from({ length: 500 }, (_, i) => i)
    const fetchPage = vi.fn(async () => ({
      items: fullPage,
      total: 1_000_000_000,
    }))

    await expect(paginateAll(fetchPage, 500)).rejects.toThrow(/runaway/)

    expect(fetchPage.mock.calls.length).toBeLessThanOrEqual(25)
  })

  it('rejects non-positive limits before any fetch happens', async () => {
    const fetchPage = vi.fn(async () => ({ items: [], total: 0 }))

    await expect(paginateAll(fetchPage, 0)).rejects.toThrow(/limit/)
    await expect(paginateAll(fetchPage, -5)).rejects.toThrow(/limit/)
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('propagates fetcher failures to the caller', async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error('boom')
    })

    await expect(paginateAll(fetchPage, 10)).rejects.toThrow('boom')
  })
})

describe('WAVE-2: src/core pagination drives the frozen semantics', () => {
  it('activates once src/core exports paginateAll with the frozen signature', async () => {
    const specifier = '../../src/core/index.js'
    const mod: Record<string, unknown> = await import(/* @vite-ignore */ specifier)
    expect(typeof mod.paginateAll).toBe('function')
    expect(typeof mod.paginate).toBe('function')
  })

  it('paginateAll accumulates pages until the reported total is reached', async () => {
    const source = Array.from({ length: 5 }, (_, i) => `item-${i}`)
    const fetchPage = vi.fn(async (limit: number, offset: number) => ({
      items: source.slice(offset, offset + limit),
      total: source.length,
    }))

    const result = await corePaginateAll(fetchPage, 2)

    expect(result).toEqual(source)
    expect(fetchPage.mock.calls.map((c) => c[1])).toEqual([0, 2, 4])
  })

  it('core paginate yields items in backend order across pages', async () => {
    const source = ['a', 'b', 'c', 'd']
    const fetchPage = async (limit: number, offset: number) => ({
      items: source.slice(offset, offset + limit),
      total: source.length,
    })
    const collected: string[] = []
    for await (const item of corePaginate(fetchPage, 3)) {
      collected.push(item)
    }
    expect(collected).toEqual(source)
  })

  it('paginateAll rejects non-positive page sizes before any fetch happens', async () => {
    const fetchPage = vi.fn(async () => ({ items: [], total: 0 }))

    await expect(corePaginateAll(fetchPage, 0)).rejects.toThrow(/pageSize/)
    expect(fetchPage).not.toHaveBeenCalled()
  })
})
