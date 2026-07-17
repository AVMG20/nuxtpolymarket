import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState, pirateCannons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

// Swap the cannons mounted in two gun ports (either may be empty — swapping
// with an empty port is a move). Free, unlike sell+rebuy.
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const slotA = Number(body?.slotA)
    const slotB = Number(body?.slotB)

    const s = await db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
    if (!s) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
    if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot refit mid-voyage' })

    for (const slot of [slotA, slotB]) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= s.cannonSlots) {
            throw createError({ statusCode: 400, statusMessage: 'Gun port not unlocked' })
        }
    }
    if (slotA === slotB) throw createError({ statusCode: 400, statusMessage: 'Pick two different ports' })

    const [cannonA, cannonB] = await Promise.all([
        db.query.pirateCannons.findFirst({ where: and(eq(pirateCannons.userId, userId), eq(pirateCannons.slotIndex, slotA)) }),
        db.query.pirateCannons.findFirst({ where: and(eq(pirateCannons.userId, userId), eq(pirateCannons.slotIndex, slotB)) })
    ])
    if (!cannonA && !cannonB) throw createError({ statusCode: 400, statusMessage: 'Both ports are empty' })

    // Three steps via a parking slot so the (userId, slotIndex) unique
    // constraint never sees both rows on the same index mid-swap.
    await db.transaction(async (tx) => {
        if (cannonA && cannonB) {
            await tx.update(pirateCannons).set({ slotIndex: -1 }).where(eq(pirateCannons.id, cannonA.id))
            await tx.update(pirateCannons).set({ slotIndex: slotA }).where(eq(pirateCannons.id, cannonB.id))
            await tx.update(pirateCannons).set({ slotIndex: slotB }).where(eq(pirateCannons.id, cannonA.id))
        } else if (cannonA) {
            await tx.update(pirateCannons).set({ slotIndex: slotB }).where(eq(pirateCannons.id, cannonA.id))
        } else if (cannonB) {
            await tx.update(pirateCannons).set({ slotIndex: slotA }).where(eq(pirateCannons.id, cannonB.id))
        }
    })

    return { slotA, slotB }
})
