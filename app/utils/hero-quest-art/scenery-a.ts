// Worlds 2–5 on Thornwick Vale's layout (scenery-kit.ts): a deep field for the three ranks, the
// backdrop rooted along its far edge, framing at both edges and something in front of the lip.
// Each is painted on the scenery tier in hues chosen away from its own enemies.

import { C } from './palette'
import type { Surface } from './surface'
import { rect, px, line, disc, ellipse, tri, dither, ditherDisc, ditherEllipse, hash2, bayer, poly, taper, dome } from './surface'
import { clock } from './vfx-kit'
import {
    SW, SH, FLOOR_Y, GROUND, LIP, FRONT, type WorldScene, R, mod, vnoise, sky, ridge, peaks, pine, band,
    drift, reflectWater, streakCloud, phase, loopFrame, framing, glow, scatter, flagstones, motes, strata, stars, plume, fireflies
} from './scenery-kit'

const TAU = Math.PI * 2

// ── 2. Mirewood ────────────────────────────────────────────────────────────────────

const MOON = { x: 92, y: 50 }

/**
 * A bald cypress: a buttressed trunk flaring into the water and a flat, ragged crown with moss
 * hanging from it. The moon is to the left, so the left edges carry the rim.
 */
function cypress(s: Surface, x: number, base: number, h: number, seed: number, body: number, rim: number, moss: number): void {
    const top = base - h
    taper(s, x, base, x + 1, top + 4, 5 + h * 0.06, 2, body)
    tri(s, x - 5 - h * 0.05, base, x + 6 + h * 0.05, base, x, base - h * 0.25, body)
    for (let i = 0; i < 4; i++) {
        const cx = x - 9 + i * 6 + R(hash2(seed, i) * 3)
        const cy = top + (i === 1 || i === 2 ? -2 : 1) + R(hash2(seed + 1, i) * 2)
        ellipse(s, cx, cy, 5 + h * 0.03, 2.5, body)
        line(s, cx - 4, cy - 2, cx + 1, cy - 3, rim)
    }
    line(s, x - 3, top + 6, x - 3 - R(h * 0.05), base - 2, rim)
    for (let i = 0; i < 9; i++) {
        const mx = x - 12 + i * 3
        const l = 3 + R(hash2(seed + 2, i) * h * 0.25)
        line(s, mx, top + 2, mx + (i & 1), top + 2 + l, moss)
    }
}

/**
 * Mirewood under a rising moon: a violet night over a drowned forest, the moon's halo through
 * a thin cloud, cypress stands receding into mist, a peat bog to fight on scattered with black
 * pools and cypress knees, and the black water in front mirroring it all. Great trunks hung
 * with moss frame both edges. The bog is peat and moss so the teal Bog Lurkers stand out of it.
 */
