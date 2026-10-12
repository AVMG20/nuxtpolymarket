// The Loadouts scene: every save slot as a card (`ui-art.ts`'s `loadout_cards`), two rows of three.
// An unlocked card shows its name, the whole party's faces with their rows, and a pip per Skill,
// Artifact and Gear piece in its rarity's colour, gold-rimmed and marked ACTIVE while the live
// setup matches it. A locked one shows a padlock, and the next one its gem price, opening the
// prestige shop where it is bought. A card pressed opens its detail: everything the slot holds as
// tiles, with Rename, Save and Apply. A slot a raid points at as its preferred Loadout says so on
// its card and in its detail, so Save never overwrites it blindly (`loadouts.md` §4); the pointers
// themselves are set on each raid's own screen, never here.

import { C, RARITY_COLORS } from './palette'
import { rect, px, arc, blit, type Surface } from './surface'
import { drawText, textWidth } from './font'
import { glyph } from './icon-kit'
import { CURRENCY_ICONS } from './icons-items'
import { panel } from './ui-art'
import { headOf, HEAD } from './demo'
import { collectionTile, plateButton, type Box } from './collections-scene'
import type { SceneBackdrops } from './menu-band'
import type { HqCollectionTab } from '../hero-quest-scenes'

export interface LoadoutEntry { id: string, rarity: string }

export interface LoadoutSlotView {
    slotIndex: number
    /** Not bought yet. */
    locked: boolean
    /** The gem price, on the next slot to buy only. */
    price: string | null
    name: string
    /** Unlocked with nothing saved in it. */
    empty: boolean
    /** The live setup matches what it holds. */
    active: boolean
    party: readonly (LoadoutEntry & { row: 'front' | 'back' })[]
    skills: readonly LoadoutEntry[]
    artifacts: readonly LoadoutEntry[]
    gear: readonly LoadoutEntry[]
    /** The raids (and the Arena) that apply this slot on a fresh engage, by name. */
    usedBy: readonly string[]
}

export interface LoadoutsView {
    slots: readonly LoadoutSlotView[]
    unlocked: number
    max: number
}

export type LoadoutButton = 'rename' | 'save' | 'apply' | 'close'

/** What the pointer is over: a card by slot index, or one of the detail's buttons. */
export type LoadoutsHover = number | LoadoutButton | null

const COLS = 3
const CARD_W = 85
const CARD_H = 66
const GAP = 4
const CARDS_Y = 14
/** Faces overlap a little, so a full party of five fits a card. */
const FACE_PITCH = 16
/** A pip per item: 6px with its ink edge, sharing edges with the next. */
const PIP = 6
const PIP_PITCH = 5
const PANEL = { x: 4, y: 13, w: 264, h: 138 }
const BTN_H = 13
const BTN_PAD = 5
const CLOSE_W = 13
const PITCH = 25

const GOLD = [C.gold0, C.gold1, C.gold2] as const
const STONE = [C.stone0, C.stone1, C.stone2] as const
const PLATES: Readonly<Record<Exclude<LoadoutButton, 'close'>, readonly [number, number, number]>> = {
    rename: [C.stone0, C.stone1, C.stone2],
    save: [C.blue0, C.blue1, C.blue2],
    apply: [C.green0, C.green1, C.green2]
}

function cardBox(w: number, i: number): Box {
    const row = COLS * CARD_W + (COLS - 1) * GAP
    return { x: ((w - row) >> 1) + (i % COLS) * (CARD_W + GAP), y: CARDS_Y + Math.floor(i / COLS) * (CARD_H + GAP), w: CARD_W, h: CARD_H }
}

const inside = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h

/** The slot whose card a point on the view is over, among `count` cards. */
export function loadoutCardAt(w: number, count: number, x: number, y: number): number | null {
    for (let i = 0; i < count; i++) if (inside(cardBox(w, i), x, y)) return i
    return null
}

