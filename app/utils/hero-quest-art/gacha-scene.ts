// The Gacha scene: the four gachas as banners side by side, each a pennant in its own colour with
// its emblem, then its level, its Seals, and its three buttons: the day's free ten, a single pull and
// a ten-pull. A pull short of Seals buys the rest with Gold, its price on the button; with the
// setting on, that takes a second press to confirm. Pointing at an emblem swaps the buttons for
// the gacha's drop rates and what is collected. A pull deals its results out as cards over the
// whole scene, each turning over to the item in its rarity's frame.

import { C, RARITY_COLORS } from './palette'
import { Surface, rect, px, line, tri, disc, ring, ellipse, poly, dither, ditherDisc, blit } from './surface'
import { drawRevealAura, drawRevealBase, REVEAL_AURA_LOOP, REVEAL_LUT, REVEAL_SIZE } from './feedback'
import { drawSkillBanner } from './presentation'
import { drawText, textWidth } from './font'
import { glyph, type Glyph } from './icon-kit'
import { ABILITY_ICON_PARTS } from './icons-abilities'
import { CURRENCY_ICONS } from './icons-items'
import { hammer, M } from './weapons'
import { panel } from './ui-art'
import { collectionTile, plateButton, type Box } from './collections-scene'
import type { SceneBackdrops } from './menu-band'
import type { HqCollectionTab } from '../hero-quest-scenes'

export type GachaSystemId = 'gear' | 'champion' | 'skill' | 'artifact'
export type GachaButton = 'free' | 'one' | 'ten'

export interface GachaBannerView {
    system: GachaSystemId
    level: number
    /** 0–1 toward the next level; 1 once maxed. */
    levelProgress: number
    seals: number
    essence: string
    owned: number
    total: number
    /** Percent per rarity, common first. */
    dropRates: readonly number[]
    /** The free ten: `ready`, a countdown to the next one, or none left today. */
    free: { state: 'ready' } | { state: 'wait', left: string } | { state: 'spent' }
    /** The day's free tens still to claim, of how many a day: a pip each on the button. */
    freeLeft: number
    freePerDay: number
    one: PullPrice
    ten: PullPrice
}

/** What a pull costs: the Seals it takes from the balance, and the Gold for any it is short. */
export interface PullPrice {
    /** Seals the pull costs in all: 1, or 9 for ten. */
    cost: number
    /** Pulls it gives, for the struck-through "10" a ten-pull's price shows. */
    pulls: number
    /** Of `cost`, the Seals taken from the balance; the rest are bought. */
    fromBalance: number
    /** Gold for the Seals bought, 0 when the balance covers it, and that spelled out. */
    gold: number
    goldText: string
    /** Whether the Gold balance covers `gold`. */
    affordable: boolean
}

export interface GachaCard {
    contentId: string
    rarity: string
    isNew: boolean
    level: number
    essence: number
}

export interface GachaView {
    banners: readonly GachaBannerView[]
    gold: string
    /** The pull being revealed, or null. `key` changes with every pull, so a repeat deals again. */
    reveal: { key: number, system: GachaSystemId, cards: readonly GachaCard[] } | null
    /** A pull that spends Gold, pressed once and waiting for the second press that confirms it. */
    armed: { system: GachaSystemId, button: 'one' | 'ten' } | null
}

/** What the pointer is over: a banner's button, its emblem (for the rates), or the reveal. */
export type GachaHover = { system: GachaSystemId, part: GachaButton | 'emblem' } | 'reveal' | null

const NAMES: Readonly<Record<GachaSystemId, string>> = { gear: 'FORGE', champion: 'GUILD', skill: 'TRAINING', artifact: 'DIG SITE' }
const TABS: Readonly<Record<GachaSystemId, HqCollectionTab>> = { gear: 'gear', champion: 'champions', skill: 'skills', artifact: 'artifacts' }
/** Each banner's cloth: shadow, body, light. */
const CLOTH: Readonly<Record<GachaSystemId, readonly [number, number, number]>> = {
    gear: [C.lava0, C.orange, C.gold2],
    champion: [C.red0, C.red1, C.red2],
    skill: [C.blue0, C.blue1, C.blue2],
    artifact: [C.teal0, C.teal1, C.teal2]
}
/**
 * Each banner's emblem: what the place is, not what it is paid in.
 *
 * The Forge an anvil under a raised hammer, sparks off the strike; the Guild a heater shield over
 * crossed swords; the Training Grounds a straw dummy with a target on its chest and an arrow in it;
 * the Dig Site a gold relic coming out of a mound, a pick and a shovel crossed behind it.
 */
