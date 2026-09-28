// Raid bosses (asset-list §1.5) — five unique designs, one per raid — and the Arena training
// dummy (§1.6).
//
// The raid bosses are the biggest bodies in the game, too big for the Stage camera: the live stage
// shows a raid on the whole-scene camera. Each lives in its own file, built with the volume shading
// in raid-kit.ts:
//
//   solo_boss        Guild: the Gilded Warlord, a knight-king mounted on an armoured warhorse
//                    (raid-warlord.ts)
//   training_dummy   Training Grounds: the Great Dummy, a giant straw dummy that can't attack or
//                    die, only land, stand and take hits (raid-dummy.ts)
//   reinforced_boss  Dig-site: the Deepcoil, a tunnel wyrm rising out of the dig in an S, and its
//                    two add waves, burrow grubs and ore beetles (raid-wyrm.ts)
//   phased_boss      Forge: the Anvil Heart, a walking forge hotter each phase (raid-anvil.ts)
//   rampaging_boss   Trait: the Rampant, unkillable: no Death ever plays and no HP bar exists, so
//                    its level is drawn on the body, each tier bigger, more horned, more lit
//                    (raid-rampant.ts)

import { C } from './palette'
import type { CreatureDef } from './creature'
import { hitPhase } from './creature'
import { rect, px, disc, q } from './boss-kit'

export { GILDED_WARLORD } from './raid-warlord'
export { GREAT_DUMMY, DUMMY_IMPACT } from './raid-dummy'
export { DEEPCOIL, BURROW_GRUB, ORE_BEETLE } from './raid-wyrm'
export { ANVIL_HEART } from './raid-anvil'
export { RAMPANT, RAMPAGE_TIERS } from './raid-rampant'

const R = Math.round

// ═══════════════════════════════════════════════════════════════ Arena training dummy

/**
 * The Arena training dummy: a static pose and one small hit reaction, nothing else. Round 2: the
 * reference video's scarecrow. A burlap sack head with stitched X eyes and a straw tuft, a crossbar
 * with straw bursting from the sleeves, a sack body painted with a red target, all on a post.
 * Narrow enough (19px) to stand three abreast on the enemy marks.
 */
export const TRAINING_DUMMY: CreatureDef = {
    name: 'Training dummy', size: 48, shadow: 7, accent: C.red2,
    states: { static: { dur: 0.1, loop: true }, hit: { dur: 0.6, loop: false } },
    draw(s, st, t) {
        let lean = 0
        if (st === 'hit') {
            hitPhase(t, 0.6)
            const u = q(t) / 0.6
            lean = R(Math.sin(u * Math.PI * 3) * (1 - u) * 3)
        }
        const x = s.ax
        const y = s.ay
        // the post and its foot
        rect(s, x - 1, y - 14, 3, 14, C.brown2)
        rect(s, x - 1, y - 14, 1, 14, C.brown3)
        rect(s, x - 3, y - 2, 7, 2, C.brown1)
        const bx = x + lean
        const top = y - 30
        // crossbar with straw bursting from both sleeves
        rect(s, bx - 9, top + 12, 19, 3, C.brown2)
        rect(s, bx - 9, top + 12, 19, 1, C.brown3)
        for (const sx of [-1, 1]) {
            const ex = bx + sx * 10
            px(s, ex, top + 11, C.gold3); px(s, ex, top + 13, C.gold2); px(s, ex + sx, top + 12, C.gold3)
            px(s, ex + sx, top + 14, C.gold2); px(s, ex, top + 15, C.gold1)
        }
        // the body sack, tied at the waist, a red target painted on
        rect(s, bx - 5, top + 10, 11, 12, C.brown2)
        rect(s, bx - 4, top + 11, 9, 10, C.brown3)
        rect(s, bx + 3, top + 11, 2, 10, C.brown2)
        rect(s, bx - 5, top + 21, 11, 1, C.brown1)
        disc(s, bx, top + 16, 3, C.red1)
        disc(s, bx, top + 16, 2, C.brown3)
        disc(s, bx, top + 16, 1, C.red2)
        // the sack head: stitched X eyes, a stitched grin, a straw tuft on top
        rect(s, bx - 4, top + 1, 9, 9, C.brown3)
        rect(s, bx - 4, top + 1, 9, 1, C.bone1)
        rect(s, bx + 3, top + 2, 2, 8, C.brown2)
        px(s, bx - 3, top + 6, C.bone0); px(s, bx + 1, top + 2, C.bone0) // burlap weave
        rect(s, bx - 4, top + 9, 9, 1, C.brown1) // the neck tie
        for (const ex of [bx - 2, bx + 2]) { px(s, ex - 1, top + 3, C.ink); px(s, ex, top + 4, C.ink); px(s, ex - 1, top + 5, C.ink); px(s, ex + 1, top + 3, C.ink); px(s, ex + 1, top + 5, C.ink) }
        rect(s, bx - 2, top + 7, 5, 1, C.brown0)
        px(s, bx - 1, top + 8, C.brown0); px(s, bx + 1, top + 8, C.brown0)
        px(s, bx - 1, top, C.gold3); px(s, bx, top - 1, C.gold2); px(s, bx + 1, top, C.gold3); px(s, bx + 2, top - 1, C.gold1)
    }
}
