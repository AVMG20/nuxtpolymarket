// Dig-site Raid (reinforced_boss): the Buried Colossus and the two add waves that guard it.
//
// The Colossus is the bust of a buried king, dug half out of the excavation: carved in profile the
// way his people carved their kings, a striped lapis-and-gold headcloth with a cobra at the brow,
// kohl-lined eyes inlaid in the stone and lit by the relic in him, a broken nose, a braided beard, a
// jewelled collar across his chest, cracks of relic light across the sandstone. The dig's scaffold
// is still lashed to his shoulder, a lantern swinging from it. He rises out of the pit, and his
// near hand, resting on its rim, lifts and slams flat onto the party.

import { C } from './palette'
import type { CreatureDef } from './creature'
import { fr, deathPhase } from './creature'
import { B, Entry, bossStates, drive, finish, bz, elbow, P, rect, px, line, disc, tri, poly, taper, ellipse, ditherEllipse, ring, q, wv, hash2, waterline, type Pool } from './boss-kit'
import { mask, vol, eachPx, selOut, type Mat5 } from './raid-kit'

const R = Math.round

const SANDSTONE: Mat5 = { ramp: [C.brown1, C.brown2, C.brown3, C.bone1], hi: C.white, rim: C.brown2 }
const LAPIS: Mat5 = { ramp: [C.blue0, C.blue1, C.blue2, C.cyan], hi: C.white, rim: C.blue1 }
const GOLD: Mat5 = { ramp: [C.gold0, C.gold1, C.gold2, C.gold3], hi: C.white, rim: C.gold1 }
const TIMBER: Mat5 = { ramp: [C.brown0, C.brown1, C.brown2, C.brown3], hi: C.bone1, rim: C.brown1 }
/** The pit he stands in; the body is cut off at its front rim. */
const PIT: Pool = { dx: 0, rx: 76, ry: 6 }