const EMBLEMS: Readonly<Record<GachaSystemId, Glyph>> = {
    gear: (g, x, y) => {
        // the hammer, raised behind the anvil: the haft leaning up to the right, the head square across it
        hammer(g, x + 4, y + 1, -Math.PI * 0.38, 8, M.steel, M.wood)
        // the anvil: horn to the left, the face, a shadow under it, the waist and the foot
        poly(g, [-10, 1, -4, -1, -4, 3, -7, 3], x, y, C.steel2)
        rect(g, x - 4, y - 1, 13, 4, C.steel2)
        rect(g, x - 4, y - 1, 13, 1, C.steel3)
        rect(g, x - 4, y + 2, 13, 1, C.steel1)
        rect(g, x - 1, y + 3, 6, 4, C.steel1)
        rect(g, x - 1, y + 3, 1, 4, C.steel2)
        rect(g, x - 5, y + 7, 15, 3, C.steel1)
        rect(g, x - 5, y + 7, 15, 1, C.steel2)
        // a hot ingot on the face, and the sparks off the strike
        rect(g, x - 3, y - 3, 6, 2, C.orange)
        rect(g, x - 3, y - 3, 6, 1, C.gold3)
        for (const [sx, sy, c] of [[-3, -6, C.gold3], [-6, -7, C.gold2], [0, -8, C.white], [-8, -4, C.orange], [2, -6, C.gold2], [-5, -10, C.gold3]] as const) px(g, x + sx, y + sy, c)
    },
    champion: (g, x, y) => {
        // two long swords crossed behind, hilts low and out, blades out past the shield's shoulders
        for (const side of [-1, 1]) {
            line(g, x + side * 6, y + 6, x - side * 10, y - 10, C.steel2, 2)
            line(g, x + side * 6, y + 5, x - side * 10, y - 11, C.steel3)
            px(g, x - side * 11, y - 11, C.white)
            // the crossguard, square to the blade, then the grip and pommel
            line(g, x + side * 5, y + 8, x + side * 9, y + 4, C.gold1, 2)
            line(g, x + side * 7, y + 7, x + side * 9, y + 9, C.brown1, 2)
            px(g, x + side * 10, y + 10, C.gold2)
        }
        // a heater shield: gold field, its right half in shade, a steel rim with rivets
        poly(g, [-6, -7, 6, -7, 6, 0, 0, 7, -6, 0], x, y, C.steel1)
        poly(g, [-5, -6, 5, -6, 5, 0, 0, 5, -5, 0], x, y, C.gold2)
        poly(g, [0, -6, 5, -6, 5, 0, 0, 5], x, y, C.gold1)
        rect(g, x - 5, y - 6, 2, 5, C.gold3)
        for (const [rx, ry] of [[-5, -7], [5, -7], [0, 6]] as const) px(g, x + rx, y + ry, C.steel3)
        // a blue chevron, in two strokes (a concave shape fills shut), stopped short of the rim so it
        // never reads as a hole onto the red banner behind
        line(g, x - 4, y + 1, x, y - 3, C.blue1, 2)
        line(g, x, y - 3, x + 4, y + 1, C.blue1, 2)
        line(g, x - 4, y, x, y - 4, C.blue2)
    },
    skill: (g, x, y) => {
        // the post on its foot, and the crossbar arms with straw out of their ends
        rect(g, x - 4, y + 9, 9, 2, C.brown1)
        rect(g, x - 1, y - 3, 3, 13, C.brown1)
        rect(g, x - 1, y - 3, 1, 13, C.brown2)
        rect(g, x - 9, y - 4, 19, 2, C.brown2)
        rect(g, x - 9, y - 4, 19, 1, C.brown3)
        for (const side of [-1, 1]) {
            px(g, x + side * 10, y - 5, C.gold3); px(g, x + side * 11, y - 4, C.gold2); px(g, x + side * 10, y - 2, C.gold2)
        }
        // a stuffed burlap body, a rope round its waist
        ellipse(g, x, y + 3, 5, 5, C.bone0)
        rect(g, x - 4, y + 6, 9, 1, C.brown1)
        // a sack head tied off at the neck, button eyes and a stitched mouth, a tuft of straw out of the top
        disc(g, x, y - 8, 4, C.bone0)
        px(g, x - 2, y - 10, C.bone1); px(g, x - 1, y - 11, C.bone1)
        rect(g, x - 2, y - 4, 5, 1, C.brown0)
        px(g, x - 2, y - 8, C.brown0); px(g, x + 2, y - 8, C.brown0)
        px(g, x - 1, y - 6, C.brown1); px(g, x, y - 6, C.brown1); px(g, x + 1, y - 6, C.brown1)
        px(g, x - 1, y - 12, C.gold2); px(g, x, y - 12, C.gold3); px(g, x + 1, y - 12, C.gold2)
        // the target on its chest, ring in ring, and an arrow in the bull
        disc(g, x, y + 2, 3, C.red1)
        disc(g, x, y + 2, 2, C.bone1)
        disc(g, x, y + 2, 1, C.red2)
        line(g, x + 1, y + 1, x + 8, y - 6, C.brown2)
        px(g, x + 8, y - 7, C.white); px(g, x + 9, y - 6, C.white); px(g, x + 9, y - 8, C.red2); px(g, x + 10, y - 7, C.red2)
    },
    artifact: (g, x, y) => {
        // a pick, behind to the right: the haft, and a curved double point across its head
        line(g, x - 8, y + 8, x + 6, y - 7, C.brown2, 2)
        line(g, x + 1, y - 10, x + 6, y - 8, C.steel2, 2)
        line(g, x + 6, y - 8, x + 10, y - 3, C.steel2, 2)
        px(g, x + 1, y - 11, C.steel3); px(g, x + 10, y - 2, C.steel3)
        // a spade, behind to the left: the haft, and a blade with a pointed tip
        line(g, x + 8, y + 8, x - 4, y - 4, C.brown2, 2)
        poly(g, [-3.3, -5.4, -6, -8.2, -8, -8, -8.2, -6, -5.4, -3.3], x, y, C.steel2)
        line(g, x - 4, y - 6, x - 6, y - 8, C.steel3)
        // the mound it is coming out of, pebbles on it
        ellipse(g, x, y + 7, 9, 3, C.brown1)
        rect(g, x - 7, y + 5, 14, 1, C.brown2)
        px(g, x - 6, y + 7, C.stone2); px(g, x + 5, y + 8, C.stone2); px(g, x + 7, y + 6, C.stone3)
        // the relic: a gold sun-disc with a sea-green stone
        for (let k = 0; k < 8; k++) {
            const a = k * Math.PI / 4
            px(g, Math.round(x + Math.cos(a) * 6), Math.round(y + Math.sin(a) * 6), C.gold2)
        }
        disc(g, x, y, 5, C.gold1)
        disc(g, x, y, 4, C.gold2)
        disc(g, x - 1, y - 1, 2, C.gold3)
        disc(g, x, y, 2, C.teal2)
        px(g, x - 1, y - 1, C.white)
    }
}

