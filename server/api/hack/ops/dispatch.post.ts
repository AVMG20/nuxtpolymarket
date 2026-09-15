import { requireUserId } from '#server/utils/auth'
import { db } from '#server/database'
import { dispatchHackOp } from '#server/utils/hack-dispatch'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const body = await readBody(event)
  const { templateId, agentIds, autoRedeploy } = body as { templateId: string; agentIds: string[]; autoRedeploy?: unknown }

  return dispatchHackOp(db, userId, templateId, agentIds, {
    instant: Boolean(useRuntimeConfig(event).devMode),
    autoRedeploy: autoRedeploy === true,
  })
})
