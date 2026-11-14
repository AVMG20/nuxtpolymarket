// Gridworks renderer and controls. Pixi draws the plot top-down; this file owns
// the camera, the build tools and every bit of feedback (ghosts, pops, dust,
// floating refunds, sounds). Game rules live in #shared/utils/gridworks.
import { Application, Container, Graphics, Sprite, Text, Texture, CullerPlugin, extensions, type FederatedPointerEvent } from 'pixi.js'
import { BELT_MK, BUILDINGS, CHUNK, ITEMS, ITEM_IDS, MAP_TILES, RECIPES, chunkCost, type ItemId, type Kind, type Stock } from '#shared/utils/gridworks/defs'
import { DIRS, buildGraph, key3, layersOf, localToWorld, occupancy, placeError, recipeOf, rot, size, type Dir, type Entity, type Graph, type PlaceError } from '#shared/utils/gridworks/layout'
import { canAfford, spentOn, type GridState, type Op, type OpError } from '#shared/utils/gridworks/game'
import type { Solution } from '#shared/utils/gridworks/flow'
import { chunkNeighbours, oreAt, oreMap, type OreMap } from '#shared/utils/gridworks/world'
import { BELT_FRAMES, BELT_PERIOD, TILE, loadTextures, type BeltShape, type GridTextures } from './textures'
import { GridSfx } from './sfx'

extensions.add(CullerPlugin)

export type Tool = { mode: 'select' } | { mode: 'build', kind: Kind } | { mode: 'remove' }

export interface HoverInfo {
    x: number
    y: number
    title: string
    lines: string[]
    error?: string
}

export interface Selected { e: Entity, flow: number, busy: number }

export interface WorldPlot { userId: string, name: string, seed: number, entities: Entity[], chunks: string[] }

export interface EngineHooks {
    commit(ops: Op[]): (OpError | null)[]
    stock(): Stock
    onSelect(sel: Selected | null): void
    onHover(info: HoverInfo | null): void
    onTool(tool: Tool, rotation: Dir): void
    onLayer(layer: number): void
}

const ERROR_TEXT: Record<PlaceError | 'afford', string> = {
    bounds: 'Off the map',
    land: 'You don\'t own this land yet',
    blocked: 'Something is in the way',
    ore: 'Needs the right ore underneath',
    layer: 'That layer isn\'t researched yet',
    locked: 'Not researched yet',
    recipe: 'Unknown recipe',
    afford: 'Not enough resources'
}

const KIND_COLOR: Partial<Record<Kind, number>> = {
    smelter: 0xf08a3c, kiln: 0xd2603a, press: 0x9aa3ae, mixer: 0x4fa3e8, assembler: 0x8a6be0, reactor: 0xd946ef,
    refinery: 0x7c5cc4, grinder: 0x3b9be0, miner: 0x8b929c, pumpjack: 0x4b5563, 'crystal-drill': 0x3fb7e8,
    storage: 0xe9edf2, lab: 0xa78bfa, silo: 0xcbd5e1, amplifier: 0x3fbf6a,
    merger: 0xcfd5dd, splitter: 0xcfd5dd, 'smart-splitter': 0xf6d860, 'overflow-splitter': 0xf8a5b5
}

const ease = {
    outBack: (p: number, s = 1.9) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2),
    outCubic: (p: number) => 1 - Math.pow(1 - p, 3),
    inCubic: (p: number) => p * p * p,
    outQuad: (p: number) => 1 - (1 - p) * (1 - p)
}

interface Tween { start: number, dur: number, fn: (p: number) => void, done?: () => void }

interface Particle { s: Sprite, vx: number, vy: number, life: number, max: number, grav: number, spin: number }

interface EntView {
    key: string
    sig: string
    e: Entity
    root: Container
    body: Sprite
    spin?: Sprite
    icon?: Sprite
    /** Index in the current solution, -1 when unknown. */
    sol: number
    /** Belts: drawing shape, distance from the line's head (tiles), layer. */
    shape?: BeltShape
    chain?: number
    phase: number
    busy: number
    lifted?: boolean
    /** performance.now() until which a tween owns the root's scale. */
    animUntil?: number
}

type Drag =
    | { kind: 'pan', sx: number, sy: number, cx: number, cy: number, moved: boolean, lastX: number, lastY: number, lastT: number }
    | { kind: 'maybe', sx: number, sy: number, view: EntView }
    | { kind: 'move', view: EntView, from: Entity, r: Dir, grabDx: number, grabDy: number }
    | { kind: 'belt', start: [number, number], axis: 'x' | 'y' | null, path: { x: number, y: number, r: Dir }[] }
    | { kind: 'paint', last: [number, number] | null, placed: number }
    | { kind: 'erase', last: [number, number] | null, count: number, sx: number, sy: number, moved: boolean }
    | { kind: 'mine', x: number, y: number, next: number }

function sigOf(e: Entity): string {
    return `${e.k}|${e.r}|${e.l ?? 0}|${e.mk ?? 1}|${e.recipe ?? ''}|${e.filter ?? ''}`
}
function keyOf(e: Entity): string {
    return `${e.x},${e.y},${layersOf(e)[0]}`
}

export class GridEngine {
    readonly sfx = new GridSfx()
    private app = new Application()
    private tex!: GridTextures
    private hooks: EngineHooks
    private host: HTMLElement
    private disposed = false
    private cleanups: (() => void)[] = []

    // Scene graph.
    private world = new Container()
    private ground = new Container()
    private others = new Container()
    private beltLayers = [new Container(), new Container(), new Container()]
    private itemLayers = [new Container(), new Container(), new Container()]
    private entLayers = [new Container(), new Container(), new Container()]
    private overlay = new Graphics()
    private ghostLayer = new Container()
    private fx = new Container()
    private buyLayer = new Container()

    // Camera.
    private cam = { x: 0, y: 0, zoom: 0.8, tx: 0, ty: 0, tz: 0.8, vx: 0, vy: 0 }
    private keys = new Set<string>()
    private spaceDown = false

    // Game view.
    private state: GridState | null = null
    private ore: OreMap | null = null
    private graph: Graph | null = null
    private occ = new Map<number, number>()
    private views = new Map<string, EntView>()
    private belts: EntView[] = []
    private sol: Solution | null = null
    private solIndex = new Map<string, number>()
    private groundKey = ''
    private plotOrigin: [number, number] = [0, 0]

    // Tools and input.
    tool: Tool = { mode: 'select' }
    rotation: Dir = 0
    layer = 0
    private recipe: string | undefined
    private pointer = { sx: 0, sy: 0, wx: 0, wy: 0, tx: 0, ty: 0, inside: false }
    private drag: Drag | null = null
    private hover: EntView | null = null
    private selected: EntView | null = null
    private ghost = new Container()
    private ghostBody = new Sprite()
    private ghostRect = new Graphics()
    private ghostArrow = new Graphics()
    private ghostPos = { x: 0, y: 0, rot: 0, shake: 0 }
    private pathGhosts: Sprite[] = []
    private pathMarks = new Graphics()
    private undoStack: Op[][] = []
    private redoStack: Op[][] = []

    // Animation.
    private tweens: Tween[] = []
    private particles: Particle[] = []
    private itemPool: Sprite[][] = [[], [], []]
    private time = 0
    private beltFrame = ''
    /** Set while committing ops whose motion the caller animates itself. */
    private quiet = false

    constructor(host: HTMLElement, hooks: EngineHooks) {
        this.host = host
        this.hooks = hooks
    }

    async init() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        await this.app.init({
            resizeTo: this.host,
            background: 0x15181d,
            antialias: true,
            resolution: Math.max(1, dpr),
            autoDensity: true,
            preference: 'webgl'
        })
        if (this.disposed) {
            this.app.destroy(true)
            return
        }
        this.host.appendChild(this.app.canvas)
        this.app.canvas.style.touchAction = 'none'
        this.tex = await loadTextures(this.app.renderer)

        const stage = this.app.stage
        stage.addChild(this.world)
        this.world.addChild(this.others, this.ground)
        for (let l = 0; l < 3; l++) this.world.addChild(this.beltLayers[l]!, this.itemLayers[l]!, this.entLayers[l]!)
        this.world.addChild(this.buyLayer, this.overlay, this.ghostLayer, this.fx)
        this.ghost.addChild(this.ghostRect, this.ghostBody, this.ghostArrow)
        this.ghostBody.anchor.set(0.5)
        this.ghostLayer.addChild(this.pathMarks, this.ghost)
        this.ghost.visible = false

