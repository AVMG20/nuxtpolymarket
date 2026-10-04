// The Classes scene: the 16-node class tree top to bottom, Beginner to master, each node a medallion
// with its name under it, on plain black. Any class already reached can be switched to at any time;
// one never reached takes the class token a prestige grants, and the header says whether one is
// held. The class under the pointer, or the current one, is described in the top-left corner. At the
// end of the masters' row, joined to all six, stands the capstone: a class for having played every
// other one, shown locked until it exists, so the whole tree reads as leading somewhere.

import { C } from './palette'
import { Surface, line, ring, ditherDisc, blit, disc } from './surface'
import { drawText, textWidth } from './font'
import { glyph } from './icon-kit'
import { ABILITY_ICON_PARTS } from './icons-abilities'
import { classNodeIcon } from './icons-misc'
import { panel } from './ui-art'
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

export interface ClassesView {
    classes: readonly ClassNodeView[]
    /** A prestige's token is held: a class not reached before can be taken. */
    token: boolean
}

const PANEL = { x: 4, y: 14, w: 264, h: 138 }
const TIER_RANK: Readonly<Record<string, number>> = { beginner: 0, base: 1, elite: 2, master: 3 }
/** The tree runs top to bottom: where each tier's medallions start. Each name sits under its medallion. */
const TIER_TOP: Readonly<Record<string, number>> = { beginner: PANEL.y + 2, base: PANEL.y + 34, elite: PANEL.y + 66, master: PANEL.y + 97 }
const MEDAL = 24
/** The widest rows, elites and masters, give each class this much of the panel's width; the capstone takes one more. */
const SLOT = 36
const NAME_GAP = 1
/** The class under the pointer is described in the top-left corner, beside the Beginner. */
const INFO = { x: 8, y: PANEL.y + 3 }
/** The capstone's id on the stage: not a class yet, only its place in the tree. */
export const CAPSTONE_ID = 'capstone'

interface Spot { cx: number, top: number }

/**
 * Where each class's medallion sits: its tier's row, and a centre. Elites and masters take a slot
 * each in tree order (an elite always has exactly one master, which stands under it), a base class
 * the middle of its elites, the Beginner the middle of the bases.
 */
function classLayout(classes: readonly ClassNodeView[]): Map<string, Spot> {
    const children = (id: string | null) => classes.filter(c => c.parentId === id)
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
    for (const c of classes) out.set(c.id, { cx: Math.round(left + (slots.get(c.id) ?? 0) * SLOT), top: TIER_TOP[c.tier] ?? PANEL.y + 3 })
    out.set(CAPSTONE_ID, { cx: Math.round(left + (used - 1) * SLOT), top: TIER_TOP.master! })
    return out
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

/** The branch a class grows from, for its medallion's colour. */
function lineOf(classes: readonly ClassNodeView[], id: string): 'beginner' | 'warrior' | 'mage' | 'archer' {
    let node = classes.find(c => c.id === id)
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
    render(t: number, view: ClassesView, hovered: string | null, busy: boolean): Surface {
        const s = this.backdrops.render('classes', t, false)
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
        const masters = view.classes.filter(c => c.tier === 'master').map(c => at.get(c.id)!.cx)
        const cap = at.get(CAPSTONE_ID)!
        if (masters.length) line(s, Math.min(...masters), cap.top + (MEDAL >> 1), cap.cx, cap.top + (MEDAL >> 1), C.gold0)
        // The branches first, so the medallions and names sit over them: down out of the parent's name,
        // across a bar just above the children's row, and down into each child.
        for (const node of view.classes) {
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
        for (const node of view.classes) {
            const p = at.get(node.id)!
            const mx = p.cx - (MEDAL >> 1)
            blit(s, this.medal(view, node), mx, p.top)
            if (!node.pickable && !node.current) ditherDisc(s, p.cx, p.top + (MEDAL >> 1), 11, C.ink, 9)
            const my = p.top + (MEDAL >> 1)
            if (node.current) ring(s, p.cx, my, 12, C.gold3)
            else if (node.id === hovered && node.pickable && !busy) ring(s, p.cx, my, 12, C.white)
            else if (node.costsToken) ring(s, p.cx, my, 12, C.gold1)
            const color = node.current ? C.gold3 : node.costsToken ? C.gold2 : node.pickable ? C.bone1 : C.stone2
            // a name wider than its slot (Witch Doctor, Beast Master) takes two lines
            lines(node.name, SLOT - 2).forEach((l, k) => drawText(s, l, p.cx, p.top + MEDAL + NAME_GAP + k * 7, color, { align: 1, shadow: 1 }))
        }

        this.drawCapstone(s, cap, hovered === CAPSTONE_ID)

        // the class under the pointer, or the current one: its skill, and whether it can be taken
        const beginner = view.classes.find(c => !c.parentId)
        const infoW = (beginner ? at.get(beginner.id)!.cx - (MEDAL >> 1) - 6 : PANEL.w >> 1) - INFO.x
        let y = INFO.y
        if (hovered === CAPSTONE_ID) {
            // how far along: every class reached so far, of all of them
            const played = view.classes.filter(c => c.pickable && !c.costsToken).length
            const nw = drawText(s, '???', INFO.x, y, C.gold2, { shadow: 1 })
            drawText(s, `${played}/${view.classes.length} PLAYED`, INFO.x + nw + 6, y, C.stone3, { shadow: 1 })
            for (const l of lines('PLAY EVERY OTHER CLASS TO UNLOCK', infoW)) {
                y += 8
                drawText(s, l, INFO.x, y, C.bone1, { shadow: 1 })
            }
            return s
        }
        const shown = view.classes.find(c => c.id === hovered) ?? view.classes.find(c => c.current)
        if (!shown) return s
        drawText(s, shown.name.toUpperCase(), INFO.x, y, C.gold2, { shadow: 1 })
        y += 8
        for (const l of lines(`SKILL: ${shown.skillName}`, infoW)) {
            drawText(s, l, INFO.x, y, C.bone1, { shadow: 1 })
            y += 7
        }
        const status = shown.current ? 'CURRENT CLASS' : shown.costsToken ? 'SPEND TOKEN TO TAKE' : shown.pickable ? 'PRESS TO SWITCH' : 'NOT REACHED YET'
        const statusColor = shown.current ? C.gold3 : shown.costsToken ? C.gold2 : shown.pickable ? C.green3 : C.stone2
        drawText(s, status, INFO.x, y + 1, statusColor, { shadow: 1 })
        return s
    }

    /** The capstone, still locked: a dark medallion in a gilded rim, an infinity sign dimmed inside it (a placeholder until the class exists), and no name yet. */
    private drawCapstone(s: Surface, at: Spot, lit: boolean): void {
        const cy = at.top + (MEDAL >> 1)
        disc(s, at.cx, cy, 11, C.ink)
        disc(s, at.cx, cy, 10, C.gold1)
        disc(s, at.cx, cy, 8, C.purple0)
        ring(s, at.cx, cy, 9, C.gold2)
        glyph(s, (g, x, y) => ABILITY_ICON_PARTS.infinity(g, x, y, 6, C.gold2, C.gold3), at.cx, cy, true)
        ditherDisc(s, at.cx, cy, 8, C.ink, 7)
        if (lit) ring(s, at.cx, cy, 12, C.white)
        drawText(s, '???', at.cx, at.top + MEDAL + NAME_GAP, C.gold1, { align: 1, shadow: 1 })
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