export const mirewood: WorldScene = {
    id: 'world_mirewood',
    water: FRONT,
    glitter: MOON.x,
    tiered: true,
    draw(s, sc, t) {
        const ph = phase(t)
        const f = loopFrame(t)
        sky(s, [C.void, C.night0, C.heather0, C.heather1, C.dusk1, C.dusk2], [0, 16, 36, 58, 78, 94])
        stars(s, t, 36, 201, 46, C.heather2, C.ice3)
        glow(s, MOON.x, MOON.y, 14, C.heather2, C.ice3, C.white)
        disc(s, MOON.x + 4, MOON.y + 3, 3, C.ice2)
        disc(s, MOON.x - 5, MOON.y - 5, 2, C.ice2)
        px(s, MOON.x + 6, MOON.y - 6, C.ice2)
        for (let i = 0; i < 4; i++) {
            const wind = clock.smooth ? t * (1.2 + i * 0.4) : 0
            const x = mod(hash2(i, 202) * (SW + 80) - sc * 0.04 - wind, SW + 80) - 60
            streakCloud(s, R(x), 40 + i * 13, 34 + R(hash2(i, 203) * 40), C.heather1, C.dusk2, C.heather0)
        }
        // far canopy, then two stands of cypress receding into mist
        ridge(s, sc * 0.08, 96, 16, 22, 204, C.heather1, C.dusk1, SH, 0.5)
        dither(s, 0, 84, SW, 16, C.dusk2, 3)
        band(sc * 0.18, 30, 205, (x, k, r) => cypress(s, x, 104, 22 + R(r * 12), k, C.heather1, C.dusk1, C.heather2))
        dither(s, 0, 94, SW, 12, C.dusk2, 4)
        band(sc * 0.32, 52, 206, (x, k, r) => cypress(s, x, GROUND + 1, 38 + R(r * 18), k + 50, C.heather0, C.dusk1, C.rock2))
        // the mist the stand wades in, pooling along the far edge of the bog
        dither(s, 0, GROUND - 8, SW, 6, C.heather2, 3)
        dither(s, 0, GROUND - 2, SW, 3, C.heather2, 6)
        // the bog: moss at the far edge, peat nearer, broken by black pools that catch the moon
        strata(s, GROUND, LIP, [C.moss1, C.rust1], [0, 22])
        dither(s, 0, GROUND, SW, 3, C.heather2, 4)
        scatter(sc, GROUND + 6, FLOOR_Y + 6, 5, 58, 207, (x, y, k, r) => {
            const w = 8 + R(r * 14)
            ellipse(s, x, y, w, 1.5 + (y - GROUND) * 0.04, C.slate0)
            rect(s, x - w + 2, R(y - 1), w, 1, C.slate1)
            if ((f + k * 3) % 8 < 5) px(s, x - R(w * 0.3), y, C.ice3)
        })
        // reeds and cattails, cypress knees
        scatter(sc, GROUND + 3, FLOOR_Y + 8, 5, 17, 208, (x, y, k, r) => {
            const h = 2 + R(r * 2) + (y > FLOOR_Y - 10 ? 1 : 0)
            line(s, x, y, x + (k & 1), y - h, r < 0.5 ? C.moss3 : C.moss1)
            if (r > 0.6) line(s, x + 2, y, x + 3, y - h + 1, C.moss3)
            if (r > 0.85) { px(s, x + (k & 1), y - h - 1, C.rust2); px(s, x + (k & 1), y - h - 2, C.rust2) }
        })
        scatter(sc, GROUND + 8, FLOOR_Y, 3, 70, 209, (x, y, _k, r) => {
            const h = 3 + R(r * 3)
            tri(s, x - 2, y, x + 2, y, x, y - h, C.rock1)
            px(s, x - 1, y - h + 1, C.rock2)
        })
        // the bank, then the black water
        rect(s, 0, LIP, SW, FRONT - LIP, C.rust0)
        rect(s, 0, LIP, SW, 1, C.moss1)
        rect(s, 0, FRONT - 2, SW, 2, C.moss0)
        reflectWater(s, FRONT, t, MOON.x)
        // will-o'-wisps hanging in the mist, and fireflies over the bog
        for (let i = 0; i < 3; i++) {
            const a = (ph + i / 3) * TAU
            const x = R(mod(60 + i * 110 - sc * 0.32, SW) + Math.cos(a) * 3)
            const y = R(GROUND - 12 + Math.sin(a * 2) * 2)
            ditherDisc(s, x, y, 3, C.lagoon3, 5)
            px(s, x, y, C.ice3)
        }
        fireflies(s, ph, 16, 210, GROUND + 4, FLOOR_Y - 4)
        if (clock.smooth) drift(s, t, 10, 211, [C.heather3, C.sand3], -1, -4, GROUND - 30, FLOOR_Y - 2)
    },
    front(s, sc, _t) {
        // the great trunks at both edges, hung with moss from above the frame
        framing(sc, (o) => {
            for (const [x, w] of [[28, 14], [292, 16]] as const) {
                const tx = o + x
                taper(s, tx, FLOOR_Y + 12, tx - 2, -4, w, w * 0.6, C.heather0)
                tri(s, tx - w - 6, FLOOR_Y + 12, tx + w + 6, FLOOR_Y + 12, tx, FLOOR_Y - 26, C.heather0)
                line(s, tx - w * 0.5 + 1, -2, tx - w * 0.5 - 4, FLOOR_Y + 8, C.dusk1)
                line(s, tx - w * 0.3, 20, tx - w * 0.3 - 1, FLOOR_Y - 10, C.heather1)
                for (let i = 0; i < 16; i++) {
                    const mx = tx - 20 + i * 3
                    const l = 10 + R(hash2(i, x) * 50)
                    line(s, mx, 0, mx + (i % 3 === 0 ? 1 : 0), l, i % 4 === 0 ? C.moss1 : C.rock2)
                }
            }
        })
    }
}

// ── 3. Cinderpass ──────────────────────────────────────────────────────────────────

/** The far volcano, awake at the crater: a glow, smoke and spat bombs, no flow. */
const CRATER = { x: 84, y: 64 }
/** The near volcano, quieter at the top, with a lava stream breaching its rim and winding down. */
const STREAM = { x: 222, y: 46 }

/** A cone with its crater at (x, y), lit on the right, `w` wide at `h` below the rim. */
function cone(s: Surface, x: number, y: number, rim: number, w: number, h: number): void {
    poly(s, [-w, h, -rim, 0, rim, 0, w, h], x, y, C.rock0)
    poly(s, [rim, 0, w, h, R(w * 0.35), h], x, y, C.rock1)
    for (let i = 0; i < 5; i++) {
        const u = (i + 1) / 6
        const gx = R(x - rim + (i - 2) * 4 * u - (i - 2) * rim * 0.2)
        line(s, gx, y + 3, R(gx + (i - 2) * w * 0.25 * u), R(y + h * u), C.ink)
    }
}

/** The far volcano: a glowing crater throwing up smoke and lava bombs. */
function activeVolcano(s: Surface, x: number, y: number, ph: number): void {
    ditherDisc(s, x, y - 4, 34, C.red1, 3)
    ditherDisc(s, x, y - 2, 18, C.lava0, 5)
    plume(s, x, y - 2, ph, 8, 6, 2, C.rock1, C.rust2)
    cone(s, x, y, 8, 58, 44)
    ellipse(s, x, y, 8, 2, C.lava0)
    rect(s, x - 6, y - 1, 13, 2, C.lava1)
    rect(s, x - 4, y - 1, 9, 1, C.gold2)
    const pulse = Math.sin(ph * Math.PI * 2) > 0
    rect(s, x - 2, y - 2, 5, 1, pulse ? C.gold3 : C.gold2)
    dither(s, x - 10, y + 1, 21, 3, C.rust2, 6)
    for (let i = 0; i < 5; i++) {
        const u = (ph + i / 5) % 1
        const dir = i & 1 ? 1 : -1
        const bx = R(x + dir * u * (18 + i * 6))
        const by = R(y - 3 - 60 * u + 70 * u * u)
        px(s, bx, by, C.gold3); px(s, bx - dir, by + 1, C.lava1); px(s, bx - dir * 2, by + 2, C.lava0)
    }
}

