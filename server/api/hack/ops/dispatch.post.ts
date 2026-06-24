import { eq, and, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents, hackItems, hackOps } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import {
  OP_TEMPLATES, agentPower, effectiveDurationMs, opSuccessChance, MIN_DEPLOY_SUCCESS,
  type AgentClass, type ItemMod, type AgentTrait,
} from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const userId = session.user.id

  const body = await readBody(event)
  const { templateId, agentIds } = body as { templateId: string; agentIds: string[] }

  const template = OP_TEMPLATES.find(t => t.id === templateId)
  if (!template) throw createError({ statusCode: 400, statusMessage: 'Unknown op' })

  if (!Array.isArray(agentIds) || agentIds.length < template.minAgents || agentIds.length > template.maxAgents)
    throw createError({ statusCode: 400, statusMessage: `This op requires ${template.minAgents}–${template.maxAgents} agents` })

  const [agents, activeOps] = await Promise.all([
    db.query.hackAgents.findMany({ where: and(eq(hackAgents.userId, userId), inArray(hackAgents.id, agentIds)) }),
    db.query.hackOps.findMany({ where: and(eq(hackOps.userId, userId), eq(hackOps.collected, false)) }),
  ])

  if (agents.length !== agentIds.length)
    throw createError({ statusCode: 400, statusMessage: 'One or more agents not found' })

  const busyIds = new Set(activeOps.flatMap(op => op.agentIds as string[]))
  if (agentIds.some(id => busyIds.has(id)))
    throw createError({ statusCode: 400, statusMessage: 'Agent is already on an op' })

  // Collect equipped item IDs, filtering out nulls properly
  const equippedIds = agents.flatMap(a =>
    ([a.equippedTool, a.equippedSoftware, a.equippedHardware] as Array<string | null>)
      .filter((x): x is string => x !== null)
  )

  const items = equippedIds.length > 0
    ? await db.query.hackItems.findMany({
        where: and(eq(hackItems.userId, userId), inArray(hackItems.id, equippedIds)),
      })
    : []

  // Per-agent power calculation
  const agentDefs = agents.map(a => ({ level: a.level, class: a.class as AgentClass }))
  const totalPower = agents.reduce((sum, agent) => {
    const agentItemIds = ([agent.equippedTool, agent.equippedSoftware, agent.equippedHardware] as Array<string | null>)
      .filter((x): x is string => x !== null)
    const agentItems = items
      .filter(i => agentItemIds.includes(i.id))
      .map(i => ({ itemLevel: i.itemLevel, mods: i.mods as ItemMod[] }))
    return sum + agentPower({ level: agent.level, class: agent.class as AgentClass }, agentItems, (agent.traits ?? []) as AgentTrait[])
  }, 0)

  const durationMs = process.env.DEV_MODE === 'true'
    ? 1000
    : effectiveDurationMs(template, agentDefs, items.map(i => ({ mods: i.mods as ItemMod[] })))
  const successChance = opSuccessChance(totalPower, template.minPower)
  if (successChance < MIN_DEPLOY_SUCCESS)
    throw createError({ statusCode: 400, statusMessage: 'Success chance too low — bring more power' })

  const completesAt = new Date(Date.now() + durationMs)

  const [op] = await db.insert(hackOps).values({ userId, templateId, agentIds, completesAt }).returning()

  return { opId: op!.id, completesAt, durationMs, successChance }
})
