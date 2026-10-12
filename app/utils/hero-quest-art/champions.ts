// Champions: 4 chassis × 6 states, 48 skins (asset-list §1.2), on the Hero's chibi body.
//
// A chassis is one set of clips per archetype, animated once. A skin is a table row —
// head, colours, weapon — composed onto that archetype's Look. The rarity ladder is a
// real redesign, layered: each step adds pieces (trim → pauldrons and a cape → gold, gems and
// a long cape → a halo, crown or glowing eyes plus a sparkle aura → an animated mythic aura),
// so a Mythic reads as a Mythic in silhouette, not as a Common in a new colour.

import { Ease, Phase, step, type Clip } from './anim'
import { C } from './palette'
import { line, px, rect, bayer, type Surface } from './surface'
import { HP, J, fxX, fxY, hclip, hitClip, deathClip, runClip, floatClip, rest, type Look } from './rig'
import { sparks, streak } from './hero-parts'
import { chibiHead, crescent, drawChibi, pix, type Head } from './chibi'
import { chibiCape, robe } from './hero-kit'
import { M, tip, sword, axe, hammer, mace, spear, dagger, scythe, staff, shield, tome, orb, Gem, ShieldStyle, type Mat } from './weapons'
import { CHAMPIONS, CHAMPION_BY_ID } from '../../../shared/utils/hero-quest/content/champions'
import { RARITIES } from '../../../shared/utils/hero-quest/gacha'
import type { ChampionArchetype } from '../../../shared/utils/hero-quest/types'

export const CHAMPION_STATES = ['idle', 'attack', 'cast', 'hit', 'death', 'move'] as const
export interface ChassisClips { idle: Clip, attack: Clip, cast: Clip, hit: Clip, death: Clip, move: Clip }

const CH = Phase.Charge
const CA = Phase.Cast
const RE = Phase.Recover

// ── Materials ──────────────────────────────────────────────────────────────────────

const SKIN = {
    light: [C.skin0, C.skin1, C.skin2],
    tan: [C.skin0, C.brown3, C.skin1],
    dark: [C.brown1, C.brown2, C.brown3],
    pale: [C.skin1, C.skin2, C.bone1],
    stone: [C.stone1, C.stone2, C.stone3],
    violet: [C.purple0, C.purple1, C.purple2],
    shadow: [C.void, C.night1, C.night2],
    frost: [C.night3, C.haze, C.frost],
    green: [C.green1, C.green2, C.green3],
    ash: [C.stone2, C.stone3, C.bone0]
} as const satisfies Record<string, Mat>

const HAIR = {
    brown: [C.brown1, C.brown2, C.brown3],
    black: [C.ink, C.stone1, C.stone2],
    blonde: [C.gold1, C.gold2, C.gold3],
    red: [C.red1, C.orange, C.red3],
    white: [C.bone0, C.bone1, C.white],
    silver: [C.steel1, C.steel2, C.steel3],
    gray: [C.stone2, C.stone3, C.bone0],
    teal: [C.teal1, C.teal2, C.teal3],
    violet: [C.purple1, C.purple2, C.pink],
    green: [C.green1, C.green2, C.green3]
} as const satisfies Record<string, Mat>

const CLOTH = {
    leather: [C.brown1, C.brown2, C.brown3],
    moss: [C.green0, C.green1, C.green2],
    crimson: [C.red0, C.red1, C.red2],
    teal: [C.teal0, C.teal1, C.teal2],
    rust: [C.brown1, C.brown2, C.orange],
    plum: [C.purple0, C.purple1, C.purple2],
    obsidian: [C.void, C.stone0, C.stone1],
    royal: [C.blue0, C.blue1, C.blue2],
    ivory: [C.bone0, C.bone1, C.white],
    gold: [C.gold0, C.gold1, C.gold2],
    slate: [C.stone1, C.stone2, C.stone3],
    olive: [C.olive0, C.olive1, C.olive2],
    night: [C.night0, C.night1, C.night2],
    sky: [C.night3, C.haze, C.frost],
    voidc: [C.ink, C.void, C.purple0]
} as const satisfies Record<string, Mat>

type HairStyle = 'short' | 'long' | 'bald' | 'topknot' | 'braid' | 'mohawk' | 'bun' | 'wild'
type Headgear = 'none' | 'hood' | 'helm' | 'greathelm' | 'crown' | 'horns' | 'circlet' | 'hat' | 'mask' | 'headband' | 'plume' | 'flowers' | 'crowmask'
type DamageWeapon = 'sword' | 'spear' | 'dagger' | 'scythe' | 'axe' | 'greatsword' | 'greataxe'
type TankWeapon = 'mace' | 'hammer' | 'sword' | 'axe'

interface Skin {
    skin: Mat
    hair: Mat
    style: HairStyle
    head: Headgear
    /** Main cloth or armour, a trim, and the metal of weapon and fittings. */
    cloth: Mat
    trim: Mat
    metal: Mat
    eye: number
    beard?: boolean
    elf?: boolean
    wings?: boolean
    weapon?: DamageWeapon | TankWeapon
    shield?: ShieldStyle
    gem?: Gem
    gemMat?: Mat
    /** Aura / effect colour for legendary+ sparkle and mythic auras. */
    aura: number
    aura2: number
}

