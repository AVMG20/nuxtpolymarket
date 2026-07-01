import type { AetherSymbol } from '#shared/utils/gamelogic/aethergates'

// The sprite is a 5×4 tile sheet (1536×1024); only the top 3 rows are used.
// Each symbol has its own fixed [x, y, w, h] crop rect in source pixels —
// tweak these directly (or via /games/aethergates-sprite-debug) if an icon
// looks off-center or clips its neighbour.
export const AETHER_SPRITE_SRC = '/slots/aethergates/sprite.png'
export const AETHER_SHEET_W = 1536
export const AETHER_SHEET_H = 1024

export const AETHER_SYMBOL_META: Record<AetherSymbol, { name: string, rect: [number, number, number, number] }> = {
    coin: { name: 'Emerald Shard', rect: [595, 270, 240, 235] },
    ring: { name: 'Sky Shard', rect: [346, 268, 240, 235] },
    chalice: { name: 'Violet Shard', rect: [848, 268, 240, 235] },
    laurel: { name: 'Verdant Laurel', rect: [596, 23, 240, 235] },
    lyre: { name: 'Echo Lyre', rect: [1098, 23, 240, 235] },
    helm: { name: 'Aegis Helm', rect: [99, 268, 240, 235] },
    sun: { name: 'Solar Medallion', rect: [343, 24, 240, 235] },
    star: { name: 'Aether Signet', rect: [847, 24, 240, 235] },
    scatter: { name: 'Zeus Scatter', rect: [103, 764, 232, 220] },
    multiplier: { name: 'Storm Relic', rect: [343, 517, 240, 235] }
}