        this.bindInput()
        this.app.ticker.add(t => this.frame(t.deltaMS / 1000))
    }

    destroy() {
        this.disposed = true
        for (const off of this.cleanups) off()
        try {
            this.app.destroy(true, { children: true })
        } catch { /* not initialised yet */ }
    }

    // ---- public API -----------------------------------------------------------------

    /** The predicted plot changed: diff the entity sprites and play enter/exit motion. */
    setState(s: GridState, opts: { animate?: boolean } = {}) {
        const first = !this.state
        this.state = s
        this.ore = oreMap(s.seed)
        this.graph = buildGraph(s.entities)
        this.occ = this.graph.occ
        const seen = new Set<string>()
        s.entities.forEach((e) => {
            const key = keyOf(e)
            seen.add(key)
            const sig = sigOf(e)
            const old = this.views.get(key)
            if (old && old.sig === sig && old.e.x === e.x && old.e.y === e.y) {
                old.e = e
                return
            }
            if (old) this.dropView(old, false)
            const v = this.makeView(e)
            this.views.set(key, v)
            if (!first && !this.quiet && opts.animate !== false && !old) this.popIn(v)
        })
        for (const [key, v] of this.views) {
            if (!seen.has(key)) {
                this.views.delete(key)
                if (v.lifted) continue
                this.dropView(v, !first && opts.animate !== false)
            }
        }
        this.layoutBelts()
        this.mapSolution()
        this.drawGround()
        if (this.selected) {
            const v = this.views.get(this.selected.key)
            this.selected = v ?? null
            this.emitSelect()
        }
        if (first) this.focusPlot(true)
    }

    setSolution(sol: Solution | null, entities: readonly Entity[]) {
        this.sol = sol
        this.solIndex = new Map(entities.map((e, i) => [`${keyOf(e)}|${sigOf(e)}`, i]))
        this.mapSolution()
        if (this.selected) this.emitSelect()
    }

    setWorld(plots: WorldPlot[], me: string) {
        if (!this.tex) return
        this.others.removeChildren().forEach(c => c.destroy({ children: true }))
        const cols = Math.max(1, Math.ceil(Math.sqrt(plots.length)))
        const span = (MAP_TILES + 24) * TILE
        const idx = Math.max(0, plots.findIndex(p => p.userId === me))
        const myCol = idx % cols
        const myRow = Math.floor(idx / cols)
        plots.forEach((p, i) => {
            if (p.userId === me) return
            const ox = ((i % cols) - myCol) * span
            const oy = (Math.floor(i / cols) - myRow) * span
            this.others.addChild(this.buildOtherPlot(p, ox, oy))
        })
    }

    setTool(tool: Tool) {
        if (this.drag && this.drag.kind !== 'pan') this.cancelDrag()
        this.tool = tool
        if (tool.mode === 'build') {
            const def = BUILDINGS[tool.kind]
            this.recipe = def.recipes?.[0]
            if (def.role !== 'belt' && def.role !== 'ramp') this.layer = 0
            this.ghostBody.texture = this.kindTexture(tool.kind)
            this.ghostRot(true)
            this.select(null)
        }
        this.ghost.visible = tool.mode === 'build' && this.pointer.inside
        this.sfx.tool()
        this.hooks.onTool(this.tool, this.rotation)
        this.applyLayerAlpha()
    }

    setLayer(l: number) {
        this.layer = Math.max(0, Math.min(2, l))
        this.applyLayerAlpha()
        this.hooks.onLayer(this.layer)
        this.sfx.tool()
    }

    rotate(by: 1 | -1 = 1) {
        // Rotate whatever is in hand, or the building under the cursor.
        if (this.drag?.kind === 'move') {
            this.drag.r = rot(this.drag.r, by)
            this.sfx.rotate()
            this.tweenRotation(this.drag.view, this.drag.r)
            return
        }
        if (this.tool.mode === 'build') {
            this.rotation = rot(this.rotation, by)
            this.ghostRot(false)
            this.sfx.rotate()
            this.hooks.onTool(this.tool, this.rotation)
            return
        }
        const v = this.hover ?? this.selected
        if (!v) return
        const r = rot(v.e.r, by)
        const l = layersOf(v.e)[0]!
        const old = v.e
        const [err] = this.hooks.commit([{ op: 'rotate', x: old.x, y: old.y, l, r }])
        if (err) return this.reject(old.x, old.y, err)
        this.pushUndo([{ op: 'rotate', x: old.x, y: old.y, l, r: old.r }])
        this.sfx.rotate()
        const nv = this.views.get(v.key)
        if (nv) {
            nv.body.rotation = old.r * Math.PI / 2
            this.tweenRotation(nv, r)
            if (this.hover === v) this.hover = nv
            if (this.selected === v) this.select(nv)
        }
    }

    undo() { this.history(this.undoStack, this.redoStack) }
    redo() { this.history(this.redoStack, this.undoStack) }

    focusPlot(instant = false) {
        const s = this.state
        if (!s) return
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const c of s.chunks) {
            const [cx, cy] = c.split(',').map(Number) as [number, number]
            minX = Math.min(minX, cx); minY = Math.min(minY, cy); maxX = Math.max(maxX, cx + 1); maxY = Math.max(maxY, cy + 1)
        }
        const w = this.app.screen.width
        const h = this.app.screen.height
        const span = Math.max((maxX - minX) * CHUNK * TILE / w, (maxY - minY) * CHUNK * TILE / h)
        this.cam.tz = Math.min(1.1, Math.max(0.2, 0.82 / span))
        this.cam.tx = (minX + maxX) / 2 * CHUNK * TILE
        this.cam.ty = (minY + maxY) / 2 * CHUNK * TILE
        if (instant) {
            this.cam.zoom = this.cam.tz
            this.cam.x = this.cam.tx
            this.cam.y = this.cam.ty
        }
    }

    zoomBy(f: number) {
        this.cam.tz = Math.min(2.2, Math.max(0.08, this.cam.tz * f))
    }

    select(v: EntView | null) {
        if (this.selected === v) return
        this.selected = v
        if (v) this.sfx.select()
        this.emitSelect()
    }

    /** Selected entity actions from the side panel. */
    act(op: 'remove' | 'upgrade' | 'rotate' | 'recipe' | 'filter', arg?: string | null) {
        const v = this.selected
        if (!v) return
        const e = v.e
        const l = layersOf(e)[0]!
        if (op === 'remove') return this.eraseAt(e.x, e.y, l)
        if (op === 'rotate') {
            this.hover = v
            return this.rotate(1)
        }
        if (op === 'upgrade') {
            const [err] = this.hooks.commit([{ op: 'upgrade', x: e.x, y: e.y, l }])
            if (err) return this.reject(e.x, e.y, err)
            this.sfx.upgrade()
            const nv = this.views.get(keyOf(e))
            if (nv) this.burst(nv, 0xffd34d, 12)
            return
        }
        if (op === 'recipe' && arg) {
            const [err] = this.hooks.commit([{ op: 'recipe', x: e.x, y: e.y, recipe: arg }])
            if (err) return this.reject(e.x, e.y, err)
            this.pushUndo([{ op: 'recipe', x: e.x, y: e.y, recipe: recipeOf(e) ?? arg }])
            this.sfx.select()
            return
        }
        if (op === 'filter') {
            const [err] = this.hooks.commit([{ op: 'filter', x: e.x, y: e.y, item: (arg ?? null) as ItemId | null }])
            if (err) return this.reject(e.x, e.y, err)
            this.sfx.select()
        }
    }

    // ---- views --------------------------------------------------------------------

    private kindTexture(k: Kind): Texture {
        if (BUILDINGS[k].role === 'belt') return this.tex.belt[0]!.straight[0]!
        return this.tex.building[k] ?? Texture.WHITE
    }

    private centerOf(e: Entity): [number, number] {
        const [w, h] = size(e.k, e.r)
        return [(e.x + w / 2) * TILE, (e.y + h / 2) * TILE]
    }

    private makeView(e: Entity): EntView {
        const def = BUILDINGS[e.k]
        const root = new Container()
        root.cullable = true
        const [cx, cy] = this.centerOf(e)
        root.position.set(cx, cy)
        const body = new Sprite(this.kindTexture(e.k))
        body.anchor.set(0.5)
        body.width = def.w * TILE
        body.height = def.h * TILE
        body.rotation = e.r * Math.PI / 2
        root.addChild(body)
        const v: EntView = { key: keyOf(e), sig: sigOf(e), e, root, body, sol: -1, phase: Math.random() * 6.28, busy: 0 }
        const spinTex = this.tex.spin[e.k]
        if (spinTex) {
            v.spin = new Sprite(spinTex)
            v.spin.anchor.set(0.5)
            v.spin.width = TILE
            v.spin.height = TILE
            root.addChild(v.spin)
        }
        const rec = recipeOf(e)
        if (rec && RECIPES[rec]) {
            v.icon = new Sprite(this.tex.item[RECIPES[rec].out])
            v.icon.anchor.set(0.5)
            v.icon.width = v.icon.height = 24
            const [ox, oy] = localToWorld(e.k, e.r, 0, def.outRow ?? 0)
            v.icon.position.set((e.x + ox + 0.5) * TILE - cx, (e.y + oy + 0.5) * TILE - cy - (e.r === 0 ? 2 : 0))
            root.addChild(v.icon)
        }
        if (e.k === 'smart-splitter' && e.filter) {
            const f = new Sprite(this.tex.item[e.filter])
            f.anchor.set(0.5)
            f.width = f.height = 18
            const c = Math.cos(e.r * Math.PI / 2)
            const sn = Math.sin(e.r * Math.PI / 2)
            f.position.set(-17 * c + 17 * sn, -17 * sn - 17 * c)
            root.addChild(f)
        }
        if ((e.mk ?? 1) > 1 && def.role !== 'belt') {
            const pip = new Graphics()
            for (let i = 0; i < (e.mk ?? 1) - 1; i++) pip.circle(-def.w * TILE / 2 + 9 + i * 7, def.h * TILE / 2 - 9, 2.6).fill(0xffd34d).stroke({ width: 1.2, color: 0x2b3038 })
            pip.rotation = 0
            root.addChild(pip)
        }
        const layer = def.role === 'belt' ? this.beltLayers[e.l ?? 0]! : this.entLayers[def.role === 'ramp' ? Math.min(2, (e.l ?? 0)) : 0]!
        layer.addChild(root)
        return v
    }

    private dropView(v: EntView, animate: boolean) {
        if (this.hover === v) this.hover = null
        if (!animate) {
            v.root.destroy({ children: true })
            return
        }
        const root = v.root
        root.parent?.removeChild(root)
        this.fx.addChild(root)
        const s0 = root.scale.x
        const tiles = BUILDINGS[v.e.k].w * BUILDINGS[v.e.k].h
        this.tween(220, (p) => {
            const k = p < 0.25 ? s0 * (1 + 0.12 * ease.outQuad(p / 0.25)) : s0 * 1.12 * (1 - ease.inCubic((p - 0.25) / 0.75))
            root.scale.set(Math.max(0.001, k))
            root.alpha = 1 - ease.inCubic(p)
            root.rotation = 0.35 * ease.inCubic(p)
        }, () => root.destroy({ children: true }))
        this.burst(v, KIND_COLOR[v.e.k] ?? 0x9aa3ae, BUILDINGS[v.e.k].role === 'belt' ? 4 : 8 + tiles * 2)
    }

    private popIn(v: EntView) {
        const belt = BUILDINGS[v.e.k].role === 'belt'
        const root = v.root
        root.scale.set(0.5)
        v.animUntil = performance.now() + 300
        this.tween(belt ? 170 : 280, (p) => root.scale.set(ease.outBack(p, belt ? 1.4 : 2.2)))
        if (!belt) {
            const def = BUILDINGS[v.e.k]
            const [w, h] = size(v.e.k, v.e.r)
            const flash = new Graphics().roundRect(-w * TILE / 2 + 3, -h * TILE / 2 + 3, w * TILE - 6, h * TILE - 6, 10).fill(0xffffff)
            flash.alpha = 0.7
            root.addChild(flash)
            this.tween(200, p => { flash.alpha = 0.7 * (1 - p) }, () => flash.destroy())
            this.dust(v, 6 + def.w * def.h * 3)
        }
    }

    /** Belt shapes (straight / curves) and each tile's distance along its line. */
    private layoutBelts() {
        const s = this.state!
        const g = this.graph!
        this.belts = []
        const idxView: (EntView | undefined)[] = s.entities.map(e => this.views.get(keyOf(e)))
        s.entities.forEach((e, i) => {
            const v = idxView[i]
            if (!v || BUILDINGS[e.k].role !== 'belt') return
            const inc = g.inc[i]!
            let shape: BeltShape = 'straight'
            if (inc.length === 1 && inc[0]!.side === 'side') {
                const from = s.entities[inc[0]!.from]!
                const fromDir = outputDirInto(from, e, g, inc[0]!.port)
                // Fed from the left side means the items arrive moving right-turned.
                shape = fromDir === rot(e.r, 1) ? 'curveL' : 'curveR'
            }
            v.shape = shape
            let chain = 0
            let cur = i
            const guard = new Set<number>()
            while (chain < 400) {
                guard.add(cur)
                const back = g.inc[cur]!.find(l => BUILDINGS[s.entities[l.from]!.k].role === 'belt')
                if (!back || guard.has(back.from)) break
                cur = back.from
                chain++
            }
            v.chain = chain
            this.belts.push(v)
        })
        this.beltFrame = ''
    }

    private mapSolution() {
        for (const v of this.views.values()) v.sol = this.solIndex.get(`${v.key}|${v.sig}`) ?? -1
    }

    private emitSelect() {
        const v = this.selected
        if (!v) return this.hooks.onSelect(null)
        const i = v.sol
        this.hooks.onSelect({ e: v.e, flow: i >= 0 && this.sol ? this.sol.flow[i]! : 0, busy: i >= 0 && this.sol ? this.sol.busy[i]! : 0 })
    }

    // ---- ground -------------------------------------------------------------------

    private drawGround() {
        const s = this.state!
        const buyable = s.done.includes('land-1')
        const key = `${s.seed}|${s.chunks.join(';')}|${buyable}|${Math.floor(this.buyCostKey())}`
        if (key === this.groundKey) return
        this.groundKey = key
        this.ground.removeChildren().forEach(c => c.destroy({ children: true }))
        this.buyLayer.removeChildren().forEach(c => c.destroy({ children: true }))
        const owned = new Set(s.chunks)
        const g = new Graphics()
        const ore = this.ore!
        // Unowned map: dim tiles so the ore you could buy is still readable.
        g.rect(0, 0, MAP_TILES * TILE, MAP_TILES * TILE).fill(0x181b21)
        for (const c of owned) {
            const [cx, cy] = c.split(',').map(Number) as [number, number]
            g.rect(cx * CHUNK * TILE, cy * CHUNK * TILE, CHUNK * TILE, CHUNK * TILE).fill(0x262b33)
        }
        for (let y = 0; y < MAP_TILES; y++) {
            for (let x = 0; x < MAP_TILES; x++) {
                const o = oreAt(ore, x, y)
                if (!o) continue
                const own = owned.has(`${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`)
                g.roundRect(x * TILE + 3, y * TILE + 3, TILE - 6, TILE - 6, 8).fill({ color: parseInt(ITEMS[o].color.slice(1), 16), alpha: own ? 0.28 : 0.12 })
            }
        }
        // Grid lines on owned land only.
        for (const c of owned) {
            const [cx, cy] = c.split(',').map(Number) as [number, number]
            const x0 = cx * CHUNK * TILE
            const y0 = cy * CHUNK * TILE
            for (let i = 1; i < CHUNK; i++) {
                g.moveTo(x0 + i * TILE, y0).lineTo(x0 + i * TILE, y0 + CHUNK * TILE)
                g.moveTo(x0, y0 + i * TILE).lineTo(x0 + CHUNK * TILE, y0 + i * TILE)
            }
        }
        g.stroke({ width: 1.5, color: 0x323843, alpha: 1 })
        // Plot outline around owned chunks.
        for (const c of owned) {
            const [cx, cy] = c.split(',').map(Number) as [number, number]
            const x0 = cx * CHUNK * TILE
            const y0 = cy * CHUNK * TILE
            const E = CHUNK * TILE
            if (!owned.has(`${cx},${cy - 1}`)) g.moveTo(x0, y0).lineTo(x0 + E, y0)
            if (!owned.has(`${cx},${cy + 1}`)) g.moveTo(x0, y0 + E).lineTo(x0 + E, y0 + E)
            if (!owned.has(`${cx - 1},${cy}`)) g.moveTo(x0, y0).lineTo(x0, y0 + E)
            if (!owned.has(`${cx + 1},${cy}`)) g.moveTo(x0 + E, y0).lineTo(x0 + E, y0 + E)
        }
        g.stroke({ width: 4, color: 0x5b6575, alpha: 0.9 })
        this.ground.addChild(g)
        // Ore icons on each ore tile, deterministic jitter.
        for (let y = 0; y < MAP_TILES; y++) {
            for (let x = 0; x < MAP_TILES; x++) {
                const o = oreAt(ore, x, y)
                if (!o) continue
                const own = owned.has(`${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`)
                const sp = new Sprite(this.tex.item[o])
                sp.anchor.set(0.5)
                const h = ((x * 73856093) ^ (y * 19349663)) >>> 0
                sp.width = sp.height = 26 + (h % 7)
                sp.position.set((x + 0.5) * TILE + ((h >> 3) % 9) - 4, (y + 0.5) * TILE + ((h >> 7) % 9) - 4)
                sp.rotation = ((h >> 11) % 628) / 100
                sp.alpha = own ? 0.55 : 0.22
                sp.cullable = true
                this.ground.addChild(sp)
            }
        }
        // Buyable neighbours get a price tag.
        if (buyable) {
            const cost = chunkCost(s.chunks.length - 4)
            const label = Object.entries(cost).map(([k, v]) => `${fmt(v as number)} ${ITEMS[k as ItemId].name.toLowerCase()}`).join(' + ')
            const seen = new Set<string>()
            for (const c of owned) {
                for (const n of chunkNeighbours(c)) {
                    if (owned.has(n) || seen.has(n)) continue
                    seen.add(n)
                    const [cx, cy] = n.split(',').map(Number) as [number, number]
                    const tag = new Container()
                    tag.position.set((cx + 0.5) * CHUNK * TILE, (cy + 0.5) * CHUNK * TILE)
                    const t = new Text({ text: `+ Buy land\n${label}`, style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 30, fill: 0xe6e9ee, align: 'center', fontWeight: '600', lineHeight: 40 } })
                    t.anchor.set(0.5)
                    const bg = new Graphics().roundRect(-t.width / 2 - 22, -t.height / 2 - 14, t.width + 44, t.height + 28, 22).fill({ color: 0x0f1115, alpha: 0.72 }).stroke({ width: 2, color: 0x5b6575 })
                    tag.addChild(bg, t)
                    tag.alpha = 0.75
                    tag.label = n
                    this.buyLayer.addChild(tag)
                }
            }
        }
    }

    private buyCostKey(): number {
        const s = this.state!
        const cost = chunkCost(s.chunks.length - 4)
        return canAfford(this.hooks.stock(), cost) ? 1 : 0
    }

    private buildOtherPlot(p: WorldPlot, ox: number, oy: number): Container {
        const c = new Container()
        c.position.set(ox, oy)
        const g = new Graphics()
        const ore = oreMap(p.seed)
        const owned = new Set(p.chunks)
        let minX = Infinity, minY = Infinity, maxX = -Infinity
        for (const k of owned) {
            const [cx, cy] = k.split(',').map(Number) as [number, number]
            g.rect(cx * CHUNK * TILE, cy * CHUNK * TILE, CHUNK * TILE, CHUNK * TILE).fill(0x22262d)
            minX = Math.min(minX, cx); minY = Math.min(minY, cy); maxX = Math.max(maxX, cx + 1)
            for (let y = cy * CHUNK; y < (cy + 1) * CHUNK; y++) {
                for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++) {
                    const o = oreAt(ore, x, y)
                    if (o) g.roundRect(x * TILE + 3, y * TILE + 3, TILE - 6, TILE - 6, 8).fill({ color: parseInt(ITEMS[o].color.slice(1), 16), alpha: 0.25 })
                }
            }
        }
        c.addChild(g)
        const graph = buildGraph(p.entities)
        p.entities.forEach((e, i) => {
            const def = BUILDINGS[e.k]
            let tex = this.tex.building[e.k]
            if (def.role === 'belt') {
                const inc = graph.inc[i]!
                let shape: BeltShape = 'straight'
                if (inc.length === 1 && inc[0]!.side === 'side') {
                    shape = outputDirInto(p.entities[inc[0]!.from]!, e, graph, inc[0]!.port) === rot(e.r, 1) ? 'curveL' : 'curveR'
                }
                tex = this.tex.belt[Math.min(4, e.mk ?? 1) - 1]![shape][0]
            }
            if (!tex) return
            const sp = new Sprite(tex)
            sp.anchor.set(0.5)
            sp.width = def.w * TILE
            sp.height = def.h * TILE
            sp.rotation = e.r * Math.PI / 2
            const [w, h] = size(e.k, e.r)
            sp.position.set((e.x + w / 2) * TILE, (e.y + h / 2) * TILE)
            sp.cullable = true
            c.addChild(sp)
        })
        if (Number.isFinite(minX)) {
            const name = new Text({ text: p.name, style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 96, fill: 0xe6e9ee, fontWeight: '700' } })
            name.anchor.set(0.5, 1)
            name.position.set((minX + maxX) / 2 * CHUNK * TILE, minY * CHUNK * TILE - 40)
            name.alpha = 0.85
            c.addChild(name)
        }
        return c
    }

    // ---- input --------------------------------------------------------------------

    private bindInput() {
        const canvas = this.app.canvas
        const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (ev: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
            el.addEventListener(type, fn as EventListener, opts)
            this.cleanups.push(() => el.removeEventListener(type, fn as EventListener, opts))
        }
        on(canvas, 'pointerdown', ev => this.onDown(ev))
        on(window, 'pointermove', ev => this.onMove(ev))
        on(window, 'pointerup', ev => this.onUp(ev))
        on(canvas, 'pointerenter', () => { this.pointer.inside = true; this.ghost.visible = this.tool.mode === 'build' })
        on(canvas, 'pointerleave', () => {
            this.pointer.inside = false
            this.ghost.visible = false
            this.setHover(null)
            this.hooks.onHover(null)
        })
        on(canvas, 'contextmenu', ev => ev.preventDefault())
        on(canvas, 'wheel', ev => this.onWheel(ev), { passive: false })
        on(window, 'keydown', ev => this.onKey(ev, true))
        on(window, 'keyup', ev => this.onKey(ev, false))
        on(window, 'blur', () => { this.keys.clear(); this.spaceDown = false })
    }

    private screenToWorld(sx: number, sy: number): [number, number] {
        const r = this.app.canvas.getBoundingClientRect()
        const x = (sx - r.left - this.world.x) / this.world.scale.x
        const y = (sy - r.top - this.world.y) / this.world.scale.y
        return [x, y]
    }

    private updatePointer(ev: PointerEvent | WheelEvent) {
        const [wx, wy] = this.screenToWorld(ev.clientX, ev.clientY)
        this.pointer.sx = ev.clientX
        this.pointer.sy = ev.clientY
        this.pointer.wx = wx
        this.pointer.wy = wy
        this.pointer.tx = Math.floor(wx / TILE)
        this.pointer.ty = Math.floor(wy / TILE)
    }

    /** The entity under a tile, preferring the active layer, then top-down. */
    private viewAt(x: number, y: number, prefer = this.layer): EntView | null {
        const order = this.tool.mode === 'select' ? [2, 1, 0] : [prefer, ...[2, 1, 0].filter(l => l !== prefer)]
        for (const l of order) {
            const i = this.occ.get(key3(x, y, l))
            if (i === undefined) continue
            const e = this.state!.entities[i]
            if (e) return this.views.get(keyOf(e)) ?? null
        }
        return null
    }

    private onDown(ev: PointerEvent) {
        if (!this.state) return
        this.sfx.unlock()
        this.updatePointer(ev)
        this.app.canvas.setPointerCapture?.(ev.pointerId)
        const { tx, ty } = this.pointer
        if (ev.button === 1 || (ev.button === 0 && this.spaceDown)) return this.startPan(ev)
        if (ev.button === 2) {
            if (this.drag?.kind === 'move') return this.cancelDrag()
            if (this.drag?.kind === 'belt') return this.cancelDrag()
            this.drag = { kind: 'erase', last: null, count: 0, sx: ev.clientX, sy: ev.clientY, moved: false }
            this.eraseStep(tx, ty)
            return
        }
        if (ev.button !== 0) return
        if (this.tool.mode === 'remove') {
            this.drag = { kind: 'erase', last: null, count: 0, sx: ev.clientX, sy: ev.clientY, moved: true }
            this.eraseStep(tx, ty)
            return
        }
        if (this.tool.mode === 'build') {
            const role = BUILDINGS[this.tool.kind].role
            if (role === 'belt') {
                this.drag = { kind: 'belt', start: [tx, ty], axis: null, path: [{ x: tx, y: ty, r: this.rotation }] }
                this.sfx.beltTick(0)
                this.drawPath()
                return
            }
            this.drag = { kind: 'paint', last: null, placed: 0 }
            this.paintStep()
            return
        }
        // Select mode.
        const buy = this.buyTagAt(this.pointer.wx, this.pointer.wy)
        if (buy) return this.buyChunk(buy)
        const v = this.viewAt(tx, ty)
        if (v) {
            this.drag = { kind: 'maybe', sx: ev.clientX, sy: ev.clientY, view: v }
            return
        }
        const o = this.ore && oreAt(this.ore, tx, ty)
        if (o && o !== 'oil' && o !== 'crystal' && this.ownsTile(tx, ty)) {
            this.drag = { kind: 'mine', x: tx, y: ty, next: performance.now() + 260 }
            this.mine(tx, ty)
            return
        }
        this.select(null)
        this.startPan(ev)
    }

    private startPan(ev: PointerEvent) {
        this.drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, cx: this.cam.x, cy: this.cam.y, moved: false, lastX: ev.clientX, lastY: ev.clientY, lastT: performance.now() }
        this.cam.vx = this.cam.vy = 0
        this.app.canvas.style.cursor = 'grabbing'
    }

    private onMove(ev: PointerEvent) {
        if (!this.state) return
        const prevTx = this.pointer.tx
        const prevTy = this.pointer.ty
        this.updatePointer(ev)
        const d = this.drag
        const { tx, ty } = this.pointer
        const tileChanged = tx !== prevTx || ty !== prevTy
        if (d?.kind === 'pan') {
            const z = this.cam.zoom
            this.cam.x = this.cam.tx = d.cx - (ev.clientX - d.sx) / z
            this.cam.y = this.cam.ty = d.cy - (ev.clientY - d.sy) / z
            const now = performance.now()
            const dt = Math.max(1, now - d.lastT)
            this.cam.vx = -(ev.clientX - d.lastX) / z / dt * 1000
            this.cam.vy = -(ev.clientY - d.lastY) / z / dt * 1000
            d.lastX = ev.clientX; d.lastY = ev.clientY; d.lastT = now
            if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) > 4) d.moved = true
            return
        }
        if (d?.kind === 'maybe' && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) > 6) {
            this.pickUp(d.view)
            return
        }
        if (d?.kind === 'move') return
        if (d?.kind === 'erase') {
            if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) > 4) d.moved = true
            if (tileChanged) this.eraseStep(tx, ty)
            return
        }
        if (d?.kind === 'belt') {
            if (tileChanged) this.extendBelt(tx, ty)
            return
        }
        if (d?.kind === 'paint') {
            if (tileChanged) this.paintStep()
            return
        }
        if (d?.kind === 'mine' && (tx !== d.x || ty !== d.y)) {
            const o = this.ore && oreAt(this.ore, tx, ty)
            if (o && o !== 'oil' && o !== 'crystal' && this.ownsTile(tx, ty) && !this.viewAt(tx, ty)) {
                d.x = tx; d.y = ty
            }
        }
        if (tileChanged) this.refreshHover()
    }

    private onUp(ev: PointerEvent) {
        const d = this.drag
        if (!d) return
        this.updatePointer(ev)
        this.app.canvas.style.cursor = ''
        this.drag = null
        switch (d.kind) {
            case 'pan':
                if (!d.moved) { this.cam.vx = this.cam.vy = 0 }
                break
            case 'maybe':
                this.select(d.view)
                break
            case 'move':
                this.dropMoved(d)
                break
            case 'belt':
                this.commitBelt(d)
                break
            case 'erase':
                if (!d.moved && d.count === 0 && this.tool.mode === 'build') this.setTool({ mode: 'select' })
                break
        }
        this.refreshHover()
    }

    private onWheel(ev: WheelEvent) {
        ev.preventDefault()
        this.updatePointer(ev)
        const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY
        const f = Math.exp(-dy * 0.0016)
        const before = this.cam.tz
        this.cam.tz = Math.min(2.2, Math.max(0.08, this.cam.tz * f))
        // Zoom toward the cursor: keep the world point under it fixed at the target zoom.
        const r = this.app.canvas.getBoundingClientRect()
        const mx = ev.clientX - r.left - r.width / 2
        const my = ev.clientY - r.top - r.height / 2
        const wx = this.cam.tx + mx / before
        const wy = this.cam.ty + my / before
        this.cam.tx = wx - mx / this.cam.tz
        this.cam.ty = wy - my / this.cam.tz
    }

    private onKey(ev: KeyboardEvent, down: boolean) {
        const target = ev.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
        const k = ev.key.toLowerCase()
        if (k === ' ') {
            this.spaceDown = down
            if (down) ev.preventDefault()
            return
        }
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
            if (ev.ctrlKey || ev.metaKey) return
            if (down) this.keys.add(k)
            else this.keys.delete(k)
            if (k.startsWith('arrow')) ev.preventDefault()
            return
        }
        if (!down || ev.repeat && k !== 'r') return
        if ((ev.ctrlKey || ev.metaKey) && k === 'z') {
            ev.preventDefault()
            if (ev.shiftKey) this.redo()
            else this.undo()
            return
        }
        if ((ev.ctrlKey || ev.metaKey) && k === 'y') {
            ev.preventDefault()
            this.redo()
            return
        }
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return
        if (k === 'r') return this.rotate(ev.shiftKey ? -1 : 1)
        if (k === 'escape') {
            if (this.drag && this.drag.kind !== 'pan') return this.cancelDrag()
            if (this.tool.mode !== 'select') return this.setTool({ mode: 'select' })
            return this.select(null)
        }
        if (k === 'x' || k === 'delete') {
            if (this.selected && k === 'delete') return this.act('remove')
            return this.setTool(this.tool.mode === 'remove' ? { mode: 'select' } : { mode: 'remove' })
        }
        if (k === 'q') return this.pipette()
        if (k === 'l') {
            const max = this.state?.done.includes('skyway') ? 2 : this.state?.done.includes('bridges') ? 1 : 0
            return this.setLayer(this.layer >= max ? 0 : this.layer + 1)
        }
        if (k === 'h') return this.focusPlot()
    }

    private pipette() {
        const v = this.hover
        if (!v) {
            if (this.tool.mode !== 'select') this.setTool({ mode: 'select' })
            return
        }
        this.rotation = v.e.r
        this.setTool({ mode: 'build', kind: v.e.k })
        this.recipe = recipeOf(v.e)
        if (BUILDINGS[v.e.k].role === 'belt') this.setLayer(v.e.l ?? 0)
    }

    private ownsTile(x: number, y: number): boolean {
        return !!this.state?.chunks.includes(`${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`)
    }

    private buyTagAt(wx: number, wy: number): string | null {
        for (const tag of this.buyLayer.children) {
            const b = tag.getLocalBounds()
            if (Math.abs(wx - tag.x) <= b.width / 2 && Math.abs(wy - tag.y) <= b.height / 2) return tag.label
        }
        return null
    }

    private buyChunk(key: string) {
        const [err] = this.hooks.commit([{ op: 'chunk', key }])
        if (err) {
            this.sfx.invalid()
            const [cx, cy] = key.split(',').map(Number) as [number, number]
            this.floatText((cx + 0.5) * CHUNK * TILE, (cy + 0.5) * CHUNK * TILE + 80, err === 'afford' ? 'Not enough resources' : 'Can\'t buy this yet', 0xff6b6b, 34)
            return
        }
        this.sfx.chunk()
        const [cx, cy] = key.split(',').map(Number) as [number, number]
        const flash = new Graphics().rect(cx * CHUNK * TILE, cy * CHUNK * TILE, CHUNK * TILE, CHUNK * TILE).fill(0xffffff)
        this.fx.addChild(flash)
        this.tween(600, (p) => { flash.alpha = 0.35 * (1 - ease.outCubic(p)) }, () => flash.destroy())
    }

    // ---- hover & ghost --------------------------------------------------------------

    private setHover(v: EntView | null) {
        if (this.hover === v) return
        this.hover = v
        if (v && this.tool.mode !== 'build') this.sfx.hover()
    }

    private refreshHover() {
        if (!this.state || !this.pointer.inside) return
        const { tx, ty } = this.pointer
        if (this.tool.mode === 'build') {
            this.setHover(this.viewAt(tx, ty))
            const err = this.ghostError()
            const def = BUILDINGS[this.tool.kind]
            this.hooks.onHover({
                x: this.pointer.sx, y: this.pointer.sy, title: def.name,
                lines: [costLine(def.cost)],
                error: err ? ERROR_TEXT[err] : undefined
            })
            return
        }
        const v = this.viewAt(tx, ty)
        this.setHover(v)
        if (v) {
            const def = BUILDINGS[v.e.k]
            const lines: string[] = []
            const rec = recipeOf(v.e)
            if (rec) lines.push(`Makes ${ITEMS[RECIPES[rec]!.out].name.toLowerCase()}`)
            if (v.sol >= 0 && this.sol) {
                const f = this.sol.flow[v.sol]!
                if (def.role === 'machine' || def.role === 'source') lines.push(`${Math.round(this.sol.busy[v.sol]! * 100)}% busy`)
                else if (f > 0) lines.push(`${fmt(f * 60)}/min`)
            }
            if ((v.e.mk ?? 1) > 1) lines.push(`Mk${v.e.mk}`)
            this.hooks.onHover({ x: this.pointer.sx, y: this.pointer.sy, title: def.name, lines })
            return
        }
        const o = this.ore && oreAt(this.ore, tx, ty)
        if (o && this.ownsTile(tx, ty) && this.tool.mode === 'select') {
            const canMine = o !== 'oil' && o !== 'crystal'
            this.hooks.onHover({ x: this.pointer.sx, y: this.pointer.sy, title: ITEMS[o].name, lines: [canMine ? 'Click to mine by hand' : 'Needs a special extractor'] })
            return
        }
        this.hooks.onHover(null)
    }

    private ghostEntity(): Entity | null {
        if (this.tool.mode !== 'build') return null
        const k = this.tool.kind
        const [w, h] = size(k, this.rotation)
        const e: Entity = { k, x: this.pointer.tx - Math.floor((w - 1) / 2), y: this.pointer.ty - Math.floor((h - 1) / 2), r: this.rotation }
        const role = BUILDINGS[k].role
        if (role === 'belt' && this.layer) e.l = this.layer
        if (role === 'ramp') e.l = Math.min(1, this.layer)
        if (this.recipe && BUILDINGS[k].recipes?.includes(this.recipe)) e.recipe = this.recipe
        return e
    }

    /** The same building already standing where the ghost is (clicking it again rotates it). */
    private ghostTwin(e = this.ghostEntity()): Entity | null {
        if (!e || !this.state) return null
        const i = this.occ.get(key3(e.x, e.y, layersOf(e)[0]!))
        const t = i === undefined ? null : this.state.entities[i]!
        return t && t.k === e.k && t.x === e.x && t.y === e.y ? t : null
    }

    private ghostError(e = this.ghostEntity()): PlaceError | 'afford' | null {
        if (!e || !this.state || !this.ore) return null
        if (this.ghostTwin(e)) return null
        const err = placeError(this.state, this.ore, e, this.state.done, this.occ)
        if (err) return err
        return canAfford(this.hooks.stock(), BUILDINGS[e.k].cost) ? null : 'afford'
    }

    private ghostRot(instant: boolean) {
        if (instant) this.ghostPos.rot = this.rotation * Math.PI / 2
    }

    private updateGhost(dt: number) {
        const e = this.ghostEntity()
        if (!e || !this.pointer.inside || (this.drag && this.drag.kind === 'belt')) {
            this.ghost.visible = false
            return
        }
        this.ghost.visible = true
        const def = BUILDINGS[e.k]
        const [w, h] = size(e.k, e.r)
        const tx = (e.x + w / 2) * TILE
        const ty = (e.y + h / 2) * TILE
        // A stiff spring: follows the cursor tile by tile without lag, but never pops.
        const k = 1 - Math.exp(-dt * 32)
        if (Math.abs(tx - this.ghostPos.x) > TILE * 8 || Math.abs(ty - this.ghostPos.y) > TILE * 8) {
            this.ghostPos.x = tx; this.ghostPos.y = ty
        }
        this.ghostPos.x += (tx - this.ghostPos.x) * k
        this.ghostPos.y += (ty - this.ghostPos.y) * k
        const targetRot = e.r * Math.PI / 2
        let dr = targetRot - this.ghostPos.rot
        dr = Math.atan2(Math.sin(dr), Math.cos(dr))
        this.ghostPos.rot += dr * (1 - Math.exp(-dt * 26))
        this.ghostPos.shake *= Math.exp(-dt * 10)
        const shakeX = Math.sin(this.time * 70) * this.ghostPos.shake * 10
        this.ghost.position.set(this.ghostPos.x + shakeX, this.ghostPos.y)
        this.ghostBody.rotation = this.ghostPos.rot
        this.ghostBody.width = def.w * TILE
        this.ghostBody.height = def.h * TILE
        const err = this.ghostError(e)
        const ok = !err
        // Over its own twin the ghost fades back so the placed building shows.
        const twin = this.ghostTwin(e)
        const same = !!twin && twin.r === e.r
        this.ghostBody.alpha = same ? 0.18 : 0.62 + 0.08 * Math.sin(this.time * 5)
        this.ghostBody.tint = ok ? 0xffffff : 0xff8080
        const edge = same ? 0xffffff : ok ? 0x4ade80 : 0xf87171
        this.ghostRect.clear()
            .roundRect(-w * TILE / 2 + 1, -h * TILE / 2 + 1, w * TILE - 2, h * TILE - 2, 10)
            .fill({ color: edge, alpha: same ? 0.04 : ok ? 0.12 : 0.2 })
            .stroke({ width: 3, color: edge, alpha: same ? 0.35 : 0.9 })
        // Direction arrow beyond the output edge.
        this.ghostArrow.clear()
        if (def.role !== 'sink' && def.role !== 'passive') {
            const D = DIRS[e.r]!
            const outs = def.role === 'machine' ? localToWorld(e.k, e.r, def.w - 1, def.outRow ?? 0) : [0, 0]
            const ax = (e.x + outs[0]! + 0.5 + D[0] * 0.75) * TILE - (e.x + w / 2) * TILE
            const ay = (e.y + outs[1]! + 0.5 + D[1] * 0.75) * TILE - (e.y + h / 2) * TILE
            const ang = e.r * Math.PI / 2
            const p = (dx: number, dy: number) => [ax + dx * Math.cos(ang) - dy * Math.sin(ang), ay + dx * Math.sin(ang) + dy * Math.cos(ang)] as const
            const a = p(-8, -12), b = p(8, 0), c = p(-8, 12)
            this.ghostArrow.moveTo(a[0], a[1]).lineTo(b[0], b[1]).lineTo(c[0], c[1])
                .stroke({ width: 5, color: ok ? 0x4ade80 : 0xf87171, alpha: 0.85 + 0.15 * Math.sin(this.time * 6), cap: 'round', join: 'round' })
        }
        const layerDim = this.layer > 0 && (def.role === 'belt' || def.role === 'ramp')
        this.ghost.scale.set(layerDim ? 1.04 : 1)
    }

    // ---- build actions -------------------------------------------------------------

    private paintStep() {
        const e = this.ghostEntity()
        const d = this.drag
        if (!e || d?.kind !== 'paint') return
        // Only place on fresh tiles in a drag; the first click always tries.
        const at: [number, number] = [this.pointer.tx, this.pointer.ty]
        if (d.last && d.last[0] === at[0] && d.last[1] === at[1]) return
        const first = !d.last
        d.last = at
        const twin = this.ghostTwin(e)
        if (twin) {
            // Clicking a building with its own ghost turns it to the ghost's rotation.
            if (first && twin.r !== e.r) {
                const [res] = this.hooks.commit([{ op: 'rotate', x: twin.x, y: twin.y, l: layersOf(twin)[0]!, r: e.r }])
                if (!res) {
                    this.pushUndo([{ op: 'rotate', x: twin.x, y: twin.y, l: layersOf(twin)[0]!, r: twin.r }])
                    this.sfx.rotate()
                } else this.reject(e.x, e.y, res)
            }
            return
        }
        const err = this.ghostError(e)
        if (err) {
            if (first) this.reject(e.x, e.y, err)
            return
        }
        const [res] = this.hooks.commit([{ op: 'place', e }])
        if (res) {
            if (first) this.reject(e.x, e.y, res)
            return
        }
        d.placed++
        this.pushUndo([{ op: 'remove', x: e.x, y: e.y, l: layersOf(e)[0]! }])
        const [w, h] = size(e.k, e.r)
        this.sfx.place(w * h)
        if (BUILDINGS[e.k].w * BUILDINGS[e.k].h > 1) this.drag = null
    }

    private extendBelt(tx: number, ty: number) {
        const d = this.drag
        if (d?.kind !== 'belt') return
        const [sx, sy] = d.start
        const dx = tx - sx
        const dy = ty - sy
        if (!d.axis && (dx || dy)) d.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
        if (!dx && !dy) d.axis = null
        const path: { x: number, y: number, r: Dir }[] = []
        const dirX: Dir = dx >= 0 ? 0 : 2
        const dirY: Dir = dy >= 0 ? 1 : 3
        if (!d.axis) {
            path.push({ x: sx, y: sy, r: this.rotation })
        } else if (d.axis === 'x') {
            for (let i = 0; i <= Math.abs(dx); i++) path.push({ x: sx + Math.sign(dx) * i, y: sy, r: dirX })
            for (let j = 1; j <= Math.abs(dy); j++) path.push({ x: tx, y: sy + Math.sign(dy) * j, r: dirY })
            if (dy && path.length > Math.abs(dx)) path[Math.abs(dx)]!.r = dirY
        } else {
            for (let j = 0; j <= Math.abs(dy); j++) path.push({ x: sx, y: sy + Math.sign(dy) * j, r: dirY })
            for (let i = 1; i <= Math.abs(dx); i++) path.push({ x: sx + Math.sign(dx) * i, y: ty, r: dirX })
            if (dx && path.length > Math.abs(dy)) path[Math.abs(dy)]!.r = dirX
        }
        // Dragging onto a building ends the belt in front of it, pointing in.
        while (path.length > 1) {
            const last = path[path.length - 1]!
            const i = this.occ.get(key3(last.x, last.y, this.layer))
            if (i === undefined || BUILDINGS[this.state!.entities[i]!.k].role === 'belt') break
            path.pop()
            const prev = path[path.length - 1]!
            if (path.length === 1) prev.r = (last.x > prev.x ? 0 : last.y > prev.y ? 1 : last.x < prev.x ? 2 : 3) as Dir
        }
        if (path.length > 200) return
        const grew = path.length > d.path.length
        d.path = path
        if (grew) this.sfx.beltTick(path.length - 1)
        else this.sfx.hover()
        if (path.length > 1) {
            this.rotation = path[path.length - 1]!.r
            this.hooks.onTool(this.tool, this.rotation)
        }
        this.drawPath()
    }

    private beltStepPlan(p: { x: number, y: number, r: Dir }) {
        const s = this.state!
        const l = this.layer
        const existing = this.occ.get(key3(p.x, p.y, l))
        if (existing !== undefined) {
            const e = s.entities[existing]!
            if (BUILDINGS[e.k].role === 'belt' && e.x === p.x && e.y === p.y) return e.r === p.r ? 'same' as const : 'rotate' as const
            return 'blocked' as const
        }
        const e: Entity = { k: 'belt', x: p.x, y: p.y, r: p.r }
        if (l) e.l = l
        return placeError(s, this.ore!, e, s.done, this.occ) ? 'blocked' as const : 'place' as const
    }

    private drawPath() {
        const d = this.drag
        const g = this.pathMarks
        g.clear()
        if (d?.kind !== 'belt') {
            for (const sp of this.pathGhosts) sp.visible = false
            return
        }
        const stock = { ...this.hooks.stock() }
        const cost = BUILDINGS.belt.cost
        d.path.forEach((p, i) => {
            let sp = this.pathGhosts[i]
            if (!sp) {
                sp = new Sprite(this.tex.belt[0]!.straight[0]!)
                sp.anchor.set(0.5)
                sp.width = sp.height = TILE
                this.ghostLayer.addChild(sp)
                this.pathGhosts.push(sp)
            }
            sp.visible = true
            sp.position.set((p.x + 0.5) * TILE, (p.y + 0.5) * TILE)
            const prev = d.path[i - 1]
            const turnsIn = prev && prev.r !== p.r
            let shape: BeltShape = 'straight'
            if (turnsIn) shape = prev.r === rot(p.r, 1) ? 'curveL' : 'curveR'
            sp.texture = this.tex.belt[0]![shape][0]!
            sp.rotation = p.r * Math.PI / 2
            const plan = this.beltStepPlan(p)
            let ok = plan !== 'blocked'
            if (plan === 'place') {
                if (canAfford(stock, cost)) {
                    for (const [k, v] of Object.entries(cost)) stock[k as ItemId] = (stock[k as ItemId] ?? 0) - (v as number)
                } else ok = false
            }
            sp.alpha = plan === 'same' ? 0.35 : 0.7
            sp.tint = ok ? 0xffffff : 0xff7070
            g.roundRect(p.x * TILE + 2, p.y * TILE + 2, TILE - 4, TILE - 4, 8).stroke({ width: 3, color: ok ? 0x4ade80 : 0xf87171, alpha: 0.75 })
        })
        for (let i = d.path.length; i < this.pathGhosts.length; i++) this.pathGhosts[i]!.visible = false
    }

    private commitBelt(d: Extract<Drag, { kind: 'belt' }>) {
        const ops: Op[] = []
        const undo: Op[] = []
        const l = this.layer
        // The belt in hand when the drag never left its tile takes the ghost rotation.
        const path = d.path.length === 1 ? [{ ...d.path[0]!, r: this.rotation }] : d.path
        for (const p of path) {
            const plan = this.beltStepPlan(p)
            if (plan === 'place') {
                const e: Entity = { k: 'belt', x: p.x, y: p.y, r: p.r }
                if (l) e.l = l
                ops.push({ op: 'place', e })
                undo.push({ op: 'remove', x: p.x, y: p.y, l })
            } else if (plan === 'rotate') {
                const old = this.state!.entities[this.occ.get(key3(p.x, p.y, l))!]!
                ops.push({ op: 'rotate', x: p.x, y: p.y, l, r: p.r })
                undo.push({ op: 'rotate', x: p.x, y: p.y, l, r: old.r })
            }
        }
        this.drawPath()
        if (!ops.length) {
            // Re-clicking a belt that already faces this way is a quiet no-op.
            if (path.length === 1 && this.beltStepPlan(path[0]!) === 'blocked') this.reject(path[0]!.x, path[0]!.y, 'blocked')
            return
        }
        const before = new Set(this.views.keys())
        this.quiet = true
        const errs = this.hooks.commit(ops)
        this.quiet = false
        const okUndo = undo.filter((_, i) => !errs[i])
        if (okUndo.length) this.pushUndo(okUndo.reverse())
        // Pop each new belt in path order with a rising tick.
        let n = 0
        ops.forEach((op, i) => {
            if (errs[i]) return
            const x = op.op === 'place' ? op.e.x : (op as { x: number }).x
            const y = op.op === 'place' ? op.e.y : (op as { y: number }).y
            const key = `${x},${y},${l}`
            const v = this.views.get(key)
            if (!v) return
            const delay = n * 16
            const idx = n
            n++
            const isNew = !before.has(key)
            v.root.scale.set(isNew ? 0.001 : 1)
            v.animUntil = performance.now() + delay + 200
            this.tween(170, (p) => {
                v.root.scale.set(isNew ? Math.max(0.001, ease.outBack(p, 1.6)) : 1 + 0.12 * Math.sin(p * Math.PI))
            }, undefined, delay)
            setTimeout(() => this.sfx.beltLand(idx), delay)
        })
        if (errs.some(e => e === 'afford')) setTimeout(() => this.sfx.invalid(), n * 16 + 60)
    }

    private eraseStep(tx: number, ty: number) {
        const d = this.drag
        if (d?.kind !== 'erase') return
        // Fill gaps when the cursor jumps several tiles in one move.
        const pts = d.last ? line(d.last[0], d.last[1], tx, ty) : [[tx, ty] as [number, number]]
        d.last = [tx, ty]
        for (const [x, y] of pts) {
            const v = this.viewAt(x, y)
            if (!v) continue
            if (this.eraseAt(v.e.x, v.e.y, layersOf(v.e)[0]!)) d.count++
        }
    }

    private eraseAt(x: number, y: number, l: number): boolean {
        const i = this.occ.get(key3(x, y, l))
        if (i === undefined) return false
        const e = this.state!.entities[i]!
        const [err] = this.hooks.commit([{ op: 'remove', x, y, l }])
        if (err) {
            this.reject(x, y, err)
            return false
        }
        const redo: Op[] = [{ op: 'place', e: { ...e, mk: undefined } }]
        for (let mk = 2; mk <= (e.mk ?? 1); mk++) redo.push({ op: 'upgrade', x: e.x, y: e.y, l })
        this.pushUndo(redo)
        const [w, h] = size(e.k, e.r)
        this.sfx.remove(w * h)
        if (this.selected?.e === e) this.select(null)
        // Refund floats up from the spot.
        const refund = spentOn(e)
        const [cx, cy] = this.centerOf(e)
        const main = Object.entries(refund).sort((a, b) => (b[1] as number) - (a[1] as number))[0]
        if (main && BUILDINGS[e.k].role !== 'belt') {
            this.floatItem(cx, cy, main[0] as ItemId, `+${fmt(main[1] as number)}`)
            setTimeout(() => this.sfx.refund(), 90)
        }
        return true
    }

    private pickUp(v: EntView) {
        if (this.tool.mode !== 'select') return
        const e = v.e
        const [cx, cy] = this.centerOf(e)
        this.drag = { kind: 'move', view: v, from: { ...e }, r: e.r, grabDx: this.pointer.wx - cx, grabDy: this.pointer.wy - cy }
        v.lifted = true
        this.select(null)
        this.sfx.pickup()
        // Lift: grow, cast a shadow, float above everything.
        const root = v.root
        root.parent?.removeChild(root)
        this.fx.addChild(root)
        const shadow = new Graphics()
        const [w, h] = size(e.k, e.r)
        shadow.roundRect(-w * TILE / 2 + 6, -h * TILE / 2 + 10, w * TILE - 6, h * TILE - 6, 12).fill({ color: 0x000000, alpha: 0.35 })
        shadow.label = 'shadow'
        root.addChildAt(shadow, 0)
        this.tween(140, (p) => root.scale.set(1 + 0.1 * ease.outBack(p, 2)))
        this.app.canvas.style.cursor = 'grabbing'
    }

    private updateMove(dt: number) {
        const d = this.drag
        if (d?.kind !== 'move') return
        const root = d.view.root
        const tx = this.pointer.wx - d.grabDx
        const ty = this.pointer.wy - d.grabDy
        const k = 1 - Math.exp(-dt * 24)
        const vx = (tx - root.x) * k
        root.x += vx
        root.y += (ty - root.y) * k
        // Lean into the motion a little; it feels like you are carrying it.
        const lean = Math.max(-0.22, Math.min(0.22, vx / Math.max(dt, 0.001) / 4000))
        root.rotation += (lean - root.rotation) * (1 - Math.exp(-dt * 14))
        // Snap preview where it will land.
        const target = this.moveTarget(d)
        const err = this.moveError(d, target)
        const [w, h] = size(target.k, target.r)
        this.overlay.roundRect(target.x * TILE + 2, target.y * TILE + 2, w * TILE - 4, h * TILE - 4, 10)
            .fill({ color: err ? 0xf87171 : 0x4ade80, alpha: 0.14 })
            .stroke({ width: 3, color: err ? 0xf87171 : 0x4ade80, alpha: 0.9 })
    }

    private moveTarget(d: Extract<Drag, { kind: 'move' }>): Entity {
        const [w, h] = size(d.from.k, d.r)
        const cx = this.pointer.wx - d.grabDx
        const cy = this.pointer.wy - d.grabDy
        return { ...d.from, r: d.r, x: Math.round(cx / TILE - w / 2), y: Math.round(cy / TILE - h / 2) }
    }

    private moveError(d: Extract<Drag, { kind: 'move' }>, t: Entity): PlaceError | null {
        const s = this.state!
        const idx = s.entities.findIndex(e => e.x === d.from.x && e.y === d.from.y && e.k === d.from.k && (e.l ?? 0) === (d.from.l ?? 0))
        return placeError(s, this.ore!, t, s.done, this.occ, idx)
    }

    private dropMoved(d: Extract<Drag, { kind: 'move' }>) {
        const v = d.view
        const t = this.moveTarget(d)
        const l = layersOf(d.from)[0]!
        const unchanged = t.x === d.from.x && t.y === d.from.y && t.r === d.from.r
        this.quiet = true
        const err = unchanged ? null : this.hooks.commit([{ op: 'move', x: d.from.x, y: d.from.y, l, to: { x: t.x, y: t.y, r: t.r } }])[0]
        this.quiet = false
        v.lifted = false
        const root = v.root
        const settle = (e: Entity) => {
            const [cx, cy] = this.centerOf(e)
            const from = { x: root.x, y: root.y, r: root.rotation, s: root.scale.x }
            this.tween(160, (p) => {
                const q = ease.outCubic(p)
                root.x = from.x + (cx - from.x) * q
                root.y = from.y + (cy - from.y) * q
                root.rotation = from.r * (1 - q)
                // Squash on landing.
                const land = p < 0.6 ? from.s + (1 - from.s) * (p / 0.6) : 1 - 0.07 * Math.sin((p - 0.6) / 0.4 * Math.PI)
                root.scale.set(land)
            }, () => {
                root.getChildByLabel('shadow')?.destroy()
                root.rotation = 0
                root.scale.set(1)
                // The diff may already have made a fresh view at the new spot.
                const cur = this.views.get(keyOf(e))
                if (cur && cur !== v) {
                    root.destroy({ children: true })
                    return
                }
                root.parent?.removeChild(root)
                const def = BUILDINGS[e.k]
                const layer = def.role === 'belt' ? this.beltLayers[e.l ?? 0]! : this.entLayers[def.role === 'ramp' ? (e.l ?? 0) : 0]!
                layer.addChild(root)
            })
        }
        if (err || unchanged) {
            if (err) this.reject(t.x, t.y, err)
            // Fly home. The view keeps its key, nothing changed in state.
            this.views.set(v.key, v)
            settle(d.from)
            return
        }
        this.pushUndo([{ op: 'move', x: t.x, y: t.y, l, to: { x: d.from.x, y: d.from.y, r: d.from.r } }])
        // The state diff created a new view at the target; hide it until our sprite lands.
        const fresh = this.views.get(keyOf(t))
        if (fresh && fresh !== v) {
            fresh.root.visible = false
            this.tween(160, () => {}, () => {
                fresh.root.visible = true
                fresh.root.scale.set(1)
                this.dust(fresh, 8)
            })
        }
        const [w, h] = size(t.k, t.r)
        setTimeout(() => this.sfx.drop(w * h), 110)
        settle(t)
    }

    private cancelDrag() {
        const d = this.drag
        this.drag = null
        if (d?.kind === 'move') {
            this.dropMoved({ ...d, r: d.from.r, grabDx: 0, grabDy: 0 } as typeof d)
        }
        if (d?.kind === 'belt') {
            this.drawPath()
            this.sfx.remove(1)
        }
    }

    private mine(x: number, y: number) {
        const [err] = this.hooks.commit([{ op: 'mine', x, y, n: 1 }])
        if (err) {
            if (err === 'busy') this.ghostPos.shake = 0
            return
        }
        const o = oreAt(this.ore!, x, y)!
        this.sfx.mine()
        const cx = (x + 0.5) * TILE
        const cy = (y + 0.5) * TILE
        for (let i = 0; i < 7; i++) {
            const a = Math.random() * Math.PI * 2
            const sp = 120 + Math.random() * 220
            this.spawnParticle(cx, cy, parseInt(ITEMS[o].color.slice(1), 16), Math.cos(a) * sp, Math.sin(a) * sp - 120, 0.45, 5 + Math.random() * 4, 900)
        }
        this.floatItem(cx, cy, o, '+1')
    }

    private reject(x: number, y: number, err: OpError) {
        this.sfx.invalid()
        this.ghostPos.shake = 1
        const text = (ERROR_TEXT as Record<string, string>)[err] ?? 'Can\'t do that'
        this.floatText((x + 0.5) * TILE, (y + 0.2) * TILE, text, 0xff8a8a, 22)
    }

    private pushUndo(ops: Op[]) {
        this.undoStack.push(ops)
        if (this.undoStack.length > 100) this.undoStack.shift()
        this.redoStack = []
    }

    private history(from: Op[][], to: Op[][]) {
        const ops = from.pop()
        if (!ops) return
        // Each op's inverse is computed against the state before it runs.
        const inverse: Op[] = []
        const s = this.state!
        for (const op of ops) {
            if (op.op === 'remove') {
                const i = occupancy(s.entities).get(key3(op.x, op.y, op.l))
                const e = i === undefined ? null : s.entities[i]!
                if (e) {
                    inverse.unshift({ op: 'place', e: { ...e, mk: undefined } })
                    for (let mk = 2; mk <= (e.mk ?? 1); mk++) inverse.splice(1, 0, { op: 'upgrade', x: e.x, y: e.y, l: op.l })
                }
            } else if (op.op === 'place') {
                inverse.unshift({ op: 'remove', x: op.e.x, y: op.e.y, l: layersOf(op.e)[0]! })
            } else if (op.op === 'rotate') {
                const i = occupancy(s.entities).get(key3(op.x, op.y, op.l))
                if (i !== undefined) inverse.unshift({ ...op, r: s.entities[i]!.r })
            } else if (op.op === 'move') {
                const i = occupancy(s.entities).get(key3(op.x, op.y, op.l))
                if (i !== undefined) {
                    const e = s.entities[i]!
                    inverse.unshift({ op: 'move', x: op.to.x, y: op.to.y, l: op.l, to: { x: e.x, y: e.y, r: e.r } })
                }
            } else if (op.op === 'recipe') {
                const i = occupancy(s.entities).get(key3(op.x, op.y, 0))
                if (i !== undefined) inverse.unshift({ ...op, recipe: recipeOf(s.entities[i]!) ?? op.recipe })
            }
        }
        const errs = this.hooks.commit(ops)
        if (errs.every(e => e)) {
            this.sfx.invalid()
            return
        }
        to.push(inverse)
        this.sfx.rotate()
    }

    // ---- effects -----------------------------------------------------------------

    private tween(dur: number, fn: (p: number) => void, done?: () => void, delay = 0) {
        fn(0)
        this.tweens.push({ start: performance.now() + delay, dur, fn, done })
    }

    private tweenRotation(v: EntView, r: Dir) {
        const from = v.body.rotation
        let to = r * Math.PI / 2
        while (to - from > Math.PI) to -= Math.PI * 2
        while (to - from < -Math.PI) to += Math.PI * 2
        this.tween(120, p => { v.body.rotation = from + (to - from) * ease.outCubic(p) })
    }

    private spawnParticle(x: number, y: number, color: number, vx: number, vy: number, life: number, sizePx: number, grav = 600) {
        const s = new Sprite(Texture.WHITE)
        s.anchor.set(0.5)
        s.tint = color
        s.width = s.height = sizePx
        s.position.set(x, y)
        this.fx.addChild(s)
        this.particles.push({ s, vx, vy, life, max: life, grav, spin: (Math.random() - 0.5) * 12 })
    }

    private dust(v: EntView, n: number) {
        const [w, h] = size(v.e.k, v.e.r)
        const [cx, cy] = this.centerOf(v.e)
        for (let i = 0; i < n; i++) {
            // Puffs from the footprint edges, sliding outward along the ground.
            const side = i % 4
            const t = Math.random() - 0.5
            const ex = side < 2 ? (side ? 1 : -1) * w * TILE / 2 : t * w * TILE
            const ey = side >= 2 ? (side === 3 ? 1 : -1) * h * TILE / 2 : t * h * TILE
            const len = Math.hypot(ex, ey) || 1
            const sp = 90 + Math.random() * 90
            this.spawnParticle(cx + ex, cy + ey, 0xc9cfd8, ex / len * sp, ey / len * sp, 0.35 + Math.random() * 0.2, 6 + Math.random() * 6, 0)
        }
    }

    private burst(v: EntView, color: number, n: number) {
        const [cx, cy] = this.centerOf(v.e)
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2
            const sp = 140 + Math.random() * 240
            this.spawnParticle(cx, cy, color, Math.cos(a) * sp, Math.sin(a) * sp - 80, 0.4 + Math.random() * 0.25, 5 + Math.random() * 6, 700)
        }
    }

    private floatText(x: number, y: number, text: string, color: number, sizePx: number) {
        const t = new Text({ text, style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: sizePx, fill: color, fontWeight: '700', stroke: { color: 0x0f1115, width: 5 } } })
        t.anchor.set(0.5)
        t.position.set(x, y)
        t.scale.set(1 / Math.max(0.5, this.cam.zoom))
        this.fx.addChild(t)
        const y0 = y
        this.tween(900, (p) => {
            t.y = y0 - 50 * ease.outCubic(p)
            t.alpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3
        }, () => t.destroy())
    }

    private floatItem(x: number, y: number, item: ItemId, text: string) {
        const c = new Container()
        const icon = new Sprite(this.tex.item[item])
        icon.anchor.set(0.5)
        icon.width = icon.height = 30
        const t = new Text({ text, style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 24, fill: 0xffffff, fontWeight: '800', stroke: { color: 0x0f1115, width: 5 } } })
        t.anchor.set(0, 0.5)
        t.x = 18
        c.addChild(icon, t)
        c.position.set(x, y)
        c.scale.set(1 / Math.max(0.6, this.cam.zoom))
        this.fx.addChild(c)
        const s0 = c.scale.x
        this.tween(850, (p) => {
            c.y = y - 70 * ease.outCubic(p)
            c.scale.set(s0 * (p < 0.15 ? ease.outBack(p / 0.15, 2.5) : 1))
            c.alpha = p < 0.65 ? 1 : 1 - (p - 0.65) / 0.35
        }, () => c.destroy({ children: true }))
    }

    private applyLayerAlpha() {
        const building = this.tool.mode === 'build' && ['belt', 'ramp'].includes(BUILDINGS[this.tool.kind].role)
        for (let l = 0; l < 3; l++) {
            const a = !building ? 1 : l === this.layer ? 1 : l < this.layer ? 0.55 : 0.3
            this.beltLayers[l]!.alpha = a
            this.itemLayers[l]!.alpha = a
            if (l > 0) this.entLayers[l]!.alpha = a
        }
    }

    // ---- frame --------------------------------------------------------------------

    private frame(dt: number) {
        dt = Math.min(dt, 0.05)
        this.time += dt
        this.updateCamera(dt)
        this.overlay.clear()
        this.updateTweens()
        this.updateParticles(dt)
        this.updateBelts()
        this.updateMachines(dt)
        this.updateItems()
        this.updateGhost(dt)
        this.updateMove(dt)
        this.drawHighlights()
        if (this.drag?.kind === 'mine' && performance.now() >= this.drag.next) {
            this.drag.next = performance.now() + 160
            this.mine(this.drag.x, this.drag.y)
        }
    }

    private updateCamera(dt: number) {
        const c = this.cam
        // Keyboard pan, speed scaled so it feels the same at any zoom.
        let kx = 0, ky = 0
        if (this.keys.has('a') || this.keys.has('arrowleft')) kx -= 1
        if (this.keys.has('d') || this.keys.has('arrowright')) kx += 1
        if (this.keys.has('w') || this.keys.has('arrowup')) ky -= 1
        if (this.keys.has('s') || this.keys.has('arrowdown')) ky += 1
        if (kx || ky) {
            const sp = 900 / c.zoom
            c.tx += kx * sp * dt
            c.ty += ky * sp * dt
        }
        // Fling after a pan.
        if (this.drag?.kind !== 'pan' && (Math.abs(c.vx) > 1 || Math.abs(c.vy) > 1)) {
            c.tx += c.vx * dt
            c.ty += c.vy * dt
            const decay = Math.exp(-dt * 6)
            c.vx *= decay
            c.vy *= decay
        }
        const k = 1 - Math.exp(-dt * 16)
        if (this.drag?.kind !== 'pan') {
            c.x += (c.tx - c.x) * k
            c.y += (c.ty - c.y) * k
        }
        const zk = 1 - Math.exp(-dt * 14)
        c.zoom += (c.tz - c.zoom) * zk
        const w = this.app.screen.width
        const h = this.app.screen.height
        this.world.scale.set(c.zoom)
        this.world.position.set(w / 2 - c.x * c.zoom, h / 2 - c.y * c.zoom)
        // Keep the pointer's world position fresh while the camera glides.
        if (this.pointer.inside) {
            const [wx, wy] = this.screenToWorld(this.pointer.sx, this.pointer.sy)
            const tx = Math.floor(wx / TILE)
            const ty = Math.floor(wy / TILE)
            this.pointer.wx = wx
            this.pointer.wy = wy
            if (tx !== this.pointer.tx || ty !== this.pointer.ty) {
                this.pointer.tx = tx
                this.pointer.ty = ty
                if (this.drag?.kind === 'belt') this.extendBelt(tx, ty)
                else if (this.drag?.kind === 'paint') this.paintStep()
                else if (!this.drag) this.refreshHover()
            }
        }
        // Buy tags brighten under the cursor.
        for (const tag of this.buyLayer.children) {
            const hot = this.tool.mode === 'select' && this.buyTagAt(this.pointer.wx, this.pointer.wy) === tag.label
            const target = hot ? 1 : 0.7
            tag.alpha += (target - tag.alpha) * 0.2
            const s = hot ? 1.06 : 1
            tag.scale.set(tag.scale.x + (s - tag.scale.x) * 0.2)
        }
    }

    private updateTweens() {
        const now = performance.now()
        const keep: Tween[] = []
        for (const t of this.tweens) {
            if (now < t.start) { keep.push(t); continue }
            const p = Math.min(1, (now - t.start) / t.dur)
            try { t.fn(p) } catch { /* the target was destroyed */ }
            if (p >= 1) t.done?.()
            else keep.push(t)
        }
        this.tweens = keep
    }

    private updateParticles(dt: number) {
        const keep: Particle[] = []
        for (const p of this.particles) {
            p.life -= dt
            if (p.life <= 0) { p.s.destroy(); continue }
            p.vy += p.grav * dt
            p.vx *= Math.exp(-dt * 3)
            p.vy *= Math.exp(-dt * 1.5)
            p.s.x += p.vx * dt
            p.s.y += p.vy * dt
            p.s.rotation += p.spin * dt
            const f = p.life / p.max
            p.s.alpha = Math.min(1, f * 1.6)
            p.s.scale.set(p.s.scale.x * (0.985))
            keep.push(p)
        }
        this.particles = keep
    }

    private updateBelts() {
        // Every belt of a Mk shares a frame: swap textures only when it advances.
        const frames = BELT_MK.map(m => Math.floor(this.time * m.speed * TILE / (BELT_PERIOD / BELT_FRAMES)) % BELT_FRAMES)
        const key = frames.join(',')
        if (key === this.beltFrame) return
        this.beltFrame = key
        for (const v of this.belts) {
            const mk = Math.min(4, v.e.mk ?? 1) - 1
            // Belts with nothing on them rest; moving ones run.
            const moving = !this.sol || v.sol < 0 || this.sol.flow[v.sol]! > 0.001
            const f = moving ? frames[mk]! : 0
            const tex = this.tex.belt[mk]![v.shape ?? 'straight']![f]!
            if (v.body.texture !== tex) v.body.texture = tex
        }
    }

    private updateMachines(dt: number) {
        if (!this.sol) return
        for (const v of this.views.values()) {
            if (v.lifted) continue
            const role = BUILDINGS[v.e.k].role
            if (role !== 'machine' && role !== 'source' && role !== 'sink') continue
            const i = v.sol
            const target = i >= 0 ? (role === 'sink' ? Math.min(1, this.sol.flow[i]!) : this.sol.busy[i]!) : 0
            v.busy += (target - v.busy) * (1 - Math.exp(-dt * 3))
            if (v.spin) v.spin.rotation += dt * 7 * v.busy
            if (role === 'machine' || role === 'sink') {
                const pulse = 1 + 0.025 * v.busy * Math.sin(this.time * (role === 'sink' ? 5 : 9) + v.phase)
                if ((v.animUntil ?? 0) < performance.now()) v.root.scale.set(pulse)
            }
            const idle = role !== 'sink' && v.busy < 0.05
            v.body.tint = idle ? 0xb8bec8 : 0xffffff
        }
    }

    private updateItems() {
        const used = [0, 0, 0]
        const sol = this.sol
        if (sol) {
            const w = this.app.screen.width / this.cam.zoom
            const h = this.app.screen.height / this.cam.zoom
            const x0 = (this.cam.x - w / 2) / TILE - 1
            const x1 = (this.cam.x + w / 2) / TILE + 1
            const y0 = (this.cam.y - h / 2) / TILE - 1
            const y1 = (this.cam.y + h / 2) / TILE + 1
            const showItems = this.cam.zoom > 0.22
            const NI = 18
            if (showItems) {
                for (const v of this.belts) {
                    const e = v.e
                    if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1 || v.sol < 0 || v.lifted) continue
                    const flow = sol.flow[v.sol]!
                    if (flow < 0.01) continue
                    const mk = BELT_MK[Math.min(4, e.mk ?? 1) - 1]!
                    const speed = mk.speed
                    // Items spaced by how many arrive per tile of travel.
                    const spacing = Math.max(0.25, speed / flow)
                    const head = this.time * speed
                    const s0 = v.chain ?? 0
                    const firstK = Math.ceil((s0 - head) / spacing)
                    const l = e.l ?? 0
                    for (let k = firstK; ; k++) {
                        const s = head + k * spacing
                        const p = s - s0
                        if (p >= 1) break
                        if (p < 0) continue
                        const item = this.pickItem(sol.mix, v.sol * NI, k)
                        if (item < 0) continue
                        let sp = this.itemPool[l]![used[l]!]
                        if (!sp) {
                            sp = new Sprite()
                            sp.anchor.set(0.5)
                            this.itemLayers[l]!.addChild(sp)
                            this.itemPool[l]!.push(sp)
                        }
                        used[l]!++
                        sp.visible = true
                        sp.texture = this.tex.item[ITEM_ORDER[item]!]
                        sp.width = sp.height = 26
                        const [px, py] = beltPoint(v.shape ?? 'straight', e.r, p)
                        sp.position.set((e.x + 0.5) * TILE + px, (e.y + 0.5) * TILE + py)
                    }
                }
            }
        }
        for (let l = 0; l < 3; l++) {
            const pool = this.itemPool[l]!
            for (let i = used[l]!; i < pool.length; i++) {
                if (!pool[i]!.visible) break
                pool[i]!.visible = false
            }
        }
    }

    private pickItem(mix: Float32Array, base: number, k: number): number {
        let total = 0
        for (let i = 0; i < 18; i++) total += mix[base + i]!
        if (total <= 0) return -1
        // Deterministic per item slot, so an item keeps its kind as it travels.
        const h = (((k * 2654435761) >>> 0) % 10000) / 10000
        let acc = 0
        for (let i = 0; i < 18; i++) {
            acc += mix[base + i]! / total
            if (h < acc) return i
        }
        return -1
    }

    private drawHighlights() {
        const o = this.overlay
        const box = (v: EntView, color: number, alpha: number, width: number) => {
            const [w, h] = size(v.e.k, v.e.r)
            o.roundRect(v.e.x * TILE + 1, v.e.y * TILE + 1, w * TILE - 2, h * TILE - 2, 11).stroke({ width, color, alpha })
        }
        if (this.hover && !this.hover.lifted && this.tool.mode !== 'build') {
            const erase = this.tool.mode === 'remove' || this.drag?.kind === 'erase'
            box(this.hover, erase ? 0xf87171 : 0xffffff, 0.55 + 0.25 * Math.sin(this.time * 6), 3)
        }
        if (this.selected && !this.selected.lifted) box(this.selected, 0x60a5fa, 0.95, 4)
        if (this.tool.mode === 'remove' && this.pointer.inside && !this.hover) {
            o.roundRect(this.pointer.tx * TILE + 4, this.pointer.ty * TILE + 4, TILE - 8, TILE - 8, 8).stroke({ width: 2, color: 0xf87171, alpha: 0.5 })
        }
    }
}

