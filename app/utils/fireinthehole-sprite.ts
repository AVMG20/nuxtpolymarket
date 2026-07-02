import type { FireBonusSymbol, FireSymbol } from '#shared/utils/gamelogic/fireinthehole'

export type FireBaseSymbol = Exclude<FireSymbol, FireBonusSymbol>

// Base-game grid sprite sheet (coal/ore/ruby/sapphire/emerald/bomb/scatter/rock/empty).
// Coordinates are placeholders — tune them via /games/fireinthehole-sprite-debug and
// paste the generated code back in here.
export const FITH_SPRITE_SRC = '/slots/fireinthehole/sprite.png'
export const FITH_SHEET_W = 1254
export const FITH_SHEET_H = 1254

export const FITH_SYMBOL_META: Record<FireBaseSymbol, { name: string, rect: [number, number, number, number] }> = {
    coal: { name: 'Coal', rect: [468, 446, 320, 320] },
    ore: { name: 'Ore', rect: [90, 57, 319, 333] },
    ruby: { name: 'Ruby', rect: [471, 58, 327, 333] },
    sapphire: { name: 'Sapphire', rect: [855, 58, 319, 332] },
    emerald: { name: 'Emerald', rect: [76, 446, 328, 323] },
    bomb: { name: 'Bomb', rect: [1045, 0, 320, 320] },
    scatter: { name: 'Scatter', rect: [0, 209, 320, 320] },
    rock: { name: 'Rock', rect: [209, 209, 320, 320] },
    empty: { name: 'Empty', rect: [418, 209, 320, 320] }
}

// Bonus-round drop sprite sheet (coin/boost/double/collector).
// Coordinates are placeholders — tune them via /games/fireinthehole-sprite-debug and
// paste the generated code back in here.
export const FITH_BONUS_SPRITE_SRC = '/slots/fireinthehole/bonus.png'
export const FITH_BONUS_SHEET_W = 1254
export const FITH_BONUS_SHEET_H = 1254

export const FITH_BONUS_SYMBOL_META: Record<FireBonusSymbol, { name: string, rect: [number, number, number, number] }> = {
    coin: { name: 'Coin', rect: [45, 46, 560, 560] },
    boost: { name: 'Boost', rect: [650, 39, 560, 560] },
    double: { name: 'Double', rect: [632, 625, 579, 564] },
    collector: { name: 'Collector', rect: [37, 648, 572, 502] }
}
