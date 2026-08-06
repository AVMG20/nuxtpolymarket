import { describe, it, expect } from 'vitest'
import { validateWindow } from '../../shared/utils/tcg/sheet-math'
import { fitSet, applyGodConfig, resolveTierPrintings, isBasicEnergy } from '../../shared/utils/tcg/rate-fitter'
import type { FitPrinting, FitResult, FitSheetSpec, RateTemplate, RateTemplateTier } from '../../shared/utils/tcg/rate-fitter'

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

// --- Pitch Black fixture ---

const pitchBlackTemplate: RateTemplate = {
    code: 'me2',
    slug: 'pitch-black',
    name: 'Pitch Black',
    url: 'https://example.test/pitch-black',
    scrapedAt: '2026-08-01T00:00:00Z',
    cardsPerPack: 11,
    packsPerBox: null,
    tiers: [
        tier('Common', 'guaranteed', 4, 40),
        tier('Uncommon', 'guaranteed', 3, 30),
        tier('Rare', 'hit', 1 / 1.6, 15),
        tier('Double Rare', 'hit', 1 / 5, 10),
        tier('Illustration Rare', 'hit', 1 / 9, 11),
        tier('Ultra Rare', 'hit', 1 / 13, 18),
        tier('Special Illustration Rare', 'hit', 1 / 97, 6),
        tier('Mega Hyper Rare', 'hit', 1 / 1000, 1),
        tier('Reverse Common', 'reverse', 1 / 1.15, 40, 'reverse', 'Common'),
        tier('Reverse Uncommon', 'reverse', 1 / 1.75, 30, 'reverse', 'Uncommon'),
        tier('Reverse Rare', 'reverse', 1 / 1.8, 15, 'reverse', 'Rare'),
        tier('Energy', 'energy', 1, 6)
    ]
}