const ITEM_ORDER = ITEM_IDS

/** A point along a belt tile at progress p (0..1), relative to the tile centre. */
function beltPoint(shape: BeltShape, r: Dir, p: number): [number, number] {
    let x: number, y: number
    if (shape === 'straight') {
        x = (p - 0.5) * TILE
        y = 0
    } else {
        const fromTop = shape === 'curveL'
        const th = fromTop ? Math.PI - p * Math.PI / 2 : Math.PI + p * Math.PI / 2
        x = TILE / 2 + Math.cos(th) * TILE / 2
        y = (fromTop ? -TILE / 2 : TILE / 2) + Math.sin(th) * TILE / 2
    }
    const c = Math.cos(r * Math.PI / 2)
    const s = Math.sin(r * Math.PI / 2)
    return [x * c - y * s, x * s + y * c]
}

/** The direction an entity's port pushes into `into`. */
function outputDirInto(from: Entity, _into: Entity, _g: Graph, port: number): Dir {
    const role = BUILDINGS[from.k].role
    if (role === 'splitter') return port === 0 ? from.r : rot(from.r, port === 1 ? 3 : 1)
    if (role === 'smart' || role === 'overflow') return port === 0 ? from.r : rot(from.r, 1)
    return from.r
}

function line(x0: number, y0: number, x1: number, y1: number): [number, number][] {
    const out: [number, number][] = []
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    let x = x0, y = y0
    for (let i = 0; i < 200; i++) {
        out.push([x, y])
        if (x === x1 && y === y1) break
        const e2 = 2 * err
        if (e2 >= dy) { err += dy; x += sx }
        if (e2 <= dx) { err += dx; y += sy }
    }
    return out
}

export function fmt(n: number): string {
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}m`
    if (n >= 1e4) return `${Math.round(n / 1e3)}k`
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
    return String(Math.floor(n))
}

export function costLine(cost: Stock): string {
    return Object.entries(cost).map(([k, v]) => `${fmt(v as number)} ${ITEMS[k as ItemId].name.toLowerCase()}`).join(' · ')
}

export type { FederatedPointerEvent }