/**
 * The near volcano: a thin smoke off the rim and one broad lava stream breaching it, winding down
 * the shaded flank and widening as it goes, hot pulses running down it on the loop.
 */
function streamVolcano(s: Surface, x: number, y: number, ph: number, f: number): void {
    ditherDisc(s, x - 22, y + 34, 40, C.red0, 4)
    plume(s, x + 2, y - 2, ph, 6, 6, 3, C.rock2, C.rock1)
    cone(s, x, y, 11, 88, 64)
    ellipse(s, x, y, 11, 2, C.rock0)
    rect(s, x - 9, y - 1, 19, 1, C.rust2)
    // the stream: a winding centreline from the breach to the foot, drawn as stacked spans
    const len = 62
    for (let i = 0; i <= len; i++) {
        const u = i / len
        const cx = x - 6 - u * 40 + Math.sin(u * 7) * 5
        const cy = y + 1 + u * 61
        const w = 1.5 + u * 4
        dither(s, R(cx - w - 3), R(cy), R(w * 2 + 6), 1, C.red1, 6)
        rect(s, R(cx - w), R(cy), R(w * 2) + 1, 2, C.lava0)
        rect(s, R(cx - w + 1), R(cy), Math.max(1, R(w * 2) - 1), 2, C.lava1)
        const hot = mod(i - f * 2, 12)
        if (hot < 2) rect(s, R(cx - w * 0.5), R(cy), Math.max(1, R(w)), 1, C.gold2)
        if (hot === 0) px(s, R(cx), R(cy), C.gold3)
        if (i % 9 === 4) px(s, R(cx + w * 0.4), R(cy), C.orange)
    }
    // the breach in the rim, and the fan of lava pooling at the foot
    rect(s, x - 8, y - 1, 5, 3, C.gold2)
    px(s, x - 6, y - 1, C.gold3)
    ditherEllipse(s, x - 46, y + 63, 12, 3, C.lava1, 10)
}

/** A cluster of hexagonal basalt columns rising from `base`, lit on the side facing the lava. */
function basalt(s: Surface, x: number, base: number, n: number, h: number, seed: number, facing: 1 | -1): void {
    for (let i = 0; i < n; i++) {
        const cx = x + (i - (n - 1) / 2) * 7
        const ch = h * (0.55 + hash2(seed, i) * 0.45)
        const top = R(base - ch)
        rect(s, cx - 3, top, 7, base - top, C.rock0)
        rect(s, facing > 0 ? cx + 1 : cx - 3, top + 2, 3, base - top - 2, C.rock1)
        rect(s, cx - 3, top, 7, 2, C.rock2)
        rect(s, facing > 0 ? cx + 3 : cx - 3, top + 2, 1, base - top - 2, C.rust2)
        for (let k = 0; k < 3; k++) rect(s, cx - 3, top + 8 + R(hash2(seed + k, i) * (ch - 10)), 7, 1, C.rock0)
    }
}

/**
 * Cinderpass at the height of an eruption: a smoke-choked sky burning red at the horizon, the
 * volcano throwing an ash plume lit from below and bombs of lava, black peaks, cliffs with lava
 * falls, the kobolds' skull banners along the far edge of an ash-and-basalt pass with glowing
 * cracks, basalt columns framing it and a lava river in front. The field is cool grey rock, so
 * the orange kobolds read off it.
 */
