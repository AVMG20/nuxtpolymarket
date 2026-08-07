// Shared API/UI shapes for the TCG collector sim.
// DB row shapes live elsewhere — these are the lean wire/view types.

import type { RateTemplate } from '#shared/utils/tcg/rate-fitter'

export type TcgSetStatus = 'draft' | 'committed'
export type TcgFinish = 'nonholo' | 'holo' | 'reverse'
export type TcgSheetRole = 'base' | 'god'
export type TcgPackKind = 'base' | 'god'
export type TcgPackState = 'sealed' | 'opened'

export interface SetSummary {
    id: string
    name: string
    code: string
    status: TcgSetStatus
    releaseDate: string | null
    targetPackCount: number | null
    packsSold: number
    cardCount: number
    printingCount: number
}

export interface PrintingSummary {
    id: string
    cardId: string
    plaatjesCardId: string
    finish: TcgFinish
    pattern: string | null
    printRunLabel: string
    bundle: string
    assetNumber: string
    maskKind: string | null
    foilEffect: string | null
    foilMask: string | null
}

export interface ChecklistCard {
    id: string
    plaatjesBaseId: string
    name: string
    number: string
    setTotal: number | null
    rarity: string
    rarityCode: string | null
    category: string | null
    sortOrder: number
    printings: PrintingSummary[]
}

export interface SheetDraft {
    id: string
    name: string
    role: TcgSheetRole
    packSlots: number
    layout: string[]
    sortOrder: number
    impressions: number | null
    cursor: number
    cursorLimit: number | null
}

export interface PackTemplateSlot {
    sheetId: string
    count: number
}

export interface PackTemplateView {
    id: string
    kind: TcgPackKind
    slots: PackTemplateSlot[]
}

export interface SetDetail extends SetSummary {
    plaatjesSetCode: string | null
    godPackOneIn: number | null
    godPackCount: number | null
    commitmentDigest: string | null
    cards: ChecklistCard[]
    sheets: SheetDraft[]
    templates: PackTemplateView[]
}

export interface WindowViolation {
    position: number
    printingId: string
}

export interface SlotRate {
    printingId: string
    multiplicity: number
    expectedPerPack: number
    oneIn: number
}

export interface PopulationRow {
    printingId: string
    population: number
}

/** Population row joined with card/printing display fields for the admin preview. */
export interface PopulationPreviewRow extends PopulationRow {
    cardName: string
    cardNumber: string
    rarity: string
    finish: TcgFinish
    pattern: string | null
}

export interface SheetImpressions {
    sheetId: string
    impressions: number
    cutsCapacity: number
    leftoverTokens: number
}

/** Published vs authored per-pack rate for one scraped tier. */
export interface RateDiagnosticRow {
    label: string
    publishedPerPack: number
    authoredPerPack: number
    deltaPct: number
}

/** applyGodConfig verdict for a template-created draft set. */
export interface GodPreview {
    feasible: boolean
    reason?: string
    G: number
}

export interface PrintRunPreview {
    godPackCount: number
    sheets: SheetImpressions[]
    population: PopulationPreviewRow[]
    exactWithinOne: boolean
    errors: string[]
    warnings: string[]
    /** Present when the set was created from a scraped rate template. */
    rateDiagnostics?: RateDiagnosticRow[]
    /** Present (possibly null) when godOneIn is set on a template-created draft set. */
    godPreview?: GodPreview | null
}

export interface OpenedPackCard {
    copyId: string
    printingId: string
    cardId: string
    plaatjesCardId: string
    name: string
    number: string
    rarity: string
    finish: TcgFinish
    pattern: string | null
    serial: string
    bundle: string
    assetNumber: string
    maskKind: string | null
    foilEffect: string | null
}

export interface SealedPackSummary {
    id: string
    setId: string
    packIndex: number
    state: TcgPackState
    isGod?: boolean
    bundleId?: string | null
    createdAt: string
}

/** One claimed Friday bundle with pack counts derived from the owner's packs. */
export interface TcgBundleSummary {
    id: string
    setId: string
    weekKey: string
    createdAt: string
    sealedCount: number
    openedCount: number
}

// ── Condition rendering (§6.2 / §6.3) ───────────────────────────────────────