export const BURIED_COLOSSUS: CreatureDef = {
    name: 'The Buried Colossus', size: 256, room: 14, shadow: 0, accent: C.cyan,
    states: bossStates(1.8, 2.4, 2.8),
    draw(s, st, t) {
        drive(this, st, t, 10, 2.4)
        const x = s.ax - 18 + B.lunge - B.kb
        const y = s.ay
        const br = B.breath
        const glow = Math.max(B.glow, st === 'idle' ? (Math.sin(q(t) / 2.4 * Math.PI * 2) + 1) * 0.25 : 0)
        const relic = glow > 0.6 ? C.white : glow > 0.25 ? C.cyan : C.teal2

        // ── the scaffold, behind him: two poles, crossbars, a plank ──
        const pole = (px0: number, top: number): void => {
            const m = mask(s, 'pole')
            taper(m, px0, y + 4, px0 + 2, y + top, 5, 4, 1)
            vol(s, m, TIMBER, 4)
        }
        pole(x - 52, -104)
        pole(x + 58, -96)
        line(s, x - 56, y - 98, x + 62, y - 92, C.brown1, 3)
        line(s, x - 56, y - 99, x + 62, y - 93, C.brown2)
        line(s, x - 54, y - 50, x + 60, y - 46, C.brown1, 2)
        for (const [lx, ly] of [[-51, -98], [59, -92], [-51, -50], [59, -46]] as const) { rect(s, x + lx - 2, y + ly - 1, 5, 3, C.bone0); px(s, x + lx, y + ly, C.brown0) } // lashings

        // ── the far arm, resting on the far rim ──
        {
            const m = mask(s, 'farArm')
            const sx = x - 30
            const sy = y - 60 + br
            elbow(sx, sy, x - 62, y - 6, 34, 34, -1)
            taper(m, sx, sy, P.x, P.y, 20, 16, 1)
            taper(m, P.x, P.y, x - 62, y - 6, 16, 14, 1)
            disc(m, P.x, P.y, 8, 1)
            ellipse(m, x - 66, y - 5, 12, 6, 1)
            vol(s, m, SANDSTONE, 14, -0.3)
        }

        // ── the body: shoulders, chest and neck in one carved volume ──
        const top = -140 + br
        {
            const m = mask(s, 'body')
            poly(m, [x - 44, y + 10, x - 42, y - 58 + br, x - 22, y - 76 + br, x + 22, y - 80 + br, x + 40, y - 64 + br, x + 42, y + 10], 0, 0, 1)
            disc(m, x + 20, y - 64 + br, 22, 1)
            disc(m, x - 24, y - 62 + br, 20, 1)
            taper(m, x + 6, y - 78 + br, x + 12, y - 100 + br, 26, 22, 1)
            vol(s, m, SANDSTONE, 18)
            // weathering: pits and chisel marks across the stone
            eachPx(m, (px_, py, edge) => {
                if (edge) return
                const h = hash2(px_, py)
                if (h < 0.03) s.set(px_, py, C.brown1)
            })
        }
        // the collar: bands of gold, lapis, carnelian and turquoise round the base of the neck
        {
            const cx = x + 10
            const cy = y - 84 + br
            const bands = [C.gold2, C.blue1, C.gold3, C.red1, C.gold2, C.teal2, C.gold1] as const
            for (let r = 0; r < bands.length; r++) {
                const rr = 16 + r * 3
                for (let a = 0.15; a < Math.PI - 0.15; a += 0.8 / rr) {
                    const px_ = R(cx + Math.cos(a) * rr * 1.25)
                    const py = R(cy + Math.sin(a) * rr * 0.75)
                    s.set(px_, py, bands[r]!)
                    s.set(px_, py + 1, bands[r]!)
                    // beads along the carnelian band
                    if (r === 3 && ((a * 40) | 0) % 3 === 0) s.set(px_, py, C.red3)
                }
            }
        }
        // relic cracks across the chest, lit from inside
        {
            const cracks = [[[-18, -40], [-8, -46], [-10, -56], [2, -60]], [[20, -30], [26, -40], [22, -48]], [[-34, -20], [-26, -24], [-28, -32]]] as const
            for (const c of cracks) {
                for (let i = 0; i < c.length - 1; i++) {
                    line(s, x + c[i]![0], y + c[i]![1] + br, x + c[i + 1]![0], y + c[i + 1]![1] + br, relic, 2)
                    line(s, x + c[i]![0] - 1, y + c[i]![1] + br - 1, x + c[i + 1]![0] - 1, y + c[i + 1]![1] + br - 1, C.teal0)
                }
            }
            // a glyph of the relic glowing on the chest
            const gx = x - 10
            const gy = y - 30 + br
            ring(s, gx, gy, 5, relic)
            line(s, gx, gy - 8, gx, gy + 6, relic)
            line(s, gx - 3, gy + 3, gx + 3, gy + 3, relic)
        }

        // ── the head, in profile: the headcloth, the face, the beard ──
        const hx = x + 12
        const hy = y + top + R(bz(0, -4, 4))
        {
            // the headcloth's wings behind the ear and its tail down the back, striped lapis and gold
            const m = mask(s, 'nemes')
            poly(m, [hx - 10, hy + 2, hx + 18, hy - 2, hx + 26, hy + 10, hx + 22, hy + 22, hx + 8, hy + 50, hx - 8, hy + 58, hx - 26, hy + 46, hx - 22, hy + 22], 0, 0, 1)
            vol(s, m, GOLD, 16)
            eachPx(m, (px_, py) => {
                // stripes run across the cloth, fanning with it
                const k = Math.floor((py - hy + (px_ - hx) * 0.25) / 4)
                if (k & 1) s.set(px_, py, m.get(px_ + 1, py + 1) && m.get(px_ - 1, py - 1) ? (((px_ + py) & 7) === 0 ? C.blue2 : C.blue1) : C.blue0)
            })
            selOut(s, m, C.gold0)
        }
        {
            // the face: brow band, forehead, the nose broken off, lips, the chin
            const m = mask(s, 'face')
            poly(m, [hx + 16, hy + 8, hx + 28, hy + 10, hx + 30, hy + 18, hx + 35, hy + 26, hx + 32, hy + 30, hx + 33, hy + 34, hx + 30, hy + 38, hx + 28, hy + 44, hx + 12, hy + 46, hx + 10, hy + 20], 0, 0, 1)
            vol(s, m, SANDSTONE, 10, 0.05)
            // the broken nose: a rough plane where it came off
            px(s, hx + 34, hy + 26, C.brown1); px(s, hx + 33, hy + 27, C.brown1); px(s, hx + 34, hy + 28, C.brown2)
            // lips and the line of the mouth, which opens on the slam
            const open = B.strike || B.roar ? 3 : 0
            line(s, hx + 27, hy + 33, hx + 32, hy + 33 + open, C.brown0)
            if (open) { rect(s, hx + 28, hy + 34, 3, open, C.ink); px(s, hx + 29, hy + 35, relic) }
            // the eye: inlaid, lined in kohl that runs back toward the ear, burning with the relic
            line(s, hx + 20, hy + 18, hx + 29, hy + 18, C.ink)
            line(s, hx + 19, hy + 19, hx + 15, hy + 20, C.ink)
            rect(s, hx + 22, hy + 19, 6, 2, B.hurt ? C.white : glow > 0.25 ? relic : C.bone1)
            px(s, hx + 25, hy + 19, glow > 0.25 ? C.white : C.ink)
            line(s, hx + 21, hy + 16, hx + 29, hy + 15, C.brown0) // the brow
            // a crack from the brow down the cheek, the relic showing through
            line(s, hx + 16, hy + 10, hx + 18, hy + 24, relic)
            line(s, hx + 18, hy + 24, hx + 15, hy + 32, relic)
            // the ear, half under the headcloth
            ellipse(s, hx + 14, hy + 24, 2, 4, C.brown2)
            px(s, hx + 14, hy + 24, C.brown1)
            selOut(s, m, C.brown1)
        }
        {
            // the brow band of the headcloth, and the cobra rearing from it
            const m = mask(s, 'band')
            poly(m, [hx - 10, hy + 2, hx + 18, hy - 3, hx + 30, hy + 6, hx + 30, hy + 10, hx + 16, hy + 8, hx - 10, hy + 8], 0, 0, 1)
            vol(s, m, GOLD, 6)
            const u = mask(s, 'uraeus')
            taper(u, hx + 28, hy + 6, hx + 31, hy, 4, 3, 1)
            disc(u, hx + 31, hy - 1, 3, 1)
            vol(s, u, GOLD, 5)
            px(s, hx + 32, hy - 2, C.red3)
        }
        {
            // the false beard: a braided plait under the chin, banded in gold
            const m = mask(s, 'beard')
            poly(m, [hx + 20, hy + 44, hx + 28, hy + 44, hx + 30, hy + 62, hx + 22, hy + 62], 0, 0, 1)
            vol(s, m, LAPIS, 6)
            for (let k = 0; k < 18; k += 3) line(s, hx + 20 + k * 0.1, hy + 46 + k, hx + 28 + k * 0.12, hy + 46 + k, C.gold2)
            rect(s, hx + 21, hy + 62, 10, 2, C.gold2)
        }

        // ── the lantern, hanging off the crossbar, swinging ──
        {
            const sw = wv(t, 2.4, 2)
            const lx = x + 50 + sw
            const ly = y - 80
            line(s, x + 50, y - 94, lx, ly - 6, C.stone2)
            rect(s, lx - 3, ly - 6, 7, 9, C.ink)
            rect(s, lx - 2, ly - 5, 5, 7, C.gold3)
            px(s, lx, ly - 3, C.white)
            rect(s, lx - 3, ly - 7, 7, 1, C.steel1)
            rect(s, lx - 3, ly + 3, 7, 1, C.steel1)
        }

        // ── the near arm: at rest on the rim, then raised and brought down flat ──
        {
            const sx = x + 22
            const sy = y - 62 + br
            const hand = st === 'attack' ? [bz(60, 40, 92), bz(-6, -118, -4)] : st === 'death' ? [60 - B.die * 8, -6 + B.die * 20] : [60, -6]
            const tx = x + hand[0]!
            const ty = y + hand[1]!
            elbow(sx, sy, tx, ty, 40, 40, st === 'attack' && B.wind > 0.3 ? 1 : -1)
            const m = mask(s, 'arm')
            taper(m, sx, sy, P.x, P.y, 24, 18, 1)
            taper(m, P.x, P.y, tx, ty, 18, 16, 1)
            disc(m, P.x, P.y, 9, 1)
            disc(m, sx, sy, 12, 1)
            vol(s, m, SANDSTONE, 14)
            selOut(s, m, C.brown1)
            // a gold armlet above the elbow, a cuff at the wrist
            const ax = sx + (P.x - sx) * 0.6
            const ay = sy + (P.y - sy) * 0.6
            disc(s, ax, ay, 7, C.gold1); disc(s, ax - 1, ay - 1, 5, C.gold2); px(s, R(ax) - 2, R(ay) - 3, C.white)
            px(s, R(ax), R(ay), C.blue1)
            // the hand: a flat carved palm, fingers laid together
            const hm = mask(s, 'hand')
            const a = Math.atan2(ty - P.y, tx - P.x)
            const ca = Math.cos(a)
            const sa = Math.sin(a)
            poly(hm, [tx - sa * 9, ty + ca * 9, tx + sa * 9, ty - ca * 9, tx + ca * 20 + sa * 7, ty + sa * 20 - ca * 7, tx + ca * 22 - sa * 7, ty + sa * 22 + ca * 7], 0, 0, 1)
            vol(s, hm, SANDSTONE, 10)
            selOut(s, hm, C.brown1)
            for (let k = -1; k <= 1; k++) line(s, tx + ca * 10 + sa * k * 4, ty + sa * 10 - ca * k * 4, tx + ca * 20 + sa * k * 4, ty + sa * 20 - ca * k * 4, C.brown1)
            rect(s, R(tx - 2), R(ty - 2), 4, 4, C.gold2)
        }
        finish(s, Entry.Rise, 26)
        waterline(s, PIT)
    },
    fx(dst, st, t, x, y, dir) {
        const k = fr(t, 10, 10)
        // the excavation: a dark pit, a rim of spoil heaped round it, stones, a ladder down into it
        ditherEllipse(dst, x, y - 1, PIT.rx, PIT.ry, C.ink, 16)
        ditherEllipse(dst, x, y - 2, PIT.rx - 8, PIT.ry - 2, C.brown0, 16)
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI
            const rx = x + R(Math.cos(a) * (PIT.rx + 2))
            dst.set(rx, y + R(Math.sin(a) * (PIT.ry + 1)), i & 1 ? C.brown2 : C.brown3)
            dst.set(rx + 1, y + R(Math.sin(a) * (PIT.ry + 1)) - 1, C.brown2)
        }
        for (let i = 0; i < 5; i++) dst.set(x + dir * (-60 + i * 29), y + 4 - (i & 1), C.stone2)
        // sand trickling off his shoulders
        for (let i = 0; i < 8; i++) dst.set(x + dir * (-28 + (i % 4) * 16), y - 70 + ((k * 3 + i * 9) % 60), i & 1 ? C.brown3 : C.bone1)
        // the slam: the ground cracks with the relic's light, sand thrown up
        if (st === 'attack' && B.strike) {
            const gx = x + dir * 96
            for (let i = 0; i < 16; i++) {
                const a = i / 16 * Math.PI
                dst.set(R(gx + Math.cos(a) * (10 + (i & 1) * 6)), R(y - 3 - Math.sin(a) * (6 + (i % 3) * 3)), i & 1 ? C.brown3 : C.bone1)
            }
            for (let i = 0; i < 10; i++) dst.set(gx + dir * (i - 5) * 3, y, C.cyan)
        }
    }
}