const RARITY_NAMES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'] as const
const RARITY_KEYS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const

const COL_W = 64
const COL_GAP = 4
const COL_Y = 14
const COL_H = 137
/** The pennant hangs from the column's top; the emblem sits in it. */
const PENNANT_H = 36
const EMBLEM_Y = 14
const NOTCH = 7
const BTN_Y = 75
const FREE_H = 13
/** A pull button is two lines: what it does, and what it costs. */
const PULL_H = 20
const BTN_GAP = 2
const BUTTONS: readonly GachaButton[] = ['free', 'one', 'ten']

/** The reveal: two rows of five cards, each with its tag under it. */
const CARD = 24
const CARD_GAP = 8
const CARD_ROW = 40
const DEAL_EVERY = 0.09
/** A card turns over as its flash bursts: the flash spends this long charging first. */
const FLIP_AFTER = 0.3
const FLASH_CHARGE = 0.3
/** How long a card's flash plays, from the start of its charge. */
const FLASH_FOR = 1.4
/** A legendary turns with a white frame and a small shake, and raises its banner. */
const LEGEND_WHITE = 0.06
const LEGEND_SHAKE = 0.35
const LEGEND_SHAKE_PX = 2
/** A mythic holds the deal while it trembles, then turns with a white frame, a big shake and a red stain, and bursts twice. */
const MYTHIC_HOLD = 1.0
const MYTHIC_WHITE = 0.1
const MYTHIC_SHAKE = 0.7
const MYTHIC_SHAKE_PX = 4
const MYTHIC_TINT = 0.8
const MYTHIC_ECHO = 0.25
/** How long a legendary's or a mythic's banner stays up. */
const BANNER_FOR = 1.8
const FLASH = new Surface(REVEAL_SIZE, REVEAL_SIZE, 0, 0)

