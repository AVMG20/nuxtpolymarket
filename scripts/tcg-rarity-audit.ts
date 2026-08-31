// Does every published rarity actually get printed?
//
// A published tier that matches no printing is dropped by the fitter with a
// warning, and the run then prints WITHOUT that rarity — Black Bolt shipped a
// draft where 'Black White Rare' (sidecar code BWR) never appeared on a sheet,
// because the fitter's era table did not know the label and the sidecar hands
// most tiers their CODE as the rarity string. The matcher now falls back to the
// rarity registry, but that only helps sets fitted AFTER the fix: layouts are
// stored, so an existing set stays as it was fitted.
//
// Two checks, both re-runnable:
//   bun run scripts/tcg-rarity-audit.ts             every set in the database
//   bun run scripts/tcg-rarity-audit.ts --sidecar   + every sidecar template
//
// The database pass is the one that says which sets need repairing. The sidecar
// pass is the coverage proof: it walks every set the sidecar can build and
// reports published tiers whose rarity nothing in the checklist carries, so a
// new era's vocabulary shows up here instead of in a committed print run.
//
// Exits 1 when anything is unmatched or unprinted.

import { eq } from 'drizzle-orm'
import { db } from '../server/database/index.ts'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet } from '../server/database/schema.ts'
import { resolveTierPrintings } from '../shared/utils/tcg/rate-fitter.ts'
import type { FitPrinting, RateTemplate } from '../shared/utils/tcg/rate-fitter.ts'

const API_BASE = (process.env.NUXT_POKEMON_API_BASE ?? 'http://127.0.0.1:8080').replace(/\/+$/, '')

const RED = '\u001b[31m'
const YELLOW = '\u001b[33m'
const GREEN = '\u001b[32m'
const DIM = '\u001b[2m'
const RESET = '\u001b[0m'

interface Finding {
    set: string
    label: string
    kind: 'unmatched' | 'unprinted'
    detail: string
}

/** '1 in 496' / '3/pack' — the preview's own phrasing. */
function perPackLabel(perPack: number): string {
    if (perPack <= 0) return 'never'
    if (perPack >= 1) return `${Number(perPack.toFixed(2))}/pack`
    const oneIn = 1 / perPack
    return `1 in ${oneIn >= 100 ? Math.round(oneIn) : Number(oneIn.toFixed(1))}`
}

// ── Pass 1: the sets we actually hold ────────────────────────────────────────

async function auditDatabase(): Promise<Finding[]> {
    const sets = await db.select().from(tcgSet)
    const withRates = sets.filter(set => set.publishedRates != null)
    console.log(`\n${DIM}Database — ${withRates.length} of ${sets.length} sets were built from a rate template${RESET}\n`)

    const findings: Finding[] = []
    for (const set of withRates) {
        const template = set.publishedRates!
        const rows = await db.select({ printing: tcgPrinting, card: tcgCard })
            .from(tcgPrinting)
            .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
            .where(eq(tcgPrinting.setId, set.id))
        const printings: FitPrinting[] = rows.map(({ printing, card }) => ({
            id: printing.id,
            rarity: card.rarity,
            rarityCode: card.rarityCode,
            finish: printing.finish,
            pattern: printing.pattern,
            category: card.category,
            name: card.name
        }))
        const sheets = await db.select().from(tcgSheet).where(eq(tcgSheet.setId, set.id))

        // Authored rate per tier, exactly as the print-run preview derives it:
        // base sheets serve N−G of N packs, god sheets the remaining G.
        const N = set.targetPackCount ?? 0
        const G = set.godPackCount ?? (set.godPackOneIn ? Math.round(N / set.godPackOneIn) : 0)
        const baseWeight = N > 0 ? Math.max(N - G, 0) / N : 1
        const godWeight = N > 0 ? G / N : 0

        const { matched } = resolveTierPrintings(template, printings)
        const matchedLabels = new Set(matched.map(m => m.tier.label))
        const label = `${set.name} (${set.code}, ${set.status})`
        const setFindings: Finding[] = []

        for (const tier of template.tiers) {
            if (!matchedLabels.has(tier.label)) {
                setFindings.push({
                    set: label,
                    label: tier.label,
                    kind: 'unmatched',
                    detail: `no printing carries this rarity — published ${perPackLabel(tier.perPack)}, fitter dropped the tier`
                })
            }
        }
        for (const { tier, printings: poolPrintings } of matched) {
            const poolIds = new Set(poolPrintings.map(p => p.id))
            let authored = 0
            for (const sheet of sheets) {
                const M = sheet.layout.length
                if (M === 0) continue
                let mults = 0
                for (const id of sheet.layout) {
                    if (poolIds.has(id)) mults += 1
                }
                authored += sheet.packSlots * mults / M * (sheet.role === 'god' ? godWeight : baseWeight)
            }
            if (authored === 0) {
                setFindings.push({
                    set: label,
                    label: tier.label,
                    kind: 'unprinted',
                    detail: `${poolPrintings.length} printing(s) match but hold 0 positions on any sheet — published ${perPackLabel(tier.perPack)}, this run prints none`
                })
            }
        }

        if (setFindings.length === 0) {
            console.log(`  ${GREEN}ok${RESET}  ${label} ${DIM}— ${template.tiers.length} tiers all printed${RESET}`)
            continue
        }
        console.log(`  ${RED}✗${RESET}   ${label}`)
        for (const finding of setFindings) {
            const tag = finding.kind === 'unmatched' ? 'unmatched' : 'unprinted'
            console.log(`        ${YELLOW}${tag}${RESET} '${finding.label}' — ${finding.detail}`)
        }
        findings.push(...setFindings)
    }
    return findings
}

