// The colosseum: the backdrop for the fights staged before a crowd rather than out in a world, the
// Gilded Knight and the Training Grounds raids, and later the Arena. Not a world: it has no roster,
// so it sits outside `WORLD_SCENES`, and the stage picks it for those fights (`demo.ts`).
//
// Scale: the far edge of the sand (GROUND) is about 0.6 of the near rank's distance, so a person
// standing there would be ~14 px. The arena wall, its gates, the spectators and the arcade are all
// sized against that, so the place reads as monumental rather than as a model behind the fighters.

import { C } from './palette'
import type { Surface } from './surface'
import { rect, px, line, poly, ellipse, dither, hash2 } from './surface'
import { clock } from './vfx-kit'
import { SW, SH, FLOOR_Y, GROUND, LIP, FRONT, type WorldScene, R, mod, sky, band, loopFrame, framing, scatter, motes, strata, birds } from './scenery-kit'

/** Where the far side of the bowl is deepest: its tiers sag toward the edges, where they come nearer. */
const BOWL_X = 172
/** How far the tiers drop at the canvas edges, the bowl's curve. */
const BOWL_SAG = 12
/** The spectators' tunics, all on the scenery tier; their faces and arms are sand. */
const TUNICS = [C.rust2, C.rust3, C.heather2, C.lagoon2, C.dusk2, C.slate2, C.moss3, C.sand1] as const

/** The far wall's rows, top to bottom, before the bowl's sag is added. */
const ROW = { cornice: 13, arcade: 16, balcony: 36, seats: 40, rail: 67, wall: 71 } as const
/** The arcade: one arch every `ARCH` px of wall, its opening `OPEN` px wide. */
const ARCH = 22
const OPEN = 12
/** Seat rows, `SEAT` px apart, one spectator every `SPOT` px along each. */
const SEAT = 9
const SPOT = 6

function sagAt(x: number): number {
    const d = (x - BOWL_X) / 170
    return R(d * d * BOWL_SAG)
}

/** The arcade at column `x`: piers lit on their sunward face, tall round-headed openings in shade. */
function arcadeColumn(s: Surface, x: number, top: number, bottom: number, u: number): void {
    const lo = (ARCH - OPEN) >> 1
    if (u < lo || u >= lo + OPEN) {
        rect(s, x, top, 1, bottom - top, u === 0 ? C.rock3 : C.rock2)
        return
    }
    // a round head: the opening starts lower toward its jambs
    const k = u - lo
    const edge = Math.min(k, OPEN - 1 - k)
    const head = edge === 0 ? 4 : edge === 1 ? 2 : edge === 2 ? 1 : 0
    rect(s, x, top, 1, 2 + head, C.rock2)
    rect(s, x, top + 2 + head, 1, bottom - top - 2 - head, k === OPEN - 1 ? C.rock1 : C.rock0)
    // a keystone over each opening's crown
    if (k === (OPEN >> 1) || k === (OPEN >> 1) - 1) s.set(x, top, C.rock3)
}

/** The stepped seating at column `x`: benches, and the wall's face between them. */
function seatColumn(s: Surface, x: number, top: number, bottom: number): void {
    for (let y = top; y < bottom; y++) {
        const r = (y - top) % SEAT
        s.set(x, y, r === SEAT - 2 ? C.rock3 : r === SEAT - 1 ? C.rock1 : C.rock2)
    }
}

/**
 * One spectator seated on a bench whose edge is at `y`: a head, shoulders in a tunic, and for the
 * excited ones arms thrown up on the loop. About 6 px of person, right for their distance.
 */
function spectator(s: Surface, x: number, y: number, h: number, f: number): void {
    const tunic = TUNICS[Math.floor(h * 89) % TUNICS.length]!
    const cheer = h > 0.7 && (f + Math.floor(h * 16)) % 8 < 4
    const up = cheer ? 1 : 0
    rect(s, x - 1, y - 4 - up, 3, 3, tunic)
    rect(s, x, y - 6 - up, 1, 2, h > 0.4 ? C.sand3 : C.sand2)
    px(s, x + 1, y - 6 - up, h > 0.4 ? C.sand2 : C.rust3)
    if (cheer) { px(s, x - 2, y - 7, C.sand3); px(s, x + 2, y - 7, C.sand3) }
}

