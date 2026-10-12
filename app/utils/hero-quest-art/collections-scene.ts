// The Collections scene: a tab per gacha over the encyclopedia list (`ui-art.ts`'s
// `encyclopedia_list`), every entry of the open roster as a rarity-rimmed tile. Owned entries show
// their icon, or a Champion's portrait; the rest stay in place as `?` tiles, so the grid reads as
// a checklist with the gaps where they will go. A tile pressed opens the encyclopedia detail
// (`encyclopedia_detail`) in the grid's place: the entry shown large, what it does, the gacha's
// Essence, and the buttons that equip and craft it. Equip on a Champion, Skill or Artifact opens
// the picker over the detail: the formation or the slots, to pick where it goes or what it replaces.

import { C, CLEAR, RARITY_COLORS } from './palette'
import { Surface, rect, blit, dither, ditherEllipse } from './surface'
import { drawText, textWidth, type FontName } from './font'
import { glyph, type Glyph } from './icon-kit'
import { ARTIFACT_ICONS, CURRENCY_ICONS, GEAR_ICONS } from './icons-items'
import { TRAINING_SKILL_ICONS } from './icons-abilities'
import { panel } from './ui-art'
import { ARROW_H, ARROW_W, drawBobArrow } from './feedback'
import { headOf, HEAD } from './demo'
import { artById } from './catalog'
import type { SceneBackdrops } from './menu-band'
import { HQ_COLLECTION_TABS, HQ_COLLECTION_TAB_LABELS, type HqCollectionTab } from '../hero-quest-scenes'
import type { EquipPicker } from '../hero-quest-equip'

export interface CollectionTile {
    id: string
    rarity: string
    owned: boolean
    name: string
    /** The system's second axis, spelled for a human: "Vanguard", "Weapon", "Active". */
    subtitle: string
    star: number
    level: number
    /** Copies merged toward the next level, and how many it takes; `dupesToLevelUp` is null once maxed. */
    dupeProgress: number
    dupesToLevelUp: number | null
    maxed: boolean
    /** The letter in the tile's corner: E equipped, F or B for a Champion's row; null when idle. */
    mark: TileMark | null
    /** Owned Gear that would beat what its slot wears now: a green arrow bobs in the tile's corner. */
    upgrade?: boolean
    /** What it gives owned, and what it gives put to work, each saying whether it pays right now. */
    sections: readonly CollectionSection[]
    /** The detail's buttons that put it to work, left to right. */
    actions: readonly CollectionAction[]
    /** Where Equip can put it, opened over the detail; null where Equip acts at once (Gear). */
    picker: EquipPicker | null
    /** The craft button, its cost spelled out; null once the entry is maxed. */
    craft: { cost: string, enabled: boolean } | null
}

export type TileMark = 'E' | 'F' | 'B'

export type CollectionActionId = 'equip'

/** A detail button: Equip, which opens the picker, or puts Gear on at once. */
export interface CollectionAction {
    id: CollectionActionId
    label: string
    enabled: boolean
    /** The state it would set is the one already held (Gear worn now): shown pressed in. */
    current?: boolean
}

/** One effect line, with how much it would move against what is worn now (Gear in the same slot). */
export type CollectionLine = string | { text: string, delta: string, up: boolean }

/** One block of the detail: a condition ("In collection", "Equipped"), who it reaches, and what it gives. */
export interface CollectionSection {
    title: string
    /** Who it reaches: "Hero", "Whole party". */
    scope: string
    /** Paying right now: drawn bright and marked, where the others are dimmed. */
    active: boolean
    lines: readonly CollectionLine[]
}

/** What the Collections scene draws: the open tab, its roster, and that gacha's Essence. */
export interface CollectionsView {
    tab: HqCollectionTab
    entries: readonly CollectionTile[]
    essence: string
    /** The Hero's class, for its face in a Champion's picker. */
    heroClassId: string | null
}

export type DetailButton = CollectionActionId | 'craft'

/** A press in the picker: a spot by row and place, the x that frees one, its remove button, or Cancel. */
export type PickerTarget = `spot:${number}:${number}` | `unset:${number}:${number}` | 'remove' | 'cancel'

/** What the pointer is over: a tab, a tile by index, the detail's close button or one of its buttons, or the picker's. */
export type CollectionsHover = HqCollectionTab | number | 'close' | DetailButton | PickerTarget | null

