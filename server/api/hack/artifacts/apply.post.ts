import { eq, and } from 'drizzle-orm'
import { db } from '#server/database'
import { hackAgents, hackArtifacts } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { AGENT_TRAIT_RANGES, ARTIFACT_VALUE, type AgentTraitType, type HackRarity } from '#shared/utils/hack-config'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { agentId, artifactId } = await readBody(event) as { agentId: string; artifactId: string }
  if (!agentId || !artifactId) throw createError({ statusCode: 400, statusMessage: 'Missing agent or artifact' })

  const [agent, artifact] = await Promise.all([
    db.query.hackAgents.findFirst({ where: and(eq(hackAgents.id, agentId), eq(hackAgents.userId, userId)) }),
    db.query.hackArtifacts.findFirst({ where: and(eq(hackArtifacts.id, artifactId), eq(hackArtifacts.userId, userId)) })
  ])

  if (!agent) throw createError({ statusCode: 404, statusMessage: 'Agent not found' })
  if (!artifact) throw createError({ statusCode: 404, statusMessage: 'Artifact not found' })
  if (artifact.count <= 0) throw createError({ statusCode: 400, statusMessage: 'Artifact stack is empty' })

  const traitType = artifact.traitType as AgentTraitType
  const rarity = artifact.rarity as HackRarity
  const traits = (agent.traits ?? []) as Array<{ type: AgentTraitType; value: number }>
  const trait = traits.find(t => t.type === traitType)

  if (!trait) throw createError({ statusCode: 400, statusMessage: `${agent.name} has no ${traitType} trait` })

  const range = AGENT_TRAIT_RANGES[traitType]
  const add = ARTIFACT_VALUE[traitType][rarity]
  const projected = Math.min(range.max, trait.value + add)
  if (projected <= trait.value) throw createError({ statusCode: 400, statusMessage: 'Trait already maxed' })

  trait.value = projected

  await db.update(hackAgents).set({ traits }).where(eq(hackAgents.id, agentId))

  if (artifact.count <= 1) {
    await db.delete(hackArtifacts).where(eq(hackArtifacts.id, artifactId))
  } else {
    await db.update(hackArtifacts).set({ count: artifact.count - 1 }).where(eq(hackArtifacts.id, artifactId))
  }

  return { applied: true, traitType, rarity, newValue: trait.value, max: range.max }
})
