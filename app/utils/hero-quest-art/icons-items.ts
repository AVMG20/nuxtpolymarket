// Item icons (asset-list §3.2): 48 Artifacts — one per item, the Dig-site sells distinct
// relics — 36 Gear pieces, 18 currencies. Gear is icon-only (never shown on the Hero).

import { C } from './palette'
import { type Surface, taper, dome } from './surface'
import { M, sword, axe, type Mat } from './weapons'
import { type Glyph, CLEAR, rect, px, line, disc, ring, tri, ellipse, poly, arc } from './icon-kit'
import { ABILITY_ICON_PARTS as P } from './icons-abilities'

const R = Math.round

function gem(g: Surface, x: number, y: number, r: number, m: Mat): void {
    poly(g, [0, -r, r, 0, 0, r, -r, 0], x, y, m[1])
    poly(g, [0, -r, -r, 0, 0, 0], x, y, m[2])
    poly(g, [0, r, r, 0, 0, 0], x, y, m[0])
    px(g, x - 1, y - 1, C.white)
}

// ── Artifacts ──────────────────────────────────────────────────────────────────────

export const ARTIFACT_ICONS: Readonly<Record<string, Glyph>> = {
    // Offense
    artifact_offense_0: (g, x, y) => {
        // Goblin Cudgel: a knotted club, its grip bound in rag and its head driven full of nails
        taper(g, x - 7, y + 8, x + 2, y - 2, 2.5, 5, C.brown1)
        disc(g, x + 4, y - 4, 5, C.brown1)
        disc(g, x + 3, y - 5, 3, C.brown2)
        for (let k = 0; k < 3; k++) line(g, x - 7 + k * 2, y + 5 - k * 2, x - 5 + k * 2, y + 7 - k * 2, C.olive1)
        for (const [nx, ny, ox, oy] of [[2, -8, 0, -1], [8, -6, 1, -1], [8, -1, 1, 0], [4, 0, 0, 1]] as const) {
            px(g, x + nx, y + ny, C.steel2); px(g, x + nx + ox, y + ny + oy, C.steel3)
        }
        px(g, x + 2, y - 6, C.brown3)
    },
    artifact_offense_1: (g, x, y) => {
        // Tracker's Flint: a knapped flint and the fire-steel struck against it, sparks flying
        poly(g, [-6, 2, -4, -4, 1, -6, 5, -2, 4, 4, -2, 6], x - 2, y + 2, C.stone1)
        poly(g, [-4, -4, 1, -6, 3, -3, -2, 0], x - 2, y + 2, C.stone2)
        for (const [cx, cy] of [[-5, 1], [-1, 6], [2, 3]] as const) px(g, x + cx, y + cy, C.stone3)
        arc(g, x + 5, y - 5, 4, -Math.PI * 0.2, Math.PI * 1.2, C.steel2); arc(g, x + 5, y - 5, 3, -Math.PI * 0.2, Math.PI * 1.2, C.steel2)
        arc(g, x + 5, y - 5, 4, Math.PI * 1.0, Math.PI * 1.4, C.steel3)
        P.sparkle(g, x + 4, y + 1, 2, C.gold3)
        for (const [sx, sy, c] of [[7, 3, C.orange], [2, -1, C.gold3], [8, 0, C.gold3], [5, 5, C.orange]] as const) px(g, x + sx, y + sy, c)
    },
    artifact_offense_2: (g, x, y) => {
        // Slagjaw's Tooth: a great fang on a thong, its root still crusted with glowing slag
        arc(g, x, y - 4, 7, Math.PI * 1.0, Math.PI * 2.0, C.brown2)
        poly(g, [-4, -4, 4, -4, 3, 2, 1, 7, 0, 9, -2, 3], x, y, C.bone1)
        line(g, x - 3, y - 3, x - 1, y + 5, C.white)
        line(g, x + 3, y - 3, x + 1, y + 6, C.bone0)
        poly(g, [-5, -5, -2, -7, 3, -7, 6, -5, 4, -3, -4, -3], x, y, C.stone1)
        line(g, x - 3, y - 4, x + 1, y - 6, C.lava1); px(g, x + 2, y - 6, C.orange)
    },
    artifact_offense_3: (g, x, y) => {
        // Frostbound War Drum: a hide drum rimed in frost, icicles hanging off its hoop
        rect(g, x - 7, y - 2, 15, 7, C.brown1)
        for (let i = 0; i < 4; i++) { line(g, x - 6 + i * 4, y - 1, x - 4 + i * 4, y + 4, C.bone1); line(g, x - 4 + i * 4, y - 1, x - 2 + i * 4, y + 4, C.bone0) }
        ellipse(g, x, y - 2, 7, 3, C.frost)
        ellipse(g, x - 1, y - 3, 4, 1, C.white)
        rect(g, x - 7, y + 4, 15, 2, C.blue1); rect(g, x - 7, y + 4, 15, 1, C.cyan)
        for (const cx of [-5, -1, 3, 6]) tri(g, x + cx - 1, y + 6, x + cx + 1, y + 6, x + cx, y + 6 + (cx & 1 ? 2 : 3), C.frost)
        line(g, x + 9, y - 9, x + 2, y - 3, C.bone1, 2); disc(g, x + 9, y - 9, 1.5, C.bone0)
    },
    artifact_offense_4: (g, x, y) => {
        // Dawnbreak Arrowhead: a barbed broadhead lit by the sun coming up behind it
        disc(g, x, y + 8, 8, C.orange); disc(g, x, y + 8, 6, C.gold2); disc(g, x, y + 8, 4, C.gold3)
        rect(g, x - 9, y + 8, 19, 4, CLEAR)
        rect(g, x - 9, y + 8, 19, 1, C.lava0)
        tri(g, x - 4, y + 1, x + 4, y + 1, x, y - 9, C.steel2)
        tri(g, x - 4, y + 1, x, y + 1, x, y - 9, C.steel3)
        tri(g, x - 4, y + 1, x - 2, y + 1, x - 4, y + 4, C.steel2); tri(g, x + 2, y + 1, x + 4, y + 1, x + 4, y + 4, C.steel2)
        rect(g, x - 1, y + 1, 3, 5, C.brown1); rect(g, x - 1, y + 2, 3, 1, C.gold1)
        px(g, x - 1, y - 5, C.white)
    },
    artifact_offense_5: (g, x, y) => { line(g, x - 5, y - 9, x - 5, y + 9, C.brown2, 2); poly(g, [0, 0, 11, 1, 8, 5, 11, 9, 0, 9], x - 4, y - 8, C.red1); P.skull(g, x + 1, y - 3, C.bone1) }, // Last Legion Standard
    artifact_offense_6: (g, x, y) => { axe(g, x - 5, y + 7, -0.9, 13, M.ice, M.darkwood, true); P.sparkle(g, x + 6, y - 6, 2, C.frost) }, // Hrimgar's Icebreaker
    artifact_offense_7: (g, x, y) => { ellipse(g, x, y, 8, 5, C.lava0); ellipse(g, x, y, 6, 4, C.orange); disc(g, x, y, 3, C.gold2); rect(g, x, y - 3, 1, 7, C.ink); px(g, x - 2, y - 2, C.white) }, // Eye of Pyrrhax
    artifact_offense_8: (g, x, y) => {
        // Stormcrown Talon: one hooked claw of the Roc, lightning still crawling over it
        // the scaled toe comes in from the upper left; the claw hooks down and round from its tip
        taper(g, x - 10, y - 8, x - 4, y - 3, 4, 5, C.slate2)
        for (const k of [0, 1, 2]) line(g, x - 9 + k * 2, y - 9 + k * 2, x - 11 + k * 2, y - 6 + k * 2, C.slate1)
        for (let i = 0; i <= 18; i++) {
            const a = Math.PI * (1.15 - i / 18 * 0.95)
            disc(g, x + 1 + Math.cos(a) * 6, y - 1 + Math.sin(a) * 7, 2.8 * (1 - i / 18) + 0.4, i < 4 ? C.bone0 : C.bone1)
        }
        arc(g, x + 1, y - 1, 5, Math.PI * 0.4, Math.PI * 0.95, C.white)
        for (const [ax, ay, bx, by] of [[9, -10, 5, -6], [5, -6, 8, -5], [8, -5, 5, -1]] as const) line(g, x + ax, y + ay, x + bx, y + by, C.cyan, 2)
        px(g, x + 5, y - 1, C.white)
    },
    artifact_offense_9: (g, x, y) => {
        // Banner of the Bonefields: a black rag on a bone pole, crossed bones on its field
        line(g, x - 7, y - 9, x - 7, y + 9, C.bone1, 2)
        disc(g, x - 6, y - 9, 1.5, C.bone0)
        poly(g, [0, 0, 13, 1, 13, 11, 0, 11], x - 6, y - 7, C.night2)
        for (const [cx, d] of [[-3, 3], [1, 2], [5, 3]] as const) tri(g, x + cx - 2, y + 5, x + cx + 2, y + 5, x + cx, y + 5 - d, CLEAR)
        line(g, x - 3, y - 5, x + 4, y + 1, C.bone1); line(g, x + 4, y - 5, x - 3, y + 1, C.bone1)
        for (const [bx, by] of [[-3, -5], [4, -5], [-3, 1], [4, 1]] as const) disc(g, x + bx, y + by, 1, C.bone1)
        rect(g, x - 6, y - 7, 13, 1, C.night3)
    },
    artifact_offense_10: (g, x, y) => {
        // Ithren's Burning Sigil: a warding circle, its triangle and runes alight round a flame
        ring(g, x, y, 8, C.purple2); ring(g, x, y, 7, C.purple1)
        for (let i = 0; i < 3; i++) {
            const a = -Math.PI / 2 + i * Math.PI * 2 / 3
            const b = a + Math.PI * 2 / 3
            line(g, R(x + Math.cos(a) * 7), R(y + Math.sin(a) * 7), R(x + Math.cos(b) * 7), R(y + Math.sin(b) * 7), C.pink)
        }
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; px(g, R(x + Math.cos(a) * 8), R(y + Math.sin(a) * 8), C.gold3) }
        P.flame(g, x, y + 2, 6, C.lava1, C.orange, C.gold3)
    },
    artifact_offense_11: (g, x, y) => {
        // Key to the Last Door: a gold key whose bow holds the door's keystone eye
        line(g, x - 1, y - 1, x + 7, y + 7, C.gold2, 2)
        line(g, x + 4, y + 4, x + 2, y + 6, C.gold2, 2); line(g, x + 7, y + 7, x + 5, y + 9, C.gold2, 2)
        disc(g, x - 4, y - 4, 5, C.gold1)
        disc(g, x - 4, y - 4, 3.5, C.void)
        ellipse(g, x - 4, y - 4, 2, 1, C.white); px(g, x - 4, y - 4, C.pink)
        arc(g, x - 4, y - 4, 4, Math.PI * 1.0, Math.PI * 1.5, C.gold3)
        px(g, x + 1, y + 1, C.gold3)
    },
    // Defense
    artifact_defense_0: (g, x, y) => {
        // Hedgeknight Buckler: a plank buckler rimmed in iron, a thorned hedge vine wound round it
        disc(g, x, y, 8, C.steel1)
        disc(g, x, y, 7, C.brown2)
        for (const d of [-4, 0, 4]) line(g, x + d, y - 6, x + d, y + 6, C.brown1)
        for (let i = 0; i < 14; i++) {
            const a = i / 14 * Math.PI * 2
            px(g, R(x + Math.cos(a) * 5), R(y + Math.sin(a) * 5), C.green2)
        }
        for (const a of [0.4, 2.0, 3.6, 5.2]) tri(g, R(x + Math.cos(a) * 5), R(y + Math.sin(a) * 5), R(x + Math.cos(a + 0.4) * 5), R(y + Math.sin(a + 0.4) * 5), R(x + Math.cos(a + 0.2) * 7), R(y + Math.sin(a + 0.2) * 7), C.green3)
        disc(g, x, y, 2, C.steel2); px(g, x - 1, y - 1, C.white)
    },
    artifact_defense_1: (g, x, y) => {
        // Mireroot Charm: a knot of bog root on a cord, a bloom sprouting from it
        line(g, x, y - 10, x, y - 6, C.brown2)
        ring(g, x, y - 1, 5, C.brown1); ring(g, x, y - 1, 4, C.brown2)
        for (const [ax, bx] of [[-3, -5], [0, 0], [3, 5]] as const) line(g, x + ax, y + 3, x + bx, y + 9, C.brown1)
        tri(g, x + 3, y - 5, x + 8, y - 8, x + 6, y - 3, C.green2); tri(g, x - 3, y - 5, x - 8, y - 7, x - 6, y - 3, C.green3)
        disc(g, x, y - 1, 2, C.pink); px(g, x, y - 1, C.gold3)
    },
    artifact_defense_2: (g, x, y) => {
        // Cinderscale Shard: one of Pyrrhax's scales, its edge still glowing like a coal
        disc(g, x, y - 2, 6.5, C.red1)
        tri(g, x - 6, y - 1, x + 6, y - 1, x, y + 9, C.red1)
        arc(g, x, y - 2, 5, Math.PI * 1.05, Math.PI * 1.6, C.red2)
        line(g, x, y - 7, x, y + 7, C.red2)
        line(g, x - 6, y, x - 1, y + 8, C.orange); line(g, x + 6, y, x + 1, y + 8, C.lava1)
        for (const [cx, cy] of [[-3, 3], [2, 5]] as const) px(g, x + cx, y + cy, C.gold3)
    },
    artifact_defense_3: (g, x, y) => { ellipse(g, x, y + 2, 7, 6, C.stone2); ellipse(g, x - 1, y + 1, 5, 4, C.stone3); P.flame(g, x, y - 1, 5, C.orange, C.gold2, C.white); rect(g, x - 5, y + 6, 11, 1, C.stone1) }, // Rimeholt Hearthstone
    artifact_defense_4: (g, x, y) => { arc(g, x, y - 5, 6, 0, Math.PI, C.gold1); disc(g, x, y + 3, 5, C.teal2); disc(g, x - 1, y + 2, 3, C.teal3); px(g, x - 2, y + 1, C.white); ring(g, x, y + 3, 5, C.gold1) }, // Tideglass Pendant
    artifact_defense_5: (g, x, y) => { P.potion(g, x, y, [C.red0, C.red1, C.red2]); px(g, x + 2, y + 3, C.olive2) }, // Mother Leech's Vial
    artifact_defense_6: (g, x, y) => {
        // Grave Marshal's Pauldron: three lames of dark plate stepping down off the shoulder, a small skull on the top one
        dome(g, x + 2, y + 8, 8, 4, C.steel0); rect(g, x - 6, y + 8, 17, 1, C.gold1)
        dome(g, x + 1, y + 4, 8, 4, C.steel1); rect(g, x - 7, y + 4, 17, 1, C.gold1)
        dome(g, x - 1, y, 8, 8, C.steel1); rect(g, x - 9, y, 17, 1, C.gold1)
        arc(g, x - 1, y, 7, Math.PI * 1.1, Math.PI * 1.45, C.steel2)
        rect(g, x - 3, y - 5, 5, 3, C.bone1); rect(g, x - 2, y - 2, 3, 1, C.bone1)
        px(g, x - 2, y - 4, C.ink); px(g, x, y - 4, C.ink)
    },
    artifact_defense_7: (g, x, y) => {
        // Rotheart Barkshield: a shield of living bark, moss in its corners, the rotten heart glowing in its knot
        poly(g, [-7, -7, 7, -7, 7, 1, 0, 9, -7, 1], x, y, C.brown1)
        for (const [d, w] of [[-4, 1], [0, -1], [4, 1]] as const) { line(g, x + d, y - 6, x + d + w, y - 1, C.brown0); line(g, x + d + w, y - 1, x + d, y + 4, C.brown0) }
        for (const d of [-2, 2]) line(g, x + d, y - 6, x + d, y + 3, C.brown2)
        for (const [mx, my] of [[-6, -6], [-5, -6], [-6, -5], [5, -6], [6, -6], [6, -5], [-1, 7], [0, 8]] as const) px(g, x + mx, y + my, C.moss2)
        ellipse(g, x, y, 3, 2, C.brown0)
        disc(g, x, y, 1.5, C.green3); px(g, x, y, C.green4)
    },
    artifact_defense_8: (g, x, y) => { P.heart(g, x, y - 1, 4, C.cyan, C.frost); poly(g, [-2, -4, 0, -6, 2, -4], x - 3, y, C.white); line(g, x - 3, y - 2, x + 2, y + 4, C.blue1) }, // Glacier Titan's Heart
    artifact_defense_9: (g, x, y) => {
        // Maerith's Pearl: an opened clam, its fluted shell fanned up behind a pearl
        disc(g, x, y + 1, 8, C.teal2)
        rect(g, x - 9, y + 2, 19, 8, CLEAR)
        for (let i = 0; i < 5; i++) {
            const a = Math.PI * (1.15 + i * 0.175)
            line(g, x, y + 1, R(x + Math.cos(a) * 7), R(y + 1 + Math.sin(a) * 7), C.teal1)
        }
        arc(g, x, y + 1, 8, Math.PI * 1.1, Math.PI * 1.5, C.teal3)
        ellipse(g, x, y + 5, 8, 3, C.teal1)
        ellipse(g, x, y + 4, 6, 1, C.teal0)
        disc(g, x, y + 3, 3, C.white); px(g, x + 1, y + 4, C.frost); px(g, x - 1, y + 2, C.white)
        P.sparkle(g, x + 7, y - 6, 2, C.white)
    },
    artifact_defense_10: (g, x, y) => {
        // Ossuar's Bone Mantle: a ribcage worn over the shoulders, the spine down its middle
        rect(g, x - 9, y - 7, 19, 2, C.bone0)
        for (const d of [-9, 9]) disc(g, x + d, y - 6, 1.5, C.bone1)
        for (let k = 0; k < 4; k++) {
            const ry = y - 4 + k * 3
            const w = 8 - k
            for (const d of [-1, 1]) { line(g, x + d, ry, x + d * w, ry + 1, C.bone1); line(g, x + d * w, ry + 1, x + d * (w - 1), ry + 3, C.bone1) }
        }
        rect(g, x, y - 5, 1, 14, C.bone0)
        for (let i = 0; i < 5; i++) px(g, x, y - 4 + i * 3, C.bone1)
    },
    artifact_defense_11: (g, x, y) => {
        // Vesper's Forgotten Hymn: an open hymnal in the Sister's blue and gold, its notes drifting up
        P.book(g, x, y + 3, C.blue1, C.bone1)
        rect(g, x - 7, y - 1, 15, 1, C.gold1)
        for (const nx of [-5, 0]) { disc(g, x + nx, y - 4, 1.5, C.gold3); line(g, x + nx + 1, y - 4, x + nx + 1, y - 9, C.gold3) }
        rect(g, x - 4, y - 10, 6, 2, C.gold3)
        disc(g, x + 5, y - 6, 1.2, C.white); line(g, x + 6, y - 6, x + 6, y - 10, C.white); px(g, x + 7, y - 9, C.white)
    },
    // Tempo
    artifact_tempo_0: (g, x, y) => {
        // Bramblefoot Sandals: a laced bark sandal in profile, a thorned bramble wound round its ankle, a leaf wing at the heel
        poly(g, [-8, 6, 7, 6, 9, 4, 9, 7, 7, 8, -8, 8], x, y, C.brown1)
        rect(g, x - 8, y + 6, 16, 1, C.brown2)
        line(g, x - 7, y + 5, x - 6, y - 4, C.brown2)
        for (const [ax, ay, bx, by] of [[-6, -2, 0, 5], [-6, 2, 4, 5], [-1, 2, 7, 5], [-6, -2, -2, 1]] as const) line(g, x + ax, y + ay, x + bx, y + by, C.brown2)
        line(g, x - 2, y - 4, x + 8, y + 5, C.brown2)
        rect(g, x - 7, y - 6, 5, 2, C.brown2)
        for (const [vx, vy] of [[-7, -4], [-5, -3], [-3, -4], [-2, -6]] as const) px(g, x + vx, y + vy, C.green2)
        for (const [tx, ty] of [[-6, -7], [-3, -7], [-1, -5]] as const) px(g, x + tx, y + ty, C.green4)
        tri(g, x - 7, y - 5, x - 8, y - 9, x - 3, y - 10, C.green3)
        tri(g, x - 7, y - 5, x - 5, y - 8, x, y - 8, C.green2)
    },
    artifact_tempo_1: (g, x, y) => { P.hourglass(g, x, y, C.olive2); px(g, x - 6, y - 8, C.green2) }, // Marsh Hourglass
    artifact_tempo_2: (g, x, y) => {
        // Ashwalker Anklet: an iron ring for the ankle, coals set round it, sparks and ash rising off it
        ellipse(g, x, y + 1, 9, 6, C.rust1)
        ellipse(g, x, y, 6, 3, CLEAR)
        arc(g, x, y, 6, Math.PI * 1.0, Math.PI * 2.0, C.rust0)
        for (let i = 0; i < 7; i++) {
            const a = Math.PI * (0.08 + i * 0.14)
            const cx = R(x + Math.cos(a) * 7.5)
            const cy = R(y + 1 + Math.sin(a) * 4.5)
            disc(g, cx, cy, 1.2, i & 1 ? C.orange : C.lava1); px(g, cx, cy, C.gold3)
        }
        for (const [sx, sy] of [[-3, -5], [2, -7], [5, -4], [-1, -9], [-6, -3]] as const) px(g, x + sx, y + sy, C.orange)
        for (const [sx, sy] of [[0, -5], [4, -9], [-4, -8]] as const) px(g, x + sx, y + sy, C.stone2)
    },
    artifact_tempo_3: (g, x, y) => {
        // Frostbite Horn: a curled raider's horn banded in iron, its bell rimed and dripping icicles
        for (let i = 0; i <= 14; i++) {
            const t = i / 14
            const a = Math.PI * (1.15 + t * 0.75)
            disc(g, x + 1 + Math.cos(a) * 7, y + 5 + Math.sin(a) * 7, 1 + t * 2.6, C.bone1)
        }
        for (const t of [0.35, 0.65]) {
            const a = Math.PI * (1.15 + t * 0.75)
            const cx = x + 1 + Math.cos(a) * 7
            const cy = y + 5 + Math.sin(a) * 7
            const r = 1 + t * 2.6
            line(g, R(cx - Math.cos(a) * r), R(cy - Math.sin(a) * r), R(cx + Math.cos(a) * r), R(cy + Math.sin(a) * r), C.steel1)
        }
        ellipse(g, x + 7, y + 2, 2.5, 4.5, C.frost)
        ellipse(g, x + 7, y + 2, 1.5, 3, C.ice1)
        for (const [ix, iy, h] of [[6, 6, 3], [8, 6, 2], [4, 3, 2]] as const) tri(g, x + ix, y + iy, x + ix + 2, y + iy, x + ix + 1, y + iy + h, C.frost)
        arc(g, x, y + 4, 6, Math.PI * 0.2, Math.PI * 0.8, C.brown1)
        P.sparkle(g, x - 6, y - 7, 1, C.frost)
    },
    artifact_tempo_4: (g, x, y) => { tri(g, x - 6, y + 5, x + 6, y + 5, x, y - 7, C.gold1); disc(g, x, y - 4, 4, C.gold1); rect(g, x - 7, y + 5, 15, 2, C.gold2); disc(g, x, y + 8, 1.5, C.bone1); px(g, x - 2, y - 4, C.gold3); line(g, x, y - 8, x, y - 10, C.brown1) }, // Sailor's Distress Bell
    artifact_tempo_5: (g, x, y) => { for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; disc(g, x + Math.cos(a) * 7, y + Math.sin(a) * 6, 1.2, i === 0 ? C.gold2 : C.purple1) } rect(g, x - 1, y + 6, 3, 4, C.purple2) }, // Acolyte's Prayer Beads
    artifact_tempo_6: (g, x, y) => {
        // Halvane's Spellglass: the Magister's monocle, a rune lit in its lens, its chain trailing off in links
        disc(g, x - 2, y - 2, 7, C.gold1)
        disc(g, x - 2, y - 2, 5, C.purple0)
        arc(g, x - 2, y - 2, 4, Math.PI * 1.1, Math.PI * 1.45, C.purple2)
        line(g, x - 2, y - 5, x - 2, y + 1, C.pink); line(g, x - 5, y - 2, x + 1, y - 2, C.pink)
        line(g, x - 4, y - 4, x, y, C.purple2); line(g, x, y - 4, x - 4, y, C.purple2)
        px(g, x - 2, y - 2, C.white)
        for (let i = 0; i < 4; i++) {
            const cx = x + 4 + i * 1.6
            const cy = y + 4 + i * 1.4 + (i > 1 ? i - 1 : 0)
            if (i & 1) ring(g, cx, cy, 1, C.gold2); else { px(g, R(cx), R(cy), C.gold3); px(g, R(cx) + 1, R(cy), C.gold1) }
        }
        P.sparkle(g, x + 6, y - 7, 2, C.pink)
    },
    artifact_tempo_7: (g, x, y) => {
        // Korr's Marching Drum: a legion war drum laced in bone cord, a skull on its shell, two bone sticks crossed over it
        line(g, x - 8, y - 9, x + 5, y + 1, C.bone1); line(g, x - 7, y - 9, x + 5, y, C.bone0)
        line(g, x + 8, y - 9, x - 5, y + 1, C.bone1); line(g, x + 7, y - 9, x - 5, y, C.bone0)
        disc(g, x - 8, y - 9, 1.2, C.bone1); disc(g, x + 8, y - 9, 1.2, C.bone1)
        ellipse(g, x, y + 7, 8, 2, C.red0)
        rect(g, x - 8, y, 17, 8, C.red1)
        ellipse(g, x, y, 8, 2, C.bone1)
        rect(g, x - 8, y + 2, 17, 1, C.steel1); rect(g, x - 8, y + 7, 17, 1, C.steel1)
        for (const d of [-7, -4, 4, 7]) { line(g, x + d - 1, y + 3, x + d + 1, y + 6, C.bone1) }
        P.skull(g, x, y + 5)
    },
    artifact_tempo_8: (g, x, y) => { tri(g, x - 6, y + 6, x + 6, y + 6, x, y - 8, C.cyan); tri(g, x - 6, y + 6, x, y + 6, x, y - 8, C.frost); for (let i = 0; i < 3; i++) line(g, x + 3, y, x + 9, y - 3 + i * 3, [C.red2, C.gold3, C.teal3][i]!) }, // Skyshard Prism
    artifact_tempo_9: (g, x, y) => {
        // Zephyrax Wingbone: the long bone of the Breaker's wing, storm-grey pinions still fanned off it, lightning in the quills
        for (let i = 0; i < 5; i++) {
            const bx = x - 5 + i * 3
            const by = y - 3 - i * 2
            taper(g, bx, by + 1, bx - 2 - i * 0.6, by + 10 + i * 0.5, 2.5, 1, i & 1 ? C.slate3 : C.slate2)
            px(g, R(bx - 2 - i * 0.6), R(by + 10 + i * 0.5), C.white)
        }
        line(g, x - 7, y + 1, x + 7, y - 8, C.bone1, 2)
        disc(g, x - 8, y + 2, 2, C.bone1); disc(g, x - 6, y + 3, 1.5, C.bone1)
        disc(g, x + 8, y - 9, 2, C.bone1)
        line(g, x + 4, y - 1, x + 6, y + 2, C.gold3); line(g, x + 6, y + 2, x + 5, y + 3, C.gold3); line(g, x + 5, y + 3, x + 8, y + 7, C.gold3)
    },
    artifact_tempo_10: (g, x, y) => {
        // Lodestone of the Brink: a lodestone veined in iron, pulling falling stars down onto it
        poly(g, [-6, 0, -2, -5, 4, -5, 7, 1, 3, 7, -4, 6], x, y + 2, C.rock1)
        poly(g, [-2, -5, 4, -5, 2, 1, -5, 0], x, y + 2, C.rock2)
        poly(g, [4, -5, 7, 1, 2, 1], x, y + 2, C.rock3)
        line(g, x - 5, y + 5, x + 6, y + 3, C.steel2); px(g, x + 1, y + 4, C.white); px(g, x - 2, y + 5, C.steel3)
        for (const [sx, sy, ex, ey] of [[-9, -9, -5, -4], [9, -8, 5, -4], [0, -10, 1, -5]] as const) {
            line(g, x + sx, y + sy, x + ex, y + ey, C.purple1)
            px(g, x + ex, y + ey, C.pink)
        }
        for (const [sx, sy] of [[-9, -9], [9, -8], [0, -10]] as const) P.sparkle(g, x + sx, y + sy, 1, C.white)
        for (const [dx, dy] of [[-8, 6], [9, 6], [-9, 1]] as const) px(g, x + dx, y + dy, C.haze)
    },
    artifact_tempo_11: (g, x, y) => {
        // Herald's Stopped Clock: a gold pocket watch, its hands frozen, the Void leaking through a crack in the face
        ring(g, x, y - 9, 1.5, C.gold2); rect(g, x - 1, y - 8, 3, 2, C.gold1)
        disc(g, x, y + 1, 8, C.gold1)
        disc(g, x, y + 1, 6, C.bone1)
        for (let i = 0; i < 12; i++) {
            const a = i / 12 * Math.PI * 2
            px(g, R(x + Math.cos(a) * 5), R(y + 1 + Math.sin(a) * 5), i % 3 ? C.bone0 : C.ink)
        }
        line(g, x, y + 1, x, y - 3, C.ink); line(g, x, y + 1, x - 3, y + 2, C.ink)
        line(g, x + 1, y - 5, x + 2, y - 1, C.void); line(g, x + 2, y - 1, x + 1, y + 2, C.void); line(g, x + 1, y + 2, x + 4, y + 6, C.void)
        line(g, x + 2, y - 4, x + 3, y - 1, C.purple1); line(g, x + 2, y + 2, x + 5, y + 5, C.purple1)
        px(g, x + 2, y, C.pink)
        for (const [dx, dy] of [[6, -6], [8, -3], [7, 8]] as const) px(g, x + dx, y + dy, C.purple2)
    },
    // Fortune
    artifact_fortune_0: (g, x, y) => {
        // Thornwick Copper: a worn copper penny struck with a sprig of hedge thorn, green with verdigris at its rim
        disc(g, x, y, 8, C.rust2)
        disc(g, x, y, 6, C.rust3)
        ring(g, x, y, 6, C.rust2)
        line(g, x - 1, y + 4, x + 1, y - 4, C.rust1)
        for (const [lx, ly, d] of [[0, -2, -1], [1, 0, 1], [0, 2, -1]] as const) { line(g, x + lx, y + ly, x + lx + d * 3, y + ly - 1, C.rust1); px(g, x + lx + d * 3, y + ly - 2, C.rust1) }
        for (const [vx, vy] of [[5, 5], [6, 4], [-6, 3], [4, -6], [-3, 7]] as const) px(g, x + vx, y + vy, C.teal2)
        arc(g, x, y, 7, Math.PI * 1.15, Math.PI * 1.45, C.gold3)
    },
    artifact_fortune_1: (g, x, y) => {
        // Hedge-Witch Almanac: a fat almanac shut with a strap, a moon on its cover, dried herbs pressed between its pages
        rect(g, x - 7, y - 6, 13, 14, C.green1)
        rect(g, x + 5, y - 5, 2, 12, C.bone1)
        for (let i = 0; i < 3; i++) px(g, x + 6, y - 3 + i * 4, C.bone0)
        rect(g, x - 7, y - 6, 2, 14, C.green0)
        disc(g, x - 1, y, 3, C.gold2); disc(g, x, y - 1, 2.5, C.green1)
        rect(g, x - 7, y + 4, 15, 2, C.brown1); rect(g, x + 4, y + 4, 2, 2, C.gold2)
        for (const [hx, hy, ex, ey] of [[2, -6, 5, -10], [3, -6, 8, -8], [0, -6, 0, -9]] as const) line(g, x + hx, y + hy, x + ex, y + ey, C.olive2)
        px(g, x + 5, y - 10, C.purple2); px(g, x + 8, y - 8, C.pink); px(g, x, y - 9, C.purple2)
    },
    artifact_fortune_2: (g, x, y) => {
        // Mirewood Night Lantern: an iron lantern hung on a crook of root, a marsh-light glowing green behind its glass, moths about it
        line(g, x, y - 10, x, y - 7, C.brown1); ring(g, x, y - 7, 1.5, C.steel1)
        tri(g, x - 5, y - 4, x + 5, y - 4, x, y - 8, C.steel1)
        rect(g, x - 4, y - 4, 9, 10, C.steel0)
        rect(g, x - 3, y - 3, 7, 8, C.green2)
        disc(g, x, y + 1, 2, C.green3); px(g, x, y + 1, C.green4); px(g, x - 1, y, C.white)
        rect(g, x, y - 3, 1, 8, C.steel0)
        rect(g, x - 5, y + 6, 11, 2, C.steel1)
        for (const [mx, my] of [[-8, -3], [7, -6], [7, 3]] as const) { px(g, x + mx, y + my, C.bone1); px(g, x + mx + 1, y + my, C.bone0) }
    },
    artifact_fortune_3: (g, x, y) => { line(g, x - 6, y + 7, x + 3, y - 3, C.brown2, 2); arc(g, x + 3, y - 3, 7, Math.PI * 1.05, Math.PI * 1.95, C.stone3); arc(g, x + 3, y - 2, 6, Math.PI * 1.1, Math.PI * 1.9, C.steel2); P.sparkle(g, x + 7, y + 4, 2, C.gold3) }, // Kobold Prospecting Pick
    artifact_fortune_4: (g, x, y) => { poly(g, [-5, 8, -6, -3, 0, -8, 6, -3, 5, 8], x, y, C.stone2); for (const [a, b, c2, d2] of [[-2, -4, 2, 0], [-2, 0, 2, -4], [0, 1, 0, 6]]) line(g, x + a!, y + b!, x + c2!, y + d2!, C.cyan) }, // Rimeholt Saga Stone
    artifact_fortune_5: (g, x, y) => {
        // Amarath Tide Ledger: a sea-stained ledger clasped in brass, a wave stamped on its cover, coins spilled in front of it
        rect(g, x - 7, y - 8, 12, 14, C.teal1)
        rect(g, x - 7, y - 8, 2, 14, C.teal0)
        rect(g, x + 4, y - 7, 2, 12, C.bone1)
        arc(g, x - 1, y - 1, 3, Math.PI, Math.PI * 2, C.gold2); arc(g, x + 2, y - 2, 1.5, 0, Math.PI, C.gold2)
        rect(g, x + 3, y - 2, 3, 3, C.gold2); px(g, x + 4, y - 1, C.gold3)
        line(g, x - 3, y + 6, x - 2, y + 8, C.olive2)
        P.coin(g, x + 5, y + 5, 3); P.coin(g, x + 1, y + 7, 2.5)
    },
    artifact_fortune_6: (g, x, y) => {
        // Sunken Doubloon: a gold doubloon struck with a cross, barnacles grown over one edge, bubbles rising off it
        disc(g, x - 1, y + 1, 7, C.gold1)
        disc(g, x - 1, y + 1, 5, C.gold2)
        rect(g, x - 2, y - 3, 3, 9, C.gold1); rect(g, x - 5, y, 9, 3, C.gold1)
        px(g, x - 1, y + 1, C.gold3)
        arc(g, x - 1, y + 1, 6, Math.PI * 1.1, Math.PI * 1.4, C.gold3)
        for (const [bx, by] of [[3, 6], [5, 4], [1, 7], [5, 7]] as const) { disc(g, x + bx, y + by, 1.2, C.stone2); px(g, x + bx, y + by, C.stone0) }
        px(g, x + 6, y + 2, C.green2); px(g, x + 6, y + 1, C.green3)
        ring(g, x + 6, y - 6, 1.5, C.cyan); ring(g, x + 4, y - 9, 1, C.cyan); px(g, x + 8, y - 9, C.frost)
    },
    artifact_fortune_7: (g, x, y) => {
        // Duskspire Star Chart: a twilight chart unrolled between two rods, a constellation drawn on it in gold and a moon in its corner
        rect(g, x - 7, y - 6, 15, 12, C.dusk1)
        rect(g, x - 8, y - 7, 17, 2, C.brown2); rect(g, x - 8, y + 5, 17, 2, C.brown2)
        disc(g, x - 9, y - 6, 1, C.gold2); disc(g, x + 9, y - 6, 1, C.gold2); disc(g, x - 9, y + 6, 1, C.gold2); disc(g, x + 9, y + 6, 1, C.gold2)
        const stars = [[-5, 2], [-2, -1], [1, 1], [4, -3], [5, 2]] as const
        for (let i = 1; i < stars.length; i++) line(g, x + stars[i - 1]![0], y + stars[i - 1]![1], x + stars[i]![0], y + stars[i]![1], C.dusk3)
        for (const [sx, sy] of stars) px(g, x + sx, y + sy, C.gold3)
        disc(g, x - 4, y - 3, 1.5, C.bone1); px(g, x - 3, y - 4, C.dusk1)
        P.sparkle(g, x + 4, y - 3, 1, C.white)
    },
    artifact_fortune_8: (g, x, y) => { line(g, x - 5, y - 8, x + 2, y + 2, C.brown2, 2); poly(g, [0, 0, 6, 0, 6, 5, 3, 8, 0, 5], x, y, C.steel2); line(g, x + 1, y + 1, x + 1, y + 5, C.steel3); P.skull(g, x - 5, y + 4, C.bone0) }, // Grave Robber's Spade
    artifact_fortune_9: (g, x, y) => {
        // Tome of Unfinished Lessons: an open tome, its right page written only halfway down, the quill still standing in its inkpot
        poly(g, [-9, -4, -1, -2, -1, 7, -9, 5], x, y, C.purple1)
        poly(g, [-8, -4, -1, -2, -1, 6, -8, 4], x, y, C.bone1)
        poly(g, [-1, -2, 7, -4, 7, 5, -1, 7], x, y, C.bone1)
        for (let i = 0; i < 3; i++) { line(g, x - 7, y - 2 + i * 2, x - 2, y - 1 + i * 2, C.stone2); }
        for (let i = 0; i < 4; i++) line(g, x + 1, y - 1 + i * 2, x + 5, y - 2 + i * 2, C.stone2)
        line(g, x + 1, y - 1 + 1 * 2, x + 3, y - 2 + 1 * 2, C.stone2)
        rect(g, x - 1, y - 2, 1, 9, C.purple0)
        rect(g, x + 5, y + 5, 4, 4, C.ink); rect(g, x + 6, y + 4, 2, 1, C.steel1)
        line(g, x + 7, y + 4, x + 3, y - 8, C.steel2)
        taper(g, x + 5, y - 1, x + 2, y - 9, 1, 3, C.white)
    },
    artifact_fortune_10: (g, x, y) => { poly(g, [-8, 5, 8, 5, 5, 0, -5, 0], x, y + 1, C.stone2); for (const [a, b] of [[-4, 0], [0, -2], [4, 0], [-2, -4], [2, -5]]) disc(g, x + a!, y + b!, 2, C.gold2); P.sparkle(g, x, y - 8, 2, C.frost) }, // Hoard of the Shattered Sky
    artifact_fortune_11: (g, x, y) => {
        // Last Coin of the Void: a single gold coin, crumbling into the Void from one side, its flecks drifting off into the dark
        disc(g, x - 1, y, 7, C.gold1)
        disc(g, x - 1, y, 5, C.gold2)
        ring(g, x - 1, y, 3, C.gold1)
        arc(g, x - 1, y, 6, Math.PI * 1.1, Math.PI * 1.4, C.gold3)
        for (let dy = -7; dy <= 7; dy++) {
            for (let dx = 1; dx <= 7; dx++) {
                const k = (dx * 7 + dy * 3 + 64) % 5
                if (dx > 5 || k < dx - 2) px(g, x + dx, y + dy, CLEAR)
                else if (k === dx - 2) px(g, x + dx, y + dy, C.purple1)
            }
        }
        for (const [fx, fy, c] of [[8, -3, C.gold2], [9, 2, C.purple2], [8, 5, C.gold1], [10, -1, C.pink], [9, -6, C.purple2], [10, 4, C.gold2]] as const) px(g, x + fx, y + fy, c)
    }
}