/** Every Champion's look, keyed by content ID. Archetype and rarity come from the roster. */
const SKINS: Readonly<Record<string, Skin>> = {
    // ── Damage ────────────────────────────────────────────────────
    champ_rask: { skin: SKIN.light, hair: HAIR.brown, style: 'short', head: 'none', cloth: CLOTH.leather, trim: CLOTH.leather, metal: M.iron, eye: C.ink, weapon: 'sword', aura: C.steel3, aura2: C.white },
    champ_vheln: { skin: SKIN.tan, hair: HAIR.black, style: 'long', head: 'headband', cloth: CLOTH.moss, trim: CLOTH.leather, metal: M.iron, eye: C.ink, weapon: 'dagger', aura: C.green3, aura2: C.white },
    champ_sorrek: { skin: SKIN.dark, hair: HAIR.black, style: 'bald', head: 'headband', cloth: CLOTH.crimson, trim: CLOTH.leather, metal: M.steel, eye: C.ink, beard: true, weapon: 'axe', aura: C.red2, aura2: C.orange },
    champ_ayra: { skin: SKIN.light, hair: HAIR.red, style: 'braid', head: 'circlet', cloth: CLOTH.teal, trim: CLOTH.ivory, metal: M.steel, eye: C.ink, weapon: 'spear', aura: C.teal3, aura2: C.white },
    champ_dorne: { skin: SKIN.tan, hair: HAIR.black, style: 'mohawk', head: 'none', cloth: CLOTH.rust, trim: CLOTH.crimson, metal: M.steel, eye: C.ink, beard: true, weapon: 'greataxe', aura: C.orange, aura2: C.gold3 },
    champ_kestrel: { skin: SKIN.light, hair: HAIR.blonde, style: 'bun', head: 'hood', cloth: CLOTH.plum, trim: CLOTH.slate, metal: M.steel, eye: C.ink, weapon: 'dagger', aura: C.pink, aura2: C.white },
    champ_malachai: { skin: SKIN.dark, hair: HAIR.white, style: 'short', head: 'none', cloth: CLOTH.obsidian, trim: CLOTH.gold, metal: M.steel, eye: C.red2, weapon: 'greatsword', aura: C.red2, aura2: C.orange },
    champ_ryn: { skin: SKIN.pale, hair: HAIR.silver, style: 'long', head: 'circlet', cloth: CLOTH.crimson, trim: CLOTH.gold, metal: M.steel, eye: C.cyan, elf: true, weapon: 'sword', aura: C.red3, aura2: C.gold3 },
    champ_vashka: { skin: SKIN.tan, hair: HAIR.black, style: 'topknot', head: 'none', cloth: CLOTH.royal, trim: CLOTH.gold, metal: M.gold, eye: C.cyan, weapon: 'spear', aura: C.cyan, aura2: C.white },
    champ_toren: { skin: SKIN.light, hair: HAIR.red, style: 'short', head: 'horns', cloth: CLOTH.crimson, trim: CLOTH.gold, metal: M.gold, eye: C.ink, beard: true, weapon: 'greatsword', aura: C.gold2, aura2: C.orange },
    champ_kaira: { skin: SKIN.violet, hair: HAIR.black, style: 'long', head: 'horns', cloth: CLOTH.voidc, trim: CLOTH.plum, metal: M.voidm, eye: C.pink, wings: true, weapon: 'scythe', aura: C.purple2, aura2: C.pink },
    champ_draveth: { skin: SKIN.ash, hair: HAIR.black, style: 'bald', head: 'hood', cloth: CLOTH.obsidian, trim: CLOTH.crimson, metal: M.blood, eye: C.lava1, weapon: 'greataxe', aura: C.lava1, aura2: C.gold2 },

    // ── Tank ──────────────────────────────────────────────────────
    champ_borin: { skin: SKIN.light, hair: HAIR.brown, style: 'short', head: 'helm', cloth: CLOTH.leather, trim: CLOTH.leather, metal: M.iron, eye: C.ink, beard: true, weapon: 'mace', shield: ShieldStyle.Round, aura: C.steel3, aura2: C.white },
    champ_hulric: { skin: SKIN.dark, hair: HAIR.black, style: 'bald', head: 'none', cloth: CLOTH.slate, trim: CLOTH.leather, metal: M.iron, eye: C.ink, weapon: 'sword', shield: ShieldStyle.Round, aura: C.steel3, aura2: C.white },
    champ_gareth: { skin: SKIN.tan, hair: HAIR.brown, style: 'short', head: 'helm', cloth: CLOTH.crimson, trim: CLOTH.slate, metal: M.steel, eye: C.ink, weapon: 'hammer', shield: ShieldStyle.Kite, aura: C.red3, aura2: C.white },
    champ_mora: { skin: SKIN.light, hair: HAIR.gray, style: 'braid', head: 'none', cloth: CLOTH.teal, trim: CLOTH.slate, metal: M.steel, eye: C.ink, weapon: 'mace', shield: ShieldStyle.Round, aura: C.teal3, aura2: C.white },
    champ_ulrid: { skin: SKIN.light, hair: HAIR.blonde, style: 'short', head: 'greathelm', cloth: CLOTH.royal, trim: CLOTH.gold, metal: M.steel, eye: C.cyan, weapon: 'sword', shield: ShieldStyle.Kite, aura: C.cyan, aura2: C.white },
    champ_bastyn: { skin: SKIN.tan, hair: HAIR.black, style: 'short', head: 'horns', cloth: CLOTH.rust, trim: CLOTH.leather, metal: M.bronze, eye: C.ink, beard: true, weapon: 'axe', shield: ShieldStyle.Tower, aura: C.gold2, aura2: C.orange },
    champ_ordwin: { skin: SKIN.light, hair: HAIR.brown, style: 'short', head: 'greathelm', cloth: CLOTH.royal, trim: CLOTH.obsidian, metal: M.gold, eye: C.gold3, weapon: 'hammer', shield: ShieldStyle.Tower, aura: C.gold3, aura2: C.white },
    champ_katrin: { skin: SKIN.pale, hair: HAIR.red, style: 'long', head: 'plume', cloth: CLOTH.ivory, trim: CLOTH.gold, metal: M.steel, eye: C.ink, weapon: 'sword', shield: ShieldStyle.Kite, aura: C.gold2, aura2: C.white },
    champ_volgrim: { skin: SKIN.tan, hair: HAIR.white, style: 'bald', head: 'crown', cloth: CLOTH.slate, trim: CLOTH.gold, metal: M.gold, eye: C.cyan, beard: true, weapon: 'hammer', shield: ShieldStyle.Tower, aura: C.cyan, aura2: C.gold3 },
    champ_sable: { skin: SKIN.dark, hair: HAIR.black, style: 'short', head: 'greathelm', cloth: CLOTH.obsidian, trim: CLOTH.crimson, metal: M.obsidian, eye: C.red2, weapon: 'mace', shield: ShieldStyle.Tower, aura: C.red2, aura2: C.lava1 },
    champ_thoraxx: { skin: SKIN.stone, hair: HAIR.gray, style: 'bald', head: 'none', cloth: CLOTH.crimson, trim: CLOTH.rust, metal: M.obsidian, eye: C.lava1, weapon: 'hammer', shield: ShieldStyle.Tower, aura: C.lava1, aura2: C.gold2 },
    champ_ferrun: { skin: SKIN.light, hair: HAIR.blonde, style: 'short', head: 'greathelm', cloth: CLOTH.royal, trim: CLOTH.gold, metal: M.steel, eye: C.gold3, wings: true, weapon: 'sword', shield: ShieldStyle.Kite, aura: C.gold3, aura2: C.white },

    // ── Support ───────────────────────────────────────────────────
    champ_meret: { skin: SKIN.light, hair: HAIR.white, style: 'bald', head: 'none', cloth: CLOTH.leather, trim: CLOTH.olive, metal: M.wood, eye: C.ink, beard: true, gem: Gem.Orb, gemMat: M.nature, aura: C.green3, aura2: C.white },
    champ_lys: { skin: SKIN.light, hair: HAIR.blonde, style: 'short', head: 'none', cloth: CLOTH.ivory, trim: CLOTH.moss, metal: M.wood, eye: C.ink, gem: Gem.Crystal, gemMat: M.nature, aura: C.green4, aura2: C.white },
    champ_tavin: { skin: SKIN.tan, hair: HAIR.brown, style: 'short', head: 'hood', cloth: CLOTH.royal, trim: CLOTH.ivory, metal: M.wood, eye: C.ink, gem: Gem.Moon, gemMat: M.ice, aura: C.cyan, aura2: C.white },
    champ_ceren: { skin: SKIN.light, hair: HAIR.brown, style: 'long', head: 'none', cloth: CLOTH.teal, trim: CLOTH.ivory, metal: M.wood, eye: C.ink, gem: Gem.Orb, gemMat: M.sea, aura: C.teal3, aura2: C.white },
    champ_calen: { skin: SKIN.dark, hair: HAIR.black, style: 'bun', head: 'none', cloth: CLOTH.teal, trim: CLOTH.gold, metal: M.darkwood, eye: C.ink, gem: Gem.Moon, gemMat: M.sea, aura: C.teal3, aura2: C.white },
    champ_illyana: { skin: SKIN.pale, hair: HAIR.red, style: 'long', head: 'circlet', cloth: CLOTH.plum, trim: CLOTH.gold, metal: M.wood, eye: C.ink, gem: Gem.Crystal, gemMat: M.arcane, aura: C.pink, aura2: C.white },
    champ_ordo: { skin: SKIN.tan, hair: HAIR.gray, style: 'short', head: 'none', cloth: CLOTH.moss, trim: CLOTH.gold, metal: M.darkwood, eye: C.ink, beard: true, gem: Gem.Totem, gemMat: M.nature, aura: C.green3, aura2: C.gold3 },
    champ_nieve: { skin: SKIN.pale, hair: HAIR.white, style: 'long', head: 'circlet', cloth: CLOTH.ivory, trim: CLOTH.gold, metal: M.gold, eye: C.cyan, gem: Gem.Orb, gemMat: M.holy, aura: C.gold3, aura2: C.white },
    champ_aurelith: { skin: SKIN.tan, hair: HAIR.blonde, style: 'bun', head: 'crown', cloth: CLOTH.gold, trim: CLOTH.ivory, metal: M.gold, eye: C.gold3, gem: Gem.Crystal, gemMat: M.holy, aura: C.gold3, aura2: C.white },
    champ_mistral: { skin: SKIN.light, hair: HAIR.white, style: 'wild', head: 'none', cloth: CLOTH.sky, trim: CLOTH.teal, metal: M.steel, eye: C.teal3, elf: true, gem: Gem.Moon, gemMat: M.ice, aura: C.frost, aura2: C.teal3 },
    champ_seraphel: { skin: SKIN.pale, hair: HAIR.blonde, style: 'long', head: 'circlet', cloth: CLOTH.ivory, trim: CLOTH.gold, metal: M.holy, eye: C.gold3, wings: true, gem: Gem.Orb, gemMat: M.holy, aura: C.gold3, aura2: C.white },
    champ_vaelora: { skin: SKIN.green, hair: HAIR.green, style: 'long', head: 'flowers', cloth: CLOTH.moss, trim: CLOTH.leather, metal: M.darkwood, eye: C.gold3, elf: true, gem: Gem.Totem, gemMat: M.nature, aura: C.green4, aura2: C.pink },

    // ── Control ───────────────────────────────────────────────────
    champ_ilyx: { skin: SKIN.light, hair: HAIR.black, style: 'short', head: 'hood', cloth: CLOTH.slate, trim: CLOTH.royal, metal: M.iron, eye: C.ink, gem: Gem.Orb, gemMat: M.ice, aura: C.cyan, aura2: C.white },
    champ_nym: { skin: SKIN.pale, hair: HAIR.violet, style: 'long', head: 'mask', cloth: CLOTH.plum, trim: CLOTH.slate, metal: M.iron, eye: C.pink, gem: Gem.Orb, gemMat: M.arcane, aura: C.pink, aura2: C.white },
    champ_fesk: { skin: SKIN.green, hair: HAIR.black, style: 'short', head: 'hat', cloth: CLOTH.olive, trim: CLOTH.leather, metal: M.darkwood, eye: C.gold2, gem: Gem.Skull, gemMat: M.nature, aura: C.green4, aura2: C.olive2 },
    champ_orien: { skin: SKIN.tan, hair: HAIR.black, style: 'bald', head: 'none', cloth: CLOTH.night, trim: CLOTH.slate, metal: M.steel, eye: C.cyan, gem: Gem.Orb, gemMat: M.steel, aura: C.steel3, aura2: C.cyan },
    champ_varn: { skin: SKIN.light, hair: HAIR.red, style: 'wild', head: 'horns', cloth: CLOTH.crimson, trim: CLOTH.plum, metal: M.gold, eye: C.gold3, gem: Gem.Crystal, gemMat: M.arcane, aura: C.pink, aura2: C.gold3 },
    champ_sylwen: { skin: SKIN.pale, hair: HAIR.green, style: 'long', head: 'hood', cloth: CLOTH.moss, trim: CLOTH.olive, metal: M.darkwood, eye: C.green4, elf: true, gem: Gem.Crystal, gemMat: M.nature, aura: C.green4, aura2: C.white },
    champ_corvath: { skin: SKIN.ash, hair: HAIR.black, style: 'short', head: 'crowmask', cloth: CLOTH.night, trim: CLOTH.plum, metal: M.obsidian, eye: C.cyan, gem: Gem.Orb, gemMat: M.voidm, aura: C.purple2, aura2: C.cyan },
    champ_ashen: { skin: SKIN.ash, hair: HAIR.white, style: 'long', head: 'circlet', cloth: CLOTH.slate, trim: CLOTH.gold, metal: M.gold, eye: C.gold3, gem: Gem.Moon, gemMat: M.holy, aura: C.bone1, aura2: C.gold3 },
    champ_nixara: { skin: SKIN.frost, hair: HAIR.silver, style: 'long', head: 'crown', cloth: CLOTH.sky, trim: CLOTH.royal, metal: M.ice, eye: C.white, elf: true, gem: Gem.Crystal, gemMat: M.ice, aura: C.frost, aura2: C.cyan },
    champ_thess: { skin: SKIN.shadow, hair: HAIR.black, style: 'bald', head: 'hood', cloth: CLOTH.plum, trim: CLOTH.plum, metal: M.voidm, eye: C.pink, gem: Gem.Skull, gemMat: M.voidm, aura: C.purple2, aura2: C.pink },
    champ_zeraphine: { skin: SKIN.pale, hair: HAIR.white, style: 'long', head: 'crown', cloth: CLOTH.plum, trim: CLOTH.gold, metal: M.gold, eye: C.gold3, elf: true, gem: Gem.Moon, gemMat: M.arcane, aura: C.gold3, aura2: C.pink },
    champ_umbriel: { skin: SKIN.shadow, hair: HAIR.black, style: 'bald', head: 'hood', cloth: CLOTH.voidc, trim: CLOTH.night, metal: M.voidm, eye: C.cyan, wings: true, gem: Gem.Orb, gemMat: M.voidm, aura: C.night3, aura2: C.cyan }
}


