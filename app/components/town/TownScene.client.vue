<script setup lang="ts">
// Polytown 3D scene. Three.js, one rAF loop. World units: one tile = 1, plot
// (px, py) covers x ∈ [px*8, px*8+8), z ∈ [py*8, py*8+8). HTML overlays
// (progress bars, for-sale prices, production popups) are positioned by
// projecting world points each frame and written straight to the DOM — no
// per-frame Vue re-render.
import * as THREE from 'three'
import { townDragDelta, townKeyboardDelta, townIsTyping } from '~/utils/town/camera'
import { TOWN_PLOT_SIZE, TOWN_FACING, getTownBuilding, townLevelBuildMs, townFrontTile, type TownBuildingId } from '#shared/utils/gamelogic/town'
import { createBuildingModel, createVillager, createForSaleSign, townMaterial, TREE_GEOMETRY } from '~/utils/town/models'

export interface ScenePlot { id: string, x: number, y: number }
export interface SceneBuilding {
    id: string
    plotId: string
    type: string
    tileX: number
    tileY: number
    rotation?: number
    level: number
    completesAt: number
    upgradingTo: number | null
    createdAt: number
    staffing: number | null
    connected?: boolean
}
export interface SceneExpansion { x: number, y: number, free: boolean, ownerName?: string }
export interface TileRef { plotId: string, tileX: number, tileY: number }

const props = withDefaults(defineProps<{
    plots: ScenePlot[]
    buildings: SceneBuilding[]
    expansions: SceneExpansion[]
    selectedBuildingId?: string | null
    ghostType?: string | null
    ghostRotation?: number
    keyboardEnabled?: boolean
    serverOffsetMs?: number
    popCap?: number
    speedMultiplier?: number
    tickMs?: number
    /** Text shown on the hovered for-sale sign (price / cooldown). */
    expansionLabel?: string
    expansionAffordable?: boolean
    /** Effect circles to draw on the ground (parks cheer, industry sours). */
    effectRadii?: { x: number, y: number, radius: number, kind: 'good' | 'bad' }[]
    /** Radius the ghost projects, drawn under the cursor while placing. */
    ghostRadius?: { radius: number, kind: 'good' | 'bad' } | null
    /** Why the ghost cannot be placed where it hovers (null = allowed). Computed by the parent from the shared rules. */
    ghostIssue?: string | null
    /** Building being moved: hidden in place while its ghost follows the cursor. */
    movingId?: string | null
}>(), {
    selectedBuildingId: null,
    ghostType: null,
    ghostRotation: 0,
    keyboardEnabled: true,
    serverOffsetMs: 0,
    popCap: 0,
    speedMultiplier: 1,
    tickMs: 60_000,
    expansionLabel: '',
    expansionAffordable: true,
    effectRadii: () => [],
    ghostRadius: null,
    ghostIssue: null,
    movingId: null
})

const emit = defineEmits<{
    'select-tile': [tile: TileRef]
    'select-building': [id: string]
    'select-expansion': [slot: { x: number, y: number }]
    'hover-building': [id: string | null]
    'hover-expansion': [slot: { x: number, y: number } | null]
    /** Tile under the cursor in world coordinates, or null — the parent decides placement validity and auto-facing. */
    'hover-tile': [tile: (TileRef & { wx: number, wy: number }) | null]
    'deselect': []
}>()

const wrap = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const overlay = ref<HTMLDivElement | null>(null)

const PLOT = TOWN_PLOT_SIZE

// ─── Scene graph ─────────────────────────────────────────────────────────────

let renderer: THREE.WebGLRenderer | null = null
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400)
const sun = new THREE.DirectionalLight(0xffe6bf, 2.5)
const plotsGroup = new THREE.Group()
const buildingsGroup = new THREE.Group()
const expansionGroup = new THREE.Group()
const decorGroup = new THREE.Group()
const villagerGroup = new THREE.Group()
const fxGroup = new THREE.Group()
scene.add(plotsGroup, buildingsGroup, expansionGroup, decorGroup, villagerGroup, fxGroup)

const SKY = 0xb4d9dd
scene.background = new THREE.Color(SKY)
scene.fog = new THREE.Fog(SKY, 60, 160)

// ─── Camera rig ──────────────────────────────────────────────────────────────

const cam = { tx: 4, tz: 4, yaw: 0.7, pitch: 0.95, dist: 22 }
const camGoal = { ...cam }
const MIN_DIST = 7
const MAX_DIST = 70

function applyCamera() {
    const { tx, tz, yaw, pitch, dist } = cam
    camera.position.set(
        tx + dist * Math.cos(pitch) * Math.sin(yaw),
        dist * Math.sin(pitch),
        tz + dist * Math.cos(pitch) * Math.cos(yaw)
    )
    camera.lookAt(tx, 0, tz)
    // Shadows follow the view so they always cover what's on screen.
    sun.position.set(tx + 26, 40, tz + 14)
    sun.target.position.set(tx, 0, tz)
    sun.target.updateMatrixWorld()
}

function recenter(animate = true) {
    if (props.plots.length === 0) {
        camGoal.tx = PLOT / 2
        camGoal.tz = PLOT / 2
        camGoal.dist = 22
    } else {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
        for (const p of props.plots) {
            minX = Math.min(minX, p.x * PLOT)
            maxX = Math.max(maxX, p.x * PLOT + PLOT)
            minZ = Math.min(minZ, p.y * PLOT)
            maxZ = Math.max(maxZ, p.y * PLOT + PLOT)
        }
        camGoal.tx = (minX + maxX) / 2
        camGoal.tz = (minZ + maxZ) / 2
        const span = Math.max(maxX - minX, maxZ - minZ)
        camGoal.dist = Math.min(MAX_DIST, Math.max(MIN_DIST, span * 1.15 + 6))
    }
    if (!animate) Object.assign(cam, camGoal)
}

// ─── Lighting & ground ───────────────────────────────────────────────────────

function setupStatic() {
    const hemi = new THREE.HemisphereLight(0xd6efff, 0x718555, 1.15)
    scene.add(hemi)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 5
    sun.shadow.camera.far = 120
    sun.shadow.camera.left = -34
    sun.shadow.camera.right = 34
    sun.shadow.camera.top = 34
    sun.shadow.camera.bottom = -34
    sun.shadow.bias = -0.0006
    sun.shadow.normalBias = 0.02
    scene.add(sun, sun.target)

    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(600, 600),
        new THREE.MeshStandardMaterial({ color: 0x709b68, roughness: 1 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    ground.receiveShadow = true
    scene.add(ground)

    // Distant hills in the fog give the horizon some shape.
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x668b73, roughness: 1, flatShading: true })
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2
        const r = 95 + (i % 3) * 18
        const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 7), hillMat)
        hill.position.set(Math.cos(a) * r, -6, Math.sin(a) * r)
        hill.scale.set(28 + (i % 4) * 9, 14 + (i % 3) * 5, 24 + (i % 5) * 6)
        scene.add(hill)
    }

    // Clouds: flat soft ellipsoids drifting slowly.
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85 })
    for (let i = 0; i < 9; i++) {
        const cloud = new THREE.Group()
        for (let j = 0; j < 3; j++) {
            const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), cloudMat)
            puff.position.set(j * 1.6 - 1.6, (j % 2) * 0.3, (j % 2) * 0.6)
            puff.scale.set(2.2 + j * 0.4, 0.9, 1.6)
            cloud.add(puff)
        }
        cloud.position.set((i - 4) * 22 + (i % 2) * 9, 24 + (i % 3) * 3, -30 + (i % 4) * 18)
        cloud.userData.drift = 0.4 + (i % 3) * 0.15
        clouds.push(cloud)
        scene.add(cloud)
    }
}
const clouds: THREE.Group[] = []

// ─── Plots ───────────────────────────────────────────────────────────────────