// ── Gear: six slots × six tiers ────────────────────────────────────────────────────

const TIER_METAL: readonly Mat[] = [M.iron, M.steel, M.steel, [C.purple0, C.steel2, C.steel3], M.gold, [C.red1, C.gold2, C.gold3]]
const TIER_TRIM: readonly Mat[] = [M.leather, M.leather, [C.blue0, C.blue1, C.blue2], [C.purple0, C.purple1, C.purple2], [C.gold0, C.gold1, C.gold3], [C.red0, C.red2, C.red3]]
const TIER_GEM: readonly number[] = [-1, -1, C.blue2, C.pink, C.cyan, C.white]

function gearGem(g: Surface, x: number, y: number, tier: number): void {
    if (TIER_GEM[tier]! >= 0) { disc(g, x, y, 1.5, TIER_GEM[tier]!); px(g, x, y, C.white) }
}

function gearWeapon(tier: number): Glyph {
    return (g, x, y) => {
        const m = TIER_METAL[tier]!
        sword(g, x - 6, y + 7, -0.8, 11 + tier, m, TIER_TRIM[tier]!, tier < 2 ? C.brown1 : TIER_TRIM[tier]![0], tier >= 3)
        if (tier >= 4) for (let i = 0; i < 3; i++) px(g, x + 1 + i * 2, y - 2 - i * 2, C.white)
        gearGem(g, x - 4, y + 5, tier)
    }
}
function gearBoots(tier: number): Glyph {
    return (g, x, y) => {
        const m = tier < 2 ? M.leather : TIER_METAL[tier]!
        rect(g, x - 4, y - 7, 6, 11, m[1]); rect(g, x - 4, y + 3, 11, 4, m[1]); rect(g, x - 4, y + 7, 12, 1, m[0])
        rect(g, x - 3, y - 7, 1, 10, m[2]); rect(g, x - 5, y - 7, 8, 2, TIER_TRIM[tier]![1])
        if (tier >= 3) { tri(g, x + 2, y - 5, x + 2, y - 1, x + 6, y - 6, TIER_TRIM[tier]![2]) } // wing
        gearGem(g, x - 1, y - 6, tier)
    }
}
function gearGauntlets(tier: number): Glyph {
    return (g, x, y) => {
        const m = tier === 0 ? M.leather : TIER_METAL[tier]!
        rect(g, x - 5, y - 1, 10, 8, m[1]); rect(g, x - 5, y - 1, 10, 1, m[2])
        for (let i = 0; i < 4; i++) rect(g, x - 5 + i * 3, y - 6 + (i === 0 ? 3 : 0), 2, 6, m[1])
        rect(g, x - 6, y + 5, 12, 3, TIER_TRIM[tier]![1])
        if (tier >= 2) for (let i = 0; i < 4; i++) px(g, x - 5 + i * 3, y - 1, m[2])
        gearGem(g, x, y + 2, tier)
    }
}
function gearCharm(tier: number): Glyph {
    return (g, x, y) => {
        arc(g, x, y + 1, 6, Math.PI * 1.08, Math.PI * 1.92, tier < 2 ? C.brown2 : C.gold1)
        const m = TIER_METAL[tier]!
        if (tier < 2) { disc(g, x, y + 3, 4, tier === 0 ? C.bone1 : C.steel2); px(g, x, y + 3, C.ink) } else gem(g, x, y + 3, 4 + (tier >> 1), [m[0], TIER_TRIM[tier]![1], TIER_TRIM[tier]![2]])
        if (tier >= 4) ring(g, x, y + 3, 6 + (tier - 4), C.gold2)
    }
}
function gearArmor(tier: number): Glyph {
    return (g, x, y) => {
        const m = tier === 0 ? M.leather : TIER_METAL[tier]!
        poly(g, [-7, -7, -3, -8, 0, -6, 3, -8, 7, -7, 6, 7, -6, 7], x, y, m[1])
        line(g, x - 6, y - 7, x - 5, y + 7, m[2])
        rect(g, x - 1, y - 5, 3, 11, TIER_TRIM[tier]![1])
        rect(g, x - 6, y + 3, 12, 1, m[0])
        if (tier >= 2) { rect(g, x - 9, y - 8, 4, 4, m[2]); rect(g, x + 6, y - 8, 4, 4, m[2]) }
        gearGem(g, x, y - 1, tier)
    }
}
function gearHelmet(tier: number): Glyph {
    return (g, x, y) => {
        const m = TIER_METAL[tier]!
        ellipse(g, x, y, 7, 7, m[1]); rect(g, x - 7, y, 15, 7, m[1])
        rect(g, x - 7, y, 15, 1, m[0]); rect(g, x - 3, y + 2, 9, 2, C.ink)
        px(g, x - 3, y - 4, m[2]); px(g, x - 2, y - 5, m[2])
        if (tier >= 1) rect(g, x, y + 2, 1, 5, m[2])
        if (tier >= 2) for (let i = 0; i < 3; i++) line(g, x - 1 + i, y - 7, x - 4 + i * 3, y - 11, TIER_TRIM[tier]![1])
        if (tier >= 4) { tri(g, x - 8, y - 2, x - 6, y, x - 11, y - 7, C.white); tri(g, x + 8, y - 2, x + 6, y, x + 11, y - 7, C.white) }
        gearGem(g, x, y - 2, tier)
    }
}

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const
const SLOT_DRAW = { weapon: gearWeapon, boots: gearBoots, gauntlets: gearGauntlets, charm: gearCharm, armor: gearArmor, helmet: gearHelmet } as const