export const cinderpass: WorldScene = {
    id: 'world_cinderpass',
    tiered: true,
    draw(s, sc, t) {
        const ph = phase(t)
        const f = loopFrame(t)
        sky(s, [C.ink, C.rust0, C.red0, C.rust1, C.red1, C.rust2], [0, 14, 34, 56, 76, 92])
        // regular black peaks, furthest back, then the two volcanoes in front of them
        peaks(s, sc * 0.06, 104, 64, 303, C.rock0, C.ink, null)
        for (let i = 0; i < 5; i++) {
            const wind = clock.smooth ? t * (1.5 + i * 0.5) : 0
            const x = mod(hash2(i, 301) * (SW + 80) - sc * 0.05 - wind, SW + 80) - 60
            streakCloud(s, R(x), 14 + i * 11, 40 + R(hash2(i, 302) * 50), C.rock1, C.rust2, C.rock0)
        }
        activeVolcano(s, R(CRATER.x - sc * 0.035), CRATER.y, ph)
        streamVolcano(s, R(STREAM.x - sc * 0.05), STREAM.y, ph, f)
        ridge(s, sc * 0.22, 104, 24, 50, 304, C.rock1, C.rust2, SH, 0.3)
        band(sc * 0.22, 110, 305, (x) => {
            for (let y = 82; y < GROUND; y++) {
                const w = y > 100 ? 2 : 1
                rect(s, x, y, w, 1, mod(y - f * 3, 8) < 2 ? C.gold2 : C.lava1)
            }
            ditherEllipse(s, x, GROUND - 2, 8, 3, C.lava0, 6)
        })
        dither(s, 0, 96, SW, 14, C.rust1, 3) // haze of ash off the cliffs
        // kobold skull banners and braziers along the far edge of the pass
        band(sc * 0.45, 64, 306, (x, k) => {
            if (k % 3 === 2) {
                rect(s, x - 3, GROUND - 6, 7, 6, C.rock0)
                rect(s, x - 4, GROUND - 7, 9, 2, C.rock1)
                const fl = (f + k) & 3
                tri(s, x - 3, GROUND - 7, x + 3, GROUND - 7, x + (fl & 1), GROUND - 13 - fl, C.lava1)
                tri(s, x - 1, GROUND - 7, x + 2, GROUND - 7, x, GROUND - 10 - fl, C.gold2)
                return
            }
            line(s, x, GROUND, x, GROUND - 26, C.brown1, 2)
            disc(s, x, GROUND - 28, 2.5, C.bone1)
            px(s, x - 1, GROUND - 28, C.ink); px(s, x + 1, GROUND - 28, C.ink)
            line(s, x - 2, GROUND - 24, x + 2, GROUND - 25, C.bone0)
            const wave = (f >> 2) & 1
            poly(s, [0, 0, 11, 1 + wave, 9, 5, 11, 10 - wave, 0, 9], x + 1, GROUND - 23, C.red1)
            line(s, x + 1, GROUND - 23, x + 11, GROUND - 22 + wave, C.red2)
        })
        // the pass: ash-grey basalt, dusted paler at the far edge where the fall settles
        rect(s, 0, GROUND, SW, LIP - GROUND, C.rock1)
        rect(s, 0, GROUND, SW, 1, C.rust2)
        dither(s, 0, GROUND + 1, SW, 8, C.rust1, 8)
        dither(s, 0, GROUND + 9, SW, 8, C.rust1, 3)
        scatter(sc, GROUND + 6, FLOOR_Y + 8, 5, 46, 307, (x, y, k, r) => {
            // mounds of settled ash, and dark obsidian
            if (r < 0.5) {
                const w = 5 + R(r * 10)
                ellipse(s, x, y, w, 1.5, C.rock2)
                rect(s, x - w + 2, R(y) - 1, w, 1, C.rock3)
            } else {
                tri(s, x - 3, y + 1, x + 3, y + 1, x + (k & 1), y - 3, C.slate0)
                px(s, x + (k & 1), y - 2, C.slate3)
            }
        })
        // cracks in the rock, glowing and cooling on the loop
        scatter(sc, GROUND + 10, FLOOR_Y + 6, 3, 130, 308, (x, y, k) => {
            const hot = (f + k * 4) % 16 < 8
            ditherEllipse(s, x + 10, y, 14, 3, C.rust1, 6)
            let cx = x - 2
            let cy = y
            for (let i = 0; i < 5; i++) {
                const nx = cx + 3 + R(hash2(k, i) * 4)
                const ny = y + R((hash2(k + 1, i) - 0.5) * 4)
                line(s, cx, cy + 1, nx, ny + 1, C.rust1)
                line(s, cx, cy, nx, ny, hot || i === 2 ? C.sand3 : C.rust3)
                if (i === 1) line(s, nx, ny, nx + 1, ny + 3, C.rust3)
                cx = nx
                cy = ny
            }
        })
        // the lip, and the lava river beyond it
        rect(s, 0, LIP, SW, FRONT - LIP, C.rock0)
        rect(s, 0, LIP, SW, 1, C.rock2)
        dither(s, 0, FRONT - 3, SW, 3, C.lava0, 8)
        for (let y = FRONT; y < SH; y++) {
            for (let x = 0; x < SW; x++) {
                const w = Math.sin((x + sc) * 0.09 - y * 0.5 + ph * TAU) + Math.sin((x + sc) * 0.037 + y * 0.3 - ph * TAU) * 0.6
                s.set(x, y, w > 1.2 ? C.gold3 : w > 0.7 ? C.gold2 : w > 0 ? C.lava1 : w > -0.9 ? C.orange : C.lava0)
            }
        }
        if (clock.smooth) {
            for (let i = 0; i < 6; i++) {
                const x = R(mod(hash2(i, 311) * SW - sc - t * 6, SW + 20) - 10)
                const y = FRONT + 2 + (i % 3) * 5
                rect(s, x, y, 5 + (i & 1) * 3, 2, C.rock0)
                rect(s, x + 1, y, 3, 1, C.rock1)
            }
        }
        motes(s, t, 24, 312, [C.sand3, C.rust3], -16, 3)
        if (clock.smooth) drift(s, t, 14, 313, [C.gold2, C.orange], -24, 5, 0, FRONT)
    },
    front(s, sc, _t) {
        // basalt columns framing the pass
        framing(sc, (o) => {
            basalt(s, o + 26, FLOOR_Y + 12, 5, 120, 309, 1)
            basalt(s, o + 292, FLOOR_Y + 12, 4, 130, 310, -1)
        })
    }
}

// ── 4. Rimeholt ────────────────────────────────────────────────────────────────────

/** An aurora curtain: a sharp bright lower edge with rays rising off it, swaying on the loop. */
function aurora(s: Surface, sc: number, ph: number, y: number, amp: number, seed: number, len: number): void {
    for (let x = 0; x < SW; x++) {
        const wx = x + sc * 0.03
        const edge = R(y + Math.sin(wx * 0.022 + ph * TAU + seed) * amp + Math.sin(wx * 0.009 + seed * 2) * amp * 1.4)
        const ray = 0.55 + 0.45 * Math.sin(wx * 0.31 + Math.sin(ph * TAU + wx * 0.05) * 2)
        const l = R(len * (0.5 + 0.5 * ray))
        for (let k = 0; k < l; k++) {
            const u = k / l
            const lv = R((1 - u) * 15 * ray) + (k < 3 ? 6 : 0)
            if (bayer(x, edge - k, lv)) s.set(x, edge - k, k < 2 ? C.ice3 : u < 0.35 ? C.lagoon3 : u < 0.7 ? C.lagoon2 : C.heather2)
        }
    }
}