let plotTexture: THREE.CanvasTexture | null = null
function makePlotTexture(): THREE.CanvasTexture {
    if (plotTexture) return plotTexture
    const size = 512
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const g = c.getContext('2d')!
    const cell = size / PLOT
    for (let y = 0; y < PLOT; y++) {
        for (let x = 0; x < PLOT; x++) {
            g.fillStyle = (x + y) % 2 === 0 ? '#94b977' : '#8fb471'
            g.fillRect(x * cell, y * cell, cell, cell)
            // Deterministic grass strokes and tiny clover flecks, baked once.
            for (let i = 0; i < 36; i++) {
                const gx = x * cell + 4 + hash(x, y, i * 2 + 90) * (cell - 8)
                const gy = y * cell + 4 + hash(x, y, i * 2 + 91) * (cell - 8)
                g.strokeStyle = i % 3 ? 'rgba(51, 94, 55, 0.13)' : 'rgba(227, 236, 164, 0.35)'
                g.lineWidth = 1
                g.beginPath()
                g.moveTo(gx - 1.5, gy)
                g.lineTo(gx, gy - 3)
                g.lineTo(gx + 1, gy - 1)
                g.stroke()
            }
        }
    }
    g.strokeStyle = 'rgba(51, 77, 46, 0.16)'
    g.lineWidth = 2
    for (let i = 0; i <= PLOT; i++) {
        g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, size); g.stroke()
        g.beginPath(); g.moveTo(0, i * cell); g.lineTo(size, i * cell); g.stroke()
    }
    plotTexture = new THREE.CanvasTexture(c)
    plotTexture.colorSpace = THREE.SRGBColorSpace
    plotTexture.anisotropy = 4
    return plotTexture
}

const plotMeshes = new Map<string, THREE.Mesh>()
function rebuildPlots() {
    plotsGroup.clear()
    plotMeshes.clear()
    const tex = makePlotTexture()
    const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 })
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 })
    for (const p of props.plots) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(PLOT, 0.3, PLOT), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat])
        slab.position.set(p.x * PLOT + PLOT / 2, 0.15, p.y * PLOT + PLOT / 2)
        slab.receiveShadow = true
        slab.userData.plotId = p.id
        plotsGroup.add(slab)
        plotMeshes.set(p.id, slab)
    }
}

// ─── Expansion slots ─────────────────────────────────────────────────────────

interface SlotEntry { slot: SceneExpansion, hit: THREE.Mesh, sign: THREE.Group | null, board: THREE.Mesh | null, label: HTMLDivElement | null }
const slotEntries: SlotEntry[] = []
let hoveredSlotKey: string | null = null

function rebuildExpansions() {
    for (const e of slotEntries) e.label?.remove()
    slotEntries.length = 0
    expansionGroup.clear()
    const freeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, roughness: 1, depthWrite: false })
    const takenMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.18, roughness: 1, depthWrite: false })
    for (const slot of props.expansions) {
        const hit = new THREE.Mesh(new THREE.PlaneGeometry(PLOT - 0.3, PLOT - 0.3), slot.free ? freeMat : takenMat)
        hit.rotation.x = -Math.PI / 2
        hit.position.set(slot.x * PLOT + PLOT / 2, 0.01, slot.y * PLOT + PLOT / 2)
        hit.userData.expansion = { x: slot.x, y: slot.y, free: slot.free }
        expansionGroup.add(hit)

        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.PlaneGeometry(PLOT - 0.3, PLOT - 0.3)),
            new THREE.LineDashedMaterial({ color: slot.free ? 0xffffff : 0x666666, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.55 })
        )
        edges.computeLineDistances()
        edges.rotation.x = -Math.PI / 2
        edges.position.copy(hit.position).setY(0.02)
        expansionGroup.add(edges)

        let sign: THREE.Group | null = null
        let board: THREE.Mesh | null = null
        if (slot.free) {
            sign = createForSaleSign()
            sign.position.set(slot.x * PLOT + PLOT / 2, 0, slot.y * PLOT + PLOT / 2)
            sign.rotation.y = cam.yaw
            sign.scale.setScalar(1.6)
            board = sign.getObjectByName('board') as THREE.Mesh
            board.material = signMaterial(false)
            expansionGroup.add(sign)
        }
        slotEntries.push({ slot, hit, sign, board, label: null })
    }
}

const signMats = new Map<string, THREE.MeshStandardMaterial>()
function signMaterial(hover: boolean): THREE.MeshStandardMaterial {
    const key = hover ? 'hover' : 'idle'
    let m = signMats.get(key)
    if (m) return m
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 224
    const g = c.getContext('2d')!
    const paper = g.createLinearGradient(0, 0, 0, c.height)
    paper.addColorStop(0, hover ? '#fff1c7' : '#faf1d9')
    paper.addColorStop(1, hover ? '#e8c778' : '#dfcea5')
    g.fillStyle = paper
    g.fillRect(0, 0, c.width, c.height)
    g.strokeStyle = '#386a67'
    g.lineWidth = 14
    g.strokeRect(7, 7, c.width - 14, c.height - 14)
    g.strokeStyle = '#b28a48'
    g.lineWidth = 2
    g.strokeRect(23, 23, c.width - 46, c.height - 46)
    g.fillStyle = '#315654'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = '900 78px Georgia, serif'
    g.fillText('FOR SALE', c.width / 2, c.height / 2 - 18)
    g.font = '600 32px system-ui, sans-serif'
    g.fillText('click to buy', c.width / 2, c.height / 2 + 60)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: hover ? 0x664400 : 0x000000 })
    signMats.set(key, m)
    return m
}

// ─── Buildings ───────────────────────────────────────────────────────────────

interface BuildingEntry {
    data: SceneBuilding
    group: THREE.Group
    model: THREE.Group
    scaffold: THREE.Group | null
    bar: HTMLDivElement | null
    spin: THREE.Object3D[]
    smoke: THREE.Object3D[]
    glow: THREE.Mesh[]
    wasPending: boolean
    popAt: number
    baseY: number
    nextPopup: number
    /** Connection signature for roads, so the tile is only rebuilt when neighbours change. */
    roadSig?: string
    /** Big red "!" while the front door has no road. */
    alert: HTMLDivElement | null
}
const entries = new Map<string, BuildingEntry>()
const plotById = computed(() => new Map(props.plots.map(p => [p.id, p])))

function worldPos(b: SceneBuilding): { x: number, z: number } | null {
    const p = plotById.value.get(b.plotId)
    if (!p) return null
    return { x: p.x * PLOT + b.tileX + 0.5, z: p.y * PLOT + b.tileY + 0.5 }
}

function makeScaffold(): THREE.Group {
    const g = new THREE.Group()
    const mat = townMaterial(0xc8a165)
    for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]] as const) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), mat)
        post.position.set(x, 0.45, z)
        post.castShadow = true
        g.add(post)
    }
    for (const [x, z, w, d] of [[0, -0.42, 0.9, 0.04], [0, 0.42, 0.9, 0.04], [-0.42, 0, 0.04, 0.9], [0.42, 0, 0.04, 0.9]] as const) {
        for (const y of [0.35, 0.8]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), mat)
            rail.position.set(x, y, z)
            g.add(rail)
        }
    }
    return g
}

// ─── Roads ───────────────────────────────────────────────────────────────────
// A road tile is a flat slab with a lighter centre line running toward every
// neighbouring road, so a network reads as one connected street.

const ROAD_BASE = townMaterial(0x595a60)
const ROAD_LINE = townMaterial(0xd9d3c3)
const ROAD_CURB = townMaterial(0x8d8f95)

function roadKey(wx: number, wy: number) { return `${wx},${wy}` }