// ── Add waves ───────────────────────────────────────────────────────────────────

/** Add wave 1 — the Dig Scarab: a beetle the size of a dog, gold-shelled and inlaid with lapis, a relic sun between its mandibles. */
export const DIG_SCARAB: CreatureDef = {
    name: 'Dig Scarab', size: 48, shadow: 12, accent: C.gold2,
    states: { idle: { dur: 0.8, loop: true }, attack: { dur: 0.8, loop: false }, death: { dur: 1.0, loop: false } },
    draw(s, st, t) {
        const x = s.ax
        const y = s.ay
        let lunge = 0
        let die = 0
        if (st === 'attack') {
            const u = q(t) / 0.8
            lunge = u < 0.4 ? -1 : u < 0.6 ? 7 : R(7 * (1 - (u - 0.6) / 0.4))
        }
        if (st === 'death') die = deathPhase(t, 1.0)
        const leg = fr(t, 10, 2)
        const bx = x + lunge
        const by = y - 9 + R(die * 3)
        // legs, three a side, the near ones stepping
        for (let i = 0; i < 3; i++) {
            const lx = bx - 7 + i * 7
            line(s, lx, by + 3, lx - 3 + (leg ? 1 : -1) * (i & 1 ? 1 : -1), y - 1, C.gold0)
            line(s, lx - 3 + (leg ? 1 : -1) * (i & 1 ? 1 : -1), y - 1, lx - 5, y - 1, C.gold0)
        }
        // the shell: two gold wing-cases split down the back, lapis set in them
        const m = mask(s, 'scarab')
        ellipse(m, bx - 1, by, 12, 7, 1)
        vol(s, m, GOLD, 8)
        line(s, bx - 1, by - 6, bx - 1, by + 5, C.gold0)
        for (const [ox, oy] of [[-6, -2], [4, -2], [-3, 2]] as const) { disc(s, bx + ox, by + oy, 1.5, C.blue1); px(s, bx + ox, by + oy - 1, C.cyan) }
        // the head and its pronotum, the mandibles, a red sun held between them
        const hm = mask(s, 'shead')
        ellipse(hm, bx + 11, by + 1, 5, 4, 1)
        vol(s, hm, LAPIS, 4)
        line(s, bx + 14, by - 1, bx + 18, by - 3, C.gold1)
        line(s, bx + 14, by + 3, bx + 18, by + 5, C.gold1)
        disc(s, bx + 19, by + 1, 2, st === 'death' ? C.red0 : C.red2)
        px(s, bx + 18, by, C.gold3)
        px(s, bx + 12, by, st === 'death' ? C.ink : C.cyan)
    }
}

