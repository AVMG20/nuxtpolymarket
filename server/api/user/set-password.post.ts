import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '#server/database'
import { account } from '#server/database/schema'
import { auth, requireUserId } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { password } = await readBody(event)
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })
  }

  // setPassword only ever ADDS a first password (for OAuth-only accounts). Once a
  // password exists, changing it must go through changePassword, which requires
  // the current one — otherwise a hijacked session could silently reset it here.
  const existing = await db.query.account.findFirst({
    where: and(eq(account.userId, userId), eq(account.providerId, 'credential'), isNotNull(account.password))
  })
  if (existing) throw createError({ statusCode: 400, statusMessage: 'You already have a password. Use change password instead.' })

  await auth.api.setPassword({
    body: { newPassword: password },
    headers: event.headers,
  })

  return { success: true }
})
