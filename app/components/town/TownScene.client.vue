<script setup lang="ts">
// Polytown 3D scene. Three.js, one rAF loop. World units: one tile = 1, plot
// (px, py) covers x ∈ [px*8, px*8+8), z ∈ [py*8, py*8+8). HTML overlays
// (progress bars, for-sale prices, production popups) are positioned by
// projecting world points each frame and written straight to the DOM — no
// per-frame Vue re-render.
import * as THREE from 'three'
import { addLandscape, clearLandscape, createCloud, createMeadowTexture } from '~/utils/town/landscape'
import { animateTownWater } from '~/utils/town/surfaces'
import { createTerrainOverlay, createWaterLayer, disposeTerrainOverlay, disposeWaterLayer } from '~/utils/town/terrain'
import { createRoadParts } from '~/utils/town/roads'
import { townSceneLevel } from '~/utils/town/appearance'
import { townDragDelta, townKeyboardDelta, townIsTyping, townWheelZoomFactor, townSnapTurn } from '~/utils/town/camera'
import { TOWN_PLOT_SIZE, TOWN_FACING, getTownBuilding, townLevelBuildMs, townFrontTile, townFrontTiles, townBuildingSize, townFootprintAnchor, townCovers, townDragLine, TOWN_MAX_DRAG_TILES, type TownBuildingDef, type TownBuildingId } from '#shared/utils/gamelogic/town'
import { TOWN_MONUMENT_STAGES, isTownMonumentId } from '#shared/utils/gamelogic/town-monuments'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createBuildingModel, townMaterial, TOWN_MODEL_VARIANTS } from '~/utils/town/models'
import { createCar, createTruck, TOWN_VEHICLE_COLORS, TOWN_VEHICLE_SIZE } from '~/utils/town/vehicles'
import { townJobProgress } from '~/composables/useTown'

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
    buildings: { type: string, tileX: number, tileY: number, rotation: number, level: number, upgradingTo?: number | null, completesAt?: number }[]
}
export interface TileRef { plotId: string, tileX: number, tileY: number }
export type SceneTile = TileRef & { wx: number, wy: number }
/** One member of a selection being dragged: its artwork, and where it sits relative to the anchor. */
export interface SceneMoveGhost { id: string, type: string, level: number, rotation: number, dx: number, dy: number }
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
    /** Every building in the current selection — each wears a ring. */
    selectedIds?: string[]
    /** A whole selection following the cursor, offsets relative to the anchor tile. */
    moveGhosts?: SceneMoveGhost[] | null
    /** Why the selection cannot land where it hovers (null = allowed). */
    moveIssue?: string | null
    /** Per-tile verdict on the tiles a drag is painting, in the order they were sent. */
    dragValid?: boolean[]
    /**
     * Motion-sickness mode. Orthographic view, camera cuts instead of glides,
     * quarter-turn snaps instead of a free orbit, and no ambient motion (still
     * water, no smoke, no bobbing labels). Traffic still runs: it is slow,
     * small and stays on the roads. Off, nothing changes.
     */
    reducedMotion?: boolean
    /**
     * Timed boosts running now: when each ends (epoch ms, server clock), null
     * while off. Builder's rush lights up every site, a production surge every
     * staffed workshop.
     */
    boosts?: { build: number | null, production: number | null } | null
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
    terrainOverlay: false,
    selectedIds: () => [],
    moveGhosts: null,
    moveIssue: null,
    dragValid: () => [],
    boosts: null
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
    /** Tiles a placement drag is painting right now — the parent judges each one. */
    'drag-tiles': [tiles: SceneTile[]]
    /** A placement drag let go: build on all of these. */
    'place-line': [tiles: SceneTile[]]
    /** A marquee let go (or a shift-click): what it covers, and what to do with the selection. */
    'select-many': [ids: string[], mode: 'replace' | 'add' | 'toggle']
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
const FOV = 38
const perspectiveCamera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400)
// The orthographic camera is framed to match the perspective one at the point
// it looks at, so switching keeps the same things on screen — only the
// parallax goes, which is the point for anyone the perspective swim upsets.
const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 400)
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspectiveCamera
const sun = new THREE.DirectionalLight(0xffd9a0, 3.4)
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

const SKY = 0xcfe4ea
scene.background = new THREE.Color(SKY)
scene.fog = new THREE.Fog(SKY, 60, 160)

// ─── Camera rig ──────────────────────────────────────────────────────────────

const cam = { tx: 4, tz: 4, yaw: 0.7, pitch: 0.95, dist: 22 }
const camGoal = { ...cam }
const MIN_DIST = 7
const MAX_DIST = 70

/** Half the visible height at the focus point — the same for both cameras. */
function halfViewHeight(dist: number) {
    return dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2))
}

let orthoFramedAt = { dist: 0, aspect: 0 }
function frameOrthographic() {
    const aspect = viewW / viewH
    if (orthoFramedAt.dist === cam.dist && orthoFramedAt.aspect === aspect) return
    orthoFramedAt = { dist: cam.dist, aspect }
    const h = halfViewHeight(cam.dist)
    orthographicCamera.left = -h * aspect
    orthographicCamera.right = h * aspect
    orthographicCamera.top = h
    orthographicCamera.bottom = -h
    orthographicCamera.updateProjectionMatrix()
}

function syncCameraKind() {
    camera = props.reducedMotion ? orthographicCamera : perspectiveCamera
}

let sunAt = { x: Infinity, z: Infinity }
function applyCamera() {
    const { tx, tz, yaw, pitch, dist } = cam
    if (camera === orthographicCamera) frameOrthographic()
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
    if (!animate || props.reducedMotion) Object.assign(cam, camGoal)
}

// ─── Lighting & ground ───────────────────────────────────────────────────────

function setupStatic() {
    const hemi = new THREE.HemisphereLight(0xe2efff, 0x8a7550, 1.25)
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
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x6fa05c, roughness: 1, flatShading: true })
    const hillGeo = new THREE.SphereGeometry(1, 8, 6)
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2
        const r = 95 + (i % 3) * 18
        const hill = new THREE.Mesh(hillGeo, hillMat)
        hill.position.set(Math.cos(a) * r, -6, Math.sin(a) * r)
        hill.scale.set(28 + (i % 4) * 9, 14 + (i % 3) * 5, 24 + (i % 5) * 6)
        scene.add(hill)
    }

    // Clouds: puffy cumulus drifting slowly, high enough to stay out of the way.
    for (let i = 0; i < 7; i++) {
        const cloud = createCloud(i)
        cloud.scale.setScalar(0.6 + (i % 3) * 0.2)
        cloud.position.set((i - 3) * 34 + (i % 2) * 9, 30 + (i % 3) * 4, -36 + (i % 4) * 22)
        cloud.userData.drift = 0.4 + (i % 3) * 0.15
        clouds.push(cloud)
        scene.add(cloud)
    }
}
const clouds: THREE.Mesh[] = []

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
            // Each tile a slightly different mown green, so the lawn is not one flat sheet.
            g.fillStyle = `rgba(${hash(x, y, 40) > 0.5 ? '232, 240, 150' : '60, 120, 60'}, ${0.012 + hash(x, y, 41) * 0.03})`
            g.fillRect(x * cell, y * cell, cell, cell)
            // Deterministic grass strokes and tiny clover flecks, baked once.
            for (let i = 0; i < 36; i++) {
                const gx = x * cell + 4 + hash(x, y, i * 2 + 90) * (cell - 8)
                const gy = y * cell + 4 + hash(x, y, i * 2 + 91) * (cell - 8)
                g.strokeStyle = i % 3 ? 'rgba(45, 105, 50, 0.16)' : 'rgba(236, 244, 170, 0.4)'
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
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x9a6f48, roughness: 1 })
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
 *
 * Each sheet is painted pixel by pixel from world terrain, which costs about
 * ten milliseconds a plot and a 768² texture upload, so it is painted once per
 * square and kept: terrain is a function of the coordinates, so a square's
 * water never changes. Missing sheets are painted from the frame loop, a few
 * milliseconds a frame, so a big town's first frame is not held up by them.
 * Neighbours' ponds are drawn with their plot (see below).
 */
