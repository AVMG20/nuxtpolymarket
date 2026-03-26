import { auth } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { password } = await readBody(event)
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })
  }

  await auth.api.setPassword({
    body: { newPassword: password },
    headers: event.headers,
  })

  return { success: true }
})
