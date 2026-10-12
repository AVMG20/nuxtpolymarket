// The Traits scene (`traits.md`): the five slots down the left, each in its grade's frame with the
// stat, its value and its Set, and a padlock beside it; the Roll button under them, priced by how
// many are locked, with Auto Roll and the grade it stops at beside it. On the right, the five Sets with how many pieces each has and the tier it
// reached, and the save slots as a two-by-two grid of cards, each with Save and Load (a locked one
// with the Gem price of the next). The line along the bottom spells out what the pointer is over.
// A Roll spins its slots through the grades until the new board is in, then lands them one at a
// time, each with a flash, and a grade of A or better with a burst in its grade's colours.

import { C, TRAIT_GRADE_COLORS, type TraitGrade } from './palette'
import { rect, px, arc, blit, dither, Surface } from './surface'
import { drawText, textWidth } from './font'
import { glyph } from './icon-kit'
import { CURRENCY_ICONS } from './icons-items'
import { TRAIT_FRAME_H, TRAIT_FRAME_W, TRAIT_TAB, traitFrame } from './icons-misc'
import { panel } from './ui-art'
import { plateButton, type Box } from './collections-scene'
import { drawRevealBase, REVEAL_LUT, REVEAL_SIZE } from './feedback'
import type { SceneBackdrops } from './menu-band'
import { TRAIT_GRADES, TRAIT_SETS, TRAIT_STATS } from '../../../shared/utils/hero-quest/content/traits'

export interface TraitSlotView {
    statName: string
    /** The value, spelled out: `+35%`. */
    value: string
    grade: TraitGrade
    set: string
    setName: string
    locked: boolean
}

export interface TraitSetView {
    id: string
    name: string
    pieces: number
    /** The tier reached, 0-based; null below the first count. */
    tier: number | null
    /** Each tier's piece count and what it gives, spelled out: `+25%`. */
    tiers: readonly { pieces: number, value: string }[]
    /** What a tier does, with `{x}` for its value. */
    effect: string
}

export interface TraitSaveView {
    index: number
    unlocked: boolean
    /** The Gem price, spelled out, on the next save slot to buy only. */
    price: string | null
    priceGems: number | null
    /** The grades it holds, slot by slot; null when nothing is stored. */
    grades: readonly TraitGrade[] | null
}

export interface TraitsView {
    traitGems: string
    slots: readonly (TraitSlotView | null)[]
    rollCost: number
    /** Slots a Roll would reroll: every one not locked. */
    rerolls: number
    /** The Trait Gems cover a Roll. */
    affordable: boolean
    sets: readonly TraitSetView[]
    saves: readonly TraitSaveView[]
    /** Trait Gems a store or a load costs, and whether they are there. */
    saveCost: number
    saveAffordable: boolean
    /** Every slot holds a roll, so the board can be stored. */
    boardFull: boolean
    /** Gems held, for the Buy on a locked save slot. */
    gems: number
    /** The target pressed once and waiting for the press that confirms it. */
    armed: TraitsTarget | null
    /** The Roll being revealed; null when none is. */
    roll: TraitRollView | null
    /** The grade Auto Roll stops at, or better. */
    autoGrade: TraitGrade
    /** The list of grades to stop at is open. */
    gradePickerOpen: boolean
}

/** A Roll on its way or just in: the slots it rerolls, and whether the new board has arrived. */
export interface TraitRollView {
    key: number
    slots: readonly number[]
    landed: boolean
    /** What an Auto Roll came to, spelled out, for the bottom line once it lands; null for a single Roll. */
    note: string | null
    /** An Auto Roll's running count while it goes; null for a single Roll. */
    auto: { rolls: number, spent: number } | null
}

/** What the pointer can be over. */
export type TraitsTarget = 'roll' | 'auto' | 'stop' | 'grade' | `grade:${TraitGrade}` | 'shut' | 'skip' | `slot:${number}` | `lock:${number}` | `set:${number}` | `save:${number}` | `load:${number}` | `buy:${number}`