// ── Heads ──────────────────────────────────────────────────────────────────────────
//
// Chibi heads built the way the Hero's are (chibi.ts), as pixel maps, but assembled from the
// skin row rather than drawn per Champion: a hair style gives the cranium and the back of the
// head, then a beard, elf ears and the headgear are stamped over it. The grid is the Hero's:
// 12 wide, neck at column 5, eye at column 9, and the face in the bottom six rows, so
// `chibiHead` animates the eye and mouth the same way.

/** Colour keys for a Champion head: fixed inks, plus that Champion's own ramps. */
function headKey(k: Skin): Record<string, number> {
    return {
        k: C.ink, w: C.white, b: C.bone1, B: C.bone0,
        g: C.gold1, G: C.gold2, Y: C.gold3, z: C.red1, r: C.red2, R: C.red3, p: C.pink, n: C.green3,
        v: C.void, X: C.night1,
        d: k.skin[0], s: k.skin[1], S: k.skin[2],
        h: k.hair[0], H: k.hair[1], L: k.hair[2],
        m: k.metal[0], M: k.metal[1], N: k.metal[2],
        c: k.cloth[0], C: k.cloth[1], D: k.cloth[2],
        t: k.trim[0], T: k.trim[1], a: k.aura, A: k.aura2
    }
}

