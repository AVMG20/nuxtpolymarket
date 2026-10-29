// The Passive Skill Tree scene (`passive-skill-tree.md`): the tree laid out radially on a starfield,
// the gold root in the middle and the three class paths fanning out from it, Warrior up, Mage down
// the right and Archer down the left, each ring a tier further out. The camera pans and zooms over it
// (`BattleCanvas` owns the camera; this module only draws through it and hit-tests through it).
// The header carries the points and the respec, the corner the zoom controls, and the panel along
// the bottom describes the node under the pointer or the one picked, with its Buy button.

import { C } from './palette'
import { rect, line, disc, ring, ditherDisc, hash, type Surface } from './surface'
import { drawText, textWidth } from './font'
import { panel } from './ui-art'
import { glyph } from './icon-kit'
import { CURRENCY_ICONS } from './icons-items'
import { plateButton, type Box } from './collections-scene'
import type { SceneBackdrops } from './menu-band'
import { PASSIVE_BAND_MAGNITUDE } from '#shared/utils/hero-quest/constants'
import { PASSIVE_NODES, PASSIVE_ROOT_ID, type PassiveNode, type PassivePath } from '#shared/utils/hero-quest/content/passive-tree'
import type { HqModifier } from '#shared/utils/hero-quest/modifiers'
import { formatHq, type HqNotation } from '#shared/utils/hero-quest/numbers'

/** A node as the payload has it: what it holds and what its next level costs. */
export interface TreeNodeState {
    id: string
    level: number
    maxLevel: number | null
    nextCost: number | null
    /** Why the next level can't be bought; null when it can. */
    block: 'locked' | 'maxed' | 'points' | null
    /** A class-path node off the Hero's path does nothing. */
    active: boolean
}

export interface TreeView {
    /** The player's big-number notation, for the prices. */
    notation: HqNotation
    nodes: readonly TreeNodeState[]
    /** Points left, spelled out. */
    points: string
    respecFree: boolean
    respecGems: number
    /** The Gems cover a paid respec. */
    respecAffordable: boolean
    /** The respec was pressed once and waits for the press that confirms it. */
    armed: boolean
    busy: boolean
}

/** The camera: the world point at the middle of the viewport, and the zoom. */
export interface TreeCamera {
    x: number
    y: number
    zoom: number
}

export type TreeTarget = 'respec' | 'buy' | 'zoomIn' | 'zoomOut' | 'center' | 'panel' | `node:${string}`

export const TREE_ZOOM_MIN = 0.22
export const TREE_ZOOM_MAX = 2.5
/** The camera a visit opens on: the root, close enough to read. */
export const TREE_HOME: TreeCamera = { x: 0, y: 0, zoom: 1 }
/** A zoom button's step, as a factor. */
export const TREE_ZOOM_STEP = 1.4

/** World units between rings. */
const RING = 34
/** The arc each path fans across. */
const SECTOR = Math.PI * 0.56
const PATH_ANGLE: Readonly<Record<Exclude<PassivePath, 'root'>, number>> = { warrior: -Math.PI / 2, mage: Math.PI / 6, archer: Math.PI * 5 / 6 }
/** The root's own nodes sit in the gaps between the paths, in roster order. */
const ROOT_RING_ANGLES: readonly number[] = [Math.PI / 2, -Math.PI * 5 / 6, -Math.PI / 6]
const ENDLESS_DEPTH = 6
/** How far out the world runs, for the camera's leash and the starfield. */
const WORLD_R = ENDLESS_DEPTH * RING + 40

const HEADER_H = 13
const RESPEC: Box = { x: 204, y: 1, w: 64, h: 11 }
const ZOOM_OUT: Box = { x: 226, y: 139, w: 13, h: 12 }
const ZOOM_IN: Box = { x: 241, y: 139, w: 13, h: 12 }
const CENTER: Box = { x: 256, y: 139, w: 13, h: 12 }
/** Two lines high, so the tree keeps most of the view. */
const PANEL: Box = { x: 3, y: 131, w: 219, h: 20 }
const BUY: Box = { x: PANEL.x + PANEL.w - 44, y: PANEL.y + 5, w: 40, h: 11 }