const ownWater = new Map<string, THREE.Group>()
let ownWaterPending = false
/** True once every plot has its sheet. */
function syncOwnWater(budgetMs = Infinity): boolean {
    const start = performance.now()
    const keep = new Set(props.plots.map(p => `${p.x},${p.y}`))
    for (const [key, sheet] of ownWater) {
        if (keep.has(key)) continue
        waterGroup.remove(sheet)
        disposeWaterLayer(sheet)
        ownWater.delete(key)
    }
    let done = true
    for (const p of props.plots) {
        const key = `${p.x},${p.y}`
        if (ownWater.has(key)) continue
        if (performance.now() - start >= budgetMs) {
            done = false
            break
        }
        const sheet = createWaterLayer([p])
        ownWater.set(key, sheet)
        waterGroup.add(sheet)
    }
    markShadowsDirty()
    return done
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
// Their towns are alive too: sails turn, chimneys smoke, and their roads carry
// traffic (see the traffic zones below). What we do not have is their
// simulation — staffing, timers, output — so every finished workshop is drawn
// as running and there are no production popups or scaffolds.
//
// A full realm is a hundred-odd plots and thousands of buildings, which is far
// more work than the player's own town. So the world arrives after the town
// (useTown fetches it separately), and each plot is its own unit: drawn only
// once the town's first frames are on screen, nearest the camera first, a few
// milliseconds' worth per frame, growing up out of the ground as it lands. A
// refresh redraws only the plots whose signature changed.

/** Is a neighbour's building still going up (or growing a level)? */
function neighbourPending(b: SceneNeighbour['buildings'][number], now: number) {
    if (b.completesAt === undefined) return b.level === 0
    return b.completesAt > now && (b.level === 0 || (b.upgradingTo ?? null) !== null)
}

/** A neighbour's building with something to animate, and where it stands. */
interface NeighbourAnim { type: string, x: number, z: number, spin: THREE.Object3D[], smoke: THREE.Object3D[], glow: THREE.Mesh[] }
const neighbourAnims: NeighbourAnim[] = []
/** Beyond this many tiles from the camera's focus a neighbour's smoke is not worth a puff. */
const NEIGHBOUR_FX_RANGE = 30
/** How long a freshly streamed plot takes to grow up out of the ground. */
const NEIGHBOUR_GROW_MS = 450
/** Frame time handed to building neighbour plots; at least one plot is built per frame. */
const NEIGHBOUR_BUILD_BUDGET_MS = 6
/** Frames of the player's own town drawn before any neighbour work starts. */
const NEIGHBOUR_START_FRAMES = 3

/** One neighbour plot as drawn. */
interface NeighbourView {
    data: SceneNeighbour
    sig: string
    group: THREE.Group
    anims: NeighbourAnim[]
    /**
     * What this plot owns and must give back. Models and road tiles share
     * their geometry and materials with the caches, so disposing those here
     * would make the GPU re-upload (and recompile) them for every other
     * building in the realm.
     */
    geometries: THREE.BufferGeometry[]
    materials: THREE.Material[]
    water: THREE.Group | null
    /** When it landed, for the grow-in; 0 once it stands. */
    bornAt: number
}
const neighbourViews = new Map<string, NeighbourView>()
/** Plots still to (re)draw, nearest the camera first. */
let neighbourQueue: { n: SceneNeighbour, sig: string }[] = []
/** Every neighbour road tile, so a road at a plot edge joins the one across it. */
let neighbourRoads = new Set<string>()
/** When the next neighbour site finishes and its plot needs redrawing. */
let neighbourRecheckAt = Infinity
/** The scenery must step aside for land that arrived with the world. */
let neighbourDecorPending = false
let neighboursGrowing = 0
let neighbourShadowMs = 0
let framesDrawn = 0

let neighbourSlab: { geometry: THREE.BoxGeometry, materials: THREE.Material[] } | null = null
function neighbourSlabParts() {
    if (!neighbourSlab) {
        const top = new THREE.MeshStandardMaterial({ map: makePlotTexture(), roughness: 1, color: 0xb9b9b9 })
        const side = new THREE.MeshStandardMaterial({ color: 0x7a6247, roughness: 1 })
        neighbourSlab = { geometry: new THREE.BoxGeometry(PLOT, 0.3, PLOT), materials: [side, side, top, side, side, side] }
    }
    return neighbourSlab
}

function neighbourSig(n: SceneNeighbour, nowMs: number) {
    let sig = `${n.x},${n.y},${n.listPrice ?? ''},${n.ownerName}:`
    for (const b of n.buildings) {
        if (b.type === 'road') {
            const conns = roadConnections(n.x * PLOT + b.tileX, n.y * PLOT + b.tileY, neighbourRoads)
            sig += `r${b.tileX},${b.tileY},${conns.map(c => c ? 1 : 0).join('')};`
        } else {
            sig += `${b.type},${b.tileX},${b.tileY},${b.rotation},${b.level},${b.upgradingTo ?? ''},${neighbourPending(b, nowMs) ? 1 : 0};`
        }
    }
    return sig
}

/**
 * Diff the neighbours prop against what is drawn. Plots that left are removed
 * now; new or changed ones join the queue that the frame loop drains.
 */
function syncNeighbours() {
    const nowMs = Date.now() + props.serverOffsetMs
    neighbourRoads = new Set()
    for (const n of props.neighbours) {
        for (const b of n.buildings) {
            if (b.type === 'road') neighbourRoads.add(roadKey(n.x * PLOT + b.tileX, n.y * PLOT + b.tileY))
        }
    }
    neighbourRecheckAt = Infinity
    const seen = new Set<string>()
    const queue: { n: SceneNeighbour, sig: string }[] = []
    for (const n of props.neighbours) {
        seen.add(n.id)
        for (const b of n.buildings) {
            if (b.completesAt !== undefined && neighbourPending(b, nowMs)) neighbourRecheckAt = Math.min(neighbourRecheckAt, b.completesAt)
        }
        const sig = neighbourSig(n, nowMs)
        if (neighbourViews.get(n.id)?.sig !== sig) queue.push({ n, sig })
    }
    let removed = false
    for (const [id, view] of neighbourViews) {
        if (seen.has(id)) continue
        disposeNeighbourView(view)
        neighbourViews.delete(id)
        removed = true
    }
    const far = (n: SceneNeighbour) => Math.hypot(n.x * PLOT + PLOT / 2 - cam.tx, n.y * PLOT + PLOT / 2 - cam.tz)
    queue.sort((a, b) => far(a.n) - far(b.n))
    neighbourQueue = queue
    if (removed) {
        collectNeighbourAnims()
        syncVehicles()
        markShadowsDirty()
    }
}

function disposeNeighbourView(view: NeighbourView) {
    neighbourGroup.remove(view.group)
    for (const g of view.geometries) g.dispose()
    for (const m of view.materials) m.dispose()
    if (view.water) disposeWaterLayer(view.water)
    if (view.bornAt) neighboursGrowing--
}

function buildNeighbourView(n: SceneNeighbour, sig: string, nowMs: number): NeighbourView {
    const group = new THREE.Group()
    const view: NeighbourView = { data: n, sig, group, anims: [], geometries: [], materials: [], water: null, bornAt: 0 }
    const slabParts = neighbourSlabParts()
    const slab = new THREE.Mesh(slabParts.geometry, slabParts.materials)
    slab.position.set(n.x * PLOT + PLOT / 2, 0.15, n.y * PLOT + PLOT / 2)
    slab.receiveShadow = true
    slab.userData.neighbour = { plotId: n.id, ownerName: n.ownerName }
    const listing = n.listPrice !== null ? { id: n.id, ownerName: n.ownerName, price: n.listPrice } : null
    if (listing) slab.userData.listing = listing
    group.add(slab)

    // Terrain is a function of world coordinates, so the square next door has
    // the same water whoever owns it, and a slab drawn dry beside your own
    // pond read as a different realm.
    const water = createWaterLayer([n])
    if (water.children.length) {
        // Scenery only: the raycaster should go straight through to the slab.
        water.traverse((o) => { o.raycast = () => {} })
        group.add(water)
        view.water = water
    }

    for (const b of n.buildings) {
        const wx = n.x * PLOT + b.tileX
        const wy = n.y * PLOT + b.tileY
        const pending = neighbourPending(b, nowMs)
        const size = townBuildingSize(b.type)
        // A monument site shows how far it has got; anything else is drawn as the building it will be.
        const model = b.type === 'road'
            ? buildRoadModel(roadConnections(wx, wy, neighbourRoads))
            : buildingModel(b.type as TownBuildingId, townSceneLevel(b.type, isTownMonumentId(b.type) ? b.level : Math.max(1, b.level)), tileVariant(wx, wy))
        model.position.set(wx + size / 2, 0.3, wy + size / 2)
        const info = { plotId: n.id, ownerName: n.ownerName, type: b.type, level: b.level }
        if (b.type !== 'road') {
            model.rotation.y = b.rotation * Math.PI / 2
            // A site is a stub of a building inside a scaffold, the same way
            // your own reads — half the fun of a shared realm is watching the
            // plot next door go up.
            // A monument shows its progress in its stages, so it is never squashed.
            const grown = pending && size === 1 ? levelScale(Math.max(1, b.level)) * (b.level === 0 ? 0.35 : 0.85) : levelScale(b.level)
            model.scale.set(levelScale(Math.max(1, b.level)), grown, levelScale(Math.max(1, b.level)))
            if (pending) {
                const scaffold = makeScaffold(((model.userData.height as number | undefined) ?? 0.9) * levelScale(Math.max(1, b.level)) + 0.15, size)
                scaffold.position.set(wx + size / 2, 0.3, wy + size / 2)
                scaffold.traverse((o) => {
                    o.userData.neighbourBuilding = info
                    // Its posts and rails are its own; the timber material is shared.
                    if (o instanceof THREE.Mesh) view.geometries.push(o.geometry)
                })
                group.add(scaffold)
            }
            const anim: NeighbourAnim = { type: b.type, x: wx + size / 2, z: wy + size / 2, spin: [], smoke: [], glow: [] }
            model.traverse((o) => {
                if (o.name === 'spin') anim.spin.push(o)
                if (o.name === 'smoke') anim.smoke.push(o)
                // Every instance gets its own copy of the window material, so it is this plot's to free.
                if (o.name === 'glow' && o instanceof THREE.Mesh) {
                    anim.glow.push(o)
                    view.materials.push(o.material as THREE.Material)
                }
            })
            // A site is not running yet: no sails, no smoke, no lit windows.
            if (!pending && (anim.spin.length || anim.smoke.length || anim.glow.length)) view.anims.push(anim)
        }
        model.traverse((o) => {
            o.userData.neighbourBuilding = info
            if (listing) o.userData.listing = listing
        })
        group.add(model)
    }
    return view
}

function collectNeighbourAnims() {
    neighbourAnims.length = 0
    for (const view of neighbourViews.values()) neighbourAnims.push(...view.anims)
}

/** Neighbours whose plot is on screen, for the traffic: no cars on roads that are not drawn yet. */
function drawnNeighbours(): SceneNeighbour[] {
    return [...neighbourViews.values()].map(v => v.data)
}

/**
 * Called from the frame loop. Waits for the town's own first frames, then
 * draws queued plots within a small time budget per frame.
 */
function pumpNeighbours(ms: number) {
    if (ownWaterPending) {
        ownWaterPending = !syncOwnWater(NEIGHBOUR_BUILD_BUDGET_MS)
        return
    }
    if (framesDrawn < NEIGHBOUR_START_FRAMES) return
    if (neighbourDecorPending) {
        // Clear the trees off the incoming land first, in a frame of its own.
        neighbourDecorPending = false
        rebuildDecor()
        markShadowsDirty()
        return
    }
    if (neighbourQueue.length === 0) return
    const start = performance.now()
    const nowMs = Date.now() + props.serverOffsetMs
    do {
        const { n, sig } = neighbourQueue.shift()!
        const old = neighbourViews.get(n.id)
        if (old) disposeNeighbourView(old)
        const view = buildNeighbourView(n, sig, nowMs)
        // New land grows in; a redraw of a plot already standing swaps in place.
        if (!old && !props.reducedMotion) {
            view.bornAt = ms
            view.group.scale.y = 0.001
            neighboursGrowing++
        }
        neighbourViews.set(n.id, view)
        neighbourGroup.add(view.group)
    } while (neighbourQueue.length > 0 && performance.now() - start < NEIGHBOUR_BUILD_BUDGET_MS)
    collectNeighbourAnims()
    if (neighbourQueue.length === 0) {
        syncVehicles()
        markShadowsDirty()
    }
}

function growNeighbours(ms: number) {
    if (neighboursGrowing === 0) return
    for (const view of neighbourViews.values()) {
        if (!view.bornAt) continue
        const t = (ms - view.bornAt) / NEIGHBOUR_GROW_MS
        if (t >= 1 || props.reducedMotion) {
            view.bornAt = 0
            view.group.scale.y = 1
            neighboursGrowing--
        } else {
            view.group.scale.y = Math.max(0.001, 1 - (1 - t) ** 3)
        }
    }
    // The shadow map is redrawn on change only; a few times a second is plenty
    // while land is still rising, and once more when it has all landed.
    if (neighboursGrowing === 0 || ms - neighbourShadowMs > 250) {
        neighbourShadowMs = ms
        markShadowsDirty()
    }
}

function disposeNeighbours() {
    for (const view of neighbourViews.values()) disposeNeighbourView(view)
    neighbourViews.clear()
    neighbourQueue = []
    neighbourAnims.length = 0
    if (neighbourSlab) {
        neighbourSlab.geometry.dispose()
        for (const m of new Set(neighbourSlab.materials)) m.dispose()
        neighbourSlab = null
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
    variant: number
    modelHeight: number
    wasPending: boolean
    popAt: number
    /** When a placement (or a move) set it down, for the landing squash; 0 = settled. */
    landAt: number
    /** The landing has kicked up its ring of dust. */
    landDusted: boolean
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

/** The middle of a building's footprint: a tile's centre, or the centre of a monument's square. */
function worldPos(b: SceneBuilding): { x: number, z: number } | null {
    const p = plotById.value.get(b.plotId)
    if (!p) return null
    const half = townBuildingSize(b.type) / 2
    return { x: p.x * PLOT + b.tileX + half, z: p.y * PLOT + b.tileY + half }
}

function makeScaffold(height = 0.9, size = 1): THREE.Group {
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
    g.scale.x = g.scale.z = size
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
function buildingModel(type: TownBuildingId, level = 1, variant = 0): THREE.Group {
    return createBuildingModel(type, level, variant)
}

/** Which colour scheme a tile's building wears: fixed by where it stands. */
function tileVariant(wx: number, wy: number) {
    return Math.floor(hash(Math.floor(wx), Math.floor(wy), 7) * TOWN_MODEL_VARIANTS)
}

// ─── Roads ───────────────────────────────────────────────────────────────────
// A road tile is a flat slab with a lighter centre line running toward every
// neighbouring road, so a network reads as one connected street.

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
    const built = flattenModel(createRoadParts(conns))
    roadModelCache.set(key, built)
    return built.clone(true)
}

function isPending(b: SceneBuilding, now: number) {
    return b.completesAt > now && (b.level === 0 || b.upgradingTo !== null)
}

// Models are authored to fill their tile and grow by stage, so every level
// draws at the same scale; only construction squashes a building.
function levelScale(_level: number) {
    return 1
}

// Swap only the artwork. Keep selection, rotation, timers and the building's
// simulation data intact, and bind animation anchors on the new model.
function syncModelAppearance(e: BuildingEntry, level: number) {
    if (e.data.type === 'road') return
    // The colour scheme belongs to the tile, so a moved building changes coat.
    const pos = worldPos(e.data)
    const variant = pos ? tileVariant(pos.x, pos.z) : e.variant
    if (e.visualLevel === level && e.variant === variant) return
    releaseModelGlow(e.model)
    e.group.remove(e.model)
    e.model = buildingModel(e.data.type as TownBuildingId, level, variant)
    e.variant = variant
    e.model.rotation.y = (e.data.rotation ?? 0) * Math.PI / 2
    e.model.traverse(o => { o.userData.buildingId = e.data.id })
    e.group.add(e.model)
    e.visualLevel = level
    e.modelHeight = e.model.userData.height as number
    bindModelAnimations(e)
    markShadowsDirty()
}

/** Each turning part carries its own axis and pace (sails are lazy, blades are not). */
function spinPart(o: THREE.Object3D, dt: number) {
    const axis = (o.userData.spinAxis as 'x' | 'y' | 'z' | undefined) ?? 'y'
    o.rotation[axis] += dt * ((o.userData.spinRate as number | undefined) ?? 4)
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
    return townSceneLevel(b.type, !isPending(b, now) && b.upgradingTo !== null ? Math.max(b.level, b.upgradingTo) : b.level)
}

/** Hidden in place because it is on the cursor — alone, or as part of a selection. */
function isBeingMoved(id: string) {
    return props.movingId === id || !!props.moveGhosts?.some(g => g.id === id)
}

/** The first sync draws the town as it stands; anything new after that was just built. */
let buildingsSynced = false

function syncBuildings() {
    const now = Date.now() + props.serverOffsetMs
    const seen = new Set<string>()
    const roads = roadTiles()
    const landed: BuildingEntry[] = []
    for (const b of props.buildings) {
        seen.add(b.id)
        const pos = worldPos(b)
        if (!pos) continue
        let e = entries.get(b.id)
        // New since the first sync, or standing somewhere else until now: the
        // player just put it down. A rebuild for a changed type is only new
        // artwork and lands silently.
        const arrived = buildingsSynced && (!e || e.group.position.x !== pos.x || e.group.position.z !== pos.z)
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
                : buildingModel(b.type as TownBuildingId, displayedLevel(b, now), tileVariant(pos.x, pos.z))
            group.add(model)
            group.userData.buildingId = b.id
            model.traverse((o) => { o.userData.buildingId = b.id })
            buildingsGroup.add(group)
            e = {
                data: b, group, model, scaffold: null, bar: null,
                spin: [], smoke: [], glow: [],
                visualLevel: displayedLevel(b, now),
                variant: tileVariant(pos.x, pos.z),
                modelHeight: (model.userData.height as number | undefined) ?? 0.9,
                wasPending: isPending(b, now), popAt: 0, landAt: 0, landDusted: false, baseY: 0.3,
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
        e.group.visible = !isBeingMoved(b.id)
        if (arrived) landed.push(e)
        const pending = isPending(b, now)
        if (pending && !e.scaffold) {
            e.scaffold = makeScaffold(e.modelHeight * levelScale(b.level) + 0.15, townBuildingSize(b.type))
            e.group.add(e.scaffold)
        }
        if (!pending && e.scaffold) dropScaffold(e)
        if (e.wasPending && !pending) e.popAt = performance.now()
        e.wasPending = pending
    }
    for (const [id, e] of entries) {
        if (!seen.has(id)) {
            disposeEntry(e)
            entries.delete(id)
        }
    }
    // A whole town arriving at once (a redesign cancelled or reloaded) is a
    // reset, not a placement: only a hand's worth of buildings lands.
    if (landed.length <= MAX_LANDINGS) for (const e of landed) landEntry(e)
    buildingsSynced = true
}

// ─── Landing thunk ───────────────────────────────────────────────────────────
// A building set down drops the last few centimetres, squashes on impact and
// springs back, with a ring of dust off its footprint. A road just puffs.

const LAND_MS = 350
/** More arrivals than a drag can lay in one go is a reset, and lands silently. */
const MAX_LANDINGS = TOWN_MAX_DRAG_TILES
/** Share of the landing spent falling; the rest is the squash and spring. */
const LAND_DROP = 0.2
/** Until when some building is still landing, so the frame loop keeps up. */
let landUntil = 0

function landEntry(e: BuildingEntry) {
    if (props.reducedMotion) return
    const size = townBuildingSize(e.data.type)
    if (e.def.kind === 'road') {
        kickDust(e.group.position.x, e.group.position.z, size * 0.7, 4, 0.4)
        return
    }
    e.landAt = performance.now()
    e.landDusted = false
    landUntil = Math.max(landUntil, e.landAt + LAND_MS)
}

/** A ring of dust thrown outward from the edge of a footprint. */
function kickDust(x: number, z: number, size: number, count: number, speed: number) {
    const r = size * 0.5
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.4
        const p = spawn(new THREE.Vector3(x + Math.cos(a) * r, 0.36, z + Math.sin(a) * r), 'dust')
        if (!p) return
        p.vx = Math.cos(a) * speed
        p.vz = Math.sin(a) * speed
        p.vy = 0.12 + Math.random() * 0.15
        p.maxLife = 0.6
    }
}

function disposeEntry(e: BuildingEntry) {
    releaseModelGlow(e.model)
    buildingsGroup.remove(e.group)
    // The model's geometry is shared with the prototype cache and must not be
    // touched; the scaffold is this entry's own and would otherwise leak.
    if (e.scaffold) dropScaffold(e)
    e.bar?.remove()
    e.alert?.remove()
}

// ─── Ghost ───────────────────────────────────────────────────────────────────

let ghost: THREE.Group | null = null
let ghostMats: THREE.MeshStandardMaterial[] = []
// The tile is the target; the mesh glides there and turns the short way round
// in the frame loop, so the ghost slides across the ground instead of jumping.
// The pad and the door arrow stay snapped: they say where it will land.
const ghostTarget = new THREE.Vector3()
const ghostShown = new THREE.Vector3()
let ghostYaw = 0
/** Fraction of the gap left after one second: about a 70 ms glide. */
const GHOST_GLIDE = 1e-6
/** The last verdict the ghost was tinted with, to restore after a deny flash. */
let ghostTintOk = true
/** When the last refused click started its shake; 0 = none running. */
let denyAt = 0
const DENY_MS = 300

function ghostYawGoal() {
    return props.ghostType && getTownBuilding(props.ghostType)?.kind === 'road' ? 0 : props.ghostRotation * Math.PI / 2
}

/** Put the ghost straight on its target: fresh on screen, it must not glide in from where it was last hidden. */
function snapGhost() {
    if (!ghost) return
    ghostShown.copy(ghostTarget)
    ghostYaw = ghostYawGoal()
    ghost.position.copy(ghostShown)
    ghost.rotation.y = ghostYaw
}

function rebuildGhost() {
    if (ghost) { buildingsGroup.remove(ghost); ghostMats.forEach(m => m.dispose()); ghost = null; ghostMats = [] }
    hideGhost()
    if (!props.ghostType || !getTownBuilding(props.ghostType)) return
    const ghostDef = getTownBuilding(props.ghostType)!
    // A monument is previewed finished, so the player sees what they are starting.
    const ghostLevel = ghostDef.kind === 'monument' ? TOWN_MONUMENT_STAGES : props.ghostLevel
    ghost = ghostDef.kind === 'road' ? buildRoadModel([false, false, false, false]) : buildingModel(props.ghostType as TownBuildingId, ghostLevel)
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
    ghostYaw = ghostDef.kind === 'road' ? 0 : props.ghostRotation * Math.PI / 2
    ghost.rotation.y = ghostYaw
    ghost.scale.setScalar(ghostDef.kind === 'road' ? 1 : levelScale(props.ghostLevel))
    buildingsGroup.add(ghost)
}
function tintGhost(ok: boolean) {
    ghostTintOk = ok
    for (const m of ghostMats) {
        m.emissive.set(ok ? 0x2ecc71 : 0xe74c3c)
        m.emissiveIntensity = ok ? 0.35 : 0.75
        m.opacity = ok ? 0.6 : 0.5
    }
    ;(ghostPad.material as THREE.MeshBasicMaterial).color.set(ok ? 0x2ecc71 : 0xe74c3c)
    frontMarkerFill.color.set(ok ? 0xffffff : 0xffb3b3)
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

// The door arrow is drawn over everything (no depth test, late render order)
// with a dark rim, so it still reads on a road's white lines, under a
// neighbour's roof, or behind the ghost itself when the camera faces its back.
function arrowShape(scale: number) {
    const shape = new THREE.Shape()
    shape.moveTo(-0.3 * scale, -0.06 * scale)
    shape.lineTo(-0.11 * scale, -0.06 * scale)
    shape.lineTo(-0.11 * scale, -0.26 * scale)
    shape.lineTo(0.11 * scale, -0.26 * scale)
    shape.lineTo(0.11 * scale, -0.06 * scale)
    shape.lineTo(0.3 * scale, -0.06 * scale)
    shape.lineTo(0, 0.28 * scale)
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
}
const ARROW_FILL_GEO = arrowShape(1)
const ARROW_RIM_GEO = arrowShape(1.28)
const arrowRimMat = new THREE.MeshBasicMaterial({ color: 0x14181d, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, side: THREE.DoubleSide })

/** A door arrow lying flat, pointing along +y of its own plane; tint its fill through `fill`. */
function makeFrontArrow(): { group: THREE.Group, fill: THREE.MeshBasicMaterial } {
    const fill = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
    const rim = new THREE.Mesh(ARROW_RIM_GEO, arrowRimMat)
    const body = new THREE.Mesh(ARROW_FILL_GEO, fill)
    rim.renderOrder = 998
    body.renderOrder = 999
    const group = new THREE.Group()
    group.add(rim, body)
    group.rotation.x = -Math.PI / 2
    return { group, fill }
}

const { group: frontMarker, fill: frontMarkerFill } = makeFrontArrow()
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

/**
 * Put the ghost on (x, z). During a paint drag the tint follows the verdict on
 * the run's last tile, and the issue label stays down: the pads on the ground
 * are the authority then, and a single-tile message would contradict them.
 */
/** The tile the cursor last held the ghost on, so a rotate can put it straight back. */
let ghostCursor: { x: number, z: number } | null = null

function placeGhostAt(cursorX: number, cursorZ: number, painting = false) {
    ghostCursor = { x: cursorX, z: cursorZ }
    const def = props.ghostType ? getTownBuilding(props.ghostType) : null
    const size = def?.size ?? 1
    const half = size / 2
    // Hold wide buildings by their middle, shifting them inside the plot at its edges.
    const { wx: x, wy: z } = townFootprintAnchor(cursorX, cursorZ, size)
    if (ghost) {
        ghostTarget.set(x + half, 0.3, z + half)
        if (!ghost.visible || props.reducedMotion) snapGhost()
        ghost.visible = true
    }
    ghostPad.visible = true
    ghostPad.position.set(x + half, 0.325, z + half)
    ghostPad.scale.set(size, size, 1)
    if (def && def.kind !== 'road') {
        // The arrow sits in the middle of the row of tiles the front opens onto.
        const front = townFrontTiles(x, z, props.ghostRotation, size)
        const fx = front.reduce((sum, f) => sum + f.wx, 0) / front.length
        const fz = front.reduce((sum, f) => sum + f.wy, 0) / front.length
        frontMarker.visible = true
        frontMarker.position.set(fx + 0.5, 0.33, fz + 0.5)
        frontMarker.rotation.z = -props.ghostRotation * Math.PI / 2 + Math.PI
    } else {
        frontMarker.visible = false
    }
    if (painting) {
        tintGhost(props.dragValid[paintTiles.length - 1] !== false)
        showIssue(null, 0, 0)
    } else {
        tintGhost(!props.ghostIssue)
        showIssue(props.ghostIssue, x + half, z + half)
    }
}

/** A click the rules refused: the ghost (or the carried block) shakes its head and flushes red. */
function denyGhost(): void {
    if (!ghost?.visible && !moveGhostGroup.visible) return
    denyAt = performance.now()
}

/** Ease the ghost onto its tile and play any deny shake. Runs once per frame. */
function stepGhosts(dt: number, ms: number) {
    const still = props.reducedMotion
    let shake = 0
    if (denyAt) {
        const t = Math.max(0, (ms - denyAt) / DENY_MS)
        if (t >= 1) {
            denyAt = 0
            tintGhost(ghostTintOk)
            tintMoveGhosts(!props.moveIssue)
        } else {
            // A decaying sine across the screen; reduced motion keeps only the flush.
            shake = still ? 0 : Math.sin(t * Math.PI * 7) * (1 - t) * (1 - t) * 0.12
            for (const m of ghostMats) {
                m.emissive.set(0xe74c3c)
                m.emissiveIntensity = 0.75 + (1 - t) * 0.9
            }
            for (const m of moveGhostMats) {
                m.emissive.set(0xe74c3c)
                m.emissiveIntensity = 0.75 + (1 - t) * 0.9
            }
        }
    }
    // Screen-right on the ground, from the camera's yaw.
    const sx = Math.cos(cam.yaw) * shake
    const sz = -Math.sin(cam.yaw) * shake
    moveGhostGroup.position.set(sx, 0, sz)
    if (!ghost?.visible) return
    const k = still ? 1 : 1 - Math.pow(GHOST_GLIDE, dt)
    ghostShown.lerp(ghostTarget, k)
    if (ghostShown.distanceToSquared(ghostTarget) < 1e-6) ghostShown.copy(ghostTarget)
    const goal = ghostYawGoal()
    const turn = Math.atan2(Math.sin(goal - ghostYaw), Math.cos(goal - ghostYaw))
    ghostYaw = Math.abs(turn) < 0.001 ? goal : ghostYaw + turn * k
    ghost.position.set(ghostShown.x + sx, ghostShown.y, ghostShown.z + sz)
    ghost.rotation.y = ghostYaw
}

/** Is the ghost still on its way to its tile, or shaking? */
function ghostBusy() {
    if (denyAt) return true
    if (!ghost?.visible) return false
    return !ghostShown.equals(ghostTarget) || ghostYaw !== ghostYawGoal()
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

// ─── Selection rings ─────────────────────────────────────────────────────────
// One ring per selected building, pooled: a marquee over a full plot can select
// sixty of them, and sixty ring meshes built per pointermove would be absurd.

const selectionGroup = new THREE.Group()
fxGroup.add(selectionGroup)
const selectionRingGeo = new THREE.RingGeometry(0.5, 0.62, 24)
const selectionRingMat = new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
const selectionRings: THREE.Mesh[] = []

/** Ids the marquee is currently over — drawn like a selection while the drag lasts. */
const marqueeIds = new Set<string>()

function syncSelectionRings() {
    const ids = new Set<string>(props.selectedIds)
    for (const id of marqueeIds) ids.add(id)
    let i = 0
    for (const id of ids) {
        const e = entries.get(id)
        if (!e) continue
        let ring = selectionRings[i]
        if (!ring) {
            ring = new THREE.Mesh(selectionRingGeo, selectionRingMat)
            ring.rotation.x = -Math.PI / 2
            selectionGroup.add(ring)
            selectionRings.push(ring)
        }
        ring.visible = true
        ring.position.set(e.group.position.x, 0.325, e.group.position.z)
        ring.scale.setScalar(townBuildingSize(e.data.type))
        i++
    }
    for (let j = i; j < selectionRings.length; j++) selectionRings[j]!.visible = false
}

// ─── Drag pads ───────────────────────────────────────────────────────────────
// The tiles a drag is painting, flat on the ground: green where the parent says
// the build is allowed, red where it is not.

const padGroup = new THREE.Group()
fxGroup.add(padGroup)
const padGeo = new THREE.PlaneGeometry(0.92, 0.92)
const padOkMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.4, depthWrite: false })
const padBadMat = new THREE.MeshBasicMaterial({ color: 0xe74c3c, transparent: true, opacity: 0.45, depthWrite: false })
const pads: THREE.Mesh[] = []

function showPads(tiles: { wx: number, wy: number }[], ok: (i: number) => boolean) {
    tiles.forEach((t, i) => {
        let pad = pads[i]
        if (!pad) {
            pad = new THREE.Mesh(padGeo, padOkMat)
            pad.rotation.x = -Math.PI / 2
            padGroup.add(pad)
            pads.push(pad)
        }
        pad.material = ok(i) ? padOkMat : padBadMat
        pad.position.set(t.wx + 0.5, 0.34, t.wy + 0.5)
        pad.visible = true
    })
    for (let i = tiles.length; i < pads.length; i++) pads[i]!.visible = false
}

function hidePads() {
    for (const pad of pads) pad.visible = false
}

// ─── Group move ghosts ───────────────────────────────────────────────────────
// A selection being carried: one translucent model per member, laid out around
// the tile under the cursor exactly as they will land.

const moveGhostGroup = new THREE.Group()
buildingsGroup.add(moveGhostGroup)
let moveGhostMats: THREE.MeshStandardMaterial[] = []
/** The carried block's door arrows: plain colour, tinted with the block. */
let moveArrowMats: THREE.MeshBasicMaterial[] = []
let moveGhostItems: { holder: THREE.Object3D, dx: number, dy: number, half: number }[] = []
/** Last tile the block hovered, so a rebuild (a rotate) can put it straight back. */
let moveGhostAnchor: { wx: number, wy: number } | null = null

function disposeMoveGhosts() {
    for (const m of moveGhostMats) m.dispose()
    moveGhostMats = []
    for (const m of moveArrowMats) m.dispose()
    moveArrowMats = []
    moveGhostItems = []
    moveGhostGroup.clear()
}

function rebuildMoveGhosts() {
    disposeMoveGhosts()
    const wanted = props.moveGhosts
    if (!wanted || wanted.length === 0) return
    for (const g of wanted) {
        const def = getTownBuilding(g.type)
        if (!def) continue
        const model = def.kind === 'road' ? buildRoadModel([false, false, false, false]) : buildingModel(g.type as TownBuildingId, townSceneLevel(g.type, def.kind === 'monument' ? g.level : Math.max(1, g.level)))
        model.rotation.y = def.kind === 'road' ? 0 : g.rotation * Math.PI / 2
        model.scale.setScalar(def.kind === 'road' ? 1 : levelScale(Math.max(1, g.level)))
        model.traverse((o) => {
            if (!(o instanceof THREE.Mesh)) return
            const m = (o.material as THREE.MeshStandardMaterial).clone()
            m.transparent = true
            m.opacity = 0.55
            m.emissive = new THREE.Color(0x2ecc71)
            m.emissiveIntensity = 0.35
            if (o.name === 'glow') (o.material as THREE.Material).dispose()
            o.material = m
            o.castShadow = false
            moveGhostMats.push(m)
        })
        const holder = new THREE.Group()
        holder.add(model)
        if (def.kind !== 'road') {
            // Every carried building keeps its door arrow, so a turned block shows which way each one faces.
            const size = def.size ?? 1
            const front = townFrontTiles(0, 0, g.rotation, size)
            const arrow = makeFrontArrow()
            arrow.group.position.set(
                front.reduce((sum, f) => sum + f.wx, 0) / front.length + 0.5 - size / 2,
                0.03,
                front.reduce((sum, f) => sum + f.wy, 0) / front.length + 0.5 - size / 2
            )
            arrow.group.rotation.z = -g.rotation * Math.PI / 2 + Math.PI
            moveArrowMats.push(arrow.fill)
            holder.add(arrow.group)
        }
        moveGhostGroup.add(holder)
        moveGhostItems.push({ holder, dx: g.dx, dy: g.dy, half: (def.size ?? 1) / 2 })
    }
    tintMoveGhosts(!props.moveIssue)
    moveGhostGroup.visible = false
    if (moveGhostAnchor) placeMoveGhostsAt(moveGhostAnchor.wx, moveGhostAnchor.wy)
}

function tintMoveGhosts(ok: boolean) {
    for (const m of moveGhostMats) {
        m.emissive.set(ok ? 0x2ecc71 : 0xe74c3c)
        m.emissiveIntensity = ok ? 0.35 : 0.75
    }
    for (const m of moveArrowMats) m.color.set(ok ? 0xffffff : 0xffb3b3)
}

function placeMoveGhostsAt(wx: number, wy: number) {
    if (moveGhostItems.length === 0) return
    moveGhostAnchor = { wx, wy }
    moveGhostGroup.visible = true
    for (const item of moveGhostItems) item.holder.position.set(wx + item.dx + item.half, 0.3, wy + item.dy + item.half)
    tintMoveGhosts(!props.moveIssue)
    showPads(moveGhostItems.map(i => ({ wx: wx + i.dx, wy: wy + i.dy })), () => !props.moveIssue)
}

function hideMoveGhosts() {
    moveGhostGroup.visible = false
    moveGhostAnchor = null
    if (props.moveGhosts?.length) hidePads()
}

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
// Every town in view gets its own traffic: the player's, and each neighbour's.
// A town is a "zone" with its own roads, stops and spawn clocks, so a dozen
// towns do not all release a car on the same frame, and one town's cap cannot
// be eaten by another's. Only zones near the camera spawn — traffic nobody can
// see is wasted work — and the player's own town always gets its share.
//
// Routes are breadth-first searches over the road tiles, computed once per
// journey — never per frame. Traffic keeps right of the centre line and queues
// behind whatever is in front of it. Nothing here is pickable, and nothing
// casts a shadow: the shadow map is only redrawn on change, so a moving caster
// would smear.

/** Per town. */
const MAX_CARS = 3
const MAX_TRUCKS = 3
/** Across every town in view, the player's own excepted. */
const MAX_NEIGHBOUR_VEHICLES = 24
/** A neighbour spawns traffic only while its town is about this close to the camera's focus. */
const TRAFFIC_SPAWN_RANGE = 28
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
    /** The town it is driving in. */
    zone: TrafficZone
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
function doorTile(wx: number, wy: number, rotation: number, roads: Set<string>): string | null {
    const front = townFrontTile(wx, wy, rotation)
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

/** One town's traffic: where journeys can start and end, and when the next one leaves. */
interface TrafficZone {
    own: boolean
    roads: Set<string>
    /** Centre of the road network, for the camera-distance check. */
    cx: number
    cz: number
    homeStops: string[]
    workStops: string[]
    /** Producer → consumer pairs whose goods actually flow, as door-tile keys. */
    tradeLinks: [string, string][]
    carDelay: number
    truckDelay: number
}
/** Rebuilt only when a town in view changes. The player's town is first when it has roads. */
const zones: TrafficZone[] = []
/** Every road in view, for re-routing whatever is already on the move. */
let allRoads = new Set<string>()

interface ZoneBuilding { wx: number, wy: number, rotation: number, type: string, level: number }

function buildZone(items: ZoneBuilding[], own: boolean): TrafficZone | null {
    const roads = new Set<string>()
    let cx = 0
    let cz = 0
    for (const b of items) {
        if (b.type !== 'road') continue
        roads.add(roadKey(b.wx, b.wy))
        cx += b.wx + 0.5
        cz += b.wy + 0.5
    }
    if (roads.size < 2) return null
    const zone: TrafficZone = {
        own, roads, cx: cx / roads.size, cz: cz / roads.size,
        homeStops: [], workStops: [], tradeLinks: [],
        // Seeded apart so the first car and the first truck do not arrive together.
        carDelay: Math.random() * 1.5, truckDelay: 0.8 + Math.random() * 2
    }
    const workDefs: TownBuildingDef[] = []
    for (const b of items) {
        const def = getTownBuilding(b.type)
        if (!def || def.kind === 'road' || b.level === 0) continue
        const key = doorTile(b.wx, b.wy, b.rotation, roads)
        if (!key) continue
        if (def.kind === 'housing') zone.homeStops.push(key)
        else if (def.kind === 'industry') {
            zone.workStops.push(key)
            workDefs.push(def)
        }
    }
    const { workStops, tradeLinks } = zone
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
    return zone
}

function rebuildRoutes() {
    zones.length = 0
    allRoads = new Set<string>()

    const own: ZoneBuilding[] = []
    for (const b of props.buildings) {
        const pos = worldPos(b)
        if (pos) own.push({ wx: Math.floor(pos.x), wy: Math.floor(pos.z), rotation: b.rotation ?? 0, type: b.type, level: b.level })
    }
    // A neighbour with several plots is one town, and its roads run across them.
    const byOwner = new Map<string, ZoneBuilding[]>()
    for (const n of drawnNeighbours()) {
        const list = byOwner.get(n.ownerName) ?? []
        for (const b of n.buildings) list.push({ wx: n.x * PLOT + b.tileX, wy: n.y * PLOT + b.tileY, rotation: b.rotation, type: b.type, level: b.level })
        byOwner.set(n.ownerName, list)
    }
    const ownZone = buildZone(own, true)
    if (ownZone) zones.push(ownZone)
    for (const items of byOwner.values()) {
        const zone = buildZone(items, false)
        if (zone) zones.push(zone)
    }
    for (const zone of zones) for (const r of zone.roads) allRoads.add(r)

    // Anyone whose road was demolished mid-journey re-routes, or leaves.
    for (let i = vehicles.length - 1; i >= 0; i--) {
        const v = vehicles[i]!
        const zone = zones.find(z => z.roads.has(v.dest))
        const path = zone ? roadPath(roadKey(Math.floor(v.x), Math.floor(v.z)), v.dest, allRoads) : null
        if (zone && path && path.length > 1) {
            v.zone = zone
            v.path = path
            v.step = 1
        } else {
            despawn(i)
        }
    }
}

// The routes only change when a building moves, appears or disappears, but the
// buildings and neighbours props are replaced on every poll — compare a
// signature first.
let trafficSig = ''
function syncVehicles() {
    let sig = ''
    for (const p of props.plots) sig += `${p.id}@${p.x},${p.y};`
    for (const b of props.buildings) sig += `${b.plotId}:${b.tileX},${b.tileY},${b.type},${b.rotation ?? 0},${b.level === 0 ? 0 : 1};`
    // Only the neighbour plots already drawn: their signatures cover owner, square and buildings.
    for (const [id, view] of neighbourViews) sig += `${id}:${view.sig}|`
    if (sig === trafficSig) return
    trafficSig = sig
    rebuildRoutes()
}

function despawn(i: number) {
    releaseModel(vehicles[i]!)
    vehicles.splice(i, 1)
}

function countKind(kind: VehicleKind, zone: TrafficZone): number {
    let n = 0
    for (const v of vehicles) if (v.kind === kind && v.zone === zone) n++
    return n
}
function countNeighbourVehicles(): number {
    let n = 0
    for (const v of vehicles) if (!v.zone.own) n++
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
function spawnVehicle(kind: VehicleKind, zone: TrafficZone): boolean {
    const { roads, homeStops, workStops, tradeLinks } = zone
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
            zone,
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

function nextSpawnDelay() {
    return SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN)
}

/** Whether this zone may release another vehicle right now. */
function zoneMaySpawn(zone: TrafficZone): boolean {
    if (zone.own) return true
    if (countNeighbourVehicles() >= MAX_NEIGHBOUR_VEHICLES) return false
    return Math.hypot(zone.cx - cam.tx, zone.cz - cam.tz) < TRAFFIC_SPAWN_RANGE + cam.dist * 0.5
}

function stepTraffic(dt: number) {
    // Trickle in replacements for the journeys that have finished, town by town.
    for (const zone of zones) {
        zone.carDelay -= dt
        if (zone.carDelay <= 0) {
            const started = zoneMaySpawn(zone) && countKind('car', zone) < MAX_CARS && spawnVehicle('car', zone)
            zone.carDelay = started ? nextSpawnDelay() : SPAWN_RETRY + Math.random() * SPAWN_RETRY
        }
        zone.truckDelay -= dt
        if (zone.truckDelay <= 0) {
            const started = zoneMaySpawn(zone) && countKind('truck', zone) < MAX_TRUCKS && spawnVehicle('truck', zone)
            zone.truckDelay = started ? nextSpawnDelay() : SPAWN_RETRY + Math.random() * SPAWN_RETRY
        }
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

interface Particle {
    mesh: THREE.Mesh
    vx: number
    vy: number
    vz: number
    life: number
    maxLife: number
    grow: number
    /** Boost embers and motes: their own material, faded one by one. */
    boost?: { base: number, peak: number, swirl: { cx: number, cz: number, r: number, a: number, w: number } | null }
}
type ParticleKind = 'smoke' | 'spark' | 'dust' | 'ember' | 'mote'
const particles: Particle[] = []
const smokeMat = new THREE.MeshBasicMaterial({ color: 0xdedede, transparent: true, opacity: 0.55, depthWrite: false })
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.95, depthWrite: false })
const dustMat = new THREE.MeshBasicMaterial({ color: 0xc9b58a, transparent: true, opacity: 0.5, depthWrite: false })
const puffGeo = new THREE.SphereGeometry(0.08, 6, 5)
/** A boost spark: a little diamond that catches the light better than a ball. */
const emberGeo = new THREE.OctahedronGeometry(0.08, 0)
const MAX_PARTICLES = 40
/** Boost embers and motes have a budget of their own, so a surge never starves the chimneys. */
const MAX_BOOST_PARTICLES = 48
let boostParticleCount = 0
/** Past this camera distance the puffs are a pixel each — not worth a draw call. */
const PARTICLE_DRAW_DISTANCE = 45
const EMBER_COLOR = 0xffa133
const MOTE_COLOR = 0x6fe08c
/** Every boost particle fades on its own, so each needs its own material; they are pooled. */
const boostMatPool: THREE.MeshBasicMaterial[] = []
const boostMats: THREE.MeshBasicMaterial[] = []
/**
 * The smallest a boost particle may draw, as a scale on its 0.08 radius, and
 * how much to dim it for the area it gained (see updateParticleFloor). At
 * dpr 1 a far camera would otherwise shrink them into flickering dots.
 */
let particleMinScale = 0
const particleDim = (scale: number) => particleMinScale > scale ? Math.max(0.3, (scale / particleMinScale) ** 2) : 1

function spawn(pos: THREE.Vector3, kind: ParticleKind): Particle | null {
    if (props.reducedMotion || cam.dist > PARTICLE_DRAW_DISTANCE) return null
    const isBoost = kind === 'ember' || kind === 'mote'
    if (isBoost ? boostParticleCount >= MAX_BOOST_PARTICLES : particles.length - boostParticleCount >= MAX_PARTICLES) return null
    let mat: THREE.MeshBasicMaterial
    if (isBoost) {
        let pooled = boostMatPool.pop()
        if (!pooled) {
            // Not tone mapped, or ACES turns a bright amber into a muddy brown.
            // The colours stay well short of white, so nothing blows out.
            pooled = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false })
            boostMats.push(pooled)
        }
        mat = pooled
        mat.color.setHex(kind === 'ember' ? EMBER_COLOR : MOTE_COLOR)
        mat.opacity = 0
        boostParticleCount++
    } else {
        mat = kind === 'smoke' ? smokeMat : kind === 'spark' ? sparkMat : dustMat
    }
    const mesh = new THREE.Mesh(kind === 'ember' ? emberGeo : puffGeo, mat)
    mesh.position.copy(pos)
    const sc = kind === 'spark' ? 0.35 : kind === 'dust' ? 0.7 : kind === 'ember' ? 0.85 : kind === 'mote' ? 0.75 : 0.8
    mesh.scale.setScalar(sc)
    if (kind === 'ember') mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0)
    fxGroup.add(mesh)
    const particle: Particle = {
        mesh,
        vx: (Math.random() - 0.5) * (kind === 'spark' ? 0.9 : 0.25),
        vy: kind === 'smoke' ? 0.55 + Math.random() * 0.3 : kind === 'spark' ? 1.2 + Math.random() : kind === 'ember' ? 0.75 + Math.random() * 0.35 : kind === 'mote' ? 0.35 + Math.random() * 0.2 : 0.4,
        vz: (Math.random() - 0.5) * (kind === 'spark' ? 0.9 : 0.25),
        life: 0,
        maxLife: kind === 'smoke' ? 2.2 + Math.random() : kind === 'spark' ? 0.7 : kind === 'ember' ? 1.3 + Math.random() * 0.4 : kind === 'mote' ? 1.8 + Math.random() * 0.6 : 0.9,
        grow: kind === 'smoke' ? 0.9 : 0,
        boost: isBoost ? { base: sc, peak: kind === 'ember' ? 0.95 : 0.8, swirl: null } : undefined
    }
    if (kind === 'mote') { particle.vx *= 0.4; particle.vz *= 0.4 }
    particles.push(particle)
    return particle
}

function dropParticle(i: number) {
    const p = particles[i]!
    fxGroup.remove(p.mesh)
    if (p.boost) {
        boostMatPool.push(p.mesh.material as THREE.MeshBasicMaterial)
        boostParticleCount--
    }
    particles.splice(i, 1)
}

function stepParticles(dt: number) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!
        p.life += dt
        if (p.life >= p.maxLife) {
            dropParticle(i)
            continue
        }
        const t = p.life / p.maxLife
        if (p.boost) {
            const b = p.boost
            if (b.swirl) {
                // Spiral up round the site, tightening as it climbs.
                b.swirl.a += b.swirl.w * dt
                const r = b.swirl.r * (1 - t * 0.45)
                p.mesh.position.x = b.swirl.cx + Math.cos(b.swirl.a) * r
                p.mesh.position.z = b.swirl.cz + Math.sin(b.swirl.a) * r
                p.mesh.rotation.y += dt * 4
            } else {
                p.mesh.position.x += p.vx * dt
                p.mesh.position.z += p.vz * dt
            }
            p.mesh.position.y += p.vy * dt
            // Grow in, shrink out, never below what the screen can show.
            const size = b.base * Math.min(1, t * 6) * (1 - t * 0.5)
            const shown = Math.max(size, particleMinScale)
            p.mesh.scale.setScalar(shown)
            ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = b.peak * Math.min(1, t * 6) * (1 - t) * particleDim(size)
            continue
        }
        p.mesh.position.x += p.vx * dt
        p.mesh.position.y += p.vy * dt
        p.mesh.position.z += p.vz * dt
        if (p.grow) p.mesh.scale.addScalar(p.grow * dt)
        p.vy -= (p.mesh.material === sparkMat ? 2.2 : 0) * dt
        ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = (p.mesh.material === smokeMat ? 0.5 : 0.95) * (1 - t)
    }
}

