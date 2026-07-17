import { and, eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { minerState } from '#server/database/schema'
import { credit, creditGems, debit, debitGems } from '#server/utils/balance'
import {
  effectiveRigIncome, vaultCap,
  effectiveFactoryRate, factoryCap,
  computePending
} from '#shared/utils/miner-config'

type MinerRow = typeof minerState.$inferSelect

export async function getLockedMinerState(tx: DbExecutor, userId: string) {
  const [state] = await tx.select().from(minerState).where(eq(minerState.userId, userId)).for('update')
  if (!state) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })
  return state
}

/** Collects pending rig cash at the current rate, then bumps `column` (rig or vault level). */
export async function collectAndUpgradeCash(tx: DbExecutor, userId: string, s: MinerRow, column: 'rigLevel' | 'vaultLevel', cost: number) {
  const pending = computePending(effectiveRigIncome(s.rigLevel, s.overclockLevel), s.lastCollectedAt, vaultCap(s.vaultLevel))
  const collected = Math.floor(pending * 100) / 100

  await tx.update(minerState)
    .set({ [column]: s[column] + 1, lastCollectedAt: new Date() })
    .where(eq(minerState.userId, userId))
  await debit(userId, cost.toFixed(4), 'miner', tx)
  if (collected >= 0.01) await credit(userId, collected.toFixed(4), 'miner', tx)

  return { newLevel: s[column] + 1, collected }
}

/** Collects pending gems at the current rate, then bumps the factory level. */
export async function collectAndUpgradeGems(tx: DbExecutor, userId: string, s: MinerRow, cost: number) {
  const pending = computePending(effectiveFactoryRate(s.factoryLevel, s.catalystLevel), s.factoryLastCollectedAt, factoryCap(s.factoryLevel))
  const collectedGems = Math.floor(pending)

  await tx.update(minerState)
    .set({ factoryLevel: s.factoryLevel + 1, factoryLastCollectedAt: new Date() })
    .where(eq(minerState.userId, userId))
  await debit(userId, cost.toFixed(4), 'gems', tx)
  if (collectedGems >= 1) await creditGems(userId, collectedGems, tx)

  return { newLevel: s.factoryLevel + 1, collectedGems }
}

interface GemShopTierOpts {
  maxLevel: number
  maxLevelMessage: string
  costFn: (level: number) => number | null
}

/** Reads the current tier inside the transaction and CASes it forward, guarding the read-then-write race. */
export async function upgradeGemShopTier(tx: DbExecutor, userId: string, column: 'catalystLevel' | 'overclockLevel', opts: GemShopTierOpts) {
  const [s] = await tx.select({ level: minerState[column] }).from(minerState).where(eq(minerState.userId, userId))
  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })
  if (s.level >= opts.maxLevel) throw createError({ statusCode: 400, statusMessage: opts.maxLevelMessage })

  const cost = opts.costFn(s.level)!

  const [upgraded] = await tx.update(minerState)
    .set({ [column]: s.level + 1 })
    .where(and(eq(minerState.userId, userId), eq(minerState[column], s.level)))
    .returning({ id: minerState.id })
  if (!upgraded) throw createError({ statusCode: 409, statusMessage: 'Miner state changed, try again' })

  await debitGems(userId, cost, tx)

  return { newLevel: s.level + 1, gemsSpent: cost }
}
