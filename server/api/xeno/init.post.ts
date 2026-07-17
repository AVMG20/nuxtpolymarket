import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { xenoGridSlots, xenoBreederSlots } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { addPlants } from '#server/utils/xeno'
import { getPlantOrThrow } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const existing = await db.query.xenoGridSlots.findFirst({ where: eq(xenoGridSlots.userId, userId) })
  if (existing) return { ok: true }

  const sprout = getPlantOrThrow('sprout')
  const tendril = getPlantOrThrow('tendril')

  await Promise.all([
    // Unlock first 6 grid slots
    ...Array.from({ length: 6 }, (_, i) => db.insert(xenoGridSlots).values({ userId, slotIndex: i })),
    // Unlock first breeder slot
    db.insert(xenoBreederSlots).values({ userId, slotIndex: 0 }),
    // Give 4 sprouts and 4 tendrils at base stats
    addPlants(userId, sprout.id, sprout.speed, sprout.yield, 4),
    addPlants(userId, tendril.id, tendril.speed, tendril.yield, 4),
  ])

  return { ok: true }
})
