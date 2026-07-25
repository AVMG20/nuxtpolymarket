import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { voidState, voidWeapons } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { getLockedVoidState } from '#server/utils/void'
import {
    VOID_RARITIES, VOID_SPECIALS, rollVoidWeapon, voidAffix, voidCanAfford, voidSubtractBundle,
    type VoidAffixId, type VoidRarityId
} from '#shared/utils/gamelogic/void'

/** A runner can only physically store so many turrets before the hangar objects. */
const VOID_MAX_OWNED_WEAPONS = 60

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const rarity = VOID_RARITIES.find(r => r.id === body?.rarityId)
    if (!rarity) throw createError({ statusCode: 400, statusMessage: 'Invalid rarity' })

    return db.transaction(async (tx) => {
        const s = await getLockedVoidState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Dock before refitting' })

        const owned = await tx.query.voidWeapons.findMany({ where: eq(voidWeapons.userId, userId) })
        if (owned.length >= VOID_MAX_OWNED_WEAPONS) {
            throw createError({ statusCode: 400, statusMessage: 'Turret storage is full — strip something first' })
        }

        const held = s.resources ?? {}
        if (!voidCanAfford(held, rarity.cost.resources)) throw createError({ statusCode: 400, statusMessage: 'Not enough resources' })

        await debit(userId, rarity.cost.credits.toFixed(4), 'void', tx)
        await tx.update(voidState)
            .set({ resources: voidSubtractBundle(held, rarity.cost.resources) as Record<string, number> })
            .where(eq(voidState.userId, userId))

        // Rolled server-side with the CSPRNG — the client never gets a say in
        // what a 850k-credit unique turns out to be.
        const rolled = rollVoidWeapon(rarity.id as VoidRarityId)
        const [created] = await tx.insert(voidWeapons).values({
            userId,
            rarityId: rolled.rarityId,
            name: rolled.name,
            affixes: rolled.affixes as Record<string, number>,
            specialId: rolled.specialId,
            slotIndex: null
        }).returning()

        return {
            weapon: {
                ...created!,
                rarity,
                special: VOID_SPECIALS.find(sp => sp.id === rolled.specialId) ?? null,
                affixLines: (Object.entries(rolled.affixes) as [VoidAffixId, number][])
                    .map(([id, value]) => ({ id, name: voidAffix(id).name, text: voidAffix(id).describe(value), value }))
            }
        }
    })
})
