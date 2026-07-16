import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { bankState, transactions, user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { getLockedBankState, parseBankAmount, settleBankState, writeBankHistory } from '#server/utils/bank'
import { withdrawalAllowance } from '#shared/utils/gamelogic/bank'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  const amount = parseBankAmount((await readBody(event))?.amount)
  const userId = session.user.id

  await db.transaction(async (tx) => {
    const settled = await settleBankState(tx, await getLockedBankState(tx, userId))
    const balance = parseFloat(settled.balance)
    const loanPrincipal = parseFloat(settled.loanPrincipal)
    const availableSavings = Math.max(0, balance)
    if (amount > withdrawalAllowance(balance, parseFloat(settled.maxPrincipal), loanPrincipal)) throw createError({ statusCode: 400, statusMessage: 'Withdrawal and loan limit reached' })

    const withdrawnSavings = Math.min(amount, availableSavings)
    const borrowedAmount = amount - withdrawnSavings
    const principal = parseFloat(settled.principal)
    const earnedInterest = Math.max(0, balance - principal)
    const newPrincipal = Math.max(0, principal - Math.max(0, withdrawnSavings - earnedInterest))
    const newBalance = balance - amount
    const newLoanPrincipal = loanPrincipal + borrowedAmount

    await tx.update(bankState).set({
      balance: newBalance.toFixed(4),
      principal: newPrincipal.toFixed(4),
      loanPrincipal: newBalance < 0 ? newLoanPrincipal.toFixed(4) : '0',
      lastSettledAt: new Date()
    }).where(eq(bankState.id, settled.id))
    await tx.insert(transactions).values({ userId, amount: amount.toFixed(4), type: 'credit', category: 'bank' })
    await tx.update(user).set({ balance: sql`${user.balance} + ${amount.toFixed(4)}::numeric` }).where(eq(user.id, userId))
    await writeBankHistory(tx, userId, newBalance, 'withdraw', amount)
  })
  return { ok: true }
})
