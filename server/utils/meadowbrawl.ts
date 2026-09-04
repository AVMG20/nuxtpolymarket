import { eq } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { meadowbrawlState } from '#server/database/schema'
import {
    meadowbrawlAccountEffects,
    meadowbrawlClampPetLevel,
    meadowbrawlIsPetId,
    meadowbrawlPetEffects,
    type MeadowbrawlPetId,
    type MeadowbrawlUpgradeLevels
} from '#shared/utils/gamelogic/meadowbrawl-meta'

export async function getLockedMeadowbrawlState(tx: DbExecutor, userId: string) {
    const [state] = await tx.select().from(meadowbrawlState).where(eq(meadowbrawlState.userId, userId)).for('update')
    if (!state) throw createError({ statusCode: 404, statusMessage: 'Meadowbrawl state not initialized' })
    return state
}

/** Finds or lazily creates the account row; two first visits can race the insert. */
export async function ensureMeadowbrawlState(tx: DbExecutor, userId: string) {
    const existing = await tx.query.meadowbrawlState.findFirst({ where: eq(meadowbrawlState.userId, userId) })
    if (existing) return existing
    const [inserted] = await tx.insert(meadowbrawlState).values({ userId }).onConflictDoNothing().returning()
    return inserted ?? (await tx.query.meadowbrawlState.findFirst({ where: eq(meadowbrawlState.userId, userId) }))!
}

export const MEADOWBRAWL_LEVEL_COLUMN = {
    prosperity: 'prosperityLevel'
} as const

export function meadowbrawlLevels(state: { prosperityLevel: number }): MeadowbrawlUpgradeLevels {
    return {
        prosperity: state.prosperityLevel
    }
}

export function meadowbrawlPetLevel(state: { petLevels: Record<string, number> }, id: MeadowbrawlPetId): number {
    return meadowbrawlClampPetLevel(state.petLevels?.[id] ?? 0)
}

/** The pet an active or upcoming run fields, or null when none is equipped. */
export function meadowbrawlActivePet(state: { petLevels: Record<string, number>, activePet: string | null }) {
    if (!meadowbrawlIsPetId(state.activePet)) return null
    const level = meadowbrawlPetLevel(state, state.activePet)
    if (level < 1) return null
    return meadowbrawlPetEffects(state.activePet, level)
}

/** Coin multiplier a run starting now would be paid at: Prosperity times the pet's keen eyes. */
export function meadowbrawlRunCoinMult(state: {
    prosperityLevel: number
    petLevels: Record<string, number>
    activePet: string | null
}): number {
    const effects = meadowbrawlAccountEffects(meadowbrawlLevels(state))
    const pet = meadowbrawlActivePet(state)
    return effects.coinMult * (pet?.coinMult ?? 1)
}
