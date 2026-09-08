<script setup lang="ts">
// Polytown 3D scene. Three.js, one rAF loop. World units: one tile = 1, plot
// (px, py) covers x ∈ [px*8, px*8+8), z ∈ [py*8, py*8+8). HTML overlays
// (progress bars, for-sale prices, production popups) are positioned by
// projecting world points each frame and written straight to the DOM — no
// per-frame Vue re-render.
import * as THREE from 'three'
import { addLandscape, clearLandscape, createMeadowTexture } from '~/utils/town/landscape'
import { animateTownWater } from '~/utils/town/surfaces'
import { createTerrainOverlay, createWaterLayer, disposeTerrainOverlay, disposeWaterLayer } from '~/utils/town/terrain'
import { townVisualLevel } from '~/utils/town/appearance'
import { townDragDelta, townKeyboardDelta, townIsTyping } from '~/utils/town/camera'
import { TOWN_PLOT_SIZE, TOWN_FACING, getTownBuilding, townLevelBuildMs, townFrontTile, type TownBuildingDef, type TownBuildingId } from '#shared/utils/gamelogic/town'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createBuildingModel, townMaterial } from '~/utils/town/models'
import { createCar, createTruck, TOWN_VEHICLE_COLORS, TOWN_VEHICLE_SIZE } from '~/utils/town/vehicles'

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
    /** Total duration of the job running now, quoted by the server. */
    jobMs?: number | null
}
export interface SceneExpansion { x: number, y: number, free: boolean, ownerName?: string }
export interface SceneNeighbour {
    id: string
    x: number
    y: number
    ownerName: string
    listPrice: number | null
    buildings: { type: string, tileX: number, tileY: number, rotation: number, level: number }[]
}
export interface TileRef { plotId: string, tileX: number, tileY: number }

const props = withDefaults(defineProps<{
    plots: ScenePlot[]
    buildings: SceneBuilding[]
    expansions: SceneExpansion[]
    /** Other mayors' land around you — drawn, named, never interactive except when for sale. */
    neighbours?: SceneNeighbour[]
    selectedBuildingId?: string | null
    ghostType?: string | null
    ghostRotation?: number
    ghostLevel?: number
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
    /** Tint the ground by terrain type. Off, the scene looks exactly as it always does. */
    terrainOverlay?: boolean
}>(), {
    selectedBuildingId: null,
    ghostType: null,
    ghostRotation: 0,
    ghostLevel: 1,
    keyboardEnabled: true,
    serverOffsetMs: 0,
    popCap: 0,
    speedMultiplier: 1,
    tickMs: 60_000,
    expansionLabel: '',
    expansionAffordable: true,
    neighbours: () => [],
    effectRadii: () => [],
    ghostRadius: null,
    ghostIssue: null,
    movingId: null,
    terrainOverlay: false
})

const emit = defineEmits<{
    'select-tile': [tile: TileRef]
    'select-building': [id: string]
    'select-expansion': [slot: { x: number, y: number }]
    /** A neighbour's plot that is on the market. */
    'select-listing': [plot: { id: string, ownerName: string, price: number }]
    'hover-building': [id: string | null]
    'hover-expansion': [slot: { x: number, y: number, free: boolean, ownerName?: string } | null]
    /** Tile under the cursor in world coordinates, or null — the parent decides placement validity and auto-facing. */
    'hover-tile': [tile: (TileRef & { wx: number, wy: number }) | null]
    /** Another mayor's plot or building under the cursor. */
    'hover-neighbour': [info: { plotId: string, ownerName: string, type?: string, level?: number } | null]
    'deselect': []
}>()

const wrap = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const overlay = ref<HTMLDivElement | null>(null)

const PLOT = TOWN_PLOT_SIZE

// ─── Frame budget ────────────────────────────────────────────────────────────
// An idle town is a still picture most of the time. Everything below trades
// frames nobody looks at for a laptop fan that stays quiet: a lower pixel
// ratio, shadows redrawn only on change, a 30fps cap while the camera rests
// (60 while it moves), overlays written at 10Hz, and per-frame set-building
// hoisted into caches invalidated when the buildings actually change.
const MAX_PIXEL_RATIO = 1.5
const IDLE_FRAME_MS = 1000 / 30
const ACTIVE_FRAME_MS = 1000 / 60
const OVERLAY_INTERVAL_MS = 100

let shadowsDirty = true
function markShadowsDirty() {
    shadowsDirty = true
}

// ─── Scene graph ─────────────────────────────────────────────────────────────

let renderer: THREE.WebGLRenderer | null = null
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400)
const sun = new THREE.DirectionalLight(0xffdfac, 3.1)
const plotsGroup = new THREE.Group()
const buildingsGroup = new THREE.Group()
const expansionGroup = new THREE.Group()
const neighbourGroup = new THREE.Group()
const decorGroup = new THREE.Group()
const vehicleGroup = new THREE.Group()
const fxGroup = new THREE.Group()
const terrainGroup = new THREE.Group()
const waterGroup = new THREE.Group()
scene.add(plotsGroup, buildingsGroup, expansionGroup, neighbourGroup, decorGroup, vehicleGroup, waterGroup, terrainGroup, fxGroup)

const SKY = 0xc6d3cc
scene.background = new THREE.Color(SKY)
scene.fog = new THREE.Fog(SKY, 60, 160)

// ─── Camera rig ──────────────────────────────────────────────────────────────

const cam = { tx: 4, tz: 4, yaw: 0.7, pitch: 0.95, dist: 22 }
const camGoal = { ...cam }
const MIN_DIST = 7
const MAX_DIST = 70

let sunAt = { x: Infinity, z: Infinity }
function applyCamera() {
    const { tx, tz, yaw, pitch, dist } = cam
    camera.position.set(
        tx + dist * Math.cos(pitch) * Math.sin(yaw),
        dist * Math.sin(pitch),
        tz + dist * Math.cos(pitch) * Math.cos(yaw)
    )
    camera.lookAt(tx, 0, tz)
    // The shadow camera follows the view so shadows cover what's on screen, but
    // nudging it every frame would force a shadow redraw every frame. Move it
    // in steps instead, and only then mark the map dirty.
    if (Math.abs(tx - sunAt.x) > 3 || Math.abs(tz - sunAt.z) > 3) {
        sunAt = { x: tx, z: tz }
        sun.position.set(tx + 30, 32, tz + 18)
        sun.target.position.set(tx, 0, tz)
        sun.target.updateMatrixWorld()
        markShadowsDirty()
    }
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
        camGoal.dist = Math.min(MAX_DIST, Math.max(MIN_DIST, span * 1.6 + 8))
    }
    if (!animate) Object.assign(cam, camGoal)
}

// ─── Lighting & ground ───────────────────────────────────────────────────────