// ─── Boost effects ───────────────────────────────────────────────────────────
// Builder's rush: amber embers spiral up off every site, a ring of light turns
// at its base, the dust flies faster and the scaffold glows. Production surge:
// green motes rise off every staffed workshop over a soft pulse on the ground.
//
// The rings and the pulses are one instanced mesh each, so a town of a hundred
// workshops is still two draw calls. The embers and motes come out of their
// own particle budget, only near the camera, and the budget is shared out
// fairly: the more sites there are, the less often each one throws a spark.

/** Sites further than this from the camera's focus get a ring but no sparks. */
const BOOST_FX_RANGE = 26
/** About this many sites' worth of particles at full rate, however many there are. */
const BOOST_FX_SITES = 10

function boostTexture(draw: (g: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
    const size = 128
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')!
    draw(g, size)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    return tex
}

// Built lazily: the canvas needs the DOM, and most visits see no boost at all.
let rushRingParts: { geo: THREE.PlaneGeometry, mat: THREE.MeshBasicMaterial } | null = null
let surgeDiscParts: { geo: THREE.PlaneGeometry, mat: THREE.MeshBasicMaterial } | null = null
let rushRings: THREE.InstancedMesh | null = null
let surgeDiscs: THREE.InstancedMesh | null = null
let rushScaffoldMat: THREE.MeshStandardMaterial | null = null
/** Some scaffold wears the rush glow, so the end of the rush has scaffolds to put back. */
let scaffoldsRushed = false
const SCAFFOLD_COLOR = 0xc8a165

function ringParts() {
    if (!rushRingParts) {
        // A thin ring broken into six bright dashes, so its turning reads.
        const map = boostTexture((g, size) => {
            const c = size / 2
            g.lineCap = 'round'
            const glow = g.createRadialGradient(c, c, c * 0.5, c, c, c * 0.98)
            glow.addColorStop(0, 'rgba(255,255,255,0)')
            glow.addColorStop(0.6, 'rgba(255,255,255,0.32)')
            glow.addColorStop(1, 'rgba(255,255,255,0)')
            g.fillStyle = glow
            g.fillRect(0, 0, size, size)
            g.strokeStyle = 'rgba(255,255,255,0.55)'
            g.lineWidth = 4
            g.beginPath()
            g.arc(c, c, c * 0.8, 0, Math.PI * 2)
            g.stroke()
            g.strokeStyle = '#fff'
            g.lineWidth = 10
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2
                g.beginPath()
                g.arc(c, c, c * 0.8, a, a + 0.6)
                g.stroke()
            }
        })
        const geo = new THREE.PlaneGeometry(1, 1)
        geo.rotateX(-Math.PI / 2)
        const mat = new THREE.MeshBasicMaterial({ map, color: EMBER_COLOR, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false })
        rushRingParts = { geo, mat }
    }
    return rushRingParts
}