/** A banner down the arena wall: crimson cloth, a gold band and device, a swallowtail hem. */
function banner(s: Surface, x: number, top: number, len: number): void {
    rect(s, x - 5, top, 11, len, C.rust2)
    rect(s, x - 5, top, 2, len, C.rust3)
    rect(s, x + 4, top, 2, len, C.rust1)
    rect(s, x - 5, top + 3, 11, 1, C.sand3)
    // the device: a gold laurel ring
    for (const [dx, dy] of [[0, -3], [2, -2], [3, 0], [2, 2], [0, 3], [-2, 2], [-3, 0], [-2, -2]] as const) px(s, x + dx, top + 11 + dy, C.sand3)
    rect(s, x - 5, top + len, 4, 3, C.rust2)
    rect(s, x + 2, top + len, 4, 3, C.rust2)
    rect(s, x - 7, top - 1, 15, 2, C.rock3)
}

/** A gate in the arena wall: a deep round-headed arch, its portcullis raised a third of the way. */
function gate(s: Surface, x: number, base: number): void {
    const w = 13
    rect(s, x - w - 2, base - 32, 2 * w + 5, 32, C.rock3)
    rect(s, x - w, base - 26, 2 * w + 1, 26, C.rock0)
    for (let i = 0; i <= w; i++) {
        const head = R(5 * (1 - Math.sqrt(1 - (i / w) ** 2)))
        rect(s, x - i, base - 31 + head, 1, 5 - head, C.rock0)
        rect(s, x + i, base - 31 + head, 1, 5 - head, C.rock0)
    }
    for (let i = -w + 2; i <= w - 2; i += 4) rect(s, x + i, base - 30, 1, 18, C.rock1)
    rect(s, x - w, base - 13, 2 * w + 1, 1, C.rock1)
    rect(s, x - w, base - 21, 2 * w + 1, 1, C.rock1)
    // its voussoirs, lit on the left
    rect(s, x - w - 2, base - 32, 2, 32, C.sand3)
}

/** A brazier on its pedestal, the fire flickering through four shapes on the loop. */
function brazier(s: Surface, x: number, base: number, f: number): void {
    rect(s, x - 3, base - 26, 7, 26, C.rock2)
    rect(s, x - 3, base - 26, 2, 26, C.rock3)
    rect(s, x - 5, base - 28, 11, 2, C.rock3)
    poly(s, [-7, 0, 7, 0, 4, 5, -4, 5], x, base - 34, C.rust1)
    rect(s, x - 7, base - 34, 15, 1, C.sand3)
    const k = f & 3
    const flame: readonly (readonly number[])[] = [
        [-5, 0, -3, -7, 0, -12, 2, -6, 5, 0],
        [-5, 0, -1, -9, 1, -13, 3, -5, 5, 0],
        [-5, 0, -4, -6, -1, -11, 3, -7, 5, 0],
        [-5, 0, -2, -8, 2, -12, 4, -6, 5, 0]
    ]
    poly(s, flame[k]!, x, base - 34, C.orange)
    poly(s, [-3, 0, -1, -6, 1, -8, 3, 0], x + (k === 2 ? -1 : 0), base - 34, C.gold2)
    px(s, x + (k & 1), base - 36, C.gold3)
    // an ember lifting off, one per loop step
    px(s, x - 2 + ((f * 3) % 5), base - 47 - (f % 4) * 2, (f & 1) ? C.gold2 : C.orange)
}

/**
 * The colosseum from its sand, late in the afternoon: the velarium stretched over the far rim, a tall
 * arcade, the packed seating below it with the crowd on its feet in places, the emperor's box under a
 * striped awning, and the arena wall round the sand with its gates and banners. The light comes from
 * the left, so piers, cornices and the wall's blocks are lit on that side.
 */
