import { db } from '#server/database'
import { user, xenoPlants, xenoArtifacts, xenoGridSlots, xenoBreederSlots } from '#server/database/schema'
import { getPlant } from '#shared/utils/xeno'

export default defineEventHandler(async () => {
  const [users, allPlants, allArtifacts, allGridSlots, allBreederSlots] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user),
    db.select({ userId: xenoPlants.userId, typeId: xenoPlants.typeId }).from(xenoPlants),
    db.select({ userId: xenoArtifacts.userId }).from(xenoArtifacts),
    db.select({ userId: xenoGridSlots.userId }).from(xenoGridSlots),
    db.select({ userId: xenoBreederSlots.userId }).from(xenoBreederSlots),
  ])

  const plantsByUser = new Map<string, { typeId: string }[]>()
  for (const p of allPlants) {
    if (!plantsByUser.has(p.userId)) plantsByUser.set(p.userId, [])
    plantsByUser.get(p.userId)!.push({ typeId: p.typeId })
  }

  const artifactCountByUser = new Map<string, number>()
  for (const a of allArtifacts) {
    artifactCountByUser.set(a.userId, (artifactCountByUser.get(a.userId) ?? 0) + 1)
  }

  const gridSlotCountByUser = new Map<string, number>()
  for (const g of allGridSlots) {
    gridSlotCountByUser.set(g.userId, (gridSlotCountByUser.get(g.userId) ?? 0) + 1)
  }

  const breederSlotCountByUser = new Map<string, number>()
  for (const b of allBreederSlots) {
    breederSlotCountByUser.set(b.userId, (breederSlotCountByUser.get(b.userId) ?? 0) + 1)
  }

  return users
    .filter(u => gridSlotCountByUser.has(u.id))
    .map(u => {
      const plants = plantsByUser.get(u.id) ?? []
      const speciesSet = new Set(plants.map(p => p.typeId))
      const portfolioValue = plants.reduce((sum, p) => sum + (getPlant(p.typeId)?.value ?? 0), 0)
      return {
        id: u.id,
        name: u.name,
        speciesUnlocked: speciesSet.size,
        plantCount: plants.length,
        portfolioValue,
        gridSlots: gridSlotCountByUser.get(u.id) ?? 0,
        breederSlots: breederSlotCountByUser.get(u.id) ?? 0,
        artifactCount: artifactCountByUser.get(u.id) ?? 0,
      }
    })
    .sort((a, b) => b.speciesUnlocked - a.speciesUnlocked || b.plantCount - a.plantCount)
})