function setupStatic() {
    const hemi = new THREE.HemisphereLight(0xdceafa, 0x655339, 1.35)
    scene.add(hemi)
    const skyFill = new THREE.DirectionalLight(0xd8e7f1, 0.35)
    skyFill.position.set(-30, 20, -20)
    scene.add(skyFill)
    sun.castShadow = true
    // 1024 is indistinguishable at this camera distance and a quarter the fill.
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.near = 5
    sun.shadow.camera.far = 120
    sun.shadow.camera.left = -34
    sun.shadow.camera.right = 34
    sun.shadow.camera.top = 34
    sun.shadow.camera.bottom = -34
    sun.shadow.radius = 2
    sun.shadow.bias = -0.0006
    sun.shadow.normalBias = 0.02
    scene.add(sun, sun.target)

    meadowTexture = createMeadowTexture()
    meadowTexture.repeat.set(600 / 16, 600 / 16)
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(600, 600),
        new THREE.MeshStandardMaterial({ map: meadowTexture, roughness: 1 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    ground.receiveShadow = true
    scene.add(ground)

    // Distant hills in the fog give the horizon some shape.
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x668b73, roughness: 1, flatShading: true })
    const hillGeo = new THREE.SphereGeometry(1, 8, 6)
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2
        const r = 95 + (i % 3) * 18
        const hill = new THREE.Mesh(hillGeo, hillMat)
        hill.position.set(Math.cos(a) * r, -6, Math.sin(a) * r)
        hill.scale.set(28 + (i % 4) * 9, 14 + (i % 3) * 5, 24 + (i % 5) * 6)
        scene.add(hill)
    }

    // Clouds: flat soft ellipsoids drifting slowly.
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85 })
    const puffGeo = new THREE.SphereGeometry(1, 7, 5)
    for (let i = 0; i < 6; i++) {
        const cloud = new THREE.Group()
        for (let j = 0; j < 3; j++) {
            const puff = new THREE.Mesh(puffGeo, cloudMat)
            puff.position.set(j * 1.6 - 1.6, (j % 2) * 0.3, (j % 2) * 0.6)
            puff.scale.set(2.2 + j * 0.4, 0.9, 1.6)
            cloud.add(puff)
        }
        cloud.position.set((i - 3) * 34 + (i % 2) * 9, 24 + (i % 3) * 3, -30 + (i % 4) * 18)
        cloud.userData.drift = 0.4 + (i % 3) * 0.15
        clouds.push(cloud)
        scene.add(cloud)
    }
}
const clouds: THREE.Group[] = []

// ─── Plots ───────────────────────────────────────────────────────────────────

let meadowTexture: THREE.CanvasTexture | null = null
let plotTexture: THREE.CanvasTexture | null = null
function makePlotTexture(): THREE.CanvasTexture {
    if (plotTexture) return plotTexture
    const size = 512
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const g = c.getContext('2d')!
    const meadow = createMeadowTexture()
    g.drawImage(meadow.image as HTMLCanvasElement, 0, 0, size, size)
    meadow.dispose()
    const cell = size / PLOT
    for (let y = 0; y < PLOT; y++) {
        for (let x = 0; x < PLOT; x++) {
            g.fillStyle = (x + y) % 2 === 0 ? 'rgba(211, 210, 135, 0.055)' : 'rgba(211, 210, 135, 0.025)'
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
    g.strokeStyle = 'rgba(51, 77, 46, 0.09)'
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

/**
 * Empty a group and give back everything it held.
 *
 * Object3D.clear() only unparents: the GL buffer behind a dropped geometry is
 * freed on its 'dispose' event and nowhere else, so a rebuild that merely
 * clears leaks every geometry and material it made, for the life of the tab.
 * These groups rebuild on every poll, so that adds up fast.
 */
function disposeGroup(group: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    group.traverse((child) => {
        const mesh = child as THREE.Mesh | THREE.LineSegments
        if (!mesh.geometry) return
        geometries.add(mesh.geometry)
        const material = mesh.material
        if (Array.isArray(material)) for (const m of material) materials.add(m)
        else if (material) materials.add(material)
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) {
        const withMap = material as THREE.Material & { map?: THREE.Texture | null }
        withMap.map?.dispose()
        material.dispose()
    }
    group.clear()
}

const plotMeshes = new Map<string, THREE.Mesh>()
function rebuildPlots() {
    disposeGroup(plotsGroup)
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

// ─── Terrain overlay ─────────────────────────────────────────────────────────

/**
 * The terrain map, rebuilt whenever the land or the ghost changes. It is torn
 * down rather than hidden: an overlay nobody is looking at should not be
 * holding a canvas texture per plot.
 */
function rebuildTerrainOverlay() {
    disposeTerrainOverlay(terrainGroup)
    if (!props.terrainOverlay) return
    const highlight = props.ghostType && getTownBuilding(props.ghostType) ? props.ghostType as TownBuildingId : null
    terrainGroup.add(...createTerrainOverlay(props.plots, highlight).children)
}

/**
 * Water is always on screen, overlay or not: it is the one terrain that
 * refuses a building, and a pond the player cannot see is a placement error
 * with no explanation.
 */
function rebuildWater() {
    disposeWaterLayer(waterGroup)
    waterGroup.add(...createWaterLayer(props.plots).children)
    markShadowsDirty()
}

// ─── Expansion slots ─────────────────────────────────────────────────────────

let hoveredSlotKey: string | null = null

function rebuildExpansions() {
    disposeGroup(expansionGroup)
    const freeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.055, roughness: 1, depthWrite: false })
    const takenMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.18, roughness: 1, depthWrite: false })
    for (const slot of props.expansions) {
        const hit = new THREE.Mesh(new THREE.PlaneGeometry(PLOT - 0.3, PLOT - 0.3), slot.free ? freeMat : takenMat)
        hit.rotation.x = -Math.PI / 2
        hit.position.set(slot.x * PLOT + PLOT / 2, 0.01, slot.y * PLOT + PLOT / 2)
        hit.userData.expansion = { x: slot.x, y: slot.y, free: slot.free }
        expansionGroup.add(hit)

        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.PlaneGeometry(PLOT - 0.3, PLOT - 0.3)),
            new THREE.LineDashedMaterial({ color: slot.free ? 0xffffff : 0x666666, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.32 })
        )
        edges.computeLineDistances()
        edges.rotation.x = -Math.PI / 2
        edges.position.copy(hit.position).setY(0.02)
        expansionGroup.add(edges)
    }
}

// ─── Neighbours ──────────────────────────────────────────────────────────────
// One realm: other mayors' land is drawn around yours so you can watch them
// grow, see where you could expand, and spot a plot they have put up for sale.
// Their buildings are static props — no animation, no picking beyond a listing.