function roadTiles(): Set<string> {
    const set = new Set<string>()
    for (const b of props.buildings) {
        if (b.type !== 'road') continue
        const pos = worldPos(b)
        if (pos) set.add(roadKey(Math.floor(pos.x), Math.floor(pos.z)))
    }
    return set
}

function roadConnections(wx: number, wy: number, roads: Set<string>): boolean[] {
    return TOWN_FACING.map(([dx, dy]) => roads.has(roadKey(wx + dx, wy + dy)))
}

function buildRoadModel(conns: boolean[]): THREE.Group {
    const g = new THREE.Group()
    const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.04, 1), ROAD_BASE)
    base.position.y = 0.02
    base.receiveShadow = true
    g.add(base)
    const any = conns.some(Boolean)
    if (!any) {
        const dot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.16), ROAD_LINE)
        dot.position.y = 0.046
        g.add(dot)
    }
    conns.forEach((on, i) => {
        if (!on) return
        const [dx, dy] = TOWN_FACING[i]!
        const seg = new THREE.Mesh(new THREE.BoxGeometry(dx === 0 ? 0.08 : 0.5, 0.012, dx === 0 ? 0.5 : 0.08), ROAD_LINE)
        seg.position.set(dx * 0.25, 0.046, dy * 0.25)
        g.add(seg)
    })
    // Curbs on the open sides.
    conns.forEach((on, i) => {
        if (on) return
        const [dx, dy] = TOWN_FACING[i]!
        const curb = new THREE.Mesh(new THREE.BoxGeometry(dx === 0 ? 1 : 0.06, 0.05, dx === 0 ? 0.06 : 1), ROAD_CURB)
        curb.position.set(dx * 0.47, 0.03, dy * 0.47)
        g.add(curb)
    })
    return g
}

function isPending(b: SceneBuilding, now: number) {
    return b.completesAt > now && (b.level === 0 || b.upgradingTo !== null)
}

const BASE_SCALE = 1.35
function levelScale(level: number) {
    return BASE_SCALE * (1 + Math.min(0.4, Math.max(0, level - 1) * 0.025))
}

function syncBuildings() {
    const now = Date.now() + props.serverOffsetMs
    const seen = new Set<string>()
    const roads = roadTiles()
    for (const b of props.buildings) {
        seen.add(b.id)
        const pos = worldPos(b)
        if (!pos) continue
        let e = entries.get(b.id)
        const isRoad = b.type === 'road'
        const sig = isRoad ? roadConnections(Math.floor(pos.x), Math.floor(pos.z), roads).map(c => c ? '1' : '0').join('') : undefined
        if (e && isRoad && e.roadSig !== sig) {
            // Neighbourhood changed: swap in a tile drawn with the new connections.
            e.group.remove(e.model)
            e.model = buildRoadModel(roadConnections(Math.floor(pos.x), Math.floor(pos.z), roads))
            e.model.traverse((o) => { o.userData.buildingId = b.id })
            e.group.add(e.model)
            e.roadSig = sig
        }
        if (!e || e.data.type !== b.type) {
            if (e) disposeEntry(e)
            const group = new THREE.Group()
            const model = isRoad
                ? buildRoadModel(roadConnections(Math.floor(pos.x), Math.floor(pos.z), roads))
                : createBuildingModel(b.type as TownBuildingId)
            group.add(model)
            group.userData.buildingId = b.id
            model.traverse((o) => { o.userData.buildingId = b.id })
            buildingsGroup.add(group)
            e = {
                data: b, group, model, scaffold: null, bar: null,
                spin: [], smoke: [], glow: [],
                wasPending: isPending(b, now), popAt: 0, baseY: 0.3,
                nextPopup: performance.now() + Math.random() * props.tickMs,
                roadSig: sig,
                alert: null
            }
            model.traverse((o) => {
                if (o.name === 'spin') e!.spin.push(o)
                if (o.name === 'smoke') e!.smoke.push(o)
                if (o.name === 'glow' && o instanceof THREE.Mesh) e!.glow.push(o)
            })
            entries.set(b.id, e)
        }
        e.data = b
        e.model.rotation.y = isRoad ? 0 : (b.rotation ?? 0) * Math.PI / 2
        e.group.position.set(pos.x, e.baseY, pos.z)
        e.group.visible = props.movingId !== b.id
        const pending = isPending(b, now)
        if (pending && !e.scaffold) {
            e.scaffold = makeScaffold()
            e.group.add(e.scaffold)
        }
        if (!pending && e.scaffold) {
            e.group.remove(e.scaffold)
            e.scaffold = null
        }
        if (e.wasPending && !pending) e.popAt = performance.now()
        e.wasPending = pending
    }
    for (const [id, e] of entries) {
        if (!seen.has(id)) {
            disposeEntry(e)
            entries.delete(id)
        }
    }
}

function disposeEntry(e: BuildingEntry) {
    buildingsGroup.remove(e.group)
    e.bar?.remove()
    e.alert?.remove()
}

// ─── Ghost ───────────────────────────────────────────────────────────────────

let ghost: THREE.Group | null = null
let ghostMats: THREE.MeshStandardMaterial[] = []
function rebuildGhost() {
    if (ghost) { buildingsGroup.remove(ghost); ghost = null; ghostMats = [] }
    hideGhost()
    if (!props.ghostType || !getTownBuilding(props.ghostType)) return
    const ghostDef = getTownBuilding(props.ghostType)!
    ghost = ghostDef.kind === 'road' ? buildRoadModel([false, false, false, false]) : createBuildingModel(props.ghostType as TownBuildingId)
    ghost.traverse((o) => {
        if (o instanceof THREE.Mesh) {
            const m = (o.material as THREE.MeshStandardMaterial).clone()
            m.transparent = true
            m.opacity = 0.55
            m.emissive = new THREE.Color(0x2ecc71)
            m.emissiveIntensity = 0.35
            o.material = m
            o.castShadow = false
            ghostMats.push(m)
        }
    })
    ghost.visible = false
    ghost.rotation.y = ghostDef.kind === 'road' ? 0 : props.ghostRotation * Math.PI / 2
    ghost.scale.setScalar(ghostDef.kind === 'road' ? 1 : BASE_SCALE)
    buildingsGroup.add(ghost)
}
function tintGhost(ok: boolean) {
    for (const m of ghostMats) {
        m.emissive.set(ok ? 0x2ecc71 : 0xe74c3c)
        m.emissiveIntensity = ok ? 0.35 : 0.75
        m.opacity = ok ? 0.6 : 0.5
    }
    ;(ghostPad.material as THREE.MeshBasicMaterial).color.set(ok ? 0x2ecc71 : 0xe74c3c)
    ;(frontMarker.material as THREE.MeshBasicMaterial).color.set(ok ? 0xffffff : 0xffb3b3)
}

// Flat pad under the ghost (allowed = green, blocked = red) and a door arrow on
// the tile the building fronts onto, so the road rule is visible before clicking.
const ghostPad = new THREE.Mesh(
    new THREE.PlaneGeometry(1.06, 1.06),
    new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.35, depthWrite: false })
)
ghostPad.rotation.x = -Math.PI / 2
ghostPad.visible = false
fxGroup.add(ghostPad)

const frontMarker = new THREE.Mesh(
    (() => {
        const shape = new THREE.Shape()
        shape.moveTo(-0.22, -0.18)
        shape.lineTo(0.22, -0.18)
        shape.lineTo(0, 0.2)
        shape.closePath()
        return new THREE.ShapeGeometry(shape)
    })(),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
)
frontMarker.rotation.x = -Math.PI / 2
frontMarker.visible = false
fxGroup.add(frontMarker)

let issueLabel: HTMLDivElement | null = null
let issueAnchor: { x: number, z: number } | null = null
function showIssue(text: string | null, x: number, z: number) {
    if (!overlay.value) return
    if (!text) {
        issueLabel?.remove()
        issueLabel = null
        issueAnchor = null
        return
    }
    if (!issueLabel) {
        issueLabel = document.createElement('div')
        issueLabel.className = 'town-issue'
        overlay.value.appendChild(issueLabel)
    }
    issueLabel.textContent = text
    issueAnchor = { x, z }
}