const LEFT_X = 6
const ROWS_Y = 14
const ROW_PITCH = 22
const LOCK_W = 14
// the Roll row: Roll, Auto Roll, and the grade Auto Roll stops at, across the slots' width
const ROLL: Box = { x: LEFT_X, y: 126, w: 66, h: 13 }
const AUTO: Box = { x: ROLL.x + ROLL.w + 2, y: ROLL.y, w: 37, h: 13 }
const GRADE: Box = { x: AUTO.x + AUTO.w + 2, y: ROLL.y, w: TRAIT_FRAME_W + 3 + LOCK_W - ROLL.w - AUTO.w - 4, h: 13 }
/** The grades Auto Roll can stop at, best first: below C a first Roll all but always lands one. */
export const AUTO_GRADES: readonly TraitGrade[] = ['SSS', 'SS', 'S', 'A', 'B', 'C']
const GRADE_ROW_H = 10

function gradeListBox(): Box {
    const h = AUTO_GRADES.length * GRADE_ROW_H + 4
    return { x: GRADE.x - 6, y: GRADE.y - h - 1, w: GRADE.w + 6, h }
}
const RIGHT_X = 146
const SETS_Y = 22
const SET_PITCH = 9
const SAVES_Y = 79
const CARD_W = 58
const CARD_H = 29
const CARD_GAP = 4
const BTN_H = 11
const INFO_Y = 145

const ROLL_PLATE = [C.purple0, C.purple1, C.purple2] as const
const AUTO_PLATE = [C.teal0, C.teal1, C.teal2] as const
const STOP_PLATE = [C.red0, C.red1, C.red2] as const
const SAVE_PLATE = [C.blue0, C.blue1, C.blue2] as const
const LOAD_PLATE = [C.green0, C.green1, C.green2] as const
const BUY_PLATE = [C.green0, C.green1, C.green2] as const
const CONFIRM_PLATE = [C.gold0, C.gold1, C.gold2] as const

/** A Roll's slots spin at least this long, however soon the board is in. */
const SPIN_MIN = 0.45
/** Then they land this far apart, top to bottom. */
const LAND_GAP = 0.14
const FLASH_FOR = 0.2
/** The burst a grade of A or better lands with, in its grade's colours. */
const BURST_LUT: Partial<Record<TraitGrade, string>> = { A: 'rare', S: 'legendary', SS: 'mythic', SSS: 'epic' }
const BURST_FOR = 1.0
const BURST = new Surface(REVEAL_SIZE, REVEAL_SIZE, 0, 0)

/** A Set's colour on the board, by ID. */
const SET_COLORS: Readonly<Record<string, number>> = {
    set_vital_reflex: C.green3,
    set_divine_blessing: C.gold3,
    set_aggression: C.red3,
    set_deep_impact: C.orange,
    set_back_to_basics: C.cyan
}

function rowBox(i: number): Box {
    return { x: LEFT_X, y: ROWS_Y + i * ROW_PITCH, w: TRAIT_FRAME_W, h: TRAIT_FRAME_H }
}

function lockBox(i: number): Box {
    const row = rowBox(i)
    return { x: row.x + row.w + 3, y: row.y + 3, w: LOCK_W, h: LOCK_W }
}

function setBox(w: number, k: number): Box {
    return { x: RIGHT_X, y: SETS_Y + k * SET_PITCH, w: w - 6 - RIGHT_X, h: SET_PITCH - 1 }
}

function cardBox(i: number): Box {
    return { x: RIGHT_X + (i % 2) * (CARD_W + CARD_GAP), y: SAVES_Y + Math.floor(i / 2) * (CARD_H + 2), w: CARD_W, h: CARD_H }
}

function saveButtonBox(i: number): Box {
    const c = cardBox(i)
    return { x: c.x + 3, y: c.y + c.h - BTN_H - 2, w: 25, h: BTN_H }
}

function loadButtonBox(i: number): Box {
    const c = cardBox(i)
    return { x: c.x + c.w - 28, y: c.y + c.h - BTN_H - 2, w: 25, h: BTN_H }
}

function buyButtonBox(i: number): Box {
    const c = cardBox(i)
    return { x: c.x + 3, y: c.y + c.h - BTN_H - 2, w: c.w - 6, h: BTN_H }
}

const inside = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h

