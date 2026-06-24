import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { user, hackState, hackAgents, hackItems } from '#server/database/schema'
import { agentPower, type AgentClass, type AgentTrait, type ItemMod } from '#shared/utils/hack-config'

export default defineEventHandler(async () => {
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

      let totalPower = 0
      for (const agent of userAgents) {
        const equippedItems = [agent.equippedTool, agent.equippedSoftware, agent.equippedHardware]
          .filter(Boolean)
          .map(id => itemMap.get(id!))
          .filter((i): i is NonNullable<typeof i> => !!i)
        const traits = (agent.traits ?? []) as AgentTrait[]
        totalPower += agentPower(
          { level: agent.level, class: agent.class as AgentClass },
          equippedItems.map(i => ({ itemLevel: i.itemLevel, mods: i.mods as ItemMod[] })),
          traits,
        )
      }

      return {
        userId: state.userId,
        name: u.name,
        totalPower,
        agentCount: userAgents.length,
        itemCount: userItems.length,
        rosterSlots: state.rosterSlots,
        totalOpsCompleted: state.totalOpsCompleted,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.totalPower - a.totalPower || b.agentCount - a.agentCount)
})