function placeGhostAt(x: number, z: number) {
    if (ghost) {
        ghost.visible = true
        ghost.position.set(x + 0.5, 0.3, z + 0.5)
    }
    ghostPad.visible = true
    ghostPad.position.set(x + 0.5, 0.325, z + 0.5)
    const def = props.ghostType ? getTownBuilding(props.ghostType) : null
    if (def && def.kind !== 'road') {
        const f = townFrontTile(x, z, props.ghostRotation)
        frontMarker.visible = true
        frontMarker.position.set(f.wx + 0.5, 0.33, f.wy + 0.5)
        frontMarker.rotation.z = -props.ghostRotation * Math.PI / 2 + Math.PI
    } else {
        frontMarker.visible = false
    }
    tintGhost(!props.ghostIssue)
    showIssue(props.ghostIssue, x + 0.5, z + 0.5)
}

function hideGhost() {
    if (ghost) ghost.visible = false
    ghostPad.visible = false
    frontMarker.visible = false
    if (ghostRadiusMesh) ghostRadiusMesh.visible = false
    showIssue(null, 0, 0)
}

// ─── Effect radius rings ─────────────────────────────────────────────────────
// A park's reach (or an industry building's nuisance) drawn flat on the ground,
// City-Skylines style: a soft filled square matching the Chebyshev radius the
// simulation actually uses, plus an outline so overlaps stay readable.

const radiiGroup = new THREE.Group()
fxGroup.add(radiiGroup)
// Reach colours stay away from the red/green the ghost uses for allowed/blocked.
const GOOD = 0x5ac8fa
const BAD = 0xff9f43

function makeRadius(radius: number, kind: 'good' | 'bad'): THREE.Group {
    const g = new THREE.Group()
    const size = radius * 2 + 1
    const color = kind === 'good' ? GOOD : BAD
    const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false })
    )
    fill.rotation.x = -Math.PI / 2
    g.add(fill)
    // A real border, not a 1px line: WebGL ignores lineWidth, so the outline is
    // four thin quads laid flat just above the fill.
    const borderMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false })
    const t = 0.12
    const half = size / 2
    for (const [x, z, w, d] of [[0, -half, size, t], [0, half, size, t], [-half, 0, t, size], [half, 0, t, size]] as const) {
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, d), borderMat)
        bar.rotation.x = -Math.PI / 2
        bar.position.set(x, 0.01, z)
        g.add(bar)
    }
    return g
}

const radiusPool: THREE.Group[] = []
function syncRadii() {
    const wanted = props.effectRadii
    while (radiusPool.length < wanted.length) {
        const g = new THREE.Group()
        radiiGroup.add(g)
        radiusPool.push(g)
    }
    wanted.forEach((r, i) => {
        const holder = radiusPool[i]!
        holder.clear()
        holder.add(makeRadius(r.radius, r.kind))
        holder.position.set(r.x, 0.33, r.y)
        holder.visible = true
    })
    for (let i = wanted.length; i < radiusPool.length; i++) radiusPool[i]!.visible = false
}

let ghostRadiusMesh: THREE.Group | null = null
function rebuildGhostRadius() {
    if (ghostRadiusMesh) { fxGroup.remove(ghostRadiusMesh); ghostRadiusMesh = null }
    const gr = props.ghostRadius
    if (!gr) return
    ghostRadiusMesh = makeRadius(gr.radius, gr.kind)
    ghostRadiusMesh.visible = false
    fxGroup.add(ghostRadiusMesh)
}

// ─── Selection ring ──────────────────────────────────────────────────────────

const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.68, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
)
ring.rotation.x = -Math.PI / 2
ring.visible = false
fxGroup.add(ring)

const hoverTile = new THREE.Mesh(
    new THREE.PlaneGeometry(0.96, 0.96),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false })
)
hoverTile.rotation.x = -Math.PI / 2
hoverTile.visible = false
fxGroup.add(hoverTile)

// ─── Decor (trees, bushes, rocks around the town) ────────────────────────────

function hash(x: number, y: number, salt: number) {
    let h = (x * 374761393 + y * 668265263 + salt * 1442695041) | 0
    h = (h ^ (h >>> 13)) * 1274126177
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

function rebuildDecor() {
    decorGroup.clear()
    const blocked = new Set<string>()
    for (const p of props.plots) blocked.add(`${p.x},${p.y}`)
    for (const s of props.expansions) blocked.add(`${s.x},${s.y}`)
    let minPX = Infinity, maxPX = -Infinity, minPY = Infinity, maxPY = -Infinity
    for (const p of props.plots) {
        minPX = Math.min(minPX, p.x); maxPX = Math.max(maxPX, p.x)
        minPY = Math.min(minPY, p.y); maxPY = Math.max(maxPY, p.y)
    }
    if (!Number.isFinite(minPX)) { minPX = maxPX = minPY = maxPY = 0 }
    const R = 5
    const trunks: THREE.Matrix4[] = []
    const foliage: THREE.Matrix4[] = []
    const crowns: THREE.Matrix4[] = []
    const bushes: THREE.Matrix4[] = []
    const rocks: THREE.Matrix4[] = []
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const v = new THREE.Vector3()
    for (let py = minPY - R; py <= maxPY + R; py++) {
        for (let px = minPX - R; px <= maxPX + R; px++) {
            if (blocked.has(`${px},${py}`)) continue
            // Density falls off with distance from the town so the horizon thins out.
            const dist = Math.max(0, Math.min(Math.abs(px - minPX), Math.abs(px - maxPX)), Math.min(Math.abs(py - minPY), Math.abs(py - maxPY)))
            const count = Math.round(10 - dist * 1.2)
            for (let i = 0; i < count; i++) {
                const rx = hash(px, py, i * 3 + 1)
                const rz = hash(px, py, i * 3 + 2)
                const kind = hash(px, py, i * 3 + 3)
                const x = px * PLOT + 0.6 + rx * (PLOT - 1.2)
                const z = py * PLOT + 0.6 + rz * (PLOT - 1.2)
                const rot = hash(px, py, i * 7 + 11) * Math.PI * 2
                q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot)
                if (kind < 0.62) {
                    const sc = 0.8 + hash(px, py, i * 5 + 4) * 0.7
                    s.set(sc, sc, sc)
                    trunks.push(m.clone().compose(v.set(x, 0.17 * sc, z), q, s))
                    foliage.push(m.clone().compose(v.set(x, 0.64 * sc, z), q, s))
                    crowns.push(m.clone().compose(v.set(x, 1.02 * sc, z), q, s.set(sc * 0.72, sc * 0.8, sc * 0.72)))
                } else if (kind < 0.88) {
                    const sc = 0.7 + hash(px, py, i * 5 + 4) * 0.6
                    s.set(sc, sc * 0.8, sc)
                    bushes.push(m.clone().compose(v.set(x, 0.2 * sc, z), q, s))
                } else {
                    const sc = 0.6 + hash(px, py, i * 5 + 4) * 0.9
                    s.set(sc, sc * 0.7, sc)
                    rocks.push(m.clone().compose(v.set(x, 0.1 * sc, z), q, s))
                }
            }
        }
    }
    const inst = (geo: THREE.BufferGeometry, color: number, mats: THREE.Matrix4[]) => {
        if (mats.length === 0) return
        const im = new THREE.InstancedMesh(geo, townMaterial(color), mats.length)
        mats.forEach((mat, i) => im.setMatrixAt(i, mat))
        im.castShadow = true
        im.receiveShadow = true
        im.instanceMatrix.needsUpdate = true
        decorGroup.add(im)
    }
    inst(TREE_GEOMETRY.trunk, 0x6b4226, trunks)
    inst(TREE_GEOMETRY.foliage, 0x347566, foliage)
    inst(TREE_GEOMETRY.foliage, 0x639969, crowns)
    inst(TREE_GEOMETRY.bush, 0x80a664, bushes)
    inst(TREE_GEOMETRY.rock, 0x9baaaa, rocks)
}