function rebuildNeighbours() {
    disposeGroup(neighbourGroup)
    if (props.neighbours.length === 0) return

    const tex = makePlotTexture()
    const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, color: 0xb9b9b9 })
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x7a6247, roughness: 1 })
    const roads = new Set<string>()
    for (const n of props.neighbours) {
        for (const b of n.buildings) {
            if (b.type === 'road') roads.add(roadKey(n.x * PLOT + b.tileX, n.y * PLOT + b.tileY))
        }
    }

    for (const n of props.neighbours) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(PLOT, 0.3, PLOT), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat])
        slab.position.set(n.x * PLOT + PLOT / 2, 0.15, n.y * PLOT + PLOT / 2)
        slab.receiveShadow = true
        slab.userData.neighbour = { plotId: n.id, ownerName: n.ownerName }
        if (n.listPrice !== null) slab.userData.listing = { id: n.id, ownerName: n.ownerName, price: n.listPrice }
        neighbourGroup.add(slab)

        for (const b of n.buildings) {
            const wx = n.x * PLOT + b.tileX
            const wy = n.y * PLOT + b.tileY
            const model = b.type === 'road'
                ? buildRoadModel(roadConnections(wx, wy, roads))
                : buildingModel(b.type as TownBuildingId)
            model.position.set(wx + 0.5, 0.3, wy + 0.5)
            if (b.type !== 'road') {
                model.rotation.y = b.rotation * Math.PI / 2
                model.scale.setScalar(levelScale(b.level))
            }
            const info = { plotId: n.id, ownerName: n.ownerName, type: b.type, level: b.level }
            model.traverse((o) => {
                o.userData.neighbourBuilding = info
                if (n.listPrice !== null) o.userData.listing = { id: n.id, ownerName: n.ownerName, price: n.listPrice }
            })
            neighbourGroup.add(model)
        }
    }
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
    visualLevel: number
    modelHeight: number
    wasPending: boolean
    popAt: number
    baseY: number
    nextPopup: number
    /** Connection signature for roads, so the tile is only rebuilt when neighbours change. */
    roadSig?: string
    /** Big red "!" while the front door has no road. */
    alert: HTMLDivElement | null
    /** Cached definition — looked up once per building, not once per frame. */
    def: TownBuildingDef
}
const entries = new Map<string, BuildingEntry>()
const plotById = computed(() => new Map(props.plots.map(p => [p.id, p])))

function worldPos(b: SceneBuilding): { x: number, z: number } | null {
    const p = plotById.value.get(b.plotId)
    if (!p) return null
    return { x: p.x * PLOT + b.tileX + 0.5, z: p.y * PLOT + b.tileY + 0.5 }
}

function makeScaffold(height = 0.9): THREE.Group {
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
    g.scale.y = Math.max(1, height / 0.9)
    return g
}

// ─── Model flattening ────────────────────────────────────────────────────────
// A modelled building is dozens of little boxes, and every one of them is a
// draw call. The parts that never move can be merged into one mesh per
// material without touching the model definitions: only the named parts the
// frame loop animates (and anything under them) stay separate.

const ANIMATED_PARTS = new Set(['spin', 'smoke', 'glow', 'sparkle', 'cart', 'crop', 'board'])

function flattenModel(group: THREE.Group): THREE.Group {
    group.updateMatrixWorld(true)
    const out = new THREE.Group()
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>()

    // build() lays parts out as direct children, so a shallow pass is enough —
    // a named part keeps its whole subtree (the mill's sails hang off its hub).
    for (const child of [...group.children]) {
        const mesh = child instanceof THREE.Mesh ? child : null
        if (!mesh || (mesh.name && ANIMATED_PARTS.has(mesh.name)) || child.children.length > 0) {
            out.add(child)
            continue
        }
        const material = mesh.material as THREE.Material
        const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
        const bucket = byMaterial.get(material)
        if (bucket) bucket.push(geometry)
        else byMaterial.set(material, [geometry])
    }

    for (const [material, geometries] of byMaterial) {
        const merged = geometries.length === 1 ? geometries[0]! : mergeGeometries(geometries, false)
        if (!merged) {
            // Attribute sets did not line up; fall back to separate meshes.
            for (const g of geometries) out.add(new THREE.Mesh(g, material))
            continue
        }
        const mesh = new THREE.Mesh(merged, material)
        mesh.castShadow = true
        mesh.receiveShadow = true
        out.add(mesh)
    }
    return out
}

/** The asset factory batches static parts and caches each type/level pair. */
function buildingModel(type: TownBuildingId, level = 1): THREE.Group {
    return createBuildingModel(type, level)
}

// ─── Roads ───────────────────────────────────────────────────────────────────
// A road tile is a flat slab with a lighter centre line running toward every
// neighbouring road, so a network reads as one connected street.

const ROAD_BASE = townMaterial(0x595a60)
const ROAD_LINE = townMaterial(0xd9d3c3)
const ROAD_CURB = townMaterial(0x8d8f95)

function roadKey(wx: number, wy: number) { return `${wx},${wy}` }

// The road set is rebuilt only when the buildings or plots change, not per frame.
let roadCache: Set<string> | null = null
function invalidateTileCaches() {
    roadCache = null
}

function roadTiles(): Set<string> {
    if (roadCache) return roadCache
    const set = new Set<string>()
    for (const b of props.buildings) {
        if (b.type !== 'road') continue
        const pos = worldPos(b)
        if (pos) set.add(roadKey(Math.floor(pos.x), Math.floor(pos.z)))
    }
    roadCache = set
    return set
}

function roadConnections(wx: number, wy: number, roads: Set<string>): boolean[] {
    return TOWN_FACING.map(([dx, dy]) => roads.has(roadKey(wx + dx, wy + dy)))
}

const roadModelCache = new Map<string, THREE.Group>()
function buildRoadModel(conns: boolean[]): THREE.Group {
    const key = conns.map(c => c ? '1' : '0').join('')
    const cached = roadModelCache.get(key)
    if (cached) return cached.clone(true)
    const built = flattenModel(buildRoadParts(conns))
    roadModelCache.set(key, built)
    return built.clone(true)
}