type Ramp = readonly [number, number, number, number]
const PATH_RAMP: Readonly<Record<PassivePath, Ramp>> = {
    root: [C.gold0, C.gold1, C.gold2, C.gold3],
    warrior: [C.red0, C.red1, C.red2, C.red3],
    mage: [C.blue0, C.blue1, C.blue2, C.cyan],
    archer: [C.green0, C.green1, C.green2, C.green3]
}
const BUY_PLATE = [C.green0, C.green1, C.green2] as const
const RESPEC_PLATE = [C.purple0, C.purple1, C.purple2] as const
const CONFIRM_PLATE = [C.gold0, C.gold1, C.gold2] as const
const ZOOM_PLATE = [C.night1, C.night2, C.night3] as const

// ── Layout ─────────────────────────────────────────────────────────────────────────────

interface Spot { x: number, y: number, depth: number, angle: number }

/**
 * Where every node stands in the world: a tidy radial tree. Each path's leaves share its sector
 * evenly and a parent sits at the middle of its leaves; a node's ring is its depth from the root.
 * Side nodes are turned to the outside edges, so each path's spine runs up its middle.
 */
function computeLayout(): Map<string, Spot> {
    const out = new Map<string, Spot>()
    const kids = (id: string) => PASSIVE_NODES.filter(n => n.parent === id)
    out.set(PASSIVE_ROOT_ID, { x: 0, y: 0, depth: 0, angle: 0 })
    kids(PASSIVE_ROOT_ID).filter(n => n.path === 'root').forEach((node, i) => {
        const angle = ROOT_RING_ANGLES[i % ROOT_RING_ANGLES.length]!
        out.set(node.id, { x: Math.cos(angle) * RING, y: Math.sin(angle) * RING, depth: 1, angle })
    })
    for (const top of kids(PASSIVE_ROOT_ID).filter(n => n.path !== 'root')) {
        const centre = PATH_ANGLE[top.path as Exclude<PassivePath, 'root'>]
        const halves = kids(top.id)
        // the first branch keeps its side nodes on the left, the second on the right
        const order = (node: PassiveNode, sideFirst: boolean): PassiveNode[] =>
            [...kids(node.id)].sort((a, b) => (Number(b.side) - Number(a.side)) * (sideFirst ? 1 : -1))
        const leaves: PassiveNode[] = []
        const walk = (node: PassiveNode, sideFirst: boolean) => {
            const children = order(node, sideFirst)
            if (!children.length) leaves.push(node)
            for (const child of children) walk(child, sideFirst)
        }
        halves.forEach((half, i) => walk(half, i === 0))
        const leafAngle = new Map(leaves.map((leaf, i) => [leaf.id, centre - SECTOR / 2 + (i + 0.5) * SECTOR / leaves.length]))
        const place = (node: PassiveNode, depth: number): number => {
            const children = kids(node.id)
            const angle = children.length
                ? children.map(c => place(c, depth + 1)).reduce((a, b) => a + b, 0) / children.length
                : leafAngle.get(node.id)!
            const r = (node.endless ? ENDLESS_DEPTH : depth) * RING
            out.set(node.id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r, depth, angle })
            return angle
        }
        place(top, 1)
    }
    return out
}

const LAYOUT = computeLayout()
const NODE_BY_ID = new Map(PASSIVE_NODES.map(n => [n.id, n]))

/** Keep the camera over the tree and its zoom in range. */
export function clampTreeCamera(cam: TreeCamera): TreeCamera {
    const zoom = Math.min(TREE_ZOOM_MAX, Math.max(TREE_ZOOM_MIN, cam.zoom))
    const reach = WORLD_R - 20
    return { zoom, x: Math.max(-reach, Math.min(reach, cam.x)), y: Math.max(-reach, Math.min(reach, cam.y)) }
}

/** The middle of what shows on a view `w` wide: between the header and the panel along the bottom. */
function viewCentre(w: number, _h: number): { cx: number, cy: number } {
    return { cx: w >> 1, cy: HEADER_H + ((PANEL.y - HEADER_H) >> 1) }
}