const TAB_Y = 2
const TAB_H = 13
const TAB_W = 64
const TAB_GAP = 2
const PANEL_X = 4
const PANEL_Y = TAB_Y + TAB_H - 1
/** Ten by five: room for the biggest roster, 48. */
const COLS = 10
const ROWS = 5
const TILE = 24
const PITCH = 25
/** The detail's showcase box, its close button and its text lines. */
const BOX_W = 84
const CLOSE_W = 13
const CLOSE_H = 11
const LINE_H = 7
const SECTION_GAP = 4
/** Room the Essence readout keeps on the footer's bottom row. */
const ESSENCE_W = 34
const BTN_H = 13
const BTN_PAD = 5
/** Where the letter that marks a tile sits: its left edge in from the tile's right, and its top. */
const MARK_X = 6
const MARK_Y = 3

const ICONS: Readonly<Record<Exclude<HqCollectionTab, 'champions'>, Readonly<Record<string, Glyph>>>> = {
    gear: GEAR_ICONS,
    skills: TRAINING_SKILL_ICONS,
    artifacts: ARTIFACT_ICONS
}

const ESSENCE_ICONS: Readonly<Record<HqCollectionTab, Glyph>> = {
    gear: CURRENCY_ICONS.essence_gear!,
    champions: CURRENCY_ICONS.essence_champion!,
    skills: CURRENCY_ICONS.essence_skill!,
    artifacts: CURRENCY_ICONS.essence_artifact!
}

const MARK_COLORS: Readonly<Record<TileMark, number>> = { E: C.gold2, F: C.red3, B: C.blue2 }

/** Each button's plate: the colour of what it does, Front and Back matching their tile letters. */
const PLATES: Readonly<Record<DetailButton, readonly [number, number, number]>> = {
    equip: [C.green0, C.green1, C.green2],
    craft: [C.purple0, C.purple1, C.purple2]
}
const REMOVE_PLATE = [C.red0, C.red1, C.red2] as const
const CANCEL_PLATE = [C.stone0, C.stone1, C.stone2] as const

const NOT_FOUND = ['NOT FOUND YET.', 'PULL IT IN THE GACHA, OR CRAFT IT', 'FROM ESSENCE.']

function tabX(w: number, i: number): number {
    const row = HQ_COLLECTION_TABS.length * TAB_W + (HQ_COLLECTION_TABS.length - 1) * TAB_GAP
    return ((w - row) >> 1) + i * (TAB_W + TAB_GAP)
}

function panelRect(w: number, h: number): { x: number, y: number, w: number, h: number } {
    return { x: PANEL_X, y: PANEL_Y, w: w - 2 * PANEL_X, h: h - PANEL_Y - 2 }
}

function gridOrigin(w: number, h: number): { x: number, y: number } {
    const p = panelRect(w, h)
    return { x: p.x + ((p.w - (COLS * PITCH - 1)) >> 1), y: p.y + ((p.h - (ROWS * PITCH - 1)) >> 1) }
}

function closeBox(w: number, h: number): { x: number, y: number } {
    const p = panelRect(w, h)
    return { x: p.x + p.w - CLOSE_W - 5, y: p.y + 5 }
}

/** The tab a point on the view is over, in the view's own pixels. */
export function collectionTabAt(w: number, x: number, y: number): HqCollectionTab | null {
    if (y < TAB_Y || y >= PANEL_Y) return null
    for (let i = 0; i < HQ_COLLECTION_TABS.length; i++) {
        const x0 = tabX(w, i)
        if (x >= x0 && x < x0 + TAB_W) return HQ_COLLECTION_TABS[i]!
    }
    return null
}

/** The index of the tile a point on the view is over, among `count` tiles. */
export function collectionTileAt(w: number, h: number, count: number, x: number, y: number): number | null {
    const g = gridOrigin(w, h)
    const col = Math.floor((x - g.x) / PITCH)
    const row = Math.floor((y - g.y) / PITCH)
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null
    // the pixel between tiles is no tile
    if (x - g.x - col * PITCH >= TILE || y - g.y - row * PITCH >= TILE) return null
    const i = row * COLS + col
    return i < count ? i : null
}

/** Whether a point on the view is on the detail's close button. */
export function onDetailClose(w: number, h: number, x: number, y: number): boolean {
    const b = closeBox(w, h)
    return x >= b.x && x < b.x + CLOSE_W && y >= b.y && y < b.y + CLOSE_H
}

interface Box { x: number, y: number, w: number, h: number }