function buildRoadParts(conns: boolean[]): THREE.Group {
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

// Swap only the artwork. Keep selection, rotation, timers and the building's
// simulation data intact, and bind animation anchors on the new model.
function syncModelAppearance(e: BuildingEntry, level: number) {
    if (e.data.type === 'road' || e.visualLevel === level) return
    releaseModelGlow(e.model)
    e.group.remove(e.model)
    e.model = buildingModel(e.data.type as TownBuildingId, level)
    e.model.rotation.y = (e.data.rotation ?? 0) * Math.PI / 2
    e.model.traverse(o => { o.userData.buildingId = e.data.id })
    e.group.add(e.model)
    e.visualLevel = level
    e.modelHeight = e.model.userData.height as number
    bindModelAnimations(e)
    markShadowsDirty()
}

function bindModelAnimations(e: BuildingEntry) {
    e.spin = []
    e.smoke = []
    e.glow = []
    e.model.traverse(o => {
        if (o.name === 'spin') e.spin.push(o)
        if (o.name === 'smoke') e.smoke.push(o)
        if (o.name === 'glow' && o instanceof THREE.Mesh) e.glow.push(o)
    })
}

function releaseModelGlow(model: THREE.Group) {
    model.traverse(o => {
        if (o.name === 'glow' && o instanceof THREE.Mesh) (o.material as THREE.Material).dispose()
    })
}

function displayedLevel(b: SceneBuilding, now: number) {
    return townVisualLevel(!isPending(b, now) && b.upgradingTo !== null ? Math.max(b.level, b.upgradingTo) : b.level)
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
                : buildingModel(b.type as TownBuildingId, displayedLevel(b, now))
            group.add(model)
            group.userData.buildingId = b.id
            model.traverse((o) => { o.userData.buildingId = b.id })
            buildingsGroup.add(group)
            e = {
                data: b, group, model, scaffold: null, bar: null,
                spin: [], smoke: [], glow: [],
                visualLevel: displayedLevel(b, now),
                modelHeight: (model.userData.height as number | undefined) ?? 0.9,
                wasPending: isPending(b, now), popAt: 0, baseY: 0.3,
                nextPopup: performance.now() + Math.random() * props.tickMs,
                roadSig: sig,
                alert: null,
                def: getTownBuilding(b.type)!
            }
            bindModelAnimations(e)
            entries.set(b.id, e)
        }
        e.data = b
        syncModelAppearance(e, displayedLevel(b, now))
        e.model.rotation.y = isRoad ? 0 : (b.rotation ?? 0) * Math.PI / 2
        e.group.position.set(pos.x, e.baseY, pos.z)
        e.group.visible = props.movingId !== b.id
        const pending = isPending(b, now)
        if (pending && !e.scaffold) {
            e.scaffold = makeScaffold(e.modelHeight * levelScale(b.level) + 0.15)
            e.group.add(e.scaffold)
        }
        if (!pending && e.scaffold) {
            e.group.remove(e.scaffold)
            disposeGroup(e.scaffold)
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
    releaseModelGlow(e.model)
    buildingsGroup.remove(e.group)
    // The model's geometry is shared with the prototype cache and must not be
    // touched; the scaffold is this entry's own and would otherwise leak.
    if (e.scaffold) { disposeGroup(e.scaffold); e.scaffold = null }
    e.bar?.remove()
    e.alert?.remove()
}

// ─── Ghost ───────────────────────────────────────────────────────────────────

let ghost: THREE.Group | null = null
let ghostMats: THREE.MeshStandardMaterial[] = []
function rebuildGhost() {
    if (ghost) { buildingsGroup.remove(ghost); ghostMats.forEach(m => m.dispose()); ghost = null; ghostMats = [] }
    hideGhost()
    if (!props.ghostType || !getTownBuilding(props.ghostType)) return
    const ghostDef = getTownBuilding(props.ghostType)!
    ghost = ghostDef.kind === 'road' ? buildRoadModel([false, false, false, false]) : buildingModel(props.ghostType as TownBuildingId, props.ghostLevel)
    ghost.traverse((o) => {
        if (o instanceof THREE.Mesh) {
            const m = (o.material as THREE.MeshStandardMaterial).clone()
            m.transparent = true
            m.opacity = 0.55
            m.emissive = new THREE.Color(0x2ecc71)
            m.emissiveIntensity = 0.35
            if (o.name === 'glow') (o.material as THREE.Material).dispose()
            o.material = m
            o.castShadow = false
            ghostMats.push(m)
        }
    })
    ghost.visible = false
    ghost.rotation.y = ghostDef.kind === 'road' ? 0 : props.ghostRotation * Math.PI / 2
    ghost.scale.setScalar(ghostDef.kind === 'road' ? 1 : levelScale(props.ghostLevel))
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
        disposeGroup(holder)
        holder.add(makeRadius(r.radius, r.kind))
        holder.position.set(r.x, 0.33, r.y)
        holder.visible = true
    })
    for (let i = wanted.length; i < radiusPool.length; i++) radiusPool[i]!.visible = false
}

let ghostRadiusMesh: THREE.Group | null = null
function rebuildGhostRadius() {
    if (ghostRadiusMesh) { fxGroup.remove(ghostRadiusMesh); disposeGroup(ghostRadiusMesh); ghostRadiusMesh = null }
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
    clearLandscape(decorGroup)
    const blocked = new Set<string>()
    for (const p of props.plots) blocked.add(`${p.x},${p.y}`)
    for (const s of props.expansions) blocked.add(`${s.x},${s.y}`)
    for (const n of props.neighbours) blocked.add(`${n.x},${n.y}`)
    let minPX = Infinity, maxPX = -Infinity, minPY = Infinity, maxPY = -Infinity
    for (const p of props.plots) {
        minPX = Math.min(minPX, p.x); maxPX = Math.max(maxPX, p.x)
        minPY = Math.min(minPY, p.y); maxPY = Math.max(maxPY, p.y)
    }
    if (!Number.isFinite(minPX)) { minPX = maxPX = minPY = maxPY = 0 }
    const parcels: { x: number, z: number }[] = []
    for (let py = minPY - 5; py <= maxPY + 5; py++) {
        for (let px = minPX - 5; px <= maxPX + 5; px++) {
            if (!blocked.has(`${px},${py}`)) parcels.push({ x: px, z: py })
        }
    }
    addLandscape(decorGroup, parcels, PLOT)
}

// ─── Traffic ─────────────────────────────────────────────────────────────────
// Cars and trucks are decoration that makes the road network look used. Every
// vehicle is a one-way journey: a car runs between a house and a workplace
// (either direction), a truck hauls a real supply link from the producer to the
// building that needs what it makes, and both are gone the moment they arrive.
// Replacements trickle in on a jittered timer, so the town shows a stream of
// different journeys rather than the same few loops.
//
// Routes are breadth-first searches over the road tiles, computed once per
// journey — never per frame. Traffic keeps right of the centre line and queues
// behind whatever is in front of it. Nothing here is pickable, and nothing
// casts a shadow: the shadow map is only redrawn on change, so a moving caster
// would smear.

const MAX_CARS = 3
const MAX_TRUCKS = 3
/** Seconds between spawns. Random inside the range so it never looks metronomic. */
const SPAWN_MIN = 1.2
const SPAWN_MAX = 4
/** Shorter wait before trying again when a spawn found nowhere to go. */
const SPAWN_RETRY = 0.6
/** Road surface height: the plot slab (0.3) plus the road slab (0.04). */
const VEHICLE_Y = 0.34
/**
 * How far right of the centre line traffic drives, in tiles. Two lanes are
 * 0.44 apart and a vehicle is 0.22 wide, so oncoming traffic passes with a
 * fifth of a tile between the two and stays well inside the curbs.
 */
const LANE_OFFSET = 0.22
/**
 * Past this much sideways separation another vehicle is in the oncoming lane
 * and is ignored. It is wider than a vehicle, so anything skipped by this test
 * is genuinely clear of the one doing the looking.
 */
