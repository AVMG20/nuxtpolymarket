// The Raids scene: the raid select. The five raids as a list on the left, each row its Key, its
// name, the Keys in hand and its best; on the right the chosen raid's boss, framed as a portrait in
// its idle loop, over what the fight asks, what it pays and what it costs, and the button that
// will enter it. The bosses are drawn for the whole-scene camera and stand taller than the stage,
// so the portrait is the top of the body, not the whole of it.

import { C } from './palette'
import { Surface, rect, blit, dither, ditherEllipse } from './surface'
import { drawText, textWidth } from './font'
import { glyph } from './icon-kit'
import { CURRENCY_ICONS } from './icons-items'
import { panel } from './ui-art'
import { plateButton, type Box } from './collections-scene'
import { bufferSize, drawCreature, stateFrames, type CreatureDef } from './creature'
import { ANIM_FPS } from './anim'
import { GILDED_WARLORD, GREAT_DUMMY, DEEPCOIL, FORGE_MASTER, RAMPANT } from './raids'
import type { SceneBackdrops } from './menu-band'
import { RAIDS, paysEveryRun, type RaidFightType, type RaidId } from '../../../shared/utils/hero-quest/content/raids'
import { RAID_KEYS_PER_DAY } from '../../../shared/utils/hero-quest/constants'

export interface RaidsView {
    /** The raid shown on the right. */
    selected: RaidId
    /** Each raid's Keys and best, as the server reports them; a raid missing here shows none. */
    raids: readonly RaidRowView[]
    /** A round or a quick-clear is on its way. */
    busy: boolean
}

export interface RaidRowView {
    id: RaidId
    open: boolean
    keys: number
    keyCap: number
    /** Time to the next day's Keys, spelled out; null at the bank's cap. */
    nextKeys: string | null
    best: number
    bestReward: number
}

/** What the pointer is over: a raid's row, or one of the showcase's two buttons. */
export type RaidsHover = RaidId | 'enter' | 'quick' | null

/** The boss a raid's portrait shows: the Forge's finale, the Rampant at its first tier. */
const BOSS: Readonly<Record<RaidId, CreatureDef>> = {
    raid_guild: GILDED_WARLORD,
    raid_training_grounds: GREAT_DUMMY,
    raid_dig_site: DEEPCOIL,
    raid_forge: FORGE_MASTER,
    raid_trait: RAMPANT[0]!
}

/** Px a portrait raises its boss in the frame, for a body whose top alone would leave it sitting low. */
const LIFT: Readonly<Partial<Record<RaidId, number>>> = { raid_dig_site: 18, raid_trait: 18 }

const KEY_ICON: Readonly<Record<RaidId, string>> = {
    raid_guild: 'key_guild',
    raid_training_grounds: 'key_training_grounds',
    raid_dig_site: 'key_dig_site',
    raid_forge: 'key_forge',
    raid_trait: 'key_trait'
}

const REWARD_ICON: Readonly<Record<RaidId, string>> = {
    raid_guild: 'seal_champion',
    raid_training_grounds: 'seal_skill',
    raid_dig_site: 'seal_artifact',
    raid_forge: 'seal_gear',
    raid_trait: 'trait_gems'
}

/** What each fight type asks of the party, in a line. */
const FIGHT: Readonly<Record<RaidFightType, { line: string }>> = {
    solo_boss: { line: 'ONE BOSS. DOWN IT BEFORE IT ENRAGES.' },
    training_dummy: { line: 'IT NEVER FALLS. JUST HIT IT HARD.' },
    reinforced_boss: { line: 'A WYRM, AND WAVE AFTER WAVE OF ADDS.' },
    boss_gauntlet: { line: 'THREE BOSSES, ONE CLOCK.' },
    rampaging_boss: { line: 'IT CANNOT DIE. HOLD OUT AS IT GROWS.' }
}

const TOP = 16
const LIST = { x: 4, w: 98 }
const ROW_H = 25
const ROW_GAP = 2
const SHOW = { x: 106, y: TOP, w: 162, h: 5 * ROW_H + 4 * ROW_GAP }
/** The portrait window at the top of the showcase. */
const PORTRAIT = { w: SHOW.w - 4, h: 64 }
const ENTER = { w: 44, h: 13 }