function discParts() {
    if (!surgeDiscParts) {
        // A soft band that ripples outward: added light, so each ring fades
        // out through its instance colour going to black.
        const map = boostTexture((g, size) => {
            const c = size / 2
            const glow = g.createRadialGradient(c, c, c * 0.45, c, c, c * 0.98)
            glow.addColorStop(0, 'rgba(255,255,255,0)')
            glow.addColorStop(0.55, 'rgba(255,255,255,1)')
            glow.addColorStop(1, 'rgba(255,255,255,0)')
            g.fillStyle = glow
            g.fillRect(0, 0, size, size)
        })
        const geo = new THREE.PlaneGeometry(1, 1)
        geo.rotateX(-Math.PI / 2)
        const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
        surgeDiscParts = { geo, mat }
    }
    return surgeDiscParts
}

/** An instanced mesh with room for `count`, regrown in steps of 16 when the town outgrows it. */
function ensureInstances(mesh: THREE.InstancedMesh | null, count: number, parts: { geo: THREE.PlaneGeometry, mat: THREE.MeshBasicMaterial }, order: number): THREE.InstancedMesh | null {
    if (count === 0 && !mesh) return null
    if (mesh && mesh.instanceMatrix.count >= count) return mesh
    if (mesh) { fxGroup.remove(mesh); mesh.dispose() }
    const next = new THREE.InstancedMesh(parts.geo, parts.mat, Math.ceil(Math.max(1, count) / 16) * 16)
    next.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    next.frustumCulled = false
    next.renderOrder = order
    next.count = 0
    fxGroup.add(next)
    return next
}

