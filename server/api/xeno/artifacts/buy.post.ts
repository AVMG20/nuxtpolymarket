import { db } from '#server/database'
import { xenoArtifacts } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debitGems } from '#server/utils/balance'
import { consumePlantsByType } from '#server/utils/xeno'
import { getArtifactOrThrow, gemCraftCost } from '#shared/utils/xeno'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ artifactTypeId: string; gemCrafted?: boolean; quantity?: number }>(event)
  const userId = await requireUserId(event)

  const artType = getArtifactOrThrow(body.artifactTypeId)
  const gemCrafted = body.gemCrafted === true

  const count = body.quantity ?? 1
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw createError({ statusCode: 400, statusMessage: 'Provide quantity (1–50)' })
  }

  // One transaction so a failed plant check rolls the gem debit back — before,
  // gems were spent first and a missing ingredient left them gone for nothing.
  const artifacts = await db.transaction(async (tx) => {
    // Artifact costs consume any plant of the given typeId (speed/yield don't matter for crafting)
    for (const { plantTypeId, quantity } of artType.cost) {
      await consumePlantsByType(userId, plantTypeId, quantity * count, tx)
    }
    // Throws 400 if the user can't afford the gem craft.
    if (gemCrafted) await debitGems(userId, gemCraftCost(artType) * count, tx)

    return tx.insert(xenoArtifacts)
      .values(Array.from({ length: count }, () => ({
        userId,
        typeId: artType.id,
        chargesRemaining: artType.maxCharges,
        gemCrafted
      })))
      .returning()
  })

  return {
    crafted: artifacts.length,
    artifactIds: artifacts.map(a => a.id),
    artifactId: artifacts[0]!.id,
    chargesRemaining: artifacts[0]!.chargesRemaining,
    gemCrafted: artifacts[0]!.gemCrafted
  }
})