/** `text`, cut short with an ellipsis where it would run past `w` px. */
function fit(text: string, w: number): string {
    if (textWidth(text) <= w) return text
    let cut = text
    while (cut.length && textWidth(`${cut}...`) > w) cut = cut.slice(0, -1)
    return `${cut.trimEnd()}...`
}

/** What a point on the view is over. */
/** An Auto Roll is going: its slots spin until the player stops it or it stops itself. */
export function autoRolling(view: TraitsView): boolean {
    return !!view.roll?.auto && !view.roll.landed
}

export function traitsTargetAt(view: TraitsView, w: number, x: number, y: number): TraitsTarget | null {
    // while an Auto Roll goes, its button is STOP and nothing else answers
    if (autoRolling(view)) return inside(AUTO, x, y) ? 'stop' : null
    // with the grade list open, only it and its chip answer; anywhere else puts it away
    if (view.gradePickerOpen) {
        if (inside(GRADE, x, y)) return 'grade'
        const list = gradeListBox()
        if (!inside(list, x, y)) return 'shut'
        const grade = AUTO_GRADES[Math.floor((y - list.y - 2) / GRADE_ROW_H)]
        return grade ? `grade:${grade}` : null
    }
    if (inside(ROLL, x, y)) return 'roll'
    if (inside(AUTO, x, y)) return 'auto'
    if (inside(GRADE, x, y)) return 'grade'
    for (let i = 0; i < view.slots.length; i++) {
        if (inside(lockBox(i), x, y)) return `lock:${i}`
        if (inside(rowBox(i), x, y)) return `slot:${i}`
    }
    for (let k = 0; k < view.sets.length; k++) if (inside(setBox(w, k), x, y)) return `set:${k}`
    for (const save of view.saves) {
        const i = save.index
        if (save.unlocked) {
            if (inside(saveButtonBox(i), x, y)) return `save:${i}`
            if (inside(loadButtonBox(i), x, y)) return `load:${i}`
        } else if (save.price && inside(buyButtonBox(i), x, y)) return `buy:${i}`
    }
    return null
}

/** Whether pressing a target does anything now; the rest are only pointed at. */
export function traitsTargetEnabled(view: TraitsView, target: TraitsTarget, busy: boolean): boolean {
    if (target === 'skip' || target === 'shut' || target === 'stop') return true
    if (busy) return false
    if (target === 'roll' || target === 'auto') return view.rerolls > 0 && view.affordable
    if (target === 'grade' || target.startsWith('grade:')) return true
    const [kind, n] = target.split(':') as [string, string]
    const i = Number(n)
    if (kind === 'lock') return view.slots[i] !== null && view.slots[i] !== undefined
    if (kind === 'save') return view.boardFull && view.saveAffordable
    if (kind === 'load') return view.saveAffordable && !!view.saves[i]?.grades
    if (kind === 'buy') {
        const price = view.saves[i]?.priceGems
        return price !== null && price !== undefined && view.gems >= price
    }
    return false
}

/** A padlock, shut in gold or open in stone. */
function padlock(s: Surface, cx: number, cy: number, shut: boolean): void {
    const body = shut ? C.gold2 : C.stone2
    const hi = shut ? C.gold3 : C.stone3
    if (shut) arc(s, cx, cy - 1, 3, Math.PI, Math.PI * 2, hi)
    else arc(s, cx + 3, cy - 2, 3, Math.PI, Math.PI * 2, hi)
    rect(s, cx - 4, cy - 1, 9, 6, body)
    rect(s, cx - 4, cy - 1, 9, 1, hi)
    px(s, cx, cy + 1, C.ink)
    px(s, cx, cy + 2, C.ink)
}

/** A white ring round `b`. */
function ring(s: Surface, b: Box, c: number = C.white): void {
    rect(s, b.x - 1, b.y - 1, b.w + 2, 1, c)
    rect(s, b.x - 1, b.y + b.h, b.w + 2, 1, c)
    rect(s, b.x - 1, b.y, 1, b.h, c)
    rect(s, b.x + b.w, b.y, 1, b.h, c)
}

/** A Set's effect at one of its tiers, in the letters the small font has. */
function setEffect(set: TraitSetView, tier: number): string {
    return set.effect.replace('{x}', set.tiers[tier]?.value ?? '').replace('&', 'AND').toUpperCase()
}

