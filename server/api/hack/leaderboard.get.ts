import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { getSessionUserId } from '#server/utils/auth'
import { user, hackState, hackAgents, hackItems } from '#server/database/schema'
import { equippedAgentPower } from '#server/utils/hack'

export default defineEventHandler(async (event) => {
  const sessionUserId = await getSessionUserId(event)
  const states = await db
    .select({
      userId: hackState.userId,
      rosterSlots: hackState.rosterSlots,
      totalOpsCompleted: hackState.totalOpsCompleted,
    })
    .from(hackState)

  if (!states.length) return []

  const userIds = states.map(s => s.userId)

  const [users, agents, items] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)),
    db.query.hackAgents.findMany({ where: inArray(hackAgents.userId, userIds) }),
    db.query.hackItems.findMany({ where: inArray(hackItems.userId, userIds) }),
  ])

  const userMap = new Map(users.map(u => [u.id, u]))

  return states
    .map(state => {
      const u = userMap.get(state.userId)
      if (!u) return null

      const userAgents = agents.filter(a => a.userId === state.userId)
      const userItems = items.filter(i => i.userId === state.userId)
      const itemMap = new Map(userItems.map(i => [i.id, i]))

      // Only active agents count toward power (matches /hack, where inactive
      // agents sit in storage and don't contribute to totalPower).
      const activeAgents = userAgents.filter(a => a.active)

      const totalPower = activeAgents.reduce((total, agent) => total + equippedAgentPower(agent, itemMap), 0)

      return {
        isCurrentUser: state.userId === sessionUserId,
        name: u.name,
        totalPower,
        agentCount: activeAgents.length,
        itemCount: userItems.length,
        rosterSlots: state.rosterSlots,
        totalOpsCompleted: state.totalOpsCompleted,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.totalPower - a.totalPower || b.agentCount - a.agentCount)
})
