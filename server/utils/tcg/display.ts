import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgDisplay, tcgDisplaySlot, tcgCopy, tcgPrinting, tcgCard, tcgSet, tcgSheet } from '#server/database/schema'
import { TCG_DISPLAY, isValidCapacity } from '#shared/utils/tcg/display'
import type { TcgDisplayKind } from '#shared/utils/tcg/display'
import type { TcgGradePayload } from '#shared/types/tcg'

/*
 * Displays (§10.5): binders present raw cards, shelves present slabs. A
 * display holds COPIES, not printings — pocket 14 holds that exact card.
 * Nothing here encumbers a copy: selling, trading or grading a displayed
 * card just works, and the pocket empties lazily on the next read. The one
 * hard rule is physical: a copy sits in at most one pocket anywhere,
 * enforced by the unique(copy_id) constraint rather than a check.
 */

const badRequest = (statusMessage: string): never => {
    throw createError({ statusCode: 400, statusMessage })
}

const LIFECYCLE_FOR: Record<TcgDisplayKind, string> = { binder: 'raw', shelf: 'slabbed' }

export interface DisplaySummary {
    id: string
    kind: TcgDisplayKind
    name: string
    capacity: number
    filled: number
    cover: { bundle: string | null, plaatjesCardId: string, assetNumber: string | null } | null
}

export async function createDisplay(userId: string, kind: TcgDisplayKind, name: string) {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > TCG_DISPLAY.nameMaxLength) badRequest('Name must be 1-40 characters')
    return await db.transaction(async (tx) => {
        const [counted] = await tx.select({ n: count() }).from(tcgDisplay).where(eq(tcgDisplay.userId, userId))
        if ((counted?.n ?? 0) >= TCG_DISPLAY.maxPerUser) badRequest('Too many displays')
        const [row] = await tx.insert(tcgDisplay).values({
            userId,
            kind,
            name: trimmed,
            capacity: TCG_DISPLAY[kind].defaultCapacity
        }).returning()
        return row!
    })
}

export async function deleteDisplay(userId: string, displayId: string): Promise<void> {
    const [deleted] = await db.delete(tcgDisplay)
        .where(and(eq(tcgDisplay.id, displayId), eq(tcgDisplay.userId, userId)))
        .returning()
    if (!deleted) badRequest('Display is not yours to delete')
}

export interface SaveDisplayInput {
    name?: string
    capacity?: number
    /** The full layout: position i holds slots[i], null = empty pocket. */
    slots: (string | null)[]
}

export async function saveDisplay(userId: string, displayId: string, input: SaveDisplayInput) {
    return await db.transaction(async (tx) => {
        const [display] = await tx.select().from(tcgDisplay)
            .where(and(eq(tcgDisplay.id, displayId), eq(tcgDisplay.userId, userId)))
            .for('update')
        if (!display) badRequest('Display is not yours to edit')
        const kind = display!.kind as TcgDisplayKind

        const capacity = input.capacity ?? display!.capacity
        if (!isValidCapacity(kind, capacity)) badRequest('Invalid capacity')
        if (input.slots.length > capacity) badRequest('Layout exceeds capacity')

        const name = input.name?.trim() ?? display!.name
        if (!name || name.length > TCG_DISPLAY.nameMaxLength) badRequest('Name must be 1-40 characters')

        const copyIds = input.slots.filter((id): id is string => id !== null)
        if (new Set(copyIds).size !== copyIds.length) badRequest('A card can only sit in one pocket')

        if (copyIds.length > 0) {
            const owned = await tx.select({ id: tcgCopy.id }).from(tcgCopy)
                .where(and(
                    inArray(tcgCopy.id, copyIds),
                    eq(tcgCopy.ownerId, userId),
                    eq(tcgCopy.lifecycle, LIFECYCLE_FOR[kind])
                ))
            if (owned.length !== copyIds.length) {
                badRequest(kind === 'binder'
                    ? 'Binders hold your raw cards only'
                    : 'Shelves hold your slabs only')
            }
        }

        await tx.delete(tcgDisplaySlot).where(eq(tcgDisplaySlot.displayId, displayId))
        if (copyIds.length > 0) {
            const values = input.slots
                .map((copyId, position) => ({ displayId, position, copyId: copyId! }))
                .filter(slot => slot.copyId !== null)
            try {
                await tx.insert(tcgDisplaySlot).values(values)
            } catch (error) {
                // unique(copy_id): the card already sits in another display.
                // Drizzle wraps the pg error, so look at the cause chain too.
                const cause = (error as { cause?: { constraint?: string } }).cause
                if (cause?.constraint === 'tcg_display_slots_copy_unique') {
                    badRequest('A card is already in another display')
                }
                throw error
            }
        }

        await tx.update(tcgDisplay)
            .set({ name, capacity, updatedAt: sql`now()` })
            .where(eq(tcgDisplay.id, displayId))
        return { ok: true as const }
    })
}

