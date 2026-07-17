import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents, hackState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit, debitGems } from '#server/utils/balance'
import {
  AGENT_PULL_TIERS, rollRarity, generateAgentDef,
  RARITY_LABEL, MAX_AGENTS,
} from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { tierId } = await readBody(event) as { tierId: string }
  const tier = AGENT_PULL_TIERS.find(t => t.id === tierId)
  if (!tier) throw createError({ statusCode: 400, statusMessage: 'Unknown recruit tier' })

  const [currentAgents, state] = await Promise.all([
    db.query.hackAgents.findMany({ where: eq(hackAgents.userId, userId) }),
    db.query.hackState.findFirst({ where: eq(hackState.userId, userId) }),
  ])

  if (!state) throw createError({ statusCode: 400, statusMessage: 'Hack ops not initialized' })
  if (currentAgents.length >= MAX_AGENTS)
    throw createError({ statusCode: 400, statusMessage: `Storage full (${MAX_AGENTS} agents). Fire someone first.` })

  // New agents join the active roster if there's a free active slot, otherwise
  // they land in storage (inactive) and can be activated later.
  const activeCount = currentAgents.filter(a => a.active).length
  const active = activeCount < state.rosterSlots

  const cost = tier.cost

  if (tier.currency === 'cash') {
    await debit(userId, cost.toFixed(4), 'HackOps')
  } else {
    await debitGems(userId, cost)
  }

  const takenNames = currentAgents.map(a => a.name)
  const rarity = rollRarity(tier.weights)
  const def = generateAgentDef(rarity, takenNames)

  await db.update(hackState)
    .set({ totalRecruits: sql`${hackState.totalRecruits} + 1` })
    .where(eq(hackState.userId, userId))

  const [agent] = await db.insert(hackAgents).values({ userId, ...def, active }).returning()
  return { agent, rarity, rarityLabel: RARITY_LABEL[rarity], active }
})
