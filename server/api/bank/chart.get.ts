import { auth } from '#server/utils/auth'
import { getBankChartHistory } from '#server/utils/bank'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  return getBankChartHistory(session.user.id)
})