/** The detail's title row, right to left: close, Apply, Save, Rename. */
function detailButtons(): { id: LoadoutButton, label: string, box: Box }[] {
    const y = PANEL.y + 5
    let right = PANEL.x + PANEL.w - 5
    const out: { id: LoadoutButton, label: string, box: Box }[] = []
    out.push({ id: 'close', label: '', box: { x: right - CLOSE_W, y: y + 1, w: CLOSE_W, h: 11 } })
    right -= CLOSE_W + 6
    for (const [id, label] of [['apply', 'APPLY'], ['save', 'SAVE'], ['rename', 'RENAME']] as const) {
        const bw = textWidth(label) + 2 * BTN_PAD
        right -= bw
        out.push({ id, label, box: { x: right, y, w: bw, h: BTN_H } })
        right -= 3
    }
    return out
}

/** The detail button a point on the view is over. */
export function loadoutButtonAt(x: number, y: number): LoadoutButton | null {
    return detailButtons().find(b => inside(b.box, x, y))?.id ?? null
}

/** Where the rename field goes, in view pixels: over the slot's name in the detail. */
export function renameBox(): Box {
    const rename = detailButtons().find(b => b.id === 'rename')!.box
    return { x: PANEL.x + 6, y: PANEL.y + 5, w: rename.x - PANEL.x - 12, h: BTN_H }
}

/** Whether a detail button can be pressed for `slot`. */
export function loadoutButtonEnabled(id: LoadoutButton, slot: LoadoutSlotView): boolean {
    if (id === 'close' || id === 'save') return true
    if (id === 'rename') return !slot.empty
    return !slot.empty && !slot.active
}

/** `text` cut to fit `max` px in the small font. */
function fit(text: string, max: number): string {
    let t = text
    while (t && textWidth(t) > max) t = t.slice(0, -1)
    return t
}

