import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoPlants, xenoPlantsUnlocked } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import {
  rollHybrid, makeHybridTypeId, enrichHybridResources, hybridGemCost,
  hybridTierFromUnlocked, HYBRID_UNLOCK_TIER,
} from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const userId = session.user.id

  // Hybrid tier = highest tier where the player has unlocked EVERY plant.
  // Uses the permanent xenoPlantsUnlocked table, not current inventory, so
  // selling/breeding away every instance never re-locks a discovered plant.
  const unlockedRows = await db.query.xenoPlantsUnlocked.findMany({ where: eq(xenoPlantsUnlocked.userId, userId) })
  const realTypeIds = [...new Set(unlockedRows.map(r => r.typeId))]
  const hybridTier = hybridTierFromUnlocked(realTypeIds)
  if (hybridTier < HYBRID_UNLOCK_TIER) {
    throw createError({ statusCode: 403, statusMessage: `Unlock all T${HYBRID_UNLOCK_TIER} plants to access the Hybrid vendor` })
  }

  // Recompute the gem cost server-side (flat, tier-based — no gem market involved).
  const costGems = hybridGemCost(hybridTier)

  const roll = rollHybrid(hybridTier)

  // A single-resource roll isn't a hybrid — just grant that plant (at its rolled
  // stats) so it doesn't clutter the inventory with a one-resource vessel.
  const single = roll.resources.length === 1
  const only = roll.resources[0]!

  // Hybrid rows carry speed=0/yield=0; the real stats live per-resource in typeId.
  const typeId = single ? only.id : makeHybridTypeId(roll.resources)
  const speed = single ? only.speed : 0
  const yieldLevel = single ? only.yield : 0

  await db.transaction(async (tx) => {
    await debitGems(userId, costGems, tx)
    await tx.insert(xenoPlants).values({ userId, typeId, speed, yield: yieldLevel })
  })

  return {
    costGems,
    result: {
      isHybrid: !single,
      typeId,
      speed,
      yield: yieldLevel,
      resources: enrichHybridResources(roll.resources),
    },
  }
})