const BUY_PLATE = [C.green0, C.green1, C.green2] as const
/** One coin, for a button too narrow for the Gold pile. */
const COIN: Glyph = (g, x, y) => ABILITY_ICON_PARTS.coin(g, x, y, 3)
const FREE_PLATE = [C.gold0, C.gold1, C.gold2] as const
const CONFIRM_PLATE = [C.gold0, C.gold1, C.gold2] as const
/** A Seal small enough for a price line: a dot in the gacha's cloth. */
const SEAL_DOT: Readonly<Record<GachaSystemId, Glyph>> = Object.fromEntries(
    (['gear', 'champion', 'skill', 'artifact'] as const).map(system => [system, ((g, x, y) => {
        disc(g, x, y, 3, CLOTH[system][1])
        px(g, x - 1, y - 1, CLOTH[system][2])
    }) as Glyph])
) as Record<GachaSystemId, Glyph>

function columnBox(w: number, i: number): Box {
    const row = 4 * COL_W + 3 * COL_GAP
    return { x: ((w - row) >> 1) + i * (COL_W + COL_GAP), y: COL_Y, w: COL_W, h: COL_H }
}

function buttonBox(col: Box, k: number): Box {
    const y = col.y + BTN_Y + (k === 0 ? 0 : FREE_H + BTN_GAP + (k - 1) * (PULL_H + BTN_GAP))
    return { x: col.x + 4, y, w: col.w - 8, h: k === 0 ? FREE_H : PULL_H }
}

function emblemBox(col: Box): Box {
    return { x: col.x + 8, y: col.y, w: col.w - 16, h: PENNANT_H + 4 }
}

function inside(b: Box, x: number, y: number): boolean {
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
}

/** Whether a banner's button does anything now. */
export function gachaButtonEnabled(b: GachaBannerView, button: GachaButton): boolean {
    switch (button) {
        case 'free': return b.free.state === 'ready'
        case 'one': return b.one.affordable
        case 'ten': return b.ten.affordable
    }
}

/** What a point on the view is over. While a reveal is up, all of it is the reveal. */
export function gachaHoverAt(view: GachaView, w: number, x: number, y: number): GachaHover {
    if (view.reveal) return 'reveal'
    for (let i = 0; i < view.banners.length; i++) {
        const col = columnBox(w, i)
        if (!inside(col, x, y)) continue
        const system = view.banners[i]!.system
        if (inside(emblemBox(col), x, y)) return { system, part: 'emblem' }
        const k = BUTTONS.findIndex((_, n) => inside(buttonBox(col, n), x, y))
        return k < 0 ? null : { system, part: BUTTONS[k]! }
    }
    return null
}

export class GachaScene {
    /** When the reveal on screen started, in the scene's time; null before its first frame. */
    private dealtAt: number | null = null
    private dealtKey = -1

    constructor(private readonly backdrops: SceneBackdrops) {}

    /** Whether every card of the reveal has turned over, at scene time `t`. */
    revealDone(view: GachaView, t: number): boolean {
        const r = view.reveal
        if (!r || this.dealtKey !== r.key || this.dealtAt === null) return false
        const beats = dealSchedule(r.cards)
        return t - this.dealtAt >= beats[beats.length - 1]!.flip
    }

    /** Turn every card over at once: a press during the deal skips it rather than closing it. */
    skipReveal(): void {
        this.dealtAt = -1e9
    }

    render(t: number, view: GachaView, hover: GachaHover, pressed: boolean, busy: boolean): Surface {
        const s = this.backdrops.render('gacha', t, false)
        drawText(s, 'GACHA', 6, 4, C.gold2, { shadow: 1 })
        const gw = textWidth(view.gold.toUpperCase())
        drawText(s, view.gold.toUpperCase(), s.w - 6, 4, C.bone1, { align: 2, shadow: 1 })
        glyph(s, CURRENCY_ICONS.gold!, s.w - 6 - gw - 10, 6, true)

        view.banners.forEach((b, i) => {
            const h = hover !== null && hover !== 'reveal' && hover.system === b.system ? hover.part : null
            this.drawBanner(s, columnBox(s.w, i), b, h, pressed, busy, view.armed?.system === b.system ? view.armed.button : null)
        })
        if (view.reveal) this.drawReveal(s, t, view.reveal)
        return s
    }