const LANE_CLEAR = 0.3
/** Only the space just ahead is watched — reserving whole tiles causes gridlock. */
const LOOK_AHEAD = 1
/** Bumper gap held when stopped, and the distance it brakes over. */
const STOP_GAP = 0.07
const SLOW_GAP = 0.5
const ACCELERATION = 2.2
const BRAKING = 6
/** Stalled this long means the thing in front is not moving either: give up. */
const BLOCKED_LIMIT = 3.5
/** How fast the nose swings round a corner, in radians per second. */
const VEHICLE_TURN_RATE = 7

type VehicleKind = 'car' | 'truck'

interface Vehicle {
    kind: VehicleKind
    color: number
    group: THREE.Group
    /** Tile centres of the route, origin included. */
    path: { x: number, z: number }[]
    /** Index of the waypoint currently being driven toward. */
    step: number
    /** Road tile the journey ends on, as an "x,z" key. */
    dest: string
    /** Position on the centre line, and where it sits once shifted into its lane. */
    x: number
    z: number
    px: number
    pz: number
    yaw: number
    /** Cruise speed, and the eased speed it is actually doing. */
    speed: number
    vel: number
    /** Half its length, for bumper-to-bumper spacing. */
    half: number
    /** Seconds spent at a standstill. */
    blocked: number
}
const vehicles: Vehicle[] = []

// Spawning is continuous, so finished models are parked by kind and colour and
// handed back out instead of being rebuilt.
const vehiclePool = new Map<string, THREE.Group[]>()
const POOL_PER_KEY = 3

function takeModel(kind: VehicleKind, color: number): THREE.Group {
    const parked = vehiclePool.get(`${kind}:${color}`)?.pop()
    if (parked) return parked
    const group = kind === 'car' ? createCar(color) : createTruck(color)
    group.traverse((o) => { o.castShadow = false; o.receiveShadow = false })
    return group
}

function releaseModel(v: Vehicle) {
    vehicleGroup.remove(v.group)
    const key = `${v.kind}:${v.color}`
    const bucket = vehiclePool.get(key)
    if (!bucket) vehiclePool.set(key, [v.group])
    else if (bucket.length < POOL_PER_KEY) bucket.push(v.group)
}

function tileCentre(key: string): { x: number, z: number } {
    const comma = key.indexOf(',')
    return { x: Number(key.slice(0, comma)) + 0.5, z: Number(key.slice(comma + 1)) + 0.5 }
}

/** Shortest route over road tiles, or null when the two are not connected. */
function roadPath(from: string, to: string, roads: Set<string>): { x: number, z: number }[] | null {
    if (from === to || !roads.has(from) || !roads.has(to)) return null
    const cameFrom = new Map<string, string>([[from, from]])
    const queue: string[] = [from]
    for (let head = 0; head < queue.length && !cameFrom.has(to); head++) {
        const cur = queue[head]!
        const comma = cur.indexOf(',')
        const cx = Number(cur.slice(0, comma))
        const cz = Number(cur.slice(comma + 1))
        for (const [dx, dz] of TOWN_FACING) {
            const next = roadKey(cx + dx, cz + dz)
            if (!roads.has(next) || cameFrom.has(next)) continue
            cameFrom.set(next, cur)
            queue.push(next)
        }
    }
    if (!cameFrom.has(to)) return null
    const out: { x: number, z: number }[] = []
    let cur = to
    while (cur !== from) {
        out.push(tileCentre(cur))
        cur = cameFrom.get(cur)!
    }
    out.push(tileCentre(from))
    out.reverse()
    return out
}

/** The road tile a building's door opens onto, or any road beside it. */
function doorTile(b: SceneBuilding, roads: Set<string>): string | null {
    const pos = worldPos(b)
    if (!pos) return null
    const wx = Math.floor(pos.x)
    const wy = Math.floor(pos.z)
    const front = townFrontTile(wx, wy, b.rotation ?? 0)
    const frontKey = roadKey(front.wx, front.wy)
    if (roads.has(frontKey)) return frontKey
    for (const [dx, dy] of TOWN_FACING) {
        const key = roadKey(wx + dx, wy + dy)
        if (roads.has(key)) return key
    }
    return null
}

function pickKey(keys: string[]): string {
    return keys[Math.floor(Math.random() * keys.length)]!
}

// Where journeys can start and end. Rebuilt only when the town changes, and
// reused in place so a rebuild allocates nothing.
const homeStops: string[] = []
const workStops: string[] = []
const workDefs: TownBuildingDef[] = []
/** Producer → consumer pairs whose goods actually flow, as door-tile keys. */
const tradeLinks: [string, string][] = []

function rebuildRoutes() {
    homeStops.length = 0
    workStops.length = 0
    workDefs.length = 0
    tradeLinks.length = 0
    const roads = roadTiles()
    if (roads.size >= 2) {
        for (const b of props.buildings) {
            const def = getTownBuilding(b.type)
            if (!def || def.kind === 'road' || b.level === 0) continue
            const key = doorTile(b, roads)
            if (!key) continue
            if (def.kind === 'housing') homeStops.push(key)
            else if (def.kind === 'industry') {
                workStops.push(key)
                workDefs.push(def)
            }
        }
        for (let p = 0; p < workStops.length; p++) {
            const outputs = Object.keys(workDefs[p]!.outputs)
            if (outputs.length === 0) continue
            for (let c = 0; c < workStops.length; c++) {
                if (workStops[c] === workStops[p]) continue
                const needs = workDefs[c]!.inputs as Record<string, number | undefined>
                if (outputs.some(r => (needs[r] ?? 0) > 0)) tradeLinks.push([workStops[p]!, workStops[c]!])
            }
        }
        if (tradeLinks.length === 0) {
            // Nothing trades yet — run between any two workplaces instead.
            for (let i = 0; i < workStops.length; i++) {
                for (let j = i + 1; j < workStops.length; j++) tradeLinks.push([workStops[i]!, workStops[j]!])
            }
        }
    }
    // Anyone whose road was demolished mid-journey re-routes, or leaves.
    for (let i = vehicles.length - 1; i >= 0; i--) {
        const v = vehicles[i]!
        const path = roadPath(roadKey(Math.floor(v.x), Math.floor(v.z)), v.dest, roads)
        if (path && path.length > 1) {
            v.path = path
            v.step = 1
        } else {
            despawn(i)
        }
    }
}

// The routes only change when a building moves, appears or disappears, but the
// buildings prop is replaced on every poll — compare a signature first.
let trafficSig = ''
function syncVehicles() {
    let sig = ''
    for (const p of props.plots) sig += `${p.id}@${p.x},${p.y};`
    for (const b of props.buildings) sig += `${b.plotId}:${b.tileX},${b.tileY},${b.type},${b.rotation ?? 0},${b.level === 0 ? 0 : 1};`
    if (sig === trafficSig) return
    trafficSig = sig
    rebuildRoutes()
}

function despawn(i: number) {
    releaseModel(vehicles[i]!)
    vehicles.splice(i, 1)
}

function countKind(kind: VehicleKind): number {
    let n = 0
    for (const v of vehicles) if (v.kind === kind) n++
    return n
}