/** A sparse character grid: stamps land at any offset and the bounds grow to fit. */
class Sketch {
    private readonly cells = new Map<string, string>()

    /** '.' keeps what is under the stamp, '_' erases it. */
    stamp(rows: readonly string[], x0 = 0, y0 = 0): this {
        rows.forEach((row, yy) => {
            for (let xx = 0; xx < row.length; xx++) {
                const ch = row[xx]!
                if (ch === '.') continue
                const key = `${x0 + xx},${y0 + yy}`
                if (ch === '_') this.cells.delete(key)
                else this.cells.set(key, ch)
            }
        })
        return this
    }

    /** Erase everything above row `y`: a helm or hood replaces the hair it covers. */
    clearAbove(y: number): this {
        for (const key of [...this.cells.keys()]) if (Number(key.split(',')[1]) < y) this.cells.delete(key)
        return this
    }

    /** Compile to a head whose bottom row is the neck row (y = 10), like every Hero head. */
    head(key: Record<string, number>): Head {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity
        for (const k of this.cells.keys()) {
            const [x, y] = k.split(',').map(Number) as [number, number]
            x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y)
        }
        const rows: string[] = []
        for (let y = y0; y <= 10; y++) {
            let row = ''
            for (let x = x0; x <= x1; x++) row += this.cells.get(`${x},${y}`) ?? '.'
            rows.push(row)
        }
        return { pix: pix(rows, key), neck: 5 - x0, eye: 9 - x0 }
    }
}

/** The face every Champion shares, right of the back-of-head columns: eye, cheek, chin. */
const FRONT = ['sSSSkS.', 'sSSSkSs', 'sSSSSS.', 'sSSSSS.', 'ssSSs..', 'ddd....']

interface Style {
    /** Rows 0–4, above the face. */
    crown: readonly string[]
    /** Columns 0–4 of the six face rows: sideburns, ear, hair falling behind. */
    back: readonly string[]
    extra?: readonly { rows: readonly string[], x: number, y: number }[]
}

const SHORT_CROWN = ['...hHHHh....', '.hHHLLLHHh..', 'hHHHHHLLHHh.', 'hHHHHHHHHHHh', 'hHHHHHHHHsHh']
const SHORT_BACK = ['hhHHH', 'hhHHd', '.hHHs', '.hhHs', '..hhs', '.....']
const BALD_CROWN = ['...dssss....', '.dsssSSSSs..', 'dssssSSSSSs.', 'dsssssSSSSSs', 'dssssssssHhs']
const BALD_BACK = ['dssss', 'dssds', '.dsss', '.ddss', '..dds', '.....']

const STYLES: Readonly<Record<HairStyle, Style>> = {
    short: { crown: SHORT_CROWN, back: SHORT_BACK },
    long: {
        crown: ['...hHHHh....', '.hHHHLLHHh..', 'hHHHHHHLLHh.', 'hHHHHHHHHHHh', 'hHHHHHHHssHh'],
        back: ['hHHHH', 'hHHHd', 'hHHHs', 'hHHhs', 'hHHhs', 'hHh..']
    },
    bald: { crown: BALD_CROWN, back: BALD_BACK },
    braid: { crown: SHORT_CROWN, back: ['hhHHH', 'hhHHd', 'hhHHs', 'HhhHs', 'h.hhs', 'G....'] },
    topknot: { crown: SHORT_CROWN, back: SHORT_BACK, extra: [{ rows: ['.hL.', 'hHLh', '.Gg.'], x: 2, y: -3 }] },
    bun: { crown: SHORT_CROWN, back: SHORT_BACK, extra: [{ rows: ['.hHh.', 'hHLHh', 'hHHHh', '.hHh.'], x: -1, y: -1 }] },
    mohawk: {
        crown: BALD_CROWN, back: BALD_BACK,
        extra: [{ rows: ['..hL..', '.hHHL.', 'hHHHHL', '.hHHHh', '..hHh.'], x: 2, y: -3 }]
    },
    wild: {
        crown: SHORT_CROWN,
        back: ['HhHHH', 'hHHHd', 'HhHHs', 'h.hHs', 'H..hs', '.....'],
        extra: [
            { rows: ['..H...h..H...', '.hH..hH.HH.h.'], x: -1, y: -2 },
            { rows: ['H', 'h', 'H', '.', 'h'], x: -1, y: 5 }
        ]
    }
}

const BEARD = ['H......', 'HHHLHH.', 'hHHHHH.', '.hHHh..']
const ELF_EAR = ['S...', '.S..', '..S.']

/** Headgear that hides the hair under it: everything above that row is erased first. */
const COVERS: Partial<Record<Headgear, number>> = { hood: 5, helm: 4, greathelm: 11, plume: 4, hat: 4, crowmask: 11 }
/** Headgear that hides the mouth, so it never opens. */
const MASKED: ReadonlySet<Headgear> = new Set(['greathelm', 'mask', 'crowmask'])

const HELM = ['....mmmm....', '..mMMNNMm...', '.mMMMMNNMm..', '.mMMMMMMMm..', 'mMMMMMMMMMMm']