interface BoostSite { x: number, z: number, size: number, phase: number }
const rushSites: BoostSite[] = []
const surgeSites: BoostSite[] = []
/** Sites in range last frame, which sets how often each one sparks this frame. */
let rushNear = 0
let surgeNear = 0
let rushNearNext = 0
let surgeNearNext = 0

const boostMatrix = new THREE.Matrix4()
const boostQuat = new THREE.Quaternion()
const boostScale = new THREE.Vector3()
const boostPos = new THREE.Vector3()
const yAxis = new THREE.Vector3(0, 1, 0)
const camRight = new THREE.Vector3()
const surgeColor = new THREE.Color()

/**
 * How big one world unit is on screen right now, in device pixels, from which
 * the boost particles take their smallest size: about two pixels across.
 */
function updateParticleFloor() {
    if (!renderer) return
    camRight.setFromMatrixColumn(camera.matrixWorld, 0)
    const a = project(cam.tx, 0.6, cam.tz)
    const b = project(cam.tx + camRight.x, 0.6 + camRight.y, cam.tz + camRight.z)
    const pxPerUnit = Math.hypot(b.sx - a.sx, b.sy - a.sy) * renderer.getPixelRatio()
    particleMinScale = pxPerUnit > 0 ? 1 / (pxPerUnit * 0.08) : 0
}

