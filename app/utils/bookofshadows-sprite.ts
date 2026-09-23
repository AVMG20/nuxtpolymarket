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

// The crop rects above live in a 1024×1024 "virtual" sheet space; the actual
// PNGs are these sizes, so every consumer scales rects by real / virtual.
export const BOS_SPRITE_IMG_W = 1536
export const BOS_SPRITE_IMG_H = 1024
export const BOS_BONUS_IMG_W = 1024
export const BOS_BONUS_IMG_H = 1024

export interface BosSpriteCrop {
    src: string
    /** Crop in real image pixels. */
    rect: [number, number, number, number]
    imgW: number
    imgH: number
}

/** Real-pixel crop of a symbol: the base sheet, or its framed art from the bonus sheet. */
export function bosSpriteCrop(symbol: SlotSymbol, bonus = false): BosSpriteCrop {
    const useBonus = (bonus && symbol !== 'ten') || symbol === 'bonuswild'
    if (useBonus) {
        const key = (symbol === 'bonuswild' ? 'book' : symbol) as BosBonusSymbol
        const [x, y, w, h] = BOS_BONUS_SYMBOL_META[key].rect
        const sx = BOS_BONUS_IMG_W / BOS_BONUS_SHEET_W
        const sy = BOS_BONUS_IMG_H / BOS_BONUS_SHEET_H
        return { src: BOS_BONUS_SPRITE_SRC, rect: [x * sx, y * sy, w * sx, h * sy], imgW: BOS_BONUS_IMG_W, imgH: BOS_BONUS_IMG_H }
    }
    const [x, y, w, h] = BOS_SYMBOL_META[symbol as BosBaseSymbol].rect
    const sx = BOS_SPRITE_IMG_W / BOS_SHEET_W
    const sy = BOS_SPRITE_IMG_H / BOS_SHEET_H
    return { src: BOS_SPRITE_SRC, rect: [x * sx, y * sy, w * sx, h * sy], imgW: BOS_SPRITE_IMG_W, imgH: BOS_SPRITE_IMG_H }
}

/** CSS for a sprite-sheet crop that fits inside a `size`×`size` box without distortion. */
export function bosIconStyle(symbol: SlotSymbol, bonus = false, size = 32): Record<string, string> {
    const { src, rect, imgW, imgH } = bosSpriteCrop(symbol, bonus)
    const [x, y, w, h] = rect
    const scale = size / Math.max(w, h)
    return {
        width: `${Math.round(w * scale)}px`,
        height: `${Math.round(h * scale)}px`,
        backgroundImage: `url(${src})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${imgW * scale}px ${imgH * scale}px`,
        backgroundPosition: `${-x * scale}px ${-y * scale}px`
    }
}
