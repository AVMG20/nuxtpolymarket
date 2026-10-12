// The Classes scene: the 16-node class tree top to bottom, Beginner to master, each node a medallion
// with its name under it, on plain black. Any class already reached can be switched to at any time;
// one never reached takes the class token a prestige grants, and the header says whether one is
// held. The class under the pointer, or the current one, is described in the top-left corner. At the
// end of the masters' row, joined to all six, stands the capstone, the Ascendant: it opens once a
// prestige has been completed as each master. Pressed while it is the current class, it opens its
// kit over the tree: every class skill, five to a line as the tree runs, up to four of them picked.

import { C } from './palette'
import { Surface, line, ring, ditherDisc, blit, rect } from './surface'
import { drawText, textWidth } from './font'
import { glyph } from './icon-kit'
import { ABILITY_ICON_PARTS, CLASS_SKILL_ICONS } from './icons-abilities'
import { classNodeIcon, type ClassLine } from './icons-misc'
import { panel } from './ui-art'
import { plateButton, type Box } from './collections-scene'
import type { SceneBackdrops } from './menu-band'

export interface ClassNodeView {
    id: string
    name: string
    parentId: string | null
    tier: string
    skillName: string
    pickable: boolean
    /** Taking it would spend the class token. */
    costsToken: boolean
    current: boolean
}

/** A class skill the Ascendant can pick. */
export interface AscendantSkillView {
    id: string
    name: string
    /** The class it comes from, and whether that class has been reached. */
    classId: string
    reached: boolean
}

export interface AscendantView {
    /** Masters a prestige has been completed with, of all of them: the unlock. */
    mastersPrestiged: number
    masters: number
    /** The picked skill ids, in pick order. */
    picks: readonly string[]
    kitSize: number
    skills: readonly AscendantSkillView[]
}

export interface ClassesView {
    classes: readonly ClassNodeView[]
    /** A prestige's token is held: a class not reached before can be taken. */
    token: boolean
    ascendant?: AscendantView | null
    /** The Ascendant's kit is open over the tree. */
    kitOpen?: boolean
}

/** A skill in the open kit, or its done button. */
export type KitTarget = `kit:${string}` | 'kit:done'

const PANEL = { x: 4, y: 14, w: 264, h: 138 }
const TIER_RANK: Readonly<Record<string, number>> = { beginner: 0, base: 1, elite: 2, master: 3, capstone: 4 }
/** The tree runs top to bottom: where each tier's medallions start. Each name sits under its medallion. */
const TIER_TOP: Readonly<Record<string, number>> = { beginner: PANEL.y + 2, base: PANEL.y + 34, elite: PANEL.y + 66, master: PANEL.y + 97 }
const MEDAL = 24
/** The widest rows, elites and masters, give each class this much of the panel's width; the capstone takes one more. */
const SLOT = 36
const NAME_GAP = 1
/** The class under the pointer is described in the top-left corner, beside the Beginner. */
const INFO = { x: 8, y: PANEL.y + 3 }
/** The capstone's id: the Ascendant, at the end of the masters' row. */
export const CAPSTONE_ID = 'class_ascendant'

/** The open kit: one line per branch of the tree (Beginner, then each line's five), and a done button. */
const KIT_CELL = 28
const KIT_GAP = 3
const KIT = { x: PANEL.x + 8, y: PANEL.y + 15 }
const KIT_INFO_X = KIT.x + 5 * KIT_CELL + 4 * KIT_GAP + 10
const KIT_DONE: Box = { x: PANEL.x + PANEL.w - 64, y: PANEL.y + PANEL.h - 19, w: 56, h: 13 }
const KIT_PLATE = [C.green0, C.green1, C.green2] as const

interface Spot { cx: number, top: number }

/**
 * Where each class's medallion sits: its tier's row, and a centre. Elites and masters take a slot
 * each in tree order (an elite always has exactly one master, which stands under it), a base class
 * the middle of its elites, the Beginner the middle of the bases.
 */
function classLayout(classes: readonly ClassNodeView[]): Map<string, Spot> {
    // the capstone has no parent to hang from: it is placed at the end of the masters' row below
    const children = (id: string | null) => classes.filter(c => c.parentId === id && c.tier !== 'capstone')
    const slots = new Map<string, number>()
    let next = 0
    const place = (node: ClassNodeView): number => {
        const kids = children(node.id)
        // a master shares its elite's slot; anything with more than one child sits over their middle
        const slot = kids.length ? kids.map(place).reduce((a, b) => a + b, 0) / kids.length : next++
        slots.set(node.id, slot)
        return slot
    }
    children(null).forEach(place)
    // the tree's slots, and one past the last master for the capstone
    const used = Math.max(1, next) + 1
    const left = PANEL.x + ((PANEL.w - used * SLOT) >> 1) + (SLOT >> 1)
    const out = new Map<string, Spot>()
    for (const c of classes) {
        if (c.tier !== 'capstone') out.set(c.id, { cx: Math.round(left + (slots.get(c.id) ?? 0) * SLOT), top: TIER_TOP[c.tier] ?? PANEL.y + 3 })
    }
    out.set(CAPSTONE_ID, { cx: Math.round(left + (used - 1) * SLOT), top: TIER_TOP.master! })
    return out
}