/** Enough clear road at (px, pz) to drop a vehicle of this length into. */
function spaceFree(px: number, pz: number, half: number): boolean {
    for (const v of vehicles) {
        if (Math.hypot(v.px - px, v.pz - pz) < half + v.half + 0.12) return false
    }
    return true
}

/** Starts one journey. False when there was nowhere sensible to run it. */
function spawnVehicle(kind: VehicleKind): boolean {
    const roads = roadTiles()
    if (roads.size < 2) return false
    if (kind === 'car' && (homeStops.length === 0 || workStops.length === 0)) return false
    if (kind === 'truck' && tradeLinks.length === 0) return false
    for (let attempt = 0; attempt < 4; attempt++) {
        let from: string
        let to: string
        if (kind === 'car') {
            // Commutes run both ways: out to work in one car, home in the next.
            const outbound = Math.random() < 0.5
            from = pickKey(outbound ? homeStops : workStops)
            to = pickKey(outbound ? workStops : homeStops)
        } else {
            const link = tradeLinks[Math.floor(Math.random() * tradeLinks.length)]!
            from = link[0]
            to = link[1]
        }
        const path = roadPath(from, to, roads)
        if (!path || path.length < 2) continue
        const start = path[0]!
        const next = path[1]!
        const yaw = Math.atan2(next.x - start.x, next.z - start.z)
        const half = (kind === 'car' ? TOWN_VEHICLE_SIZE.car.length : TOWN_VEHICLE_SIZE.truck.length) / 2
        const px = start.x - Math.cos(yaw) * LANE_OFFSET
        const pz = start.z + Math.sin(yaw) * LANE_OFFSET
        if (!spaceFree(px, pz, half)) continue
        const color = TOWN_VEHICLE_COLORS[Math.floor(Math.random() * TOWN_VEHICLE_COLORS.length)]!
        const group = takeModel(kind, color)
        group.position.set(px, VEHICLE_Y, pz)
        group.rotation.y = yaw
        vehicleGroup.add(group)
        vehicles.push({
            kind,
            color,
            group,
            path,
            step: 1,
            dest: to,
            x: start.x,
            z: start.z,
            px,
            pz,
            yaw,
            speed: kind === 'car' ? 1.5 + Math.random() * 0.7 : 1 + Math.random() * 0.4,
            vel: 0,
            half,
            blocked: 0
        })
        return true
    }
    return false
}

/**
 * Free road between this vehicle's nose and whatever is in front of it in the
 * same lane, or Infinity when the way is clear. Oncoming traffic sits a full
 * lane to the side and is skipped, so the two never block each other.
 */
function gapAhead(v: Vehicle): number {
    const fx = Math.sin(v.yaw)
    const fz = Math.cos(v.yaw)
    let gap = Infinity
    for (const w of vehicles) {
        if (w === v) continue
        const dx = w.px - v.px
        const dz = w.pz - v.pz
        const along = dx * fx + dz * fz
        if (along <= 0 || along > LOOK_AHEAD) continue
        // Right of the heading is (-fz, fx); anything further out is another lane.
        const lateral = dz * fx - dx * fz
        if (lateral > LANE_CLEAR || lateral < -LANE_CLEAR) continue
        const free = along - v.half - w.half
        if (free < gap) gap = free
    }
    return gap
}

// Seeded apart so the first car and the first truck do not arrive together.
let carDelay = Math.random() * 1.5
let truckDelay = 0.8 + Math.random() * 2
function nextSpawnDelay() {
    return SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN)
}

function stepTraffic(dt: number) {
    // Trickle in replacements for the journeys that have finished.
    carDelay -= dt
    if (carDelay <= 0) {
        const started = countKind('car') < MAX_CARS && spawnVehicle('car')
        carDelay = started ? nextSpawnDelay() : SPAWN_RETRY + Math.random() * SPAWN_RETRY
    }
    truckDelay -= dt
    if (truckDelay <= 0) {
        const started = countKind('truck') < MAX_TRUCKS && spawnVehicle('truck')
        truckDelay = started ? nextSpawnDelay() : SPAWN_RETRY + Math.random() * SPAWN_RETRY
    }

    for (let i = vehicles.length - 1; i >= 0; i--) {
        const v = vehicles[i]!
        const target = v.path[v.step]
        if (!target) { despawn(i); continue }
        const dx = target.x - v.x
        const dz = target.z - v.z
        const d = Math.hypot(dx, dz)
        if (d < 0.02) {
            v.step++
            // Journey over: the vehicle has arrived and is gone.
            if (v.step >= v.path.length) despawn(i)
            continue
        }

        // Queue behind whoever is in front, brake early, pull away smoothly.
        const gap = gapAhead(v)
        const want = gap < SLOW_GAP ? v.speed * Math.max(0, (gap - STOP_GAP) / (SLOW_GAP - STOP_GAP)) : v.speed
        const rate = want < v.vel ? BRAKING : ACCELERATION
        v.vel += Math.max(-rate * dt, Math.min(rate * dt, want - v.vel))
        // Whatever the easing says, never roll into the vehicle ahead.
        const room = gap === Infinity ? d : Math.max(0, gap - STOP_GAP)
        const advance = Math.min(d, v.vel * dt, room)
        if (want <= 0.001) {
            // Nose to tail with something that is not moving. Rather than sit
            // there forever, the journey is abandoned and the road clears.
            v.blocked += dt
            if (v.blocked > BLOCKED_LIMIT) { despawn(i); continue }
        } else {
            v.blocked = 0
        }
        v.x += (dx / d) * advance
        v.z += (dz / d) * advance

        // Ease the nose round rather than snapping it at every corner.
        let turn = Math.atan2(dx, dz) - v.yaw
        while (turn > Math.PI) turn -= Math.PI * 2
        while (turn < -Math.PI) turn += Math.PI * 2
        v.yaw += turn * Math.min(1, dt * VEHICLE_TURN_RATE)
        // Right-hand traffic: sit one lane to the right of the centre line, the
        // right of a heading (fx, fz) being (-fz, fx). Taking it from the eased
        // heading means the offset swings round with the vehicle through a
        // corner or a reversal instead of flicking across the road.
        v.px = v.x - Math.cos(v.yaw) * LANE_OFFSET
        v.pz = v.z + Math.sin(v.yaw) * LANE_OFFSET
        v.group.position.set(v.px, VEHICLE_Y, v.pz)
        v.group.rotation.y = v.yaw
    }
}

// ─── Particles (smoke, sparkles, dust) ───────────────────────────────────────

interface Particle { mesh: THREE.Mesh, vx: number, vy: number, vz: number, life: number, maxLife: number, grow: number }
const particles: Particle[] = []
const smokeMat = new THREE.MeshBasicMaterial({ color: 0xdedede, transparent: true, opacity: 0.55, depthWrite: false })
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.95, depthWrite: false })
const dustMat = new THREE.MeshBasicMaterial({ color: 0xc9b58a, transparent: true, opacity: 0.5, depthWrite: false })
const puffGeo = new THREE.SphereGeometry(0.08, 6, 5)
const MAX_PARTICLES = 40
/** Past this camera distance the puffs are a pixel each — not worth a draw call. */
const PARTICLE_DRAW_DISTANCE = 45