const pitchBlackPrintings: FitPrinting[] = [
    ...pool('pb-c-n', 40, { rarity: 'Common', rarityCode: 'C' }),
    ...pool('pb-c-rev', 40, { rarity: 'Common', rarityCode: 'C', finish: 'reverse' }),
    ...pool('pb-u-n', 30, { rarity: 'Uncommon', rarityCode: 'U' }),
    ...pool('pb-u-rev', 30, { rarity: 'Uncommon', rarityCode: 'U', finish: 'reverse' }),
    ...pool('pb-r-h', 15, { rarity: 'Rare', rarityCode: 'R', finish: 'holo' }),
    ...pool('pb-r-rev', 15, { rarity: 'Rare', rarityCode: 'R', finish: 'reverse' }),
    ...pool('pb-dr', 10, { rarity: 'Double Rare', rarityCode: '2R', finish: 'holo' }),
    ...pool('pb-ir', 11, { rarity: 'Illustration Rare', rarityCode: 'IR', finish: 'holo' }),
    ...pool('pb-ur', 18, { rarity: 'Ultra Rare', rarityCode: 'UR', finish: 'holo' }),
    ...pool('pb-sir', 6, { rarity: 'Special Illustration Rare', rarityCode: 'SIR', finish: 'holo' }),
    ...pool('pb-mhr', 1, { rarity: 'Mega Hyper Rare', rarityCode: 'MHR', finish: 'holo' }),
    ...pool('pb-nrg', 6, { rarity: 'Common', rarityCode: 'C', category: 'Energy', name: 'Basic {G} Energy' })
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

describe('fitSet — Prismatic Evolutions', () => {
    const fit = fitSet(prismaticTemplate, prismaticPrintings)

    it('builds the slot-true structure with slots summing to cardsPerPack', () => {
        expect(fit.sheets.map(s => s.name)).toEqual(['energy', 'common', 'uncommon', 'reverse', 'chase'])
        expect(fit.slots.reduce((a, s) => a + s.count, 0)).toBe(11)
        expect(fit.slots).toEqual([
            { sheetName: 'energy', count: 1 },
            { sheetName: 'common', count: 4 },
            { sheetName: 'uncommon', count: 3 },
            { sheetName: 'reverse', count: 2 },
            { sheetName: 'chase', count: 1 }
        ])
    })

    it('warns on the unmapped tier and the pool mismatch instead of throwing', () => {
        expect(fit.warnings.some(w => w.includes('Shining Fossil Rare'))).toBe(true)
        const mismatch = fit.warnings.find(w => w.includes('Master Ball Uncommon'))
        expect(mismatch).toContain('21')
        expect(mismatch).toContain('20')
        expect(fit.diagnostics.some(d => d.label === 'Shining Fossil Rare')).toBe(false)
    })

    it('every sheet passes the window constraint', () => {
        expectWindowClean(fit.sheets)
    })

    it('every tier lands within 8% of its published rate', () => {
        expect(fit.diagnostics.length).toBe(18)
        for (const d of fit.diagnostics) {
            expect(Math.abs(d.deltaPct), d.label).toBeLessThan(8)
        }
    })

    it('is deterministic', () => {
        expect(fitSet(prismaticTemplate, prismaticPrintings)).toEqual(fit)
    })
})

describe('fitSet — Pitch Black', () => {
    const fit = fitSet(pitchBlackTemplate, pitchBlackPrintings)

    it('slots sum to cardsPerPack', () => {
        expect(fit.slots.reduce((a, s) => a + s.count, 0)).toBe(11)
    })

    it('every sheet passes the window constraint', () => {
        expectWindowClean(fit.sheets)
    })

    it('tiers land within 8% (15% for the pool-1 Mega Hyper Rare)', () => {
        for (const d of fit.diagnostics) {
            const limit = d.label === 'Mega Hyper Rare' ? 15 : 8
            expect(Math.abs(d.deltaPct), d.label).toBeLessThan(limit)
        }
    })

    it('is deterministic', () => {
        expect(fitSet(pitchBlackTemplate, pitchBlackPrintings)).toEqual(fit)
    })
})

describe('applyGodConfig — Prismatic Evolutions', () => {
    const N = 100_000
    let fit: FitResult

    it('is feasible at 1 in 800 with a SIR-heavy fallback recipe', () => {
        fit = fitSet(prismaticTemplate, prismaticPrintings)
        const god = applyGodConfig(fit, prismaticTemplate, prismaticPrintings, N, 800)
        expect(god.feasible).toBe(true)
        expect(god.G).toBe(125)
        // no Illustration Rare pool -> 9x SIR + 1x HR, plus the energy slot
        expect(god.godSlots).toEqual([
            { sheetName: 'energy', count: 1 },
            { sheetName: 'god-special-illustration-rare', count: 9 },
            { sheetName: 'god-hyper-rare', count: 1 }
        ])
        expectWindowClean(god.godSheets)
        expectWindowClean(god.adjustedSheets)
    })

    it('keeps total SIR supply within 2% of the no-god supply over a 100k run', () => {
        fit = fitSet(prismaticTemplate, prismaticPrintings)
        const god = applyGodConfig(fit, prismaticTemplate, prismaticPrintings, N, 800)
        expect(god.feasible).toBe(true)
        const noGod = supplyOf(fit.sheets, N, 'sir-')
        const withGod = supplyOf(god.adjustedSheets, N - god.G, 'sir-')
            + supplyOf(god.godSheets, god.G, 'sir-')
        expect(Math.abs(withGod / noGod - 1)).toBeLessThan(0.02)
    })

    it('refuses 1 in 250 with a reason (netted SIR rate goes negative)', () => {
        fit = fitSet(prismaticTemplate, prismaticPrintings)
        const god = applyGodConfig(fit, prismaticTemplate, prismaticPrintings, N, 250)
        expect(god.feasible).toBe(false)
        expect(god.reason).toContain('Special Illustration Rare')
        expect(god.adjustedSheets).toEqual(fit.sheets)
    })

    // §3.8 supply invariant: the recipe tier's total supply over the run must
    // stay within 2% of the no-god supply at every god rate.
    it.each([500, 800, 2000])('keeps recipe-tier supply within 2% at 1 in %i', (oneIn) => {
        const base = fitSet(prismaticTemplate, prismaticPrintings)
        const god = applyGodConfig(base, prismaticTemplate, prismaticPrintings, N, oneIn)
        expect(god.feasible).toBe(true)
        const noGod = supplyOf(base.sheets, N, 'sir-')
        const withGod = supplyOf(god.adjustedSheets, N - god.G, 'sir-')
            + supplyOf(god.godSheets, god.G, 'sir-')
        expect(Math.abs(withGod / noGod - 1), `sir at 1 in ${oneIn}`).toBeLessThan(0.02)
    })
})

// --- Era vocabulary resolution (verified against the live sidecar:
// swsh7/sm11/xy9/bw10 use codes H, RR, RU, V, VM, SR; sv uses UR etc.) ---

function miniTemplate(code: string, tiers: RateTemplateTier[]): RateTemplate {
    return {
        code,
        slug: code,
        name: code,
        url: `https://example.test/${code}`,
        scrapedAt: '2026-08-01T00:00:00Z',
        cardsPerPack: 10,
        packsPerBox: null,
        tiers
    }
}

describe('resolveTierPrintings — era vocabularies', () => {
    it('resolves SV-era labels via UR-style codes', () => {
        const template = miniTemplate('sv-era', [
            tier('Ultra Rare', 'hit', 1 / 13, 3),
            tier('Double Rare', 'hit', 1 / 6, 3),
            tier('Illustration Rare', 'hit', 1 / 9, 3)
        ])
        const printings = [
            ...pool('sv-ur', 3, { rarity: 'UR', rarityCode: 'UR', finish: 'holo' }),
            ...pool('sv-dr', 3, { rarity: '2R', rarityCode: '2R', finish: 'holo' }),
            ...pool('sv-ir', 3, { rarity: 'IR', rarityCode: 'IR', finish: 'holo' })
        ]
        const { matched, warnings } = resolveTierPrintings(template, printings)
        expect(warnings).toEqual([])
        expect(matched.map(m => [m.tier.label, m.printings.length])).toEqual([
            ['Ultra Rare', 3],
            ['Double Rare', 3],
            ['Illustration Rare', 3]
        ])
    })

    it('resolves SWSH-era labels: Ultra Rare->RU, Rare Holo VMAX, Rare Holo V, Rare Holo->H, Rainbow Rare, and Secret Rare by direct name', () => {
        const template = miniTemplate('swsh-era', [
            tier('Rare Holo', 'hit', 1 / 3, 4),
            tier('Rare Holo V', 'hit', 1 / 8, 3),
            tier('Rare Holo VMAX', 'hit', 1 / 20, 2),
            tier('Ultra Rare', 'hit', 1 / 30, 2),
            tier('Rainbow Rare', 'hit', 1 / 100, 2),
            tier('Secret Rare', 'hit', 1 / 150, 2)
        ])
        const printings = [
            ...pool('sw-h', 4, { rarity: 'H', rarityCode: 'H', finish: 'holo' }),
            ...pool('sw-v', 3, { rarity: 'V', rarityCode: 'V', finish: 'holo' }),
            ...pool('sw-vm', 2, { rarity: 'VM', rarityCode: 'VM', finish: 'holo' }),
            ...pool('sw-ru', 2, { rarity: 'RU', rarityCode: 'RU', finish: 'holo' }),
            ...pool('sw-rr', 2, { rarity: 'RR', rarityCode: 'RR', finish: 'holo' }),
            // direct rarity-name match: no code needed
            ...pool('sw-sr', 2, { rarity: 'Secret Rare', rarityCode: null, finish: 'holo' })
        ]
        const { matched, warnings } = resolveTierPrintings(template, printings)
        expect(warnings).toEqual([])
        expect(matched.map(m => [m.tier.label, m.printings.length])).toEqual([
            ['Rare Holo', 4],
            ['Rare Holo V', 3],
            ['Rare Holo VMAX', 2],
            ['Ultra Rare', 2],
            ['Rainbow Rare', 2],
            ['Secret Rare', 2]
        ])
    })

    it('accepts Rare Holo as a reverse baseRarity alias', () => {
        const template = miniTemplate('swsh-rev', [
            tier('Reverse Holo Rare', 'reverse', 1 / 6, 3, 'reverse', 'Rare Holo')
        ])
        const printings = pool('sw-h-rev', 3, { rarity: 'H', rarityCode: 'H', finish: 'reverse' })
        const { matched, warnings } = resolveTierPrintings(template, printings)
        expect(warnings).toEqual([])
        expect(matched[0]?.printings.length).toBe(3)
    })

    it('resolves Reverse Energy rows to energy-category reverse printings', () => {
        const template = miniTemplate('rev-nrg', [
            tier('Reverse Energy', 'reverse', 1 / 12, 4, 'reverse', 'Energy')
        ])
        const printings = [
            ...pool('nrg-rev', 4, { rarity: 'Common', rarityCode: 'C', category: 'Energy', finish: 'reverse' }),
            // non-energy reverses must NOT leak into the pool
            ...pool('c-rev', 5, { rarity: 'Common', rarityCode: 'C', finish: 'reverse' })
        ]
        const { matched, warnings } = resolveTierPrintings(template, printings)
        expect(warnings).toEqual([])
        expect(matched[0]?.printings.map(p => p.id.startsWith('nrg-rev'))).toEqual([true, true, true, true])
    })

    it('still drops a tier with a warning when nothing matches', () => {
        const template = miniTemplate('empty', [
            tier('Shining Fossil Rare', 'hit', 1 / 400, 2)
        ])
        const { matched, warnings } = resolveTierPrintings(template, pool('c', 3, { rarity: 'Common', rarityCode: 'C' }))
        expect(matched).toEqual([])
        expect(warnings.some(w => w.includes('Shining Fossil Rare'))).toBe(true)
    })
})

// --- Basic vs special energies (verified against the live sidecar: basics
// carry TCGL*BE rarity codes and 'Basic {G} Energy' names; special energies
// carry ordinary rarities like Uncommon / ACE SPEC Rare) ---

describe('isBasicEnergy', () => {
    function printing(fields: Partial<FitPrinting>): FitPrinting {
        return { id: 'x', rarity: null, rarityCode: null, finish: 'nonholo', pattern: null, category: 'Energy', ...fields }
    }

    it('recognises the TCGL*BE rarity code family', () => {
        expect(isBasicEnergy(printing({ rarityCode: 'TCGLBE' }))).toBe(true)
        expect(isBasicEnergy(printing({ rarityCode: 'TCGLFBE' }))).toBe(true)
        expect(isBasicEnergy(printing({ rarityCode: 'TCGLHRBE' }))).toBe(true)
    })

    it('recognises a Basic-prefixed name without any rarity code', () => {
        expect(isBasicEnergy(printing({ name: 'Basic {G} Energy' }))).toBe(true)
    })

    it('rejects special energies carrying ordinary rarities', () => {
        expect(isBasicEnergy(printing({ name: 'Double Colorless Energy', rarity: 'Uncommon', rarityCode: 'U' }))).toBe(false)
    })
})

// --- Older-era reclassification (fixtures shaped like the VERIFIED live
// sidecar tables: bw1, xy12, cel25 (swsh7-5); modern sv8pt5/me5 covered by
// the Prismatic / Pitch Black fixtures above) ---

function eraTemplate(code: string, cardsPerPack: number, tiers: RateTemplateTier[]): RateTemplate {
    return {
        code,
        slug: code,
        name: code,
        url: `https://example.test/${code}`,
        scrapedAt: '2026-08-03T00:00:00Z',
        cardsPerPack,
        packsPerBox: null,
        tiers
    }
}

describe('fitSet — Black & White (bw1, fractional Common + shared energy slot)', () => {
    const template = eraTemplate('bw1', 10, [
        tier('Secret Rare', 'hit', 0.013889, 1),
        tier('Ultra Rare', 'hit', 0.055556, 2),
        tier('Rare Holo', 'hit', 0.263158, 12),
        tier('Rare', 'hit', 0.666667, 19),
        tier('Uncommon', 'guaranteed', 3.0, 37),
        tier('Common', 'hit', 4.7, 36),
        tier('Energy', 'energy', 0.333333, 8),
        tier('Reverse Rare Holo', 'reverse', 0.107527, 12, 'reverse', 'Rare Holo'),
        tier('Reverse Rare', 'reverse', 0.169492, 19, 'reverse', 'Rare'),
        tier('Reverse Uncommon', 'reverse', 0.333333, 37, 'reverse', 'Uncommon'),
        tier('Reverse Common', 'reverse', 0.322581, 36, 'reverse', 'Common'),
        tier('Reverse Energy', 'reverse', 0.071429, 8, 'reverse', 'Energy')
    ])
    const printings: FitPrinting[] = [
        ...pool('bw-sr', 1, { rarity: 'Secret Rare', finish: 'holo' }),
        ...pool('bw-ur', 2, { rarity: 'Ultra Rare', rarityCode: 'RU', finish: 'holo' }),
        ...pool('bw-rh', 12, { rarity: 'Rare Holo', rarityCode: 'H', finish: 'holo' }),
        ...pool('bw-r', 19, { rarity: 'Rare', rarityCode: 'R' }),
        ...pool('bw-u', 37, { rarity: 'Uncommon', rarityCode: 'U' }),
        ...pool('bw-c', 36, { rarity: 'Common', rarityCode: 'C' }),
        ...pool('bw-nrg', 8, { category: 'Energy', name: 'Basic {G} Energy' }),
        ...pool('bw-rh-rev', 12, { rarity: 'Rare Holo', rarityCode: 'H', finish: 'reverse' }),
        ...pool('bw-r-rev', 19, { rarity: 'Rare', rarityCode: 'R', finish: 'reverse' }),
        ...pool('bw-u-rev', 37, { rarity: 'Uncommon', rarityCode: 'U', finish: 'reverse' }),
        ...pool('bw-c-rev', 36, { rarity: 'Common', rarityCode: 'C', finish: 'reverse' }),
        ...pool('bw-nrg-rev', 8, { category: 'Energy', finish: 'reverse' })
    ]
    const fit = fitSet(template, printings)

    it('reclassifies Common 4.7 as guaranteed and orders slots physically', () => {
        expect(fit.sheets.map(s => s.name)).toEqual(['common', 'uncommon', 'reverse', 'chase'])
        expect(fit.slots).toEqual([
            { sheetName: 'common', count: 5 },
            { sheetName: 'uncommon', count: 3 },
            { sheetName: 'reverse', count: 1 },
            { sheetName: 'chase', count: 1 }
        ])
        expect(fit.slots.reduce((a, s) => a + s.count, 0)).toBe(10)
    })

    it('folds fractional energy into the chase pool with no energy sheet', () => {
        const chase = fit.sheets.find(s => s.name === 'chase')!
        expect(fit.sheets.some(s => s.name === 'energy')).toBe(false)
        expect(chase.packSlots).toBe(1)
        expect(chase.mults.some(([id]) => id.startsWith('bw-nrg-'))).toBe(true)
        expect(chase.mults.some(([id]) => id.startsWith('bw-r-'))).toBe(true)
    })

    it('does not warn about the slot total (5+3+1+1 = 10 = cardsPerPack)', () => {
        expect(fit.warnings.some(w => w.includes('cardsPerPack'))).toBe(false)
    })

    it('every sheet passes the window constraint', () => {
        expectWindowClean(fit.sheets)
    })
})

describe('fitSet — Evolutions (xy12, everything scraped as hit)', () => {
    const template = eraTemplate('xy12', 10, [
        tier('Secret Rare', 'hit', 0.123457, 5),
        tier('Ultra Rare', 'hit', 0.066667, 9),
        tier('Rare BREAK', 'hit', 0.055556, 4),
        tier('Rare Holo EX', 'hit', 0.121951, 12),
        tier('Rare Holo', 'hit', 0.144928, 13),
        tier('Rare', 'hit', 0.666667, 9),
        tier('Uncommon', 'hit', 2.9, 28),
        tier('Common', 'hit', 4.6, 24),
        tier('Energy', 'energy', 0.37037, 9),
        tier('Reverse Rare Holo', 'reverse', 0.10101, 13, 'reverse', 'Rare Holo'),
        tier('Reverse Rare', 'reverse', 0.070423, 9, 'reverse', 'Rare'),
        tier('Reverse Uncommon', 'reverse', 0.322581, 28, 'reverse', 'Uncommon'),
        tier('Reverse Common', 'reverse', 0.37037, 24, 'reverse', 'Common'),
        tier('Reverse Energy', 'reverse', 0.070423, 9, 'reverse', 'Energy')
    ])
    const printings: FitPrinting[] = [
        ...pool('xy-sr', 5, { rarity: 'Secret Rare', finish: 'holo' }),
        ...pool('xy-ur', 9, { rarity: 'Ultra Rare', rarityCode: 'RU', finish: 'holo' }),
        ...pool('xy-brk', 4, { rarity: 'Rare BREAK', finish: 'holo' }),
        ...pool('xy-ex', 12, { rarity: 'Rare Holo EX', finish: 'holo' }),
        ...pool('xy-rh', 13, { rarity: 'Rare Holo', rarityCode: 'H', finish: 'holo' }),
        ...pool('xy-r', 9, { rarity: 'Rare', rarityCode: 'R' }),
        ...pool('xy-u', 28, { rarity: 'Uncommon', rarityCode: 'U' }),
        ...pool('xy-c', 24, { rarity: 'Common', rarityCode: 'C' }),
        ...pool('xy-nrg', 9, { category: 'Energy', name: 'Basic {G} Energy' }),
        ...pool('xy-rh-rev', 13, { rarity: 'Rare Holo', rarityCode: 'H', finish: 'reverse' }),
        ...pool('xy-r-rev', 9, { rarity: 'Rare', rarityCode: 'R', finish: 'reverse' }),
        ...pool('xy-u-rev', 28, { rarity: 'Uncommon', rarityCode: 'U', finish: 'reverse' }),
        ...pool('xy-c-rev', 24, { rarity: 'Common', rarityCode: 'C', finish: 'reverse' }),
        ...pool('xy-nrg-rev', 9, { category: 'Energy', finish: 'reverse' })
    ]
    const fit = fitSet(template, printings)

    it('splits fractional Common/Uncommon out into guaranteed tiers', () => {
        expect(fit.sheets.map(s => s.name)).toEqual(['common', 'uncommon', 'reverse', 'chase'])
        expect(fit.slots).toEqual([
            { sheetName: 'common', count: 5 },
            { sheetName: 'uncommon', count: 3 },
            { sheetName: 'reverse', count: 1 },
            { sheetName: 'chase', count: 1 }
        ])
        expect(fit.slots.reduce((a, s) => a + s.count, 0)).toBe(10)
    })

    it('folds the 0.37/pack energy into the chase pool', () => {
        const chase = fit.sheets.find(s => s.name === 'chase')!
        expect(fit.sheets.some(s => s.name === 'energy')).toBe(false)
        expect(chase.mults.some(([id]) => id.startsWith('xy-nrg-'))).toBe(true)
    })

    it('every sheet passes the window constraint', () => {
        expectWindowClean(fit.sheets)
    })
})

describe('fitSet — Celebrations (cel25, 4-card packs, no reverse or energy rows)', () => {
    const template = eraTemplate('cel25', 4, [
        tier('Secret Rare', 'hit', 0.006667, 1),
        tier('Ultra Rare', 'hit', 0.04, 1),
        tier('Rare Holo VMAX', 'hit', 0.076923, 2),
        tier('Rare Holo V', 'hit', 0.357143, 5),
        tier('Classic Collection', 'hit', 0.4, 25),
        tier('Rare Holo', 'hit', 3.1, 16)
    ])
    const printings: FitPrinting[] = [
        ...pool('cel-sr', 1, { rarity: 'Secret Rare', finish: 'holo' }),
        ...pool('cel-ur', 1, { rarity: 'Ultra Rare', rarityCode: 'RU', finish: 'holo' }),
        ...pool('cel-vm', 2, { rarity: 'Rare Holo VMAX', rarityCode: 'VM', finish: 'holo' }),
        ...pool('cel-v', 5, { rarity: 'Rare Holo V', rarityCode: 'V', finish: 'holo' }),
        ...pool('cel-cc', 25, { rarity: 'Classic Collection', finish: 'holo' }),
        ...pool('cel-rh', 16, { rarity: 'Rare Holo', rarityCode: 'H', finish: 'holo' })
    ]
    const fit = fitSet(template, printings)

    it('turns Rare Holo 3.1 into 3 guaranteed slots plus 1 chase slot', () => {
        expect(fit.sheets.map(s => s.name)).toEqual(['rare-holo', 'chase'])
        expect(fit.slots).toEqual([
            { sheetName: 'rare-holo', count: 3 },
            { sheetName: 'chase', count: 1 }
        ])
        expect(fit.slots.reduce((a, s) => a + s.count, 0)).toBe(4)
    })

    it('every sheet passes the window constraint', () => {
        expectWindowClean(fit.sheets)
    })
})

describe('fitSet — guaranteed threshold and sanity warning', () => {
    it('keeps perPack 1.4 as a hit row but promotes 1.5 to guaranteed', () => {
        const template = eraTemplate('thresh', 4, [
            tier('Alpha Rare', 'hit', 1.5, 6),
            tier('Beta Rare', 'hit', 1.4, 6)
        ])
        const printings = [
            ...pool('al', 6, { rarity: 'Alpha Rare', finish: 'holo' }),
            ...pool('be', 6, { rarity: 'Beta Rare', finish: 'holo' })
        ]
        const fit = fitSet(template, printings)
        expect(fit.sheets.map(s => s.name)).toEqual(['alpha-rare', 'chase'])
        expect(fit.slots).toEqual([
            { sheetName: 'alpha-rare', count: 2 },
            { sheetName: 'chase', count: 1 }
        ])
    })

    it('warns (never blocks) when the slot total misses cardsPerPack', () => {
        const template = eraTemplate('mismatch', 9, [
            tier('Alpha Rare', 'hit', 1.5, 6),
            tier('Beta Rare', 'hit', 1.4, 6)
        ])
        const printings = [
            ...pool('al', 6, { rarity: 'Alpha Rare', finish: 'holo' }),
            ...pool('be', 6, { rarity: 'Beta Rare', finish: 'holo' })
        ]
        const fit = fitSet(template, printings)
        expect(fit.sheets.length).toBe(2)
        const warning = fit.warnings.find(w => w.includes('cardsPerPack'))
        expect(warning).toContain('3')
        expect(warning).toContain('9')
    })
})

describe('resolveTierPrintings — energy tier holds basics only', () => {
    const template = miniTemplate('nrg-split', [
        tier('Energy', 'energy', 1, 8),
        tier('Uncommon', 'guaranteed', 3, 4)
    ])
    const printings = [
        ...pool('be', 8, { rarity: 'TCGLFBE', rarityCode: 'TCGLFBE', category: 'Energy', name: 'Basic {G} Energy' }),
        ...pool('u-n', 3, { rarity: 'Uncommon', rarityCode: 'U' }),
        // special energy: ordinary rarity, must NEVER land on the energy sheet
        ...pool('dce', 1, { rarity: 'Uncommon', rarityCode: 'U', finish: 'holo', category: 'Energy', name: 'Double Colorless Energy' })
    ]
    const { matched, warnings } = resolveTierPrintings(template, printings)

    it('resolves only basics into the energy pool', () => {
        expect(warnings).toEqual([])
        const energy = matched.find(m => m.tier.group === 'energy')!
        expect(energy.printings).toHaveLength(8)
        expect(energy.printings.every(p => p.id.startsWith('be-'))).toBe(true)
    })

    it('lands the special energy in its printed-rarity tier', () => {
        const uncommon = matched.find(m => m.tier.label === 'Uncommon')!
        expect(uncommon.printings).toHaveLength(4)
        expect(uncommon.printings.some(p => p.id.startsWith('dce-'))).toBe(true)
    })

    it('keeps basics out of rarity tiers even when the label matches directly', () => {
        const commonTemplate = miniTemplate('nrg-leak', [tier('Common', 'guaranteed', 4, 3)])
        const leaky = [
            ...pool('c', 3, { rarity: 'Common', rarityCode: 'C' }),
            // direct-name fallback bait: rarity label matches the tier
            ...pool('be2', 2, { rarity: 'Common', rarityCode: 'TCGLBE', category: 'Energy', name: 'Basic {W} Energy' })
        ]
        const result = resolveTierPrintings(commonTemplate, leaky)
        expect(result.matched[0]?.printings.map(p => p.id.startsWith('c-'))).toEqual([true, true, true])
    })
})