/** All of a player's displays — visible to any logged-in viewer (§10.5). */
export async function listDisplays(ownerId: string): Promise<DisplaySummary[]> {
    const displays = await db.select().from(tcgDisplay)
        .where(eq(tcgDisplay.userId, ownerId))
        .orderBy(asc(tcgDisplay.createdAt))
    if (displays.length === 0) return []

    const slots = await db.select({
        displayId: tcgDisplaySlot.displayId,
        position: tcgDisplaySlot.position,
        bundle: tcgPrinting.bundle,
        plaatjesCardId: tcgPrinting.plaatjesCardId,
        assetNumber: tcgPrinting.assetNumber,
        ownerId: tcgCopy.ownerId,
        lifecycle: tcgCopy.lifecycle
    })
        .from(tcgDisplaySlot)
        .innerJoin(tcgCopy, eq(tcgDisplaySlot.copyId, tcgCopy.id))
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .where(inArray(tcgDisplaySlot.displayId, displays.map(display => display.id)))
        .orderBy(asc(tcgDisplaySlot.position))

    return displays.map((display) => {
        const live = slots.filter(slot =>
            slot.displayId === display.id
            && slot.ownerId === ownerId
            && slot.lifecycle === LIFECYCLE_FOR[display.kind as TcgDisplayKind])
        return {
            id: display.id,
            kind: display.kind as TcgDisplayKind,
            name: display.name,
            capacity: display.capacity,
            filled: live.length,
            cover: live[0]
                ? { bundle: live[0].bundle, plaatjesCardId: live[0].plaatjesCardId, assetNumber: live[0].assetNumber }
                : null
        }
    })
}

export interface DisplaySlotView {
    position: number
    copyId: string
    cardName: string
    serial: string
    finish: string
    pattern: string | null
    printRunLabel: string
    bundle: string | null
    plaatjesCardId: string
    assetNumber: string | null
    maskKind: string | null
    foilEffect: string | null
    rarity: string | null
    cardNumber: string | null
    setTotal: number | null
    setName: string | null
    setCode: string | null
    releaseDate: string | null
    gradeService: string | null
    grade: string | null
    gradeDesignation: string | null
    /** Full public grade payload for slabs — reports are public (§10.4). */
    gradePayload: TcgGradePayload | null
}

export interface DisplayView {
    id: string
    ownerId: string
    ownerName: string
    kind: TcgDisplayKind
    name: string
    capacity: number
    slots: DisplaySlotView[]
}

/**
 * One display, readable by any logged-in user. Pockets whose copy moved on
 * (sold, traded, graded, cracked) are dropped here rather than by hooks in
 * the market code — the layout self-heals on the next view. Copy rows are
 * projected to public columns only; condition never leaves the server (§6.1).
 */