    private drawBanner(s: Surface, col: Box, b: GachaBannerView, hover: GachaButton | 'emblem' | null, pressed: boolean, busy: boolean, armedHere: 'one' | 'ten' | null): void {
        panel(s, col.x, col.y, col.w, col.h)
        const cloth = CLOTH[b.system]
        const cx = col.x + (col.w >> 1)
        // the pennant: a rod across the top, the cloth hanging from it with a swallowtail cut
        const px = col.x + 10
        const pw = col.w - 20
        rect(s, col.x + 6, col.y + 3, col.w - 12, 2, C.brown2)
        rect(s, col.x + 6, col.y + 3, col.w - 12, 1, C.brown3)
        const py = col.y + 5
        const mid = px + (pw >> 1)
        rect(s, px, py, pw, PENNANT_H, C.ink)
        rect(s, px + 1, py, pw - 2, PENNANT_H - 1, cloth[1])
        rect(s, px + 1, py, 2, PENNANT_H - 1, cloth[2])
        rect(s, px + pw - 3, py, 2, PENNANT_H - 1, cloth[0])
        // the swallowtail: a notch cut up into the hem, edged in ink
        tri(s, px + 1, py + PENNANT_H, px + pw - 1, py + PENNANT_H, mid, py + PENNANT_H - NOTCH, C.night1)
        line(s, px + 1, py + PENNANT_H - 1, mid, py + PENNANT_H - 1 - NOTCH, C.ink)
        line(s, mid, py + PENNANT_H - 1 - NOTCH, px + pw - 2, py + PENNANT_H - 1, C.ink)
        glyph(s, EMBLEMS[b.system], cx, col.y + 5 + EMBLEM_Y)
        if (hover === 'emblem') rect(s, px, py, pw, 1, C.white)

        drawText(s, NAMES[b.system], cx, col.y + 44, C.gold2, { align: 1, shadow: 1 })
        // the level, and a bar toward the next one
        drawText(s, `LV ${b.level}`, col.x + 5, col.y + 53, C.bone1, { shadow: 1 })
        const bx = col.x + 26
        const bw = col.w - 31
        rect(s, bx, col.y + 54, bw, 5, C.ink)
        rect(s, bx + 1, col.y + 55, bw - 2, 3, C.night0)
        const fill = Math.round((bw - 2) * Math.min(1, Math.max(0, b.levelProgress)))
        rect(s, bx + 1, col.y + 55, fill, 3, cloth[1])
        rect(s, bx + 1, col.y + 55, fill, 1, cloth[2])
        // the Seals a pull spends
        const seals = String(b.seals)
        const sw = textWidth(seals) + 17
        glyph(s, CURRENCY_ICONS[`seal_${b.system}`]!, cx - (sw >> 1) + 6, col.y + 66, true)
        drawText(s, seals, cx - (sw >> 1) + 17, col.y + 63, C.bone1, { shadow: 1 })

        if (hover === 'emblem') {
            this.drawRates(s, col, b)
            return
        }
        BUTTONS.forEach((id, k) => {
            const box = buttonBox(col, k)
            const enabled = !busy && gachaButtonEnabled(b, id)
            const lit = hover === id
            if (id === 'free') {
                const label = b.free.state === 'ready' ? 'FREE 10' : b.free.state === 'wait' ? b.free.left.toUpperCase() : 'FREE USED'
                plateButton(s, box, '', FREE_PLATE, enabled, lit, pressed)
                this.drawFree(s, box, label, b.freeLeft, b.freePerDay, enabled, lit && pressed)
                return
            }
            const armed = armedHere === id
            this.drawPull(s, box, b.system, id === 'one' ? b.one : b.ten, id === 'one' ? 'PULL 1' : 'PULL 10', armed, enabled, lit, pressed)
        })
    }

    /** The free ten's label, and a pip for each of the day's free tens, lit while it is still to claim. */
    private drawFree(s: Surface, box: Box, label: string, left: number, perDay: number, enabled: boolean, down: boolean): void {
        const sink = enabled && down ? 1 : 0
        const pipsW = perDay * 3 - 1
        const x0 = box.x + ((box.w - textWidth(label) - 3 - pipsW) >> 1)
        drawText(s, label, x0, box.y + 4 + sink, enabled ? C.white : C.stone2, { shadow: 1 })
        const px0 = x0 + textWidth(label) + 3
        for (let k = 0; k < perDay; k++) {
            const x = px0 + k * 3
            const y = box.y + 5 + sink
            rect(s, x, y, 2, 3, C.ink)
            if (k < left) rect(s, x, y, 2, 2, enabled ? C.white : C.bone1)
        }
    }