/** A snow-laden pine: stepped tiers, a moonlit edge, snow along each tier's upper face. */
function snowPine(s: Surface, x: number, base: number, h: number): void {
    const tiers = Math.floor(h / 9)
    // The trunk first, so the lowest tier hangs over its top instead of the trunk painting
    // over the foliage; it runs from under that tier to the ground, however tall the tree.
    const bottom = base - h + (tiers - 1) * 8 + 12
    const hw = h > 80 ? 2 : 1
    rect(s, x - hw, bottom - 3, hw * 2 + 1, base - bottom + 5, C.rust0)
    rect(s, x - hw, bottom - 3, 1, base - bottom + 5, C.rust1)
    rect(s, x - hw - 2, base, hw * 2 + 5, 2, C.ice3)
    for (let k = 0; k < tiers; k++) {
        const ty = base - h + k * 8
        const w = 3 + k * 2.2
        tri(s, x - w, ty + 11, x + w, ty + 11, x, ty, C.moss0)
        rect(s, R(x - w), ty + 10, R(w * 2) + 1, 2, C.moss0)
        line(s, x, ty + 1, R(x - w * 0.9), ty + 10, C.ice2)
        line(s, x, ty + 2, R(x - w * 0.7), ty + 9, C.ice3)
        rect(s, R(x - w + 1), ty + 10, R(w * 1.2), 1, C.ice3)
    }
}

/**
 * A mountain range that is not all pyramids: each mountain is a sharp horn, a twin summit, a
 * lopsided shoulder or a broad rounded massif, with a ragged crest. The face toward the moon
 * (left) is lit, the far side shaded along a ridge line falling from the summit, and snow lies
 * down to a ragged line.
 */
function massif(s: Surface, ox: number, base: number, period: number, seed: number, body: number, shade: number, snow: number, snowShade: number): void {
    const k0 = Math.floor(ox / period) - 2
    const k1 = Math.floor((ox + SW) / period) + 2
    for (let x = 0; x < SW; x++) {
        const wx = x + ox
        let top = base
        let best = -1
        let sx = 0
        let hgt = 0
        for (let k = k0; k <= k1; k++) {
            const cx = (k + 0.2 + hash2(k, seed) * 0.6) * period
            const w = period * (0.6 + hash2(k, seed + 2) * 0.5)
            const H = period * (0.4 + hash2(k, seed + 1) * 0.45)
            const d = (wx - cx) / w
            if (d <= -1 || d >= 1) continue
            const kind = Math.floor(hash2(k, seed + 3) * 4)
            let v: number
            let peakX = cx
            if (kind === 0) v = 1 - Math.abs(d)
            else if (kind === 1) {
                v = Math.max(1 - Math.abs(d + 0.3) * 1.5, 0.82 * (1 - Math.abs(d - 0.32) * 1.5), 0)
                peakX = cx - 0.3 * w
            } else if (kind === 2) {
                v = d < 0 ? 1 - Math.pow(-d, 1.6) * 0.75 - (-d > 0.55 ? (-d - 0.55) * 0.6 : 0) : 1 - Math.pow(d, 0.75)
                peakX = cx
            } else v = Math.sqrt(1 - d * d) * 0.72 + (1 - Math.abs(d)) * 0.12
            v += (vnoise(wx, 5, seed + k) - 0.5) * 0.07 + (vnoise(wx, 15, seed + 5) - 0.5) * 0.08
            const y = base - H * v
            if (y < top) { top = y; best = k; sx = peakX; hgt = H }
        }
        const ty = R(top)
        if (ty >= base) continue
        const snowline = base - hgt * 0.5 + (hash2(wx >> 1, seed + 7) - 0.5) * 6 + Math.sin(wx * 0.3) * 2
        for (let y = ty; y < base; y++) {
            const shaded = wx > sx + (y - ty) * 0.35 + (best & 1 ? 2 : 0)
            let c = shaded ? shade : body
            if (y < snowline) c = shaded ? snowShade : snow
            s.set(x, y, c)
        }
        if (ty < base) s.set(x, ty, top < snowline ? snow : body)
    }
}

/** A longhouse: timber walls, a snow-heavy roof with carved gable beasts, a firelit door, smoke. */
function longhouse(s: Surface, x: number, base: number, f: number, ph: number): void {
    rect(s, x - 24, base - 14, 48, 14, C.rust1)
    for (let i = 0; i < 6; i++) rect(s, x - 23 + i * 8, base - 14, 1, 14, C.rust0)
    poly(s, [-30, 0, 0, -18, 30, 0], x, base - 13, C.slate1)
    poly(s, [-28, -1, 0, -17, 28, -1, 24, 1, -24, 1], x, base - 13, C.ice3)
    line(s, x - 30, base - 13, x, base - 31, C.ice2)
    // crossed gable beasts
    line(s, x - 1, base - 31, x + 3, base - 36, C.rust1)
    line(s, x + 1, base - 31, x - 3, base - 36, C.rust1)
    px(s, x + 4, base - 35, C.rust1); px(s, x - 4, base - 35, C.rust1)
    const lit = (f + (x & 3)) % 5 !== 0
    ditherEllipse(s, x, base - 4, 14, 6, C.rust3, 3)
    rect(s, x - 3, base - 9, 6, 9, lit ? C.sand3 : C.rust3)
    rect(s, x - 2, base - 8, 4, 8, C.rust3)
    rect(s, x - 16, base - 10, 3, 3, C.sand3)
    rect(s, x + 13, base - 10, 3, 3, lit ? C.sand3 : C.rust3)
    plume(s, x + 12, base - 30, ph, 6, 6, -2, C.slate2, C.ice2)
}