// ─── Villagers ───────────────────────────────────────────────────────────────

interface Villager { group: THREE.Group, x: number, z: number, tx: number, tz: number, speed: number, wait: number, bob: number }
const villagers: Villager[] = []
const VILLAGER_COLORS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x9b59b6, 0x1abc9c, 0xe67e22, 0x2ecc71]

function occupiedTiles(): Set<string> {
    const set = new Set<string>()
    for (const b of props.buildings) {
        const pos = worldPos(b)
        if (pos) set.add(`${Math.floor(pos.x)},${Math.floor(pos.z)}`)
    }
    return set
}

function randomFreeTile(): { x: number, z: number } | null {
    if (props.plots.length === 0) return null
    // Townsfolk live on the streets: start on a road when the town has any.
    const roads = [...roadTiles()]
    if (roads.length) {
        const [wx, wz] = roads[Math.floor(Math.random() * roads.length)]!.split(',').map(Number) as [number, number]
        return { x: wx + 0.5, z: wz + 0.5 }
    }
    const occ = occupiedTiles()
    for (let i = 0; i < 20; i++) {
        const p = props.plots[Math.floor(Math.random() * props.plots.length)]!
        const tx = Math.floor(Math.random() * PLOT)
        const ty = Math.floor(Math.random() * PLOT)
        const wx = p.x * PLOT + tx
        const wz = p.y * PLOT + ty
        if (!occ.has(`${wx},${wz}`)) return { x: wx + 0.5, z: wz + 0.5 }
    }
    return null
}

function syncVillagers() {
    const want = Math.min(18, props.popCap)
    while (villagers.length > want) {
        const v = villagers.pop()!
        villagerGroup.remove(v.group)
    }
    while (villagers.length < want) {
        const start = randomFreeTile()
        if (!start) break
        const group = createVillager(VILLAGER_COLORS[villagers.length % VILLAGER_COLORS.length]!)
        group.position.set(start.x, 0.3, start.z)
        group.scale.setScalar(1.8)
        villagerGroup.add(group)
        villagers.push({ group, x: start.x, z: start.z, tx: start.x, tz: start.z, speed: 0.6 + Math.random() * 0.5, wait: Math.random() * 2, bob: Math.random() * 6 })
    }
}

function stepVillagers(dt: number) {
    const occ = occupiedTiles()
    const roads = roadTiles()
    for (const v of villagers) {
        if (v.wait > 0) { v.wait -= dt; continue }
        const dx = v.tx - v.x
        const dz = v.tz - v.z
        const d = Math.hypot(dx, dz)
        if (d < 0.05) {
            // Stroll to a neighbouring tile: along the road when there is one,
            // across free grass otherwise. Never through a building.
            const opts: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
            const cx = Math.floor(v.x)
            const cz = Math.floor(v.z)
            const onRoad = roads.has(roadKey(cx, cz))
            const candidates = opts.filter(([ox, oz]) => {
                const nx = cx + ox
                const nz = cz + oz
                if (onRoad) return roads.has(roadKey(nx, nz))
                const inside = props.plots.some(p => nx >= p.x * PLOT && nx < p.x * PLOT + PLOT && nz >= p.y * PLOT && nz < p.y * PLOT + PLOT)
                return inside && (!occ.has(`${nx},${nz}`) || roads.has(roadKey(nx, nz)))
            })
            if (candidates.length) {
                const choice = candidates[Math.floor(Math.random() * candidates.length)]!
                v.tx = cx + choice[0] + 0.5
                v.tz = cz + choice[1] + 0.5
            }
            v.wait = Math.random() < 0.3 ? 0.6 + Math.random() * 1.5 : 0
            continue
        }
        const step = Math.min(d, v.speed * dt)
        v.x += (dx / d) * step
        v.z += (dz / d) * step
        v.bob += dt * 12
        v.group.position.set(v.x, 0.3 + Math.abs(Math.sin(v.bob)) * 0.02, v.z)
        v.group.rotation.y = Math.atan2(dx, dz)
    }
}

// ─── Particles (smoke, sparkles, dust) ───────────────────────────────────────

interface Particle { mesh: THREE.Mesh, vx: number, vy: number, vz: number, life: number, maxLife: number, grow: number }
const particles: Particle[] = []
const smokeMat = new THREE.MeshBasicMaterial({ color: 0xdedede, transparent: true, opacity: 0.55, depthWrite: false })
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.95, depthWrite: false })
const dustMat = new THREE.MeshBasicMaterial({ color: 0xc9b58a, transparent: true, opacity: 0.5, depthWrite: false })
const puffGeo = new THREE.SphereGeometry(0.08, 6, 5)
const MAX_PARTICLES = 260

function spawn(pos: THREE.Vector3, kind: 'smoke' | 'spark' | 'dust') {
    if (particles.length >= MAX_PARTICLES) return
    const mat = kind === 'smoke' ? smokeMat : kind === 'spark' ? sparkMat : dustMat
    const mesh = new THREE.Mesh(puffGeo, mat)
    mesh.position.copy(pos)
    const sc = kind === 'spark' ? 0.35 : kind === 'dust' ? 0.7 : 0.8
    mesh.scale.setScalar(sc)
    fxGroup.add(mesh)
    particles.push({
        mesh,
        vx: (Math.random() - 0.5) * (kind === 'spark' ? 0.9 : 0.25),
        vy: kind === 'smoke' ? 0.55 + Math.random() * 0.3 : kind === 'spark' ? 1.2 + Math.random() : 0.4,
        vz: (Math.random() - 0.5) * (kind === 'spark' ? 0.9 : 0.25),
        life: 0,
        maxLife: kind === 'smoke' ? 2.2 + Math.random() : kind === 'spark' ? 0.7 : 0.9,
        grow: kind === 'smoke' ? 0.9 : 0
    })
}

function stepParticles(dt: number) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!
        p.life += dt
        if (p.life >= p.maxLife) {
            fxGroup.remove(p.mesh)
            particles.splice(i, 1)
            continue
        }
        p.mesh.position.x += p.vx * dt
        p.mesh.position.y += p.vy * dt
        p.mesh.position.z += p.vz * dt
        if (p.grow) p.mesh.scale.addScalar(p.grow * dt)
        p.vy -= (p.mesh.material === sparkMat ? 2.2 : 0) * dt
        const t = p.life / p.maxLife
        ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = (p.mesh.material === smokeMat ? 0.5 : 0.95) * (1 - t)
    }
}

// ─── HTML overlays ───────────────────────────────────────────────────────────

const tmp = new THREE.Vector3()
let viewW = 1
let viewH = 1

function project(x: number, y: number, z: number): { sx: number, sy: number, visible: boolean } {
    tmp.set(x, y, z).project(camera)
    return { sx: (tmp.x * 0.5 + 0.5) * viewW, sy: (-tmp.y * 0.5 + 0.5) * viewH, visible: tmp.z < 1 }
}

interface Popup { el: HTMLDivElement, x: number, y: number, z: number, life: number }
const popups: Popup[] = []
const RESOURCE_EMOJI: Record<string, string> = {}

function addPopup(x: number, y: number, z: number, text: string) {
    if (!overlay.value || popups.length > 40) return
    const el = document.createElement('div')
    el.className = 'town-popup'
    el.textContent = text
    overlay.value.appendChild(el)
    popups.push({ el, x, y, z, life: 0 })
}

