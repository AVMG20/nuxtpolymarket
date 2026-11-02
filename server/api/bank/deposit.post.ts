import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { bankState, user } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { getLockedBankState, parseBankAmount, settleBankState, writeBankHistory } from '#server/utils/bank'
import { nextMaxPrincipal } from '#shared/utils/gamelogic/bank'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const body = await readBody(event)
  const repayDebt = body?.repayDebt === true

  await db.transaction(async (tx) => {
    // User row first, then bank_state — the project-wide lock order.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update')

    const settled = await settleBankState(tx, await getLockedBankState(tx, userId))
    const currentBalance = parseFloat(settled.balance)
    if (repayDebt && currentBalance >= 0) throw createError({ statusCode: 400, statusMessage: 'No active debt to repay' })
    const amount = repayDebt
      ? parseBankAmount((-currentBalance).toFixed(4))
      : parseBankAmount(body?.amount)
    await debit(userId, amount.toFixed(4), 'bank', tx)

    const debtPayment = Math.min(amount, Math.max(0, -currentBalance))
    const savingsAdded = amount - debtPayment
    const newBalance = repayDebt ? 0 : currentBalance + amount
    const principal = Math.max(0, parseFloat(settled.principal) + savingsAdded)
    const maxPrincipal = nextMaxPrincipal(parseFloat(settled.maxPrincipal), principal)

    await tx.update(bankState).set({ balance: newBalance.toFixed(4), principal: principal.toFixed(4), maxPrincipal: maxPrincipal.toFixed(4), loanPrincipal: newBalance >= 0 ? '0' : settled.loanPrincipal, lastSettledAt: new Date() }).where(eq(bankState.id, settled.id))
    await writeBankHistory(tx, userId, newBalance, 'deposit', amount)
  })
  return { ok: true }
})