/** A header over the right column, on a dark strip so the backdrop never runs through it. */
function header(s: Surface, text: string, y: number): void {
    rect(s, RIGHT_X - 2, y - 2, s.w - 4 - RIGHT_X, 9, C.night0)
    drawText(s, text, RIGHT_X, y, C.gold2, { shadow: 1 })
}

export class TraitsScene {
    /** One frame per grade, drawn once. */
    private readonly frames = new Map<TraitGrade, Surface>()
    private rollKey = -1
    private rollStart = 0
    /** When the Roll's board arrived, in scene time; null while it is on its way. */
    private rollLanded: number | null = null
    private rollSkipped = false

    constructor(private readonly backdrops: SceneBackdrops) {}

    /** Picks up a new Roll at scene time `t`, and the moment its board arrives. */
    private syncRoll(view: TraitsView, t: number): void {
        const roll = view.roll
        if (!roll) return
        if (roll.key !== this.rollKey) {
            this.rollKey = roll.key
            this.rollStart = t
            this.rollLanded = null
            this.rollSkipped = false
        }
        if (roll.landed && this.rollLanded === null) this.rollLanded = t
    }

    /**
     * Seconds since slot `i` landed, negative while it spins; null when no Roll is revealing it.
     * A skip lands everything long ago.
     */
    private sinceLanded(view: TraitsView, i: number, t: number): number | null {
        const roll = view.roll
        if (!roll || roll.key !== this.rollKey) return null
        const k = roll.slots.indexOf(i)
        if (k < 0) return null
        if (this.rollLanded === null) return -1
        if (this.rollSkipped) return 1e3
        return t - (Math.max(this.rollStart + SPIN_MIN, this.rollLanded) + k * LAND_GAP)
    }

    /** Whether a Roll is still spinning or landing at `t`: a press then shows it all instead. */
    rollRevealing(view: TraitsView, t: number): boolean {
        this.syncRoll(view, t)
        const roll = view.roll
        if (!roll || roll.key !== this.rollKey || this.rollSkipped) return false
        return roll.slots.some(i => (this.sinceLanded(view, i, t) ?? 1e3) < FLASH_FOR)
    }

    /** A press mid-Roll: land every slot at once, once the board is in. */
    skipRoll(view: TraitsView): void {
        if (view.roll?.key === this.rollKey && this.rollLanded !== null) this.rollSkipped = true
    }

    private frame(grade: TraitGrade): Surface {
        let f = this.frames.get(grade)
        if (!f) {
            f = new Surface(TRAIT_FRAME_W, TRAIT_FRAME_H, 0, 0)
            traitFrame(f, grade)
            this.frames.set(grade, f)
        }
        return f
    }

