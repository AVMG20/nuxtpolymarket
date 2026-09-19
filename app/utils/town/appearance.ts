// Presentation only. A building has five looks, reached at these levels; the
// levels in between keep the look of the stage they belong to. Roads never
// upgrade and keep their connected street artwork.
export const TOWN_VISUAL_LEVELS = [1, 5, 10, 15, 20] as const

/** 0–4: which of the five looks a level draws. */
export function townVisualStage(level = 1): number {
    const safe = Number.isFinite(level) ? Math.floor(level) : 1
    let stage = 0
    for (let i = 1; i < TOWN_VISUAL_LEVELS.length; i++) if (safe >= TOWN_VISUAL_LEVELS[i]!) stage = i
    return stage
}

/** The level whose artwork `level` is drawn with: 1, 5, 10, 15 or 20. */
export function townVisualLevel(level = 1): number {
    return TOWN_VISUAL_LEVELS[townVisualStage(level)]!
}
