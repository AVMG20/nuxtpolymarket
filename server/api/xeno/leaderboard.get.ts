import { db } from '#server/database'
import { auth } from '#server/utils/auth'
import { user, xenoPlants, xenoPlantsUnlocked, xenoArtifacts, xenoGridSlots, xenoBreederSlots } from '#server/database/schema'
import { getPlantDisplay, PLANT_TYPES } from '#shared/utils/xeno'

// Xenopedia only counts real plant species, not hybrids (hybrid typeIds don't
// appear in PLANT_TYPES). Mirror that here so the leaderboard matches the
// Xenopedia's discovered count.
const SPECIES_IDS = new Set(PLANT_TYPES.map(p => p.id))

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  const [users, allPlants, allUnlocked, allArtifacts, allGridSlots, allBreederSlots] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user),
    db.select({ userId: xenoPlants.userId, typeId: xenoPlants.typeId }).from(xenoPlants),
    db.select({ userId: xenoPlantsUnlocked.userId, typeId: xenoPlantsUnlocked.typeId }).from(xenoPlantsUnlocked),
    db.select({ userId: xenoArtifacts.userId }).from(xenoArtifacts),
    db.select({ userId: xenoGridSlots.userId }).from(xenoGridSlots),
    db.select({ userId: xenoBreederSlots.userId }).from(xenoBreederSlots),
  ])

  const plantsByUser = new Map<string, { typeId: string }[]>()
  for (const p of allPlants) {
    if (!plantsByUser.has(p.userId)) plantsByUser.set(p.userId, [])
    plantsByUser.get(p.userId)!.push({ typeId: p.typeId })
  }

  const unlockedByUser = new Map<string, Set<string>>()
  for (const u of allUnlocked) {
    if (!SPECIES_IDS.has(u.typeId)) continue
    if (!unlockedByUser.has(u.userId)) unlockedByUser.set(u.userId, new Set())
    unlockedByUser.get(u.userId)!.add(u.typeId)
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
      const speciesUnlocked = unlockedByUser.get(u.id)?.size ?? 0
      const portfolioValue = plants.reduce((sum, p) => sum + (getPlantDisplay(p.typeId)?.value ?? 0), 0)
      return {
        isCurrentUser: u.id === session?.user?.id,
        name: u.name,
        speciesUnlocked,
        plantCount: plants.length,
        portfolioValue,
        gridSlots: gridSlotCountByUser.get(u.id) ?? 0,
        breederSlots: breederSlotCountByUser.get(u.id) ?? 0,
        artifactCount: artifactCountByUser.get(u.id) ?? 0,
      }
    })
    .sort((a, b) => b.speciesUnlocked - a.speciesUnlocked || b.plantCount - a.plantCount)
})