/**
 * Rimeholt at night under the aurora: stars, a small hard moon, green curtains of light
 * swaying over moonlit peaks, a pine treeline and the raiders' longhouses glowing along the
 * far edge of a snowfield, snow-laden pines framing it and a black fjord in front that mirrors
 * the aurora. The snow is a cool blue-white a step off the raiders' frost and lavender.
 */
export const rimeholt: WorldScene = {
    id: 'world_rimeholt',
    water: FRONT,
    tiered: true,
    draw(s, sc, t) {
        const ph = phase(t)
        const f = loopFrame(t)
        sky(s, [C.ink, C.night0, C.slate0, C.slate1, C.ice1], [0, 18, 40, 66, 90])
        stars(s, t, 60, 401, 80, C.slate3, C.ice3)
        glow(s, 58, 30, 6, C.slate2, C.ice3, C.white)
        aurora(s, sc, ph, 46, 6, 402, 34)
        aurora(s, sc, (ph + 0.5) % 1, 28, 4, 403, 16)
        // two ranges of moonlit peaks, a mist between them and the hold
        massif(s, sc * 0.08, 100, 84, 404, C.ice1, C.slate1, C.ice3, C.ice2)
        massif(s, sc * 0.15, 108, 58, 405, C.slate2, C.slate1, C.ice2, C.slate3)
        dither(s, 0, 96, SW, 12, C.ice2, 3)
        band(sc * 0.28, 7, 406, (x, _k, r) => pine(s, x, GROUND - 1, 7 + R(r * 9), C.moss0, C.ice2))
        band(sc * 0.4, 170, 407, (x) => longhouse(s, x, GROUND + 1, f, ph))
        band(sc * 0.4, 13, 408, (x, k) => {
            if (k % 13 > 9) return
            rect(s, x, GROUND - 7, 2, 8, C.rust1)
            px(s, x, GROUND - 8, C.rust2)
            px(s, x, GROUND - 7, C.ice3)
        })
        // the snowfield: shadowed toward the hold, moonlit nearer, carved by the wind
        // the snowfield lies in the mountains' shadow; only its far edge and the drift crests
        // catch the moon, which keeps the pale raiders brighter than the ground they cross
        rect(s, 0, GROUND, SW, LIP - GROUND, C.ice2)
        rect(s, 0, GROUND, SW, 2, C.ice3)
        dither(s, 0, GROUND + 2, SW, 4, C.ice3, 6)
        scatter(sc, GROUND + 4, FLOOR_Y + 8, 7, 16, 409, (x, y, k, r) => {
            const l = 5 + R(r * 9)
            rect(s, x, y, l, 1, C.ice3)
            rect(s, x + 1, y + 1, l - 1, 1, C.slate1)
            if (k % 4 === 0) rect(s, x + 2, y - 1, l - 3, 1, C.ice3)
        })
        scatter(sc, GROUND + 8, FLOOR_Y + 6, 3, 80, 410, (x, y, k) => {
            ellipse(s, x, y, 3 + (k & 1), 1.5, C.slate1)
            rect(s, x - 2, y - 2, 4 + (k & 1), 1, C.ice3)
        })
        // tracks crossing the field toward the hold
        scatter(sc, GROUND + 14, FLOOR_Y + 4, 2, 150, 411, (x, y) => {
            for (let i = 0; i < 6; i++) px(s, x + i * 4, y - i + (i & 1), C.ice2)
        })
        // a bank of snow, then the fjord
        rect(s, 0, LIP, SW, FRONT - LIP, C.ice3)
        rect(s, 0, FRONT - 2, SW, 2, C.ice2)
        dither(s, 0, LIP + 2, SW, 2, C.ice2, 4)
        reflectWater(s, FRONT, t)
        motes(s, t, 50, 412, [C.ice3, C.ice2], 14, -6)
        if (clock.smooth) drift(s, t, 40, 413, [C.white, C.frost], 22, -10)
    },
    front(s, sc, t) {
        const f = loopFrame(t)
        // snow-laden pines at both edges, and a rune stone
        framing(sc, (o) => {
            snowPine(s, o + 16, FLOOR_Y + 10, 104)
            snowPine(s, o + 38, FLOOR_Y + 12, 64)
            snowPine(s, o + 282, FLOOR_Y + 12, 70)
            snowPine(s, o + 302, FLOOR_Y + 10, 112)
            poly(s, [-5, 0, -4, -22, 0, -26, 4, -21, 5, 0], o + 56, FLOOR_Y + 12, C.slate1)
            line(s, o + 52, FLOOR_Y - 9, o + 54, FLOOR_Y - 12, C.slate3)
            for (let i = 0; i < 4; i++) px(s, o + 56 + (i & 1), FLOOR_Y - 6 + i * 3 - 4, (f + i * 4) % 16 < 10 ? C.lagoon3 : C.lagoon2)
            rect(s, o + 50, FLOOR_Y + 11, 13, 1, C.ice3)
        })
    }
}