function craftLabel(cost: string): string {
    return `CRAFT ${cost.toUpperCase()}`
}

interface FooterButton { id: DetailButton, label: string, enabled: boolean, current: boolean, box: Box }

/**
 * The detail's footer: the Essence on its left and the buttons right-aligned, craft before the
 * actions. When they do not fit on one row (a Champion's Front, Back and Bench), the actions take
 * a row of their own above.
 */
function detailFooter(w: number, h: number, e: CollectionTile): { x: number, y: number, top: number, buttons: FooterButton[] } {
    const p = panelRect(w, h)
    const x = p.x + 6 + BOX_W + 8
    const right = p.x + p.w - 6
    const y = p.y + p.h - 6 - BTN_H
    const width = (label: string) => textWidth(label) + 2 * BTN_PAD
    const actions = e.actions.map(a => ({ id: a.id as DetailButton, label: a.label.toUpperCase(), enabled: a.enabled, current: !!a.current }))
    const craft = e.craft ? [{ id: 'craft' as DetailButton, label: craftLabel(e.craft.cost), enabled: e.craft.enabled, current: false }] : []
    const span = (row: { label: string }[]) => row.reduce((sum, b) => sum + width(b.label) + 3, 0)
    // the Essence readout needs about this much on the bottom row's left
    const oneRow = span([...craft, ...actions]) <= right - x - ESSENCE_W
    // top row first: the actions over craft, which stays beside the Essence it spends
    const rows = oneRow ? [[...craft, ...actions]] : [actions, craft]
    const buttons: FooterButton[] = []
    rows.forEach((row, r) => {
        const ry = y - (rows.length - 1 - r) * (BTN_H + 3)
        let bx = right - span(row) + 3
        for (const b of row) {
            const bw = width(b.label)
            buttons.push({ ...b, box: { x: bx, y: ry, w: bw, h: BTN_H } })
            bx += bw + 3
        }
    })
    return { x, y, top: y - (rows.length - 1) * (BTN_H + 3), buttons }
}

/** The detail button a point on the view is over, for the entry shown, and whether it can be pressed. */
export function detailButtonAt(w: number, h: number, e: CollectionTile, x: number, y: number): { id: DetailButton, enabled: boolean } | null {
    const hit = detailFooter(w, h, e).buttons.find(({ box: b }) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)
    return hit ? { id: hit.id, enabled: hit.enabled && !hit.current } : null
}

/** The picker's panel, its spots by row, and its buttons, centred over the detail. */
interface PickerLayout {
    box: Box
    title: { x: number, y: number }
    labels: { x: number, y: number, text: string }[]
    spots: { r: number, i: number, box: Box }[]
    remove: Box | null
    cancel: Box
    /** The slots-unlocked hint, on the buttons' row at the left. */
    hint: { x: number, y: number }
}

const PICKER_PAD = 7
/** The x in a held spot's top-right corner, inside the tile. */
const UNSET = 9

function unsetBox(b: Box): Box {
    return { x: b.x + TILE - UNSET, y: b.y, w: UNSET, h: UNSET }
}
/** The label column a formation's rows take, before their spots. */
const PICKER_LABEL_W = 26

function pickerLayout(w: number, h: number, picker: EquipPicker): PickerLayout {
    const p = panelRect(w, h)
    const width = (label: string) => textWidth(label) + 2 * BTN_PAD
    const labelled = picker.rows.some(row => row.label !== null)
    const labelW = labelled ? PICKER_LABEL_W : 0
    const most = Math.max(...picker.rows.map(row => row.spots.length))
    const removeLabel = picker.remove?.toUpperCase() ?? null
    const buttonsW = width('CANCEL') + (removeLabel ? width(removeLabel) + 3 : 0)
    const spotsW = labelW + most * PITCH - 1
    // the hint keeps a gap from the buttons it shares the row with
    const footW = textWidth(picker.hint.toUpperCase()) + 8 + buttonsW
    const boxW = Math.max(textWidth(picker.title.toUpperCase()), spotsW, footW) + 2 * PICKER_PAD
    const boxH = PICKER_PAD + 7 + 6 + picker.rows.length * PITCH - 1 + 6 + BTN_H + PICKER_PAD
    const box = { x: p.x + ((p.w - boxW) >> 1), y: p.y + ((p.h - boxH) >> 1), w: boxW, h: boxH }
    const top = box.y + PICKER_PAD + 13
    // the spots centred under the title, their labels on the left
    const x0 = box.x + ((boxW - spotsW) >> 1)
    const labels: PickerLayout['labels'] = []
    const spots: PickerLayout['spots'] = []
    picker.rows.forEach((row, r) => {
        const y = top + r * PITCH
        if (row.label) labels.push({ x: x0, y: y + 9, text: row.label.toUpperCase() })
        row.spots.forEach((_, i) => spots.push({ r, i, box: { x: x0 + labelW + i * PITCH, y, w: TILE, h: TILE } }))
    })
    // the buttons right-aligned along the bottom, Cancel last
    const by = box.y + boxH - PICKER_PAD - BTN_H
    const cancel = { x: box.x + boxW - PICKER_PAD - width('CANCEL'), y: by, w: width('CANCEL'), h: BTN_H }
    const remove = removeLabel ? { x: cancel.x - 3 - width(removeLabel), y: by, w: width(removeLabel), h: BTN_H } : null
    return { box, title: { x: box.x + (boxW >> 1), y: box.y + PICKER_PAD }, labels, spots, remove, cancel, hint: { x: box.x + PICKER_PAD, y: by + 4 } }
}

