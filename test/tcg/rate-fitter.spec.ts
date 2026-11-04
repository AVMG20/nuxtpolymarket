import { describe, it, expect } from 'vitest'
import { validateWindow } from '../../shared/utils/tcg/sheet-math'
import { fitSet, applyGodConfig } from '../../shared/utils/tcg/rate-fitter'
import type { FitPrinting, FitSheetSpec, RateTemplate, RateTemplateTier } from '../../shared/utils/tcg/rate-fitter'

function tier(
    label: string,
    group: RateTemplateTier['group'],
    perPack: number,
    poolSize: number | null,
    pattern: RateTemplateTier['pattern'] = null,
    baseRarity: string | null = null
): RateTemplateTier {
    return { label, group, pattern, baseRarity, perPack, specificOneIn: null, poolSize }
}

function pool(prefix: string, count: number, fields: Partial<FitPrinting>): FitPrinting[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
        rarity: null,
        rarityCode: null,
        finish: 'nonholo',
        pattern: null,
        category: 'Pokemon',
        ...fields
    }))
}

// --- Prismatic Evolutions fixture (19 tiers, schema doc reference values) ---

const prismaticTemplate: RateTemplate = {
    code: 'sv8pt5',
    slug: 'prismatic-evolutions',
    name: 'Prismatic Evolutions',
    url: 'https://example.test/prismatic-evolutions',
    scrapedAt: '2026-08-01T00:00:00Z',
    cardsPerPack: 11,
    packsPerBox: 36,
    tiers: [
        tier('Common', 'guaranteed', 4, 46),
        tier('Uncommon', 'guaranteed', 3, 33),
        tier('Rare', 'hit', 1 / 1.3, 21),
        tier('Double Rare', 'hit', 1 / 6.1, 25),
        tier('Ultra Rare', 'hit', 1 / 13.4, 12),
        tier('ACE SPEC Rare', 'hit', 1 / 21.4, 6),
        tier('Special Illustration Rare', 'hit', 1 / 45, 32),
        tier('Hyper Rare', 'hit', 1 / 178.6, 5),
        tier('Reverse Common', 'reverse', 1 / 1.4, 46, 'reverse', 'Common'),
        tier('Reverse Uncommon', 'reverse', 1 / 2.0, 33, 'reverse', 'Uncommon'),
        tier('Reverse Rare', 'reverse', 1 / 3.1, 21, 'reverse', 'Rare'),
        tier('Poké Ball Common', 'reverse', 1 / 4.8, 46, 'pokeball', 'Common'),
        tier('Poké Ball Uncommon', 'reverse', 1 / 7.2, 33, 'pokeball', 'Uncommon'),
        tier('Poké Ball Rare', 'reverse', 1 / 14.4, 21, 'pokeball', 'Rare'),
        tier('Master Ball Common', 'reverse', 1 / 41.3, 33, 'masterball', 'Common'),
        // scraped pool 21 deliberately disagrees with the 20 matched printings
        tier('Master Ball Uncommon', 'reverse', 20 / (41.3 * 33), 21, 'masterball', 'Uncommon'),
        tier('Master Ball Rare', 'reverse', 14 / (41.3 * 33), 14, 'masterball', 'Rare'),
        tier('Energy', 'energy', 1, 8),
        // unmapped label: must warn and drop, never throw
        tier('Shining Fossil Rare', 'hit', 1 / 400, 2)
    ]
}

