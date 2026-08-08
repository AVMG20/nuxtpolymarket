// Checklist import + fitter persistence shared between the admin endpoints
// and commitSet's template-god integration. Pure of any HTTP handler concerns.

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPackTemplate } from '#server/database/schema'
import type { TcgCardRaw, TcgPackTemplateSlot } from '#shared/types/tcg-db'
import type { FitPrinting, FitSheetSpec, FitSlotSpec } from '#shared/utils/tcg/rate-fitter'

/** Untyped fetch for sidecar URLs — route-type inference over the grown API
 *  union hits TS2589 even for external template-literal URLs. */
const sidecarFetch = <T = unknown>(url: string, opts?: Record<string, unknown>): Promise<T> =>
    ($fetch as (url: string, opts?: Record<string, unknown>) => Promise<T>)(url, opts)


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type DbConn = Tx | typeof db
export type TcgCardInsert = typeof tcgCard.$inferInsert
export type TcgPrintingInsert = typeof tcgPrinting.$inferInsert

/** One card record as served by the pokemonplaatjes sidecar (camelCase). */
export interface PlaatjesCard {
    cardId?: string | null
    name?: string | null
    number?: string | null
    setTotal?: string | null
    assetNumber?: string | null
    rarity?: string | null
    rarityCode?: string | null
    category?: string | null
    bundle?: string | null
    foilEffect?: string | null
    foilMask?: string | null
    images?: { card?: string | null, masks?: string[] | null } | null
    [key: string]: unknown
}

/**
 * When the sidecar's `images` paths disagree with the record's `bundle`
 * (alternate-art families like svalt), derive the render references from the
 * paths themselves: `/images/cards/sv8-5_en_074_alt.png` yields
 * bundle `sv8-5_en_074_alt`, assetNumber `074` (the `_alt` marker travels on
 * the face name, foil.js resolve({ alt }) re-appends it), and the mask kind
 * from `/images/masks/sv8-5_wp_alt_en_074.png` → `wp_alt`. Returns null when
 * everything already matches (the common case), so callers can fall back to
 * the ordinary suffix-based logic.
 */
function deriveRenderRefs(variant: PlaatjesCard): { bundle: string, assetNumber: string | null, maskKind: string | null } | null {
    const cardPath = variant.images?.card
    if (!cardPath || !cardPath.startsWith('/images/cards/')) return null
    const file = cardPath.slice('/images/cards/'.length).replace(/\.png$/, '')
    if (!variant.bundle || file === variant.bundle) return null
    const tail = file.split('_en_')[1] ?? null
    const assetNumber = tail?.replace(/_alt$/, '') ?? null
    let maskKind: string | null = null
    const maskPath = variant.images?.masks?.[0]
    if (maskPath) {
        const maskFile = maskPath.split('/').pop()?.replace(/\.png$/, '') ?? ''
        const m = maskFile.match(/^.*?_((?:[a-z0-9]+_)*?(?:wp|etch)[a-z0-9_]*)_en_/i)
        // The mask name is `<family>_<kind>_en_<num>`; take the middle.
        const family = file.split('_en_')[0] ?? ''
        if (maskFile.startsWith(family + '_') && maskFile.includes('_en_')) {
            maskKind = maskFile.slice(family.length + 1, maskFile.lastIndexOf('_en_'))
        } else if (m) {
            maskKind = m[1] ?? null
        }
    }
    return { bundle: file, assetNumber, maskKind }
}

interface PlaatjesCardsPage {
    total: number
    page: number
    limit: number
    returned: number
    items: PlaatjesCard[]
}

/**
 * Variant suffixes a card id can carry, longest first so `_ph2` is not
 * misread as `_ph`. Mirrors `Card::mask_kind` in pokemonplaatjes
 * api/src/cards.rs.
 */
const VARIANT_SUFFIXES: [suffix: string, maskKind: string, pattern: string | null][] = [
    ['_ph2', 'wp_ph2', 'ph2'],
    ['_sph', 'wp_sph', 'pokeball'],
    ['_mph', 'wp_mph', 'masterball'],
    ['_ph', 'wp_ph', null]
]

function variantOf(cardId: string) {
    for (const [suffix, maskKind, pattern] of VARIANT_SUFFIXES) {
        if (cardId.endsWith(suffix)) {
            return { baseId: cardId.slice(0, -suffix.length), suffix, maskKind, pattern }
        }
    }
    return { baseId: cardId, suffix: null, maskKind: null, pattern: null }
}