export const GEAR_ICONS: Readonly<Record<string, Glyph>> = Object.fromEntries(
    (Object.keys(SLOT_DRAW) as (keyof typeof SLOT_DRAW)[]).flatMap(slot => RARITIES.map((r, tier) => [`gear_${slot}_${r}`, SLOT_DRAW[slot](tier)]))
)

// ── Currencies (16×16) ─────────────────────────────────────────────────────────────

function seal(g: Surface, x: number, y: number, m: Mat, mark: (g: Surface, x: number, y: number) => void): void {
    disc(g, x, y, 6, m[0])
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; disc(g, x + Math.cos(a) * 5.5, y + Math.sin(a) * 5.5, 1.3, m[0]) }
    disc(g, x - 0.5, y - 0.5, 4.5, m[1])
    mark(g, x, y)
    px(g, x - 3, y - 3, m[2])
}
function essence(g: Surface, x: number, y: number, m: Mat): void {
    tri(g, x - 4, y + 1, x + 4, y + 1, x, y - 7, m[1])
    disc(g, x, y + 2, 4, m[1])
    disc(g, x - 1, y + 1, 2, m[2]); px(g, x - 1, y, C.white)
    px(g, x + 3, y - 5, m[2]); px(g, x - 4, y - 3, m[2])
}
function key(g: Surface, x: number, y: number, m: Mat): void {
    ring(g, x - 3, y - 3, 3, m[1]); ring(g, x - 3, y - 3, 2, m[0])
    line(g, x - 1, y - 1, x + 5, y + 5, m[1], 2)
    rect(g, x + 2, y + 4, 2, 2, m[1]); rect(g, x + 4, y + 2, 2, 2, m[1])
    px(g, x - 4, y - 5, m[2])
}