const SELECTED_RIM = [C.gold0, C.gold1, C.gold2] as const
const ENTER_PLATE = [C.red0, C.red1, C.red2] as const
const QUICK_PLATE = [C.green0, C.green1, C.green2] as const

function rowBox(i: number): Box {
    return { x: LIST.x, y: TOP + i * (ROW_H + ROW_GAP), w: LIST.w, h: ROW_H }
}

function enterBox(): Box {
    return { x: SHOW.x + SHOW.w - ENTER.w - 4, y: SHOW.y + SHOW.h - ENTER.h - 4, w: ENTER.w, h: ENTER.h }
}

function quickBox(): Box {
    const enter = enterBox()
    return { x: enter.x - ENTER.w - 3, y: enter.y, w: ENTER.w, h: ENTER.h }
}

function inside(b: Box, x: number, y: number): boolean {
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
}

/** What a point on the view is over. */
export function raidsHoverAt(x: number, y: number): RaidsHover {
    for (let i = 0; i < RAIDS.length; i++) if (inside(rowBox(i), x, y)) return RAIDS[i]!.id
    if (inside(enterBox(), x, y)) return 'enter'
    return inside(quickBox(), x, y) ? 'quick' : null
}

/** Whether a showcase button does anything for the chosen raid now: open, a Key in hand, and for quick-clear a best to take. */
export function raidButtonEnabled(view: RaidsView, button: 'enter' | 'quick'): boolean {
    const raid = view.raids.find(r => r.id === view.selected)
    if (!raid || !raid.open || raid.keys < 1 || view.busy) return false
    return button === 'enter' || raid.best > 0
}

/** Break text into lines no wider than `max` px. */
function wrap(text: string, max: number): string[] {
    const out: string[] = []
    let line = ''
    for (const word of text.split(' ')) {
        const next = line ? `${line} ${word}` : word
        if (line && textWidth(next) > max) {
            out.push(line)
            line = word
        } else line = next
    }
    if (line) out.push(line)
    return out
}

/**
 * A boss's idle loop as portrait frames: each frame drawn once, at full size, and cropped to the
 * top of the body, centred on it. Baked a frame at a time as the loop first plays, so choosing a
 * raid never stalls a render on a whole loop.
 */
class Portrait {
    private readonly frames: (Surface | null)[]
    private readonly full: Surface
    private crop: { x: number, y: number } | null = null

    constructor(private readonly def: CreatureDef, private readonly lift = 0) {
        this.frames = Array.from({ length: stateFrames(def, 'idle') }, () => null)
        const n = bufferSize(def)
        this.full = new Surface(n, n, 0, 0)
    }

    frame(t: number): Surface {
        const i = Math.floor(t * ANIM_FPS) % this.frames.length
        const known = this.frames[i]
        if (known) return known
        const n = this.full.w
        this.full.clear()
        drawCreature(this.full, n / 2, n - (this.def.foot ?? 6), this.def, 'idle', i / ANIM_FPS, -1)
        // the crop is fixed by the first frame, so the body breathes inside a still window
        if (!this.crop) {
            const crop = cropOf(this.full)
            this.crop = { x: crop.x, y: crop.y + this.lift }
        }
        const out = new Surface(PORTRAIT.w, PORTRAIT.h, 0, 0)
        blit(out, this.full, -this.crop.x, -this.crop.y)
        this.frames[i] = out
        return out
    }
}

/** Where the portrait window sits on a full frame: across the body's middle, a few px above its top. */
function cropOf(s: Surface): { x: number, y: number } {
    let x0 = s.w
    let x1 = 0
    let y0 = s.h
    for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
            if (!s.data[y * s.w + x]) continue
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
        }
    }
    return { x: Math.round((x0 + x1) / 2 - PORTRAIT.w / 2), y: y0 - 6 }
}

export class RaidsScene {
    private readonly portraits = new Map<RaidId, Portrait>()

    constructor(private readonly backdrops: SceneBackdrops) {}

