/**
 * Render-ref mapping for alternate-art records, whose `bundle` field names a
 * different family than the files the sidecar actually serves. $fetch is
 * stubbed with a record shaped like the live GET /cards?set=SV3-5 response,
 * whose image paths carry the sidecar's base path.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fetchPlaatjesChecklist } from '#server/utils/tcg/import'
import type { PlaatjesCard } from '#server/utils/tcg/import'

const BASE = '/691ZIwQ4rE'

function altRecord(prefix: string): PlaatjesCard {
    return {
        cardId: 'svalt_37',
        name: 'Electabuzz',
        number: '37',
        setTotal: '165',
        assetNumber: '037',
        rarity: 'Illustration Rare',
        rarityCode: 'TCGLIR',
        category: 'Pokemon',
        bundle: 'svalt_en_037',
        foilEffect: 'Cosmos',
        foilMask: null,
        images: {
            card: `${prefix}/images/cards/sv3-5_en_125_alt.png`,
            masks: [`${prefix}/images/masks/sv3-5_wp_alt_en_125.png`]
        }
    }
}

function stubCards(items: PlaatjesCard[]) {
    const page = { total: items.length, page: 1, limit: 500, returned: items.length, items }
    Object.assign(globalThis, { $fetch: async () => page })
}

const realFetch = (globalThis as { $fetch?: unknown }).$fetch

afterEach(() => {
    Object.assign(globalThis, { $fetch: realFetch })
})

describe('alternate-art render refs', () => {
    it.each([['unprefixed', ''], ['base-path prefixed', BASE]])('derives them from the image paths (%s)', async (_label, prefix) => {
        stubCards([altRecord(prefix)])
        const { printingRows } = await fetchPlaatjesChecklist('SV3-5', 'http://stub.invalid', 'set-1')

        const printing = printingRows[0]!
        expect(printing.bundle).toBe('sv3-5_en_125_alt')
        expect(printing.assetNumber).toBe('125')
        expect(printing.maskKind).toBe('wp_alt')
    })
})