    /** `hover` is what the pointer is over; `busy` holds every button while a request is on its way. */
    render(t: number, view: TraitsView, hover: TraitsTarget | null, pressed: boolean, busy: boolean): Surface {
        const s = this.backdrops.render('traits', t, false)
        this.syncRoll(view, t)
        drawText(s, 'TRAITS', LEFT_X, 4, C.gold2, { shadow: 1 })
        // the Trait Gems everything here spends, right-aligned
        const gems = view.traitGems.toUpperCase()
        drawText(s, gems, s.w - 6, 4, C.bone1, { align: 2, shadow: 1 })
        glyph(s, CURRENCY_ICONS.trait_gems!, s.w - 6 - textWidth(gems) - 7, 6, true)

        const revealing = this.rollRevealing(view, t)
        view.slots.forEach((slot, i) => this.drawSlot(s, i, slot, revealing ? null : hover, t, this.sinceLanded(view, i, t)))
        this.drawRoll(s, view, hover, pressed, busy || revealing)

        header(s, 'SETS', 13)
        view.sets.forEach((set, k) => this.drawSet(s, k, set, hover === `set:${k}`))

        header(s, 'SAVED BOARDS', SAVES_Y - 9)
        const cost = `${view.saveCost} EACH`
        drawText(s, cost, s.w - 6, SAVES_Y - 9, C.stone3, { align: 2, shadow: 1 })
        glyph(s, CURRENCY_ICONS.trait_gems!, s.w - 6 - textWidth(cost) - 7, SAVES_Y - 7, true)
        for (const save of view.saves) this.drawSave(s, view, save, hover, pressed, busy)

        // a burst over a landing grade of A or better, over everything round it
        view.slots.forEach((slot, i) => {
            const since = this.sinceLanded(view, i, t)
            const lut = slot ? BURST_LUT[slot.grade] : undefined
            if (!slot || !lut || since === null || since < 0 || since >= BURST_FOR) return
            const b = rowBox(i)
            BURST.clear()
            drawRevealBase(BURST, since + 0.4)
            blit(s, BURST, b.x + (TRAIT_TAB >> 1) - (REVEAL_SIZE >> 1), b.y + (b.h >> 1) - (REVEAL_SIZE >> 1), REVEAL_LUT[lut]!)
        })

        if (view.gradePickerOpen) this.drawGradeList(s, view, hover)

        const best = this.rollNote(view, t) ?? this.rollBest(view, t)
        const auto = autoRolling(view) ? view.roll!.auto! : null
        if (auto) drawText(s, fit(`AUTO ROLLING: ${auto.rolls} ROLLS, ${auto.spent} TRAIT GEMS. STOP ENDS IT.`, s.w - 12), LEFT_X, INFO_Y, C.bone1, { shadow: 1 })
        else if (revealing && !best) drawText(s, 'ROLLING...', LEFT_X, INFO_Y, C.stone3, { shadow: 1 })
        else if (best && !hover) drawText(s, fit(best, s.w - 12), LEFT_X, INFO_Y, C.gold3, { shadow: 1 })
        else drawText(s, fit(this.info(view, hover), s.w - 12), LEFT_X, INFO_Y, hover ? C.bone1 : C.stone2, { shadow: 1 })
        return s
    }

    /** An Auto Roll's summary, from once its slots land until a few seconds after; null otherwise. */
    private rollNote(view: TraitsView, t: number): string | null {
        const note = view.roll?.note
        if (!note || !view.roll) return null
        const since = Math.min(...view.roll.slots.map(i => this.sinceLanded(view, i, t) ?? -1))
        return since >= 0 && since <= 4 ? note : null
    }

    /** The best grade of A or better a Roll landed in the last few seconds, spelled out; null with none. */
    private rollBest(view: TraitsView, t: number): string | null {
        let best: TraitSlotView | null = null
        view.roll?.slots.forEach((i) => {
            const slot = view.slots[i]
            const since = this.sinceLanded(view, i, t)
            if (!slot || !BURST_LUT[slot.grade] || since === null || since < 0 || since > 4) return
            if (!best || TRAIT_GRADES.indexOf(slot.grade) > TRAIT_GRADES.indexOf(best.grade)) best = slot
        })
        const b = best as TraitSlotView | null
        return b ? `GRADE ${b.grade}! ${b.statName} ${b.value}, ${b.setName} SET.`.toUpperCase() : null
    }

    /** `since` is how long ago a Roll landed this slot, negative while it spins, null with no Roll on it. */
    private drawSlot(s: Surface, i: number, slot: TraitSlotView | null, hover: TraitsTarget | null, t: number, since: number | null): void {
        const b = rowBox(i)
        const lock = lockBox(i)
        if (since !== null && since < 0) {
            this.drawSpin(s, i, t)
            return
        }
        if (!slot) {
            panel(s, b.x, b.y, b.w, b.h, [C.night0, C.night1, C.night2], C.night0)
            drawText(s, 'EMPTY', b.x + (b.w >> 1), b.y + 8, C.stone2, { align: 1, shadow: 1 })
            if (hover === `slot:${i}`) ring(s, b, C.steel3)
            return
        }
        blit(s, this.frame(slot.grade), b.x, b.y)
        // the frame's text area, filled, with the stat and its value over the Set it rolled
        const tx = b.x + TRAIT_TAB + 1
        rect(s, tx, b.y + 2, b.w - TRAIT_TAB - 3, b.h - 4, C.night0)
        drawText(s, `${slot.statName} ${slot.value}`.toUpperCase(), tx + 3, b.y + 4, C.bone1, { shadow: 1 })
        drawText(s, slot.setName.toUpperCase(), tx + 3, b.y + 11, SET_COLORS[slot.set] ?? C.stone3, { shadow: 1 })
        if (hover === `slot:${i}`) ring(s, b)
        // the landing flash: white, then thinning out
        if (since !== null && since < FLASH_FOR) dither(s, b.x, b.y, b.w, b.h, C.white, Math.round(16 * (1 - since / FLASH_FOR)))

        // the lock: a plate with the padlock shut or open
        const lit = hover === `lock:${i}`
        rect(s, lock.x, lock.y, lock.w, lock.h, C.ink)
        rect(s, lock.x + 1, lock.y + 1, lock.w - 2, lock.h - 2, slot.locked ? C.gold0 : lit ? C.night3 : C.night1)
        rect(s, lock.x + 1, lock.y + 1, lock.w - 2, 1, slot.locked ? C.gold1 : C.night3)
        padlock(s, lock.x + (lock.w >> 1), lock.y + (lock.h >> 1), slot.locked)
        if (lit) ring(s, lock)
    }