const SKILL_M: Mat = [C.blue0, C.blue1, C.blue2]
const CHAMP_M: Mat = [C.red0, C.red1, C.red3]
const GEAR_M: Mat = [C.lava0, C.orange, C.gold2]
const ARTI_M: Mat = [C.teal0, C.teal2, C.teal3]

export const CURRENCY_ICONS: Readonly<Record<string, Glyph>> = {
    gold: (g, x, y) => { disc(g, x, y, 6, C.gold1); disc(g, x - 0.5, y - 0.5, 5, C.gold2); rect(g, x - 1, y - 3, 2, 6, C.gold1); px(g, x - 3, y - 3, C.gold3); px(g, x - 2, y - 4, C.white) },
    gems: (g, x, y) => gem(g, x, y, 6, [C.blue1, C.cyan, C.frost]),
    void_shards: (g, x, y) => { poly(g, [0, -7, 4, -1, 1, 7, -4, 2], x, y, C.purple1); poly(g, [0, -7, -4, 2, 0, 1], x, y, C.purple2); px(g, x - 1, y - 3, C.pink); px(g, x + 2, y - 5, C.white) },
    seal_skill: (g, x, y) => seal(g, x, y, SKILL_M, (gg, cx, cy) => { rect(gg, cx - 2, cy - 2, 4, 4, C.bone1); px(gg, cx - 1, cy - 1, C.blue1) }),
    seal_champion: (g, x, y) => seal(g, x, y, CHAMP_M, (gg, cx, cy) => { rect(gg, cx - 2, cy - 2, 4, 4, C.gold2); rect(gg, cx - 1, cy, 3, 1, C.ink) }),
    seal_gear: (g, x, y) => seal(g, x, y, GEAR_M, (gg, cx, cy) => { rect(gg, cx - 3, cy - 1, 6, 2, C.stone1); rect(gg, cx - 1, cy + 1, 2, 2, C.stone1) }),
    seal_artifact: (g, x, y) => seal(g, x, y, ARTI_M, (gg, cx, cy) => { ellipse(gg, cx, cy, 3, 1, C.white); px(gg, cx, cy, C.ink) }),
    essence_skill: (g, x, y) => essence(g, x, y, SKILL_M),
    essence_champion: (g, x, y) => essence(g, x, y, CHAMP_M),
    essence_gear: (g, x, y) => essence(g, x, y, GEAR_M),
    essence_artifact: (g, x, y) => essence(g, x, y, ARTI_M),
    trait_gems: (g, x, y) => { poly(g, [-3, -6, 3, -6, 6, 0, 3, 6, -3, 6, -6, 0], x, y, C.purple1); poly(g, [-2, -4, 2, -4, 4, 0, 2, 4, -2, 4, -4, 0], x, y, C.pink); px(g, x - 1, y - 2, C.white) },
    key_guild: (g, x, y) => key(g, x, y, CHAMP_M),
    key_training_grounds: (g, x, y) => key(g, x, y, SKILL_M),
    key_dig_site: (g, x, y) => key(g, x, y, ARTI_M),
    key_forge: (g, x, y) => key(g, x, y, GEAR_M),
    key_trait: (g, x, y) => key(g, x, y, [C.purple0, C.pink, C.white]),
    arena_medals: (g, x, y) => { tri(g, x - 4, y - 7, x, y - 7, x - 1, y, C.red1); tri(g, x, y - 7, x + 4, y - 7, x + 1, y, C.blue1); disc(g, x, y + 3, 4, C.gold1); disc(g, x - 0.5, y + 2.5, 3, C.gold2); px(g, x - 1, y + 2, C.white) }
}

export const CURRENCY_LABELS: Readonly<Record<string, string>> = {
    gold: 'Gold', gems: 'Gems', void_shards: 'Void Shards',
    seal_skill: 'Skill Seal', seal_champion: 'Champion Seal', seal_gear: 'Gear Seal', seal_artifact: 'Artifact Seal',
    essence_skill: 'Skill Essence', essence_champion: 'Champion Essence', essence_gear: 'Gear Essence', essence_artifact: 'Artifact Essence',
    trait_gems: 'Trait Gems',
    key_guild: 'Guild Raid Key', key_training_grounds: 'Training Grounds Raid Key', key_dig_site: 'Dig-site Raid Key', key_forge: 'Forge Raid Key', key_trait: 'Trait Raid Key',
    arena_medals: 'Arena Medals'
}