function spawn(pos: THREE.Vector3, kind: 'smoke' | 'spark' | 'dust') {
    if (particles.length >= MAX_PARTICLES || cam.dist > PARTICLE_DRAW_DISTANCE) return
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
/** Seconds a "+2 🪵" label drifts before it is gone. */
const POPUP_LIFE = 1.6
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

/**
 * Where each HTML overlay is anchored in the world, plus anything that has to
 * move smoothly. Both run EVERY frame with real delta time — a label that only
 * moves ten times a second visibly swims behind the scene while the camera
 * pans, and a popup whose life only advances then climbs in steps — while the
 * expensive bookkeeping (creating and removing elements, progress widths)
 * stays on the slower cadence in updateOverlays.
 */
function positionOverlays(dt: number) {
    for (const e of entries.values()) {
        if (e.bar) {
            const p = project(e.group.position.x, e.group.position.y + e.modelHeight * e.model.scale.y + 0.16, e.group.position.z)
            e.bar.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -50%)`
            e.bar.style.display = p.visible ? '' : 'none'
        }
        if (e.alert) {
            const bob = Math.sin(performance.now() / 350 + e.group.position.x) * 0.06
            const p = project(e.group.position.x, e.group.position.y + e.modelHeight * e.model.scale.y + 0.3 + bob, e.group.position.z)
            e.alert.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -100%)`
            e.alert.style.display = p.visible ? '' : 'none'
        }
    }
    // Production popups drift and fade on real time, then retire themselves.
    for (let i = popups.length - 1; i >= 0; i--) {
        const pu = popups[i]!
        pu.life += dt
        if (pu.life > POPUP_LIFE) {
            pu.el.remove()
            popups.splice(i, 1)
            continue
        }
        const p = project(pu.x, pu.y + pu.life * 0.8, pu.z)
        pu.el.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -100%)`
        pu.el.style.opacity = String(pu.life < 0.2 ? pu.life / 0.2 : 1 - (pu.life - 0.2) / (POPUP_LIFE - 0.2))
    }
    if (issueLabel && issueAnchor) {
        const p = project(issueAnchor.x, 1.35, issueAnchor.z)
        issueLabel.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -100%)`
        issueLabel.style.display = p.visible ? '' : 'none'
    }
}

function updateOverlays(now: number) {
    // Build progress bars: create, retire, and set the fill width.
    for (const e of entries.values()) {
        const pending = isPending(e.data, now)
        if (!pending) {
            if (e.bar) { e.bar.remove(); e.bar = null }
            continue
        }
        ensureBar(e)
        // The server quotes the total; it is the only side that knows this
        // town's mood and research, and a bar that disagrees with the clock
        // beside it is worse than no bar.
        const total = Math.max(1, e.data.jobMs ?? townLevelBuildMs(e.def, e.data.upgradingTo ?? 1))
        const progress = Math.max(0, Math.min(1, 1 - (e.data.completesAt - now) / total))
        ;(e.bar!.firstElementChild as HTMLElement).style.width = `${Math.round(progress * 100)}%`
    }
    // Disconnected buildings wear a big "!".
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
    }
}

// ─── Picking ─────────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster()
const pointerNdc = new THREE.Vector2()
let hoveredBuildingId: string | null = null

type NeighbourInfo = { plotId: string, ownerName: string, type?: string, level?: number }
type Pick = { kind: 'building', id: string } | { kind: 'tile', tile: TileRef, x: number, z: number } | { kind: 'expansion', x: number, y: number, free: boolean } | { kind: 'listing', listing: { id: string, ownerName: string, price: number } } | { kind: 'neighbour', info: NeighbourInfo } | null

function pick(sx: number, sy: number): Pick {
    pointerNdc.set((sx / viewW) * 2 - 1, -(sy / viewH) * 2 + 1)
    raycaster.setFromCamera(pointerNdc, camera)
    const hits = raycaster.intersectObjects([buildingsGroup, plotsGroup, expansionGroup, neighbourGroup], true)
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
        const listing = h.object.userData.listing as { id: string, ownerName: string, price: number } | undefined
        if (listing) return { kind: 'listing', listing }
        const neighbourBuilding = h.object.userData.neighbourBuilding as NeighbourInfo | undefined
        if (neighbourBuilding) return { kind: 'neighbour', info: neighbourBuilding }
        const neighbour = h.object.userData.neighbour as NeighbourInfo | undefined
        if (neighbour) return { kind: 'neighbour', info: neighbour }
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

// getBoundingClientRect forces a synchronous layout, and this runs on every
// pointer move. The rect only changes when the canvas resizes or the page
// scrolls, both of which we already hear about.
let canvasRect: DOMRect | null = null
function refreshCanvasRect() {
    canvasRect = canvas.value?.getBoundingClientRect() ?? null
}

function local(e: PointerEvent | WheelEvent) {
    const r = canvasRect ?? canvas.value!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function groundDelta(dx: number, dy: number) {
    const unitsPerPixel = 2 * cam.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / viewH
    return townDragDelta(dx, dy, cam.yaw, cam.pitch, unitsPerPixel)
}

const movementKeys = new Set<string>()
const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])
/** Radians per second while Q or E is held. */
const KEY_TURN_RATE = 1.1
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

    // Q and E swing the view around the point the camera is looking at, the
    // same axis a right-drag turns.
    const turn = Number(movementKeys.has('KeyQ')) - Number(movementKeys.has('KeyE'))
    if (turn !== 0) camGoal.yaw += turn * KEY_TURN_RATE * dt
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
    } else if (hit.kind === 'listing') {
        emit('select-listing', hit.listing)
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
    setHoverNeighbour(null)
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

function setHoverNeighbour(info: NeighbourInfo | null) {
    const id = info ? `${info.plotId}:${info.type ?? ''}:${info.level ?? ''}` : null
    if (id === hoveredNeighbourKey) return
    hoveredNeighbourKey = id
    emit('hover-neighbour', info)
}
let hoveredNeighbourKey: string | null = null

function setHoverSlot(key: string | null, slot?: SceneExpansion) {
    if (key === hoveredSlotKey) return
    hoveredSlotKey = key
    emit('hover-expansion', key && slot ? { x: slot.x, y: slot.y, free: slot.free, ownerName: slot.ownerName } : null)
}

function updateHover(sx: number, sy: number) {
    const hit = pick(sx, sy)
    if (hit?.kind !== 'neighbour' && hit?.kind !== 'listing') setHoverNeighbour(null)
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
        setHoverSlot(`${hit.x},${hit.y}`, props.expansions.find(e => e.x === hit.x && e.y === hit.y))
        canvas.value!.style.cursor = hit.free ? 'pointer' : 'default'
        return
    }
    if (hit?.kind === 'listing') {
        setHoverNeighbour({ plotId: hit.listing.id, ownerName: hit.listing.ownerName })
        canvas.value!.style.cursor = 'pointer'
        return
    }
    setHoverSlot(null)
    if (hit?.kind === 'neighbour') {
        setHoverNeighbour(hit.info)
        canvas.value!.style.cursor = 'default'
        return
    }
    canvas.value!.style.cursor = 'grab'
}