const inBox = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h

/**
 * What a point is over in the picker: a spot that can be taken, its remove button or Cancel; and
 * `outside` off its panel, which shuts it. Null on the panel but nothing pressable.
 */
export function pickerTargetAt(w: number, h: number, picker: EquipPicker, x: number, y: number): PickerTarget | 'outside' | null {
    const l = pickerLayout(w, h, picker)
    if (!inBox(l.box, x, y)) return 'outside'
    if (inBox(l.cancel, x, y)) return 'cancel'
    if (l.remove && inBox(l.remove, x, y)) return 'remove'
    // the x sits on its spot, so it is tried first
    const unset = l.spots.find(sp => picker.rows[sp.r]!.spots[sp.i]!.unset && inBox(unsetBox(sp.box), x, y))
    if (unset) return `unset:${unset.r}:${unset.i}`
    const spot = l.spots.find(sp => inBox(sp.box, x, y))
    return spot && picker.rows[spot.r]!.spots[spot.i]!.enabled ? `spot:${spot.r}:${spot.i}` : null
}

/** A caret for a stat difference: green and pointing up for a gain, red and down for a loss. */
function caret(s: Surface, x: number, y: number, up: boolean): void {
    const c = up ? C.green3 : C.red3
    for (let i = 0; i < 3; i++) {
        const row = up ? i : 2 - i
        rect(s, x + 2 - i, y + 1 + row, 1 + 2 * i, 1, c)
    }
}

/** A plate button: inked, lit on hover, sunk a pixel when pressed, dark when it cannot be pressed. */
function button(s: Surface, b: Box, label: string, plate: readonly [number, number, number], enabled: boolean, lit: boolean, down: boolean, current = false): void {
    const sink = enabled && lit && down ? 1 : 0
    rect(s, b.x, b.y, b.w, b.h, C.ink)
    if (current) {
        // the state already held: sunk into its own colour, and not a button
        rect(s, b.x + 1, b.y + 2, b.w - 2, b.h - 3, plate[0])
        rect(s, b.x + 1, b.y + 1, b.w - 2, 1, C.ink)
        drawText(s, label, b.x + (b.w >> 1), b.y + 5, plate[2], { align: 1, shadow: 1 })
        return
    }
    if (!enabled) {
        rect(s, b.x + 1, b.y + 1, b.w - 2, b.h - 2, C.night2)
        drawText(s, label, b.x + (b.w >> 1), b.y + 4, C.stone2, { align: 1, shadow: 1 })
        return
    }
    rect(s, b.x + 1, b.y + 1 + sink, b.w - 2, b.h - 2 - sink, lit ? plate[2] : plate[1])
    rect(s, b.x + 1, b.y + 1 + sink, b.w - 2, 1, lit ? C.white : plate[2])
    if (!sink) rect(s, b.x + 1, b.y + b.h - 2, b.w - 2, 1, plate[0])
    drawText(s, label, b.x + (b.w >> 1), b.y + 4 + sink, C.white, { align: 1, shadow: 1 })
}

/** Break text into lines no wider than `max` px. */
function wrap(text: string, max: number, font: FontName = 'small'): string[] {
    const out: string[] = []
    let line = ''
    for (const word of text.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word
        if (line && textWidth(next, font) > max) {
            out.push(line)
            line = word
        } else line = next
    }
    if (line) out.push(line)
    return out
}