/** Where each pickable skill sits in the open kit: Haste alone on the first line, then a line per branch. */
function kitCells(skills: readonly AscendantSkillView[]): Map<string, Box> {
    const out = new Map<string, Box>()
    skills.forEach((skill, i) => {
        const row = i === 0 ? 0 : 1 + Math.floor((i - 1) / 5)
        const col = i === 0 ? 0 : (i - 1) % 5
        out.set(skill.id, { x: KIT.x + col * (KIT_CELL + KIT_GAP), y: KIT.y + row * (KIT_CELL + KIT_GAP), w: KIT_CELL, h: KIT_CELL })
    })
    return out
}

/** What a point on the open kit is over. */
export function kitTargetAt(view: ClassesView, x: number, y: number): KitTarget | null {
    const inside = (b: Box) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
    if (inside(KIT_DONE)) return 'kit:done'
    for (const [id, b] of kitCells(view.ascendant?.skills ?? [])) if (inside(b)) return `kit:${id}`
    return null
}

/** The picks once `id` is pressed: dropped if picked, added if there is room, else unchanged. */
export function togglePick(ascendant: AscendantView, id: string): readonly string[] {
    if (ascendant.picks.includes(id)) return ascendant.picks.filter(p => p !== id)
    const skill = ascendant.skills.find(s => s.id === id)
    if (!skill?.reached || ascendant.picks.length >= ascendant.kitSize) return ascendant.picks
    return [...ascendant.picks, id]
}

/** The class whose medallion a point on the view is over, or `CAPSTONE_ID` for the capstone's. */
export function classNodeAt(classes: readonly ClassNodeView[], x: number, y: number): string | null {
    for (const [id, at] of classLayout(classes)) {
        const dx = x - at.cx
        const dy = y - (at.top + (MEDAL >> 1))
        if (dx * dx + dy * dy <= 12 * 12) return id
    }
    return null
}

/** The branch a class grows from, for its medallion's colour; the capstone has a colour of its own. */
function lineOf(classes: readonly ClassNodeView[], id: string): ClassLine {
    let node = classes.find(c => c.id === id)
    if (node?.tier === 'capstone') return 'ascendant'
    while (node?.parentId && node.parentId !== 'class_beginner') node = classes.find(c => c.id === node!.parentId)
    if (!node || node.id === 'class_beginner') return 'beginner'
    return node.id === 'class_warrior' ? 'warrior' : node.id === 'class_mage' ? 'mage' : 'archer'
}

/** Break text onto at most `max` lines no wider than `width` px. */
function lines(text: string, width: number, max = 2): string[] {
    const out: string[] = []
    let current = ''
    for (const word of text.toUpperCase().split(' ')) {
        const next = current ? `${current} ${word}` : word
        if (current && textWidth(next) > width) {
            out.push(current)
            current = word
        } else current = next
    }
    out.push(current)
    return out.slice(0, max)
}

export class ClassesScene {
    /** Class medallions, drawn once each. */
    private readonly medals = new Map<string, Surface>()

    constructor(private readonly backdrops: SceneBackdrops) {}