// ── Pass 2: every set the sidecar could build ────────────────────────────────

interface SidecarCard {
    cardId?: string | null
    name?: string | null
    rarity?: string | null
    rarityCode?: string | null
    category?: string | null
}

async function sidecarJson<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`)
    if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`)
    return await response.json() as T
}

async function fetchChecklist(setCode: string): Promise<SidecarCard[]> {
    const cards: SidecarCard[] = []
    for (let page = 1; ; page++) {
        const body = await sidecarJson<{ items: SidecarCard[], total: number, returned: number }>(
            `/cards?set=${encodeURIComponent(setCode)}&limit=500&page=${page}`
        )
        cards.push(...body.items)
        if (body.returned === 0 || cards.length >= body.total) break
    }
    return cards
}

/**
 * Rarity coverage only. Reverse and pattern tiers resolve through `finish` and
 * `pattern`, which are derived at import from render refs this pass does not
 * pull, so they are left to the database pass rather than reported as false
 * misses here.
 */
async function auditSidecar(): Promise<Finding[]> {
    const index = await sidecarJson<{ sets: { code: string, setCode: string | null, name?: string }[] }>('/pull-rates')
    const entries = index.sets.filter(entry => entry.setCode != null)
    console.log(`\n${DIM}Sidecar ${API_BASE} — sweeping ${entries.length} templates (rarity tiers only)${RESET}\n`)

    const findings: Finding[] = []
    const unusedByLabel = new Map<string, Set<string>>()
    for (const entry of entries) {
        let template: RateTemplate
        let cards: SidecarCard[]
        try {
            template = await sidecarJson<RateTemplate>(`/sets/${entry.setCode}/pull-rates`)
            cards = await fetchChecklist(entry.setCode!)
        } catch (error) {
            console.log(`  ${YELLOW}skip${RESET} ${entry.code} ${DIM}— ${(error as Error).message}${RESET}`)
            continue
        }

        // finish/pattern are deliberately neutral: every card is a plain
        // non-reverse printing so only the rarity match is under test.
        const printings: FitPrinting[] = cards.map((card, i) => ({
            id: card.cardId ?? `card-${i}`,
            rarity: card.rarity ?? null,
            rarityCode: card.rarityCode ?? null,
            finish: 'holo',
            pattern: null,
            category: card.category ?? null,
            name: card.name ?? null
        }))
        const rarityTiers = template.tiers.filter(tier => tier.group === 'hit' || tier.group === 'guaranteed')
        const { matched } = resolveTierPrintings({ ...template, tiers: rarityTiers }, printings)
        const matchedLabels = new Set(matched.map(m => m.tier.label))
        const unmatched = rarityTiers.filter(tier => !matchedLabels.has(tier.label))
        if (unmatched.length === 0) continue

        // Which rarities in the checklist no tier claimed — the codes a
        // registry patch would need.
        const claimed = new Set(matched.flatMap(m => m.printings.map(p => p.id)))
        const unused = new Set<string>()
        for (const printing of printings) {
            if (claimed.has(printing.id)) continue
            const rarity = printing.rarityCode ?? printing.rarity
            if (rarity != null) unused.add(rarity)
        }
        const setLabel = `${entry.code}${entry.name ? ` ${entry.name}` : ''}`
        console.log(`  ${RED}✗${RESET}   ${setLabel}`)
        for (const tier of unmatched) {
            console.log(`        ${YELLOW}unmatched${RESET} '${tier.label}' ${DIM}(published ${perPackLabel(tier.perPack)}, pool ${tier.poolSize ?? '?'})${RESET}`)
            findings.push({
                set: setLabel,
                label: tier.label,
                kind: 'unmatched',
                detail: `published ${perPackLabel(tier.perPack)}`
            })
            const bucket = unusedByLabel.get(tier.label) ?? new Set<string>()
            for (const rarity of unused) bucket.add(rarity)
            unusedByLabel.set(tier.label, bucket)
        }
        console.log(`        ${DIM}unclaimed rarities in this checklist: ${[...unused].sort().join(', ') || '(none)'}${RESET}`)
    }

    if (unusedByLabel.size > 0) {
        console.log(`\n${DIM}Labels to teach the rarity registry (shared/utils/tcg/rarity.ts):${RESET}`)
        for (const [label, rarities] of [...unusedByLabel].sort()) {
            console.log(`  '${label}' ${DIM}— candidate codes: ${[...rarities].sort().join(', ') || '(none)'}${RESET}`)
        }
    }
    return findings
}

const findings = await auditDatabase()
if (process.argv.includes('--sidecar')) {
    try {
        findings.push(...await auditSidecar())
    } catch (error) {
        console.log(`\n${RED}Sidecar sweep failed${RESET} — ${API_BASE}: ${(error as Error).message}`)
        console.log(`${DIM}Start the pokemonplaatjes sidecar and re-run with --sidecar.${RESET}`)
        process.exit(1)
    }
}

console.log('')
if (findings.length === 0) {
    console.log(`${GREEN}Every published rarity tier resolves and gets printed.${RESET}`)
    process.exit(0)
}
const unmatched = findings.filter(f => f.kind === 'unmatched').length
const unprinted = findings.filter(f => f.kind === 'unprinted').length
console.log(`${RED}${findings.length} finding(s)${RESET} — ${unmatched} unmatched tier(s), ${unprinted} matched but unprinted tier(s).`)
console.log(`${DIM}Unmatched: teach the rarity registry the label. Unprinted: the set was fitted before the fix —`)
console.log(`re-create the draft from its template, or reprint it if it is already committed.${RESET}`)
process.exit(1)