    /** A slot mid-Roll: its frame running through the grades, stat and Set names flicking past. */
    private drawSpin(s: Surface, i: number, t: number): void {
        const b = rowBox(i)
        const tick = Math.floor(t * 14) + i * 3
        const y = b.y + (tick % 2)
        blit(s, this.frame(TRAIT_GRADES[tick % TRAIT_GRADES.length]!), b.x, y)
        const tx = b.x + TRAIT_TAB + 1
        rect(s, tx, y + 2, b.w - TRAIT_TAB - 3, b.h - 4, C.night0)
        const stat = TRAIT_STATS[Math.floor(t * 10 + i) % TRAIT_STATS.length]!
        const set = TRAIT_SETS[Math.floor(t * 8 + i * 2) % TRAIT_SETS.length]!
        drawText(s, `${stat.name} +??`.toUpperCase(), tx + 3, y + 4, C.stone3, { shadow: 1 })
        drawText(s, set.name.toUpperCase(), tx + 3, y + 11, SET_COLORS[set.id] ?? C.stone3, { shadow: 1 })
        const lock = lockBox(i)
        rect(s, lock.x, lock.y, lock.w, lock.h, C.ink)
        rect(s, lock.x + 1, lock.y + 1, lock.w - 2, lock.h - 2, C.night1)
        padlock(s, lock.x + (lock.w >> 1), lock.y + (lock.h >> 1), false)
    }

    private drawRoll(s: Surface, view: TraitsView, hover: TraitsTarget | null, pressed: boolean, busy: boolean): void {
        const enabled = traitsTargetEnabled(view, 'roll', busy)
        const lit = hover === 'roll'
        plateButton(s, ROLL, '', ROLL_PLATE, enabled, lit, pressed)
        // the price beside the gem that pays it, centred
        const label = view.rerolls === 0 ? 'ALL LOCKED' : `ROLL ${view.rollCost}`
        const lw = textWidth(label) + (view.rerolls === 0 ? 0 : 13)
        const sink = enabled && lit && pressed ? 1 : 0
        const x0 = ROLL.x + ((ROLL.w - lw) >> 1)
        drawText(s, label, x0, ROLL.y + 4 + sink, enabled ? C.white : C.stone2, { shadow: 1 })
        if (view.rerolls > 0) glyph(s, CURRENCY_ICONS.trait_gems!, x0 + lw - 4, ROLL.y + 6 + sink, true)

        const armed = view.armed === 'auto'
        if (autoRolling(view)) plateButton(s, AUTO, 'STOP', STOP_PLATE, true, hover === 'stop', pressed)
        else plateButton(s, AUTO, armed ? 'SURE?' : 'AUTO', armed ? CONFIRM_PLATE : AUTO_PLATE, traitsTargetEnabled(view, 'auto', busy), hover === 'auto' || armed, pressed)
        // the grade it stops at, in that grade's colours
        plateButton(s, GRADE, `${view.autoGrade}+`, TRAIT_GRADE_COLORS[view.autoGrade], !busy, hover === 'grade' || view.gradePickerOpen, pressed && hover === 'grade')
    }

