import { eq, and, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents, hackItems, hackOps, hackHistory, hackState, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import {
  OP_TEMPLATES, rollOpReward, agentXpGain, agentPower, xpToNextLevel, AGENT_MAX_LEVEL, MAX_INVENTORY_SLOTS,
  type AgentClass, type ItemMod, type AgentTrait,
} from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const { opId } = await readBody(event) as { opId: string }

  const op = await db.query.hackOps.findFirst({ where: and(eq(hackOps.id, opId), eq(hackOps.userId, userId)) })
  if (!op) throw createError({ statusCode: 404, statusMessage: 'Op not found' })
  if (op.collected) throw createError({ statusCode: 400, statusMessage: 'Already collected' })
  if (new Date() < op.completesAt) throw createError({ statusCode: 400, statusMessage: 'Op not complete yet' })

  const template = OP_TEMPLATES.find(t => t.id === op.templateId)
  if (!template) throw createError({ statusCode: 400, statusMessage: 'Unknown op template' })

  const agentIds = op.agentIds as string[]
  const [agents, currentItems] = await Promise.all([
    db.query.hackAgents.findMany({ where: and(eq(hackAgents.userId, userId), inArray(hackAgents.id, agentIds)) }),
    db.query.hackItems.findMany({ where: eq(hackItems.userId, userId) }),
  ])

  const equippedItemIds = agents.flatMap(a =>
    ([a.equippedTool, a.equippedSoftware, a.equippedHardware] as Array<string | null>)
      .filter((x): x is string => x !== null)
  )
  const equippedItems = currentItems.filter(i => equippedItemIds.includes(i.id))
  const inventoryFull = currentItems.filter(i => !i.equippedBy).length >= MAX_INVENTORY_SLOTS

  // Per-agent loadouts (items may have changed since dispatch — recompute from
  // current gear). Each agent keeps its own items so loot and XP are computed per
  // agent rather than pooled across the squad.
  const rewardAgents = agents.map(agent => {
    const agentItemIds = ([agent.equippedTool, agent.equippedSoftware, agent.equippedHardware] as Array<string | null>)
      .filter((x): x is string => x !== null)
    return {
      level: agent.level,
      class: agent.class as AgentClass,
      traits: (agent.traits ?? []) as AgentTrait[],
      items: equippedItems.filter(i => agentItemIds.includes(i.id)).map(i => ({ itemLevel: i.itemLevel, mods: i.mods as ItemMod[] })),
    }
  })
  const totalPower = rewardAgents.reduce((sum, a) =>
    sum + agentPower({ level: a.level, class: a.class }, a.items, a.traits), 0)

  const reward = rollOpReward(template, rewardAgents, totalPower, inventoryFull)

  // Apply XP per agent — each agent earns from its OWN xp_boost trait and xp_flat
  // gear (never pooled). On failure every agent gets the same flat 15% of base XP.
  const levelUps: Array<{ agentId: string; newLevel: number }> = []
  let reportXp = 0
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i]!
    const gain = agentXpGain(template, rewardAgents[i]!, reward.success)
    reportXp = gain
    if (agent.level >= AGENT_MAX_LEVEL) continue
    let newXp = agent.xp + gain
    let newLevel = agent.level
    while (newLevel < AGENT_MAX_LEVEL && newXp >= xpToNextLevel(newLevel)) {
      newXp -= xpToNextLevel(newLevel)
      newLevel++
    }
    if (newLevel !== agent.level) levelUps.push({ agentId: agent.id, newLevel })
    await db.update(hackAgents).set({ xp: newXp, level: newLevel }).where(eq(hackAgents.id, agent.id))
  }

  if (reward.success) {
    await credit(userId, reward.cash.toFixed(4), 'hack:op')
    if (reward.gems > 0) {
      await db.update(user).set({ gems: sql`${user.gems} + ${reward.gems}` }).where(eq(user.id, userId))
    }
  }

  let droppedItem = null
  if (reward.item) {
    const [newItem] = await db.insert(hackItems).values({
      userId,
      name: reward.item.name,
      slot: reward.item.slot,
      itemLevel: reward.item.itemLevel,
      rarity: reward.item.rarity,
      mods: reward.item.mods,
    }).returning()
    droppedItem = newItem
  }

  await db.update(hackOps).set({ collected: true, reward }).where(eq(hackOps.id, opId))

  // Log the outcome and bump the lifetime ops-done counter (used by the leaderboard).
  const durationMs = op.completesAt.getTime() - op.startedAt.getTime()
  await Promise.all([
    db.insert(hackHistory).values({
      userId,
      templateId: op.templateId,
      success: reward.success,
      cash: (reward.success ? reward.cash : 0).toFixed(4),
      gems: reward.success ? reward.gems : 0,
      itemName: droppedItem?.name ?? null,
      itemRarity: droppedItem?.rarity ?? null,
      agentCount: agentIds.length,
      durationMs,
    }),
    db.update(hackState)
      .set({ totalOpsCompleted: sql`${hackState.totalOpsCompleted} + 1` })
      .where(eq(hackState.userId, userId)),
  ])

  return {
    success: reward.success,
    cash: reward.cash,
    gems: reward.gems,
    xpPerAgent: reportXp,
    item: droppedItem ?? null,
    inventoryFull: reward.inventoryFull,
    levelUps,
  }
})
