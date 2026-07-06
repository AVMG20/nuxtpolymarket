import type { BonusTier, SlotSymbol } from '#shared/utils/gamelogic/bookofshadows'

export type BosBaseSymbol = Exclude<SlotSymbol, 'bonuswild'>
export type BosBonusSymbol = BonusTier['symbol']

// Base-game grid sprite sheet (ten/jack/queen/king/ace + sword/orb/scythe/hood + book).
export const BOS_SPRITE_SRC = '/slots/bookofshadows/sprite.png'
export const BOS_SHEET_W = 1024
export const BOS_SHEET_H = 1024

// sprite.png is a 5x2 grid (each cell ~205x512) laid out as:
//   ten    jack   queen  king   ace
//   sword  orb    scythe hood   book
export const BOS_SYMBOL_META: Record<BosBaseSymbol, { name: string, rect: [number, number, number, number] }> = {
    ten: { name: 'Ten', rect: [77, 92, 170, 206] },
    jack: { name: 'Jack', rect: [249, 92, 153, 206] },
    queen: { name: 'Queen', rect: [404, 92, 169, 222] },
    king: { name: 'King', rect: [578, 92, 159, 206] },
    ace: { name: 'Ace', rect: [753, 92, 150, 206] },
    sword: { name: 'Sword', rect: [108, 369, 111, 269] },
    orb: { name: 'Orb', rect: [449, 374, 150, 255] },
    scythe: { name: 'Scythe', rect: [601, 668, 158, 257] },
    hood: { name: 'Hood', rect: [607, 377, 211, 227] },
    book: { name: 'Book', rect: [254, 384, 167, 241] }
}

// Bonus-tier reveal sprite sheet (the symbol rolled to decide what the locked
// skull columns pay at — everything but 'ten', since ten never appears here).
export const BOS_BONUS_SPRITE_SRC = '/slots/bookofshadows/bonus.png'
export const BOS_BONUS_SHEET_W = 1024
export const BOS_BONUS_SHEET_H = 1024

// bonus.png is a 3x3 grid (each cell ~341px) laid out as:
//   jack   queen  king
//   ace    sword  orb
//   scythe hood   book
export const BOS_BONUS_SYMBOL_META: Record<BosBonusSymbol, { name: string, rect: [number, number, number, number] }> = {
    jack: { name: 'Jack', rect: [59, 368, 280, 260] },
    queen: { name: 'Queen', rect: [686, 59, 282, 274] },
    king: { name: 'King', rect: [369, 61, 282, 274] },
    ace: { name: 'Ace', rect: [57, 61, 282, 274] },
    sword: { name: 'Sword', rect: [57, 666, 282, 256] },
    orb: { name: 'Orb', rect: [685, 372, 282, 255] },
    scythe: { name: 'Scythe', rect: [370, 667, 284, 257] },
    hood: { name: 'Hood', rect: [683, 662, 285, 263] },
    book: { name: 'Book', rect: [370, 368, 283, 259] }
}