function ensureBar(e: BuildingEntry) {
    if (e.bar || !overlay.value) return
    const el = document.createElement('div')
    el.className = 'town-bar'
    el.innerHTML = '<i></i>'
    overlay.value.appendChild(el)
    e.bar = el
}

function updateOverlays(now: number, dt: number) {
    // Build progress bars.
    for (const e of entries.values()) {
        const pending = isPending(e.data, now)
        if (!pending) {
            if (e.bar) { e.bar.remove(); e.bar = null }
            continue
        }
        ensureBar(e)
        const def = getTownBuilding(e.data.type)!
        const total = townLevelBuildMs(def, e.data.upgradingTo ?? 1)
        const progress = Math.max(0, Math.min(1, 1 - (e.data.completesAt - now) / total))
        const p = project(e.group.position.x, 1.2, e.group.position.z)
        const bar = e.bar!
        bar.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -50%)`
        bar.style.display = p.visible ? '' : 'none'
        ;(bar.firstElementChild as HTMLElement).style.width = `${Math.round(progress * 100)}%`
    }
    // Production popups.
    for (let i = popups.length - 1; i >= 0; i--) {
        const pu = popups[i]!
        pu.life += dt
        if (pu.life > 1.6) {
            pu.el.remove()
            popups.splice(i, 1)
            continue
        }
        const p = project(pu.x, pu.y + pu.life * 0.8, pu.z)
        pu.el.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -100%)`
        pu.el.style.opacity = String(pu.life < 0.2 ? pu.life / 0.2 : 1 - (pu.life - 0.2) / 1.4)
    }
    // Disconnected buildings: a big "!" that bobs above them.
    for (const e of entries.values()) {
        const cut = e.data.connected === false && e.data.type !== 'road'
        if (!cut) {
            if (e.alert) { e.alert.remove(); e.alert = null }
            continue
        }
        if (!e.alert && overlay.value) {
            const el = document.createElement('div')
            el.className = 'town-alert'
            el.textContent = '!'
            el.title = 'No road at the front door — this building is not working'
            overlay.value.appendChild(el)
            e.alert = el
        }
        if (e.alert) {
            const bob = Math.sin(performance.now() / 350 + e.group.position.x) * 0.06
            const p = project(e.group.position.x, 1.6 + bob, e.group.position.z)
            e.alert.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -100%)`
            e.alert.style.display = p.visible ? '' : 'none'
        }
    }
    // Placement issue bubble follows the ghost.
    if (issueLabel && issueAnchor) {
        const p = project(issueAnchor.x, 1.35, issueAnchor.z)
        issueLabel.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -100%)`
        issueLabel.style.display = p.visible ? '' : 'none'
    }
    // For-sale label.
    for (const e of slotEntries) {
        const key = `${e.slot.x},${e.slot.y}`
        const hovered = key === hoveredSlotKey
        if (hovered && !e.label && overlay.value) {
            const el = document.createElement('div')
            el.className = 'town-sign'
            overlay.value.appendChild(el)
            e.label = el
        }
        if (!hovered && e.label) { e.label.remove(); e.label = null }
        if (e.label) {
            const p = project(e.slot.x * PLOT + PLOT / 2, 2.1, e.slot.y * PLOT + PLOT / 2)
            e.label.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -100%)`
            e.label.textContent = e.slot.free ? props.expansionLabel : `${e.slot.ownerName ?? 'Someone'}'s land`
            e.label.classList.toggle('is-bad', e.slot.free && !props.expansionAffordable)
        }
        if (e.board) e.board.material = signMaterial(hovered)
        if (e.sign) e.sign.rotation.y = cam.yaw
    }
}

// ─── Picking ─────────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster()
const pointerNdc = new THREE.Vector2()
let hoveredBuildingId: string | null = null

type Pick = { kind: 'building', id: string } | { kind: 'tile', tile: TileRef, x: number, z: number } | { kind: 'expansion', x: number, y: number, free: boolean } | null

function pick(sx: number, sy: number): Pick {
    pointerNdc.set((sx / viewW) * 2 - 1, -(sy / viewH) * 2 + 1)
    raycaster.setFromCamera(pointerNdc, camera)
    const hits = raycaster.intersectObjects([buildingsGroup, plotsGroup, expansionGroup], true)
    for (const h of hits) {
        const id = h.object.userData.buildingId as string | undefined
        if (id && (!ghost || !isDescendant(h.object, ghost))) return { kind: 'building', id }
        const plotId = h.object.userData.plotId as string | undefined
        if (plotId) {
            const p = plotById.value.get(plotId)
            if (!p) continue
            const tileX = Math.floor(h.point.x - p.x * PLOT)
            const tileY = Math.floor(h.point.z - p.y * PLOT)
            if (tileX < 0 || tileY < 0 || tileX >= PLOT || tileY >= PLOT) continue
            return { kind: 'tile', tile: { plotId, tileX, tileY }, x: Math.floor(h.point.x), z: Math.floor(h.point.z) }
        }
        const ex = h.object.userData.expansion as { x: number, y: number, free: boolean } | undefined
        if (ex) return { kind: 'expansion', ...ex }
    }
    return null
}

function isDescendant(o: THREE.Object3D, root: THREE.Object3D) {
    let cur: THREE.Object3D | null = o
    while (cur) { if (cur === root) return true; cur = cur.parent }
    return false
}

function tileOccupied(tile: TileRef) {
    return props.buildings.some(b => b.plotId === tile.plotId && b.tileX === tile.tileX && b.tileY === tile.tileY)
}

// ─── Input ───────────────────────────────────────────────────────────────────

let dragging = false
let rotating = false
let moved = 0
let last = { x: 0, y: 0 }
const pointers = new Map<number, { x: number, y: number }>()
let pinch = 0
const isPanning = ref(false)

function local(e: PointerEvent | WheelEvent) {
    const r = canvas.value!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function groundDelta(dx: number, dy: number) {
    const unitsPerPixel = 2 * cam.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / viewH
    return townDragDelta(dx, dy, cam.yaw, cam.pitch, unitsPerPixel)
}

const movementKeys = new Set<string>()
const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD'])
function onMovementKeyDown(e: KeyboardEvent) {
    if (!props.keyboardEnabled || !visible || e.metaKey || e.ctrlKey || e.altKey || townIsTyping(e.target)) return
    if (!movementCodes.has(e.code)) return
    e.preventDefault()
    movementKeys.add(e.code)
}
function onMovementKeyUp(e: KeyboardEvent) {
    movementKeys.delete(e.code)
}
function clearMovement() {
    movementKeys.clear()
}
function moveCamera(dt: number) {
    if (!props.keyboardEnabled || townIsTyping(document.activeElement)) { clearMovement(); return }
    const right = Number(movementKeys.has('KeyD')) - Number(movementKeys.has('KeyA'))
    const forward = Number(movementKeys.has('KeyW')) - Number(movementKeys.has('KeyS'))
    const delta = townKeyboardDelta(right, forward, cam.yaw, cam.dist * 0.45 * dt)
    camGoal.tx += delta.x
    camGoal.tz += delta.z
}

function onPointerDown(e: PointerEvent) {
    canvas.value?.focus({ preventScroll: true })
    canvas.value?.setPointerCapture(e.pointerId)
    const p = local(e)
    pointers.set(e.pointerId, p)
    if (pointers.size === 2) {
        moved = 5
        const [a, b] = [...pointers.values()]
        pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        return
    }
    dragging = true
    rotating = e.button === 2 || e.shiftKey
    moved = 0
    last = p
}

function onPointerMove(e: PointerEvent) {
    const p = local(e)
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p)
    if (pointers.size === 2) {
        moved = 5
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        if (pinch > 0) camGoal.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, camGoal.dist * (pinch / d)))
        pinch = d
        return
    }
    if (dragging) {
        const dx = p.x - last.x
        const dy = p.y - last.y
        moved += Math.abs(dx) + Math.abs(dy)
        if (moved > 4) isPanning.value = true
        if (rotating) {
            camGoal.yaw -= dx * 0.006
            camGoal.pitch = Math.max(0.35, Math.min(1.35, camGoal.pitch + dy * 0.004))
        } else {
            const g = groundDelta(dx, dy)
            camGoal.tx += g.x
            camGoal.tz += g.z
        }
        last = p
        return
    }
    updateHover(p.x, p.y)
}