    /** The grades to stop at, opening upward from the chip, the chosen one marked. */
    private drawGradeList(s: Surface, view: TraitsView, hover: TraitsTarget | null): void {
        const b = gradeListBox()
        panel(s, b.x, b.y, b.w, b.h, [C.teal0, C.teal1, C.teal2], C.night1)
        AUTO_GRADES.forEach((grade, i) => {
            const y = b.y + 2 + i * GRADE_ROW_H
            const lit = hover === `grade:${grade}`
            if (lit) rect(s, b.x + 2, y, b.w - 4, GRADE_ROW_H, C.night3)
            if (grade === view.autoGrade) drawText(s, '>', b.x + 4, y + 1, C.gold3, { shadow: 1 })
            drawText(s, `${grade}+`, b.x + 11, y + 1, TRAIT_GRADE_COLORS[grade][2], { shadow: 1 })
        })
    }

    private drawSet(s: Surface, k: number, set: TraitSetView, lit: boolean): void {
        const b = setBox(s.w, k)
        const on = set.tier !== null
        rect(s, b.x, b.y, b.w, b.h, on ? C.night2 : C.night0)
        if (on) rect(s, b.x, b.y, 2, b.h, SET_COLORS[set.id] ?? C.gold2)
        drawText(s, set.name.toUpperCase(), b.x + 4, b.y + 2, on ? SET_COLORS[set.id] ?? C.gold2 : C.stone3, { shadow: 1 })
        // a pip per tier, lit up to the one reached, each with its piece count
        let x = b.x + b.w - 2
        for (let tier = set.tiers.length - 1; tier >= 0; tier--) {
            const label = String(set.tiers[tier]!.pieces)
            const reached = set.tier !== null && tier <= set.tier
            x -= textWidth(label) + 3
            rect(s, x - 1, b.y + 1, textWidth(label) + 2, 7, reached ? SET_COLORS[set.id] ?? C.gold2 : C.night1)
            drawText(s, label, x, b.y + 2, reached ? C.ink : C.stone2, { shadow: 0 })
            x -= 1
        }
        drawText(s, `${set.pieces}`, x - 4, b.y + 2, on ? C.white : C.stone2, { align: 2, shadow: 1 })
        if (lit) ring(s, b, C.steel3)
    }

    private drawSave(s: Surface, view: TraitsView, save: TraitSaveView, hover: TraitsTarget | null, pressed: boolean, busy: boolean): void {
        const b = cardBox(save.index)
        if (!save.unlocked) {
            panel(s, b.x, b.y, b.w, b.h, [C.stone0, C.stone1, C.stone2], C.stone0)
            drawText(s, 'LOCKED', b.x + (b.w >> 1), b.y + 4, C.bone0, { align: 1, shadow: 1 })
            if (!save.price) return
            const target: TraitsTarget = `buy:${save.index}`
            const box = buyButtonBox(save.index)
            const armed = view.armed === target
            const enabled = traitsTargetEnabled(view, target, busy)
            plateButton(s, box, '', armed ? CONFIRM_PLATE : BUY_PLATE, enabled, hover === target || armed, pressed)
            const label = armed ? 'SURE?' : save.price.toUpperCase()
            // the Gem glyph is wider than the font, so it sits a little further out
            const lw = textWidth(label) + (armed ? 0 : 17)
            const sink = enabled && hover === target && pressed ? 1 : 0
            const x0 = box.x + ((box.w - lw) >> 1)
            drawText(s, label, x0, box.y + 3 + sink, enabled ? C.white : C.stone2, { shadow: 1 })
            if (!armed) glyph(s, CURRENCY_ICONS.gems!, x0 + lw - 6, box.y + 5 + sink, true)
            return
        }
        panel(s, b.x, b.y, b.w, b.h)
        drawText(s, `BOARD ${save.index + 1}`, b.x + 4, b.y + 4, C.bone1, { shadow: 1 })
        if (save.grades) {
            // a pip per slot in its grade's colour
            save.grades.forEach((grade, k) => {
                const m = TRAIT_GRADE_COLORS[grade]
                const x = b.x + 4 + k * 10
                rect(s, x, b.y + 11, 9, 5, C.ink)
                rect(s, x + 1, b.y + 12, 7, 3, m[1])
                rect(s, x + 1, b.y + 12, 7, 1, m[2])
            })
        } else {
            drawText(s, 'EMPTY', b.x + 4, b.y + 11, C.stone2, { shadow: 1 })
        }
        for (const [kind, box, plate, label] of [['save', saveButtonBox(save.index), SAVE_PLATE, 'SAVE'], ['load', loadButtonBox(save.index), LOAD_PLATE, 'LOAD']] as const) {
            const target: TraitsTarget = `${kind}:${save.index}`
            const armed = view.armed === target
            plateButton(s, box, armed ? 'SURE?' : label, armed ? CONFIRM_PLATE : plate, traitsTargetEnabled(view, target, busy), hover === target || armed, pressed)
        }
    }