export async function getDisplay(displayId: string): Promise<DisplayView> {
    const [display] = await db.select({
        id: tcgDisplay.id,
        userId: tcgDisplay.userId,
        kind: tcgDisplay.kind,
        name: tcgDisplay.name,
        capacity: tcgDisplay.capacity,
        ownerName: sql<string>`(select name from "user" where id = ${tcgDisplay.userId})`
    })
        .from(tcgDisplay)
        .where(eq(tcgDisplay.id, displayId))
    if (!display) throw createError({ statusCode: 404, statusMessage: 'Display not found' })

    const rows = await db.select({
        position: tcgDisplaySlot.position,
        copyId: tcgCopy.id,
        ownerId: tcgCopy.ownerId,
        lifecycle: tcgCopy.lifecycle,
        cutIndex: tcgCopy.cutIndex,
        slotOffset: tcgCopy.slotOffset,
        gradeService: tcgCopy.gradeService,
        grade: tcgCopy.grade,
        gradeDesignation: tcgCopy.gradeDesignation,
        gradeScore: tcgCopy.gradeScore,
        gradeSubs: tcgCopy.gradeSubs,
        gradeFlaws: tcgCopy.gradeFlaws,
        certNumber: tcgCopy.certNumber,
        gradedAt: tcgCopy.gradedAt,
        sheetName: tcgSheet.name,
        packSlots: tcgSheet.packSlots,
        cardName: tcgCard.name,
        rarity: tcgCard.rarity,
        cardNumber: tcgCard.number,
        setTotal: tcgCard.setTotal,
        finish: tcgPrinting.finish,
        pattern: tcgPrinting.pattern,
        printRunLabel: tcgPrinting.printRunLabel,
        bundle: tcgPrinting.bundle,
        plaatjesCardId: tcgPrinting.plaatjesCardId,
        assetNumber: tcgPrinting.assetNumber,
        maskKind: tcgPrinting.maskKind,
        foilEffect: tcgPrinting.foilEffect,
        setName: tcgSet.name,
        setCode: tcgSet.code,
        releaseDate: tcgSet.releaseDate
    })
        .from(tcgDisplaySlot)
        .innerJoin(tcgCopy, eq(tcgDisplaySlot.copyId, tcgCopy.id))
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .innerJoin(tcgSheet, eq(tcgCopy.sheetId, tcgSheet.id))
        .innerJoin(tcgSet, eq(tcgCopy.setId, tcgSet.id))
        .where(eq(tcgDisplaySlot.displayId, displayId))
        .orderBy(asc(tcgDisplaySlot.position))

    const kind = display!.kind as TcgDisplayKind
    const slots = rows
        .filter(row => row.ownerId === display!.userId && row.lifecycle === LIFECYCLE_FOR[kind])
        .map((row): DisplaySlotView => ({
            position: row.position,
            copyId: row.copyId,
            cardName: row.cardName,
            serial: `${row.sheetName} #${row.cutIndex * row.packSlots + row.slotOffset + 1}`,
            finish: row.finish,
            pattern: row.pattern,
            printRunLabel: row.printRunLabel,
            bundle: row.bundle,
            plaatjesCardId: row.plaatjesCardId,
            assetNumber: row.assetNumber,
            maskKind: row.maskKind,
            foilEffect: row.foilEffect,
            rarity: row.rarity,
            cardNumber: row.cardNumber,
            setTotal: row.setTotal,
            setName: row.setName,
            setCode: row.setCode,
            releaseDate: row.releaseDate,
            gradeService: row.gradeService,
            grade: row.grade,
            gradeDesignation: row.gradeDesignation,
            gradePayload: row.grade && row.gradeService && row.certNumber && row.gradedAt
                ? {
                        service: row.gradeService,
                        grade: row.grade,
                        score: row.gradeScore,
                        designation: row.gradeDesignation,
                        subGrades: row.gradeSubs,
                        flaws: row.gradeFlaws,
                        certNumber: row.certNumber,
                        gradedAt: row.gradedAt.toISOString()
                    }
                : null
        }))

    return {
        id: display!.id,
        ownerId: display!.userId,
        ownerName: display!.ownerName,
        kind,
        name: display!.name,
        capacity: display!.capacity,
        slots
    }
}

export interface DisplayCandidate {
    copyId: string
    cardName: string
    serial: string
    finish: string
    pattern: string | null
    bundle: string | null
    plaatjesCardId: string
    assetNumber: string | null
    setName: string
    gradeService: string | null
    grade: string | null
    /** Which display currently holds this copy, if any. */
    displayId: string | null
}

/** The owner's placeable copies for a display kind, across all sets. */
export async function displayCandidates(userId: string, kind: TcgDisplayKind): Promise<DisplayCandidate[]> {
    const rows = await db.select({
        copyId: tcgCopy.id,
        cardName: tcgCard.name,
        cutIndex: tcgCopy.cutIndex,
        slotOffset: tcgCopy.slotOffset,
        sheetName: tcgSheet.name,
        packSlots: tcgSheet.packSlots,
        finish: tcgPrinting.finish,
        pattern: tcgPrinting.pattern,
        bundle: tcgPrinting.bundle,
        plaatjesCardId: tcgPrinting.plaatjesCardId,
        assetNumber: tcgPrinting.assetNumber,
        setName: tcgSet.name,
        gradeService: tcgCopy.gradeService,
        grade: tcgCopy.grade,
        displayId: tcgDisplaySlot.displayId
    })
        .from(tcgCopy)
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .innerJoin(tcgSheet, eq(tcgCopy.sheetId, tcgSheet.id))
        .innerJoin(tcgSet, eq(tcgCopy.setId, tcgSet.id))
        .leftJoin(tcgDisplaySlot, eq(tcgDisplaySlot.copyId, tcgCopy.id))
        .where(and(
            eq(tcgCopy.ownerId, userId),
            eq(tcgCopy.lifecycle, LIFECYCLE_FOR[kind])
        ))
        .orderBy(asc(tcgCard.name))
        .limit(500)
    return rows.map(row => ({
        copyId: row.copyId,
        cardName: row.cardName,
        serial: `${row.sheetName} #${row.cutIndex * row.packSlots + row.slotOffset + 1}`,
        finish: row.finish,
        pattern: row.pattern,
        bundle: row.bundle,
        plaatjesCardId: row.plaatjesCardId,
        assetNumber: row.assetNumber,
        setName: row.setName,
        gradeService: row.gradeService,
        grade: row.grade,
        displayId: row.displayId
    }))
}