// ─── Frame loop ──────────────────────────────────────────────────────────────

let rafId = 0
let lastMs = 0
let running = true
let visible = true

/** True while the view is settling or the player is driving it — worth 60fps. */
function cameraBusy() {
    return dragging || pointers.size > 0 || movementKeys.size > 0
        || Math.abs(camGoal.tx - cam.tx) > 0.01 || Math.abs(camGoal.tz - cam.tz) > 0.01
        || Math.abs(camGoal.yaw - cam.yaw) > 0.0005 || Math.abs(camGoal.pitch - cam.pitch) > 0.0005
        || Math.abs(camGoal.dist - cam.dist) > 0.01
}

let lastOverlayMs = 0

function frame(ms: number) {
    rafId = requestAnimationFrame(frame)
    if (!running || !visible || !renderer || document.hidden) { lastMs = ms; return }

    // Cap the frame rate: a resting town does not need 60 redraws a second.
    const budget = cameraBusy() ? ACTIVE_FRAME_MS : IDLE_FRAME_MS
    if (lastMs !== 0 && ms - lastMs < budget) return
    const dt = lastMs === 0 ? 0 : Math.min(0.1, (ms - lastMs) / 1000)
    lastMs = ms

    moveCamera(dt)
    animateTownWater(ms / 1000)

    // Camera easing.
    const k = 1 - Math.pow(0.001, dt)
    cam.tx += (camGoal.tx - cam.tx) * k
    cam.tz += (camGoal.tz - cam.tz) * k
    cam.yaw += (camGoal.yaw - cam.yaw) * k
    cam.pitch += (camGoal.pitch - cam.pitch) * k
    cam.dist += (camGoal.dist - cam.dist) * k
    applyCamera()

    const now = Date.now() + props.serverOffsetMs

    let shapesChanged = false
    for (const e of entries.values()) {
        const b = e.data
        const pending = isPending(b, now)
        syncModelAppearance(e, displayedLevel(b, now))
        if (e.wasPending && !pending) {
            e.popAt = ms
            e.wasPending = false
            if (e.scaffold) { e.group.remove(e.scaffold); disposeGroup(e.scaffold); e.scaffold = null }
            markShadowsDirty()
        }
        const def = e.def
        const staffed = (b.staffing ?? 0) > 0 && !pending && b.level > 0

        // Grow out of the ground while building; pop on completion; hover lift.
        let sy = levelScale(b.level)
        if (pending) {
            const total = Math.max(1, b.jobMs ?? townLevelBuildMs(def, b.upgradingTo ?? 1))
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
        if (pending || e.popAt) shapesChanged = true
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

    stepTraffic(dt)
    stepParticles(dt)
    if (ms - lastOverlayMs >= OVERLAY_INTERVAL_MS) {
        updateOverlays(now)
        lastOverlayMs = ms
        if (shapesChanged) markShadowsDirty()
    }
    positionOverlays(dt)

    if (shadowsDirty) {
        renderer.shadowMap.needsUpdate = true
        shadowsDirty = false
    }
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
    refreshCanvasRect()
}

let ro: ResizeObserver | null = null
let io: IntersectionObserver | null = null

onMounted(() => {
    const el = canvas.value
    if (!el) return
    // A retina laptop at devicePixelRatio 2 draws four times the pixels for a
    // low-poly scene that gains almost nothing from it, so cap the ratio and
    // skip antialiasing when the display is already dense enough to hide it.
    const dpr = window.devicePixelRatio || 1
    renderer = new THREE.WebGLRenderer({ canvas: el, antialias: dpr < 1.5, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(dpr, MAX_PIXEL_RATIO))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    // The scene is mostly still: re-render the shadow map only when something
    // that casts one actually moved (see markShadowsDirty).
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.94
    renderer.outputColorSpace = THREE.SRGBColorSpace

    window.addEventListener('keydown', onMovementKeyDown)
    window.addEventListener('keyup', onMovementKeyUp)
    window.addEventListener('blur', clearMovement)
    window.addEventListener('scroll', refreshCanvasRect, { passive: true, capture: true })
    document.addEventListener('visibilitychange', clearMovement)
    setupStatic()
    rebuildPlots()
    rebuildWater()
    rebuildTerrainOverlay()
    rebuildExpansions()
    rebuildNeighbours()
    rebuildDecor()
    syncBuildings()
    syncVehicles()
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
    window.removeEventListener('scroll', refreshCanvasRect, { capture: true })
    document.removeEventListener('visibilitychange', clearMovement)
    cancelAnimationFrame(rafId)
    ro?.disconnect()
    io?.disconnect()
    for (const e of entries.values()) { releaseModelGlow(e.model); e.bar?.remove(); e.alert?.remove() }
    for (const p of popups) p.el.remove()
    clearLandscape(decorGroup)
    disposeTerrainOverlay(terrainGroup)
    disposeWaterLayer(waterGroup)
    meadowTexture?.dispose()
    plotTexture?.dispose()
    renderer?.dispose()
    renderer = null
})

/**
 * The scenery around the town depends on the plots, the expansion slots and the
 * neighbours all three. They used to be three deep watchers each calling
 * rebuildDecor, and because a poll replaces the whole state object all three
 * fired every thirty seconds — so the meadow (about thirty thousand instanced
 * props) was rebuilt three times for one poll that usually changed nothing.
 *
 * One watcher, and the decor is rebuilt only when the footprint it is drawn
 * around has actually moved.
 */
let decorKey = ''
function landChanged() {
    const key = [
        props.plots.map(p => `${p.x},${p.y}`).join('|'),
        props.expansions.map(e => `${e.x},${e.y},${e.free ? 1 : 0}`).join('|'),
        props.neighbours.map(n => `${n.x},${n.y}`).join('|')
    ].join('#')
    if (key === decorKey) return false
    decorKey = key
    return true
}

watch(() => [props.plots, props.expansions, props.neighbours], () => {
    invalidateTileCaches()
    rebuildPlots()
    rebuildWater()
    rebuildTerrainOverlay()
    rebuildExpansions()
    rebuildNeighbours()
    if (landChanged()) rebuildDecor()
    syncBuildings()
    syncVehicles()
    markShadowsDirty()
}, { deep: true })
watch(() => [props.terrainOverlay, props.ghostType], rebuildTerrainOverlay)
watch(() => props.buildings, () => { invalidateTileCaches(); syncBuildings(); syncVehicles(); markShadowsDirty() }, { deep: true })
watch(() => [props.ghostType, props.ghostLevel], rebuildGhost)
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
            aria-label="Town view. WASD to move, Q and E to turn, drag to pan, right-drag to orbit, scroll to zoom."
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
</style>
