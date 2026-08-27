/**
 * Legacy (pre-Black&White) checklist import + fitter behaviour. Pure of the
 * DB and the sidecar: $fetch is stubbed with records shaped exactly like the
 * live GET /cards?set=BASE1 response — cardId 'base1-1' (hyphen form),
 * bundle/foilEffect/foilMask/rarity/rarityCode/category all null,
 * assetNumber/number '1'.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fetchPlaatjesChecklist } from '#server/utils/tcg/import'
import type { PlaatjesCard } from '#server/utils/tcg/import'
import { fitSet } from '#shared/utils/tcg/rate-fitter'
import type { FitPrinting, RateTemplate } from '#shared/utils/tcg/rate-fitter'
import { legacySetOf } from '#shared/utils/tcg/legacy'

function legacyRecord(num: string, overrides: Partial<PlaatjesCard> = {}): PlaatjesCard {
    return {
        cardId: `base1-${num}`,
        name: `Legacy card ${num}`,
        number: num,
        setTotal: '102',
        assetNumber: num,
        rarity: null,
        rarityCode: null,
        category: null,
        bundle: null,
        foilEffect: null,
        foilMask: null,
        ...overrides
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

describe('legacy checklist import', () => {
    it('maps bundle-less records: bundle null, assetNumber from number, maskKind/pattern null, finish nonholo', async () => {
        stubCards([legacyRecord('1'), legacyRecord('2', { assetNumber: null })])
        const { cardRows, printingRows } = await fetchPlaatjesChecklist('BASE1', 'http://stub.invalid', 'set-1')

        expect(cardRows).toHaveLength(2)
        expect(printingRows).toHaveLength(2)

        const card = cardRows[0]!
        // The suffix-stripper only strips _ph-style suffixes — the hyphen id
        // must survive untouched as the base id.
        expect(card.plaatjesBaseId).toBe('base1-1')
        expect(card.rarity).toBeNull()
        expect(card.rarityCode).toBeNull()
        expect(card.number).toBe('1')

        const printing = printingRows[0]!
        expect(printing.plaatjesCardId).toBe('base1-1')
        expect(printing.bundle).toBeNull()
        expect(printing.assetNumber).toBe('1')
        expect(printing.maskKind).toBeNull()
        expect(printing.pattern).toBeNull()
        expect(printing.finish).toBe('nonholo')

        // assetNumber falls back to number when the sidecar sends none.
        expect(printingRows[1]!.assetNumber).toBe('2')
    })

    it('maps finish holo when a legacy rarity label contains Holo', async () => {
        stubCards([legacyRecord('2', { rarity: 'Rare Holo' }), legacyRecord('3', { rarity: 'Rare' })])
        const { printingRows } = await fetchPlaatjesChecklist('BASE1', 'http://stub.invalid', 'set-1')
        expect(printingRows.find(p => p.plaatjesCardId === 'base1-2')!.finish).toBe('holo')
        expect(printingRows.find(p => p.plaatjesCardId === 'base1-3')!.finish).toBe('nonholo')
    })
})

describe('legacySetOf', () => {
    it('takes everything up to the last hyphen', () => {
        expect(legacySetOf('base1-1')).toBe('base1')
        expect(legacySetOf('base1-102')).toBe('base1')
        expect(legacySetOf('neo4-113')).toBe('neo4')
    })

    it('returns null when no folder can be derived', () => {
        expect(legacySetOf('base1')).toBeNull()
        expect(legacySetOf('-1')).toBeNull()
    })
})

describe('fitSet on an all-null-rarity legacy pool', () => {
    const template: RateTemplate = {
        code: 'base1',
        slug: 'base-set',
        name: 'Base Set',
        url: 'https://example.test/base-set',
        scrapedAt: '2026-08-01T00:00:00Z',
        cardsPerPack: 11,
        packsPerBox: null,
        tiers: [
            { label: 'Common', group: 'guaranteed', pattern: null, baseRarity: null, perPack: 7, specificOneIn: null, poolSize: 32 },
            { label: 'Rare Holo', group: 'hit', pattern: null, baseRarity: null, perPack: 0.33, specificOneIn: null, poolSize: 16 }
        ]
    }

    it('returns zero sheets plus warnings instead of throwing', () => {
        const printings: FitPrinting[] = Array.from({ length: 20 }, (_, i) => ({
            id: `p-${i}`,
            rarity: null,
            rarityCode: null,
            finish: 'nonholo',
            pattern: null,
            category: null
        }))
        const fit = fitSet(template, printings)
        expect(fit.sheets).toHaveLength(0)
        expect(fit.slots).toHaveLength(0)
        expect(fit.warnings.length).toBeGreaterThanOrEqual(2)
        expect(fit.warnings.join(' ')).toContain('tier dropped')
    })
})