/** Copy `src` onto `dst` at `k`× its size, its top-left at (x, y), clipped to `clip`. */
function blitScaled(dst: Surface, src: Surface, x: number, y: number, k: number, clip: { x: number, y: number, w: number, h: number }): void {
    for (let sy = 0; sy < src.h; sy++) {
        for (let sx = 0; sx < src.w; sx++) {
            const c = src.data[sy * src.w + sx]!
            if (c === CLEAR) continue
            for (let dy = 0; dy < k; dy++) {
                const py = y + sy * k + dy
                if (py < clip.y || py >= clip.y + clip.h) continue
                for (let dx = 0; dx < k; dx++) {
                    const px = x + sx * k + dx
                    if (px >= clip.x && px < clip.x + clip.w) dst.data[py * dst.w + px] = c
                }
            }
        }
    }
}

/** Each tile drawn once: a glyph's lighting pass and a portrait's crop are too dear to redo every frame. */
const TILES = new Map<string, Surface>()

/**
 * A 24px tile for one entry: its rarity rim, its icon or a Champion's portrait (`?` when not
 * owned), and its corner letter. Shared with the Loadouts scene, so an entry reads the same there.
 */
export function collectionTile(tab: HqCollectionTab, e: { id: string, rarity: string, owned: boolean, mark: TileMark | null }): Surface {
    const mark = e.owned ? e.mark : null
    const key = `${tab}:${e.id}:${e.owned ? 1 : 0}:${mark ?? ''}`
    const known = TILES.get(key)
    if (known) return known
    const s = new Surface(TILE, TILE, 0, 0)
    const m = RARITY_COLORS[e.rarity] ?? RARITY_COLORS.common!
    rect(s, 0, 0, TILE, TILE, C.ink)
    rect(s, 1, 1, TILE - 2, TILE - 2, e.owned ? m[1] : m[0])
    rect(s, 2, 2, TILE - 4, TILE - 4, C.night0)
    if (!e.owned) drawText(s, '?', TILE >> 1, 7, C.stone2, { scale: 2, align: 1, shadow: 1 })
    else if (tab === 'champions') blit(s, headOf(`champion/${e.id}`), (TILE - HEAD) >> 1, (TILE - HEAD) >> 1)
    else {
        const g = ICONS[tab][e.id]
        if (g) glyph(s, g, TILE >> 1, TILE >> 1)
    }
    // the letter in the top-right corner, outlined in ink so it holds on any icon
    if (mark) drawText(s, mark, TILE - MARK_X, MARK_Y, MARK_COLORS[mark], { shadow: 2 })
    TILES.set(key, s)
    return s
}

/** The plate button the detail views share; exported for the Loadouts scene. */
export { button as plateButton, PLATES as BUTTON_PLATES, type Box }

export class CollectionsScene {
    /** Champions' idle frames, drawn once each as the detail first shows them. */
    private readonly idles = new Map<string, Surface[]>()
    private readonly icon = new Surface(TILE, TILE, 0, 0)
    /** The Hero's face per class, for the picker. */
    private readonly heads = new Map<string, Surface>()

    constructor(private readonly backdrops: SceneBackdrops) {}

    /**
     * The tabs, and the open roster's grid, or the entry `detail` names in its place. `pressed` sinks
     * the hovered button; `busy` holds the detail's buttons while a request is out. `picking` lays
     * the open entry's picker over its detail.
     */
    render(t: number, view: CollectionsView, hover: CollectionsHover, pressed: boolean, detail: string | null, busy: boolean, picking = false): Surface {
        const { tab, entries } = view
        const s = this.backdrops.render('collections', t, false)
        const p = panelRect(s.w, s.h)
        panel(s, p.x, p.y, p.w, p.h)
        const tabHover = HQ_COLLECTION_TABS.find(id => id === hover) ?? null
        for (let i = 0; i < HQ_COLLECTION_TABS.length; i++) this.drawTab(s, i, HQ_COLLECTION_TABS[i]!, tab, entries, tabHover)
        const open = detail === null ? undefined : entries.find(e => e.id === detail)
        if (open) {
            this.drawDetail(s, t, view, open, picking ? null : hover, pressed, busy)
            if (picking && open.picker) this.drawPicker(s, view, open.picker, hover, pressed, busy)
            return s
        }
        const g = gridOrigin(s.w, s.h)
        for (let i = 0; i < entries.length && i < COLS * ROWS; i++) {
            const x = g.x + (i % COLS) * PITCH
            const y = g.y + Math.floor(i / COLS) * PITCH
            blit(s, collectionTile(tab, entries[i]!), x, y)
            if (entries[i]!.upgrade) drawBobArrow(s, x + TILE - ARROW_W - 1, y + TILE - ARROW_H - 2, true, t)
            if (hover === i) {
                // lit: a white ring round the tile's own rim
                rect(s, x - 1, y - 1, TILE + 2, 1, C.white)
                rect(s, x - 1, y + TILE, TILE + 2, 1, C.white)
                rect(s, x - 1, y, 1, TILE, C.white)
                rect(s, x + TILE, y, 1, TILE, C.white)
            }
        }
        return s
    }

