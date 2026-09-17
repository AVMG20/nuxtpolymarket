/**
 * Unit tests for the sidecar price mapping. No DB and no network: the
 * sidecar call goes through `$fetch`, which is stubbed per case.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCardPrice, fetchCardPrices, clearPriceCache } from '#server/utils/tcg/prices'

const BASE = 'http://sidecar.invalid'

function stubFetch(impl: (url: string) => unknown) {
    Object.assign(globalThis, { $fetch: vi.fn((url: string) => Promise.resolve(impl(url))) })
}

afterEach(() => {
    Reflect.deleteProperty(globalThis, '$fetch')
    vi.restoreAllMocks()
    // Prices cache in process; each case starts from an empty one.
    clearPriceCache()
})

describe('fetchCardPrice', () => {
    it('maps both currencies and reports the fresher timestamp', async () => {
        stubFetch(() => ({
            price: {
                usd: 0.16,
                eur: 0.08,
                cardmarketUpdated: '2026-08-27T15:00:46.224Z',
                tcgplayerUpdated: '2026-08-27T15:00:46.924Z'
            }
        }))
        expect(await fetchCardPrice('swsh7_1', BASE)).toEqual({
            usd: 0.16,
            eur: 0.08,
            updatedAt: '2026-08-27T15:00:46.924Z'
        })
    })

    it('keeps a single currency and nulls the other', async () => {
        stubFetch(() => ({ price: { eur: 2.5, cardmarketUpdated: '2026-08-01T00:00:00.000Z' } }))
        expect(await fetchCardPrice('swsh7_2', BASE)).toEqual({
            usd: null,
            eur: 2.5,
            updatedAt: '2026-08-01T00:00:00.000Z'
        })
    })

    it('returns null for a card nobody has priced', async () => {
        stubFetch(() => ({ price: { usd: null, eur: null } }))
        expect(await fetchCardPrice('swsh7_3', BASE)).toBeNull()
        stubFetch(() => ({ price: null }))
        expect(await fetchCardPrice('swsh7_3', BASE)).toBeNull()
    })

    it('returns null rather than throwing when the sidecar is down', async () => {
        Object.assign(globalThis, { $fetch: vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(await fetchCardPrice('swsh7_4', BASE)).toBeNull()
    })

    it('url-encodes the card id', async () => {
        const seen: string[] = []
        stubFetch((url) => {
            seen.push(url)
            return { price: { usd: 1 } }
        })
        await fetchCardPrice('sv8-5_en_074_alt', BASE)
        expect(seen[0]).toBe(`${BASE}/cards/sv8-5_en_074_alt/price`)
    })
})

describe('the price cache', () => {
    it('asks the sidecar once per card, then serves from memory', async () => {
        stubFetch(() => ({ price: { eur: 3, usd: 4 } }))
        const spy = globalThis.$fetch as unknown as ReturnType<typeof vi.fn>

        expect(await fetchCardPrice('swsh7_cached', BASE)).toMatchObject({ eur: 3 })
        expect(await fetchCardPrice('swsh7_cached', BASE)).toMatchObject({ eur: 3 })
        expect(spy).toHaveBeenCalledTimes(1)
    })

    // A null from an unreachable sidecar is cached too, but briefly — long
    // enough to stop a burst hammering it, short enough that the vendor is
    // not stuck at its 1-coin floor after the sidecar comes back.
    it('caches a miss as well, so a dead sidecar is not hammered', async () => {
        stubFetch(() => { throw new Error('sidecar down') })
        const spy = globalThis.$fetch as unknown as ReturnType<typeof vi.fn>

        expect(await fetchCardPrice('swsh7_down', BASE)).toBeNull()
        expect(await fetchCardPrice('swsh7_down', BASE)).toBeNull()
        expect(spy).toHaveBeenCalledTimes(1)
    })
})

describe('fetchCardPrices', () => {
    it('maps every id, dedupes, and degrades card by card', async () => {
        stubFetch((url: string) => {
            if (url.includes('broken')) throw new Error('nope')
            if (url.includes('unpriced')) return { price: null }
            return { price: { eur: 9.5, usd: 11 } }
        })
        const prices = await fetchCardPrices(['a', 'b', 'a', 'broken', 'unpriced'], BASE)

        expect([...prices.keys()].sort()).toEqual(['a', 'b', 'broken', 'unpriced'])
        expect(prices.get('a')).toMatchObject({ eur: 9.5 })
        expect(prices.get('broken')).toBeNull()
        expect(prices.get('unpriced')).toBeNull()
    })

    it('returns an empty map for no ids', async () => {
        stubFetch(() => ({ price: { eur: 1 } }))
        expect((await fetchCardPrices([], BASE)).size).toBe(0)
    })
})