export function treeToScreen(cam: TreeCamera, w: number, h: number, wx: number, wy: number): { x: number, y: number } {
    const { cx, cy } = viewCentre(w, h)
    return { x: cx + (wx - cam.x) * cam.zoom, y: cy + (wy - cam.y) * cam.zoom }
}

export function screenToTree(cam: TreeCamera, w: number, h: number, x: number, y: number): { x: number, y: number } {
    const { cx, cy } = viewCentre(w, h)
    return { x: cam.x + (x - cx) / cam.zoom, y: cam.y + (y - cy) / cam.zoom }
}

/** The camera zoomed by `factor`, holding the world point under (x, y) where it is. */
export function zoomTreeAt(cam: TreeCamera, w: number, h: number, x: number, y: number, factor: number): TreeCamera {
    const before = screenToTree(cam, w, h, x, y)
    const zoom = Math.min(TREE_ZOOM_MAX, Math.max(TREE_ZOOM_MIN, cam.zoom * factor))
    const { cx, cy } = viewCentre(w, h)
    return clampTreeCamera({ zoom, x: before.x - (x - cx) / zoom, y: before.y - (y - cy) / zoom })
}

function nodeRadius(node: PassiveNode, zoom: number): number {
    const base = node.id === PASSIVE_ROOT_ID ? 11 : node.endless ? 10 : 8
    return Math.max(2, Math.round(base * zoom))
}

const inside = (b: Box, x: number, y: number) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h

/**
 * What a point on the view is over: a control, the panel (which takes the press so nothing under it
 * is hit), or a node. Null over open sky, which is where a drag pans from.
 */
export function treeTargetAt(cam: TreeCamera, w: number, h: number, x: number, y: number): TreeTarget | null {
    if (inside(RESPEC, x, y)) return 'respec'
    if (inside(ZOOM_OUT, x, y)) return 'zoomOut'
    if (inside(ZOOM_IN, x, y)) return 'zoomIn'
    if (inside(CENTER, x, y)) return 'center'
    if (inside(BUY, x, y)) return 'buy'
    if (inside(PANEL, x, y)) return 'panel'
    if (y < HEADER_H) return null
    let best: string | null = null
    let bestD = Infinity
    for (const node of PASSIVE_NODES) {
        const at = LAYOUT.get(node.id)!
        const p = treeToScreen(cam, w, h, at.x, at.y)
        const r = Math.max(5, nodeRadius(node, cam.zoom) + 1)
        const d = (p.x - x) ** 2 + (p.y - y) ** 2
        if (d <= r * r && d < bestD) {
            best = node.id
            bestD = d
        }
    }
    return best ? `node:${best}` : null
}

/** Whether pressing a target does anything: a node is always picked; the buttons only when they can act. */
export function treeTargetEnabled(view: TreeView, target: TreeTarget, selected: string | null): boolean {
    if (target === 'panel') return false
    if (target === 'buy') {
        const state = selected ? view.nodes.find(n => n.id === selected) : undefined
        return !view.busy && !!state && state.block === null
    }
    if (target === 'respec') return !view.busy && view.nodes.some(n => n.level > 0) && (view.respecFree || view.respecAffordable)
    return true
}

// ── Words ──────────────────────────────────────────────────────────────────────────────

const KIND_LABEL: Readonly<Partial<Record<HqModifier['kind'], string>>> = {
    maxHp: 'Max HP',
    critChance: 'Crit chance',
    critDamage: 'Crit damage',
    enemyDefShred: 'Enemy DEF ignored',
    damageTaken: 'Damage taken',
    gold: 'Gold',
    xp: 'XP',
    offlineEfficiency: 'Offline efficiency',
    cooldown: 'Cooldowns',
    controlResist: 'Control resist',
    reflect: 'Damage reflected',
    evasion: 'Evasion',
    skillDamage: 'Skill damage',
    basicAttack: 'Basic attack damage'
}
/** The few letters inside a node's medallion. */
const KIND_TAG: Readonly<Partial<Record<HqModifier['kind'], string>>> = {
    maxHp: 'HP',
    critChance: 'CRT',
    critDamage: 'CDM',
    enemyDefShred: 'SHR',
    damageTaken: 'ARM',
    gold: 'GLD',
    xp: 'XP',
    offlineEfficiency: 'OFF',
    cooldown: 'CD',
    controlResist: 'RES',
    reflect: 'RFL',
    evasion: 'EVA',
    skillDamage: 'SKL',
    basicAttack: 'ATK'
}
/** Kinds whose magnitude takes something away, shown with a minus. */
const REDUCING = new Set<HqModifier['kind']>(['damageTaken', 'cooldown'])