const prismaticPrintings: FitPrinting[] = [
    ...pool('c-n', 46, { rarity: 'Common', rarityCode: 'C' }),
    ...pool('c-rev', 46, { rarity: 'Common', rarityCode: 'C', finish: 'reverse' }),
    // Poké Ball pool via Prismatic-style sidecar codes
    ...pool('c-pb', 46, { rarity: 'Common', rarityCode: 'TCGLPBC', finish: 'reverse', pattern: 'pokeball' }),
    // Master Ball pool via pattern + base rarity (the other resolver path)
    ...pool('c-mb', 33, { rarity: 'Common', rarityCode: 'C', finish: 'reverse', pattern: 'masterball' }),
    ...pool('u-n', 33, { rarity: 'Uncommon', rarityCode: 'U' }),
    ...pool('u-rev', 33, { rarity: 'Uncommon', rarityCode: 'U', finish: 'reverse' }),
    ...pool('u-pb', 33, { rarity: 'Uncommon', rarityCode: 'TCGLPBU', finish: 'reverse', pattern: 'pokeball' }),
    ...pool('u-mb', 20, { rarity: 'Uncommon', rarityCode: 'U', finish: 'reverse', pattern: 'masterball' }),
    ...pool('r-h', 21, { rarity: 'Rare', rarityCode: 'R', finish: 'holo' }),
    ...pool('r-rev', 21, { rarity: 'Rare', rarityCode: 'R', finish: 'reverse' }),
    ...pool('r-pb', 21, { rarity: 'Rare', rarityCode: 'TCGLPBR', finish: 'reverse', pattern: 'pokeball' }),
    ...pool('r-mb', 14, { rarity: 'Rare', rarityCode: 'R', finish: 'reverse', pattern: 'masterball' }),
    ...pool('dr', 25, { rarity: 'Double Rare', rarityCode: '2R', finish: 'holo' }),
    ...pool('ur', 12, { rarity: 'Ultra Rare', rarityCode: 'UR', finish: 'holo' }),
    ...pool('ace', 6, { rarity: 'ACE SPEC Rare', rarityCode: 'ACE', finish: 'holo' }),
    ...pool('sir', 32, { rarity: 'Special Illustration Rare', rarityCode: 'SIR', finish: 'holo' }),
    ...pool('hr', 5, { rarity: 'Hyper Rare', rarityCode: 'HR', finish: 'holo' }),
    ...pool('nrg', 8, { rarity: 'Common', rarityCode: 'C', category: 'Energy', name: 'Basic {G} Energy' })
]

function sheetSize(sheet: FitSheetSpec): number {
    return sheet.mults.reduce((a, [, m]) => a + m, 0)
}

function expectWindowClean(sheets: FitSheetSpec[]) {
    for (const sheet of sheets) {
        expect(sheet.layout.length, `sheet ${sheet.name} size`).toBe(sheetSize(sheet))
        const counted = new Map<string, number>()
        for (const id of sheet.layout) counted.set(id, (counted.get(id) ?? 0) + 1)
        for (const [id, m] of sheet.mults) {
            expect(counted.get(id), `sheet ${sheet.name} mult of ${id}`).toBe(m)
        }
        expect(validateWindow(sheet.layout, sheet.packSlots), `sheet ${sheet.name}`).toEqual([])
    }
}

/** Total copies of the given printing-id prefix delivered over `packs` packs. */
function supplyOf(sheets: FitSheetSpec[], packs: number, prefix: string): number {
    let total = 0
    for (const sheet of sheets) {
        const M = sheetSize(sheet)
        if (M === 0) continue
        let mults = 0
        for (const [id, m] of sheet.mults) {
            if (id.startsWith(prefix)) mults += m
        }
        total += packs * sheet.packSlots * mults / M
    }
    return total
}

// Rates themselves are tuning (see the set designer's diagnostics); what a
// test pins is the structure: every pack fills exactly, no sheet can put the
// same card in one pack twice, and god packs never change a tier's supply.
describe('fitSet — Prismatic Evolutions', () => {
    const fit = fitSet(prismaticTemplate, prismaticPrintings)

    it('fills cardsPerPack exactly with window-clean sheets', () => {
        expect(fit.slots.reduce((a, s) => a + s.count, 0)).toBe(11)
        expectWindowClean(fit.sheets)
    })

    it('warns on the unmapped tier instead of throwing', () => {
        expect(fit.warnings.some(w => w.includes('Shining Fossil Rare'))).toBe(true)
        expect(fit.diagnostics.some(d => d.label === 'Shining Fossil Rare')).toBe(false)
    })
})

describe('applyGodConfig — Prismatic Evolutions', () => {
    const N = 100_000

    it('is feasible at 1 in 800 with window-clean sheets and the SIR supply kept within 2%', () => {
        const fit = fitSet(prismaticTemplate, prismaticPrintings)
        const god = applyGodConfig(fit, prismaticTemplate, prismaticPrintings, N, 800)
        expect(god.feasible).toBe(true)
        expect(god.G).toBe(125)
        expectWindowClean(god.godSheets)
        expectWindowClean(god.adjustedSheets)
        const noGod = supplyOf(fit.sheets, N, 'sir-')
        const withGod = supplyOf(god.adjustedSheets, N - god.G, 'sir-')
            + supplyOf(god.godSheets, god.G, 'sir-')
        expect(Math.abs(withGod / noGod - 1)).toBeLessThan(0.02)
    })

    it('refuses 1 in 250 with a reason (netted SIR rate goes negative)', () => {
        const fit = fitSet(prismaticTemplate, prismaticPrintings)
        const god = applyGodConfig(fit, prismaticTemplate, prismaticPrintings, N, 250)
        expect(god.feasible).toBe(false)
        expect(god.reason).toContain('Special Illustration Rare')
        expect(god.adjustedSheets).toEqual(fit.sheets)
    })
})