/** TS mirror of `Card::mask_kind` (api/src/cards.rs): suffix first, then foilMask. */
function maskKindOf(cardId: string, foilMask: string | null): string {
    const { maskKind } = variantOf(cardId)
    if (maskKind) return maskKind
    switch ((foilMask ?? '').toLowerCase()) {
        case 'reverselaminatepokeball':
        case 'reverselaminatemasterball':
            return 'wp_ph2'
        case 'reverse':
            return 'wp_ph'
        default:
            return 'wp'
    }
}

/**
 * Finish classification:
 * - 'reverse' when the card id carries a variant suffix or foilMask names a
 *   Reverse treatment ('Reverse', 'ReverseLaminatePokeBall', …)
 * - 'holo' when foilEffect names a real effect (non-empty, not 'NonFoil'/'None'),
 *   or — for legacy records, which carry no foilEffect — when the rarity label
 *   says the printing is foiled: 'Rare Holo', and the WOTC-era secret labels
 *   ('Shining Rare', 'Secret Rare'), which were all holo printings
 * - 'nonholo' otherwise
 */
function finishOf(cardId: string, foilEffect: string | null, foilMask: string | null, rarity: string | null = null): string {
    if (variantOf(cardId).suffix) return 'reverse'
    if ((foilMask ?? '').toLowerCase().startsWith('reverse')) return 'reverse'
    const effect = (foilEffect ?? '').toLowerCase()
    if (effect && effect !== 'nonfoil' && effect !== 'none') return 'holo'
    if (/holo|shining|secret/.test((rarity ?? '').toLowerCase())) return 'holo'
    return 'nonholo'
}

/**
 * Pattern for reverse variants: `_ph` is the plain reverse (null), `_sph` the
 * pokeball laminate, `_mph` the masterball laminate (observed foilMask values
 * ReverseLaminatePokeBall / ReverseLaminateMasterBall), `_ph2` a second plain
 * reverse variant ('ph2').
 */
function patternOf(cardId: string): string | null {
    return variantOf(cardId).pattern
}

function toInt(value: string | null | undefined): number | null {
    if (typeof value !== 'string') return null
    const parsed = parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
}

