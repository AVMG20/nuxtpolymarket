// World backgrounds (asset-list §4): ten scenes, each drawn from the same theme line as that
// world's enemies, since "art is the only signal that the run has moved on."
//
// A scene is layered like Pixel Crusade's: dithered sky bands, a celestial, far and mid
// ridges on value noise, props, the floor the party stands on, and an ambient loop. `scroll`
// shifts each layer by its own parallax factor, so the battle can pan without re-authoring.
// Everything is laid out by hash of a tile index, so it tiles forever and never pops.

import { C } from './palette'
import type { Surface } from './surface'
import { rect, px, line, disc, tri, quad, dither, ditherDisc, hash2, poly } from './surface'
import { clock, qt } from './vfx-kit'
import { SW, FLOOR_Y, BG_LOOP, BG_FRAMES, type WorldScene, R, mod, sky, ridge, pine, band, drift, reflectWater, streakCloud, bigPine, fireflies, birds, framing } from './scenery-kit'
import { mirewood, cinderpass, rimeholt, sunkenAmarath } from './scenery-a'
import { duskspire, bonefields, shatteredSky, brink, theVoid } from './scenery-b'

export * from './scenery-kit'

// clump scratch for bush(), so drawing a scene never allocates
const CX = new Float32Array(4)
const CY = new Float32Array(4)
const CR = new Float32Array(4)

/**
 * A leafy bush, backlit: the low sun is behind the hedgerows, so the faces toward us sit in
 * cool shade (dark green → teal) and only the crowns catch a thin gold rim. Keeping them
 * darker and cooler than anything standing in front is what lets the fighters read — the
 * Bramble Goblins are the same greens a sunlit bush would be. Overlapping round clumps,
 * ragged single-leaf bumps on the rim, a few berries. `w` is the footprint; it stands on `base`.
 */
function bush(s: Surface, x: number, base: number, w: number, h: number, seed: number): void {
    const n = 3 + (w > 22 ? 1 : 0)
    for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0.5 : i / (n - 1)
        const mid = 1 - Math.abs(u - 0.5) * 2
        CR[i] = h * (0.42 + 0.28 * mid) + hash2(seed, i) * 1.5
        CX[i] = x - w / 2 + CR[i]! * 0.8 + u * (w - CR[i]! * 1.6)
        CY[i] = base - CR[i]! + 1
    }
    // dark body, a pixel fatter, then the ragged leaf edge
    for (let i = 0; i < n; i++) disc(s, CX[i]!, CY[i]!, CR[i]! + 1, C.moss0)
    for (let i = 0; i < n; i++) {
        for (let k = 0; k < 10; k++) {
            const a = -Math.PI * (0.05 + 0.9 * hash2(seed + i, k))
            const r = CR[i]! + 1.5
            px(s, CX[i]! + Math.cos(a) * r, CY[i]! + Math.sin(a) * r, C.moss0)
        }
    }
    rect(s, R(x - w / 2), base - 2, w, 3, C.moss0)
    // shade body in cool teal, a slightly lighter crown toward the sun
    for (let i = 0; i < n; i++) disc(s, CX[i]!, CY[i]!, CR[i]! - 0.5, C.lagoon0)
    for (let i = 0; i < n; i++) disc(s, CX[i]! + 1, CY[i]! - 2.5, CR[i]! - 4, C.lagoon1)
    for (let i = 0; i < n; i++) {
        // the backlight: a thin gold rim along each clump's upper-right edge
        const r = CR[i]! + 0.5
        for (let k = 0; k < 9; k++) {
            const a = -Math.PI * (0.08 + 0.42 * (k / 8))
            px(s, CX[i]! + Math.cos(a) * r, CY[i]! + Math.sin(a) * r, k < 3 ? C.sand3 : k < 6 ? C.sand2 : C.moss3)
        }
        // leaf texture in the shade: a few dark flecks
        for (let k = 0; k < 4; k++) px(s, CX[i]! - r * 0.6 + hash2(seed + 3, i * 5 + k) * r, CY[i]! + hash2(seed + 4, i * 5 + k) * r * 0.6, C.moss0)
    }
    // a couple of bramble berries
    for (let k = 0; k < 2; k++) {
        const i = (seed + k) % n
        const bx = R(CX[i]! - CR[i]! * 0.3 + k * 3)
        const by = R(CY[i]! + CR[i]! * 0.2)
        px(s, bx, by, C.rust2); px(s, bx + 1, by, C.rust1); px(s, bx, by - 1, C.rust3)
    }
}

// ── The ten worlds ─────────────────────────────────────────────────────────────────

const SUN = { x: 236, y: 74 }
/**
 * The millpond's edge. The formation stands three ranks deep rather than on one line, so the
 * field has to be deep enough to hold all three with room to spare at both ends: the water
 * gives up 10 rows from the bottom and the horizon 22 from the top (`TW_GROUND`). That still
 * leaves 15 rows of pond — 60% of what it had — which is enough for the reflection to read.
 */