    render(t: number, view: RaidsView, hover: RaidsHover, pressed: boolean): Surface {
        const s = this.backdrops.render('raids', t, false)
        drawText(s, 'RAIDS', 6, 4, C.gold2, { shadow: 1 })
        RAIDS.forEach((raid, i) => this.drawRow(s, rowBox(i), raid.id, raid.name, view.raids.find(r => r.id === raid.id), view.selected === raid.id, hover === raid.id, pressed))
        this.drawShowcase(s, t, view, hover, pressed)
        return s
    }

    private drawRow(s: Surface, b: Box, id: RaidId, name: string, raid: RaidRowView | undefined, selected: boolean, lit: boolean, pressed: boolean): void {
        const sink = lit && pressed && !selected ? 1 : 0
        panel(s, b.x, b.y + sink, b.w, b.h - sink, selected ? SELECTED_RIM : undefined, selected ? C.night2 : lit ? C.night2 : C.night1)
        glyph(s, CURRENCY_ICONS[KEY_ICON[id]]!, b.x + 11, b.y + (b.h >> 1) + sink, true)
        drawText(s, name.toUpperCase(), b.x + 21, b.y + 6 + sink, selected ? C.gold3 : C.bone1, { shadow: 1 })
        // under the name, the Keys in hand; on their right the best, or that the raid opens later
        const keys = raid?.keys ?? 0
        drawText(s, `${keys} ${keys === 1 ? 'KEY' : 'KEYS'}`, b.x + 21, b.y + 14 + sink, keys > 0 ? C.stone3 : C.red2, { shadow: 1 })
        const right = b.x + b.w - 5
        if (!raid?.open) {
            drawText(s, 'SOON', right, b.y + 14 + sink, C.stone2, { align: 2, shadow: 1 })
            return
        }
        drawText(s, `LV ${raid.best}`, right, b.y + 14 + sink, raid.best > 0 ? C.gold3 : C.stone3, { align: 2, shadow: 1 })
    }

    private drawShowcase(s: Surface, t: number, view: RaidsView, hover: RaidsHover, pressed: boolean): void {
        const id = view.selected
        const raid = RAIDS.find(r => r.id === id)!
        const row = view.raids.find(r => r.id === id)
        panel(s, SHOW.x, SHOW.y, SHOW.w, SHOW.h)
        // the portrait: a dark well with the boss's shadow on its floor, the boss over it
        const px = SHOW.x + 2
        const py = SHOW.y + 2
        rect(s, px, py, PORTRAIT.w, PORTRAIT.h, C.ink)
        ditherEllipse(s, px + (PORTRAIT.w >> 1), py + PORTRAIT.h - 4, 50, 6, C.night1, 9)
        let portrait = this.portraits.get(id)
        if (!portrait) {
            portrait = new Portrait(BOSS[id], LIFT[id])
            this.portraits.set(id, portrait)
        }
        blit(s, portrait.frame(t), px, py)
        rect(s, px, py + PORTRAIT.h, PORTRAIT.w, 1, C.night3)

        // its name, what the fight asks, and on one line what it pays and the Keys in hand
        const x = SHOW.x + 5
        let y = py + PORTRAIT.h + 4
        // the Rampant's tiers are named after it ("The Rampant — rampage 1"); the portrait is the creature
        drawText(s, BOSS[id].name.split(' — ')[0]!.toUpperCase(), x, y, C.gold2, { shadow: 1 })
        // a boss is fought at one past the best; the level goes on the name's line
        if (row?.open && !paysEveryRun(raid.fightType)) drawText(s, `LV ${row.best + 1}`, SHOW.x + SHOW.w - 5, y, C.gold3, { align: 2, shadow: 1 })
        y += 10
        for (const line of wrap(FIGHT[raid.fightType].line, SHOW.w - 10)) {
            drawText(s, line, x, y, C.bone1, { shadow: 1 })
            y += 9
        }
        y += 4
        glyph(s, CURRENCY_ICONS[REWARD_ICON[id]]!, x + 5, y + 2, true)
        drawText(s, `PAYS ${raid.reward.toUpperCase()}`, x + 15, y, C.stone3, { shadow: 1 })
        // the Keys in hand, of the most the daily grant banks, at the line's right end
        if (row?.open) {
            const keys = `${row.keys}/${row.keyCap}`
            const right = SHOW.x + SHOW.w - 5
            drawText(s, keys, right, y, C.stone3, { align: 2, shadow: 1 })
            glyph(s, CURRENCY_ICONS[KEY_ICON[id]]!, right - textWidth(keys) - 8, y + 2, true)
        }

        // beside the buttons, what the daily grant adds
        if (row?.open) drawText(s, `+${RAID_KEYS_PER_DAY} EVERY DAY`, x, enterBox().y + 4, C.stone3, { shadow: 1 })
        const open = row?.open ?? false
        plateButton(s, enterBox(), open ? 'ENTER' : 'SOON', ENTER_PLATE, raidButtonEnabled(view, 'enter'), hover === 'enter', pressed)
        if (open) plateButton(s, quickBox(), 'QUICK', QUICK_PLATE, raidButtonEnabled(view, 'quick'), hover === 'quick', pressed)
    }
}