    /** The tree. `hovered` is the class under the pointer; `busy` holds every pick while one is on its way. */
    render(t: number, view: ClassesView, hovered: string | null, busy: boolean, pressed = false): Surface {
        const s = this.backdrops.render('classes', t, false)
        if (view.kitOpen && view.ascendant) return this.renderKit(s, view.ascendant, hovered, busy, pressed)
        const tree = view.classes.filter(c => c.tier !== 'capstone')
        const capstone = view.classes.find(c => c.tier === 'capstone')
        drawText(s, 'CLASSES', 6, 4, C.gold2, { shadow: 1 })
        if (view.token) {
            const label = 'NEW CLASS TOKEN READY'
            drawText(s, label, s.w - 6, 4, C.gold3, { align: 2, shadow: 1 })
            glyph(s, (g, x, y) => ABILITY_ICON_PARTS.crown(g, x, y + 2), s.w - 6 - textWidth(label) - 9, 6, true)
        } else drawText(s, 'PRESTIGE FOR A NEW CLASS', s.w - 6, 4, C.stone3, { align: 2, shadow: 1 })
        panel(s, PANEL.x, PANEL.y, PANEL.w, PANEL.h)

        const at = classLayout(view.classes)
        const nameBottom = (top: number) => top + MEDAL + NAME_GAP + 6
        // every master runs on into the capstone: one line through the masters' row, behind their medallions
        const masters = tree.filter(c => c.tier === 'master').map(c => at.get(c.id)!.cx)
        const cap = at.get(CAPSTONE_ID)!
        const capOpen = !!capstone && (capstone.pickable || capstone.current)
        if (masters.length) line(s, Math.min(...masters), cap.top + (MEDAL >> 1), cap.cx, cap.top + (MEDAL >> 1), capstone?.costsToken ? C.gold2 : capOpen ? C.gold1 : C.gold0)
        // The branches first, so the medallions and names sit over them: down out of the parent's name,
        // across a bar just above the children's row, and down into each child.
        for (const node of tree) {
            if (!node.parentId) continue
            const from = at.get(node.parentId)
            const to = at.get(node.id)
            if (!from || !to) continue
            const bar = to.top - 2
            const c = node.costsToken ? C.gold2 : node.pickable ? C.stone2 : C.night3
            line(s, from.cx, Math.min(nameBottom(from.top), bar), from.cx, bar, c)
            line(s, from.cx, bar, to.cx, bar, c)
            line(s, to.cx, bar, to.cx, to.top, c)
        }
        for (const node of tree) {
            const p = at.get(node.id)!
            const mx = p.cx - (MEDAL >> 1)
            blit(s, this.medal(view, node), mx, p.top)
            if (!node.pickable && !node.current) ditherDisc(s, p.cx, p.top + (MEDAL >> 1), 11, C.ink, 9)
            this.nodeRing(s, node, p, hovered, busy)
            const color = node.current ? C.gold3 : node.costsToken ? C.gold2 : node.pickable ? C.bone1 : C.stone2
            // a name wider than its slot (Witch Doctor, Beast Master) takes two lines
            lines(node.name, SLOT - 2).forEach((l, k) => drawText(s, l, p.cx, p.top + MEDAL + NAME_GAP + k * 7, color, { align: 1, shadow: 1 }))
        }

        this.drawCapstone(s, view, cap, capstone, hovered, busy)

        // the class under the pointer, or the current one: its skill, and whether it can be taken
        const beginner = tree.find(c => !c.parentId)
        const infoW = (beginner ? at.get(beginner.id)!.cx - (MEDAL >> 1) - 6 : PANEL.w >> 1) - INFO.x
        let y = INFO.y
        const shown = view.classes.find(c => c.id === hovered) ?? view.classes.find(c => c.current)
        if (!shown) return s
        drawText(s, shown.name.toUpperCase(), INFO.x, y, C.gold2, { shadow: 1 })
        y += 8
        if (shown.tier === 'capstone' && !shown.pickable && !shown.current) {
            // still locked: how far along, a master at a time
            const a = view.ascendant
            if (a) drawText(s, `${a.mastersPrestiged}/${a.masters} MASTERS DONE`, INFO.x, y, C.stone3, { shadow: 1 })
            for (const l of lines('PRESTIGE ONCE AS EACH MASTER TO UNLOCK', infoW)) {
                y += 7
                drawText(s, l, INFO.x, y, C.bone1, { shadow: 1 })
            }
            return s
        }
        for (const l of lines(`SKILL: ${shown.skillName}`, infoW)) {
            drawText(s, l, INFO.x, y, C.bone1, { shadow: 1 })
            y += 7
        }
        const status = shown.current
            ? shown.tier === 'capstone' ? 'PRESS TO PICK SKILLS' : 'CURRENT CLASS'
            : shown.costsToken ? 'SPEND TOKEN TO TAKE' : shown.pickable ? 'PRESS TO SWITCH' : 'NOT REACHED YET'
        const statusColor = shown.current ? C.gold3 : shown.costsToken ? C.gold2 : shown.pickable ? C.green3 : C.stone2
        drawText(s, status, INFO.x, y + 1, statusColor, { shadow: 1 })
        return s
    }

    /** A medallion's ring: the current class's gold, a pickable one's white under the pointer, a token's gilt. */
    private nodeRing(s: Surface, node: ClassNodeView, p: Spot, hovered: string | null, busy: boolean): void {
        const my = p.top + (MEDAL >> 1)
        if (node.current) ring(s, p.cx, my, 12, C.gold3)
        else if (node.id === hovered && node.pickable && !busy) ring(s, p.cx, my, 12, C.white)
        else if (node.costsToken) ring(s, p.cx, my, 12, C.gold1)
    }

