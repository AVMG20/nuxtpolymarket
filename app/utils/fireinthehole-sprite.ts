import type { FireBonusSymbol, FireSymbol } from '#shared/utils/gamelogic/fireinthehole'

export type FireBaseSymbol = Exclude<FireSymbol, FireBonusSymbol>

// Base-game grid sprite sheet (coal/ore/ruby/sapphire/emerald/bomb/scatter/rock/empty).
export const FITH_SPRITE_SRC = '/slots/fireinthehole/sprite.png'
export const FITH_SHEET_W = 1024
export const FITH_SHEET_H = 1024

// sprite.png is a 3x3 grid (each cell ~341px) laid out as:
//   coal     emerald  ruby
//   ore      rock     empty
//   sapphire scatter  bomb
export const FITH_SYMBOL_META: Record<FireBaseSymbol, { name: string, rect: [number, number, number, number] }> = {
    coal: { name: 'Coal', rect: [75, 47, 250, 250] },
    ore: { name: 'Ore', rect: [72, 344, 250, 232] },
    ruby: { name: 'Ruby', rect: [700, 47, 250, 250] },
    sapphire: { name: 'Sapphire', rect: [76, 637, 250, 250] },
    emerald: { name: 'Emerald', rect: [384, 47, 250, 250] },
    bomb: { name: 'Bomb', rect: [685, 632, 258, 264] },
    scatter: { name: 'Scatter', rect: [365, 620, 280, 272] },
    rock: { name: 'Rock', rect: [384, 344, 250, 230] },
    empty: { name: 'Empty', rect: [758, 402, 100, 100] }
}

// Bonus-round drop sprite sheet (coin/boost/double/collector).
export const FITH_BONUS_SPRITE_SRC = '/slots/fireinthehole/bonus.png'
export const FITH_BONUS_SHEET_W = 1024
export const FITH_BONUS_SHEET_H = 1024

// bonus.png is a 2x2 grid (each cell 512px) laid out as:
//   coin   boost
//   double collector
export const FITH_BONUS_SYMBOL_META: Record<FireBonusSymbol, { name: string, rect: [number, number, number, number] }> = {
    coin: { name: 'Coin', rect: [28, 33, 467, 461] },
    boost: { name: 'Boost', rect: [522, 28, 466, 467] },
    double: { name: 'Double', rect: [30, 526, 470, 422] },
    collector: { name: 'Collector', rect: [516, 511, 471, 461] }
}
