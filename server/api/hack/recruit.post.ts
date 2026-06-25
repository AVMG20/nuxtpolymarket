import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents, hackState, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import {
  AGENT_PULL_TIERS, rollRarity, generateAgentDef,
  RARITY_LABEL,
} from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const { tierId } = await readBody(event) as { tierId: string }
  const tier = AGENT_PULL_TIERS.find(t => t.id === tierId)
  if (!tier) throw createError({ statusCode: 400, statusMessage: 'Unknown recruit tier' })

  const [currentAgents, state, currentUser] = await Promise.all([
    db.query.hackAgents.findMany({ where: eq(hackAgents.userId, userId) }),
    db.query.hackState.findFirst({ where: eq(hackState.userId, userId) }),
    db.query.user.findFirst({ where: eq(user.id, userId) }),
  ])

  if (!state) throw createError({ statusCode: 400, statusMessage: 'Hack ops not initialized' })

  // Only one unresolved overflow recruit at a time — the user must replace or
  // discard the pending agent before pulling another.
  if (currentAgents.some(a => a.pending))
    throw createError({ statusCode: 400, statusMessage: 'Resolve your pending recruit first.' })

  const rosterAgents = currentAgents.filter(a => !a.pending)
  // When the roster is full the new agent is recruited as "pending": the client
  // shows a popup to replace an existing agent or discard the newcomer.
  const pending = rosterAgents.length >= state.rosterSlots

  const cost = tier.cost

  if (tier.currency === 'cash') {
    await debit(userId, cost.toFixed(4), 'hack:recruit')
  } else {
    if ((currentUser?.gems ?? 0) < cost)
      throw createError({ statusCode: 400, statusMessage: 'Not enough gems' })
    await db.update(user).set({ gems: sql`${user.gems} - ${cost}` }).where(eq(user.id, userId))
  }

  const takenNames = currentAgents.map(a => a.name)
  const rarity = rollRarity(tier.weights)
  const def = generateAgentDef(rarity, takenNames)

  await db.update(hackState)
    .set({ totalRecruits: sql`${hackState.totalRecruits} + 1` })
    .where(eq(hackState.userId, userId))

  const [agent] = await db.insert(hackAgents).values({ userId, ...def, pending }).returning()
  return { agent, rarity, rarityLabel: RARITY_LABEL[rarity], pending }
})