    /** A pull button: what it does over what it costs, or once pressed to spend Gold, the confirm. */
    private drawPull(s: Surface, box: Box, system: GachaSystemId, price: PullPrice, label: string, armed: boolean, enabled: boolean, lit: boolean, pressed: boolean): void {
        plateButton(s, box, '', armed ? CONFIRM_PLATE : BUY_PLATE, enabled, lit || armed, pressed)
        const sink = enabled && lit && pressed ? 1 : 0
        const cx = box.x + (box.w >> 1)
        const ink = enabled ? C.white : C.stone2
        // a ten-pull says what it is: nine paid for and one on the house, the free one in the free pull's gold
        const bonus = price.pulls - price.cost
        if (armed || bonus <= 0) drawText(s, armed ? 'CONFIRM' : label, cx, box.y + 3 + sink, ink, { align: 1, shadow: 1 })
        else {
            const paid = `PULL ${price.cost}`
            const free = `+${bonus}`
            const x0 = cx - ((textWidth(paid) + 1 + textWidth(free)) >> 1)
            drawText(s, paid, x0, box.y + 3 + sink, ink, { shadow: 1 })
            drawText(s, free, x0 + textWidth(paid) + 1, box.y + 3 + sink, enabled ? C.gold3 : C.stone2, { shadow: 1 })
        }

        // the price line, laid out as pieces and centred: Seals from the balance, then any Gold
        const y = box.y + 11 + sink
        const pieces: { w: number, draw: (x: number) => void }[] = []
        if (price.fromBalance > 0) {
            const n = String(price.fromBalance)
            pieces.push({ w: textWidth(n) + 9, draw: (x) => {
                drawText(s, n, x, y, ink, { shadow: 1 })
                glyph(s, SEAL_DOT[system], x + textWidth(n) + 5, y + 2, true)
            } })
        }
        if (price.gold > 0) {
            const g = `${price.fromBalance > 0 ? '+' : ''}${price.goldText.toUpperCase()}`
            pieces.push({ w: textWidth(g) + 9, draw: (x) => {
                drawText(s, g, x, y, !enabled ? C.stone2 : armed ? C.white : C.gold3, { shadow: 1 })
                glyph(s, COIN, x + textWidth(g) + 5, y + 2, true)
            } })
        }
        const total = pieces.reduce((sum, p) => sum + p.w, 0) + Math.max(0, pieces.length - 1) * 2
        let x = cx - (total >> 1)
        for (const p of pieces) {
            p.draw(x)
            x += p.w + 2
        }
    }

    /** In the buttons' place while the emblem is pointed at: what is collected, the Essence, the odds. */
    private drawRates(s: Surface, col: Box, b: GachaBannerView): void {
        const x0 = col.x + 5
        const x1 = col.x + col.w - 5
        let y = col.y + BTN_Y
        drawText(s, 'OWNED', x0, y, C.stone3, { shadow: 1 })
        drawText(s, `${b.owned}/${b.total}`, x1, y, C.bone1, { align: 2, shadow: 1 })
        y += 8
        drawText(s, 'ESSENCE', x0, y, C.stone3, { shadow: 1 })
        drawText(s, b.essence.toUpperCase(), x1, y, C.bone1, { align: 2, shadow: 1 })
        y += 11
        RARITY_NAMES.forEach((name, k) => {
            const c = RARITY_COLORS[RARITY_KEYS[k]!]![2]
            drawText(s, name, x0, y, c, { shadow: 1 })
            const pct = b.dropRates[k] ?? 0
            drawText(s, `${pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`, x1, y, C.bone1, { align: 2, shadow: 1 })
            y += 7
        })
    }

