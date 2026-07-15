import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { bankState, transactions, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { getLockedBankState, parseBankAmount, settleBankState, writeBankHistory } from '#server/utils/bank'
import { nextMaxPrincipal } from '#shared/utils/gamelogic/bank'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const amount = parseBankAmount((await readBody(event))?.amount)
  const userId = session.user.id

  await db.transaction(async (tx) => {
    const [currentUser] = await tx.select({ balance: user.balance }).from(user).where(eq(user.id, userId)).for('update')
    if (!currentUser || parseFloat(currentUser.balance) < amount) throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })

    const settled = await settleBankState(tx, await getLockedBankState(tx, userId))
    const currentBalance = parseFloat(settled.balance)
    const debtPayment = Math.min(amount, Math.max(0, -currentBalance))
    const savingsAdded = amount - debtPayment
    const newBalance = currentBalance + amount
    const principal = Math.max(0, parseFloat(settled.principal) + savingsAdded)
    const maxPrincipal = nextMaxPrincipal(parseFloat(settled.maxPrincipal), principal)

    await tx.update(bankState).set({ balance: newBalance.toFixed(4), principal: principal.toFixed(4), maxPrincipal: maxPrincipal.toFixed(4), loanPrincipal: newBalance >= 0 ? '0' : settled.loanPrincipal, lastSettledAt: new Date() }).where(eq(bankState.id, settled.id))
    await tx.insert(transactions).values({ userId, amount: amount.toFixed(4), type: 'debit', category: 'bank deposit' })
    await tx.update(user).set({ balance: sql`${user.balance} - ${amount.toFixed(4)}::numeric` }).where(eq(user.id, userId))
    await writeBankHistory(tx, userId, newBalance, 'deposit', amount)
  })
  return { ok: true }
})