function lineName(l: { kind: HqModifier['kind'], stat?: string }): string {
    return l.kind === 'stat' ? (l.stat ?? '').toUpperCase() : KIND_LABEL[l.kind] ?? l.kind
}

function pct(x: number): string {
    return `${Math.round(x * 1000) / 10}%`
}

/**
 * What a node does: its step a level and, once held, its total. Every node's lines share one band,
 * so one step covers them all. The pixel font has no brackets, so a slash sets the total apart.
 */
function effectText(node: PassiveNode, level: number, short = false): string {
    const first = node.lines[0]!
    const step = PASSIVE_BAND_MAGNITUDE[first.band]
    const sign = REDUCING.has(first.kind) ? '-' : '+'
    const now = level > 0 ? ` / NOW ${sign}${pct(step * level)}` : ''
    return `${sign}${pct(step)} ${node.lines.map(lineName).join(' AND ')}${short ? '' : ' A LEVEL'}${now}`.toUpperCase()
}

/** Who a node reaches, when it is not simply the Hero. */
function scopeText(node: PassiveNode, state: TreeNodeState | undefined): string {
    if (node.scope.kind === 'champion') return node.scope.archetype === 'all' ? 'ALL CHAMPIONS' : `${node.scope.archetype.toUpperCase()} CHAMPIONS`
    if (node.pathLocked) return `${node.path.toUpperCase()} PATH${state && !state.active ? ', OFF NOW' : ''}`
    return node.endless ? 'NO CAP' : ''
}

/** What the panel says over a control, or with nothing picked. */
function controlText(view: TreeView, hover: TreeTarget | null): string {
    if (hover === 'respec') {
        return view.respecFree
            ? 'REFUND EVERY POINT. FREE: A PRESTIGE GRANTED IT.'
            : `REFUND EVERY POINT FOR ${formatHq(view.respecGems, view.notation)} GEMS. A PRESTIGE GRANTS A FREE ONE.`
    }
    if (hover === 'zoomIn' || hover === 'zoomOut') return 'ZOOM. THE WHEEL OR A PINCH DOES IT TOO.'
    if (hover === 'center') return 'BACK TO THE ROOT.'
    return 'EVERY HERO LEVEL IS A POINT. DRAG TO MOVE, WHEEL OR PINCH TO ZOOM, PRESS A NODE.'
}

/** Break text onto lines no wider than `width` px. */
function wrap(text: string, width: number): string[] {
    const out: string[] = []
    let current = ''
    for (const word of text.toUpperCase().split(' ')) {
        const next = current ? `${current} ${word}` : word
        if (current && textWidth(next) > width) {
            out.push(current)
            current = word
        } else current = next
    }
    if (current) out.push(current)
    return out
}

// ── Drawing ────────────────────────────────────────────────────────────────────────────

/** A filled diamond, `r` from its middle to each point. */
function diamond(s: Surface, x: number, y: number, r: number, c: number): void {
    for (let dy = -r; dy <= r; dy++) {
        const half = r - Math.abs(dy)
        rect(s, x - half, y + dy, half * 2 + 1, 1, c)
    }
}

/** The starfield, in world space, so it drifts with the pan at half the tree's rate. */
const STARS = Array.from({ length: 220 }, (_, i) => ({
    x: (hash(i * 3 + 1) * 2 - 1) * WORLD_R * 1.4,
    y: (hash(i * 3 + 2) * 2 - 1) * WORLD_R * 1.4,
    k: hash(i * 3 + 3)
}))

export class TreeScene {
    constructor(private readonly backdrops: SceneBackdrops) {}