/** Add wave 2 — the Relic Shard: a splinter of the king's obelisk, floating, its glyphs burning. */
export const RELIC_SHARD: CreatureDef = {
    name: 'Relic Shard', size: 48, shadow: 7, hover: 1, accent: C.cyan,
    states: { idle: { dur: 1.2, loop: true }, attack: { dur: 0.8, loop: false }, death: { dur: 1.0, loop: false } },
    draw(s, st, t) {
        const x = s.ax
        let die = 0
        let glow = 0
        if (st === 'attack') { const u = q(t) / 0.8; glow = u < 0.5 ? u * 2 : 1 - (u - 0.5) * 2 }
        if (st === 'death') die = deathPhase(t, 1.0)
        const y = s.ay - 16 + wv(t, 1.2, 2) + R(die * 10)
        // the shard: a broken obelisk tip, capped in gold, its faces lit left
        const m = mask(s, 'shard')
        poly(m, [x - 1, y - 14, x + 6, y - 8, x + 5, y + 10, x - 6, y + 10, x - 7, y - 6], 0, 0, 1)
        vol(s, m, SANDSTONE, 8)
        tri(s, x - 1, y - 14, x + 6, y - 8, x - 7, y - 6, C.gold2)
        px(s, x - 1, y - 13, C.white)
        // its broken foot, jagged
        for (let i = -5; i <= 4; i += 2) px(s, x + i, y + 10 + (i & 2 ? 1 : 0), C.brown1)
        // glyphs down its face, brighter as it looses its bolt
        const c = glow > 0.4 ? C.white : C.cyan
        line(s, x - 2, y - 2, x + 2, y - 2, c); line(s, x, y - 4, x, y + 1, c)
        ring(s, x, y + 5, 2, c)
        if (glow > 0.2) ring(s, x, y, 11 + R(glow * 3), C.cyan)
        for (let i = 0; i < 3; i++) { const a = q(t) * 3 + i * 2.1; px(s, x + R(Math.cos(a) * 12), y + R(Math.sin(a) * 4), C.teal3) }
    }
}