function headgear(sk: Sketch, k: Skin, tier: number): void {
    switch (k.head) {
        case 'none': break
        case 'headband':
            sk.stamp(['..tTTTTTTTTTT', '.T...........', 'T............'], -2, 3)
            break
        case 'circlet':
            sk.stamp(['gGGGGGGGGaGG'], 0, 3)
            break
        case 'crown':
            sk.stamp(['.Y...Y...Y..', '.GY.GaG.YG..', '.gGGGGGGGGg.'], 0, -2)
            break
        case 'horns':
            sk.stamp(['w............w', 'b............b', 'bB..........Bb', '.bB........Bb.', '..bB......Bb..'], -1, -4)
            if (tier >= 4) sk.stamp(['B............B'], -1, -5)
            break
        case 'flowers':
            sk.stamp(['.p...Y..', 'pnpnnYnw'], 1, -1)
            break
        case 'mask':
            sk.stamp(['bbbbb', 'bBbbb', '.bbb.'], 6, 7)
            break
        case 'helm':
            sk.stamp(HELM, 0, -1)
            break
        case 'plume':
            sk.stamp(HELM, 0, -1).stamp(['.zrR', 'zrrRR', 'zz.rR'], -1, -4)
            sk.stamp(['mMMM', 'mMM', 'mM'], 0, 4) // cheek guard
            break
        case 'greathelm':
            sk.stamp([
                '...mmmmm....',
                '..mMMNNMMm..',
                '.mMMMMNNMMm.',
                'mMMMMMMNMMMm',
                'mMMMMMMNMMMm',
                'mMMMMMMNMMMm',
                'mMMMMMkkkkkm',
                'mMMMMMMkkkMm',
                'mMMMMMMNMkMm',
                '.mMMMMMNMkM.',
                '..mMMMMNMM..',
                '...mmmmmm...'
            ], 0, -1)
            if (tier >= 3) sk.stamp(['.tTT.', 'tTTTT'], 3, -3)
            break
        case 'hood':
            sk.stamp([
                '....CCCC....',
                '..cCCCDDCC..',
                '.cCCCCCDDCC.',
                'cCCCCCCCCCCC',
                'cCCCCCCCCCCC',
                'cCCCChHHHsC.',
                'cCCCH',
                'ccCCd',
                '.cCC',
                '.ccC',
                '..cc'
            ], 0, -1)
            if (tier >= 3) sk.stamp(['.....TTTTTT'], 0, 3)
            break
        case 'hat':
            sk.stamp([
                '.......cC......',
                '......cCCD.....',
                '.....cCCCCD....',
                '....tTTTTTTt...',
                '.cCCCCCCCCCCCD.',
                'cCCCCCCCCCCCCCD'
            ], -2, -2)
            break
        case 'crowmask':
            sk.stamp([
                '...vvvv......',
                '.vvXXXvv.....',
                'vvXXXXXXv....',
                'vXXXXXXXXv...',
                'vXXXXXXXXXv..',
                'vXXXXXvXXXXv.',
                'vXXXXkkkkXv..',
                'vXXXXXXXXXv..',
                'vXXXXXXbbbbbB',
                'vvXXXXXbbbbB.',
                '.vXXXXXbbB...',
                '..vvvvv......'
            ], 0, -1)
            break
    }
}

/** A Champion's head: hair style, beard and ears, then the headgear over them. */
function championHead(k: Skin, tier: number): Head {
    const st = STYLES[k.style]
    const sk = new Sketch()
        .stamp(st.crown, 0, 0)
        .stamp(st.back.map((b, i) => b + FRONT[i]), 0, 5)
    for (const e of st.extra ?? []) sk.stamp(e.rows, e.x, e.y)
    if (k.beard) sk.stamp(BEARD, 4, 7)
    if (k.elf) sk.stamp(ELF_EAR, 1, 3)
    const cover = COVERS[k.head]
    if (cover !== undefined) sk.clearAbove(cover)
    headgear(sk, k, tier)
    return sk.head(headKey(k))
}

// ── Chassis rest poses and clips ───────────────────────────────────────────────────

const DAMAGE_REST = rest({ hx: 3, hy: 4, wa: -1.0, bhx: -1, bhy: 4, ffx: 3, bfx: -3 })
const TANK_REST = rest({ hx: 3, hy: 4, wa: -1.2, bhx: 3, bhy: 3, ffx: 3, bfx: -3 })
const SUPPORT_REST = rest({ hx: 4, hy: 4, wa: -1.4, bhx: 2, bhy: 4, ffx: 2, bfx: -2 })
const CONTROL_REST = rest({ hx: 5, hy: 3, wa: -0.6, bhx: 4, bhy: 1, ffx: 2, bfx: -2, jump: -1 })

const enum CFX { None, Smear, Bash, Burst, Weave, Halo, Brace, Leap }