function beginBoostFx(_ms: number) {
    rushSites.length = 0
    surgeSites.length = 0
    rushNear = rushNearNext
    surgeNear = surgeNearNext
    rushNearNext = 0
    surgeNearNext = 0
    if (props.boosts?.build || props.boosts?.production) updateParticleFloor()
}

function siteOf(e: BuildingEntry): BoostSite {
    return { x: e.group.position.x, z: e.group.position.z, size: townBuildingSize(e.data.type), phase: (e.group.position.x * 0.37 + e.group.position.z * 0.61) % (Math.PI * 2) }
}

function nearCamera(e: BuildingEntry) {
    return Math.hypot(e.group.position.x - cam.tx, e.group.position.z - cam.tz) < BOOST_FX_RANGE
}

/** A site under Builder's rush: a ring, a glowing scaffold, and embers spiralling up. */
function rushSite(e: BuildingEntry, dt: number, still: boolean) {
    if (!e.group.visible) return
    const site = siteOf(e)
    rushSites.push(site)
    if (e.scaffold && e.scaffold.userData.rushed !== true) setScaffoldRushed(e.scaffold, true)
    if (still || !nearCamera(e)) return
    rushNearNext++
    const share = Math.min(1, BOOST_FX_SITES / Math.max(1, rushNear))
    if (Math.random() < dt * 9 * share) {
        const a = Math.random() * Math.PI * 2
        const r = 0.42 * site.size
        const p = spawn(tmp.set(site.x + Math.cos(a) * r, 0.38, site.z + Math.sin(a) * r), 'ember')
        if (p?.boost) p.boost.swirl = { cx: site.x, cz: site.z, r, a, w: 2.6 + Math.random() * 1.4 }
    }
}

/** A workshop under a production surge: a pulse on the ground and green motes rising. */
function surgeSite(e: BuildingEntry, dt: number) {
    if (!e.group.visible) return
    const site = siteOf(e)
    surgeSites.push(site)
    if (props.reducedMotion || !nearCamera(e)) return
    surgeNearNext++
    const share = Math.min(1, BOOST_FX_SITES / Math.max(1, surgeNear))
    if (Math.random() < dt * 4.5 * share) {
        const h = e.modelHeight * 0.5
        spawn(tmp.set(site.x + (Math.random() - 0.5) * 0.7 * site.size, 0.4 + Math.random() * h, site.z + (Math.random() - 0.5) * 0.7 * site.size), 'mote')
    }
}

/** Lay out this frame's rings and pulses, and the scaffolds' glow. */
function endBoostFx(ms: number, still: boolean) {
    const t = ms / 1000
    if (rushSites.length || rushRings) {
        const parts = ringParts()
        rushRings = ensureInstances(rushRings, rushSites.length, parts, 2)
        if (rushRings) {
            for (let i = 0; i < rushSites.length; i++) {
                const s = rushSites[i]!
                const pulse = still ? 1 : 1 + Math.sin(t * 3 + s.phase) * 0.04
                boostQuat.setFromAxisAngle(yAxis, still ? s.phase : t * 1.1 + s.phase)
                boostScale.set(1.5 * s.size * pulse, 1, 1.5 * s.size * pulse)
                boostPos.set(s.x, 0.322, s.z)
                rushRings.setMatrixAt(i, boostMatrix.compose(boostPos, boostQuat, boostScale))
            }
            rushRings.count = rushSites.length
            rushRings.instanceMatrix.needsUpdate = true
            parts.mat.opacity = still ? 0.75 : 0.7 + Math.sin(t * 2.2) * 0.12
        }
    }
    if (surgeSites.length || surgeDiscs) {
        const parts = discParts()
        surgeDiscs = ensureInstances(surgeDiscs, surgeSites.length, parts, 1)
        if (surgeDiscs) {
            for (let i = 0; i < surgeSites.length; i++) {
                const s = surgeSites[i]!
                // 0..1 through one ripple; held halfway out with reduced motion.
                const k = still ? 0.45 : ((t * 0.55 + s.phase / (Math.PI * 2)) % 1)
                const sc = s.size * (0.9 + k * 0.85)
                boostQuat.identity()
                boostScale.set(sc, 1, sc)
                boostPos.set(s.x, 0.318, s.z)
                surgeDiscs.setMatrixAt(i, boostMatrix.compose(boostPos, boostQuat, boostScale))
                // Bright as it leaves the walls, gone by the time it is wide. Kept
                // well under white, so the added light never blows the grass out.
                const fade = still ? 0.55 : Math.sin(Math.min(1, k * 4) * Math.PI / 2) * (1 - k)
                surgeColor.setHex(MOTE_COLOR).multiplyScalar(0.7 * fade)
                surgeDiscs.setColorAt(i, surgeColor)
            }
            if (surgeDiscs.instanceColor) surgeDiscs.instanceColor.needsUpdate = true
            surgeDiscs.count = surgeSites.length
            surgeDiscs.instanceMatrix.needsUpdate = true
        }
    }
    if (rushScaffoldMat) rushScaffoldMat.emissiveIntensity = still ? 0.55 : 0.4 + (Math.sin(t * 4) * 0.5 + 0.5) * 0.35
    // The rush ended: every scaffold back to plain wood.
    if (!rushSites.length && scaffoldsRushed) {
        scaffoldsRushed = false
        for (const e of entries.values()) {
            if (e.scaffold?.userData.rushed) setScaffoldRushed(e.scaffold, false)
        }
    }
}

function setScaffoldRushed(scaffold: THREE.Group, on: boolean) {
    if (on && !rushScaffoldMat) {
        rushScaffoldMat = new THREE.MeshStandardMaterial({ color: SCAFFOLD_COLOR, emissive: 0xff8a1f, emissiveIntensity: 0.35, roughness: 0.85, metalness: 0.02, flatShading: true })
    }
    if (on) scaffoldsRushed = true
    const mat = on ? rushScaffoldMat! : townMaterial(SCAFFOLD_COLOR)
    scaffold.traverse((o) => { if (o instanceof THREE.Mesh) o.material = mat })
    scaffold.userData.rushed = on
}

/** Take a site's scaffold down. The rush glow is shared, so it goes back to wood first. */
function dropScaffold(e: BuildingEntry) {
    if (!e.scaffold) return
    if (e.scaffold.userData.rushed) setScaffoldRushed(e.scaffold, false)
    e.group.remove(e.scaffold)
    disposeGroup(e.scaffold)
    e.scaffold = null
}

