/**
 * Unit tests for the sidecar price mapping. No DB and no network: the
 * sidecar call goes through `$fetch`, which is stubbed per case.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCardPrice } from '#server/utils/tcg/prices'

const BASE = 'http://sidecar.invalid'

function stubFetch(impl: (url: string) => unknown) {
    Object.assign(globalThis, { $fetch: vi.fn((url: string) => Promise.resolve(impl(url))) })
}

afterEach(() => {
    Reflect.deleteProperty(globalThis, '$fetch')
    vi.restoreAllMocks()
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