/**
 * Server-derived lossy wear spec — the ONLY condition-shaped data a client
 * ever receives. Raw condition never leaves the server; only flaws that
 * survived the lossy filter appear here, and an absent entry means nothing
 * to render. Front face only this slice.
 */
export interface TcgWearSpec {
    /** Print offset as fractions of card width/height (±, ~0..0.035); EXACT, not noised — centering is the one objectively measurable thing (§6.2). */
    centering: { dx: number, dy: number }
    /** severity 0..1 (lossy), seed uint32 for procedural noise. */
    corners: { corner: 'tl' | 'tr' | 'bl' | 'br', severity: number, seed: number }[]
    edges: { edge: 'top' | 'right' | 'bottom' | 'left', severity: number, seed: number }[]
    /** x, y in 0..1 card space. */
    surface: { x: number, y: number, angle: number, type: 'scratch' | 'print_line' | 'dimple' | 'gloss_loss', severity: number, seed: number }[]
}

/** One owned copy of a printing, for the copy picker. Never carries condition data. */
export interface TcgCopySummary {
    id: string
    /** Display serial, same shape as the pack-open one: `<sheet name> #<n>`. */
    serial: string
    cutIndex: number
    slotOffset: number
    createdAt: string
    /** 'raw' | 'grading' | 'slabbed' — drives what the inspector offers. */
    lifecycle: string
    /** Active market listing, when this copy is up for sale. */
    listingId: string | null
    listedPrice: number | null
    /** Present when lifecycle is 'slabbed'. */
    grade: TcgGradePayload | null
}

// ── Player collection payload ───────────────────────────────────────────────

export interface CollectionPrinting {
    id: string
    plaatjesCardId: string
    finish: TcgFinish
    pattern: string | null
    printRunLabel: string
    bundle: string | null
    assetNumber: string | null
    maskKind: string | null
    foilEffect: string | null
    foilMask: string | null
    /** Copies of this printing the caller owns. Never carries condition data. */
    owned: number
}

export interface CollectionCard {
    id: string
    plaatjesBaseId: string
    name: string
    number: string
    setTotal: number | null
    rarity: string | null
    rarityCode: string | null
    category: string | null
    sortOrder: number
    printings: CollectionPrinting[]
}

export interface CollectionStats {
    printingsOwned: number
    printingsTotal: number
    cardsOwnedAnyFinish: number
    cardsTotal: number
}

export interface CollectionPayload {
    cards: CollectionCard[]
    stats: CollectionStats
}

export interface OpenedPackResult {
    packId: string
    isGod: boolean
    cards: OpenedPackCard[]
}

// ── Admin set detail payload ────────────────────────────────────────────────
// Row shapes exactly as returned by GET /api/tcg/admin/sets/detail?id=… —
// raw table rows (secretKey stripped via serializeSet), with timestamp
// columns serialized to ISO strings on the wire.

export interface TcgAdminSet {
    id: string
    name: string
    code: string
    plaatjesSetCode: string | null
    releaseDate: string | null
    status: TcgSetStatus
    targetPackCount: number | null
    godPackOneIn: number | null
    godPackCount: number | null
    commitmentDigest: string | null
    /** Non-null when the set was created from a scraped rate template. */
    templateCode: string | null
    packsSold: number
    basePacksSold: number
    godPacksSold: number
    /** Size of the restock pool — contents never leave the server. */
    restockCount: number
    createdAt: string
    updatedAt: string
}

export interface TcgAdminCard {
    id: string
    setId: string
    plaatjesBaseId: string
    number: string
    setTotal: number | null
    name: string
    rarity: string | null
    rarityCode: string | null
    category: string | null
    sortOrder: number
    raw: Record<string, unknown>
}

export interface TcgAdminPrinting {
    id: string
    setId: string
    cardId: string
    plaatjesCardId: string
    finish: TcgFinish
    pattern: string | null
    printRunLabel: string
    bundle: string | null
    assetNumber: string | null
    maskKind: string | null
    foilEffect: string | null
    foilMask: string | null
}