function disposeBoostFx() {
    for (let i = particles.length - 1; i >= 0; i--) dropParticle(i)
    for (const m of boostMats) m.dispose()
    boostMats.length = 0
    boostMatPool.length = 0
    emberGeo.dispose()
    for (const mesh of [rushRings, surgeDiscs]) {
        if (mesh) { fxGroup.remove(mesh); mesh.dispose() }
    }
    rushRings = surgeDiscs = null
    for (const parts of [rushRingParts, surgeDiscParts]) {
        if (!parts) continue
        parts.geo.dispose()
        parts.mat.map?.dispose()
        parts.mat.dispose()
    }
    rushRingParts = surgeDiscParts = null
    rushScaffoldMat?.dispose()
    rushScaffoldMat = null
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
            const bob = props.reducedMotion ? 0 : Math.sin(performance.now() / 350 + e.group.position.x) * 0.06
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
type Pick = { kind: 'building', id: string, x: number, z: number } | { kind: 'tile', tile: TileRef, x: number, z: number } | { kind: 'expansion', x: number, y: number, free: boolean } | { kind: 'listing', listing: { id: string, ownerName: string, price: number } } | { kind: 'neighbour', info: NeighbourInfo } | null

function pick(sx: number, sy: number): Pick {
    pointerNdc.set((sx / viewW) * 2 - 1, -(sy / viewH) * 2 + 1)
    raycaster.setFromCamera(pointerNdc, camera)
    const hits = raycaster.intersectObjects([buildingsGroup, plotsGroup, expansionGroup, neighbourGroup], true)
    for (const h of hits) {
        const id = h.object.userData.buildingId as string | undefined
        if (id && (!ghost || !isDescendant(h.object, ghost))) return { kind: 'building', id, x: Math.floor(h.point.x), z: Math.floor(h.point.z) }
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
    const plot = plotById.value.get(tile.plotId)
    if (!plot) return false
    return props.buildings.some(b => b.plotId === tile.plotId && townCovers({ type: b.type, wx: b.tileX, wy: b.tileY }, tile.tileX, tile.tileY))
}

// ─── Input ───────────────────────────────────────────────────────────────────

/**
 * What the left button is doing for the length of one press. A city builder
 * lives or dies on this: dragging rubber-bands a selection, dragging with a
 * ghost paints a street, and a carried block rides
 * the cursor until it is let go. The left button never pans — WASD and the
 * middle button do that — so a selection is never one slip away from a scroll.
 * A finger has no keyboard, so touch keeps the one-finger pan.
 */
type DragMode = 'none' | 'pan' | 'orbit' | 'paint' | 'marquee' | 'carry'
let dragMode: DragMode = 'none'
let moved = 0
let last = { x: 0, y: 0 }
const pointers = new Map<number, { x: number, y: number }>()
let pinch = 0
const isPanning = ref(false)

/** Where a placement drag started, and the tiles it has painted since. */
let paintStart: SceneTile | null = null
/** The building the drag began on, if any — a click that never moves still selects it. */
let paintStartBuilding: string | null = null
let paintTiles: SceneTile[] = []
let paintKey = ''
/** Screen-space corners of a marquee, and the box drawn for it. */
let marqueeStart = { x: 0, y: 0 }
let marqueeEl: HTMLDivElement | null = null

function showMarquee(x0: number, y0: number, x1: number, y1: number) {
    if (!marqueeEl && overlay.value) {
        marqueeEl = document.createElement('div')
        marqueeEl.className = 'town-marquee'
        overlay.value.appendChild(marqueeEl)
    }
    if (!marqueeEl) return
    marqueeEl.style.transform = `translate(${Math.min(x0, x1)}px, ${Math.min(y0, y1)}px)`
    marqueeEl.style.width = `${Math.abs(x1 - x0)}px`
    marqueeEl.style.height = `${Math.abs(y1 - y0)}px`
}

function hideMarquee() {
    marqueeEl?.remove()
    marqueeEl = null
}

/** Every own building whose footprint projects inside the rubber band. */
function buildingsInBox(x0: number, y0: number, x1: number, y1: number): string[] {
    const minX = Math.min(x0, x1)
    const maxX = Math.max(x0, x1)
    const minY = Math.min(y0, y1)
    const maxY = Math.max(y0, y1)
    const ids: string[] = []
    for (const e of entries.values()) {
        const p = project(e.group.position.x, e.group.position.y, e.group.position.z)
        if (!p.visible) continue
        if (p.sx >= minX && p.sx <= maxX && p.sy >= minY && p.sy <= maxY) ids.push(e.data.id)
    }
    return ids
}

/** Tiles a placement drag currently covers, as an L from where it started. */
function paintLine(to: SceneTile): SceneTile[] {
    if (!paintStart) return [to]
    const line = townDragLine(paintStart.wx, paintStart.wy, to.wx, to.wy)
    const out: SceneTile[] = []
    for (const t of line) {
        const ref = tileAtWorld(t.wx, t.wy)
        if (ref) out.push(ref)
    }
    return out
}

/** The tile an own building stands on. */
function tileOfEntry(e: BuildingEntry): SceneTile {
    return { plotId: e.data.plotId, tileX: e.data.tileX, tileY: e.data.tileY, wx: Math.floor(e.group.position.x), wy: Math.floor(e.group.position.z) }
}

/** The own tile under a pick, whether the ray hit the ground or a building standing on it. */
function tileUnder(hit: Pick): SceneTile | null {
    if (hit?.kind === 'tile') return { ...hit.tile, wx: hit.x, wy: hit.z }
    if (hit?.kind === 'building') {
        const e = entries.get(hit.id)
        return tileAtWorld(hit.x, hit.z) ?? (e ? tileOfEntry(e) : null)
    }
    return null
}

/** The owned tile at a world position, or null when the drag has run off the plots. */
function tileAtWorld(wx: number, wy: number): SceneTile | null {
    for (const p of props.plots) {
        const tileX = wx - p.x * PLOT
        const tileY = wy - p.y * PLOT
        if (tileX < 0 || tileY < 0 || tileX >= PLOT || tileY >= PLOT) continue
        return { plotId: p.id, tileX, tileY, wx, wy }
    }
    return null
}

function setPaintTiles(tiles: SceneTile[]) {
    const key = tiles.map(t => `${t.wx},${t.wy}`).join('|')
    if (key === paintKey) return
    paintKey = key
    paintTiles = tiles
    // The verdicts arrive a tick later, so the pads start optimistic and are
    // repainted by the dragValid watcher below.
    showPads(tiles, i => props.dragValid[i] !== false)
    emit('drag-tiles', tiles)
}

function endPaint() {
    paintStart = null
    paintStartBuilding = null
    paintTiles = []
    paintKey = ''
    hidePads()
    emit('drag-tiles', [])
}

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
    const unitsPerPixel = 2 * halfViewHeight(cam.dist) / viewH
    return townDragDelta(dx, dy, cam.yaw, cam.pitch, unitsPerPixel)
}

const movementKeys = new Set<string>()
const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])
/** Radians per second while Q or E is held. */
const KEY_TURN_RATE = 1.1
/** One snap turn, for reduced motion: an eighth of a circle. */
const SNAP_TURN = Math.PI / 4
/** Pixels of right-drag per snap turn. */
const SNAP_TURN_PIXELS = 70
let snapTurnAccumulated = 0
function onMovementKeyDown(e: KeyboardEvent) {
    if (!props.keyboardEnabled || !visible || e.metaKey || e.ctrlKey || e.altKey || townIsTyping(e.target)) return
    if (!movementCodes.has(e.code)) return
    e.preventDefault()
    // Reduced motion: Q and E snap a quarter turn per press instead of
    // sweeping the view while held.
    if (props.reducedMotion && (e.code === 'KeyQ' || e.code === 'KeyE')) {
        if (!e.repeat) camGoal.yaw += (e.code === 'KeyQ' ? 1 : -1) * SNAP_TURN
        return
    }
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

/** Which drag a fresh press starts, from the button, the modifiers and the active tool. */
function modeFor(e: PointerEvent, at: { x: number, y: number }): DragMode {
    if (e.button === 2) return 'orbit'
    if (e.button === 1) return 'pan'
    if (e.pointerType === 'touch') return 'pan'
    // A block on the cursor is dropped where the button comes up, however far
    // the pointer wandered on the way: a slip must not throw the selection away.
    if (props.moveGhosts?.length) return 'carry'
    // A ghost turns the left button into a brush over your own land. A building
    // counts as land: a street is extended by dragging from its end.
    if (ghost && !props.movingId) {
        const hit = pick(at.x, at.y)
        if (hit?.kind === 'tile' || hit?.kind === 'building') return 'paint'
    }
    return 'marquee'
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
    moved = 0
    last = p
    snapTurnAccumulated = 0
    dragMode = modeFor(e, p)
    if (dragMode === 'paint') {
        const hit = pick(p.x, p.y)
        paintStart = tileUnder(hit)
        paintStartBuilding = hit?.kind === 'building' ? hit.id : null
        if (paintStart) setPaintTiles([paintStart])
    } else if (dragMode === 'marquee') {
        marqueeStart = p
        marqueeIds.clear()
    }
}

function onPointerMove(e: PointerEvent) {
    const p = local(e)
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p)
    if (pointers.size === 2) {
        moved = 5
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        if (pinch > 0) zoomBy(pinch / d, true)
        pinch = d
        return
    }
    if (dragMode !== 'none') {
        const dx = p.x - last.x
        const dy = p.y - last.y
        moved += Math.abs(dx) + Math.abs(dy)
        last = p
        // A drag moves the view directly, not through the easing: the ground
        // and the pointer stay glued together, with no lag and no drift after
        // the button comes up. Easing is kept for the wheel, the keys and
        // recenter, which have no hand to follow.
        if (dragMode === 'orbit') {
            if (props.reducedMotion) {
                // Snap turns only, and the tilt stays put.
                snapTurnAccumulated += dx
                const { steps, remainder } = townSnapTurn(snapTurnAccumulated, SNAP_TURN_PIXELS)
                snapTurnAccumulated = remainder
                if (steps) camGoal.yaw -= steps * SNAP_TURN
                return
            }
            const yaw = -dx * 0.006
            cam.yaw += yaw
            camGoal.yaw += yaw
            const pitch = Math.max(0.35, Math.min(1.35, camGoal.pitch + dy * 0.004))
            cam.pitch += pitch - camGoal.pitch
            camGoal.pitch = pitch
            return
        }
        if (dragMode === 'pan') {
            if (moved > 4) isPanning.value = true
            const g = groundDelta(dx, dy)
            cam.tx += g.x
            cam.tz += g.z
            camGoal.tx += g.x
            camGoal.tz += g.z
            return
        }
        if (dragMode === 'paint') {
            const to = tileUnder(pick(p.x, p.y))
            if (to) {
                const tiles = paintLine(to)
                setPaintTiles(tiles)
                setHoverTile(to)
                placeGhostAt(to.wx, to.wy, true)
            }
            return
        }
        if (dragMode === 'marquee') {
            // A band only opens once the pointer has really moved, so a click
            // that wobbles a pixel does not flash a box.
            if (moved > 4) {
                showMarquee(marqueeStart.x, marqueeStart.y, p.x, p.y)
                marqueeIds.clear()
                for (const id of buildingsInBox(marqueeStart.x, marqueeStart.y, p.x, p.y)) marqueeIds.add(id)
            }
            return
        }
        if (dragMode === 'carry') {
            updateHover(p.x, p.y)
            return
        }
        return
    }
    updateHover(p.x, p.y)
}

function onPointerUp(e: PointerEvent) {
    const p = local(e)
    pointers.delete(e.pointerId)
    const mode = dragMode
    const wasClick = mode !== 'none' && mode !== 'orbit' && pointers.size === 0 && (moved <= 4 || mode === 'carry') && e.button === 0
    dragMode = 'none'
    isPanning.value = false
    pinch = 0

    // A right-click that never turned the view is a tap: it puts down whatever
    // the cursor holds, like Escape.
    if (mode === 'orbit' && e.button === 2 && moved <= 4 && pointers.size === 0) { emit('deselect'); return }

    if (mode === 'marquee') {
        hideMarquee()
        const ids = buildingsInBox(marqueeStart.x, marqueeStart.y, p.x, p.y)
        marqueeIds.clear()
        // Shift or ctrl held: the band adds to what is already selected.
        if (moved > 4) { emit('select-many', ids, e.shiftKey || e.ctrlKey || e.metaKey ? 'add' : 'replace'); return }
        // A band that never opened is a click. With shift down it toggles the
        // one building under it; otherwise it is the ordinary click below.
        if (e.shiftKey) {
            const hit = pick(p.x, p.y)
            if (hit?.kind === 'building') emit('select-many', [hit.id], 'toggle')
            return
        }
    }
    if (mode === 'paint') {
        const tiles = paintTiles
        const startedOn = paintStartBuilding
        endPaint()
        // One tile and no movement is an ordinary click: keep the old path, which
        // is what auto-facing and a single relocation both hang off — and a click
        // on a building still opens its card, brush or no brush.
        if (tiles.length > 1) { emit('place-line', tiles); return }
        if (startedOn) { emit('select-building', startedOn); return }
        if (tiles.length === 1) { emit('select-tile', tiles[0]!); return }
    }
    if (!wasClick) return

    const hit = pick(p.x, p.y)
    if (!hit) { emit('deselect'); return }
    // While a block is on the cursor every click is a drop attempt, even one that
    // lands on a building — otherwise it would quietly open that building's card
    // with the selection still stuck to the pointer.
    if (props.moveGhosts?.length && hit.kind === 'building') {
        const e = entries.get(hit.id)
        if (e) emit('select-tile', { plotId: e.data.plotId, tileX: e.data.tileX, tileY: e.data.tileY })
        return
    }
    if (hit.kind === 'building') emit('select-building', hit.id)
    else if (hit.kind === 'tile') {
        if (tileOccupied(hit.tile) && !ghost && !props.moveGhosts?.length) return
        emit('select-tile', hit.tile)
    } else if (hit.kind === 'expansion') {
        if (hit.free) emit('select-expansion', { x: hit.x, y: hit.y })
    } else if (hit.kind === 'listing') {
        emit('select-listing', hit.listing)
    }
}

function onPointerCancel(e: PointerEvent) {
    pointers.delete(e.pointerId)
    if (dragMode === 'paint') endPaint()
    if (dragMode === 'marquee') { hideMarquee(); marqueeIds.clear() }
    dragMode = 'none'
    isPanning.value = false
}

/**
 * Multiply the camera distance. A pinch is a hand on the screen, so it moves
 * the view directly like a drag; the wheel eases in.
 */
function zoomBy(factor: number, direct: boolean) {
    const next = Math.max(MIN_DIST, Math.min(MAX_DIST, camGoal.dist * factor))
    if (direct) cam.dist += next - camGoal.dist
    camGoal.dist = next
}

function onWheel(e: WheelEvent) {
    e.preventDefault()
    zoomBy(townWheelZoomFactor(e.deltaY, e.deltaMode), false)
}