    private drawReveal(s: Surface, t: number, r: NonNullable<GachaView['reveal']>): void {
        if (this.dealtKey !== r.key) {
            this.dealtKey = r.key
            this.dealtAt = t
        }
        const since = t - (this.dealtAt ?? t)
        const beats = dealSchedule(r.cards)
        dither(s, 0, 0, s.w, s.h, C.ink, 12)
        const perRow = Math.min(5, r.cards.length)
        const rows = Math.ceil(r.cards.length / 5)
        const rowW = perRow * CARD + (perRow - 1) * CARD_GAP
        const top = ((s.h - rows * CARD_ROW) >> 1) + 4
        // the cards sit on a solid board, so the banners under the dimming never show through a tag
        const boardW = Math.max(rowW, 120) + 24
        const boardX = (s.w - boardW) >> 1
        panel(s, boardX, top - 22, boardW, rows * CARD_ROW + 34)
        const at = (i: number) => ({ x: ((s.w - rowW) >> 1) + (i % 5) * (CARD + CARD_GAP), y: top + Math.floor(i / 5) * CARD_ROW })

        // a mythic, once it turns, stains the board red, fading
        const mythicAgo = latestFlip(r.cards, beats, since, 'mythic')
        if (mythicAgo !== null && mythicAgo < MYTHIC_TINT) {
            dither(s, boardX + 2, top - 20, boardW - 4, rows * CARD_ROW + 30, C.red0, Math.round(9 * (1 - mythicAgo / MYTHIC_TINT)))
        }

        // under the cards, in each card's rarity colours: every turned card's looping aura, then the
        // one-off flashes over them. In a ten-pull only rare and up flash, or ten bursts at once
        // bury the ones worth seeing; the auras are small enough for all ten.
        const glow = (draw: (f: Surface) => void, i: number, rarity: string) => {
            const { x, y } = at(i)
            FLASH.clear()
            draw(FLASH)
            blit(s, FLASH, x + (CARD >> 1) - (REVEAL_SIZE >> 1), y + (CARD >> 1) - (REVEAL_SIZE >> 1), REVEAL_LUT[rarity] ?? REVEAL_LUT.common)
        }
        r.cards.forEach((card, i) => {
            const turned = since - beats[i]!.flip
            if (turned < 0) return
            glow(f => drawRevealAura(f, turned), i, card.rarity)
            // a mythic's aura is doubled, its rays falling between the first set's
            if (card.rarity === 'mythic') glow(f => drawRevealAura(f, turned + REVEAL_AURA_LOOP / 2), i, card.rarity)
        })
        r.cards.forEach((card, i) => {
            // the flash charges first, so it starts that long before the card turns
            const played = since - beats[i]!.flip + FLASH_CHARGE
            const mythic = card.rarity === 'mythic'
            if (played < 0 || played >= FLASH_FOR + (mythic ? MYTHIC_ECHO : 0)) return
            if (r.cards.length > 1 && rarityRank(card.rarity) < 2) return
            if (played < FLASH_FOR) glow(f => drawRevealBase(f, played), i, card.rarity)
            // a mythic bursts a second time, straight after the first
            if (mythic && played >= MYTHIC_ECHO) glow(f => drawRevealBase(f, played - MYTHIC_ECHO + FLASH_CHARGE), i, card.rarity)
        })

        // the title, or while one is up, the banner a legendary or a mythic raises in its place
        const banner = bannerFor(r.cards, beats, since)
        if (banner) drawSkillBanner(s, banner.text, s.w >> 1, top - 19, banner.ago, banner.boss, BANNER_FOR - banner.ago)
        else drawText(s, `${NAMES[r.system]}: PULL ${r.cards.length}`, s.w >> 1, top - 15, C.gold2, { align: 1, shadow: 1 })

        r.cards.forEach((card, i) => {
            const beat = beats[i]!
            const landed = since - beat.land
            if (landed < 0) return
            const { x, y } = at(i)
            if (since < beat.flip) {
                // face down, sliding in from a few pixels above; a mythic then trembles while red builds behind it
                const lift = Math.round(Math.max(0, 1 - landed / FLIP_AFTER) * 4)
                const mythic = card.rarity === 'mythic'
                let jx = 0
                if (mythic) {
                    const held = Math.min(1, landed / MYTHIC_HOLD)
                    ditherDisc(s, x + (CARD >> 1), y + (CARD >> 1), 13 + held * 7, C.red1, Math.round(held * 9))
                    if (held > 0.3 && Math.floor(since * 24) % 2) jx = (held > 0.7 ? 2 : 1) * (Math.floor(since * 12) % 2 ? 1 : -1)
                }
                rect(s, x + jx, y - lift, CARD, CARD, C.ink)
                rect(s, x + jx + 1, y - lift + 1, CARD - 2, CARD - 2, mythic ? C.red0 : C.night2)
                rect(s, x + jx + 3, y - lift + 3, CARD - 6, CARD - 6, C.night1)
                drawText(s, '?', x + jx + (CARD >> 1), y - lift + 9, mythic ? C.red2 : C.stone2, { align: 1, shadow: 1 })
                return
            }
            blit(s, collectionTile(TABS[r.system], { id: card.contentId, rarity: card.rarity, owned: true, mark: null }), x, y)
            // a rare or better flashes as it turns
            if (since - beat.flip < 0.12 && rarityRank(card.rarity) >= 2) rect(s, x, y, CARD, 1, C.white)
            const [tag, c] = card.isNew ? ['NEW', C.green3] : card.essence > 0 ? [`+${card.essence}`, C.purple2] : [`LV ${card.level}`, C.bone1]
            drawText(s, tag, x + (CARD >> 1), y + CARD + 3, c, { align: 1, shadow: 1 })
        })
        if (since >= beats[beats.length - 1]!.flip) {
            drawText(s, 'PRESS TO CLOSE', s.w >> 1, top + rows * CARD_ROW + 2, C.stone3, { align: 1, shadow: 1 })
        }

        // over everything: the white frame a legendary or a mythic turns on, then the whole view shakes
        const legendAgo = latestFlip(r.cards, beats, since, 'legendary')
        const mythicWhite = mythicAgo !== null && mythicAgo < MYTHIC_WHITE
        if (mythicWhite || (legendAgo !== null && legendAgo < LEGEND_WHITE)) dither(s, 0, 0, s.w, s.h, C.white, mythicWhite ? 10 : 4)
        const [amp, ago, dur] = mythicAgo !== null && mythicAgo < MYTHIC_SHAKE
            ? [MYTHIC_SHAKE_PX, mythicAgo, MYTHIC_SHAKE]
            : legendAgo !== null && legendAgo < LEGEND_SHAKE ? [LEGEND_SHAKE_PX, legendAgo, LEGEND_SHAKE] : [0, 0, 1]
        if (amp > 0) {
            const a = amp * (1 - ago / dur)
            shake(s, Math.round(Math.sin(since * 97) * a), Math.round(Math.cos(since * 71) * a))
        }
    }
}

