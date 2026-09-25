import { and, count, desc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { neighcassoHorses, user } from '#server/database/schema'
import { parseDrawing, parseHorseName } from '#shared/utils/neighcasso/drawing'
import { NC_MAX_HORSES_PER_USER } from '#shared/utils/neighcasso/types'
import type { NcDrawing, NcHorse, NcSharedHorse } from '#shared/utils/neighcasso/types'

type HorseRow = typeof neighcassoHorses.$inferSelect

export function toHorse(row: HorseRow): NcHorse {
    return {
        id: row.id,
        name: row.name,
        drawing: row.drawing,
        wins: row.wins,
        races: row.races,
        rev: row.updatedAt.getTime()
    }
}

/** A validated `{ name, drawing }` body, or a 400. */
export function parseHorseBody(body: unknown): { name: string, drawing: NcDrawing } {
    const raw = (body ?? {}) as { name?: unknown, drawing?: unknown }
    const name = parseHorseName(raw.name)
    if (!name) throw createError({ statusCode: 400, statusMessage: 'Give your horse a name' })
    const drawing = parseDrawing(raw.drawing)
    if (typeof drawing === 'string') throw createError({ statusCode: 400, statusMessage: drawing })
    return { name, drawing }
}

export async function listHorses(userId: string): Promise<NcHorse[]> {
    const rows = await db.select().from(neighcassoHorses)
        .where(eq(neighcassoHorses.userId, userId))
        .orderBy(desc(neighcassoHorses.updatedAt))
        .limit(NC_MAX_HORSES_PER_USER)
    return rows.map(toHorse)
}

export async function createHorse(userId: string, name: string, drawing: NcDrawing): Promise<NcHorse> {
    const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(neighcassoHorses)
        .where(eq(neighcassoHorses.userId, userId))
    if (total >= NC_MAX_HORSES_PER_USER) {
        throw createError({ statusCode: 400, statusMessage: `Your stable is full (${NC_MAX_HORSES_PER_USER} horses)` })
    }
    const [row] = await db.insert(neighcassoHorses).values({ userId, name, drawing }).returning()
    return toHorse(row!)
}

export async function getOwnHorse(userId: string, id: string): Promise<HorseRow | null> {
    const [row] = await db.select().from(neighcassoHorses)
        .where(and(eq(neighcassoHorses.id, id), eq(neighcassoHorses.userId, userId)))
        .limit(1)
    return row ?? null
}

export async function getSharedHorse(viewerId: string, id: string): Promise<NcSharedHorse | null> {
    const [row] = await db.select({ horse: neighcassoHorses, ownerName: user.name })
        .from(neighcassoHorses)
        .innerJoin(user, eq(user.id, neighcassoHorses.userId))
        .where(eq(neighcassoHorses.id, id))
        .limit(1)
    if (!row) return null
    return { ...toHorse(row.horse), ownerName: row.ownerName, mine: row.horse.userId === viewerId }
}