function onPointerUp(e: PointerEvent) {
    const p = local(e)
    pointers.delete(e.pointerId)
    const wasClick = dragging && !rotating && pointers.size === 0 && moved <= 4 && e.button === 0
    dragging = false
    rotating = false
    isPanning.value = false
    pinch = 0
    if (!wasClick) return
    const hit = pick(p.x, p.y)
    if (!hit) { emit('deselect'); return }
    if (hit.kind === 'building') emit('select-building', hit.id)
    else if (hit.kind === 'tile') {
        if (tileOccupied(hit.tile) && !ghost) return
        emit('select-tile', hit.tile)
    } else if (hit.kind === 'expansion') {
        if (hit.free) emit('select-expansion', { x: hit.x, y: hit.y })
    }
}

function onPointerCancel(e: PointerEvent) {
    pointers.delete(e.pointerId)
    dragging = false
    isPanning.value = false
}

function onWheel(e: WheelEvent) {
    e.preventDefault()
    camGoal.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, camGoal.dist * (1 + Math.sign(e.deltaY) * 0.12)))
}

function onLeave() {
    setHoverBuilding(null)
    setHoverSlot(null)
    setHoverTile(null)
    hoverTile.visible = false
    hideGhost()
}

function setHoverBuilding(id: string | null) {
    if (id === hoveredBuildingId) return
    hoveredBuildingId = id
    emit('hover-building', id)
}

let hoveredTileKey: string | null = null
function setHoverTile(tile: (TileRef & { wx: number, wy: number }) | null) {
    const key = tile ? `${tile.wx},${tile.wy}` : null
    if (key === hoveredTileKey) return
    hoveredTileKey = key
    emit('hover-tile', tile)
}

function setHoverSlot(key: string | null, slot?: { x: number, y: number }) {
    if (key === hoveredSlotKey) return
    hoveredSlotKey = key
    emit('hover-expansion', key && slot ? slot : null)
}

function updateHover(sx: number, sy: number) {
    const hit = pick(sx, sy)
    if (hit?.kind === 'building' && !ghost) {
        setHoverBuilding(hit.id)
        setHoverSlot(null)
        setHoverTile(null)
        hoverTile.visible = false
        hideGhost()
        canvas.value!.style.cursor = 'pointer'
        return
    }
    if (hit?.kind === 'building' && ghost) {
        // Placing over an existing building: show the ghost there, blocked.
        const e = entries.get(hit.id)
        if (e) {
            const wx = Math.floor(e.group.position.x)
            const wy = Math.floor(e.group.position.z)
            setHoverBuilding(null)
            setHoverSlot(null)
            setHoverTile({ plotId: e.data.plotId, tileX: e.data.tileX, tileY: e.data.tileY, wx, wy })
            hoverTile.visible = false
            placeGhostAt(wx, wy)
            if (ghostRadiusMesh) {
                ghostRadiusMesh.visible = true
                ghostRadiusMesh.position.set(wx + 0.5, 0.335, wy + 0.5)
            }
            canvas.value!.style.cursor = 'not-allowed'
            return
        }
    }
    setHoverBuilding(null)
    if (hit?.kind === 'tile') {
        setHoverSlot(null)
        setHoverTile({ ...hit.tile, wx: hit.x, wy: hit.z })
        const occupied = tileOccupied(hit.tile)
        hoverTile.position.set(hit.x + 0.5, 0.31, hit.z + 0.5)
        hoverTile.visible = !occupied && !ghost
        ;(hoverTile.material as THREE.MeshBasicMaterial).color.set(0xffffff)
        if (ghost) placeGhostAt(hit.x, hit.z)
        if (ghostRadiusMesh) {
            ghostRadiusMesh.visible = true
            ghostRadiusMesh.position.set(hit.x + 0.5, 0.335, hit.z + 0.5)
        }
        canvas.value!.style.cursor = ghost ? (props.ghostIssue ? 'not-allowed' : 'copy') : 'default'
        return
    }
    setHoverTile(null)
    hoverTile.visible = false
    hideGhost()
    if (hit?.kind === 'expansion') {
        setHoverSlot(`${hit.x},${hit.y}`, { x: hit.x, y: hit.y })
        canvas.value!.style.cursor = hit.free ? 'pointer' : 'default'
        return
    }
    setHoverSlot(null)
    canvas.value!.style.cursor = 'grab'
}

// ─── Frame loop ──────────────────────────────────────────────────────────────

let rafId = 0
let lastMs = 0
let running = true
let visible = true

