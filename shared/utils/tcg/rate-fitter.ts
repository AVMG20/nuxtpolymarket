// Automatic sheet fitter (design doc §4 "slot-true, globally", §3.8 god
// netting; press-run-HANDOFF §5-§7). Pure shared code: converts a scraped
// rate template plus an imported checklist into slot-true sheet layouts.
//
// Published rates are a diagnostic, never a target — the fitter searches for
// integer tier totals whose derived rates land closest to the published
// table, reports the per-tier delta, and lets the admin decide.

import { autoLayout, validateWindow } from '#shared/utils/tcg/sheet-math'

export type RateTierGroup = 'hit' | 'guaranteed' | 'reverse' | 'energy'
export type RateTierPattern = 'reverse' | 'pokeball' | 'masterball'

export interface RateTemplateTier {
    label: string
    group: RateTierGroup
    pattern: RateTierPattern | null
    baseRarity: string | null
    perPack: number
    specificOneIn: number | null
    poolSize: number | null
}

export interface RateTemplate {
    code: string
    slug: string
    name: string
    url: string
    scrapedAt: string
    cardsPerPack: number | null
    packsPerBox: number | null
    tiers: RateTemplateTier[]
}

export interface FitPrinting {
    id: string
    rarity: string | null
    rarityCode: string | null
    finish: string
    pattern: string | null
    category: string | null
    /** Card name — lets the fitter recognise basic energies ('Basic {G} Energy'). */
    name?: string | null
}

export interface FitSheetSpec {
    name: string
    role: 'base' | 'god'
    packSlots: number
    mults: [string, number][]
    /** Window-clean position list confirmed by the fitter (length = sum of mults). */
    layout: string[]
}

export interface FitSlotSpec {
    sheetName: string
    count: number
}

export interface FitDiagnostic {
    label: string
    publishedPerPack: number
    authoredPerPack: number
    deltaPct: number
}

export interface FitResult {
    sheets: FitSheetSpec[]
    slots: FitSlotSpec[]
    diagnostics: FitDiagnostic[]
    warnings: string[]
}

export interface GodConfigResult {
    feasible: boolean
    reason?: string
    G: number
    godSheets: FitSheetSpec[]
    godSlots: FitSlotSpec[]
    adjustedSheets: FitSheetSpec[]
    warnings: string[]
}

export interface MatchedTier {
    tier: RateTemplateTier
    printings: FitPrinting[]
}

/**
 * Pricedex tier label -> acceptable plaatjes rarity codes (confirmed against
 * the live sidecar across eras: sv8pt5, swsh7, sm11, xy9, bw10). Values are
 * arrays because the same label maps to different codes per era — e.g.
 * 'Ultra Rare' is UR in SV/ME but RU in SWSH/SM/XY/BW. Data table so
 * unmapped labels degrade to a warning, not a throw; direct
 * `p.rarity === label` matches always work regardless of this table.
 */
export const RARITY_CODE_BY_LABEL: Record<string, string[]> = {
    'Common': ['C'],
    'Uncommon': ['U'],
    'Rare': ['R'],
    'Double Rare': ['2R'],
    'Ultra Rare': ['UR', 'RU'],
    'Illustration Rare': ['IR'],
    'Special Illustration Rare': ['SIR'],
    'Hyper Rare': ['HR'],
    'ACE SPEC Rare': ['ACE'],
    'Mega Hyper Rare': ['MHR'],
    'Mega Attack Rare': ['MAR'],
    'Holo Rare': ['H'],
    'Rare Holo': ['H'],
    'Rare Holo V': ['V'],
    'Rare Holo VMAX': ['VM'],
    'Rainbow Rare': ['RR'],
    'Secret Rare': ['SR']
}

/** Prismatic-style sidecar rarity code prefixes for pattern rows. */
const PATTERN_CODE_PREFIX: Record<string, string> = {
    pokeball: 'TCGLPB',
    masterball: 'TCGLMB'
}