function onLeave() {
    setHoverBuilding(null)
    setHoverSlot(null)
    setHoverNeighbour(null)
    setHoverTile(null)
    hoverTile.visible = false
    hideGhost()
    hideMoveGhosts()
    if (dragMode === 'none') hidePads()
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

    // A selection on the cursor owns the pointer: the whole block follows the
    // tile under it, and nothing else is hoverable until it is put down.
    if (props.moveGhosts?.length) {
        setHoverBuilding(null)
        setHoverSlot(null)
        hoverTile.visible = false
        const target = tileUnder(hit)
        if (target) {
            setHoverTile(target)
            placeMoveGhostsAt(target.wx, target.wy)
            canvas.value!.style.cursor = props.moveIssue ? 'not-allowed' : 'move'
        } else {
            setHoverTile(null)
            hideMoveGhosts()
            canvas.value!.style.cursor = 'default'
        }
        return
    }

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
        const target = tileUnder(hit)
        if (target) {
            setHoverBuilding(null)
            setHoverSlot(null)
            setHoverTile(target)
            hoverTile.visible = false
            placeGhostAt(target.wx, target.wy)
            if (ghostRadiusMesh) {
                ghostRadiusMesh.visible = true
                ghostRadiusMesh.position.set(target.wx + 0.5, 0.335, target.wy + 0.5)
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
    canvas.value!.style.cursor = 'default'
}

// ─── Frame loop ──────────────────────────────────────────────────────────────

let rafId = 0
let lastMs = 0
let running = true
let visible = true

/** True while the view is settling or the player is driving it — worth 60fps. */
function cameraBusy() {
    return dragMode !== 'none' || pointers.size > 0 || movementKeys.size > 0
        || Math.abs(camGoal.tx - cam.tx) > 0.01 || Math.abs(camGoal.tz - cam.tz) > 0.01
        || Math.abs(camGoal.yaw - cam.yaw) > 0.0005 || Math.abs(camGoal.pitch - cam.pitch) > 0.0005
        || Math.abs(camGoal.dist - cam.dist) > 0.01
}

let lastOverlayMs = 0

function frame(ms: number) {
    rafId = requestAnimationFrame(frame)
    if (!running || !visible || !renderer || document.hidden) { lastMs = ms; return }

    // Cap the frame rate: a resting town does not need 60 redraws a second.
    const streaming = ownWaterPending || neighbourQueue.length > 0 || neighboursGrowing > 0
    const budget = cameraBusy() || ghostBusy() || streaming || ms < landUntil ? ACTIVE_FRAME_MS : IDLE_FRAME_MS
    if (lastMs !== 0 && ms - lastMs < budget) return
    const dt = lastMs === 0 ? 0 : Math.min(0.1, (ms - lastMs) / 1000)
    lastMs = ms

    moveCamera(dt)
    const still = props.reducedMotion
    if (!still) animateTownWater(ms / 1000)

    // Camera easing — a cut, not a glide, for reduced motion.
    syncCameraKind()
    const k = still ? 1 : 1 - Math.pow(0.001, dt)
    cam.tx += (camGoal.tx - cam.tx) * k
    cam.tz += (camGoal.tz - cam.tz) * k
    cam.yaw += (camGoal.yaw - cam.yaw) * k
    cam.pitch += (camGoal.pitch - cam.pitch) * k
    cam.dist += (camGoal.dist - cam.dist) * k
    applyCamera()

    const now = Date.now() + props.serverOffsetMs

    // A neighbour's site finished: redraw that plot without waiting for the world refresh.
    if (now >= neighbourRecheckAt) syncNeighbours()
    pumpNeighbours(ms)
    growNeighbours(ms)

    let shapesChanged = false
    const rushOn = !!props.boosts?.build && props.boosts.build > now
    const surgeOn = !!props.boosts?.production && props.boosts.production > now
    beginBoostFx(ms)
    for (const e of entries.values()) {
        const b = e.data
        const pending = isPending(b, now)
        syncModelAppearance(e, displayedLevel(b, now))
        if (e.wasPending && !pending) {
            e.popAt = ms
            e.wasPending = false
            if (e.scaffold) dropScaffold(e)
            markShadowsDirty()
        }
        const def = e.def
        const staffed = (b.staffing ?? 0) > 0 && !pending && b.level > 0

        // Grow out of the ground while building; pop on completion; hover lift.
        let sy = levelScale(b.level)
        if (pending) {
            const progress = townJobProgress(b.completesAt, b.jobMs ?? townLevelBuildMs(def, b.upgradingTo ?? 1), now, props.boosts?.build)
            sy = (b.level === 0 ? 0.15 : levelScale(b.level)) + progress * (levelScale(b.upgradingTo ?? 1) - (b.level === 0 ? 0.15 : levelScale(b.level))) * 0.9
            if (Math.random() < dt * 1.5 * (rushOn ? 3 : 1)) spawn(new THREE.Vector3(e.group.position.x + (Math.random() - 0.5) * 0.6, 0.35, e.group.position.z + (Math.random() - 0.5) * 0.6), 'dust')
            if (rushOn && def.kind !== 'road') rushSite(e, dt, still)
        }
        let pop = 0
        if (e.popAt && still) e.popAt = 0
        if (e.popAt) {
            const t = (ms - e.popAt) / 500
            if (t >= 1) {
                e.popAt = 0
            } else {
                pop = Math.sin(t * Math.PI) * (1 - t) * 0.35
                if (t < 0.1 && Math.random() < 0.6) spawn(new THREE.Vector3(e.group.position.x, 0.8, e.group.position.z), 'spark')
            }
        }
        // Landing thunk on the whole group, so a fresh site's scaffold lands too:
        // fall the last bit wide, squash on impact, spring back.
        let dropY = 0
        if (e.landAt && still) { e.landAt = 0; e.group.scale.setScalar(1) }
        if (e.landAt) {
            const t = Math.max(0, (ms - e.landAt) / LAND_MS)
            if (t >= 1) {
                e.landAt = 0
                e.group.scale.setScalar(1)
                markShadowsDirty()
            } else if (t < LAND_DROP) {
                const u = t / LAND_DROP
                dropY = (1 - u * u) * 0.35
                e.group.scale.set(1.06, 1, 1.06)
            } else {
                if (!e.landDusted) {
                    e.landDusted = true
                    const size = townBuildingSize(b.type)
                    kickDust(e.group.position.x, e.group.position.z, size, Math.min(10, 6 + size * 2), 0.8)
                }
                const u = (t - LAND_DROP) / (1 - LAND_DROP)
                const squash = Math.cos(u * Math.PI * 2.5) * (1 - u) * (1 - u)
                e.group.scale.set(1 + squash * 0.12, 1 - squash * 0.2, 1 + squash * 0.12)
            }
        }
        if (pending || e.popAt || e.landAt) shapesChanged = true
        const hovered = hoveredBuildingId === b.id
        if (def.kind === 'road') {
            e.group.position.y = e.baseY
            continue
        }
        const sxz = levelScale(Math.max(b.level, pending ? 0 : 1)) + pop
        e.model.scale.set(sxz, sy + pop, sxz)
        e.group.position.y = e.baseY + (hovered ? 0.06 : 0) + dropY

        if (surgeOn && staffed && def.kind === 'industry') surgeSite(e, dt)

        // Animation hooks.
        if (staffed) {
            for (const o of e.spin) spinPart(o, dt * props.speedMultiplier)
            if (e.smoke.length && Math.random() < dt * 1.4 * props.speedMultiplier) {
                const anchor = e.smoke[Math.floor(Math.random() * e.smoke.length)]!
                anchor.getWorldPosition(tmp)
                spawn(tmp.clone(), 'smoke')
            }
            if (b.type === 'smithy' && Math.random() < dt * 2) {
                spawn(new THREE.Vector3(e.group.position.x, 0.4, e.group.position.z), 'spark')
            }
            if (b.type === 'gemmine' && Math.random() < dt * 1.5) {
                spawn(new THREE.Vector3(e.group.position.x + (Math.random() - 0.5) * 0.7, 0.3 + Math.random() * 0.3, e.group.position.z + (Math.random() - 0.5) * 0.7), 'spark')
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
            m.emissiveIntensity = staffed || def.kind === 'housing' ? 1.1 + (still ? 0 : Math.sin(ms / 400 + e.group.position.x) * 0.3) : 0.15
        }
    }

    // Neighbours run at the realm's pace, not this town's mood.
    for (const n of neighbourAnims) {
        for (const o of n.spin) spinPart(o, dt)
        if (n.smoke.length && Math.random() < dt * 1.4 && Math.hypot(n.x - cam.tx, n.z - cam.tz) < NEIGHBOUR_FX_RANGE) {
            const anchor = n.smoke[Math.floor(Math.random() * n.smoke.length)]!
            anchor.getWorldPosition(tmp)
            spawn(tmp.clone(), 'smoke')
        }
        for (const g of n.glow) {
            (g.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.1 + (still ? 0 : Math.sin(ms / 400 + n.x) * 0.3)
        }
    }

    endBoostFx(ms, still)
    syncSelectionRings()

    // Selection ring.
    const sel = props.selectedBuildingId ? entries.get(props.selectedBuildingId) : null
    if (sel) {
        ring.visible = true
        ring.position.set(sel.group.position.x, 0.32, sel.group.position.z)
        const s = (still ? 1 : 1 + Math.sin(ms / 300) * 0.05) * townBuildingSize(sel.data.type)
        ring.scale.set(s, s, s)
    } else {
        ring.visible = false
    }

    if (!still) {
        for (const c of clouds) {
            c.position.x += (c.userData.drift as number) * dt
            if (c.position.x > 120) c.position.x = -120
        }
    }

    stepGhosts(dt, ms)
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
    framesDrawn++
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function resize() {
    if (!renderer || !wrap.value) return
    const r = wrap.value.getBoundingClientRect()
    viewW = Math.max(1, Math.round(r.width))
    viewH = Math.max(1, Math.round(r.height))
    renderer.setSize(viewW, viewH, false)
    perspectiveCamera.aspect = viewW / viewH
    perspectiveCamera.updateProjectionMatrix()
    orthoFramedAt.aspect = 0
    frameOrthographic()
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
    // Painted from the frame loop, after the first frame (see syncOwnWater).
    ownWaterPending = true
    rebuildTerrainOverlay()
    rebuildExpansions()
    // Only queued: the frame loop draws them once the town is on screen.
    syncNeighbours()
    rebuildDecor()
    landChanged()
    ownLandKey = ownLandSig()
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
    disposeMoveGhosts()
    hideMarquee()
    selectionRingGeo.dispose()
    selectionRingMat.dispose()
    padGeo.dispose()
    padOkMat.dispose()
    padBadMat.dispose()
    clearLandscape(decorGroup)
    disposeTerrainOverlay(terrainGroup)
    for (const sheet of ownWater.values()) disposeWaterLayer(sheet)
    ownWater.clear()
    disposeNeighbours()
    disposeBoostFx()
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
 * Now the decor is rebuilt only when the footprint it is drawn around has
 * actually moved (for neighbour land, from the frame loop: see pumpNeighbours).
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

/**
 * The player's own land. The props are replaced on every poll, so compare a
 * signature and rebuild only when a plot or an expansion slot really changed —
 * the water sheets alone used to cost a repaint and a texture upload per plot
 * every thirty seconds.
 */
let ownLandKey = ''
function ownLandSig() {
    return props.plots.map(p => `${p.id}@${p.x},${p.y}`).join('|') + '#' + props.expansions.map(e => `${e.x},${e.y},${e.free ? 1 : 0}`).join('|')
}
watch(() => [props.plots, props.expansions], () => {
    const key = ownLandSig()
    if (key === ownLandKey) return
    ownLandKey = key
    invalidateTileCaches()
    rebuildPlots()
    ownWaterPending = !syncOwnWater(NEIGHBOUR_BUILD_BUDGET_MS)
    rebuildTerrainOverlay()
    rebuildExpansions()
    if (landChanged()) rebuildDecor()
    syncBuildings()
    syncVehicles()
    markShadowsDirty()
})
// The neighbours stream in from the frame loop; see pumpNeighbours.
watch(() => props.neighbours, () => {
    syncNeighbours()
    if (landChanged()) neighbourDecorPending = true
})
watch(() => [props.terrainOverlay, props.ghostType], rebuildTerrainOverlay)
watch(() => props.buildings, () => { invalidateTileCaches(); syncBuildings(); syncVehicles(); markShadowsDirty() }, { deep: true })
watch(() => [props.ghostType, props.ghostLevel], rebuildGhost)
watch(() => props.keyboardEnabled, clearMovement)
watch(() => props.ghostRotation, () => {
    // A visible ghost turns in the frame loop; a hidden one just faces the new way.
    if (ghost && (!ghost.visible || props.reducedMotion)) { ghostYaw = ghostYawGoal(); ghost.rotation.y = ghostYaw }
    if (ghost?.visible && ghostCursor) placeGhostAt(ghostCursor.x, ghostCursor.z)
})
watch(() => props.ghostIssue, () => { if (ghost?.visible && ghostCursor) placeGhostAt(ghostCursor.x, ghostCursor.z) })
watch(() => props.movingId, () => { for (const e of entries.values()) e.group.visible = !isBeingMoved(e.data.id) })
watch(() => props.moveGhosts, () => {
    if (!props.moveGhosts?.length) moveGhostAnchor = null
    rebuildMoveGhosts()
    for (const e of entries.values()) e.group.visible = !isBeingMoved(e.data.id)
    if (!props.moveGhosts?.length) hidePads()
    markShadowsDirty()
}, { deep: true })
watch(() => props.moveIssue, () => tintMoveGhosts(!props.moveIssue))
watch(() => props.dragValid, () => {
    if (!paintTiles.length) return
    showPads(paintTiles, i => props.dragValid[i] !== false)
    if (ghost?.visible) tintGhost(props.dragValid[paintTiles.length - 1] !== false)
})
watch(() => props.ghostRadius, rebuildGhostRadius, { deep: true })
watch(() => props.effectRadii, syncRadii, { deep: true })
watch(() => props.plots.length, (n, prev) => { if (n !== prev) recenter(true) })

defineExpose({ recenter: () => recenter(true), setResourceEmoji: (map: Record<string, string>) => Object.assign(RESOURCE_EMOJI, map), denyGhost })
</script>

<template>
    <div ref="wrap" class="relative h-full w-full overflow-hidden select-none">
        <canvas
            ref="canvas"
            tabindex="0"
            aria-label="Town view. WASD to move, Q and E to turn, drag to select, middle-drag to pan, right-drag to orbit, scroll to zoom."
            class="block h-full w-full touch-none outline-none"
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
.town-overlay :deep(.town-marquee) {
    position: absolute;
    left: 0;
    top: 0;
    border: 1.5px solid rgba(111, 211, 255, 0.95);
    background: rgba(111, 211, 255, 0.16);
    border-radius: 4px;
    will-change: transform, width, height;
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