// ── 5. Sunken Amarath ──────────────────────────────────────────────────────────────

/** A fluted column from `base` up to `top`, lit from the surface on its left. */
function column(s: Surface, x: number, base: number, top: number, w: number, body: number, lit: number, shade: number, capital: boolean): void {
    rect(s, x - w, top, w * 2 + 1, base - top, body)
    for (let i = -w + 2; i < w; i += 3) rect(s, x + i, top + 2, 1, base - top - 2, i < 0 ? lit : shade)
    rect(s, x - w, top, 2, base - top, lit)
    if (capital) {
        rect(s, x - w - 3, top - 3, w * 2 + 7, 3, body)
        rect(s, x - w - 3, top - 3, w * 2 + 7, 1, lit)
        rect(s, x - w - 1, top, w * 2 + 3, 1, shade)
    }
}

/** The sea-queen's colossus: a robed figure raising a trident, her crown broken, lit from above. */
function colossus(s: Surface, x: number, base: number, body: number, lit: number): void {
    rect(s, x - 18, base - 10, 36, 10, body)
    rect(s, x - 18, base - 10, 36, 1, lit)
    poly(s, [-13, 0, -7, -44, 7, -44, 13, 0], x, base - 10, body)
    line(s, x - 7, base - 54, x - 12, base - 12, lit)
    poly(s, [-8, 0, -9, -14, 9, -14, 8, 0], x, base - 54, body)
    disc(s, x, base - 73, 5, body)
    arcTop(s, x, base - 73, 5, lit)
    for (let i = -2; i <= 2; i++) if (i !== 1) line(s, x + i * 2, base - 78, x + i * 2, base - 81 - (i === 0 ? 2 : 0), body)
    // the raised arm and trident
    line(s, x + 8, base - 66, x + 16, base - 80, body, 3)
    line(s, x + 17, base - 102, x + 17, base - 40, body, 2)
    for (let i = -1; i <= 1; i++) line(s, x + 17 + i * 4, base - 102, x + 17 + i * 4, base - 108 + (i ? 2 : 0), body)
    rect(s, x + 13, base - 102, 9, 1, body)
    line(s, x - 8, base - 66, x - 14, base - 50, body, 3)
}

function arcTop(s: Surface, x: number, y: number, r: number, c: number): void {
    for (let a = Math.PI * 1.05; a <= Math.PI * 1.6; a += 0.15) px(s, x + Math.cos(a) * r, y + Math.sin(a) * r, c)
}

/** A kelp strand from `base`, swaying more toward its tip, with a leaf on alternate nodes. */
function kelp(s: Surface, x: number, base: number, h: number, ph: number, seed: number, stem: number, leaf: number): void {
    let px0 = x
    for (let i = 0; i < h; i++) {
        const u = i / h
        const sx = R(x + Math.sin(ph * TAU + seed + i * 0.12) * u * 4)
        rect(s, sx, base - i, 1, 1, stem)
        if (i % 5 === 3) { px(s, sx + (i & 2 ? 1 : -1), base - i, leaf); px(s, sx + (i & 2 ? 2 : -2), base - i - 1, leaf) }
        px0 = sx
    }
    px(s, px0, base - h, leaf)
}

/**
 * Sunken Amarath from the floor of the sea: the surface rippling far above, shafts of light
 * through green water, the drowned capital's domes and the sea-queen's colossus in the murk, a
 * kelp forest along the far edge of a sand-choked plaza washed with moving caustics, broken
 * columns framing it and steps falling away into the trench. The plaza is warm sand and stone,
 * the opposite of the teal Drowned Sailors.
 */
