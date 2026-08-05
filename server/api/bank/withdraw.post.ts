import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { bankState, transactions, user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { bailoutStateOf, getLockedBankState, parseBankAmount, settleBankState, writeBankHistory } from '#server/utils/bank'
import { isBailoutActive, withdrawalAllowance } from '#shared/utils/gamelogic/bank'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const amount = parseBankAmount((await readBody(event))?.amount)

  await db.transaction(async (tx) => {
    const now = new Date()
    // User row first, then bank_state — the project-wide lock order.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update')

    const settled = await settleBankState(tx, await getLockedBankState(tx, userId), now)
    const balance = parseFloat(settled.balance)
    const loanPrincipal = parseFloat(settled.loanPrincipal)
    const bailout = bailoutStateOf(settled)
    const availableSavings = Math.max(0, balance)
    if (isBailoutActive(bailout, now) && amount > availableSavings) {
      throw createError({ statusCode: 400, statusMessage: 'Loans are blocked while your bail-out penalty is running' })
    }
    if (amount > withdrawalAllowance(balance, parseFloat(settled.maxPrincipal), loanPrincipal, bailout, now)) throw createError({ statusCode: 400, statusMessage: 'Withdrawal and loan limit reached' })

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