    /** The tree through `cam`. `selected` is the node picked; `hover` what the pointer is over. */
    render(t: number, view: TreeView, cam: TreeCamera, selected: string | null, hover: TreeTarget | null, pressed: boolean): Surface {
        const s = this.backdrops.render('tree', t, false)
        const states = new Map(view.nodes.map(n => [n.id, n]))
        this.drawSky(s, t, cam)
        this.drawRings(s, cam)
        this.drawBranches(s, cam, states)
        const hovered = hover?.startsWith('node:') ? hover.slice(5) : null
        for (const node of PASSIVE_NODES) this.drawNode(s, t, cam, node, states.get(node.id), node.id === selected, node.id === hovered)
        this.drawPathNames(s, cam)
        this.drawHeader(s, view, hover, pressed)
        this.drawControls(s, hover, pressed)
        this.drawPanel(s, view, states, selected, hovered, hover, pressed)
        return s
    }

    private drawSky(s: Surface, t: number, cam: TreeCamera): void {
        const half = { x: cam.x * 0.5, y: cam.y * 0.5 }
        const { cx, cy } = viewCentre(s.w, s.h)
        for (const star of STARS) {
            const x = Math.round(cx + (star.x - half.x) * Math.max(0.5, cam.zoom * 0.5))
            const y = Math.round(cy + (star.y - half.y) * Math.max(0.5, cam.zoom * 0.5))
            if (x < 0 || y < HEADER_H || x >= s.w || y >= s.h) continue
            // a slow twinkle on the brighter few; cosmetic only
            const lit = star.k > 0.85 && Math.sin(t * 1.5 + star.k * 40) > 0.6
            s.set(x, y, lit ? C.haze : star.k > 0.6 ? C.night2 : C.night1)
        }
    }

    /** A faint ring at every tier's distance, the tree's rings made visible. */
    private drawRings(s: Surface, cam: TreeCamera): void {
        const o = treeToScreen(cam, s.w, s.h, 0, 0)
        for (let depth = 1; depth <= ENDLESS_DEPTH; depth++) ring(s, o.x, o.y, depth * RING * cam.zoom, depth === ENDLESS_DEPTH ? C.night1 : C.night0)
    }

    private drawBranches(s: Surface, cam: TreeCamera, states: Map<string, TreeNodeState>): void {
        const thick = cam.zoom >= 1.6 ? 2 : 1
        for (const node of PASSIVE_NODES) {
            for (const from of node.links) this.drawBranch(s, cam, node, from, states, thick)
            if (node.parent && node.parentJoined) this.drawBranch(s, cam, node, node.parent, states, thick)
        }
    }

    /** One line into `node`, from its parent or a node it links, coloured by how far `node` has got. */
    private drawBranch(s: Surface, cam: TreeCamera, node: PassiveNode, from: string, states: Map<string, TreeNodeState>, thick: number): void {
        const a = LAYOUT.get(from)!
        const b = LAYOUT.get(node.id)!
        const p = treeToScreen(cam, s.w, s.h, a.x, a.y)
        const q = treeToScreen(cam, s.w, s.h, b.x, b.y)
        if (Math.max(p.x, q.x) < 0 || Math.min(p.x, q.x) >= s.w || Math.max(p.y, q.y) < 0 || Math.min(p.y, q.y) >= s.h) return
        const state = states.get(node.id)
        const ramp = PATH_RAMP[node.path]
        const c = (state?.level ?? 0) > 0 ? ramp[2] : state?.block === 'locked' ? C.night2 : C.stone2
        line(s, p.x, p.y, q.x, q.y, c, thick)
    }