    private drawTab(s: Surface, i: number, id: HqCollectionTab, open: HqCollectionTab, entries: readonly CollectionTile[], hover: HqCollectionTab | null): void {
        const x = tabX(s.w, i)
        const on = id === open
        // the open tab runs into the panel: its fill covers the panel's top edge under it
        rect(s, x, TAB_Y, TAB_W, TAB_H + (on ? 1 : 0), C.ink)
        rect(s, x + 1, TAB_Y + 1, TAB_W - 2, TAB_H - (on ? 0 : 2), on ? C.night1 : hover === id ? C.night2 : C.night0)
        rect(s, x + 1, TAB_Y + 1, TAB_W - 2, 1, on ? C.night3 : C.night1)
        const label = HQ_COLLECTION_TAB_LABELS[id].toUpperCase()
        const owned = on ? entries.filter(e => e.owned).length : 0
        const text = on ? `${label} ${owned}/${entries.length}` : label
        drawText(s, text, x + (TAB_W >> 1), TAB_Y + 4, on ? C.gold2 : hover === id ? C.bone1 : C.stone3, { align: 1, shadow: 1 })
    }

    /** The detail, laid out as `encyclopedia_detail`: a showcase box on the left, what it is and does on the right. */
    private drawDetail(s: Surface, t: number, view: CollectionsView, e: CollectionTile, hover: CollectionsHover, pressed: boolean, busy: boolean): void {
        const tab = view.tab
        const p = panelRect(s.w, s.h)
        const m = RARITY_COLORS[e.rarity] ?? RARITY_COLORS.common!
        const box = { x: p.x + 6, y: p.y + 6, w: BOX_W, h: p.h - 12 }
        panel(s, box.x, box.y, box.w, box.h, e.owned ? m : [C.night0, C.night1, C.night2], C.night2)
        const inner = { x: box.x + 2, y: box.y + 2, w: box.w - 4, h: box.h - 4 }
        const cx = box.x + (box.w >> 1)
        const floor = box.y + box.h - 22
        ditherEllipse(s, cx, floor, 22, 4, C.night0, 10)
        if (e.owned) {
            // under the showcase: a craft or a pull of an owned copy adds one copy toward the next level
            const ly = floor + 7
            if (e.maxed || e.dupesToLevelUp === null) drawText(s, 'MAX LEVEL', cx, ly + 3, C.gold2, { align: 1, shadow: 1 })
            else {
                drawText(s, `COPIES ${e.dupeProgress}/${e.dupesToLevelUp}`, cx, ly, C.bone0, { align: 1, shadow: 1 })
                const bw = box.w - 16
                const bx = cx - (bw >> 1)
                const fill = Math.round((bw - 2) * Math.min(1, e.dupeProgress / e.dupesToLevelUp))
                rect(s, bx, ly + 7, bw, 5, C.ink)
                rect(s, bx + 1, ly + 8, bw - 2, 3, C.night0)
                rect(s, bx + 1, ly + 8, fill, 3, C.green2)
                rect(s, bx + 1, ly + 8, fill, 1, C.green3)
            }
        }
        // the big font has no '?': the small one, scaled up
        if (!e.owned) drawText(s, '?', cx, box.y + (box.h >> 1) - 20, C.stone2, { scale: 6, align: 1, shadow: 1 })
        else if (tab === 'champions') {
            const frame = this.idleFrame(e.id, t)
            if (frame) blitScaled(s, frame, cx - frame.ax * 2, floor - frame.ay * 2, 2, inner)
        } else {
            const g = ICONS[tab][e.id]
            this.icon.clear()
            if (g) glyph(this.icon, g, TILE >> 1, TILE >> 1)
            blitScaled(s, this.icon, cx - TILE, floor - 2 * TILE - 4, 2, inner)
        }

        const x = box.x + box.w + 8
        const right = p.x + p.w - 6
        let y = p.y + 8
        if (e.owned) {
            // a long name takes two lines rather than running under the close button
            for (const line of wrap(e.name.toUpperCase(), right - x - CLOSE_W - 4, 'big')) {
                drawText(s, line, x, y, C.white, { font: 'big', shadow: 1 })
                y += 10
            }
        } else {
            drawText(s, '???', x, y, C.stone3, { scale: 2, shadow: 1 })
            y += 12
        }
        y += 1
        // rarity, type and star/level share a row, so the effect lines keep their room
        let rx = x + drawText(s, e.rarity.toUpperCase(), x, y, m[2], { shadow: 1 }) + 4
        rx += drawText(s, e.subtitle.toUpperCase(), rx, y, C.bone1, { shadow: 1 }) + 8
        if (e.owned) drawText(s, `${e.star} STAR  LV ${e.level}`, rx, y, C.bone0, { shadow: 1 })
        y += 9
        rect(s, x, y + 1, right - x, 1, C.night3)
        y += 6
        const f = detailFooter(s.w, s.h, e)
        const bottom = f.top - 3
        if (!e.owned) {
            for (const line of NOT_FOUND) {
                drawText(s, line, x, y, C.stone3, { shadow: 1 })
                y += LINE_H
            }
        } else {
            for (const section of e.sections) {
                if (y + LINE_H > bottom) break
                // the condition and who it reaches, and ACTIVE on the right while it pays
                const head = `${section.title} - ${section.scope}`.toUpperCase()
                drawText(s, head, x, y, section.active ? C.gold2 : C.stone3, { shadow: 1 })
                if (section.active) drawText(s, 'ACTIVE', right, y, C.green3, { align: 2, shadow: 1 })
                y += LINE_H + 1
                const color = section.active ? C.bone1 : C.stone2
                for (const line of section.lines) {
                    if (typeof line !== 'string') {
                        if (y + LINE_H > bottom) break
                        // the line, then the caret and how far equipping it would move the stat
                        const text = line.text.toUpperCase()
                        const tx = x + 4 + textWidth(text) + 4
                        drawText(s, text, x + 4, y, color, { shadow: 1 })
                        caret(s, tx, y, line.up)
                        drawText(s, line.delta.toUpperCase(), tx + 7, y, line.up ? C.green3 : C.red3, { shadow: 1 })
                        y += LINE_H
                        continue
                    }
                    for (const part of wrap(line.toUpperCase(), right - x - 4)) {
                        if (y + LINE_H > bottom) break
                        drawText(s, part, x + 4, y, color, { shadow: 1 })
                        y += LINE_H
                    }
                }
                y += SECTION_GAP
            }
        }

        // the footer: this gacha's Essence, and the buttons
        glyph(s, ESSENCE_ICONS[tab], f.x + 7, f.y + (BTN_H >> 1), true)
        drawText(s, view.essence.toUpperCase(), f.x + 16, f.y + 4, C.bone1, { shadow: 1 })
        for (const b of f.buttons) button(s, b.box, b.label, PLATES[b.id], b.enabled && !busy, hover === b.id, pressed, b.current)

        const b = closeBox(s.w, s.h)
        rect(s, b.x, b.y, CLOSE_W, CLOSE_H, C.ink)
        const closeLit = hover === 'close'
        rect(s, b.x + 1, b.y + 1, CLOSE_W - 2, CLOSE_H - 2, closeLit ? C.red2 : C.red1)
        rect(s, b.x + 1, b.y + 1, CLOSE_W - 2, 1, closeLit ? C.red3 : C.red2)
        for (let i = 0; i < 5; i++) {
            rect(s, b.x + 4 + i, b.y + 3 + i, 1, 1, C.white)
            rect(s, b.x + 8 - i, b.y + 3 + i, 1, 1, C.white)
        }
    }