/** Break text into lines no wider than `max` px, at spaces. */
function wrapText(text: string, max: number): string[] {
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

function padlock(s: Surface, cx: number, cy: number): void {
    arc(s, cx, cy - 2, 4, Math.PI, Math.PI * 2, C.stone3)
    arc(s, cx, cy - 2, 3, Math.PI, Math.PI * 2, C.stone3)
    rect(s, cx - 5, cy - 2, 11, 9, C.stone3)
    rect(s, cx - 4, cy - 1, 9, 1, C.bone1)
    px(s, cx, cy + 2, C.ink)
    px(s, cx, cy + 3, C.ink)
}

export class LoadoutsScene {
    /** Champion faces, cropped once each. */
    private readonly heads = new Map<string, Surface>()

    constructor(private readonly backdrops: SceneBackdrops) {}

    /** The cards, or the open slot's detail. `pressed` sinks the hovered button; `busy` holds them all. */
    render(t: number, view: LoadoutsView, hover: LoadoutsHover, pressed: boolean, detail: number | null, busy: boolean): Surface {
        const s = this.backdrops.render('loadouts', t, false)
        drawText(s, 'LOADOUTS', 6, 4, C.gold2, { shadow: 1 })
        drawText(s, `${view.unlocked} OF ${view.max} SLOTS`, s.w - 6, 4, C.bone0, { align: 2, shadow: 1 })
        const open = detail === null ? undefined : view.slots.find(slot => slot.slotIndex === detail && !slot.locked)
        if (open) {
            this.drawDetail(s, open, hover, pressed, busy)
            return s
        }
        view.slots.forEach((slot, i) => this.drawCard(s, cardBox(s.w, i), slot, hover === i))
        return s
    }

    private head(id: string): Surface {
        let h = this.heads.get(id)
        if (!h) {
            h = headOf(`champion/${id}`)
            this.heads.set(id, h)
        }
        return h
    }

    private drawCard(s: Surface, b: Box, slot: LoadoutSlotView, lit: boolean): void {
        const cx = b.x + (b.w >> 1)
        if (slot.locked) {
            panel(s, b.x, b.y, b.w, b.h, STONE, C.stone0)
            if (lit) this.ring(s, b)
            drawText(s, 'LOCKED', cx, b.y + 5, C.bone0, { align: 1, shadow: 1 })
            padlock(s, cx, b.y + 28)
            if (slot.price) {
                // the next slot's price, in gems, and where it is bought
                const pw = textWidth(slot.price)
                glyph(s, CURRENCY_ICONS.gems!, cx - (pw >> 1) - 5, b.y + 47, true)
                drawText(s, slot.price, cx - (pw >> 1) + 4, b.y + 45, C.bone1, { shadow: 1 })
                drawText(s, 'IN THE PRESTIGE SHOP', cx, b.y + 56, C.stone3, { align: 1, shadow: 1 })
            }
            return
        }
        panel(s, b.x, b.y, b.w, b.h, slot.active ? GOLD : undefined)
        if (lit) this.ring(s, b)
        const aw = slot.active ? textWidth('ACTIVE') + 4 : 0
        drawText(s, fit(slot.name.toUpperCase(), b.w - 8 - aw), b.x + 4, b.y + 4, slot.active ? C.gold3 : C.bone1, { shadow: 1 })
        if (slot.active) drawText(s, 'ACTIVE', b.x + b.w - 4, b.y + 4, C.gold2, { align: 2, shadow: 1 })
        if (slot.empty) {
            drawText(s, 'EMPTY', cx, b.y + 30, C.stone2, { align: 1, shadow: 1 })
            return
        }
        // the whole party, each face carrying its row
        if (!slot.party.length) drawText(s, 'NO PARTY', b.x + 4, b.y + 19, C.stone2, { shadow: 1 })
        slot.party.forEach((c, k) => {
            const hx = b.x + 4 + k * FACE_PITCH
            blit(s, this.head(c.id), hx, b.y + 12)
            drawText(s, c.row === 'front' ? 'F' : 'B', hx + HEAD - 4, b.y + 12, c.row === 'front' ? C.red3 : C.blue2, { shadow: 2 })
        })
        // the raids that apply it, under everything else
        if (slot.usedBy.length) {
            const by = slot.usedBy.length === 1 ? `FOR ${slot.usedBy[0]!.toUpperCase()}` : `FOR ${slot.usedBy.length} RAIDS`
            drawText(s, fit(by, b.w - 8), b.x + 4, b.y + 59, C.blue2, { shadow: 1 })
        }
        // a pip per item in its rarity's colour: how many, and how good
        const rows: [string, readonly LoadoutEntry[]][] = [['SKILLS', slot.skills], ['ARTIFACTS', slot.artifacts], ['GEAR', slot.gear]]
        rows.forEach(([label, entries], k) => {
            const y = b.y + 34 + k * 9
            drawText(s, label, b.x + 4, y, C.stone3, { shadow: 1 })
            const px0 = b.x + 42
            if (!entries.length) drawText(s, '-', px0, y, C.stone2, { shadow: 1 })
            entries.forEach((e, i) => {
                const m = RARITY_COLORS[e.rarity] ?? RARITY_COLORS.common!
                const x = px0 + i * PIP_PITCH
                rect(s, x, y - 1, PIP, PIP, C.ink)
                rect(s, x + 1, y, PIP - 2, PIP - 2, m[1])
                rect(s, x + 1, y, PIP - 2, 1, m[2])
            })
        })
    }

    /** A white ring round a hovered card. */
    private ring(s: Surface, b: Box): void {
        rect(s, b.x - 1, b.y - 1, b.w + 2, 1, C.white)
        rect(s, b.x - 1, b.y + b.h, b.w + 2, 1, C.white)
        rect(s, b.x - 1, b.y, 1, b.h, C.white)
        rect(s, b.x + b.w, b.y, 1, b.h, C.white)
    }

    private drawDetail(s: Surface, slot: LoadoutSlotView, hover: LoadoutsHover, pressed: boolean, busy: boolean): void {
        panel(s, PANEL.x, PANEL.y, PANEL.w, PANEL.h, slot.active ? GOLD : undefined)
        const name = renameBox()
        const nw = drawText(s, fit(slot.name.toUpperCase(), name.w - 34), name.x, name.y + 3, slot.active ? C.gold3 : C.white, { shadow: 1 })
        if (slot.active) drawText(s, 'ACTIVE', name.x + nw + 6, name.y + 3, C.gold2, { shadow: 1 })

        for (const b of detailButtons()) {
            if (b.id === 'close') {
                const lit = hover === 'close'
                rect(s, b.box.x, b.box.y, b.box.w, b.box.h, C.ink)
                rect(s, b.box.x + 1, b.box.y + 1, b.box.w - 2, b.box.h - 2, lit ? C.red2 : C.red1)
                rect(s, b.box.x + 1, b.box.y + 1, b.box.w - 2, 1, lit ? C.red3 : C.red2)
                for (let i = 0; i < 5; i++) {
                    rect(s, b.box.x + 4 + i, b.box.y + 3 + i, 1, 1, C.white)
                    rect(s, b.box.x + 8 - i, b.box.y + 3 + i, 1, 1, C.white)
                }
                continue
            }
            const enabled = loadoutButtonEnabled(b.id, slot) && !busy
            plateButton(s, b.box, b.label, PLATES[b.id], enabled, hover === b.id, pressed)
        }

        if (slot.empty) {
            drawText(s, 'NOTHING SAVED HERE YET.', PANEL.x + 10, PANEL.y + 32, C.stone3, { shadow: 1 })
            drawText(s, 'SAVE STORES YOUR PARTY, FORMATION, SKILLS,', PANEL.x + 10, PANEL.y + 42, C.stone3, { shadow: 1 })
            drawText(s, 'ARTIFACTS AND GEAR AS THEY ARE NOW.', PANEL.x + 10, PANEL.y + 49, C.stone3, { shadow: 1 })
            return
        }

        // what it holds, as the Collections tiles: the party and skills side by side, then artifacts, then the six gear slots
        const left = PANEL.x + 8
        const right = PANEL.x + (PANEL.w >> 1) + 4
        const rows = [PANEL.y + 23, PANEL.y + 59, PANEL.y + 95]
        const party = slot.party.map(c => ({ ...c, owned: true, mark: c.row === 'front' ? 'F' as const : 'B' as const }))
        this.drawGroup(s, left, rows[0]!, 'PARTY', 'champions', party)
        this.drawGroup(s, right, rows[0]!, 'SKILLS', 'skills', slot.skills.map(e => ({ ...e, owned: true, mark: null })))
        this.drawGroup(s, left, rows[1]!, 'ARTIFACTS', 'artifacts', slot.artifacts.map(e => ({ ...e, owned: true, mark: null })))
        this.drawGroup(s, left, rows[2]!, 'GEAR', 'gear', slot.gear.map(e => ({ ...e, owned: true, mark: null })))

        // beside the Artifacts, the raids that apply it: what Save would change for them
        if (slot.usedBy.length) {
            drawText(s, 'APPLIED BY', right, rows[1]!, C.gold2, { shadow: 1 })
            wrapText(slot.usedBy.map(n => n.toUpperCase()).join(', '), PANEL.x + PANEL.w - 6 - right).slice(0, 3)
                .forEach((line, k) => drawText(s, line, right, rows[1]! + 9 + k * 8, C.blue2, { shadow: 1 }))
        }
    }

    private drawGroup(s: Surface, x: number, y: number, label: string, tab: HqCollectionTab, entries: readonly (LoadoutEntry & { owned: boolean, mark: 'F' | 'B' | null })[]): void {
        const lw = drawText(s, label, x, y, C.gold2, { shadow: 1 })
        drawText(s, String(entries.length), x + lw + 4, y, C.bone0, { shadow: 1 })
        if (!entries.length) {
            drawText(s, 'NONE', x, y + 17, C.stone2, { shadow: 1 })
            return
        }
        entries.forEach((e, k) => blit(s, collectionTile(tab, e), x + k * PITCH, y + 8))
    }
}