    private drawNode(s: Surface, t: number, cam: TreeCamera, node: PassiveNode, state: TreeNodeState | undefined, selected: boolean, hovered: boolean): void {
        const at = LAYOUT.get(node.id)!
        const p = treeToScreen(cam, s.w, s.h, at.x, at.y)
        const r = nodeRadius(node, cam.zoom)
        if (p.x < -r - 20 || p.y < -r - 20 || p.x > s.w + r + 20 || p.y > s.h + r + 20) return
        const ramp = PATH_RAMP[node.path]
        const level = state?.level ?? 0
        const locked = !state || state.block === 'locked'
        const maxed = state?.block === 'maxed'
        const open = state?.block === null
        const rim = maxed ? C.gold2 : level > 0 ? ramp[2] : locked ? C.stone1 : ramp[1]
        const fill = level > 0 ? ramp[0] : C.night0

        // buyable now: a slow pulse round it (cosmetic)
        if (open && r >= 4) ring(s, p.x, p.y, r + 2 + Math.round((Math.sin(t * 3) + 1) * 0.75), ramp[1])
        if (node.side) {
            // a Champion side node is a square, so it reads apart from the Hero's own
            rect(s, p.x - r, p.y - r, r * 2 + 1, r * 2 + 1, C.ink)
            rect(s, p.x - r + 1, p.y - r + 1, r * 2 - 1, r * 2 - 1, rim)
            rect(s, p.x - r + 2, p.y - r + 2, r * 2 - 3, r * 2 - 3, fill)
        } else if (node.pathLocked) {
            // a class-path node is a diamond
            diamond(s, p.x, p.y, r + 2, C.ink)
            diamond(s, p.x, p.y, r + 1, rim)
            diamond(s, p.x, p.y, r - 1, fill)
        } else {
            disc(s, p.x, p.y, r + 1, C.ink)
            disc(s, p.x, p.y, r, rim)
            disc(s, p.x, p.y, Math.max(1, r - 2), fill)
            if (node.endless || node.id === PASSIVE_ROOT_ID) ring(s, p.x, p.y, r + 3, node.endless ? C.gold1 : C.gold0)
        }
        if (locked && r >= 3) ditherDisc(s, p.x, p.y, r, C.ink, 7)
        if (state && !state.active && level > 0) ditherDisc(s, p.x, p.y, r, C.ink, 10)

        // the letters inside, once there is room for them
        if (r >= 6) {
            const textColor = locked ? C.stone2 : level > 0 ? C.white : ramp[3]
            if (node.endless) this.drawInfinity(s, p.x, p.y, Math.max(2, Math.round(r / 4)), textColor)
            else {
                const tag = node.id === PASSIVE_ROOT_ID ? 'PWR' : this.tag(node)
                drawText(s, tag, p.x + 1, p.y - 2, textColor, { align: 1, shadow: 1, scale: r >= 16 ? 2 : 1 })
            }
        }
        // the level under it, once the zoom leaves room
        if (cam.zoom >= 0.75 && (level > 0 || !locked)) {
            const label = state?.maxLevel ? `${level}/${state.maxLevel}` : `${level}`
            drawText(s, label, p.x + 1, p.y + r + 3, maxed ? C.gold3 : level > 0 ? C.bone1 : C.stone3, { align: 1, shadow: 1 })
        }
        if (cam.zoom >= 1.5) drawText(s, node.name.toUpperCase(), p.x + 1, p.y - r - 9, hovered || selected ? C.white : C.stone3, { align: 1, shadow: 1 })
        if (selected) ring(s, p.x, p.y, r + 4, C.white)
        else if (hovered) ring(s, p.x, p.y, r + 4, C.steel3)
    }

    /** Two loops side by side: the endless node's mark. */
    private drawInfinity(s: Surface, x: number, y: number, k: number, c: number): void {
        ring(s, x - k, y, k, c)
        ring(s, x + k, y, k, c)
    }

    private tag(node: PassiveNode): string {
        const l = node.lines[0]!
        return l.kind === 'stat' ? (l.stat ?? '').toUpperCase() : KIND_TAG[l.kind] ?? '?'
    }

    /** Each path's name, past its outermost ring. */
    private drawPathNames(s: Surface, cam: TreeCamera): void {
        for (const [path, angle] of Object.entries(PATH_ANGLE) as [Exclude<PassivePath, 'root'>, number][]) {
            const r = (ENDLESS_DEPTH * RING + 26)
            const p = treeToScreen(cam, s.w, s.h, Math.cos(angle) * r, Math.sin(angle) * r)
            if (p.y < HEADER_H) continue
            drawText(s, path.toUpperCase(), p.x, p.y - 2, PATH_RAMP[path][2], { align: 1, shadow: 1, scale: cam.zoom >= 1.2 ? 2 : 1 })
        }
    }