export interface TcgAdminSheet {
    id: string
    setId: string
    name: string
    role: TcgSheetRole
    packSlots: number
    layout: string[]
    sortOrder: number
    impressions: number | null
    cursor: number
    cursorLimit: number | null
}

export interface TcgAdminTemplate {
    id: string
    setId: string
    kind: TcgPackKind
    slots: PackTemplateSlot[]
}

export interface TcgSetDetailPayload {
    /** Detail additionally carries the full scraped rate template (public data). */
    set: TcgAdminSet & { publishedRates: RateTemplate | null }
    cards: TcgAdminCard[]
    printings: TcgAdminPrinting[]
    sheets: TcgAdminSheet[]
    templates: TcgAdminTemplate[]
}

// ── Sidecar catalogue (admin harnesses) ─────────────────────────────────────
// The pokemonplaatjes sidecar knows every set it can render, imported or not.
// These are read-only previews — nothing behind them writes to the database.

/** One set from GET /api/tcg/admin/plaatjes/sets. */
export interface TcgPlaatjesSet {
    setCode: string
    /** Falls back to `setCode` when pull-rates has no name for it. */
    name: string
    seriesCode: string | null
    cards: number | null
}

export interface TcgPlaatjesSetsPayload {
    sets: TcgPlaatjesSet[]
    /** Present only when the sidecar could not be reached. */
    sidecarUnavailable?: true
}

/**
 * GET /api/tcg/admin/plaatjes/checklist — the same row shapes the admin set
 * detail serves, carrying a placeholder setId because nothing was inserted.
 */
export interface TcgPlaatjesChecklistPayload {
    cards: TcgAdminCard[]
    printings: TcgAdminPrinting[]
}

// ── Grading (§6.4 / §6.5) ───────────────────────────────────────────────────

export interface TcgGradePayload {
    service: string
    grade: string
    score: number | null
    designation: string | null
    /** CCC/BRK: 4 category grades; GAG: 8 face grades. Absent for PSI. */
    subGrades: Record<string, number> | null
    /** GAG only: the defect map — flaws whose healing would raise the grade. */
    flaws: Array<{ id: string, category: number, severity: number }> | null
    certNumber: string
    gradedAt: string
}

export interface TcgSubmissionSummary {
    id: string
    copyId: string
    service: string
    /** Coins paid on submission. */
    fee: number
    predictedGrade: string | null
    state: string
    submittedAt: string
    returnsAt: string
    /** Turnaround elapsed — the collect button lights up. */
    ready: boolean
    serial: string
    card: {
        name: string
        rarity: string | null
        number: string
        setTotal: number | null
        setName: string
        setCode: string
        releaseDate: string | null
    }
    render: {
        bundle: string | null
        assetNumber: string | null
        maskKind: string | null
        foilEffect: string | null
        pattern: string | null
        finish: string
        plaatjesCardId: string
    }
    /** Present once collected. */
    grade: TcgGradePayload | null
}

export interface TcgPopReportRow {
    printingId: string
    cardName: string
    finish: string
    pattern: string | null
    rarity: string | null
    service: string
    grade: string
    designation: string | null
    count: number
}

// ── Marketplace (§7) ────────────────────────────────────────────────────────

export interface TcgListingSummary {
    id: string
    copyId: string
    price: number
    /** Seller's free-text condition claim — carries no authority (§7.1). */
    note: string | null
    sellerId: string
    sellerName: string
    createdAt: string
    serial: string
    printingId: string
    card: {
        name: string
        rarity: string | null
        number: string
        setTotal: number | null
        setName: string
        setCode: string
        releaseDate: string | null
    }
    render: {
        bundle: string | null
        assetNumber: string | null
        maskKind: string | null
        foilEffect: string | null
        pattern: string | null
        finish: string
        plaatjesCardId: string
    }
    /** Present when the listed copy is slabbed. */
    grade: TcgGradePayload | null
}

export interface TcgSaleRow {
    price: number
    soldAt: string
    /** Grade snapshot at sale time; null = sold raw ("condition unknown"). */
    gradeService: string | null
    grade: string | null
    designation: string | null
    sellerName: string
    buyerName: string
}

export interface TcgChainEntry {
    kind: 'mint' | 'sale'
    userName: string
    price: number | null
    at: string
}
