// Pure sheet math for the TCG collector sim (design doc §3.3, §8.1).
// No crypto, no server imports — safe for live client-side preview.

import type { WindowViolation, SlotRate, PopulationRow } from '#shared/types/tcg'

export interface SheetSpec {
    id: string
    k: number
    layout: string[]
}

/** Count how many times each printingId appears on the sheet. */
export function multiplicities(layout: string[]): Map<string, number> {
    const mults = new Map<string, number>()
    for (const id of layout) {
        mults.set(id, (mults.get(id) ?? 0) + 1)
    }
    return mults
}

/**
 * Window constraint (§3.3): no printing may appear twice within any circular
 * sliding window of k consecutive positions. Returns one violation per
 * position whose printing reappears within the next k-1 positions clockwise
 * (so a duplicate pair is reported once, at its earlier position, including
 * pairs that span the seam).
 */
export function validateWindow(layout: string[], k: number): WindowViolation[] {
    const M = layout.length
    if (M === 0 || k <= 1) return []
    const violations: WindowViolation[] = []
    const reach = Math.min(k - 1, M - 1)
    for (let p = 0; p < M; p++) {
        for (let d = 1; d <= reach; d++) {
            if (layout[(p + d) % M] === layout[p]) {
                violations.push({ position: p, printingId: layout[p]! })
                break
            }
        }
    }
    return violations
}

/**
 * Deterministic auto-layout: place each printing's m copies at evenly spaced
 * circular offsets round(i * size / m), largest multiplicity first (ties
 * broken by printingId), resolving collisions to the next free slot
 * clockwise. Throws if the total number of copies does not equal size.
 */
export function autoLayout(mults: [string, number][], size: number): string[] {
    const total = mults.reduce((sum, [, m]) => sum + m, 0)
    if (total !== size) {
        throw new Error(`autoLayout: total copies (${total}) must equal sheet size (${size})`)
    }
    const ordered = [...mults].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    const layout: (string | null)[] = new Array(size).fill(null)
    for (const [id, m] of ordered) {
        for (let i = 0; i < m; i++) {
            let pos = Math.round(i * size / m) % size
            while (layout[pos] !== null) {
                pos = (pos + 1) % size
            }
            layout[pos] = id
        }
    }
    return layout as string[]
}

/** Per-printing pull rates for a sheet serving k slots per pack. */
export function slotRates(layout: string[], k: number): SlotRate[] {
    const M = layout.length
    const rates: SlotRate[] = []
    if (M === 0) return rates
    for (const [printingId, m] of multiplicities(layout)) {
        const expectedPerPack = k * m / M
        rates.push({
            printingId,
            multiplicity: m,
            expectedPerPack,
            oneIn: 1 / expectedPerPack
        })
    }
    return rates
}

/**
 * Impressions required for one sheet to serve its packs (§3.3):
 * R = ceil((N - G) * k / M), plus the cut capacity that buys and the
 * leftover tokens destroyed at the end of the run.
 * For god sheets pass the god pack count as N and 0 as G.
 */
export function derivedImpressions(N: number, G: number, k: number, M: number): {
    impressions: number
    cutsCapacity: number
    leftoverTokens: number
} {
    const tokensNeeded = (N - G) * k
    const impressions = Math.ceil(tokensNeeded / M)
    return {
        impressions,
        cutsCapacity: Math.floor(M * impressions / k),
        leftoverTokens: M * impressions - tokensNeeded
    }
}

/**
 * Exact derived population per printing: sum over sheets of
 * packsServed * k * m / M — base sheets serve N - G packs, god sheets serve
 * G. Values are exact to ±1 (the partial final impression); `exactWithinOne`
 * flags that.
 */
export function populationTable(N: number, G: number, baseSheets: SheetSpec[], godSheets: SheetSpec[]): {
    rows: PopulationRow[]
    exactWithinOne: boolean
} {
    const pops = new Map<string, number>()
    const accumulate = (sheets: SheetSpec[], packsServed: number) => {
        for (const sheet of sheets) {
            const M = sheet.layout.length
            if (M === 0) continue
            for (const [printingId, m] of multiplicities(sheet.layout)) {
                pops.set(printingId, (pops.get(printingId) ?? 0) + packsServed * sheet.k * m / M)
            }
        }
    }
    accumulate(baseSheets, N - G)
    accumulate(godSheets, G)
    const rows: PopulationRow[] = []
    for (const [printingId, population] of pops) {
        rows.push({ printingId, population })
    }
    return { rows, exactWithinOne: true }
}

/**
 * God-pack feasibility: G = round(N / godOneIn). Hard errors block commit;
 * a run with G >= 1 needs a god pack template and window-clean god sheets,
 * and G can never exceed N.
 */
export function godFeasibility(N: number, godOneIn: number, hasGodTemplate: boolean, godSheetsWindowClean: boolean): {
    G: number
    errors: string[]
} {
    const G = godOneIn > 0 ? Math.round(N / godOneIn) : 0
    const errors: string[] = []
    if (G >= 1 && !hasGodTemplate) {
        errors.push('God packs are enabled but no god pack template exists')
    }
    if (G >= 1 && !godSheetsWindowClean) {
        errors.push('God sheets have window-constraint violations')
    }
    if (G > N) {
        errors.push(`God pack count (${G}) exceeds target pack count (${N})`)
    }
    return { G, errors }
}