    /**
     * The picker over a dimmed detail: the title, each spot as its holder's tile (the Hero's face, or
     * an empty socket), and Remove and Cancel. The entry's own spot is ringed gold, one that cannot
     * be taken is dimmed, and the pointed-at one ringed white.
     */
    private drawPicker(s: Surface, view: CollectionsView, picker: EquipPicker, hover: CollectionsHover, pressed: boolean, busy: boolean): void {
        const p = panelRect(s.w, s.h)
        dither(s, p.x, p.y, p.w, p.h, C.ink, 9)
        const l = pickerLayout(s.w, s.h, picker)
        panel(s, l.box.x, l.box.y, l.box.w, l.box.h)
        drawText(s, picker.title.toUpperCase(), l.title.x, l.title.y, C.gold2, { align: 1, shadow: 1 })
        for (const label of l.labels) drawText(s, label.text, label.x, label.y, label.text === 'FRONT' ? C.red3 : C.blue2, { shadow: 1 })
        for (const { r, i, box: b } of l.spots) {
            const spot = picker.rows[r]!.spots[i]!
            const holder = spot.holder
            if (holder?.kind === 'entry') {
                const entry = view.entries.find(e => e.id === holder.id)
                blit(s, collectionTile(view.tab, { id: holder.id, rarity: entry?.rarity ?? 'common', owned: true, mark: null }), b.x, b.y)
            } else if (holder?.kind === 'hero') {
                rect(s, b.x, b.y, TILE, TILE, C.ink)
                // a plain rim: gold rings the entry being placed
                rect(s, b.x + 1, b.y + 1, TILE - 2, TILE - 2, C.stone2)
                rect(s, b.x + 2, b.y + 2, TILE - 4, TILE - 4, C.night0)
                if (view.heroClassId) blit(s, this.heroHead(view.heroClassId), b.x + ((TILE - HEAD) >> 1), b.y + ((TILE - HEAD) >> 1))
            } else {
                // an empty socket, a plus while it can be taken
                rect(s, b.x, b.y, TILE, TILE, C.ink)
                rect(s, b.x + 1, b.y + 1, TILE - 2, TILE - 2, C.night2)
                rect(s, b.x + 2, b.y + 2, TILE - 4, TILE - 4, C.night0)
                if (spot.enabled) {
                    rect(s, b.x + 11, b.y + 7, 2, 10, C.stone3)
                    rect(s, b.x + 7, b.y + 11, 10, 2, C.stone3)
                }
            }
            if (!spot.enabled && !spot.current && holder) dither(s, b.x, b.y, TILE, TILE, C.ink, 8)
            const lit = hover === `spot:${r}:${i}`
            if (spot.current || lit) {
                const c = lit ? C.white : C.gold2
                rect(s, b.x - 1, b.y - 1, TILE + 2, 1, c)
                rect(s, b.x - 1, b.y + TILE, TILE + 2, 1, c)
                rect(s, b.x - 1, b.y, 1, TILE, c)
                rect(s, b.x + TILE, b.y, 1, TILE, c)
            }
            if (spot.unset) {
                // the x that frees the spot: a red plate in the corner, lit on hover
                const u = unsetBox(b)
                const lit = hover === `unset:${r}:${i}`
                rect(s, u.x, u.y, u.w, u.h, C.ink)
                rect(s, u.x + 1, u.y + 1, u.w - 2, u.h - 2, lit ? C.red3 : C.red1)
                for (let k = 0; k < 5; k++) {
                    rect(s, u.x + 2 + k, u.y + 2 + k, 1, 1, C.white)
                    rect(s, u.x + 6 - k, u.y + 2 + k, 1, 1, C.white)
                }
            }
        }
        drawText(s, picker.hint.toUpperCase(), l.hint.x, l.hint.y, C.stone3, { shadow: 1 })
        if (l.remove) button(s, l.remove, picker.remove!.toUpperCase(), REMOVE_PLATE, !busy, hover === 'remove', pressed)
        button(s, l.cancel, 'CANCEL', CANCEL_PLATE, true, hover === 'cancel', pressed)
    }

    private heroHead(classId: string): Surface {
        let head = this.heads.get(classId)
        if (!head) {
            head = headOf(`hero/${classId}`)
            this.heads.set(classId, head)
        }
        return head
    }

    /** A Champion's idle frame at `t`, anchored on its feet. */
    private idleFrame(id: string, t: number): Surface | null {
        const art = artById(`champion/${id}/idle`)
        if (!art) return null
        let frames = this.idles.get(id)
        if (!frames) {
            frames = []
            this.idles.set(id, frames)
        }
        const f = Math.floor(t * art.fps) % Math.max(1, art.frames)
        let frame = frames[f]
        if (!frame) {
            frame = new Surface(art.w, art.h, art.ax ?? art.w >> 1, art.ay ?? art.h - 6)
            art.render(frame, f)
            frames[f] = frame
        }
        return frame
    }
}
