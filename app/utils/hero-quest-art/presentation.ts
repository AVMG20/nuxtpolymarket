// Round 2: how a skill is *presented* on the stage, after the reference video.
//
// While a Hero skill plays, the scene darkens toward the skill's colour, the skill's name
// hangs over the fight on a gold banner, and every impact stacks its number under a big
// total. The banner is drawn here; the tint is a palette map (nothing in this art has
// alpha); the stacking lives in the live stage (demo.ts).

import { C, shadeLut, type ColorName } from './palette'
import { Surface, bayer, rect } from './surface'
import { textOut, textWidth } from './font'
import { qt, R } from './vfx-kit'

// ── Banner ─────────────────────────────────────────────────────────────────────────

const BANNER_TMP = new Surface(200, 9, 0, 0)
/** Top-to-bottom gold ramp for the letters: bright crown, deep base. */
const LETTER_RAMP = [C.gold3, C.gold3, C.gold3, C.gold2, C.gold2, C.gold1, C.gold1]
/** A boss's special gets its banner in blood red, so it never reads as one of the party's skills. */
const BOSS_RAMP = [C.red3, C.red3, C.red3, C.red2, C.red2, C.red1, C.red1]

/** How long the rules take to shoot out, or draw back in, and how long the letters flash white. */
const RULE_GROW = 0.2
const LETTER_FLASH = 0.1

/**
 * The skill's name in gradient gold letters with a dark outline and drop shadow, between
 * two rules that shoot outward. `t` is seconds since the skill fired: the first frame
 * flashes white, the rules grow over 0.2 s. `left` is seconds until it comes down, which plays
 * the same in reverse: the rules draw back in, then a last white flash.
 */
export function drawSkillBanner(s: Surface, text: string, cx: number, y: number, t: number, boss = false, left = Infinity): void {
    const letters = boss ? BOSS_RAMP : LETTER_RAMP
    const rule = boss ? [C.red2, C.red0, C.red3] : [C.gold2, C.gold0, C.gold3]
    const q = qt(t)
    const out = qt(Math.max(0, left))
    const w = textWidth(text, 'big')
    const x0 = R(cx - w / 2)
    // rules first, so the letters' outline cuts them
    const grow = Math.min(1, q / RULE_GROW, Math.max(0, out - LETTER_FLASH) / RULE_GROW)
    const len = R(30 * grow)
    if (len > 0) {
        for (const side of [-1, 1]) {
            const a = side < 0 ? x0 - 4 - len : x0 + w + 4
            rect(s, a, y + 3, len, 1, rule[0]!)
            rect(s, a, y + 4, len, 1, rule[1]!)
            const tipX = side < 0 ? a - 1 : a + len
            rect(s, tipX, y + 2, 1, 3, rule[2]!)
            s.set(tipX - side, y + 3, C.white)
        }
    }
    // letters: render white into scratch, then outline, shadow and recolour by row
    BANNER_TMP.clear()
    textOut(BANNER_TMP, text, 1, 1, C.white, 'big', 1, 0, 0, C.ink, -1)
    const flash = q < LETTER_FLASH || out < LETTER_FLASH
    for (let yy = 0; yy < BANNER_TMP.h; yy++) {
        for (let xx = 0; xx < w + 2; xx++) {
            if (BANNER_TMP.data[yy * BANNER_TMP.w + xx] === 0) continue
            const sx = x0 + xx - 1
            const sy = y + yy - 1
            s.set(sx + 1, sy + 2, C.brown0) // drop shadow
            for (let k = 0; k < 4; k++) {
                const ox = k === 0 ? -1 : k === 1 ? 1 : 0
                const oy = k === 2 ? -1 : k === 3 ? 1 : 0
                if (BANNER_TMP.get(xx + ox, yy + oy) === 0) s.set(sx + ox, sy + oy, C.ink)
            }
        }
    }
    for (let yy = 0; yy < BANNER_TMP.h; yy++) {
        for (let xx = 0; xx < w + 2; xx++) {
            if (BANNER_TMP.data[yy * BANNER_TMP.w + xx] === 0) continue
            s.set(x0 + xx - 1, y + yy - 1, flash ? C.white : letters[Math.min(letters.length - 1, yy - 1)]!)
        }
    }
}

// ── Scene tint ─────────────────────────────────────────────────────────────────────

const TINTS = new Map<ColorName, Uint8Array>()

/** The palette map that dims a scene toward `tint` — built once per colour. */
export function tintLut(tint: ColorName): Uint8Array {
    let lut = TINTS.get(tint)
    if (!lut) { lut = shadeLut(0.55, tint, 0.2); TINTS.set(tint, lut) }
    return lut
}

/**
 * Remap `s` in place through `lut`. `level` 0..16 is how many of each 16 Bayer cells take
 * it, so the dim can step in and out over a couple of frames instead of snapping.
 */
export function applyTint(s: Surface, lut: Uint8Array, level: number): void {
    if (level <= 0) return
    const d = s.data
    const w = s.w
    for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < w; x++) {
            if (level < 16 && !bayer(x, y, level)) continue
            const i = y * w + x
            d[i] = lut[d[i]!]!
        }
    }
}
