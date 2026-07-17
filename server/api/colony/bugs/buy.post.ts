import { requireUserId } from '#server/utils/auth'
import { settleColony, addBug, getResearchLevel } from '#server/utils/colony'
import { debit } from '#server/utils/balance'
import { getBug, rollTraitPct, rollYieldLevel, rollEatRate } from '#shared/utils/colony'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ typeId: string }>(event)
  const userId = await requireUserId(event)

  const type = getBug(body.typeId)
  if (!type) throw createError({ statusCode: 400, statusMessage: `Unknown bug type: ${body.typeId}` })

  const state = await settleColony(userId)

  if (type.tier > state.habitatLevel) {
    throw createError({ statusCode: 403, statusMessage: `${type.name} requires Habitat Level ${type.tier} — upgrade your habitat first.` })
  }

  // The roll range for both speed and yield is driven by this species'
  // Research level (see rollTraitPct/rollYieldLevel) — sacrificing bugs of
  // this type on the Research page is the only way to raise it.
  const researchLevel = await getResearchLevel(userId, type.id)

  // bought bugs land in inventory, unplaced — no capacity check here, that
  // only applies when placing a bug into the terrarium
  await debit(userId, type.spawnCost.toFixed(4), 'colony')
  const bug = await addBug(userId, type.id, rollTraitPct(researchLevel), rollYieldLevel(researchLevel), rollEatRate(type))

  return { ok: true, speed: bug.speed, yield: bug.yield, eat: bug.eat }
})