const TW_WATER = FLOOR_Y + 15
/**
 * Far edge of the field: the treeline roots here. The rearmost rank stands 12 rows below it and
 * the nearest 6 above the bank, so no rank is crowded against an edge.
 */
const TW_GROUND = 110
/** Poppy heads scattered through the field — one warm, one gold, one violet, one pale. */
const POPPIES = [C.rust3, C.sand3, C.heather3, C.ice3] as const

/**
 * Thornwick Vale in the late afternoon, after the reference video: a blue sky warming to
 * gold at the horizon, clouds lit underneath, the sun low over the hills, windmills and a
 * pine treeline, leafy hedgerows, a grass bank with the first violet crack, and a millpond
 * in front that mirrors all of it (and, on the live stage, the party too).
 *
 * Every motion is a whole number of cycles per BG_LOOP, so the baked loop never jumps.
 */
const thornwick: WorldScene = {
    id: 'world_thornwick_vale',
    water: TW_WATER,
    glitter: SUN.x,
    tiered: true,
    draw(s, sc, t) {
        const ph = (qt(t) / BG_LOOP) % 1
        const f = Math.floor(ph * BG_FRAMES + 1e-6)
        sky(s, [C.sky0, C.sky1, C.sky2, C.dusk3, C.gold2, C.gold3], [0, 20, 42, 64, 78, 90])
        // The sun: a wide soft glow, the disc, a white core. Fixed — it is effectively at
        // infinity, so it must not slide with the scroll the way the nearer layers do, and its
        // glitter road down the water is pinned to the same column.
        ditherDisc(s, SUN.x, SUN.y, 22, C.gold3, 2)
        ditherDisc(s, SUN.x, SUN.y, 17, C.gold3, 6)
        disc(s, SUN.x, SUN.y, 13, C.gold3)
        disc(s, SUN.x, SUN.y, 10, C.white)
        // streak clouds, lit from below. Still in the baked loop (a drift can't close in 1.6 s);
        // on the live stage they drift, the nearer (lower) ones a little faster.
        for (let i = 0; i < 6; i++) {
            const len = 30 + R(hash2(i, 21) * 50)
            const wind = clock.smooth ? t * (1 + i * 0.35) : 0
            const x = mod(hash2(i, 22) * (SW + 80) - sc * 0.05 - wind, SW + 80) - 60
            const y = 18 + i * 12 + R(hash2(i, 23) * 5)
            const body = y < 50 ? C.white : y < 76 ? C.bone1 : C.dusk3
            const lit = y < 50 ? C.sky2 : C.gold3
            streakCloud(s, R(x), y, len, body, lit, y < 50 ? C.sky2 : C.dusk3)
        }
        if (clock.smooth) birds(s, t, sc)
        // far ridge in blue haze, nearer hills in soft green — both lifted with the horizon
        ridge(s, sc * 0.1, 90, 22, 96, 1, C.sky1, C.sky2)
        ridge(s, sc * 0.2, 102, 14, 70, 2, C.moss1, C.moss2)
        // treeline, then windmills a quarter-turn per loop
        band(sc * 0.3, 7, 8, (x, _k, r) => pine(s, x, TW_GROUND, 8 + R(r * 10), C.moss0, null))
        band(sc * 0.3, 150, 3, (x) => {
            poly(s, [-5, 30, 5, 30, 3, 0, -3, 0], x, 80, C.sand2)
            poly(s, [1, 30, 5, 30, 3, 0, 1, 0], x, 80, C.sand3) // sunlit side
            tri(s, x - 5, 81, x + 5, 81, x, 74, C.rust2)
            line(s, x, 74, x + 5, 81, C.rust3)
            rect(s, x - 1, 94, 2, 3, C.rust0) // door
            px(s, x + 1, 86, C.rock1)
            const a = ph * Math.PI / 2
            for (let i = 0; i < 4; i++) {
                const ca = Math.cos(a + i * Math.PI / 2)
                const sa = Math.sin(a + i * Math.PI / 2)
                line(s, x, 79, x + ca * 17, 79 + sa * 17, C.rust1)
                quad(s, x + ca * 5, 79 + sa * 5, x + ca * 17, 79 + sa * 17,
                    x + ca * 17 - sa * 4, 79 + sa * 17 + ca * 4, x + ca * 5 - sa * 4, 79 + sa * 5 + ca * 4, C.sand3)
                line(s, x + ca * 5 - sa * 2, 79 + sa * 5 + ca * 2, x + ca * 17 - sa * 2, 79 + sa * 17 + ca * 2, C.sand2)
            }
            disc(s, x, 79, 1, C.rust0)
        })
        // hedgerows gone feral, rooted along the field's far edge
        band(sc * 0.6, 34, 5, (x, k, r) => bush(s, x, TW_GROUND + 1, 22 + R(r * 10), 9 + (k & 3), 17 + (k & 7)))
        // The field the party fights on: a plane deep enough for all three ranks, running from
        // the treeline down to the pond. Grass at the far edge gives way to earth trodden bare
        // through the middle, so each rank reads against a different value instead of one slab.
        rect(s, 0, TW_GROUND, SW, TW_WATER - TW_GROUND, C.moss2)
        rect(s, 0, TW_GROUND, SW, 2, C.moss3)
        dither(s, 0, TW_GROUND + 2, SW, 6, C.moss1, 6) // the hedgerow's shadow seating it on the field
        for (let x = 0; x < SW; x += 2) if (hash2(x, 31) < 0.5) px(s, x, TW_GROUND - 1, hash2(x, 32) < 0.3 ? C.sand3 : C.moss3)
        // The field's darker accents are the shaded blades below and the hedgerow's shadow above.
        // Dithered patches were tried here and read as scattered crosses rather than ground.
        // Blades and poppies, thinning to nothing at the water. Kept sparse on purpose: the
        // fighters have to read against this, so it is texture, not a meadow in full bloom.
        band(sc, 7, 41, (x, k, r) => {
            const y = TW_GROUND + 5 + R(r * 43)
            const dir = hash2(k, 43) < 0.5 ? 1 : -1
            line(s, x, y, x + dir, y - (y > FLOOR_Y - 14 ? 3 : 2), hash2(k, 42) < 0.35 ? C.moss3 : C.moss1)
        })
        band(sc, 29, 44, (x, k) => {
            const y = TW_GROUND + 8 + R(hash2(k, 45) * 38)
            px(s, x, y, POPPIES[k & 3]!)
            px(s, x, y + 1, C.moss3) // the stem catching light under the head
        })
        // the bank dropping to the water: a lip at the edge, not a band across the scene
        rect(s, 0, FLOOR_Y + 10, SW, TW_WATER - FLOOR_Y - 10, C.rust0)
        rect(s, 0, FLOOR_Y + 10, SW, 1, C.moss2)
        rect(s, 0, TW_WATER - 2, SW, 2, C.rust1)
        // the violet crack, still glowing along the near rank's line
        band(sc, 140, 6, (x) => {
            line(s, x, FLOOR_Y - 2, x + 3, FLOOR_Y + 3, C.heather2)
            px(s, x + 1, FLOOR_Y, (f >> 2) & 1 ? C.heather3 : C.dusk2)
        })
        // the millpond
        reflectWater(s, TW_WATER, t, SUN.x)
        fireflies(s, ph, 14, 7, 116, FLOOR_Y - 6)
        // pollen riding the breeze across the field — live only, since it never comes back round
        if (clock.smooth) drift(s, t, 12, 51, [C.sand3, C.ice3], -1.5, -7, TW_GROUND - 20, FLOOR_Y - 2)
    },
    /**
     * The framing pines, nearest the camera: rooted on the bank in front of the near rank, so the
     * stage draws them over the fight, with hedge and fern clumps at their feet. They travel at
     * full scroll and sweep across the fight mid-march, laid out on SCROLL_PERIOD so every time
     * the party stops they are back framing the two edges exactly as they started.
     */
    front(s, sc, _t) {
        framing(sc, (o) => {
            bigPine(s, o + 14, FRONT_BASE, 98, C.moss0, C.moss2)
            bigPine(s, o + 34, FRONT_BASE, 66, C.moss0, C.moss2)
            bigPine(s, o + 280, FRONT_BASE, 70, C.moss0, C.moss2)
            bigPine(s, o + 296, FRONT_BASE, 104, C.moss0, C.moss2)
            bush(s, o + 24, FRONT_BASE + 1, 30, 11, 3)
            bush(s, o + 46, FRONT_BASE + 1, 16, 7, 9)
            bush(s, o + 288, FRONT_BASE + 1, 32, 12, 12)
            for (const [x, h] of [[4, 9], [54, 7], [270, 8], [312, 10]] as const) fern(s, o + x, FRONT_BASE, h)
        })
    }
}

/** Where World 1's foreground stands: on the bank, in front of the near rank. */
const FRONT_BASE = FLOOR_Y + 12

/** A fern: fronds arching out of one root, the sunward ones catching the light. */
function fern(s: Surface, x: number, base: number, h: number): void {
    for (let i = -2; i <= 2; i++) {
        const tx = x + i * 3
        const ty = base - h + Math.abs(i) * 2
        line(s, x, base, tx, ty, i > 0 ? C.moss2 : C.moss1)
        px(s, tx + (i < 0 ? -1 : 1), ty + 1, i > 0 ? C.moss3 : C.moss1)
    }
}

export const WORLD_SCENES: readonly WorldScene[] = [thornwick, mirewood, cinderpass, rimeholt, sunkenAmarath, duskspire, bonefields, shatteredSky, brink, theVoid]