export const colosseum: WorldScene = {
    id: 'arena_colosseum',
    tiered: true,
    draw(s, sc, t) {
        const f = loopFrame(t)
        sky(s, [C.sky1, C.sky2, C.dusk3], [0, 8, 20])

        // the far side of the bowl, column by column so its rows can sag toward the edges
        for (let x = 0; x < SW; x++) {
            const off = sagAt(x)
            const y = (row: number) => row + off
            const u = mod(Math.floor(x + sc * 0.06), ARCH)
            rect(s, x, y(ROW.cornice), 1, 3, C.rock2)
            s.set(x, y(ROW.cornice), C.rock3)
            arcadeColumn(s, x, y(ROW.arcade), y(ROW.balcony), u)
            rect(s, x, y(ROW.balcony), 1, 4, C.rock2)
            s.set(x, y(ROW.balcony), C.rock3)
            seatColumn(s, x, y(ROW.seats), y(ROW.rail))
            rect(s, x, y(ROW.rail), 1, 4, C.rock3)
            s.set(x, y(ROW.rail) + 3, C.rock1)
            // the arena wall: pale stone in courses, its foot in its own shadow
            const top = y(ROW.wall)
            rect(s, x, top, 1, GROUND - top, C.sand1)
            for (let yy = top + 6; yy < GROUND - 2; yy += 6) {
                s.set(x, yy, C.rock1)
                // the blocks' vertical joints, staggered a course at a time, lit on their left
                const jx = mod(Math.floor(x + sc * 0.1) + (((yy - top) / 6) & 1) * 9, 18)
                if (jx === 0) for (let k = 1; k < 6 && yy + k < GROUND - 2; k++) s.set(x, yy + k, C.rock1)
                if (jx === 1) for (let k = 1; k < 6 && yy + k < GROUND - 2; k++) s.set(x, yy + k, C.sand2)
            }
            rect(s, x, top, 1, 2, C.rock3)
            rect(s, x, GROUND - 3, 1, 3, C.rock1)
        }

        // the crowd, row by row, a head every few px; the front row nearest and fullest
        for (let row = 0; row < 3; row++) {
            const bench = ROW.seats + (row + 1) * SEAT - 2
            const ox = sc * 0.06 + row * 3
            for (let k = Math.floor(ox / SPOT) - 1; k * SPOT - ox < SW + SPOT; k++) {
                const x = R(k * SPOT - ox)
                const h = hash2(k * 5 + row, 821)
                if (h < 0.12) continue
                spectator(s, x, bench + sagAt(x), h, f)
            }
        }

        // the velarium: sailcloth over the far rim, sagging between its ropes
        for (let x = 0; x < SW; x++) {
            const k = mod(x + sc * 0.03, 56)
            const sag = R(Math.sin((k / 56) * Math.PI) * 4)
            rect(s, x, 0, 1, 6 + sag, k < 28 ? C.sand3 : C.sand2)
            s.set(x, 6 + sag, C.sand1)
        }
        band(sc * 0.03, 56, 813, (x) => {
            line(s, x, 6, x - 7, ROW.cornice, C.rock2)
            line(s, x, 6, x + 7, ROW.cornice, C.rock2)
        })

        // the emperor's box over the middle, broken out of the seating under a striped awning
        const bx = R(BOWL_X - sc * 0.06)
        const by = ROW.seats + 4
        rect(s, bx - 25, by, 51, ROW.rail - by + 4, C.rock2)
        rect(s, bx - 25, by, 2, ROW.rail - by + 4, C.rock3)
        rect(s, bx - 20, by + 8, 41, ROW.rail - by - 6, C.rock0)
        for (let i = 0; i < 13; i++) poly(s, [0, 0, 4, 0, 4, 6, 2, 8, 0, 6], bx - 26 + i * 4, by - 6, i & 1 ? C.sand3 : C.rust2)
        rect(s, bx - 26, by - 7, 53, 1, C.rust1)
        for (const k of [-1, 1]) {
            rect(s, bx + k * 30, by - 14, 2, 30, C.rock3)
            poly(s, [0, 0, 7, 3, 0, 6], bx + k * 30 + 2, by - 14, C.rust2)
            px(s, bx + k * 30, by - 15, C.sand3)
        }
        // the emperor and his court at the rail
        for (const [dx, c] of [[-12, C.dusk2], [-5, C.rust3], [0, C.sand3], [6, C.heather2], [13, C.lagoon2]] as const) {
            rect(s, bx + dx - 1, by + 14, 4, 5, c)
            rect(s, bx + dx, by + 11, 2, 3, C.sand3)
        }
        rect(s, bx - 1, by + 10, 4, 1, C.sand3)
        rect(s, bx - 20, ROW.rail - 1, 41, 2, C.rock3)

        // gates and banners along the arena wall
        band(sc * 0.1, 76, 814, (x, k) => {
            if (k % 2) gate(s, x, GROUND)
            else banner(s, x, ROW.wall + sagAt(x) + 2, 24)
        })

        // the sand: the wall's shadow at its far edge, raked lines across it, warmer toward the light
        strata(s, GROUND, LIP, [C.sand2, C.sand2, C.sand3], [0, 10, 36])
        dither(s, 0, GROUND, SW, 4, C.sand1, 8)
        dither(s, 0, GROUND + 4, SW, 5, C.sand1, 4)
        for (let r = 0; r < 7; r++) {
            const y = GROUND + 10 + r * 6 + (r * r) / 3
            for (let x = 0; x < SW; x++) {
                const wx = x + sc * (0.6 + r * 0.06)
                if (mod(Math.floor(wx), 11) < 8) s.set(x, R(y + Math.sin(wx * 0.035 + r) * 1.4), C.sand1)
            }
        }
        scatter(sc, GROUND + 8, FLOOR_Y + 6, 4, 52, 815, (x, y, k, r) => {
            if (r < 0.5) {
                // a trail of footprints
                for (let i = 0; i < 4; i++) { px(s, x + i * 5, y - (i & 1), C.sand1); px(s, x + i * 5 + 1, y - (i & 1), C.sand1) }
            } else if (k % 5 === 0) {
                // a spear left standing in the sand, leaning
                line(s, x, y, x + 8, y - 20, C.rust1)
                line(s, x + 1, y, x + 9, y - 20, C.rust2)
                poly(s, [0, 0, 2, -5, 3, 0], x + 8, y - 20, C.rock3)
            } else if (k % 5 === 2) {
                // a dropped round shield
                ellipse(s, x, y - 2, 5, 3, C.rust1)
                ellipse(s, x, y - 2, 3, 2, C.rust2)
                px(s, x, y - 2, C.sand3)
            } else if (k % 5 === 3) {
                ellipse(s, x, y - 1, 3, 2, C.rock2)
                px(s, x - 1, y - 2, C.rock3)
            }
        })
        // the near barrier, below the fight
        strata(s, LIP, SH, [C.sand1, C.rock1, C.rock0], [0, 4, 10])
        rect(s, 0, LIP + 4, SW, 1, C.rock2)

        // dust in the light, and birds over the rim on the live stage
        motes(s, t, 26, 816, [C.sand3, C.dusk3], -3, 4, 20, FLOOR_Y)
        if (clock.smooth) birds(s, t, sc)
    },
    front(s, sc, t) {
        const f = loopFrame(t)
        // a pillar at each edge reaching out of frame, a brazier in front of each
        framing(sc, (o) => {
            for (const x of [o + 14, o + 304]) {
                rect(s, x - 9, -4, 19, FRONT + 8, C.rock2)
                for (let i = -6; i <= 6; i += 4) rect(s, x + i, -4, 1, FRONT + 8, i < 0 ? C.rock3 : C.rock1)
                rect(s, x - 9, -4, 2, FRONT + 8, C.rock3)
                rect(s, x - 12, FLOOR_Y + 2, 25, 12, C.rock2)
                rect(s, x - 12, FLOOR_Y + 2, 25, 1, C.rock3)
            }
            brazier(s, o + 46, FLOOR_Y + 14, f)
            brazier(s, o + 276, FLOOR_Y + 14, f)
        })
    }
}
