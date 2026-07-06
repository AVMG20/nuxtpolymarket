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
    sword: { name: 'Sword', rect: [22, 688, 160, 160] },
    orb: { name: 'Orb', rect: [227, 688, 160, 160] },
    scythe: { name: 'Scythe', rect: [432, 688, 160, 160] },
    hood: { name: 'Hood', rect: [637, 688, 160, 160] },
    book: { name: 'Book', rect: [842, 688, 160, 160] }
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
  jack: { name: 'Jack', rect: [41, 41, 260, 260] },
  queen: { name: 'Queen', rect: [382, 41, 260, 260] },
  king: { name: 'King', rect: [723, 41, 260, 260] },
  ace: { name: 'Ace', rect: [41, 382, 260, 260] },
  sword: { name: 'Sword', rect: [382, 382, 260, 260] },
  orb: { name: 'Orb', rect: [723, 382, 260, 260] },
  scythe: { name: 'Scythe', rect: [41, 723, 260, 260] },
  hood: { name: 'Hood', rect: [382, 723, 260, 260] },
  book: { name: 'Book', rect: [723, 723, 260, 260] }
}