export const CHASSIS: Readonly<Record<ChampionArchetype, ChassisClips>> = {
    damage: {
        idle: hclip('idle', 1.0, true, [[0, {}], [0.5, { crouch: 1, hy: 5, wa: -0.9 }], [1.0, {}]], DAMAGE_REST),
        attack: hclip('attack', 0.8, false, [
            [0, {}],
            [0.1, { wa: -2.3, hx: -1, hy: -3, lean: -1 }, Ease.Out, CH],
            [0.2, { wa: -2.5, hx: -2, hy: -4, lean: -2, crouch: 1 }, Ease.InOut, CH],
            [0.3, { wa: 0.4, hx: 8, hy: 3, lean: 3, ffx: 6, fxk: CFX.Smear, fxa: -2.5 }, Ease.Out, CA],
            [0.4, { wa: 0.7, fxk: 0 }, Ease.Out, RE],
            [0.8, { wa: -1.0, hx: 3, hy: 4, lean: 0, crouch: 0, ffx: 3 }]
        ], DAMAGE_REST),
        cast: hclip('cast', 1.2, false, [
            [0, {}],
            [0.2, { crouch: 3, hx: -2, hy: 4, wa: -2.6, lean: -2, glow: 0.4 }, Ease.Out, CH],
            [0.4, { glow: 0.7 }, Ease.InOut, CH],
            [0.5, { jump: -6, crouch: 0, hx: 2, hy: -8, wa: -1.6, lean: 1, glow: 1, ffy: 2, bfy: 3, fxk: CFX.Leap }, Ease.Out, CA],
            [0.6, { jump: 0, crouch: 3, hx: 9, hy: 6, wa: 0.6, lean: 3, fxk: CFX.Smear, fxa: -1.6, ffy: 0, bfy: 0 }, Ease.In, CA],
            [0.7, { fxk: 0 }, Ease.Hold, RE],
            [1.2, { crouch: 0, hx: 3, hy: 4, wa: -1.0, lean: 0, glow: 0 }]
        ], DAMAGE_REST),
        hit: hitClip(DAMAGE_REST),
        death: deathClip(DAMAGE_REST),
        move: runClip(DAMAGE_REST)
    },
    tank: {
        idle: hclip('idle', 1.4, true, [[0, {}], [0.7, { crouch: 1, hy: 5, bhy: 4 }], [1.4, {}]], TANK_REST),
        attack: hclip('attack', 1.0, false, [
            [0, {}],
            [0.1, { bhx: 1, bhy: 3, lean: -1 }, Ease.Out, CH],
            [0.2, { bhx: 11, bhy: 2, lean: 3, ffx: 6, fxk: CFX.Bash }, Ease.Out, CA],
            [0.3, { fxk: 0, bhx: 6, wa: -2.4, hx: -1, hy: -3, lean: 1 }, Ease.InOut, CH],
            [0.5, { wa: 0.3, hx: 7, hy: 4, lean: 2, crouch: 1, fxk: CFX.Smear, fxa: -2.4 }, Ease.Out, CA],
            [0.6, { fxk: 0 }, Ease.Hold, RE],
            [1.0, { wa: -1.2, hx: 3, hy: 4, bhx: 3, bhy: 3, lean: 0, crouch: 0, ffx: 3 }]
        ], TANK_REST),
        cast: hclip('cast', 1.3, false, [
            [0, {}],
            [0.2, { bhx: 6, bhy: -2, hx: 5, hy: -3, wa: -1.8, jump: -1, glow: 0.4 }, Ease.Out, CH],
            [0.4, { glow: 0.7 }, Ease.InOut, CH],
            [0.5, { bhx: 8, bhy: 4, hx: 5, hy: 7, wa: 1.1, jump: 0, crouch: 3, kneel: 1, glow: 1, fxk: CFX.Brace }, Ease.In, CA],
            [0.9, {}, Ease.Linear],
            [1.0, { fxk: 0 }, Ease.Hold, RE],
            [1.3, { bhx: 3, bhy: 3, hx: 3, hy: 4, wa: -1.2, crouch: 0, kneel: 0, glow: 0 }]
        ], TANK_REST),
        hit: hitClip(TANK_REST, 0.5),
        death: deathClip(TANK_REST),
        move: runClip(TANK_REST)
    },
    support: {
        idle: hclip('idle', 1.4, true, [[0, {}], [0.7, { crouch: 1, hy: 5, bhy: 5 }], [1.4, {}]], SUPPORT_REST),
        attack: hclip('attack', 0.9, false, [
            [0, {}],
            [0.1, { hx: 5, hy: 1, wa: -1.57, glow: 0.3, lean: -1 }, Ease.Out, CH],
            [0.3, { glow: 0.7 }, Ease.InOut, CH],
            [0.4, { hx: 9, hy: 2, wa: -0.45, lean: 2, glow: 1, fxk: CFX.Burst }, Ease.Out, CA],
            [0.5, { fxk: 0, glow: 0.4 }, Ease.Out, RE],
            [0.9, { hx: 4, hy: 4, wa: -1.4, lean: 0, glow: 0 }]
        ], SUPPORT_REST),
        cast: hclip('cast', 1.4, false, [
            [0, {}],
            [0.3, { hx: 2, hy: -7, wa: -1.57, bhx: 1, bhy: -6, headY: -1, glow: 0.6, fxk: CFX.Halo }, Ease.Out, CH],
            [0.6, { jump: -2, glow: 1 }, Ease.InOut, CA],
            [1.0, { jump: -1 }, Ease.Linear],
            [1.1, { fxk: 0 }, Ease.Hold, RE],
            [1.4, { jump: 0, hx: 4, hy: 4, wa: -1.4, bhx: 2, bhy: 4, headY: 0, glow: 0 }]
        ], SUPPORT_REST),
        hit: hitClip(SUPPORT_REST),
        death: deathClip(SUPPORT_REST),
        move: floatClip(SUPPORT_REST)
    },
    control: {
        idle: hclip('idle', 1.6, true, [[0, {}], [0.8, { jump: -2, hy: 4, bhy: 0 }], [1.6, {}]], CONTROL_REST),
        attack: hclip('attack', 0.9, false, [
            [0, {}],
            [0.1, { hx: 1, hy: 1, wa: -1.6, lean: -1, glow: 0.4 }, Ease.Out, CH],
            [0.3, { glow: 0.7 }, Ease.InOut, CH],
            [0.4, { hx: 10, hy: 2, wa: -0.1, lean: 2, glow: 1, fxk: CFX.Burst }, Ease.Out, CA],
            [0.5, { fxk: 0 }, Ease.Hold, RE],
            [0.9, { hx: 5, hy: 3, wa: -0.6, lean: 0, glow: 0 }]
        ], CONTROL_REST),
        cast: hclip('cast', 1.4, false, [
            [0, {}],
            [0.3, { hx: 8, hy: 0, wa: -0.2, bhx: 9, bhy: 0, jump: -3, glow: 0.6, fxk: CFX.Weave }, Ease.Out, CH],
            [0.6, { hx: 9, hy: -2, bhx: 10, bhy: 2, jump: -4, glow: 1 }, Ease.InOut, CA],
            [1.0, { hx: 8, hy: 1, bhx: 9, bhy: -1 }, Ease.InOut],
            [1.1, { fxk: 0 }, Ease.Hold, RE],
            [1.4, { hx: 5, hy: 3, wa: -0.6, bhx: 4, bhy: 1, jump: -1, glow: 0 }]
        ], CONTROL_REST),
        hit: hitClip(CONTROL_REST),
        death: deathClip(CONTROL_REST, { jump: 0 }),
        move: floatClip(CONTROL_REST)
    }
}

// ── Look composition ───────────────────────────────────────────────────────────────

const is = (p: Float32Array, k: CFX) => Math.round(p[HP.fxk]!) === k

function wings(s: Surface, x: number, y: number, k: Skin, t: number): void {
    const f = Math.floor(t * 4) & 1
    const c = k.cloth === CLOTH.voidc || k.skin === SKIN.shadow ? [C.void, C.night1, C.purple1] : [C.bone0, C.bone1, C.white]
    for (let i = 0; i < 5; i++) {
        const len = 9 - i + f
        line(s, x - 3, y + 1 + i, x - 3 - len, y - 6 + i * 2 - f, i === 0 ? c[2]! : i < 3 ? c[1]! : c[0]!)
    }
}

/** Wings behind a cape from Epic, the cape itself from Rare, longer at each step. */
function bodyBack(tier: number, k: Skin, trimCape?: boolean) {
    if (tier < 2) return undefined
    const len = tier === 2 ? 7 : tier === 3 ? 10 : 13
    const [dk, c, hi] = trimCape ? [k.trim[0], k.trim[1], k.trim[2]] : [k.cloth[0], k.cloth[1], k.cloth[2]]
    return (s: Surface, x: number, y: number, _p: Float32Array, t: number) => {
        if (k.wings && tier >= 4) wings(s, x, y, k, t)
        chibiCape(s, x, y, len, t, c, dk, hi)
    }
}

/**
 * The rarity ladder on the torso, shared by every archetype: a trimmed hem, then a collar and a
 * chest gem, then gold studs and a back pauldron, then a white-hot gem. Pauldrons over the
 * weapon shoulder are `shoulder`, drawn over the arm.
 */
function ornament(s: Surface, x: number, y: number, k: Skin, tier: number): void {
    if (tier >= 1) { rect(s, x - 5, y + 7, 10, 1, k.trim[1]); px(s, x - 2, y + 7, k.trim[2]); px(s, x + 2, y + 7, k.trim[2]) }
    if (tier >= 3) { rect(s, x - 4, y, 8, 1, k.trim[1]); px(s, x + 1, y + 2, k.aura); px(s, x - 2, y + 2, C.gold2) }
    if (tier >= 4) {
        rect(s, x - 6, y - 1, 4, 3, k.metal[1]); rect(s, x - 6, y - 1, 4, 1, k.metal[2])
        px(s, x + 1, y + 3, C.gold3); px(s, x + 1, y + 4, C.gold3)
        px(s, x - 4, y, k.trim[2])
    }
    if (tier >= 5) { px(s, x + 1, y + 2, C.white); px(s, x + 2, y + 2, k.aura2) }
}