/** Numeric-first sort key for card numbers ('2' before '10', letters last). */
function numberSortKey(number: string): number {
    const parsed = parseInt(number, 10)
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

const CHUNK = 500

/**
 * Fetch a set's full checklist from the pokemonplaatjes sidecar and map it to
 * insert-ready rows for the given set id. Card AND printing ids are assigned
 * here (crypto.randomUUID) so callers can reference them — e.g. hand printing
 * ids to the rate fitter — before anything is inserted. Pure of the DB.
 * Throws 502 when the sidecar is unreachable, 400 when the set is empty.
 */
export async function fetchPlaatjesChecklist(plaatjesSetCode: string, apiBase: string, setId: string): Promise<{
    cardRows: TcgCardInsert[]
    printingRows: TcgPrintingInsert[]
}> {
    const records: PlaatjesCard[] = []
    try {
        for (let page = 1; ; page++) {
            const response = await sidecarFetch<PlaatjesCardsPage>(`${apiBase}/cards`, {
                query: { set: plaatjesSetCode, limit: 500, page }
            })
            records.push(...response.items)
            if (response.returned === 0 || records.length >= response.total) break
        }
    } catch {
        throw createError({
            statusCode: 502,
            statusMessage: `Could not reach the pokemonplaatjes sidecar at ${apiBase} — is it running?`
        })
    }
    if (records.length === 0) {
        throw createError({ statusCode: 400, statusMessage: `No cards found for set '${plaatjesSetCode}'` })
    }

    // Group variant records under their suffix-stripped base id.
    const byBaseId = new Map<string, { base: PlaatjesCard, variants: PlaatjesCard[] }>()
    for (const record of records) {
        if (!record.cardId) continue
        const { baseId, suffix } = variantOf(record.cardId)
        let group = byBaseId.get(baseId)
        if (!group) {
            group = { base: record, variants: [] }
            byBaseId.set(baseId, group)
        }
        // Prefer the suffix-free record as the checklist face.
        if (!suffix) group.base = record
        group.variants.push(record)
    }

    const bases = [...byBaseId.entries()].sort(([, a], [, b]) => {
        const keyA = numberSortKey(a.base.number ?? '')
        const keyB = numberSortKey(b.base.number ?? '')
        if (keyA !== keyB) return keyA - keyB
        return (a.base.number ?? '').localeCompare(b.base.number ?? '')
    })

    return mapChecklistRows(setId, bases)
}

/**
 * Map grouped sidecar records to insert-ready card + printing rows. Shared by
 * fetchPlaatjesChecklist and fetchEraBasicEnergies so era basics become
 * ordinary rows through the exact same mapping. `sortOrderStart` lets callers
 * append after an existing checklist.
 */
function mapChecklistRows(
    setId: string,
    bases: [string, { base: PlaatjesCard, variants: PlaatjesCard[] }][],
    sortOrderStart = 0
): { cardRows: TcgCardInsert[], printingRows: TcgPrintingInsert[] } {
    const cardRows: TcgCardInsert[] = []
    const printingRows: TcgPrintingInsert[] = []
    bases.forEach(([baseId, group], index) => {
        const sortOrder = sortOrderStart + index
        const cardId = crypto.randomUUID()
        const base = group.base
        cardRows.push({
            id: cardId,
            setId,
            plaatjesBaseId: baseId,
            number: base.number ?? '',
            setTotal: toInt(base.setTotal),
            name: base.name ?? '',
            rarity: base.rarity ?? null,
            rarityCode: base.rarityCode ?? null,
            category: base.category ?? null,
            sortOrder,
            raw: base as TcgCardRaw
        })
        for (const variant of group.variants) {
            // Legacy (pre-B&W, TCGdex scan) records carry no bundle: their
            // face lives at /images/legacy/<set>/<num>.png, they have no
            // masks, and rarity/foilEffect may be null (rarity arrives later
            // API-side).
            const legacy = variant.bundle == null
            // Some families' textures live under another bundle name: the
            // svalt (alternate-art) records say bundle `svalt_en_152` while
            // the actual face is `sv8-5_en_074_alt.png` and the mask kind is
            // `wp_alt`. The sidecar's own `images` block is the ground truth
            // for where the pixels are, so when it disagrees with the bundle
            // field, derive bundle/assetNumber/maskKind from the paths.
            const derived = !legacy ? deriveRenderRefs(variant) : null
            printingRows.push({
                id: crypto.randomUUID(),
                setId,
                cardId,
                plaatjesCardId: variant.cardId!,
                finish: finishOf(variant.cardId!, variant.foilEffect ?? null, variant.foilMask ?? null, legacy ? variant.rarity ?? null : null),
                pattern: patternOf(variant.cardId!),
                bundle: derived?.bundle ?? variant.bundle ?? null,
                // The renderer reconstructs texture names as `${family}_en_${num}`,
                // so num must be the bundle's own tail — the sidecar's assetNumber
                // is the printed number (e.g. "TG01") and does not match the files.
                // Legacy scans have no bundle; their file IS named by the number.
                assetNumber: legacy
                    ? variant.assetNumber ?? variant.number ?? null
                    : derived?.assetNumber ?? variant.bundle!.split('_en_')[1] ?? null,
                maskKind: legacy ? null : derived?.maskKind ?? maskKindOf(variant.cardId!, variant.foilMask ?? null),
                foilEffect: variant.foilEffect ?? null,
                foilMask: variant.foilMask ?? null
            })
        }
    })
    return { cardRows, printingRows }
}

interface PlaatjesSetsIndex {
    sets: { setCode?: string | null, seriesCode?: string | null }[]
}

/**
 * Fetch an era's BASIC energies from the sidecar for a set whose own
 * checklist carries none. Resolution: '<seriesCode>E' (SVE, MEE) when that
 * set exists in /sets, otherwise the shared 'EC' set. Filters to plain
 * basics (TCGLFBE / NonFoil); a name missing a plain record falls back to
 * any TCGL*BE record for it, preferring NonFoil. Dedupes to ONE record per
 * distinct card name and maps them through the same record→row mapping as
 * the checklist, appended from `sortOrderStart`. Rarity fields are kept
 * as-is from the record. Warns (does not throw) when the yield differs from
 * `wantedCount`.
 */
export async function fetchEraBasicEnergies(
    seriesCode: string,
    apiBase: string,
    wantedCount: number,
    setId: string,
    sortOrderStart: number
): Promise<{
    cardRows: TcgCardInsert[]
    printingRows: TcgPrintingInsert[]
    warnings: string[]
    energySetCode: string
}> {
    let energySetCode = 'EC'
    let records: PlaatjesCard[]
    try {
        const index = await sidecarFetch<PlaatjesSetsIndex>(`${apiBase}/sets`)
        const candidate = `${seriesCode}E`
        if (seriesCode && index.sets.some(row => row.setCode === candidate)) {
            energySetCode = candidate
        }
        const page = await sidecarFetch<PlaatjesCardsPage>(`${apiBase}/cards`, {
            query: { set: energySetCode, limit: 500 }
        })
        records = page.items
    } catch {
        throw createError({
            statusCode: 502,
            statusMessage: `Could not reach the pokemonplaatjes sidecar at ${apiBase} — is it running?`
        })
    }

    const byName = new Map<string, PlaatjesCard[]>()
    for (const record of records) {
        if (!record.cardId || !record.name) continue
        if (!/BE$/i.test(record.rarityCode ?? '')) continue
        const group = byName.get(record.name)
        if (group) group.push(record)
        else byName.set(record.name, [record])
    }
    const picked: PlaatjesCard[] = []
    for (const group of byName.values()) {
        group.sort((a, b) => a.cardId!.localeCompare(b.cardId!))
        const record = group.find(r => r.rarityCode === 'TCGLFBE' && r.foilEffect === 'NonFoil')
            ?? group.find(r => r.foilEffect === 'NonFoil')
            ?? group[0]!
        picked.push(record)
    }
    if (picked.length === 0) {
        throw createError({ statusCode: 400, statusMessage: `No basic energies found in era energy set '${energySetCode}'` })
    }
    picked.sort((a, b) => {
        const keyA = numberSortKey(a.number ?? '')
        const keyB = numberSortKey(b.number ?? '')
        if (keyA !== keyB) return keyA - keyB
        return (a.name ?? '').localeCompare(b.name ?? '')
    })

    const warnings: string[] = []
    if (picked.length !== wantedCount) {
        warnings.push(`Era energy set '${energySetCode}' yields ${picked.length} basic energies but the template's energy pool expects ${wantedCount} — keeping the ${picked.length} that exist`)
    }
    const { cardRows, printingRows } = mapChecklistRows(
        setId,
        picked.map(record => [record.cardId!, { base: record, variants: [record] }]),
        sortOrderStart
    )
    return { cardRows, printingRows, warnings, energySetCode }
}

/**
 * Replace a draft set's checklist wholesale: delete existing cards (printings
 * cascade) and insert the mapped rows in chunks. Caller must hold the set row
 * lock (lockSetForUpdate) on the same transaction.
 */
export async function applyChecklist(tx: Tx, setId: string, cardRows: TcgCardInsert[], printingRows: TcgPrintingInsert[]): Promise<void> {
    await tx.delete(tcgCard).where(eq(tcgCard.setId, setId))
    for (let i = 0; i < cardRows.length; i += CHUNK) {
        await tx.insert(tcgCard).values(cardRows.slice(i, i + CHUNK))
    }
    for (let i = 0; i < printingRows.length; i += CHUNK) {
        await tx.insert(tcgPrinting).values(printingRows.slice(i, i + CHUNK))
    }
}

/**
 * Persist fitter output: insert one tcgSheet per FitSheetSpec (the layouts
 * already reference real printing ids) and upsert the pack template of the
 * given kind. `existingSheetIdByName` resolves slot names that refer to
 * sheets already in the DB (the god template's energy slot). Returns the
 * name → id map of the sheets inserted here.
 */
export async function persistFit(
    tx: Tx,
    setId: string,
    sheets: FitSheetSpec[],
    slots: FitSlotSpec[],
    kind: 'base' | 'god',
    existingSheetIdByName: Map<string, string> = new Map()
): Promise<Map<string, string>> {
    const inserted = new Map<string, string>()
    for (const [sortOrder, spec] of sheets.entries()) {
        const [row] = await tx.insert(tcgSheet).values({
            setId,
            name: spec.name,
            role: spec.role,
            packSlots: spec.packSlots,
            layout: spec.layout,
            sortOrder
        }).returning()
        inserted.set(spec.name, row!.id)
    }
    const templateSlots: TcgPackTemplateSlot[] = slots.map((slot) => {
        const sheetId = inserted.get(slot.sheetName) ?? existingSheetIdByName.get(slot.sheetName)
        if (!sheetId) {
            throw createError({ statusCode: 500, statusMessage: `Fit slot references unknown sheet '${slot.sheetName}'` })
        }
        return { sheetId, count: slot.count }
    })
    await tx.insert(tcgPackTemplate)
        .values({ setId, kind, slots: templateSlots })
        .onConflictDoUpdate({
            target: [tcgPackTemplate.setId, tcgPackTemplate.kind],
            set: { slots: templateSlots }
        })
    return inserted
}

/**
 * Rebuild the fitter's view of a set from the DB: FitPrinting rows (rarity
 * fields from the parent card, finish/pattern from the printing) plus the
 * base sheets reconstructed as FitSheetSpecs (mults recounted from the
 * layout) and the base template's slots. Used by commitSet's god integration
 * and the print-run preview.
 */
export async function loadFitContext(tx: DbConn, setId: string): Promise<{
    printings: FitPrinting[]
    sheets: FitSheetSpec[]
    slots: FitSlotSpec[]
    sheetIdByName: Map<string, string>
}> {
    const printingRows = await tx.select({ printing: tcgPrinting, card: tcgCard })
        .from(tcgPrinting)
        .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .where(eq(tcgPrinting.setId, setId))
    const printings: FitPrinting[] = printingRows.map(({ printing, card }) => ({
        id: printing.id,
        rarity: card.rarity,
        rarityCode: card.rarityCode,
        finish: printing.finish,
        pattern: printing.pattern,
        category: card.category,
        name: card.name
    }))

    const sheetRows = await tx.select().from(tcgSheet).where(eq(tcgSheet.setId, setId))
    const sheetById = new Map(sheetRows.map(row => [row.id, row]))
    const sheetIdByName = new Map(sheetRows.map(row => [row.name, row.id]))
    const sheets: FitSheetSpec[] = sheetRows
        .filter(row => row.role === 'base')
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((row) => {
            const counts = new Map<string, number>()
            for (const id of row.layout) counts.set(id, (counts.get(id) ?? 0) + 1)
            return {
                name: row.name,
                role: 'base' as const,
                packSlots: row.packSlots,
                mults: [...counts.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1),
                layout: row.layout
            }
        })

    const [baseTemplate] = await tx.select().from(tcgPackTemplate)
        .where(eq(tcgPackTemplate.setId, setId))
        .then(rows => rows.filter(row => row.kind === 'base'))
    const slots: FitSlotSpec[] = (baseTemplate?.slots ?? []).flatMap((slot) => {
        const sheet = sheetById.get(slot.sheetId)
        return sheet ? [{ sheetName: sheet.name, count: slot.count }] : []
    })

    return { printings, sheets, slots, sheetIdByName }
}

/**
 * Insert a template-created set with its checklist and fitter output in one
 * transaction, guarded against concurrent duplicate submits: the first tx
 * statement takes a transaction-scoped advisory lock on the template code, so
 * of two concurrent submits one waits, then sees the other's committed row in
 * the existence check and 409s. `setValues.templateCode` must be set.
 */
export async function createTemplateSet(
    setValues: typeof tcgSet.$inferInsert & { id: string, templateCode: string },
    cardRows: TcgCardInsert[],
    printingRows: TcgPrintingInsert[],
    sheets: FitSheetSpec[],
    slots: FitSlotSpec[]
): Promise<void> {
    await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'tcg-create-' + setValues.templateCode}))`)
        // A reprint (§3.6) is deliberately a second set on the same template —
        // the duplicate guard only protects the plain create path. Reprints
        // instead guard against a concurrent duplicate reprint of the SAME
        // parent still in draft.
        const [existing] = setValues.reprintOfSetId
            ? await tx.select({ id: tcgSet.id }).from(tcgSet)
                .where(and(
                    eq(tcgSet.reprintOfSetId, setValues.reprintOfSetId),
                    eq(tcgSet.status, 'draft')
                ))
                .limit(1)
            : await tx.select({ id: tcgSet.id }).from(tcgSet)
                .where(and(
                    eq(tcgSet.templateCode, setValues.templateCode),
                    inArray(tcgSet.status, ['draft', 'committed'])
                ))
                .limit(1)
        if (existing) {
            throw createError({
                statusCode: 409,
                statusMessage: setValues.reprintOfSetId
                    ? 'A reprint of this set is already in draft'
                    : 'Set already exists for this template'
            })
        }
        await tx.insert(tcgSet).values(setValues)
        await applyChecklist(tx, setValues.id, cardRows, printingRows)
        await persistFit(tx, setValues.id, sheets, slots, 'base')
    })
}

export type { Tx as TcgImportTx }
