// Sheet engine: commit, buy, open (design doc §3.3–3.8).
// Every value-granting mutation is its own guard (Appendix D) — the set
// commit, the pack-count increment, the sheet cursors and the pack open are
// all conditional UPDATE … RETURNING. No SELECT-then-UPDATE anywhere.

import { createHash, randomBytes } from 'node:crypto'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgSheet, tcgPackTemplate, tcgPack, tcgCopy, tcgCard, tcgPrinting } from '#server/database/schema'
import { deriveKey, feistelPermute } from '#server/utils/tcg/feistel'
import { loadFitContext, persistFit } from '#server/utils/tcg/import'
import { randomInt } from '#shared/utils/random'
import { mintCondition } from '#shared/utils/tcg/condition'
import { validateWindow, derivedImpressions, godFeasibility } from '#shared/utils/tcg/sheet-math'
import { applyGodConfig } from '#shared/utils/tcg/rate-fitter'
import type { FitResult, FitSheetSpec, FitSlotSpec } from '#shared/utils/tcg/rate-fitter'
import type { OpenedPackCard, OpenedPackResult, SealedPackSummary, TcgFinish } from '#shared/types/tcg'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type SetRow = typeof tcgSet.$inferSelect
type SheetRow = typeof tcgSheet.$inferSelect
type PackRow = typeof tcgPack.$inferSelect

// ─── Commitment digest ────────────────────────────────────────────────────────