/** A pauldron over the weapon shoulder, drawn over the arm; gold-rimmed from Epic. */
function shoulder(s: Surface, x: number, y: number, m: Mat, big: boolean, rim: boolean): void {
    const w = big ? 6 : 5
    rect(s, x + 1, y - (big ? 1 : 0), w, 3, m[1])
    rect(s, x + 2, y - (big ? 1 : 0), w - 2, 1, m[2])
    px(s, x + 1, y + 2, m[0])
    if (rim) rect(s, x + 1, y + 2, w, 1, C.gold2)
}

function damageTorso(k: Skin, tier: number) {
    return (s: Surface, x: number, y: number) => {
        const c = k.cloth
        rect(s, x - 5, y, 10, 8, c[1]); rect(s, x - 5, y, 2, 8, c[0]); rect(s, x + 2, y + 1, 2, 3, c[2])
        rect(s, x, y, 3, 1, k.skin[1]) // open collar
        line(s, x + 3, y, x - 3, y + 5, k.trim[0]) // baldric
        rect(s, x - 5, y + 5, 10, 1, k.trim[0])
        px(s, x, y + 5, k.metal[2])
        rect(s, x - 5, y + 7, 10, 1, c[0])
        ornament(s, x, y, k, tier)
    }
}

function tankTorso(k: Skin, tier: number) {
    return (s: Surface, x: number, y: number) => {
        const m = tier <= 0 ? M.iron : k.metal
        rect(s, x - 5, y, 10, 8, m[1]); rect(s, x - 5, y, 2, 8, m[0]); rect(s, x + 2, y + 1, 2, 3, m[2])
        rect(s, x - 1, y + 2, 3, 6, k.cloth[1]); rect(s, x + 1, y + 3, 1, 4, k.cloth[2]) // tabard
        if (tier === 0) { px(s, x - 3, y + 2, m[0]); px(s, x + 3, y + 5, m[0]) } // dents
        rect(s, x - 5, y + 5, 10, 1, k.trim[0])
        px(s, x, y + 5, m[2])
        rect(s, x - 5, y + 7, 10, 1, m[0]) // mail skirt
        px(s, x - 3, y + 7, m[2]); px(s, x + 3, y + 7, m[2])
        ornament(s, x, y, k, tier)
    }
}

function robeTorso(k: Skin, tier: number) {
    return (s: Surface, x: number, y: number) => {
        const c = k.cloth
        rect(s, x - 5, y, 10, 8, c[1]); rect(s, x - 5, y, 2, 8, c[0]); rect(s, x + 2, y + 1, 2, 4, c[2])
        rect(s, x + 3, y, 1, 8, k.trim[1]) // the robe's front edge
        rect(s, x - 5, y + 5, 10, 1, k.trim[0]) // sash
        px(s, x + 1, y + 5, k.trim[2])
        if (tier >= 2) { line(s, x - 2, y, x - 2, y + 7, k.trim[1]); line(s, x + 1, y, x + 1, y + 4, k.trim[1]) } // stole
        ornament(s, x, y, k, Math.min(tier, 3))
        if (tier >= 4) { px(s, x - 1, y + 2, C.gold3); px(s, x - 1, y + 6, C.gold3) }
    }
}

function damageWeapon(k: Skin) {
    const m = k.metal
    return (s: Surface, x: number, y: number, p: Float32Array) => {
        const a = p[HP.wa]!
        switch (k.weapon as DamageWeapon) {
            case 'sword': sword(s, x, y, a, 13, m, M.gold, C.brown1); break
            case 'greatsword': sword(s, x, y, a, 16, m, M.gold, C.brown0, true); break
            case 'spear': spear(s, x, y, a, 15, m, M.wood); break
            case 'dagger': dagger(s, x, y, a, m, C.brown1); break
            case 'scythe': scythe(s, x, y, a, 14, m, M.darkwood); break
            case 'axe': axe(s, x, y, a, 11, m, M.wood, false, true); break
            case 'greataxe': axe(s, x, y, a, 14, m, M.darkwood, true); break
        }
    }
}

function tankWeapon(k: Skin) {
    const m = k.metal
    return (s: Surface, x: number, y: number, p: Float32Array) => {
        const a = p[HP.wa]!
        switch (k.weapon as TankWeapon) {
            case 'mace': mace(s, x, y, a, 10, m, M.wood); break
            case 'hammer': hammer(s, x, y, a, 11, m, M.wood); break
            case 'sword': sword(s, x, y, a, 13, m, M.gold, C.brown1); break
            case 'axe': axe(s, x, y, a, 11, m, M.wood, false, true); break
        }
    }
}

/** Legendary sparkle and mythic aura, drawn in scene space around the body. */
function rarityFx(k: Skin, tier: number) {
    return (dst: Surface, p: Float32Array, t: number) => {
        if (tier >= 5) {
            const lv = 3 + step(t, 10, 2) * 2
            for (let yy = -26; yy <= 0; yy++) {
                const half = Math.round(10 * Math.sqrt(Math.max(0, 1 - ((yy + 12) / 14) ** 2)))
                for (let xx = -half; xx <= half; xx++) {
                    if (Math.abs(xx) < half - 1) continue
                    const X = fxX(J.bx + xx)
                    const Y = fxY(J.oy + yy)
                    if (dst.get(X, Y) !== k.aura && bayer(X, Y, lv)) dst.set(X, Y, k.aura)
                }
            }
        }
        if (tier >= 4) {
            const q = step(t, 10, 12)
            for (let i = 0; i < 3; i++) {
                const a = (q / 12 + i / 3) * Math.PI * 2
                dst.set(fxX(J.bx + Math.round(Math.cos(a) * 11)), fxY(J.topY + 1 + Math.round(Math.sin(a) * 10)), i === 0 ? k.aura2 : k.aura)
            }
        }
    }
}