export const sunkenAmarath: WorldScene = {
    id: 'world_sunken_amarath',
    tiered: true,
    draw(s, sc, t) {
        const ph = phase(t)
        const f = loopFrame(t)
        sky(s, [C.lagoon3, C.lagoon2, C.lagoon1, C.lagoon0, C.slate0], [0, 8, 30, 60, 94])
        // the surface, far overhead
        for (let x = 0; x < SW; x++) {
            const y = R(3 + Math.sin(x * 0.12 + ph * TAU) * 1.5 + Math.sin(x * 0.05 - ph * TAU) * 1)
            rect(s, x, 0, 1, y, C.ice3)
            if (x % 5 !== (f >> 2)) px(s, x, y + 2, C.ice3)
        }
        ditherDisc(s, 70, -6, 34, C.ice3, 3)
        // shafts of light, breathing on the loop
        for (let i = 0; i < 6; i++) {
            const x0 = hash2(i, 501) * SW - sc * 0.03
            const w = 5 + R(hash2(i, 502) * 7)
            const pulse = 0.5 + 0.5 * Math.sin(ph * TAU + i * 1.7)
            for (let y = 4; y < GROUND; y++) {
                const lv = R((1 - y / GROUND) * (3 + pulse * 3))
                if (lv > 0) dither(s, R(mod(x0 + y * 0.35, SW + 40) - 20), y, w + (y >> 5), 1, C.lagoon3, lv)
            }
        }
        // the drowned capital in the murk, and the colossus over it
        band(sc * 0.08, 70, 503, (x, k, r) => {
            const b = 104
            if (k % 3 === 0) {
                rect(s, x - 12, b - 20, 25, 20, C.lagoon1)
                dome(s, x, b - 20, 12, 12, C.lagoon1)
                rect(s, x, b - 36, 1, 6, C.lagoon1)
            } else if (k % 3 === 1) {
                rect(s, x - 3, b - 44 - R(r * 16), 7, 44 + R(r * 16), C.lagoon1)
                dome(s, x, b - 44 - R(r * 16), 5, 6, C.lagoon1)
            } else {
                for (let i = 0; i < 4; i++) rect(s, x - 14 + i * 9, b - 22, 3, 22, C.lagoon1)
                rect(s, x - 16, b - 25, 32, 3, C.lagoon1)
            }
        })
        colossus(s, R(236 - sc * 0.12), GROUND - 4, C.lagoon1, C.lagoon2)
        dither(s, 0, 90, SW, 20, C.lagoon1, 3)
        // a colonnade nearer, broken off at different heights
        band(sc * 0.25, 30, 504, (x, k, r) => {
            if (k % 5 === 4) return
            const top = R(64 + r * 30)
            column(s, x, GROUND, top, 3, C.lagoon0, C.lagoon2, C.slate0, k % 3 !== 1)
        })
        // kelp and coral along the far edge
        band(sc * 0.45, 11, 505, (x, k, r) => kelp(s, x, GROUND, 18 + R(r * 34), ph, k, C.moss1, C.moss2))
        band(sc * 0.5, 40, 506, (x, k) => {
            for (let i = 0; i < 5; i++) {
                const a = -Math.PI * (0.2 + i * 0.15)
                line(s, x, GROUND, R(x + Math.cos(a) * 8), R(GROUND + Math.sin(a) * 9), k & 1 ? C.dusk2 : C.heather2)
                px(s, R(x + Math.cos(a) * 8), R(GROUND + Math.sin(a) * 9) - 1, k & 1 ? C.dusk3 : C.heather3)
            }
        })
        // the plaza: sand drifted over flagstones, and the caustic net sliding across it
        strata(s, GROUND, LIP, [C.sand1, C.sand2], [0, 16])
        flagstones(s, sc, GROUND + 2, LIP, 6, 34, C.sand1, C.sand2)
        for (let y = GROUND + 2; y < LIP; y++) {
            const d = (y - GROUND) / (LIP - GROUND)
            for (let x = 0; x < SW; x++) {
                const wx = (x + sc * (0.6 + 0.4 * d)) * (1.4 - d * 0.6)
                const c = Math.abs(Math.sin(wx * 0.19 + Math.sin(y * 0.45 + ph * TAU) * 1.4 + ph * TAU))
                    + Math.abs(Math.sin(y * 0.52 - wx * 0.07 - ph * TAU))
                if (c < 0.28) s.set(x, y, d < 0.25 ? C.sand2 : C.sand3)
            }
        }
        scatter(sc, GROUND + 4, FLOOR_Y + 6, 5, 36, 507, (x, y, k, r) => {
            if (r < 0.45) {
                for (let i = 0; i < 4; i++) line(s, x + i - 1, y, x + i * 2 - 3, y - 3 - (i & 1), C.moss2)
            } else if (r < 0.7) {
                px(s, x, y, C.dusk3); px(s, x + 1, y, C.sand3)
            } else if (k % 4 === 0) {
                ellipse(s, x, y - 2, 5, 3, C.rock2)
                rect(s, x - 5, y - 4, 10, 1, C.rock3)
                ellipse(s, x + 4, y - 2, 1, 2, C.rock1)
            }
        })
        // steps down from the plaza into the trench
        strata(s, LIP, SH, [C.sand1, C.rock1, C.lagoon0, C.slate0], [0, 5, 10, 15])
        for (let i = 0; i < 4; i++) rect(s, 0, LIP + i * 5, SW, 1, i < 2 ? C.sand2 : C.lagoon1)
        // bubbles rising, and a shoal crossing on the live stage
        motes(s, t, 20, 508, [C.lagoon3, C.ice3], -12, 0, 10, FLOOR_Y)
        if (clock.smooth) {
            const u = (t % 18) / 18
            for (let i = 0; i < 9; i++) {
                const x = R(-30 + u * (SW + 60) + (i % 3) * 6 + Math.floor(i / 3) * 3)
                const y = 40 + Math.floor(i / 3) * 4 + R(Math.sin(t * 2 + i) * 1.5)
                px(s, x, y, C.lagoon0); px(s, x - 1, y, C.lagoon0); px(s, x - 2, y - ((Math.floor(t * 8) + i) & 1), C.lagoon0)
            }
        }
    },
    front(s, sc, t) {
        const ph = phase(t)
        // broken columns at both edges, reaching up out of frame
        framing(sc, (o) => {
            column(s, o + 16, FLOOR_Y + 12, -4, 8, C.rock2, C.rock3, C.rock1, false)
            column(s, o + 44, FLOOR_Y + 12, 104, 5, C.rock2, C.rock3, C.rock1, false)
            poly(s, [-6, 0, 6, 0, 5, -3, 1, -6, -3, -2], o + 44, 104, C.rock2)
            column(s, o + 300, FLOOR_Y + 12, -4, 9, C.rock2, C.rock3, C.rock1, false)
            for (const [x, h] of [[8, 70], [27, 50], [290, 60], [312, 80]] as const) kelp(s, o + x, FLOOR_Y + 12, h, ph, x, C.moss1, C.moss2)
            for (let i = 0; i < 7; i++) px(s, o + 12 + (i % 3) * 4, 60 + i * 12, C.lagoon2)
        })
    }
}