/** JSON.stringify with object keys sorted recursively — canonical form. */
function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`
    }
    if (value !== null && typeof value === 'object') {
        const keys = Object.keys(value as Record<string, unknown>).sort()
        const parts = keys.map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
        return `{${parts.join(',')}}`
    }
    return JSON.stringify(value)
}

/**
 * sha256 hex over the canonical JSON of everything the run is determined by:
 * every sheet's layout and pack-slot count, N, G and the secret key (§3.4).
 * Published at commit; the key itself never is.
 */
export function commitmentDigestFor(
    set: { targetPackCount: number, godPackCount: number },
    sheets: { id: string, layout: string[], packSlots: number }[],
    secretKey: string
): string {
    const layouts: Record<string, { layout: string[], packSlots: number }> = {}
    for (const sheet of [...sheets].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        layouts[sheet.id] = { layout: sheet.layout, packSlots: sheet.packSlots }
    }
    const canonical = canonicalJson({
        layouts,
        N: set.targetPackCount,
        G: set.godPackCount,
        secretKey
    })
    return createHash('sha256').update(canonical).digest('hex')
}

// ─── Commit ───────────────────────────────────────────────────────────────────

function badRequest(message: string): never {
    throw createError({ statusCode: 400, statusMessage: message })
}

/**
 * Lock the set row FOR UPDATE inside the given transaction and return it.
 * Every draft-only mutation and the commit itself take this lock first, so
 * they serialize against each other — a draft mutation can never interleave
 * with a commit. Throws 404 when the set does not exist.
 */
export async function lockSetForUpdate(tx: Tx, setId: string): Promise<SetRow> {
    const [set] = await tx.select().from(tcgSet).where(eq(tcgSet.id, setId)).for('update')
    if (!set) throw createError({ statusCode: 404, statusMessage: 'Set not found' })
    return set
}

/**
 * Template-created god integration: when a set carries its scraped rate
 * template (publishedRates) and has a god rate, the god sheets and template
 * are DERIVED at commit time via applyGodConfig — netting the god supply out
 * of the chase sheet — instead of being authored by hand. Runs under the set
 * row lock, before the commit's own validation, which re-checks everything
 * written here. Manual sets (publishedRates null) keep the authored-god path.
 */
async function applyTemplateGod(tx: Tx, set: SetRow, N: number): Promise<void> {
    const template = set.publishedRates!
    const { printings, sheets, slots, sheetIdByName } = await loadFitContext(tx, set.id)
    const fit: FitResult = { sheets, slots, diagnostics: [], warnings: [] }
    const god = applyGodConfig(fit, template, printings, N, set.godPackOneIn!)
    if (!god.feasible) badRequest(god.reason ?? 'God pack configuration is infeasible')
    if (god.G === 0) return

    // Netting rewrites the chase sheet — persist any adjusted base layouts.
    const layoutByName = new Map(sheets.map(sheet => [sheet.name, sheet.layout]))
    for (const adjusted of god.adjustedSheets) {
        if (layoutByName.get(adjusted.name) === adjusted.layout) continue
        const sheetId = sheetIdByName.get(adjusted.name)
        if (!sheetId) badRequest(`Adjusted sheet '${adjusted.name}' does not exist in this set`)
        await tx.update(tcgSheet).set({ layout: adjusted.layout }).where(eq(tcgSheet.id, sheetId))
    }

    // Replace any stale derived god config wholesale before re-inserting.
    await tx.delete(tcgSheet).where(and(eq(tcgSheet.setId, set.id), eq(tcgSheet.role, 'god')))
    await tx.delete(tcgPackTemplate).where(and(eq(tcgPackTemplate.setId, set.id), eq(tcgPackTemplate.kind, 'god')))

    // The god pack may draw base slots (the energy slot). The engine requires
    // every god template slot to point at a god-role sheet with its own G-sized
    // cursor budget, so clone those base sheets as god-role copies.
    const godSheets: FitSheetSpec[] = [...god.godSheets]
    const godSheetNames = new Set(godSheets.map(sheet => sheet.name))
    const godSlots: FitSlotSpec[] = god.godSlots.map((slot) => {
        if (godSheetNames.has(slot.sheetName)) return slot
        const base = sheets.find(sheet => sheet.name === slot.sheetName)
        if (!base) badRequest(`God slot references unknown sheet '${slot.sheetName}'`)
        const cloneName = `god-${base.name}`
        godSheets.push({ ...base, name: cloneName, role: 'god', packSlots: slot.count })
        godSheetNames.add(cloneName)
        return { sheetName: cloneName, count: slot.count }
    })
    await persistFit(tx, set.id, godSheets, godSlots, 'god', sheetIdByName)
}

/**
 * Freeze a draft set: validate templates/sheets/god config, generate the
 * secret key, derive impressions and cursor limits, publish the digest.
 * The claim is the conditional UPDATE on status='draft' — a concurrent
 * double-commit loses the claim and throws 400.
 */
export async function commitSet(setId: string): Promise<{ commitmentDigest: string, godPackCount: number }> {
    return await db.transaction(async (tx) => {
        // Take the set row lock first: draft mutations hold the same lock, so
        // everything read below is stable for the rest of the transaction.
        const set = await lockSetForUpdate(tx, setId)
        if (set.status !== 'draft') badRequest('Set is already committed')
        const N = set.targetPackCount
        if (!N || N < 1) badRequest('Target pack count is not set')

        // Template-created sets derive their god sheets/template here; the
        // reads below then see the derived state and validate it like any
        // hand-authored config.
        if (set.publishedRates != null && (set.godPackOneIn ?? 0) > 0) {
            await applyTemplateGod(tx, set, N)
        }

        const sheets = await tx.select().from(tcgSheet).where(eq(tcgSheet.setId, setId))
        const templates = await tx.select().from(tcgPackTemplate).where(eq(tcgPackTemplate.setId, setId))
        const sheetById = new Map(sheets.map(sheet => [sheet.id, sheet]))

        const baseTemplate = templates.find(t => t.kind === 'base')
        if (!baseTemplate || baseTemplate.slots.length === 0) badRequest('No base pack template')
        const godTemplate = templates.find(t => t.kind === 'god')

        // Every template slot must point at an existing sheet of the matching
        // role whose packSlots equals the slot's count.
        const referencedIds = new Set<string>()
        for (const template of templates) {
            const seenInTemplate = new Set<string>()
            for (const slot of template.slots) {
                const sheet = sheetById.get(slot.sheetId)
                if (!sheet) badRequest(`Template '${template.kind}' references a missing sheet`)
                if (seenInTemplate.has(sheet.id)) {
                    badRequest(`Template '${template.kind}' references sheet '${sheet.name}' more than once`)
                }
                seenInTemplate.add(sheet.id)
                if (sheet.role !== template.kind) {
                    badRequest(`Template '${template.kind}' references sheet '${sheet.name}' with role '${sheet.role}'`)
                }
                if (slot.count !== sheet.packSlots) {
                    badRequest(`Template '${template.kind}' slot count ${slot.count} does not match packSlots ${sheet.packSlots} of sheet '${sheet.name}'`)
                }
                if (sheet.layout.length === 0) badRequest(`Sheet '${sheet.name}' has an empty layout`)
                referencedIds.add(sheet.id)
            }
        }

        // Every sheet must draw a sane number of slots per pack, and every id
        // on a referenced layout must resolve to a printing of this set —
        // stale ids (e.g. after a re-import) would make every open 500.
        const printingRows = await tx.select({ id: tcgPrinting.id }).from(tcgPrinting)
            .where(eq(tcgPrinting.setId, setId))
        const printingIds = new Set(printingRows.map(row => row.id))
        for (const sheet of sheets) {
            if (sheet.packSlots < 1) badRequest(`Sheet '${sheet.name}' has packSlots < 1`)
            if (sheet.layout.length > 0 && sheet.packSlots > sheet.layout.length) {
                badRequest(`Sheet '${sheet.name}' has packSlots ${sheet.packSlots} greater than its layout size ${sheet.layout.length}`)
            }
            if (!referencedIds.has(sheet.id)) continue
            const unknown = [...new Set(sheet.layout)].filter(id => !printingIds.has(id))
            if (unknown.length > 0) {
                badRequest(`Sheet '${sheet.name}' layout references ${unknown.length} printing(s) that do not exist in this set`)
            }
        }

        // Window constraint (§3.3) on every sheet.
        for (const sheet of sheets) {
            const violations = validateWindow(sheet.layout, sheet.packSlots)
            if (violations.length > 0) {
                badRequest(`Sheet '${sheet.name}' has ${violations.length} window-constraint violation(s)`)
            }
        }

        // God config (§3.8): G = round(N / godOneIn), 0 when disabled.
        const godSheets = sheets.filter(sheet => sheet.role === 'god')
        const { G, errors } = godFeasibility(
            N,
            set.godPackOneIn ?? 0,
            Boolean(godTemplate && godTemplate.slots.length > 0),
            true // window-cleanliness of god sheets already enforced above
        )
        if (errors.length > 0) badRequest(errors.join('; '))
        if (G >= 1 && godSheets.length === 0) badRequest('God packs are enabled but no god sheets exist')

        const secretKey = randomBytes(32).toString('hex')
        const digest = commitmentDigestFor({ targetPackCount: N, godPackCount: G }, sheets, secretKey)

        // Claim: only one committer wins the draft → committed transition.
        const [committed] = await tx.update(tcgSet)
            .set({
                status: 'committed',
                secretKey,
                commitmentDigest: digest,
                godPackCount: G
            })
            .where(and(eq(tcgSet.id, setId), eq(tcgSet.status, 'draft')))
            .returning()
        if (!committed) badRequest('Set is already committed')

        // Freeze per-sheet impressions and cursor limits (§3.3): base sheets
        // serve N − G packs, god sheets serve G. Unreferenced sheets never
        // serve anything.
        for (const sheet of sheets) {
            const M = sheet.layout.length
            const served = referencedIds.has(sheet.id) ? (sheet.role === 'god' ? G : N - G) : 0
            const { impressions } = served > 0 && M > 0
                ? derivedImpressions(served, 0, sheet.packSlots, M)
                : { impressions: 0 }
            await tx.update(tcgSheet)
                .set({ impressions, cursorLimit: served, cursor: 0 })
                .where(eq(tcgSheet.id, sheet.id))
        }

        return { commitmentDigest: digest, godPackCount: G }
    })
}

// ─── Buy ──────────────────────────────────────────────────────────────────────

function cutsCapacityOf(sheet: SheetRow): number {
    const M = sheet.layout.length
    return Math.floor(M * (sheet.impressions ?? 0) / sheet.packSlots)
}

/**
 * Sell one pack: the pack-count increment is the guard against overselling,
 * the cursor increments are the guards against over-serving any sheet.
 * Contents (cuts) are fully reserved here (§3.5) — opening only reveals.
 * No gem cost in slice 1.
 *
 * The whole purchase runs under the set row lock, which also serializes the
 * restock pool's read-modify-write against concurrent buys/returns. When the
 * pool is non-empty, this buy receives a pooled (returned) reservation with
 * probability pool/(pool + remainingFresh) — i.e. uniform over every
 * outstanding reservation — and that path touches NO counters or cursors:
 * they already counted the reservation when it was first drawn.
 */
export async function buyPack(setId: string, userId: string): Promise<PackRow> {
    return await db.transaction(tx => buyPackIn(tx, setId, userId))
}

/**
 * Sell one pack inside an existing transaction. See buyPack for the
 * invariants; callers must hold (or be about to take) no conflicting locks —
 * this takes the set row lock itself.
 * bundleId links the pack to the Friday bundle it was sold in, null for
 * loose purchases.
 */
export async function buyPackIn(tx: Tx, setId: string, userId: string, bundleId: string | null = null): Promise<PackRow> {
    const set = await lockSetForUpdate(tx, setId)
    if (set.status !== 'committed') badRequest('Sold out')
    if (!set.secretKey || !set.targetPackCount) {
        throw createError({ statusCode: 500, statusMessage: 'Committed set is missing its run parameters' })
    }

    const pool = set.restockPool
    const remainingFresh = Math.max(set.targetPackCount - set.packsSold, 0)
    if (pool.length + remainingFresh === 0) badRequest('Sold out')

    const takePooled = pool.length > 0
        && (remainingFresh === 0 || randomInt(1, pool.length + remainingFresh) <= pool.length)
    if (takePooled) {
        const [entry] = pool.splice(randomInt(0, pool.length - 1), 1)
        await tx.update(tcgSet).set({ restockPool: pool }).where(eq(tcgSet.id, setId))
        // packIndex is free again — the original pack row was deleted on
        // return, so the (setId, packIndex) unique constraint holds.
        const [pack] = await tx.insert(tcgPack)
            .values({
                setId,
                ownerId: userId,
                bundleId,
                packIndex: entry!.packIndex,
                isGod: entry!.isGod,
                cuts: entry!.cuts,
                state: 'sealed'
            })
            .returning()
        return pack!
    }

    const [sold] = await tx.update(tcgSet)
        .set({ packsSold: sql`${tcgSet.packsSold} + 1` })
        .where(and(
            eq(tcgSet.id, setId),
            eq(tcgSet.status, 'committed'),
            lt(tcgSet.packsSold, tcgSet.targetPackCount)
        ))
        .returning()
    if (!sold) badRequest('Sold out')

    const n = sold.packsSold - 1
    const N = set.targetPackCount
    const G = sold.godPackCount ?? 0
    const isGod = G > 0 && feistelPermute(n, N, deriveKey(set.secretKey, 'god')) < G

    await tx.update(tcgSet)
        .set(isGod
            ? { godPacksSold: sql`${tcgSet.godPacksSold} + 1` }
            : { basePacksSold: sql`${tcgSet.basePacksSold} + 1` })
        .where(eq(tcgSet.id, setId))

    const [template] = await tx.select().from(tcgPackTemplate)
        .where(and(eq(tcgPackTemplate.setId, setId), eq(tcgPackTemplate.kind, isGod ? 'god' : 'base')))
    if (!template) {
        throw createError({ statusCode: 500, statusMessage: 'Pack template missing for committed set' })
    }

    const cuts: { sheetId: string, seq: number, cut: number }[] = []
    for (const slot of template.slots) {
        const [drawn] = await tx.update(tcgSheet)
            .set({ cursor: sql`${tcgSheet.cursor} + 1` })
            .where(and(eq(tcgSheet.id, slot.sheetId), lt(tcgSheet.cursor, tcgSheet.cursorLimit)))
            .returning()
        if (!drawn) {
            // A sheet exhausted before the set sold out is an invariant
            // breach — roll the whole purchase back.
            throw createError({ statusCode: 500, statusMessage: 'Sheet exhausted before sellout' })
        }
        const seq = drawn.cursor - 1
        const cut = feistelPermute(seq, cutsCapacityOf(drawn), deriveKey(set.secretKey, `sheet:${drawn.id}`))
        cuts.push({ sheetId: drawn.id, seq, cut })
    }

    const [pack] = await tx.insert(tcgPack)
        .values({
            setId,
            ownerId: userId,
            bundleId,
            packIndex: n,
            isGod,
            cuts,
            state: 'sealed'
        })
        .returning()
    return pack!
}

// ─── Return ───────────────────────────────────────────────────────────────────

/**
 * Return a pack to the set's restock pool (admin debug affordance).
 *
 * Counters and cursors are NEVER rewound — a drawn reservation stays drawn.
 * The contents of a pooled reservation are fixed: each cut is the committed
 * permutation of the seq it drew at creation. What IS random is WHICH future
 * purchase receives it — buyPack picks uniformly over every outstanding
 * reservation (pooled + remaining fresh), which is knowledge-equivalent to
 * the box-mapping property the design doc (§3.3) already accepts. It must
 * still never be exposed to players: the returner knows the pooled contents.
 *
 * Runs entirely under the set row lock, so the pool read-modify-write
 * serializes against concurrent buyPack/returnPack. For an opened pack the
 * conditional copy delete is the guard (every minted copy must still be
 * owned by the returner and raw); for a sealed pack the guarded pack-row
 * delete is the claim — a concurrent double return loses one of the two.
 */
export async function returnPack(packId: string, userId: string): Promise<{ packIndex: number, pooled: number }> {
    return await db.transaction(async (tx) => {
        const [pack] = await tx.select().from(tcgPack).where(eq(tcgPack.id, packId))
        if (!pack) throw createError({ statusCode: 404, statusMessage: 'Pack not found' })
        if (pack.ownerId !== userId) throw createError({ statusCode: 403, statusMessage: 'Not your pack' })

        const set = await lockSetForUpdate(tx, pack.setId)

        // An opened pack must come back with every copy it minted — untouched
        // (still owned by the returner, still raw). The delete is the guard.
        if (pack.state === 'opened') {
            const sheetIds = [...new Set(pack.cuts.map(cut => cut.sheetId))]
            const sheets = await tx.select().from(tcgSheet).where(inArray(tcgSheet.id, sheetIds))
            const sheetById = new Map(sheets.map(sheet => [sheet.id, sheet]))
            const cardsPerPack = pack.cuts.reduce((sum, cut) => sum + (sheetById.get(cut.sheetId)?.packSlots ?? 0), 0)
            const deleted = await tx.delete(tcgCopy)
                .where(and(
                    eq(tcgCopy.packId, pack.id),
                    eq(tcgCopy.ownerId, userId),
                    eq(tcgCopy.lifecycle, 'raw'),
                    // A listed copy must not be vaporised by a debug return —
                    // the cascade would silently take the listing with it.
                    sql`not exists (select 1 from tcg_listings l where l.copy_id = ${tcgCopy.id} and l.state = 'active')`
                ))
                .returning({ id: tcgCopy.id })
            if (deleted.length !== cardsPerPack) badRequest('Pack contents are no longer intact')
        }

        // Claim: only one return of this pack can win the row delete. The
        // state CAS (text column — safe) also loses the claim when a
        // concurrent openPack flipped sealed → opened after our read above:
        // without it a stale-sealed return would skip the copy-intactness
        // guard yet still cascade-delete the freshly minted copies.
        const [removed] = await tx.delete(tcgPack)
            .where(and(eq(tcgPack.id, pack.id), eq(tcgPack.ownerId, userId), eq(tcgPack.state, pack.state)))
            .returning({ id: tcgPack.id })
        if (!removed) throw createError({ statusCode: 404, statusMessage: 'Pack not found' })

        // Plain read-modify-write is safe here: the set row lock serializes
        // every reader/writer of restockPool.
        const pool = [...set.restockPool, { packIndex: pack.packIndex, isGod: pack.isGod, cuts: pack.cuts }]
        await tx.update(tcgSet).set({ restockPool: pool }).where(eq(tcgSet.id, pack.setId))

        return { packIndex: pack.packIndex, pooled: pool.length }
    })
}

// ─── Open ─────────────────────────────────────────────────────────────────────

/**
 * Reveal a sealed pack: claim the state flip, then resolve the reserved cuts
 * against the frozen layouts and mint copies. Never rolls anything — except
 * each copy's immutable `condition`, which is minted here and must never be
 * selected into client payloads (§6.1).
 */
export async function openPack(packId: string, userId: string): Promise<OpenedPackResult> {
    return await db.transaction(async (tx) => {
        const [pack] = await tx.update(tcgPack)
            .set({ state: 'opened', openedAt: new Date() })
            .where(and(eq(tcgPack.id, packId), eq(tcgPack.ownerId, userId), eq(tcgPack.state, 'sealed')))
            .returning()
        if (!pack) badRequest('Already opened')

        const sheetIds = [...new Set(pack.cuts.map(cut => cut.sheetId))]
        const sheets = await tx.select().from(tcgSheet).where(inArray(tcgSheet.id, sheetIds))
        const sheetById = new Map(sheets.map(sheet => [sheet.id, sheet]))

        const copyValues: typeof tcgCopy.$inferInsert[] = []
        const serials: string[] = []
        for (const cut of pack.cuts) {
            const sheet = sheetById.get(cut.sheetId)
            if (!sheet || !sheet.impressions) {
                throw createError({ statusCode: 500, statusMessage: 'Pack references a missing or uncommitted sheet' })
            }
            const M = sheet.layout.length
            const R = sheet.impressions
            const k = sheet.packSlots
            const start = (cut.cut * k) % (M * R)
            for (let i = 0; i < k; i++) {
                const printingId = sheet.layout[(start + i) % M]!
                copyValues.push({
                    printingId,
                    setId: pack.setId,
                    ownerId: pack.ownerId,
                    packId: pack.id,
                    sheetId: sheet.id,
                    cutIndex: cut.cut,
                    slotOffset: i,
                    lifecycle: 'raw',
                    condition: mintCondition()
                })
                serials.push(`${sheet.name} #${cut.cut * k + i + 1}`)
            }
        }

        const copies = await tx.insert(tcgCopy).values(copyValues).returning()

        const printingIds = [...new Set(copyValues.map(v => v.printingId))]
        const printings = await tx.select({ printing: tcgPrinting, card: tcgCard })
            .from(tcgPrinting)
            .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
            .where(inArray(tcgPrinting.id, printingIds))
        const printingById = new Map(printings.map(row => [row.printing.id, row]))

        const cards: OpenedPackCard[] = copies.map((copy, i) => {
            const resolved = printingById.get(copy.printingId)
            if (!resolved) {
                throw createError({ statusCode: 500, statusMessage: 'Copy references a missing printing' })
            }
            const { printing, card } = resolved
            return {
                copyId: copy.id,
                printingId: printing.id,
                cardId: card.id,
                plaatjesCardId: printing.plaatjesCardId,
                name: card.name,
                number: card.number,
                rarity: card.rarity ?? '',
                finish: printing.finish as TcgFinish,
                pattern: printing.pattern,
                serial: serials[i]!,
                bundle: printing.bundle ?? '',
                assetNumber: printing.assetNumber ?? '',
                maskKind: printing.maskKind,
                foilEffect: printing.foilEffect
            }
        })

        return { packId: pack.id, isGod: pack.isGod, cards }
    })
}

// ─── Serializers ──────────────────────────────────────────────────────────────

/**
 * Strip the secret key and the restock pool from a set row before it leaves
 * the server — pooled entries carry packIndex/isGod/cuts of returned packs,
 * which clients must not see. Only the pool size ships, as `restockCount`.
 */
export function serializeSet<T extends Pick<SetRow, 'secretKey' | 'restockPool'>>(set: T): Omit<T, 'secretKey' | 'restockPool'> & { restockCount: number } {
    const { secretKey: _secretKey, restockPool, ...rest } = set
    return { ...rest, restockCount: restockPool.length }
}

/**
 * Pack summary for clients. `isGod` is only included for opened packs or when
 * the caller is an admin — a sealed pack must never leak it (§3.5).
 */
export function serializePack(pack: PackRow, includeGod = false): SealedPackSummary {
    const summary: SealedPackSummary = {
        id: pack.id,
        setId: pack.setId,
        packIndex: pack.packIndex,
        state: pack.state as SealedPackSummary['state'],
        bundleId: pack.bundleId,
        createdAt: pack.createdAt.toISOString()
    }
    if (includeGod || pack.state === 'opened') summary.isGod = pack.isGod
    return summary
}

export type { Tx as TcgTx }