    /**
     * The capstone: its portrait on violet in a gilded rim studded with the six masters' colours,
     * dimmed until it can be taken. Its name shows once it is open.
     */
    private drawCapstone(s: Surface, view: ClassesView, at: Spot, node: ClassNodeView | undefined, hovered: string | null, busy: boolean): void {
        const cy = at.top + (MEDAL >> 1)
        const open = !!node && (node.pickable || node.current)
        if (node) blit(s, this.medal(view, node), at.cx - (MEDAL >> 1), at.top)
        if (!open) ditherDisc(s, at.cx, cy, 11, C.ink, 9)
        if (node) this.nodeRing(s, node, at, hovered, busy)
        if (!open && hovered === CAPSTONE_ID) ring(s, at.cx, cy, 12, C.stone3)
        const color = node?.current ? C.gold3 : node?.costsToken ? C.gold2 : open ? C.bone1 : C.gold1
        drawText(s, open ? (node!.name.toUpperCase()) : '???', at.cx, at.top + MEDAL + NAME_GAP, color, { align: 1, shadow: 1 })
    }

    /**
     * The Ascendant's kit, over the tree: Haste alone on the first line, then each branch's five, as
     * the tree runs. A pick is gilded and numbered; the side column says what the skill under the
     * pointer is and what pressing it does.
     */
    private renderKit(s: Surface, a: AscendantView, hovered: string | null, busy: boolean, pressed: boolean): Surface {
        drawText(s, 'ASCENDANT KIT', 6, 4, C.gold2, { shadow: 1 })
        drawText(s, `${a.picks.length}/${a.kitSize} PICKED`, s.w - 6, 4, a.picks.length === a.kitSize ? C.gold3 : C.stone3, { align: 2, shadow: 1 })
        panel(s, PANEL.x, PANEL.y, PANEL.w, PANEL.h)
        drawText(s, 'PICK ANY FOUR. CONVERGENCE FIRES EVERY MASTER SKILL.', PANEL.x + 8, PANEL.y + 5, C.stone3, { shadow: 1 })

        const cells = kitCells(a.skills)
        for (const skill of a.skills) {
            const b = cells.get(skill.id)!
            const pick = a.picks.indexOf(skill.id)
            const lit = hovered === `kit:${skill.id}` && !busy
            panel(s, b.x, b.y, b.w, b.h, undefined, pick >= 0 ? C.night3 : C.night1)
            const g = CLASS_SKILL_ICONS[skill.id]
            if (g) glyph(s, g, b.x + (b.w >> 1), b.y + (b.h >> 1))
            if (!skill.reached) ditherDisc(s, b.x + (b.w >> 1), b.y + (b.h >> 1), 12, C.ink, 9)
            const rim = pick >= 0 ? C.gold3 : lit ? C.white : null
            if (rim !== null) {
                rect(s, b.x - 1, b.y - 1, b.w + 2, 1, rim)
                rect(s, b.x - 1, b.y + b.h, b.w + 2, 1, rim)
                rect(s, b.x - 1, b.y - 1, 1, b.h + 2, rim)
                rect(s, b.x + b.w, b.y - 1, 1, b.h + 2, rim)
            }
            if (pick >= 0) {
                rect(s, b.x + b.w - 7, b.y + 1, 6, 7, C.ink)
                drawText(s, String(pick + 1), b.x + b.w - 4, b.y + 2, C.gold3, { align: 1, shadow: 0 })
            }
        }

        // the skill under the pointer: its name, its class, and what a press does
        const at = hovered?.startsWith('kit:') ? a.skills.find(skill => `kit:${skill.id}` === hovered) : undefined
        const infoW = PANEL.x + PANEL.w - 8 - KIT_INFO_X
        let y = KIT.y
        if (at) {
            for (const l of lines(at.name, infoW)) {
                drawText(s, l, KIT_INFO_X, y, C.gold2, { shadow: 1 })
                y += 7
            }
            y += 2
            const picked = a.picks.includes(at.id)
            const status = !at.reached ? 'CLASS NOT REACHED' : picked ? 'PRESS TO DROP' : a.picks.length >= a.kitSize ? 'KIT IS FULL' : 'PRESS TO PICK'
            drawText(s, status, KIT_INFO_X, y, !at.reached || (!picked && a.picks.length >= a.kitSize) ? C.stone2 : C.green3, { shadow: 1 })
        } else {
            for (const l of lines('EACH SKILL KEEPS ITS OWN CLASS\'S COOLDOWN AND HIT.', infoW, 4)) {
                drawText(s, l, KIT_INFO_X, y, C.stone3, { shadow: 1 })
                y += 7
            }
        }
        plateButton(s, KIT_DONE, 'DONE', KIT_PLATE, !busy, hovered === 'kit:done', pressed)
        return s
    }

    private medal(view: ClassesView, node: ClassNodeView): Surface {
        let m = this.medals.get(node.id)
        if (!m) {
            m = new Surface(MEDAL, MEDAL, 0, 0)
            classNodeIcon(m, node.id, lineOf(view.classes, node.id), TIER_RANK[node.tier] ?? 0)
            this.medals.set(node.id, m)
        }
        return m
    }
}