// ── The reward after a round or a quick-clear ─────────────────────────────────────────

/** What a round or a quick-clear paid, for the popup that says so. */
export interface RaidRewardView {
    raidId: RaidId
    /** A quick-clear took the best's reward without a round. */
    quick: boolean
    /** Whether it paid: a boss raid lost pays nothing and spends no Key. */
    won: boolean
    level: number
    newBest: boolean
    reward: number
}

const REWARD = { w: 120, h: 64 }
const REWARD_BTN = { w: 52, h: 13 }

function rewardBox(w: number, h: number): Box {
    return { x: (w - REWARD.w) >> 1, y: (h - REWARD.h) >> 1, w: REWARD.w, h: REWARD.h }
}

function rewardButtonBox(w: number, h: number): Box {
    const b = rewardBox(w, h)
    return { x: b.x + ((b.w - REWARD_BTN.w) >> 1), y: b.y + b.h - REWARD_BTN.h - 5, w: REWARD_BTN.w, h: REWARD_BTN.h }
}

/** Whether a point on a view `w` × `h` is on the reward popup's button. */
export function onRaidRewardButton(w: number, h: number, x: number, y: number): boolean {
    return inside(rewardButtonBox(w, h), x, y)
}

/**
 * The reward popup, over whatever the stage shows: kept small, the raid, the level it came to (and
 * whether that is a new best) and what it paid. Its one button puts it away: after a round back to
 * the run, after a quick-clear to the Raids scene.
 */
export function drawRaidReward(s: Surface, view: RaidRewardView, lit: boolean, pressed: boolean): void {
    const raid = RAIDS.find(r => r.id === view.raidId)!
    dither(s, 0, 0, s.w, s.h, C.ink, 9)
    const b = rewardBox(s.w, s.h)
    panel(s, b.x, b.y, b.w, b.h, SELECTED_RIM)
    const cx = b.x + (b.w >> 1)
    drawText(s, raid.name.toUpperCase(), cx, b.y + 5, C.gold2, { align: 1, shadow: 1 })
    drawText(s, `LEVEL ${view.level}`, cx, b.y + 14, C.white, { font: 'big', align: 1, shadow: 1 })
    if (!view.won) {
        // a loss: no reward, and the Key it would have cost is still in hand
        drawText(s, 'DEFEATED', cx, b.y + 23, C.red2, { align: 1, shadow: 1 })
        drawText(s, 'NO KEY SPENT', cx, b.y + 33, C.stone3, { align: 1, shadow: 1 })
    } else {
        if (view.newBest) drawText(s, 'NEW BEST', cx, b.y + 23, C.green3, { align: 1, shadow: 1 })
        // what it paid, its currency's icon before it
        const paid = `+${view.reward} ${raid.reward.toUpperCase()}`
        const pw = textWidth(paid) + 15
        const py = b.y + 33
        glyph(s, CURRENCY_ICONS[REWARD_ICON[view.raidId]]!, cx - (pw >> 1) + 5, py + 2, true)
        drawText(s, paid, cx - (pw >> 1) + 15, py, C.gold3, { shadow: 1 })
    }
    plateButton(s, rewardButtonBox(s.w, s.h), view.quick ? 'OK' : 'CONTINUE', QUICK_PLATE, true, lit, pressed)
}