function frame(ms: number) {
    rafId = requestAnimationFrame(frame)
    const dt = lastMs === 0 ? 0 : Math.min(0.1, (ms - lastMs) / 1000)
    lastMs = ms
    if (!running || !visible || !renderer || document.hidden) return

    moveCamera(dt)

    // Camera easing.
    const k = 1 - Math.pow(0.001, dt)
    cam.tx += (camGoal.tx - cam.tx) * k
    cam.tz += (camGoal.tz - cam.tz) * k
    cam.yaw += (camGoal.yaw - cam.yaw) * k
    cam.pitch += (camGoal.pitch - cam.pitch) * k
    cam.dist += (camGoal.dist - cam.dist) * k
    applyCamera()

    const now = Date.now() + props.serverOffsetMs

    for (const e of entries.values()) {
        const b = e.data
        const pending = isPending(b, now)
        const def = getTownBuilding(b.type)!
        const staffed = (b.staffing ?? 0) > 0 && !pending && b.level > 0

        // Grow out of the ground while building; pop on completion; hover lift.
        let sy = levelScale(b.level)
        if (pending) {
            const total = townLevelBuildMs(def, b.upgradingTo ?? 1)
            const progress = Math.max(0, Math.min(1, 1 - (b.completesAt - now) / total))
            sy = (b.level === 0 ? 0.15 : levelScale(b.level)) + progress * (levelScale(b.upgradingTo ?? 1) - (b.level === 0 ? 0.15 : levelScale(b.level))) * 0.9
            if (Math.random() < dt * 1.5) spawn(new THREE.Vector3(e.group.position.x + (Math.random() - 0.5) * 0.6, 0.35, e.group.position.z + (Math.random() - 0.5) * 0.6), 'dust')
        }
        let pop = 0
        if (e.popAt) {
            const t = (ms - e.popAt) / 500
            if (t >= 1) {
                e.popAt = 0
            } else {
                pop = Math.sin(t * Math.PI) * (1 - t) * 0.35
                if (t < 0.1 && Math.random() < 0.6) spawn(new THREE.Vector3(e.group.position.x, 0.8, e.group.position.z), 'spark')
            }
        }
        const hovered = hoveredBuildingId === b.id
        if (def.kind === 'road') {
            e.group.position.y = e.baseY
            continue
        }
        const sxz = levelScale(Math.max(b.level, pending ? 0 : 1)) + pop
        e.model.scale.set(sxz, sy + pop, sxz)
        e.group.position.y = e.baseY + (hovered ? 0.06 : 0)

        // Animation hooks.
        if (staffed) {
            for (const o of e.spin) {
                if (b.type === 'mill') o.rotation.z += dt * 1.6 * props.speedMultiplier
                else o.rotation.y += dt * 4 * props.speedMultiplier
            }
            if (e.smoke.length && Math.random() < dt * 1.4 * props.speedMultiplier) {
                const anchor = e.smoke[Math.floor(Math.random() * e.smoke.length)]!
                anchor.getWorldPosition(tmp)
                spawn(tmp.clone(), 'smoke')
            }
            if (b.type === 'smithy' && Math.random() < dt * 2) {
                spawn(new THREE.Vector3(e.group.position.x + 0.25, 0.45, e.group.position.z + 0.4), 'spark')
            }
            if (b.type === 'emporium' && Math.random() < dt * 3) {
                spawn(new THREE.Vector3(e.group.position.x + (Math.random() - 0.5) * 0.8, 0.9 + Math.random() * 0.4, e.group.position.z + (Math.random() - 0.5) * 0.8), 'spark')
            }
            // Cosmetic production popup roughly once per tick.
            if (ms >= e.nextPopup) {
                e.nextPopup = ms + props.tickMs / Math.max(0.5, props.speedMultiplier) * (0.85 + Math.random() * 0.3)
                const out = Object.keys(def.outputs)[0]
                if (out) addPopup(e.group.position.x, 1.1, e.group.position.z, `+${Math.max(1, Math.floor(b.level * (b.staffing ?? 0)))} ${RESOURCE_EMOJI[out] ?? ''}`)
            }
        }
        for (const g of e.glow) {
            const m = g.material as THREE.MeshStandardMaterial
            m.emissiveIntensity = staffed || def.kind === 'housing' ? 1.1 + Math.sin(ms / 400 + e.group.position.x) * 0.3 : 0.15
        }
    }

    // Selection ring.
    const sel = props.selectedBuildingId ? entries.get(props.selectedBuildingId) : null
    if (sel) {
        ring.visible = true
        ring.position.set(sel.group.position.x, 0.32, sel.group.position.z)
        const s = 1 + Math.sin(ms / 300) * 0.05
        ring.scale.set(s, s, s)
    } else {
        ring.visible = false
    }

    for (const c of clouds) {
        c.position.x += (c.userData.drift as number) * dt
        if (c.position.x > 120) c.position.x = -120
    }

    stepVillagers(dt)
    stepParticles(dt)
    updateOverlays(now, dt)
    renderer.render(scene, camera)
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function resize() {
    if (!renderer || !wrap.value) return
    const r = wrap.value.getBoundingClientRect()
    viewW = Math.max(1, Math.round(r.width))
    viewH = Math.max(1, Math.round(r.height))
    renderer.setSize(viewW, viewH, false)
    camera.aspect = viewW / viewH
    camera.updateProjectionMatrix()
}

let ro: ResizeObserver | null = null
let io: IntersectionObserver | null = null

onMounted(() => {
    const el = canvas.value
    if (!el) return
    renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.outputColorSpace = THREE.SRGBColorSpace

    window.addEventListener('keydown', onMovementKeyDown)
    window.addEventListener('keyup', onMovementKeyUp)
    window.addEventListener('blur', clearMovement)
    document.addEventListener('visibilitychange', clearMovement)
    setupStatic()
    rebuildPlots()
    rebuildExpansions()
    rebuildDecor()
    syncBuildings()
    syncVillagers()
    rebuildGhost()
    rebuildGhostRadius()
    syncRadii()
    recenter(false)
    resize()

    ro = new ResizeObserver(resize)
    ro.observe(wrap.value!)
    io = new IntersectionObserver((es) => { visible = es[0]?.isIntersecting ?? true })
    io.observe(el)
    el.addEventListener('contextmenu', e => e.preventDefault())
    rafId = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
    running = false
    clearMovement()
    window.removeEventListener('keydown', onMovementKeyDown)
    window.removeEventListener('keyup', onMovementKeyUp)
    window.removeEventListener('blur', clearMovement)
    document.removeEventListener('visibilitychange', clearMovement)
    cancelAnimationFrame(rafId)
    ro?.disconnect()
    io?.disconnect()
    for (const e of entries.values()) { e.bar?.remove(); e.alert?.remove() }
    for (const p of popups) p.el.remove()
    renderer?.dispose()
    renderer = null
})

watch(() => props.plots, () => { rebuildPlots(); rebuildDecor(); syncBuildings(); syncVillagers() }, { deep: true })
watch(() => props.expansions, () => { rebuildExpansions(); rebuildDecor() }, { deep: true })
watch(() => props.buildings, () => { syncBuildings(); syncVillagers() }, { deep: true })
watch(() => props.popCap, syncVillagers)
watch(() => props.ghostType, rebuildGhost)
watch(() => props.keyboardEnabled, clearMovement)
watch(() => props.ghostRotation, (value) => {
    if (ghost) ghost.rotation.y = value * Math.PI / 2
    if (ghost?.visible) placeGhostAt(Math.floor(ghost.position.x), Math.floor(ghost.position.z))
})
watch(() => props.ghostIssue, () => { if (ghost?.visible) placeGhostAt(Math.floor(ghost.position.x), Math.floor(ghost.position.z)) })
watch(() => props.movingId, () => { for (const e of entries.values()) e.group.visible = props.movingId !== e.data.id })
watch(() => props.ghostRadius, rebuildGhostRadius, { deep: true })
watch(() => props.effectRadii, syncRadii, { deep: true })
watch(() => props.plots.length, (n, prev) => { if (n !== prev) recenter(true) })

defineExpose({ recenter: () => recenter(true), setResourceEmoji: (map: Record<string, string>) => Object.assign(RESOURCE_EMOJI, map) })
</script>

<template>
    <div ref="wrap" class="relative h-full w-full overflow-hidden select-none">
        <canvas
            ref="canvas"
            tabindex="0"
            aria-label="Town view. WASD to move, drag to pan, right-drag to orbit, scroll to zoom."
            class="block h-full w-full touch-none"
            :class="isPanning ? 'cursor-grabbing' : ''"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerCancel"
            @pointerleave="onLeave"
            @wheel="onWheel"
        />
        <div ref="overlay" class="town-overlay pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
</template>

<style scoped>
.town-overlay :deep(.town-bar) {
    position: absolute;
    left: 0;
    top: 0;
    width: 56px;
    height: 8px;
    border-radius: 999px;
    background: rgba(20, 24, 30, 0.75);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    will-change: transform;
}
.town-overlay :deep(.town-bar i) {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #7ee081, #3ecf5a);
    border-radius: 999px;
    transition: width 0.4s linear;
}
.town-overlay :deep(.town-popup) {
    position: absolute;
    left: 0;
    top: 0;
    font: 700 13px/1 system-ui, sans-serif;
    color: #fff;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
    white-space: nowrap;
    will-change: transform, opacity;
}
.town-overlay :deep(.town-sign) {
    position: absolute;
    left: 0;
    top: 0;
    padding: 6px 10px;
    border-radius: 10px;
    background: rgba(255, 244, 214, 0.96);
    color: #4a3419;
    font: 700 13px/1.2 system-ui, sans-serif;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
    white-space: pre;
    text-align: center;
    will-change: transform;
}
.town-overlay :deep(.town-alert) {
    position: absolute;
    left: 0;
    top: 0;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: #e5322d;
    color: #fff;
    font: 900 20px/30px system-ui, sans-serif;
    text-align: center;
    box-shadow: 0 0 0 4px rgba(229, 50, 45, 0.28), 0 6px 14px rgba(0, 0, 0, 0.4);
    will-change: transform;
}
.town-overlay :deep(.town-issue) {
    position: absolute;
    left: 0;
    top: 0;
    max-width: 260px;
    padding: 6px 10px;
    border-radius: 10px;
    background: rgba(214, 48, 49, 0.94);
    color: #fff;
    font: 700 12px/1.25 system-ui, sans-serif;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
    text-align: center;
    white-space: normal;
    will-change: transform;
}
.town-overlay :deep(.town-sign.is-bad) {
    background: rgba(255, 214, 214, 0.96);
    color: #7a1f1f;
}
</style>
