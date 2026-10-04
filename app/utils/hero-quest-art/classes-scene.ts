// The Classes scene: the 16-node class tree left to right, Beginner to master, each node a medallion
// with its name. Any class already reached can be switched to at any time; one never reached takes
// the class token a prestige grants, and the header says whether one is held. The class under the
// pointer, or the current one, is described in the corner below the Beginner.

import { C } from './palette'
import { Surface, line, ring, dither, blit } from './surface'
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
/** A column per tier, a row every `ROW_PITCH` px from the first row's centre. */
const TIER_X: Readonly<Record<string, number>> = { beginner: 8, base: 68, elite: 124, master: 188 }
const TIER_RANK: Readonly<Record<string, number>> = { beginner: 0, base: 1, elite: 2, master: 3 }
const ROW_TOP = PANEL.y + 15
const ROW_PITCH = 21
const MEDAL = 24
const INFO = { x: 8, y: PANEL.y + 84, w: 56 }

/**
 * Where each class's medallion sits: its tier's column, and a row. Masters and elites take a row
 * each in tree order (an elite always has exactly one master), a base class the middle of its
 * elites, the Beginner the middle of the bases.
 */
function classLayout(classes: readonly ClassNodeView[]): Map<string, { x: number, y: number }> {
    const children = (id: string | null) => classes.filter(c => c.parentId === id)
    const rows = new Map<string, number>()
    let next = 0
    const place = (node: ClassNodeView): number => {
        const kids = children(node.id)
        const row = kids.length ? kids.map(place).reduce((a, b) => a + b, 0) / kids.length : next++
        rows.set(node.id, row)
        return row
    }
    children(null).forEach(place)
    const out = new Map<string, { x: number, y: number }>()
    for (const c of classes) out.set(c.id, { x: TIER_X[c.tier] ?? 8, y: Math.round(ROW_TOP + (rows.get(c.id) ?? 0) * ROW_PITCH) })
    return out
}

/** The class whose medallion a point on the view is over. */
export function classNodeAt(classes: readonly ClassNodeView[], x: number, y: number): string | null {
    for (const [id, at] of classLayout(classes)) {
        const dx = x - (at.x + (MEDAL >> 1))
        const dy = y - at.y
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
        // the branches first, so the medallions sit over their ends: out of the parent, down, into the child
        for (const node of view.classes) {
            if (!node.parentId) continue
            const from = at.get(node.parentId)
            const to = at.get(node.id)
            if (!from || !to) continue
            const midX = to.x - 4
            const c = node.costsToken ? C.gold2 : node.pickable ? C.stone2 : C.night3
            line(s, from.x + MEDAL, from.y, midX, from.y, c)
            line(s, midX, from.y, midX, to.y, c)
            line(s, midX, to.y, to.x, to.y, c)
        }
        for (const node of view.classes) {
            const p = at.get(node.id)!
            const my = p.y - (MEDAL >> 1)
            blit(s, this.medal(view, node), p.x, my)
            if (!node.pickable && !node.current) dither(s, p.x, my, MEDAL, MEDAL, C.ink, 9)
            const cx = p.x + (MEDAL >> 1)
            if (node.current) ring(s, cx, p.y, 12, C.gold3)
            else if (node.id === hovered && node.pickable && !busy) ring(s, cx, p.y, 12, C.white)
            else if (node.costsToken) ring(s, cx, p.y, 12, C.gold1)
            const color = node.current ? C.gold3 : node.costsToken ? C.gold2 : node.pickable ? C.bone1 : C.stone2
            drawText(s, node.name.toUpperCase(), p.x + MEDAL + 3, p.y - 2, color, { shadow: 1 })
        }

        // the class under the pointer, or the current one: its skill, and whether it can be taken
        const shown = view.classes.find(c => c.id === hovered) ?? view.classes.find(c => c.current)
        if (!shown) return s
        let y = INFO.y
        for (const l of lines(shown.name, INFO.w)) {
            drawText(s, l, INFO.x, y, C.gold2, { shadow: 1 })
            y += 7
        }
        drawText(s, 'SKILL', INFO.x, y + 1, C.stone3, { shadow: 1 })
        y += 8
        for (const l of lines(shown.skillName, INFO.w, 3)) {
            drawText(s, l, INFO.x, y, C.bone1, { shadow: 1 })
            y += 7
        }
        const status = shown.current
            ? ['CURRENT CLASS']
            : shown.costsToken
                ? ['PRESS TO SPEND', 'YOUR TOKEN']
                : shown.pickable ? ['PRESS TO SWITCH'] : ['NOT REACHED YET']
        const statusColor = shown.current ? C.gold3 : shown.costsToken ? C.gold2 : shown.pickable ? C.green3 : C.stone2
        status.forEach((l, k) => drawText(s, l, INFO.x, y + 2 + k * 7, statusColor, { shadow: 1 }))
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
