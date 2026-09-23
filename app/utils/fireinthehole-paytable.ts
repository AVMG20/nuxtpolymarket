// Player-facing numbers for Fire in the Hole's paytable, win tiers and rules
// panel. The game math lives in shared/utils/gamelogic/fireinthehole.ts; the
// values it keeps private are mirrored here, and
// test/games/fireinthehole-paytable.spec.ts replays real spins to prove the
// mirror still matches the server's payouts.
import type { FirePaySymbol } from '#shared/utils/gamelogic/fireinthehole'

/** Pay per symbol in a winning connection, as a multiple of the bet. */
export const FITH_SYMBOL_PAY: Record<FirePaySymbol, number> = {
    coal: 0.012,
    ore: 0.017,
    ruby: 0.025,
    sapphire: 0.035,
    emerald: 0.048
}

/** Player-facing names; the art for `emerald` is gold and `ore` is silver. */
export const FITH_SYMBOL_LABEL: Record<FirePaySymbol, string> = {
    coal: 'Coal',
    ore: 'Silver',
    ruby: 'Ruby',
    sapphire: 'Sapphire',
    emerald: 'Gold'
}

/** Pay symbols from highest to lowest value. */
export const FITH_PAY_ORDER: FirePaySymbol[] = ['emerald', 'sapphire', 'ruby', 'ore', 'coal']

/** Every cascade after the first adds this much to the step's pay multiplier. */
export const FITH_CHAIN_STEP = 0.18

/** Pay multiplier for cascade `chain` (0 = the first connection of the spin). */
export function fithChainMultiplier(chain: number): number {
    return 1 + chain * FITH_CHAIN_STEP
}

/** Range of the coin values that land during free spins (× bet). */
export const FITH_COIN_RANGE = { min: 0.13, max: 24.6 } as const
/** Range of the value a pickaxe adds to every coin, each free spin (× bet). */
export const FITH_BOOST_RANGE = { min: 1.23, max: 18.2 } as const

/**
 * Measured over 300k simulated spins at the starting depth (scratch
 * simulation, 2026-09-23): ~97.7% base-game return with the bonus included,
 * free spins about once every 180 spins, largest win ~7,000x.
 */
export const FITH_RTP_LABEL = '97.7%'
export const FITH_BONUS_FREQUENCY_LABEL = '1 in 180'

export interface FithWinTier {
    id: 'big' | 'mega' | 'epic' | 'motherlode'
    label: string
    /** Win as a multiple of the bet at or above which the tier shows. */
    min: number
}

/** Celebration tiers by win size (× bet), lowest first. */
export const FITH_WIN_TIERS: FithWinTier[] = [
    { id: 'big', label: 'Big Win', min: 20 },
    { id: 'mega', label: 'Mega Win', min: 50 },
    { id: 'epic', label: 'Epic Win', min: 150 },
    { id: 'motherlode', label: 'Motherlode', min: 500 }
]

/** Highest tier a win of `multiple` × bet reaches, or null below Big Win. */
export function fithWinTier(multiple: number): FithWinTier | null {
    let tier: FithWinTier | null = null
    for (const entry of FITH_WIN_TIERS) if (multiple >= entry.min) tier = entry
    return tier
}

/** Bet ladder for the − / + buttons. */
export const FITH_BET_STEPS = [
    1, 2, 5, 10, 20, 50, 100, 200, 500,
    1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
    1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000,
    250_000_000, 500_000_000, 1_000_000_000, 2_500_000_000, 5_000_000_000,
    10_000_000_000, 25_000_000_000, 50_000_000_000, 100_000_000_000
]