interface Beat { land: number, flip: number }

/**
 * When each card lands and turns, in seconds from the deal. A mythic holds the deal: it lands,
 * trembles for `MYTHIC_HOLD`, and the next card comes only once it has turned.
 */
function dealSchedule(cards: readonly GachaCard[]): Beat[] {
    let t = 0
    return cards.map((card) => {
        const mythic = card.rarity === 'mythic'
        const beat = { land: t, flip: t + (mythic ? MYTHIC_HOLD : FLIP_AFTER) }
        t += DEAL_EVERY + (mythic ? MYTHIC_HOLD : 0)
        return beat
    })
}

/** Seconds since the latest card of `rarity` turned, or null when none has. */
function latestFlip(cards: readonly GachaCard[], beats: readonly Beat[], since: number, rarity: string): number | null {
    let best: number | null = null
    cards.forEach((card, i) => {
        const ago = since - beats[i]!.flip
        if (card.rarity === rarity && ago >= 0 && (best === null || ago < best)) best = ago
    })
    return best
}

/** The banner up at `since`: the latest legendary or mythic to turn, while its banner lasts. */
function bannerFor(cards: readonly GachaCard[], beats: readonly Beat[], since: number): { text: string, boss: boolean, ago: number } | null {
    let best: { text: string, boss: boolean, ago: number } | null = null
    cards.forEach((card, i) => {
        if (card.rarity !== 'legendary' && card.rarity !== 'mythic') return
        const ago = since - beats[i]!.flip
        if (ago < 0 || ago >= BANNER_FOR || (best && best.ago <= ago)) return
        best = { text: card.rarity === 'mythic' ? 'MYTHIC' : 'LEGENDARY', boss: card.rarity === 'mythic', ago }
    })
    return best
}

function rarityRank(rarity: string): number {
    return RARITY_KEYS.indexOf(rarity as typeof RARITY_KEYS[number])
}

/** Move the whole view by (dx, dy), the edges it leaves filled with ink: a screen shake. */
function shake(s: Surface, dx: number, dy: number): void {
    if (!dx && !dy) return
    const src = s.data.slice()
    for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
            const sx = x - dx
            const sy = y - dy
            s.data[y * s.w + x] = sx >= 0 && sx < s.w && sy >= 0 && sy < s.h ? src[sy * s.w + sx]! : C.ink
        }
    }
}