    private drawHeader(s: Surface, view: TreeView, hover: TreeTarget | null, pressed: boolean): void {
        rect(s, 0, 0, s.w, HEADER_H, C.ink)
        rect(s, 0, HEADER_H - 1, s.w, 1, C.night1)
        drawText(s, 'PASSIVE TREE', 6, 4, C.gold2, { shadow: 1 })
        drawText(s, `${view.points} POINTS`, RESPEC.x - 6, 4, view.points === '0' ? C.stone3 : C.gold3, { align: 2, shadow: 1 })
        const enabled = treeTargetEnabled(view, 'respec', null)
        const paid = !view.armed && !view.respecFree
        if (!paid) {
            plateButton(s, RESPEC, view.armed ? 'CONFIRM' : 'RESPEC FREE', view.armed ? CONFIRM_PLATE : RESPEC_PLATE, enabled, hover === 'respec', pressed)
            return
        }
        // a paid respec carries its Gem price, the glyph after the number like the Traits scene's
        plateButton(s, RESPEC, '', RESPEC_PLATE, enabled, hover === 'respec', pressed)
        const label = `RESPEC ${formatHq(view.respecGems, view.notation)}`
        const lw = textWidth(label) + 15
        const sink = enabled && hover === 'respec' && pressed ? 1 : 0
        const x0 = RESPEC.x + ((RESPEC.w - lw) >> 1)
        drawText(s, label, x0, RESPEC.y + 3 + sink, enabled ? C.white : C.stone2, { shadow: 1 })
        glyph(s, CURRENCY_ICONS.gems!, x0 + lw - 7, RESPEC.y + 5 + sink, true)
    }

    private drawControls(s: Surface, hover: TreeTarget | null, pressed: boolean): void {
        plateButton(s, ZOOM_OUT, '-', ZOOM_PLATE, true, hover === 'zoomOut', pressed)
        plateButton(s, ZOOM_IN, '+', ZOOM_PLATE, true, hover === 'zoomIn', pressed)
        plateButton(s, CENTER, 'O', ZOOM_PLATE, true, hover === 'center', pressed)
    }

    /** The node under the pointer, else the one picked; or what a control does; or how to get about. */
    private drawPanel(s: Surface, view: TreeView, states: Map<string, TreeNodeState>, selected: string | null, hovered: string | null,
        hover: TreeTarget | null, pressed: boolean): void {
        panel(s, PANEL.x, PANEL.y, PANEL.w, PANEL.h)
        const x = PANEL.x + 5
        const top = PANEL.y + 4
        const second = top + 7
        const shownId = hovered ?? selected
        const node = shownId ? NODE_BY_ID.get(shownId) : undefined
        if (!node || (hover && !hover.startsWith('node:') && hover !== 'buy' && hover !== 'panel')) {
            wrap(controlText(view, hover), PANEL.w - 10).slice(0, 2).forEach((l, i) => drawText(s, l, x, top + i * 7, C.stone3, { shadow: 1 }))
            return
        }
        const state = states.get(node.id)
        const level = state?.level ?? 0
        // the Buy, on the picked node only, takes the right end; the lines stop short of it
        const buying = node.id === selected
        const right = (buying ? BUY.x : PANEL.x + PANEL.w) - 5
        const nameW = drawText(s, node.name.toUpperCase(), x, top, PATH_RAMP[node.path][3], { shadow: 1 })
        const levelText = state?.maxLevel ? `LV ${level}/${state.maxLevel}` : `LV ${level}`
        drawText(s, levelText, x + nameW + 6, top, state?.block === 'maxed' ? C.gold3 : C.bone1, { shadow: 1 })
        drawText(s, scopeText(node, state), right, top, state && !state.active ? C.red3 : C.stone3, { align: 2, shadow: 1 })
        const effect = effectText(node, level)
        drawText(s, textWidth(effect) <= right - x ? effect : effectText(node, level, true), x, second, C.bone1, { shadow: 1 })
        if (!buying) return
        const label = state?.block === 'maxed' ? 'MAXED' : state?.block === 'locked' ? 'LOCKED' : `BUY ${formatHq(state?.nextCost ?? 0, view.notation)}`
        plateButton(s, BUY, label, BUY_PLATE, treeTargetEnabled(view, 'buy', selected), hover === 'buy', pressed)
    }
}