function chassisFx(k: Skin, tier: number, headH: number) {
    const rfx = rarityFx(k, tier)
    const slash = tier >= 3 ? [k.aura, k.aura2] : [C.steel2, C.steel1]
    return (dst: Surface, p: Float32Array, t: number) => {
        rfx(dst, p, t)
        if (is(p, CFX.Smear)) crescent(dst, J.fsx, J.fsy, 15, p[HP.fxa]!, p[HP.wa]!, 5, slash[0]!, C.white, slash[1]!)
        if (is(p, CFX.Bash)) sparks(dst, J.bhx + 5, J.bhy, 4, 6, step(t, 10, 3), C.white, k.aura)
        if (is(p, CFX.Burst)) sparks(dst, tip.x + 2, tip.y, 5, 7, step(t, 10, 5), k.aura, C.white)
        if (is(p, CFX.Leap)) for (let i = 0; i < 4; i++) streak(dst, J.bx - 3 + i * 2, J.oy + 4, Math.PI / 2, 5 + (i & 1) * 2, k.aura)
        if (is(p, CFX.Brace)) {
            const r = 10 + step(t, 10, 3)
            for (let a = -1.2; a <= 1.2; a += 0.12) dst.set(fxX(J.bhx + 3 + Math.round(Math.cos(a) * r * 0.5)), fxY(J.bhy + Math.round(Math.sin(a) * r)), k.aura)
        }
        if (is(p, CFX.Halo)) {
            const k2 = step(t, 10, 2)
            for (let a = 0; a < Math.PI * 2; a += 0.3) dst.set(fxX(J.headX + 1 + Math.round(Math.cos(a) * 5)), fxY(J.headY - headH - 2 + Math.round(Math.sin(a) * 1.5)), k2 ? C.white : k.aura)
            sparks(dst, tip.x, tip.y, 6, 6, step(t, 10, 6) + 40, k.aura, C.white)
        }
        if (is(p, CFX.Weave)) {
            // threads spun between the two hands
            const n = 6
            for (let i = 0; i <= n; i++) {
                const u = i / n
                const wx = J.hx + (J.bhx - J.hx) * u
                const wy = J.hy + (J.bhy - J.hy) * u + Math.round(Math.sin(u * Math.PI * 2 + t * 12) * 2)
                dst.set(fxX(Math.round(wx + 3)), fxY(Math.round(wy)), i & 1 ? k.aura : k.aura2)
            }
        }
    }
}

/**
 * The chibi-sized cut of a shield, for carrying it in front of the body: the full-size round,
 * kite and tower shields are taller than the space between a Champion's chin and feet.
 */
function frontShield(style: ShieldStyle): ShieldStyle {
    switch (style) {
        case ShieldStyle.Round: return ShieldStyle.Targe
        case ShieldStyle.Kite: return ShieldStyle.Heater
        case ShieldStyle.Tower: return ShieldStyle.Pavise
        default: return style
    }
}

const LOOKS = new Map<string, Look>()

/** The composed Look for a Champion ID (cached). */
export function championLook(id: string): Look {
    const hit = LOOKS.get(id)
    if (hit) return hit
    const def = CHAMPION_BY_ID[id]
    const k = SKINS[id]
    if (!def || !k) throw new Error(`No Champion art for ${id}`)
    const tier = RARITIES.indexOf(def.rarity)
    const hd = championHead(k, tier)
    const headH = hd.pix.h
    const lid = k.head === 'greathelm' ? C.ink : k.head === 'crowmask' ? C.night1 : k.skin[2]
    const mouth = !MASKED.has(k.head)
    const spark = tier >= 5 && k.head !== 'crown' && k.head !== 'greathelm'
    const head = (s: Surface, x: number, y: number, p: Float32Array, t: number) => {
        chibiHead(s, hd, x, y, p, p[HP.glow]! > 0.5 && tier >= 3 ? k.aura : k.eye, lid, mouth)
        // mythics float a spark over the head
        if (spark) px(s, x + 1, y - headH - 2 - (Math.floor(t * 4) & 1), k.aura2)
    }
    const tank = def.archetype === 'tank'
    const armCloth = tank ? (tier <= 0 ? M.iron : k.metal) : k.cloth
    const base = {
        body: drawChibi,
        skin: k.skin,
        pants: tank ? armCloth[0] : k.trim[0],
        pantsDk: tank ? C.stone0 : k.cloth[0],
        boot: tank ? armCloth[0] : C.brown0,
        bootHi: tank ? armCloth[2] : C.brown2,
        arm: armCloth[1], armLow: def.archetype === 'damage' ? k.skin[1] : armCloth[2],
        armBack: armCloth[0], armBackLow: def.archetype === 'damage' ? k.skin[0] : armCloth[1],
        hand: tank ? armCloth[0] : k.skin[1],
        head,
        accent: k.aura,
        fx: chassisFx(k, tier, headH)
    }
    const pauldron = (big: boolean) => (s: Surface, x: number, y: number) => shoulder(s, x, y, tank && tier <= 0 ? M.iron : k.metal, big, tier >= 4)
    let look: Look
    switch (def.archetype) {
        case 'damage':
            look = {
                ...base, torso: damageTorso(k, tier), weapon: damageWeapon(k), back: bodyBack(tier, k),
                over: tier >= 2 ? pauldron(tier >= 4) : undefined
            }
            break
        case 'tank': {
            const plate = pauldron(tier >= 3)
            const style = frontShield(k.shield ?? ShieldStyle.Round)
            look = {
                ...base, torso: tankTorso(k, tier), weapon: tankWeapon(k), back: bodyBack(tier, k),
                // the shield is carried in front, so it goes on last, over the pauldron
                over: (s, x, y) => {
                    plate(s, x, y)
                    shield(s, J.bhx + 1, J.bhy + 2, style, tier <= 0 ? M.iron : k.metal, tier <= 0 ? M.wood : k.cloth, tier >= 3 ? C.gold2 : k.trim[2])
                }
            }
            break
        }
        case 'support':
            look = {
                ...base, torso: robeTorso(k, tier), lower: robe(k.cloth, k.trim[1], 2), back: bodyBack(tier, k, true),
                weapon: (s, x, y, p, t) => staff(s, x, y, p[HP.wa]!, 14, tier >= 3 ? M.gold : k.metal, k.gemMat ?? M.holy, k.gem ?? Gem.Orb, p[HP.glow]!, t),
                offhand: tier === 3 || id === 'champ_illyana' ? (s, x, y, p) => tome(s, x + 1, y, k.trim, p[HP.glow]!) : undefined,
                over: tier >= 4
                    ? (s, _x, _y, _p, t) => {
                        // halo
                        const f = Math.floor(t * 4) & 1
                        const hy = J.headY - headH - 2 + f
                        for (let i = -3; i <= 3; i++) px(s, J.headX + 1 + i, hy + (Math.abs(i) === 3 ? 1 : 0), i === 0 ? C.white : C.gold3)
                    }
                    : undefined
            }
            break
        case 'control':
            look = {
                ...base, torso: robeTorso(k, tier), lower: robe(k.cloth, k.trim[1], 1), back: bodyBack(tier, k),
                weapon: (s, x, y, p, t) => staff(s, x, y, p[HP.wa]!, 8, k.metal, k.gemMat ?? M.arcane, k.gem ?? Gem.Orb, p[HP.glow]!, t),
                offhand: (s, x, y, p, t) => orb(s, x + 2, y - 3 + (Math.floor(t * 3) & 1), k.gemMat ?? M.arcane, Math.max(p[HP.glow]!, tier >= 4 ? 0.4 : 0), t)
            }
            break
    }
    LOOKS.set(id, look)
    return look
}

/** Champion IDs with art, in roster order. */
export const CHAMPION_ART_IDS: readonly string[] = CHAMPIONS.map(c => c.id)
export function hasChampionSkin(id: string): boolean { return id in SKINS }
