import { NC_BOT_FEE } from '#shared/utils/neighcasso/types'
import type { NcDrawing, NcStroke } from '#shared/utils/neighcasso/types'

export const NC_BOT_NAMES = [
    'RoboTrotter 3000', 'Clanky McNeigh', 'Hoof.exe', 'Neigh-I Assistant', 'Bolt Bucephalus',
    'Captain Gallopcode', 'Sir Beep-a-Lot', 'Mecha Mare', 'Stallion.js', 'Trot Bot',
    'Rusty Hooves', 'Neighbot 9000', 'Gearbox Gertrude', 'Hayfinity', 'Colt 45 RPM'
]

/** What a winning human is paid: the whole pot, less the house's cut when bots ran. */
export function ncPayout(pot: number, withBots: boolean): number {
    return Math.round(pot * (withBots ? 1 - NC_BOT_FEE : 1) * 10_000) / 10_000
}

// Cosmetic only: a small seeded PRNG so every client draws the same bot.
function mulberry32(seed: number) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const BOT_COLORS = ['#5b6770', '#2e86ab', '#9d4edd', '#e4572e', '#6a994e', '#c0392b', '#f2a541']

/**
 * A wonky robot horse, the same on every client for a given seed: a boxy body,
 * an antenna head, stilt legs and a spring tail, all slightly off-kilter.
 */
export function botDrawing(seed: number): NcDrawing {
    const rng = mulberry32(seed)
    const jit = (v: number, amount: number) => Math.round(v + (rng() - 0.5) * amount)
    const color = BOT_COLORS[Math.floor(rng() * BOT_COLORS.length)]!
    const accent = BOT_COLORS[Math.floor(rng() * BOT_COLORS.length)]!
    const w = 8
    const strokes: NcStroke[] = []

    const x0 = jit(170, 30)
    const x1 = jit(400, 30)
    const y0 = jit(160, 30)
    const y1 = jit(250, 20)
    strokes.push({ k: 'body', c: color, w, p: [x0, y0, x1, jit(y0, 16), jit(x1, 10), y1, jit(x0, 10), jit(y1, 10), x0, y0] })
    // Rivets.
    for (let i = 0; i < 3; i++) strokes.push({ k: 'body', c: accent, w: 10, p: [jit(x0 + 50 + i * 70, 20), jit((y0 + y1) / 2, 20)] })

    const hx = x1 + jit(40, 20)
    const hy = y0 - jit(60, 30)
    strokes.push({ k: 'head', c: color, w, p: [x1 - 10, y0 + 10, hx, hy + 30, hx, hy, hx + 70, hy, hx + 70, hy + 45, hx, hy + 45] })
    strokes.push({ k: 'head', c: accent, w: 12, p: [hx + 45, hy + 18] })
    strokes.push({ k: 'head', c: color, w: 5, p: [hx + 20, hy, hx + 14, hy - 40] })
    strokes.push({ k: 'head', c: accent, w: 14, p: [hx + 14, hy - 44] })

    const legs = rng() < 0.2 ? 3 : 4
    for (let i = 0; i < legs; i++) {
        const lx = x0 + 25 + i * ((x1 - x0 - 50) / (legs - 1))
        strokes.push({ k: 'leg', c: color, w, p: [Math.round(lx), y1, jit(lx, 20), jit(305, 20), jit(lx, 10), 350] })
    }

    const spring: number[] = [x0, y0 + 20]
    for (let i = 1; i <= 6; i++) spring.push(x0 - i * 12, y0 + 20 + (i % 2 ? -18 : 18))
    strokes.push({ k: 'tail', c: accent, w: 6, p: spring })
    return { v: 1, strokes }
}