function slugify(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function isEnergyPrinting(p: FitPrinting): boolean {
    return p.category === 'Energy' || (p.rarity != null && p.rarity.includes('Energy'))
}

/**
 * BASIC energies only. The sidecar marks them with TCGL*BE rarity codes
 * (TCGLBE/TCGLFBE/TCGLCBE/TCGLSRBE/TCGLHRBE) and names them 'Basic {G}
 * Energy'. Special energies (Double Colorless, Jet, ACE SPEC energies …)
 * carry ordinary rarities and never match — they belong to whatever tier
 * their printed rarity maps to.
 */
export function isBasicEnergy(p: Pick<FitPrinting, 'rarityCode' | 'name'>): boolean {
    if (p.rarityCode != null && /BE$/i.test(p.rarityCode)) return true
    return p.name != null && p.name.startsWith('Basic ')
}

function matchesRarityLabel(p: FitPrinting, label: string | null): boolean {
    if (label == null) return false
    const codes = RARITY_CODE_BY_LABEL[label]
    return p.rarity === label || (codes != null && p.rarityCode != null && codes.includes(p.rarityCode))
}

/**
 * Map each tier row to its printing pool. Resolution always runs the full
 * matcher (code-map lookup and direct rarity-name match); only an EMPTY pool
 * drops the tier with a warning. A scraped poolSize that disagrees with the
 * matched count warns and uses the matched printings as truth.
 */
export function resolveTierPrintings(template: RateTemplate, printings: FitPrinting[]): {
    matched: MatchedTier[]
    warnings: string[]
} {
    const matched: MatchedTier[] = []
    const warnings: string[] = []
    for (const tier of template.tiers) {
        let pool: FitPrinting[] | null = null
        if (tier.group === 'energy') {
            // BASIC energies only — special energies resolve to their printed
            // rarity's tier below, never to the energy sheet.
            pool = printings.filter(isBasicEnergy)
        } else if (tier.group === 'reverse') {
            const pattern = tier.pattern ?? 'reverse'
            if (pattern === 'reverse') {
                // 'Reverse Energy' rows resolve to energy-category printings;
                // every other base rarity excludes them.
                const energyBase = tier.baseRarity === 'Energy'
                pool = printings.filter(p => (energyBase ? isEnergyPrinting(p) : !isEnergyPrinting(p))
                    && p.finish === 'reverse'
                    && p.pattern == null
                    && (energyBase || matchesRarityLabel(p, tier.baseRarity)))
            } else {
                const baseCodes = tier.baseRarity != null ? RARITY_CODE_BY_LABEL[tier.baseRarity] : undefined
                const baseCode = baseCodes?.find(code => ['C', 'U', 'R'].includes(code))
                const prefix = PATTERN_CODE_PREFIX[pattern]
                const sidecarCode = prefix != null && baseCode != null
                    ? prefix + baseCode
                    : null
                pool = printings.filter(p => !isEnergyPrinting(p)
                    && ((sidecarCode != null && p.rarityCode === sidecarCode)
                        || (p.pattern === pattern && matchesRarityLabel(p, tier.baseRarity))))
            }
        } else {
            // Basic energies are excluded explicitly so 'Basic {G} Energy'
            // can never fall into a rarity tier via the direct-name fallback;
            // special energies carry ordinary rarities and resolve here.
            pool = printings.filter(p => !isBasicEnergy(p)
                && p.pattern == null
                && p.finish !== 'reverse'
                && matchesRarityLabel(p, tier.label))
        }
        if (pool.length === 0) {
            warnings.push(`No printings matched tier '${tier.label}' — tier dropped`)
            continue
        }
        if (tier.poolSize != null && tier.poolSize !== pool.length) {
            warnings.push(`Tier '${tier.label}': scraped pool size ${tier.poolSize} != matched printings ${pool.length} — using matched printings`)
        }
        matched.push({ tier, printings: pool })
    }
    return { matched, warnings }
}

/**
 * Spread a tier total across its pool as evenly as possible (press-run §8:
 * uneven multiplicity within a tier is real — some cards carry one extra
 * copy). Deterministic: cards sorted by id, the remainder goes to the first.
 */
function distributeTier(pool: FitPrinting[], total: number): [string, number][] {
    const ids = pool.map(p => p.id).sort()
    const base = Math.floor(total / ids.length)
    const extra = total % ids.length
    const out: [string, number][] = []
    for (let i = 0; i < ids.length; i++) {
        const m = base + (i < extra ? 1 : 0)
        if (m > 0) out.push([ids[i]!, m])
    }
    return out
}

interface SheetFitPlanRow {
    tier: RateTemplateTier
    printings: FitPrinting[]
}

interface SheetFit {
    mults: [string, number][]
    layout: string[]
    M: number
    tierTotals: Map<string, number>
}

function hasWindowConflict(layout: string[], k: number, pos: number, id: string, skip: number): boolean {
    const M = layout.length
    const reach = Math.min(k - 1, M - 1)
    for (let d = 1; d <= reach; d++) {
        const fwd = (pos + d) % M
        const back = (pos - d + M) % M
        if (fwd !== skip && layout[fwd] === id) return true
        if (back !== skip && layout[back] === id) return true
    }
    return false
}

/**
 * autoLayout's even spacing is not always window-clean on dense multi-tier
 * sheets (two reverse slots, dozens of near-equal multiplicities). This
 * deterministic swap-repair pass moves each violating copy to the first
 * position where the exchange creates no new conflict on either side.
 * Returns null when the layout cannot be repaired.
 */
export function repairLayout(layout: string[], k: number): string[] | null {
    const M = layout.length
    if (M === 0 || k <= 1) return [...layout]
    const out = [...layout]
    for (let pass = 0; pass < 16; pass++) {
        const violations = validateWindow(out, k)
        if (violations.length === 0) return out
        let fixed = false
        for (const violation of violations) {
            const p = violation.position
            const id = out[p]!
            if (!hasWindowConflict(out, k, p, id, p)) continue
            for (let step = 0; step < M; step++) {
                const q = (p + k + step) % M
                const other = out[q]!
                if (other === id) continue
                if (hasWindowConflict(out, k, q, id, p)) continue
                if (hasWindowConflict(out, k, p, other, q)) continue
                out[q] = id
                out[p] = other
                fixed = true
                break
            }
        }
        if (!fixed) return null
    }
    return validateWindow(out, k).length === 0 ? out : null
}

/** autoLayout, then repair if needed; null when no window-clean layout is found. */
function buildLayout(mults: [string, number][], M: number, k: number): string[] | null {
    const layout = autoLayout(mults, M)
    if (validateWindow(layout, k).length === 0) return layout
    return repairLayout(layout, k)
}

/**
 * Deterministic multiplicity search. For each integer scale S the tier total
 * is max(poolSize, round(perPack * S)) so every matched card gets at least
 * one position; M is the sum. Candidates are scored by the worst relative
 * error of the derived tier rate k*t/M against the published perPack, then
 * confirmed window-clean via autoLayout + validateWindow.
 */
function fitSheetMults(rows: SheetFitPlanRow[], k: number, maxM: number): SheetFit | null {
    interface Candidate {
        score: number
        M: number
        S: number
        totals: number[]
    }
    const pools = rows.map(r => r.printings.length)
    const rates = rows.map(r => r.tier.perPack)
    const candidates: Candidate[] = []
    const seen = new Set<string>()
    const hardCap = 2_000_000
    for (let S = 1; S <= hardCap; S++) {
        const totals = rows.map((_, i) => Math.max(pools[i]!, Math.round(rates[i]! * S)))
        const M = totals.reduce((a, b) => a + b, 0)
        if (M > maxM) break
        if (M < k) continue
        const maxMult = Math.max(...totals.map((t, i) => Math.ceil(t / pools[i]!)))
        if (maxMult > Math.floor(M / k)) continue
        const key = totals.join(',')
        if (seen.has(key)) continue
        seen.add(key)
        let score = 0
        for (let i = 0; i < rows.length; i++) {
            const authored = k * totals[i]! / M
            score = Math.max(score, Math.abs(authored - rates[i]!) / rates[i]!)
        }
        candidates.push({ score, M, S, totals })
    }
    candidates.sort((a, b) => a.score - b.score || a.M - b.M || a.S - b.S)
    for (const cand of candidates.slice(0, 200)) {
        const mults: [string, number][] = []
        rows.forEach((row, i) => {
            mults.push(...distributeTier(row.printings, cand.totals[i]!))
        })
        const layout = buildLayout(mults, cand.M, k)
        if (layout != null) {
            const tierTotals = new Map<string, number>()
            rows.forEach((row, i) => tierTotals.set(row.tier.label, cand.totals[i]!))
            return { mults, layout, M: cand.M, tierTotals }
        }
    }
    return null
}

/**
 * Fit a whole set: bucket tiers into the slot-true structure (design §4) —
 * one sheet per guaranteed tier, ONE reverse sheet carrying every reverse
 * pattern (press-run finding: one sheet, never a weighted sheet choice), ONE
 * chase sheet carrying every hit row, one energy sheet when both the tier
 * and matching printings exist — then fit integer multiplicities per sheet.
 */
export function fitSet(template: RateTemplate, printings: FitPrinting[], maxM = 4000): FitResult {
    const { matched, warnings } = resolveTierPrintings(template, printings)
    const reverse = matched.filter(m => m.tier.group === 'reverse')
    const energy = matched.filter(m => m.tier.group === 'energy')

    // Fit-time reclassification: scraped 'group' fields are input, not
    // gospel. Older-era tables publish guaranteed tiers as fractional hit
    // rows (bw1 Common 4.7, xy12 Uncommon 2.9, Celebrations Rare Holo 3.1) —
    // any hit row at >= 1.5 per pack is really a guaranteed tier. Reverse /
    // energy / pattern groups are left untouched.
    const guaranteed = matched.filter(m => m.tier.group === 'guaranteed')
    const hit: MatchedTier[] = []
    for (const row of matched.filter(m => m.tier.group === 'hit')) {
        if (row.tier.perPack >= 1.5) guaranteed.push(row)
        else hit.push(row)
    }

    // Energy folding: fractional-energy eras (bw1 0.33/pack, xy12 0.37) have
    // no dedicated energy slot — the table itself shows energy sharing the
    // hit slot (bw1: Rare 0.667 + Energy 0.333 = 1.000). When the energy sum
    // rounds to 0, fold the energy rows into the chase pool; the chase slot
    // count still comes from the NON-energy hit sum.
    const energySlots = energy.length > 0
        ? Math.round(energy.reduce((a, r) => a + r.tier.perPack, 0))
        : 0
    const chaseRows = [...hit]
    if (energy.length > 0 && energySlots === 0) chaseRows.push(...energy)

    const plans: { name: string, rows: MatchedTier[], packSlots: number }[] = []
    // Physical pack order, front to back: the energy leads (flipping past it
    // is the opening ritual), then the biggest guaranteed tiers (commons,
    // then uncommons, …), the reverses, and the hit buried at the back.
    if (energy.length > 0 && energySlots > 0) {
        plans.push({ name: 'energy', rows: energy, packSlots: energySlots })
    }
    const guaranteedPlans: typeof plans = []
    for (const row of guaranteed) {
        guaranteedPlans.push({ name: slugify(row.tier.label), rows: [row], packSlots: Math.round(row.tier.perPack) })
    }
    // Stable sort so equal counts keep table order.
    guaranteedPlans.sort((a, b) => b.packSlots - a.packSlots)
    plans.push(...guaranteedPlans)
    if (reverse.length > 0) {
        const sum = reverse.reduce((a, r) => a + r.tier.perPack, 0)
        plans.push({ name: 'reverse', rows: reverse, packSlots: Math.max(1, Math.round(sum)) })
    }
    if (chaseRows.length > 0) {
        const sum = hit.reduce((a, r) => a + r.tier.perPack, 0)
        plans.push({ name: 'chase', rows: chaseRows, packSlots: Math.max(1, Math.round(sum)) })
    }

    const sheets: FitSheetSpec[] = []
    const slots: FitSlotSpec[] = []
    const diagnostics: FitDiagnostic[] = []
    for (const plan of plans) {
        let k = plan.packSlots
        const poolTotal = plan.rows.reduce((a, r) => a + r.printings.length, 0)
        if (poolTotal < k) {
            warnings.push(`Sheet '${plan.name}': pool of ${poolTotal} cannot serve ${k} slots per pack — lowering to ${poolTotal}`)
            k = poolTotal
        }
        const fit = fitSheetMults(plan.rows, k, maxM)
        if (fit == null) {
            warnings.push(`Sheet '${plan.name}': no window-feasible layout within ${maxM} positions — sheet dropped`)
            continue
        }
        sheets.push({ name: plan.name, role: 'base', packSlots: k, mults: fit.mults, layout: fit.layout })
        slots.push({ sheetName: plan.name, count: k })
        for (const row of plan.rows) {
            const authored = k * fit.tierTotals.get(row.tier.label)! / fit.M
            diagnostics.push({
                label: row.tier.label,
                publishedPerPack: row.tier.perPack,
                authoredPerPack: authored,
                deltaPct: (authored / row.tier.perPack - 1) * 100
            })
        }
    }
    if (template.cardsPerPack != null) {
        const slotTotal = slots.reduce((a, s) => a + s.count, 0)
        if (slotTotal !== template.cardsPerPack) {
            warnings.push(`Slot total ${slotTotal} does not match cardsPerPack ${template.cardsPerPack}`)
        }
    }
    return { sheets, slots, diagnostics, warnings }
}

/**
 * God pack configuration (design §3.8, press-run HANDOFF §6). G is fixed at
 * commit; god packs are a second template with their own sheets, and their
 * tier supply is netted OUT of the chase sheet so total supply is invariant
 * to the god rate.
 *
 * Recipe heuristic: prefer the documented Black Bolt / White Flare shape —
 * (recipeSize - 1) Illustration Rares plus one Special Illustration Rare —
 * when both pools exist. Otherwise take the two rarest hit tiers and weight
 * the recipe toward the less rare of the two ((recipeSize - 1) of it plus
 * one of the rarest), which reproduces Prismatic's SIR-heavy confirmed
 * recipe. recipeSize = cardsPerPack minus the energy slot; the god pack
 * still draws the energy slot so pack size stays constant.
 */
export function applyGodConfig(
    fit: FitResult,
    template: RateTemplate,
    printings: FitPrinting[],
    N: number,
    godOneIn: number
): GodConfigResult {
    const warnings: string[] = []
    const infeasible = (reason: string, G: number): GodConfigResult =>
        ({ feasible: false, reason, G, godSheets: [], godSlots: [], adjustedSheets: fit.sheets, warnings })

    const G = godOneIn > 0 ? Math.round(N / godOneIn) : 0
    if (G <= 0) {
        return { feasible: true, G: 0, godSheets: [], godSlots: [], adjustedSheets: fit.sheets, warnings }
    }
    if (G >= N) return infeasible(`God pack count (${G}) is not below the run size (${N})`, G)

    const { matched, warnings: resolveWarnings } = resolveTierPrintings(template, printings)
    warnings.push(...resolveWarnings)
    const hit = matched.filter(m => m.tier.group === 'hit')
    const chase = fit.sheets.find(s => s.name === 'chase')
    if (chase == null || hit.length === 0) return infeasible('No chase sheet to net god packs against', G)

    const energyCount = fit.slots.find(s => s.sheetName === 'energy')?.count ?? 0
    const packSize = template.cardsPerPack ?? fit.slots.reduce((a, s) => a + s.count, 0)
    const recipeSize = packSize - energyCount
    if (recipeSize < 2) return infeasible('Pack too small for a god pack recipe', G)

    const byLabel = new Map(hit.map(m => [m.tier.label, m]))
    const ir = byLabel.get('Illustration Rare')
    const sir = byLabel.get('Special Illustration Rare')
    let recipe: { row: MatchedTier, count: number }[]
    if (ir != null && sir != null) {
        recipe = [{ row: ir, count: recipeSize - 1 }, { row: sir, count: 1 }]
    } else {
        const rarest = [...hit].sort((a, b) => a.tier.perPack - b.tier.perPack || (a.tier.label < b.tier.label ? -1 : 1))
        if (rarest.length < 2) return infeasible('Not enough hit tiers to derive a god pack recipe', G)
        recipe = [{ row: rarest[1]!, count: recipeSize - 1 }, { row: rarest[0]!, count: 1 }]
    }

    const godSheets: FitSheetSpec[] = []
    const godSlots: FitSlotSpec[] = []
    for (const { row, count } of recipe) {
        if (row.printings.length < count) {
            return infeasible(`God recipe needs ${count} distinct '${row.tier.label}' per pack but the pool holds ${row.printings.length}`, G)
        }
        const name = `god-${slugify(row.tier.label)}`
        const mults = row.printings.map(p => [p.id, 1] as [string, number]).sort((a, b) => a[0] < b[0] ? -1 : 1)
        const layout = buildLayout(mults, mults.length, count)
        if (layout == null) {
            return infeasible(`No window-clean layout for god sheet '${name}'`, G)
        }
        godSheets.push({ name, role: 'god', packSlots: count, mults, layout })
        godSlots.push({ sheetName: name, count })
    }
    // Energy leads a god pack too, matching the base template's front-of-pack
    // order.
    if (energyCount > 0) godSlots.unshift({ sheetName: 'energy', count: energyCount })

    // Netting (HANDOFF §6): total supply of each recipe tier must not change.
    // r0 is the AUTHORED chase rate (the actual supply), not the published one.
    const k = chase.packSlots
    const M = chase.mults.reduce((a, [, m]) => a + m, 0)
    const multById = new Map(chase.mults)
    const tierTotal = (row: MatchedTier) => row.printings.reduce((a, p) => a + (multById.get(p.id) ?? 0), 0)
    const netted = recipe.map(({ row, count }) => {
        const t = tierTotal(row)
        const r0 = k * t / M
        const rNet = (N * r0 - G * count) / (N - G)
        return { row, count, t, rNet }
    })
    for (const nt of netted) {
        if (nt.rNet < 0) {
            return infeasible(`God rate 1 in ${godOneIn} needs ${G * nt.count} '${nt.row.tier.label}' but the whole run only supplies ${Math.round(N * k * nt.t / M)} — netted chase rate goes negative`, G)
        }
    }

    // Netted tier total at sheet scale f. Every netted tier is a recipe tier
    // and therefore god-supplied, so over-supply is the worse §3.8 error:
    // prefer floor, taking ceil only when it is strictly closer to the exact
    // netted target.
    const nettedTotal = (scale: number, rNet: number): number => {
        if (rNet === 0) return 0
        const exact = scale * M * rNet / k
        const lo = Math.floor(exact)
        const hi = Math.ceil(exact)
        return hi - exact < exact - lo ? hi : lo
    }

    // Integer scale factor so every card in a reduced tier keeps >= 1 copy.
    const maxScale = 64
    let f = 1
    for (; f <= maxScale; f++) {
        if (netted.every(nt => nt.rNet === 0 || nettedTotal(f, nt.rNet) >= nt.row.printings.length)) break
    }
    if (f > maxScale) return infeasible('Netted chase rate too small to give every card a position at any reasonable sheet scale', G)

    const newTotals = new Map<string, number>()
    let freed = 0
    for (const nt of netted) {
        const t2 = nettedTotal(f, nt.rNet)
        newTotals.set(nt.row.tier.label, t2)
        freed += f * nt.t - t2
    }

    // Freed multiplicity goes to the filler tier: the least rare hit tier
    // OUTSIDE the recipe (Rare in practice). Folding it back into a recipe
    // tier would inflate that tier's total supply (§3.8), so when every hit
    // tier is in the recipe we leave the chase sheet smaller instead — that
    // nudges the remaining tiers' rates up slightly but keeps the recipe
    // tiers' supply invariant, which is the invariant that matters.
    const recipeLabels = new Set(recipe.map(r => r.row.tier.label))
    const fillers = hit.filter(m => !recipeLabels.has(m.tier.label))
        .sort((a, b) => b.tier.perPack - a.tier.perPack || (a.tier.label < b.tier.label ? -1 : 1))
    const filler = fillers[0] ?? null

    const newMults: [string, number][] = []
    for (const row of hit) {
        let total = newTotals.has(row.tier.label)
            ? newTotals.get(row.tier.label)!
            : f * tierTotal(row)
        if (filler != null && row.tier.label === filler.tier.label) total += freed
        if (total > 0) newMults.push(...distributeTier(row.printings, total))
    }
    const newM = newMults.reduce((a, [, m]) => a + m, 0)
    const newLayout = buildLayout(newMults, newM, k)
    if (newLayout == null) {
        return infeasible('No window-clean layout for the netted chase sheet', G)
    }
    const adjustedSheets = fit.sheets.map(s => s.name === 'chase'
        ? { ...s, mults: newMults, layout: newLayout }
        : s)

    return { feasible: true, G, godSheets, godSlots, adjustedSheets, warnings }
}