    /** The line along the bottom: what the pointer is over, spelled out. */
    private info(view: TraitsView, hover: TraitsTarget | null): string {
        if (!hover) return view.slots.some(slot => slot) ? 'POINT AT A SLOT, A SET OR A BOARD.' : 'ROLL TO FILL ALL FIVE SLOTS AT ONCE.'
        const [kind, n] = hover.split(':') as [string, string | undefined]
        const i = Number(n)
        switch (kind) {
            case 'roll':
                if (view.rerolls === 0) return 'EVERY SLOT IS LOCKED: UNLOCK ONE TO ROLL.'
                return `ROLL ${view.rerolls} SLOT${view.rerolls === 1 ? '' : 'S'} FOR ${view.rollCost} TRAIT GEMS. EACH LOCK ADDS 5.`
            case 'auto':
                if (view.rerolls === 0) return 'EVERY SLOT IS LOCKED: UNLOCK ONE TO ROLL.'
                return `ROLL UNTIL A SLOT LANDS AT ${view.autoGrade} OR BETTER, ${view.rollCost} TRAIT GEMS A ROLL.`
            case 'grade':
                return n ? `STOP AT ${n} OR BETTER.` : `AUTO ROLL STOPS AT ${view.autoGrade} OR BETTER. PRESS TO CHANGE.`
            case 'slot': {
                const slot = view.slots[i]
                if (!slot) return 'AN EMPTY SLOT. A ROLL FILLS IT.'
                const who = slot.statName === 'Hero Skill DMG' ? 'THE HERO' : slot.statName === 'Champion ATK' ? 'EVERY CHAMPION' : 'THE WHOLE PARTY'
                return `GRADE ${slot.grade}: ${slot.statName} ${slot.value} FOR ${who}, ${slot.setName} SET.`.toUpperCase()
            }
            case 'lock': {
                const slot = view.slots[i]
                if (!slot) return 'NOTHING TO LOCK YET.'
                return slot.locked ? 'LOCKED: A ROLL LEAVES THIS SLOT ALONE. PRESS TO UNLOCK.' : 'LOCK THIS SLOT TO KEEP IT THROUGH ROLLS. FREE.'
            }
            case 'set': {
                const set = view.sets[i]
                if (!set) return ''
                const next = set.tiers[(set.tier ?? -1) + 1]
                if (set.tier === null) return `${set.name.toUpperCase()} AT ${next!.pieces}PC: ${setEffect(set, 0)}`
                return `${set.name.toUpperCase()} ${set.tiers[set.tier]!.pieces}PC: ${setEffect(set, set.tier)}${next ? ` - ${next.pieces}PC +${next.value}` : ''}`
            }
            case 'save':
                if (!view.boardFull) return 'ROLL YOUR TRAITS BEFORE STORING THEM.'
                return `STORE THIS BOARD IN BOARD ${i + 1} FOR ${view.saveCost} TRAIT GEMS${view.saves[i]?.grades ? ', OVER WHAT IT HOLDS' : ''}.`
            case 'load':
                if (!view.saves[i]?.grades) return `BOARD ${i + 1} IS EMPTY.`
                return `LOAD BOARD ${i + 1} OVER YOUR TRAITS FOR ${view.saveCost} TRAIT GEMS.`
            case 'buy':
                return `BUY BOARD ${i + 1} FOR ${view.saves[i]?.price ?? ''} GEMS.`
        }
        return ''
    }
}
