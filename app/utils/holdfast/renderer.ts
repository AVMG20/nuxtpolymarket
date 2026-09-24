// Holdfast — three.js view of a HoldfastSim. The sim is the truth; this file
// only reads it, interpolates between ticks and adds juice. Units, walls,
// arrows, bars and ghosts are all instanced, so a 400-soldier brawl is still
// a handful of draw calls.

import * as THREE from 'three'
import { BUILDINGS, EDGE_MARGIN, MAP_SIZE, TICK, type BuildingKind, type UnitKind } from '#shared/utils/holdfast/config'
import { Terrain } from '#shared/utils/holdfast/grid'
import { ENEMY, PLAYER, WALL_HEIGHT, type Building, type HoldfastSim, type SimEvent, type Unit } from '#shared/utils/holdfast/sim'
import { CameraRig } from './camera'
import { Particles, RingFx } from './fx'
import { HoldfastPost } from './post'
import { GrassField } from './grass'
import { LanePaths } from './lane-paths'
import { Volleys } from './volley'
import { Remains } from './remains'
import { ISLAND_MARGIN, buildIsland, buildSea, paintGround } from './terrain-art'
import { WALL_PIECES, wallGhostGeometry, wallKit, type WallPiece } from './wall-kit'
import {
    DECOR_VARIANTS,
    ROCK_VARIANTS,
    TREE_VARIANTS,
    UNIT_ANCHORS,
    UNIT_PARTS,
    arrowGeometry,
    blobGeometry,
    buildingGeometry,
    crystalGeometry,
    debrisGeometry,
    decorGeometry,
    flagGeometry,
    ringGeometry,
    rockGeometry,
    treeGeometry
} from './models'

export const TEAM_COLOR = { [PLAYER]: 0x4f8df5, [ENEMY]: 0xe0524a } as const
const HELMET_COLOR = { [PLAYER]: 0xe8eef5, [ENEMY]: 0x6b5a5a } as const
const GHOST_OK = 0x5eea9a
const GHOST_BAD = 0xf87171
const GHOST_WARN = 0xfbbf24
const MOVE_COLOR = 0x7dd3fc
const SKY = new THREE.Color(0xbfe4f7)
const SKY_MOON = new THREE.Color(0x4a1d2a)

const MAX_UNITS = 900
const MAX_ARROWS = 700
const MAX_BARS = 700
const MAX_SEGMENTS = 1200
const MAX_GHOST = 160
const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
/** Where the keep model's roof pole is, per keep level. */
const KEEP_FLAG_Y = [4.44, 4.99, 5.55]
/** Soldiers are drawn a touch larger than their collision size for readability. */
const UNIT_SCALE = 1.3

export type GhostMode = 'none' | 'building' | 'walls' | 'deploy' | 'move'

export interface Ghost {
    mode: GhostMode
    ok: boolean
    buildingKind?: BuildingKind
    unitKind?: UnitKind
    /** Building footprint anchor. */
    cx?: number
    cz?: number
    /** Wall line cells and per-cell validity (true / false / 'poor' for unaffordable). */
    cells?: readonly number[]
    valid?: readonly (boolean | 'poor')[]
    slots?: readonly { x: number, z: number }[]
    /** Range ring radius around the ghost (towers). */
    range?: number
}

export type Selection
    = | { type: 'pack', id: number }
      | { type: 'building', id: number }
      | null

interface BuildingView {
    mesh: THREE.Mesh
    kind: BuildingKind
    level: number
    born: number
    wobble: number
    height: number
    extra: THREE.Object3D | null
    lastSmoke: number
}

interface UnitView {
    phase: number
    y: number
    seen: number
}

const m4 = new THREE.Matrix4()
const m4b = new THREE.Matrix4()
const m4c = new THREE.Matrix4()
const q = new THREE.Quaternion()
const q2 = new THREE.Quaternion()
const e = new THREE.Euler()
const v = new THREE.Vector3()
const v2 = new THREE.Vector3()
const s3 = new THREE.Vector3()
const col = new THREE.Color()
const col2 = new THREE.Color()
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const WHITE = new THREE.Color(1, 1, 1)

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, max: number, colored = true): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, max)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    if (colored) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3)
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    }
    mesh.frustumCulled = false
    mesh.count = 0
    return mesh
}

/** Territory ring + build grid, drawn in one shader on a ground plane. */
function territoryMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
            uCenter: { value: new THREE.Vector2() },
            uRadius: { value: 10 },
            uRing: { value: 0.25 },
            uGrid: { value: 0 },
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(0xffffff) },
            uBuildMin: { value: new THREE.Vector2(EDGE_MARGIN, EDGE_MARGIN) },
            uBuildMax: { value: new THREE.Vector2(MAP_SIZE - EDGE_MARGIN, MAP_SIZE - EDGE_MARGIN) }
        },
        vertexShader: `
            varying vec2 vWorld;
            void main() {
                vec4 w = modelMatrix * vec4(position, 1.0);
                vWorld = w.xz;
                gl_Position = projectionMatrix * viewMatrix * w;
            }
        `,
        fragmentShader: `
            uniform vec2 uCenter;
            uniform float uRadius;
            uniform float uRing;
            uniform float uGrid;
            uniform float uTime;
            uniform vec3 uColor;
            uniform vec2 uBuildMin;
            uniform vec2 uBuildMax;
            varying vec2 vWorld;
            void main() {
                float d = length(vWorld - uCenter);
                // The strip along the map edge can't be built on: hatch it red.
                float inRect = step(uBuildMin.x, vWorld.x) * step(uBuildMin.y, vWorld.y) * step(vWorld.x, uBuildMax.x) * step(vWorld.y, uBuildMax.y);
                // Soft dashed boundary ring.
                float edge = 1.0 - smoothstep(0.0, 0.14, abs(d - uRadius));
                float ang = atan(vWorld.y - uCenter.y, vWorld.x - uCenter.x);
                float dash = step(0.35, fract(ang * uRadius / 6.2831 * 1.2 - uTime * 0.15));
                float ring = edge * mix(0.55, 1.0, dash) * uRing;
                // Tile grid inside the territory while building.
                vec2 f = abs(fract(vWorld) - 0.5);
                float line = 1.0 - smoothstep(0.455, 0.49, max(f.x, f.y));
                line = 1.0 - line;
                float inside = 1.0 - smoothstep(uRadius - 0.6, uRadius, d);
                float grid = line * inside * inRect * uGrid * 0.22;
                float glow = inside * inRect * uGrid * 0.05;
                float stripe = step(0.5, fract((vWorld.x + vWorld.y) * 1.5));
                float blocked = inside * (1.0 - inRect) * uGrid * (0.1 + stripe * 0.14);
                float a = clamp(ring * 0.8 + grid + glow + blocked, 0.0, 1.0);
                if (a < 0.004) discard;
                vec3 c = mix(uColor, vec3(0.95, 0.3, 0.3), clamp(blocked * 6.0, 0.0, 1.0));
                gl_FragColor = vec4(c, a);
            }
        `
    })
}

export class HoldfastRenderer {
    readonly renderer: THREE.WebGLRenderer
    readonly scene = new THREE.Scene()
    readonly rig: CameraRig
    private container: HTMLElement
    private sim: HoldfastSim

    private readonly mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 })
    private readonly ghostMat = new THREE.MeshStandardMaterial({ color: GHOST_OK, transparent: true, opacity: 0.55, roughness: 0.6, emissive: 0x1a4d33, depthWrite: false })
    private readonly ghostInstMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.55, roughness: 0.6, depthWrite: false, emissive: 0x222222 })
    private readonly flatMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, vertexColors: false })
    private hemi!: THREE.HemisphereLight
    private sun!: THREE.DirectionalLight
    private territory!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>

    private buildings = new Map<number, BuildingView>()
    private wallPools: Record<WallPiece, THREE.InstancedMesh>[] = []
    private segmentsDirty = true
    private segmentTintAt = 0

    private parts!: {
        body: THREE.InstancedMesh
        trim: THREE.InstancedMesh
        head: THREE.InstancedMesh
        helmet: THREE.InstancedMesh
        hood: THREE.InstancedMesh
        sword: THREE.InstancedMesh
        shield: THREE.InstancedMesh
        emblem: THREE.InstancedMesh
        bow: THREE.InstancedMesh
        blob: THREE.InstancedMesh
    }

    private unitViews = new Map<number, UnitView>()
    private arrows!: THREE.InstancedMesh
    private barBg!: THREE.InstancedMesh
    private barFill!: THREE.InstancedMesh
    private selRings!: THREE.InstancedMesh

    private ghostBuilding!: THREE.Mesh
    private ghostTiles!: THREE.InstancedMesh
    private ghostWalls!: THREE.InstancedMesh
    private ghostGates!: THREE.InstancedMesh
    private ghostRings!: THREE.InstancedMesh
    private ghostBody!: THREE.InstancedMesh
    private ghostHead!: THREE.InstancedMesh
    private rangeRing!: THREE.Mesh
    /** Gold markers on every wall walkway while archers are being placed. */
    private wallSpots!: THREE.InstancedMesh
    private ghost: Ghost = { mode: 'none', ok: false }
    private ghostPos = new THREE.Vector3()
    private ghostSlots: { x: number, z: number }[] = []
    private ghostKey = ''

    private laneBeacons: { group: THREE.Group, column: THREE.Mesh, flag: THREE.Mesh, warn: number, shown: number }[] = []

    readonly particles: Particles
    /** Additive, glowing bits: sparks, embers, flames. */
    readonly glow: Particles
    private grass!: GrassField
    private grassDirty = false
    private volleys!: Volleys
    private arrowThick = 1
    readonly rings: RingFx
    readonly remains: Remains
    private readonly lanePaths: LanePaths
    /** Last drawn pose of every arrow in flight, so a landed arrow can stay stuck where it hit. */
    private arrowLast = new Map<number, { x: number, y: number, z: number, q: THREE.Quaternion, target: number, fire: boolean, thick: number, seen: number }>()
    private arrowFrame = 0
    selection: Selection = null
    hoverUnitPack = -1

    private clock = 0
    private moon = 0
    private pixelRatio = 1
    private maxPixelRatio = 1
    private slowFrames = 0
    private fastFrames = 0

    constructor(container: HTMLElement, sim: HoldfastSim) {
        this.container = container
        this.sim = sim
        const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
        // Never below native resolution; cap high-dpi screens at 2x.
        this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        this.pixelRatio = this.maxPixelRatio
        renderer.setPixelRatio(this.pixelRatio)
        renderer.shadowMap.enabled = true
        renderer.shadowMap.type = THREE.PCFShadowMap
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.05
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.domElement.style.display = 'block'
        renderer.domElement.style.touchAction = 'none'
        container.appendChild(renderer.domElement)
        this.renderer = renderer

        const pad = 4
        this.rig = new CameraRig({ minX: pad, maxX: MAP_SIZE - pad, minZ: pad, maxZ: MAP_SIZE - pad })
        const k = sim.keepCenter
        const lane = sim.difficulty.lanes[0]!
        const ld = Math.hypot(lane.x - k.x, lane.z - k.z) || 1
        this.rig.jumpTo(k.x + (lane.x - k.x) / ld * 5, k.z + (lane.z - k.z) / ld * 5, true)
        this.rig.goalDist = this.rig.dist = 34

        this.scene.background = SKY.clone()
        this.scene.fog = new THREE.Fog(SKY.clone(), 70, 170)

        this.particles = new Particles(debrisGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), 1800)
        this.rings = new RingFx(ringGeometry(), 80)
        this.glow = new Particles(debrisGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 1400)
        this.glow.mesh.renderOrder = 8
        this.scene.add(this.particles.mesh, this.rings.mesh, this.glow.mesh)

        this.post = new HoldfastPost(renderer, this.scene, this.rig.camera)
        this.buildLights()
        this.buildGround()
        this.buildNature()
        this.buildPools()
        this.grass = new GrassField(sim)
        this.scene.add(this.grass.mesh)
        this.volleys = new Volleys(arrowGeometry(), this.mat, (p, quat, fire) => this.remains.stickArrow(p, quat, fire, this.arrowThick))
        this.scene.add(this.volleys.arrows, this.volleys.trails)
        this.lanePaths = new LanePaths(sim)
        this.scene.add(this.lanePaths.mesh)
        this.remains = new Remains(this.scene, this.mat, { body: UNIT_PARTS.body, trim: UNIT_PARTS.bodyTrim, head: UNIT_PARTS.head, arrow: arrowGeometry() }, UNIT_SCALE)
        this.buildGhosts()
        this.buildLanes()
        this.resize()
    }

    // ─── Setup ───────────────────────────────────────────────────────────

    private buildLights(): void {
        this.hemi = new THREE.HemisphereLight(0xdff1ff, 0x5e7a3a, 1.35)
        this.scene.add(this.hemi)
        const sun = new THREE.DirectionalLight(0xfff1d6, 2.4)
        sun.position.set(MAP_SIZE / 2 + 34, 52, MAP_SIZE / 2 + 22)
        sun.target.position.set(MAP_SIZE / 2, 0, MAP_SIZE / 2)
        sun.castShadow = true
        sun.shadow.mapSize.set(2048, 2048)
        const s = sun.shadow.camera
        s.left = -30
        s.right = 30
        s.top = 30
        s.bottom = -30
        s.near = 5
        s.far = 130
        sun.shadow.bias = -0.0008
        sun.shadow.normalBias = 0.025
        sun.shadow.radius = 2.5
        this.scene.add(sun, sun.target)
        this.sun = sun
    }

    private sea!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>

    private buildGround(): void {
        const n = MAP_SIZE
        const canvas = paintGround(this.sim.grid, this.sim.seed)
        const tex = new THREE.CanvasTexture(canvas)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
        tex.generateMipmaps = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        this.scene.add(buildIsland(tex))
        this.sea = buildSea()
        this.scene.add(this.sea)

        this.territory = new THREE.Mesh(new THREE.PlaneGeometry(n, n).rotateX(-Math.PI / 2), territoryMaterial())
        this.territory.position.set(n / 2, 0.02, n / 2)
        this.territory.renderOrder = 1
        this.scene.add(this.territory)
    }

    private buildNature(): void {
        const grid = this.sim.grid
        const n = grid.size
        // Cosmetic scatter: seeded from the run seed so it stays put, but uses its own stream.
        let seed = this.sim.seed ^ 0x9e3779b9
        const rand = (): number => {
            seed = (seed + 0x6D2B79F5) >>> 0
            let t = seed
            t = Math.imul(t ^ (t >>> 15), t | 1)
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
        const trees: { x: number, z: number }[][] = Array.from({ length: TREE_VARIANTS }, () => [])
        const rocks: { x: number, z: number }[][] = Array.from({ length: ROCK_VARIANTS }, () => [])
        for (let cz = 0; cz < n; cz++) {
            for (let cx = 0; cx < n; cx++) {
                const t = grid.terrain[grid.idx(cx, cz)]
                if (t === Terrain.Tree) trees[Math.floor(rand() * TREE_VARIANTS)]!.push({ x: cx + 0.5 + (rand() - 0.5) * 0.3, z: cz + 0.5 + (rand() - 0.5) * 0.3 })
                if (t === Terrain.Rock) rocks[Math.floor(rand() * ROCK_VARIANTS)]!.push({ x: cx + 0.5, z: cz + 0.5 })
            }
        }
        // A dense forest rim outside the playable map frames the island.
        const m = ISLAND_MARGIN - 1.2
        for (let k = 0; k < 1500; k++) {
            const x = -m + rand() * (n + m * 2)
            const z = -m + rand() * (n + m * 2)
            if (x > -0.6 && x < n + 0.6 && z > -0.6 && z < n + 0.6) continue
            // Round the island corners like the cliff outline.
            const cx = Math.max(-m + 6, Math.min(n + m - 6, x))
            const cz = Math.max(-m + 6, Math.min(n + m - 6, z))
            if (Math.hypot(x - cx, z - cz) > 5.6) continue
            // Leave clearings where the raider lanes come out of the woods.
            if (this.sim.difficulty.lanes.some(l => Math.hypot(l.x + 0.5 - x, l.z + 0.5 - z) < 3.2)) continue
            trees[Math.floor(rand() * TREE_VARIANTS)]!.push({ x, z })
        }
        const place = (geo: THREE.BufferGeometry, list: { x: number, z: number }[], scale: [number, number], shadow: boolean): void => {
            if (list.length === 0) return
            const mesh = new THREE.InstancedMesh(geo, this.mat, list.length)
            list.forEach((p, i) => {
                const s = scale[0] + rand() * (scale[1] - scale[0])
                q.setFromEuler(e.set(0, rand() * Math.PI * 2, 0))
                m4.compose(v.set(p.x, 0, p.z), q, s3.set(s, s * (0.9 + rand() * 0.25), s))
                mesh.setMatrixAt(i, m4)
            })
            mesh.castShadow = shadow
            mesh.receiveShadow = true
            this.scene.add(mesh)
        }
        trees.forEach((list, k) => place(treeGeometry(k), list, [0.85, 1.2], true))
        rocks.forEach((list, k) => place(rockGeometry(k), list, [0.85, 1.15], true))

        // Grass tufts, flowers and pebbles on open ground.
        const decor: { x: number, z: number }[][] = Array.from({ length: DECOR_VARIANTS }, () => [])
        for (let k = 0; k < 650; k++) {
            const x = rand() * n
            const z = rand() * n
            const i = grid.cellAt(x, z)
            if (i < 0 || grid.terrain[i] !== Terrain.Grass) continue
            const r = rand()
            const variant = r < 0.62 ? 0 : r < 0.84 ? 1 : r < 0.95 ? 2 : 3
            decor[Math.min(DECOR_VARIANTS - 1, variant)]!.push({ x, z })
        }
        const flowerColors = [0xfff3a3, 0xffb3d1, 0xffffff, 0xc4b5fd, 0xfda4af]
        decor.forEach((list, k) => {
            if (list.length === 0) return
            const mesh = new THREE.InstancedMesh(decorGeometry(k), this.mat, list.length)
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3).fill(1), 3)
            list.forEach((p, i) => {
                const s = 1.2 + rand() * 0.7
                q.setFromEuler(e.set(0, rand() * Math.PI * 2, 0))
                m4.compose(v.set(p.x, 0, p.z), q, s3.set(s, s, s))
                mesh.setMatrixAt(i, m4)
                if (k === 1) mesh.setColorAt(i, col.setHex(flowerColors[Math.floor(rand() * flowerColors.length)]!))
            })
            mesh.receiveShadow = true
            this.scene.add(mesh)
        })
    }

    private buildPools(): void {
        // Instances per wall piece and tier; arms, flats and towers scale with segments.
        const wallMax: Record<WallPiece, number> = {
            hub: MAX_SEGMENTS,
            armPlus: MAX_SEGMENTS * 2,
            armMinus: MAX_SEGMENTS * 2,
            diagPlus: MAX_SEGMENTS,
            diagMinus: MAX_SEGMENTS,
            hubFlat: MAX_SEGMENTS * 2,
            tower: MAX_SEGMENTS / 2,
            towerFlat: MAX_SEGMENTS * 3,
            stair: MAX_SEGMENTS / 4,
            gate: 240,
            gateTower: 240
        }
        for (let tier = 1; tier <= 3; tier++) {
            const kit = wallKit(tier)
            const pool = {} as Record<WallPiece, THREE.InstancedMesh>
            for (const piece of WALL_PIECES) {
                const mesh = instanced(kit[piece], this.mat, wallMax[piece])
                mesh.castShadow = true
                mesh.receiveShadow = true
                mesh.visible = false
                this.scene.add(mesh)
                pool[piece] = mesh
            }
            this.wallPools.push(pool)
        }
        const P = UNIT_PARTS
        this.parts = {
            body: instanced(P.body, this.mat, MAX_UNITS),
            trim: instanced(P.bodyTrim, this.mat, MAX_UNITS),
            head: instanced(P.head, this.mat, MAX_UNITS),
            helmet: instanced(P.helmet, this.mat, MAX_UNITS),
            hood: instanced(P.hood, this.mat, MAX_UNITS),
            sword: instanced(P.sword, this.mat, MAX_UNITS),
            shield: instanced(P.shield, this.mat, MAX_UNITS),
            emblem: instanced(P.shieldEmblem, this.mat, MAX_UNITS),
            bow: instanced(P.bow, this.mat, MAX_UNITS),
            blob: instanced(blobGeometry(), new THREE.MeshBasicMaterial({ color: 0x1c2a14, transparent: true, opacity: 0.28, depthWrite: false }), MAX_UNITS, false)
        }
        this.parts.blob.renderOrder = 1
        for (const mesh of Object.values(this.parts)) this.scene.add(mesh)

        this.arrows = instanced(arrowGeometry(), this.mat, MAX_ARROWS)
        this.scene.add(this.arrows)

        const bar = new THREE.PlaneGeometry(1, 1)
        this.barBg = instanced(bar, new THREE.MeshBasicMaterial({ color: 0x1b1b24, transparent: true, opacity: 0.75, depthTest: false }), MAX_BARS, false)
        this.barFill = instanced(bar, new THREE.MeshBasicMaterial({ depthTest: false }), MAX_BARS)
        this.barBg.renderOrder = 10
        this.barFill.renderOrder = 11
        this.scene.add(this.barBg, this.barFill)

        this.selRings = instanced(ringGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }), 200)
        this.selRings.renderOrder = 3
        this.scene.add(this.selRings)
    }

    private buildGhosts(): void {
        this.ghostBuilding = new THREE.Mesh(buildingGeometry('goldmine', 1), this.ghostMat)
        this.ghostBuilding.visible = false
        this.ghostBuilding.renderOrder = 5
        const tile = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2)
        this.ghostTiles = instanced(tile, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false }), 200)
        this.ghostTiles.renderOrder = 4
        this.ghostWalls = instanced(wallGhostGeometry(), this.ghostInstMat, MAX_GHOST)
        this.ghostGates = instanced(wallKit(2).gate, this.ghostInstMat, MAX_GHOST)
        this.ghostRings = instanced(ringGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }), 64)
        this.ghostRings.renderOrder = 4
        this.ghostBody = instanced(UNIT_PARTS.body, this.ghostInstMat, 64)
        this.ghostHead = instanced(UNIT_PARTS.head, this.ghostInstMat, 64)
        this.rangeRing = new THREE.Mesh(
            new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false })
        )
        this.rangeRing.visible = false
        this.rangeRing.renderOrder = 4
        this.wallSpots = instanced(ringGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }), 600)
        this.wallSpots.renderOrder = 4
        this.scene.add(this.wallSpots)
        this.scene.add(this.ghostBuilding, this.ghostTiles, this.ghostWalls, this.ghostGates, this.ghostRings, this.ghostBody, this.ghostHead, this.rangeRing)
    }

    private buildLanes(): void {
        const columnGeo = new THREE.CylinderGeometry(0.9, 1.3, 14, 20, 1, true)
        columnGeo.translate(0, 7, 0)
        for (const lane of this.sim.difficulty.lanes) {
            const group = new THREE.Group()
            group.position.set(lane.x + 0.5, 0, lane.z + 0.5)
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.9 }))
            pole.position.y = 1.1
            pole.castShadow = true
            const flag = new THREE.Mesh(flagGeometry(), new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.8, side: THREE.DoubleSide }))
            flag.position.y = 2
            flag.scale.setScalar(1.4)
            const column = new THREE.Mesh(columnGeo, new THREE.MeshBasicMaterial({
                color: 0xff3b3b,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide
            }))
            column.renderOrder = 6
            group.add(pole, flag, column)
            group.visible = false
            group.scale.setScalar(0.001)
            this.scene.add(group)
            this.laneBeacons.push({ group, column, flag, warn: 0, shown: 0 })
        }
    }

    // ─── Public API ──────────────────────────────────────────────────────

    resize = (): void => {
        const w = this.container.clientWidth
        const h = this.container.clientHeight
        this.renderer.setSize(w, h)
        this.post.setSize(w, h, this.pixelRatio)
        this.rig.setAspect(w / Math.max(1, h))
    }

    setGhost(g: Ghost): void {
        this.ghost = g
    }

    /** Screen position (css px) of a world point, and whether it's on screen. */
    project(x: number, y: number, z: number): { x: number, y: number, visible: boolean } {
        v.set(x, y, z).project(this.rig.camera)
        const w = this.container.clientWidth
        const h = this.container.clientHeight
        return {
            x: (v.x * 0.5 + 0.5) * w,
            y: (-v.y * 0.5 + 0.5) * h,
            visible: v.z < 1 && Math.abs(v.x) <= 1.02 && Math.abs(v.y) <= 1.02
        }
    }

    /** Ground point under css pixel coordinates. */
    groundAt(px: number, py: number, out: THREE.Vector3, height = 0): THREE.Vector3 | null {
        const rect = this.renderer.domElement.getBoundingClientRect()
        const nx = ((px - rect.left) / rect.width) * 2 - 1
        const ny = -((py - rect.top) / rect.height) * 2 + 1
        return this.rig.groundAt(nx, ny, out, height)
    }

    /** The four ground corners of the view, for the minimap. */
    viewCorners(): { x: number, z: number }[] {
        const out: { x: number, z: number }[] = []
        for (const [x, y] of [[-1, 1], [1, 1], [1, -1], [-1, -1]] as const) {
            const p = this.rig.groundAt(x, y, v2)
            if (p) out.push({ x: p.x, z: p.z })
        }
        return out
    }

    handleEvents(events: readonly SimEvent[]): void {
        for (const ev of events) {
            switch (ev.type) {
                case 'hit':
                    if (ev.melee) {
                        // Steel on steel: a bright spray of sparks.
                        this.glow.burst(ev.x, 0.55, ev.z, { color: 0xffd27a, count: 4, speed: 2.6, up: 2.2, size: 0.035, life: 0.28, gravity: 9, spread: 0.2 })
                        this.particles.burst(ev.x, 0.1, ev.z, { color: 0xcbb690, count: 1, speed: 0.6, up: 0.6, size: 0.07, life: 0.4, gravity: 1 })
                    } else {
                        this.particles.burst(ev.x, 0.5, ev.z, { color: 0xd6c3a0, count: 2, speed: 1.2, up: 1.2, size: 0.04, life: 0.3 })
                    }
                    break
                case 'death': {
                    const y = ev.elevated ? WALL_HEIGHT : 0
                    // The soldier topples; a puff of dust and their helmet or hood bounces off.
                    this.remains.addCorpse(ev.x, y, ev.z, TEAM_COLOR[ev.side])
                    this.particles.burst(ev.x, y + 0.1, ev.z, { color: 0xd8ccb4, count: 4, speed: 0.9, up: 0.8, size: 0.1, life: 0.6, gravity: 0.5, spread: 0.3 })
                    this.particles.burst(ev.x, y + 0.7, ev.z, { color: ev.kind === 'warrior' ? HELMET_COLOR[ev.side] : TEAM_COLOR[ev.side], count: 1, speed: 1.6, up: 3, size: 0.12, life: 1.1 })
                    break
                }
                case 'building-hit': {
                    const view = this.buildings.get(ev.id)
                    if (view) view.wobble = 1
                    const b = this.sim.building(ev.id)
                    if (b && Math.random() < 0.35) {
                        const bx = b.cx + b.size / 2 + (Math.random() - 0.5) * b.size * 0.7
                        const bz = b.cz + b.size / 2 + (Math.random() - 0.5) * b.size * 0.7
                        this.particles.burst(bx, 0.6, bz, { color: b.kind === 'wall' && b.level === 1 ? 0xa0764a : 0xb8b2a6, count: 2, speed: 1.2, up: 1.8, size: 0.07, life: 0.5 })
                    }
                    break
                }
                case 'building-destroyed': {
                    this.grassDirty = true
                    this.glow.burst(ev.cx + ev.size / 2, 0.8, ev.cz + ev.size / 2, { color: 0xff9a3c, count: 10 + ev.size * 6, speed: 2.8, up: 5, size: 0.05, life: 1.4, gravity: 3, spread: ev.size * 0.5 })
                    const cx = ev.cx + ev.size / 2
                    const cz = ev.cz + ev.size / 2
                    const wood = ev.kind === 'wall' || ev.kind === 'gate' || ev.kind === 'lumbercamp'
                    this.particles.burst(cx, 0.5, cz, { color: wood ? 0x9a6b3f : 0xa8a29e, count: 8 + ev.size * 7, speed: 2.4, up: 4, size: 0.13 + ev.size * 0.03, life: 1.1, spread: ev.size * 0.6 })
                    this.particles.burst(cx, 0.3, cz, { color: 0xe7e5e4, count: 6 + ev.size * 4, speed: 1.4, up: 1.4, size: 0.18, life: 0.9, gravity: 1, spread: ev.size * 0.5 })
                    this.rings.spawn(cx, cz, 0.3, 1.2 + ev.size, 0.5, 0x8a7a66)
                    const p = this.project(cx, 0, cz)
                    if (p.visible && ev.size > 1) this.rig.shake = Math.min(1.5, this.rig.shake + 0.35 * ev.size)
                    if (!BUILDINGS[ev.kind].segment) this.removeBuildingView(ev.id)
                    else this.segmentsDirty = true
                    break
                }
                case 'building-placed':
                    this.grassDirty = true
                    if (BUILDINGS[ev.kind].segment) {
                        this.segmentsDirty = true
                        const b = this.sim.building(ev.id)
                        if (b) this.particles.burst(b.cx + 0.5, 0.2, b.cz + 0.5, { color: 0xe8dcc0, count: 2, speed: 0.8, up: 1, size: 0.07, life: 0.4 })
                    } else {
                        const b = this.sim.building(ev.id)
                        if (b && this.sim.time > 0.1) {
                            const cx = b.cx + b.size / 2
                            const cz = b.cz + b.size / 2
                            this.rings.spawn(cx, cz, 0.4, b.size * 0.9 + 0.8, 0.55, 0xfff1c1)
                            this.particles.burst(cx, 0.15, cz, { color: 0xe8dcc0, count: 10 + b.size * 4, speed: 2, up: 1.3, size: 0.12, life: 0.6, spread: b.size * 0.8 })
                        }
                    }
                    break
                case 'building-upgraded': {
                    const b = this.sim.building(ev.id)
                    if (!b) break
                    if (BUILDINGS[b.kind].segment) {
                        this.segmentsDirty = true
                        break
                    }
                    const view = this.buildings.get(ev.id)
                    if (view) view.born = this.clock
                    const cx = b.cx + b.size / 2
                    const cz = b.cz + b.size / 2
                    this.particles.burst(cx, 1, cz, { color: 0xffd35a, count: 14, speed: 2.2, up: 3.5, size: 0.08, life: 0.9, spread: b.size * 0.6 })
                    this.rings.spawn(cx, cz, 0.5, b.size + 1, 0.6, 0xffd35a)
                    break
                }
                case 'deploy':
                    this.rings.spawn(ev.x, ev.z, 0.3, 2.6, 0.5, 0x9cc9ff)
                    this.particles.burst(ev.x, 0.4, ev.z, { color: 0xffffff, count: 10, speed: 2.4, up: 2, size: 0.06, life: 0.5, spread: 1.2 })
                    break
                case 'wave-incoming':
                    for (const lane of ev.lanes) {
                        const beacon = this.laneBeacons[lane]
                        if (beacon) beacon.warn = 1
                        const l = this.sim.difficulty.lanes[lane]
                        if (l) this.rings.spawn(l.x + 0.5, l.z + 0.5, 0.5, 5, 1.2, 0xff4040)
                    }
                    break
                case 'wave-spawned':
                    for (const lane of ev.lanes) {
                        const beacon = this.laneBeacons[lane]
                        if (beacon) beacon.warn = 0.6
                    }
                    break
                default:
                    break
            }
        }
    }

    // ─── Frame ───────────────────────────────────────────────────────────

    /** alpha: fraction of a tick since the last sim step. dt: real seconds. */
    render(alpha: number, dt: number): void {
        this.clock += dt
        this.rig.update(dt)
        this.followSun()
        const simTime = this.sim.time + alpha * TICK

        this.updateAtmosphere(dt)
        this.syncBuildings(dt)
        if (this.segmentsDirty || this.clock - this.segmentTintAt > 0.3) this.syncSegments()
        this.syncUnits(alpha, dt, simTime)
        this.syncArrows(alpha)
        this.syncBars(alpha)
        this.syncSelection(alpha)
        this.syncGhost(dt)
        this.syncLanes(dt)
        this.particles.update(dt)
        this.glow.update(dt)
        this.volleys.update(dt, this.arrowThick)
        this.volleys.endTrails()
        this.grass.update(this.clock)
        if (this.grassDirty) {
            this.grassDirty = false
            this.grass.refresh()
        }
        this.remains.update(dt)
        this.lanePaths.update(dt, this.clock)
        this.rings.update(dt)

        const tm = this.territory.material.uniforms
        const kc = this.sim.keepCenter
        tm.uCenter!.value.set(kc.x, kc.z)
        tm.uRadius!.value += (this.sim.territory - tm.uRadius!.value) * Math.min(1, dt * 4)
        tm.uTime!.value = this.clock
        const building = this.ghost.mode === 'building' || this.ghost.mode === 'walls' || this.ghost.mode === 'deploy'
        tm.uGrid!.value += ((building ? 1 : 0) - tm.uGrid!.value) * Math.min(1, dt * 8)
        tm.uRing!.value += ((building ? 0.9 : 0.28) - tm.uRing!.value) * Math.min(1, dt * 8)

        this.sea.material.uniforms.uTime!.value = this.clock
        const fog = this.scene.fog as THREE.Fog
        fog.near = this.rig.dist + 30
        fog.far = this.rig.dist + 130

        if (this.usePost) {
            // The miniature blur is strongest up close, subtle when zoomed out.
            this.post.setStrength(Math.max(0.3, Math.min(1, 1.25 - this.rig.dist / 48)))
            this.post.render()
        } else {
            this.renderer.render(this.scene, this.rig.camera)
        }
        this.adaptQuality(dt)
    }

    private shadowHalf = 30
    private readonly post: HoldfastPost
    /** Post-processing is the first thing dropped on a struggling GPU. */
    usePost = true

    /**
     * The shadow camera follows the view, sized to what's on screen, and
     * snaps to whole shadow texels so edges don't shimmer while panning.
     */
    private followSun(): void {
        const half = Math.max(22, Math.min(64, this.rig.dist * 1.05))
        const cam = this.sun.shadow.camera
        if (Math.abs(half - this.shadowHalf) > 2) {
            this.shadowHalf = half
            cam.left = -half
            cam.right = half
            cam.top = half
            cam.bottom = -half
            cam.updateProjectionMatrix()
        }
        const texel = (this.shadowHalf * 2) / this.sun.shadow.mapSize.x
        const tx = Math.round(this.rig.target.x / texel) * texel
        const tz = Math.round(this.rig.target.z / texel) * texel
        this.sun.target.position.set(tx, 0, tz)
        this.sun.position.set(tx + 34, 52, tz + 22)
    }

    private adaptQuality(dt: number): void {
        // Back the pixel ratio off on slow frames, never below native.
        if (dt > 1 / 40) this.slowFrames++
        else this.slowFrames = Math.max(0, this.slowFrames - 1)
        if (dt < 1 / 70) this.fastFrames++
        else this.fastFrames = 0
        const floor = Math.min(window.devicePixelRatio || 1, 1)
        if (this.slowFrames > 90 && this.pixelRatio <= floor && this.usePost) {
            this.usePost = false
            this.slowFrames = 0
        } else if (this.slowFrames > 90 && this.pixelRatio > floor) {
            this.pixelRatio = Math.max(floor, this.pixelRatio - 0.25)
            this.renderer.setPixelRatio(this.pixelRatio)
            this.resize()
            this.slowFrames = 0
        } else if (this.fastFrames > 600 && this.pixelRatio < this.maxPixelRatio) {
            this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.25)
            this.renderer.setPixelRatio(this.pixelRatio)
            this.resize()
            this.fastFrames = 0
        }
    }

    private updateAtmosphere(dt: number): void {
        const target = this.sim.bloodmoon ? 1 : 0
        if (Math.abs(target - this.moon) < 0.001) return
        this.moon += (target - this.moon) * Math.min(1, dt * 0.35)
        const m = this.moon
        const bg = this.scene.background as THREE.Color
        bg.copy(SKY).lerp(SKY_MOON, m)
        ;(this.scene.fog as THREE.Fog).color.copy(bg)
        const su = this.sea.material.uniforms
        ;(su.uFar!.value as THREE.Color).copy(bg)
        ;(su.uDeep!.value as THREE.Color).setHex(0x2479b8).lerp(col.setHex(0x3a0d1c), m * 0.8)
        ;(su.uShallow!.value as THREE.Color).setHex(0x5fd0e0).lerp(col.setHex(0x8a2a3a), m * 0.7)
        this.hemi.color.setHex(0xdff1ff).lerp(col.setHex(0xff9aa2), m * 0.8)
        this.hemi.groundColor.setHex(0x5e7a3a).lerp(col.setHex(0x3a1a22), m)
        this.hemi.intensity = 1.35 - m * 0.45
        this.sun.color.setHex(0xfff1d6).lerp(col.setHex(0xff5a4a), m)
        this.sun.intensity = 2.4 - m * 0.9
    }

    // ─── Buildings ───────────────────────────────────────────────────────

    private removeBuildingView(id: number): void {
        const view = this.buildings.get(id)
        if (!view) return
        // Crumble into the ground rather than blink out.
        this.remains.collapse(view.mesh)
        this.buildings.delete(id)
    }

    private syncBuildings(dt: number): void {
        const alive = new Set<number>()
        for (const b of this.sim.buildings) {
            if (BUILDINGS[b.kind].segment) continue
            alive.add(b.id)
            let view = this.buildings.get(b.id)
            if (!view || view.level !== b.level) {
                const geo = buildingGeometry(b.kind, b.level)
                if (!geo.boundingBox) geo.computeBoundingBox()
                if (view) {
                    view.mesh.geometry = geo
                    view.level = b.level
                    view.height = geo.boundingBox!.max.y
                    const flag = view.extra?.userData.flag as THREE.Mesh | undefined
                    if (flag) flag.position.y = KEEP_FLAG_Y[b.level - 1] ?? view.height - 0.3
                } else {
                    const mesh = new THREE.Mesh(geo, this.mat)
                    mesh.castShadow = true
                    mesh.receiveShadow = true
                    mesh.position.set(b.cx + b.size / 2, 0, b.cz + b.size / 2)
                    this.scene.add(mesh)
                    view = {
                        mesh,
                        kind: b.kind,
                        level: b.level,
                        born: this.sim.time > 0.1 ? this.clock : -10,
                        wobble: 0,
                        height: geo.boundingBox!.max.y,
                        extra: null,
                        lastSmoke: 0
                    }
                    view.extra = this.buildingExtra(b, view.height)
                    if (view.extra) mesh.add(view.extra)
                    this.buildings.set(b.id, view)
                }
            }
            this.animateBuilding(b, view, dt)
        }
        for (const id of [...this.buildings.keys()]) if (!alive.has(id)) this.removeBuildingView(id)
    }

    private buildingExtra(b: Building, height: number): THREE.Object3D | null {
        if (b.kind === 'keep') {
            const flag = new THREE.Mesh(flagGeometry(), new THREE.MeshStandardMaterial({ color: TEAM_COLOR[PLAYER], roughness: 0.8, side: THREE.DoubleSide }))
            flag.position.set(0.03, KEEP_FLAG_Y[b.level - 1] ?? height - 0.3, 0)
            flag.scale.setScalar(1.5)
            const group = new THREE.Group()
            group.add(flag)
            group.userData.flag = flag
            return group
        }
        if (b.kind === 'crystalmine') {
            const crystal = new THREE.Mesh(crystalGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0x3b1d8a, emissiveIntensity: 0.6, roughness: 0.3 }))
            crystal.position.y = 1.15
            return crystal
        }
        return null
    }

    private animateBuilding(b: Building, view: BuildingView, dt: number): void {
        const mesh = view.mesh
        const age = this.clock - view.born
        let sy = 1
        let sxz = 1
        if (age < 0.6) {
            // Elastic pop: squash up from the ground, overshoot, settle.
            const t = age / 0.6
            const el = 1 - Math.cos(t * Math.PI * 3.2) * Math.exp(-t * 5.5)
            sy = Math.max(0.05, el)
            sxz = 1 + (1 - el) * 0.35
        }
        if (view.wobble > 0) {
            view.wobble = Math.max(0, view.wobble - dt * 5)
            const w = Math.sin(this.clock * 50) * view.wobble * 0.035
            sxz *= 1 + w
            sy *= 1 - w
        }
        mesh.scale.set(sxz, sy, sxz)
        if (view.extra) {
            if (b.kind === 'keep') {
                const flag = view.extra.userData.flag as THREE.Mesh
                flag.rotation.y = Math.sin(this.clock * 2.4) * 0.35 + 0.3
                flag.scale.x = 1.6 * (0.9 + Math.sin(this.clock * 5.3) * 0.1)
            } else {
                view.extra.rotation.y += dt * 0.9
                view.extra.position.y = 1.15 + b.level * 0.08 + Math.sin(this.clock * 2) * 0.1
            }
        }
        // A damaged building smokes.
        const frac = b.hp / b.maxHp
        // Burning: flames lick the roof, embers drift up.
        if (frac < 0.6 && Math.random() < (0.6 - frac) * 0.5) {
            const fx = b.cx + b.size / 2 + (Math.random() - 0.5) * b.size * 0.6
            const fz = b.cz + b.size / 2 + (Math.random() - 0.5) * b.size * 0.6
            this.glow.burst(fx, view.height * (0.5 + Math.random() * 0.4), fz, { color: Math.random() < 0.5 ? 0xff7a1a : 0xffc04a, count: 1, speed: 0.3, up: 1.6, size: 0.14, life: 0.55, gravity: -1.5, spin: 2 })
            if (Math.random() < 0.3) this.glow.burst(fx, view.height, fz, { color: 0xffb347, count: 1, speed: 0.5, up: 2.5, size: 0.03, life: 1.6, gravity: -0.6 })
        }
        if (frac < 0.5 && this.clock - view.lastSmoke > 0.25 + frac) {
            view.lastSmoke = this.clock
            const cx = b.cx + b.size / 2 + (Math.random() - 0.5) * b.size * 0.5
            const cz = b.cz + b.size / 2 + (Math.random() - 0.5) * b.size * 0.5
            this.particles.burst(cx, view.height * 0.8, cz, { color: frac < 0.25 ? 0x3f3f46 : 0x78716c, count: 1, speed: 0.2, up: 1.1, size: 0.22, life: 1.4, gravity: -0.4, spin: 1 })
        }
    }

    private syncSegments(): void {
        this.segmentsDirty = false
        this.segmentTintAt = this.clock
        const n = this.sim.grid.size
        const k = this.sim.keepCenter
        const pools = this.wallPools
        const counts = pools.map(() => Object.fromEntries(WALL_PIECES.map(p => [p, 0])) as Record<WallPiece, number>)
        const segAt = (x: number, z: number): Building | undefined => {
            if (x < 0 || z < 0 || x >= n || z >= n) return undefined
            const o = this.sim.buildingAtCell(z * n + x)
            return o && BUILDINGS[o.kind].segment === true ? o : undefined
        }
        const linkCache = new Map<number, (readonly [number, number])[]>()
        const linksOf = (cx: number, cz: number): (readonly [number, number])[] => {
            const key = cz * n + cx
            let links = linkCache.get(key)
            if (!links) {
                links = []
                for (const d of NEIGHBOURS) {
                    const [dx, dz] = d
                    if (!segAt(cx + dx, cz + dz)) continue
                    // A diagonal only links when it isn't already an L of straight arms.
                    if (dx !== 0 && dz !== 0 && (segAt(cx + dx, cz) || segAt(cx, cz + dz))) continue
                    links.push(d)
                }
                linkCache.set(key, links)
            }
            return links
        }
        const has = (links: readonly (readonly [number, number])[], dx: number, dz: number): boolean => links.some(([a, b]) => a === dx && b === dz)

        // Towers stand where a wall ends, turns sharply or branches, and on the
        // 45° corners of long runs (not on the zigzag steps of a sloped line).
        const candidates: { cell: number, rank: number }[] = []
        for (const b of this.sim.buildings) {
            if (b.kind !== 'wall') continue
            const links = linksOf(b.cx, b.cz)
            let rank = 0
            if (links.length === 0) rank = 3
            else if (links.length !== 2) rank = 2
            else {
                const a = links[0]!
                const c = links[1]!
                const cos = (a[0] * c[0] + a[1] * c[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(c[0], c[1]))
                if (cos > -0.5) rank = 2
                else if (cos > -0.99 && has(linksOf(b.cx + a[0], b.cz + a[1]), a[0], a[1]) && has(linksOf(b.cx + c[0], b.cz + c[1]), c[0], c[1])) rank = 1
            }
            if (rank > 0) candidates.push({ cell: b.cz * n + b.cx, rank })
        }
        candidates.sort((p, o) => o.rank - p.rank || p.cell - o.cell)
        const towers = new Set<number>()
        const nearTower = (cx: number, cz: number): boolean => NEIGHBOURS.some(([dx, dz]) => !!segAt(cx + dx, cz + dz) && towers.has((cz + dz) * n + cx + dx))
        for (const c of candidates) {
            const cx = c.cell % n
            // Never two towers side by side.
            if (!nearTower(cx, (c.cell - cx) / n)) towers.add(c.cell)
        }

        const put = (tier: number, piece: WallPiece, x: number, z: number, rot: number, sx = 1): void => {
            const mesh = pools[tier]![piece]
            const i = counts[tier]![piece]++
            if (i >= mesh.instanceMatrix.count) return
            q.setFromEuler(e.set(0, rot, 0))
            m4.compose(v.set(x, 0, z), q, s3.set(sx, 1, 1))
            mesh.setMatrixAt(i, m4)
            mesh.setColorAt(i, col)
        }
        /** Rotation that turns a piece's local +Z toward (dx, dz). */
        const face = (dx: number, dz: number): number => Math.atan2(dx, dz)
        const EIGHTH = Math.PI / 4

        for (const b of this.sim.buildings) {
            if (b.kind !== 'wall' && b.kind !== 'gate') continue
            const tier = Math.min(3, Math.max(1, b.level)) - 1
            // Damage darkens the segment and a fresh hit flashes it; a faint
            // per-cell shade keeps long runs from looking stamped.
            const frac = b.hp / b.maxHp
            const flash = this.sim.time - b.lastHitAt < 0.15 ? 0.35 : 0
            const shade = 0.955 + 0.045 * ((((b.cx * 73856093) ^ (b.cz * 19349663)) >>> 0) % 97) / 96
            col.setRGB(1, 1, 1).multiplyScalar((0.55 + 0.45 * frac) * shade)
            col.lerp(WHITE, flash)
            const x = b.cx + 0.5
            const z = b.cz + 0.5
            const ol = Math.hypot(x - k.x, z - k.z) || 1
            const ox = (x - k.x) / ol
            const oz = (z - k.z) / ol
            const links = linksOf(b.cx, b.cz)

            if (b.kind === 'gate') {
                // The gate lines up with the wall it sits in; a lone gate stands across the line from the keep.
                let a = links.find(([dx, dz]) => dx === 0 || dz === 0) ?? links[0]
                if (!a) {
                    const s = Math.round(Math.atan2(ox, -oz) / EIGHTH) * EIGHTH
                    a = [Math.round(Math.cos(s)), Math.round(Math.sin(s))]
                }
                const [ax, az] = a
                const al = Math.hypot(ax, az)
                let px = -az / al
                let pz = ax / al
                if (px * ox + pz * oz < 0) {
                    px = -px
                    pz = -pz
                }
                const rot = face(px, pz)
                put(tier, 'gate', x, z, rot, al > 1 ? Math.SQRT2 : 1)
                // A flanking tower wherever the run of gates ends.
                for (const s of [1, -1]) {
                    const nb = segAt(b.cx + s * ax, b.cz + s * az)
                    if (nb?.kind === 'gate' || (nb && towers.has(nb.cz * n + nb.cx))) continue
                    put(tier, 'gateTower', x + s * ax * 0.5 + px * 0.16, z + s * az * 0.5 + pz * 0.16, rot)
                }
                continue
            }

            if (towers.has(b.cz * n + b.cx)) {
                // Slits face out; every side not joined to a wall and not open to the keep gets a parapet.
                put(tier, 'tower', x, z, Math.round(face(ox, oz) / EIGHTH) * EIGHTH)
                for (const [dx, dz] of NEIGHBOURS) {
                    if (has(links, dx, dz)) continue
                    if ((dx * ox + dz * oz) / Math.hypot(dx, dz) < -0.6) continue
                    put(tier, 'towerFlat', x, z, face(dx, dz))
                }
                continue
            }

            // One arm per link, parapet on the side facing away from the keep.
            let sx = 0
            let sz = 0
            for (const [dx, dz] of links) {
                const dl = Math.hypot(dx, dz)
                const diag = dl > 1
                let nx = -dz / dl
                let nz = dx / dl
                const out = nx * ox + nz * oz >= 0
                if (!out) {
                    nx = -nx
                    nz = -nz
                }
                sx += nx
                sz += nz
                // Diagonal arms reach a little further so they meet a neighbouring tower's rim.
                const reach = diag && towers.has((b.cz + dz) * n + b.cx + dx) ? 1.14 : 1
                put(tier, diag ? (out ? 'diagPlus' : 'diagMinus') : (out ? 'armPlus' : 'armMinus'), x, z, Math.atan2(-dz, dx), reach)
            }
            const first = links[0]!
            const second = links[1]
            if (links.length === 2 && second && first[0] === -second[0] && first[1] === -second[1]) {
                // A straight run: now and then a stair up the inner face.
                const [dx, dz] = first
                if ((dx === 0 || dz === 0) && ((b.cx + b.cz) % 7 + 7) % 7 === 3 && !nearTower(b.cx, b.cz)) {
                    const flip = -dz * ox + dx * oz < 0 ? -1 : 1
                    put(tier, 'stair', x, z, face(-dz * flip, dx * flip))
                }
                continue
            }
            // A bend: an octagonal joint with parapet round the outside of it.
            put(tier, 'hub', x, z, 0)
            const sl = Math.hypot(sx, sz)
            if (sl < 1e-3) continue
            for (const [dx, dz] of NEIGHBOURS) {
                // Sides within 45° of an arm are covered by it.
                if (links.some(([lx, lz]) => lx * dx + lz * dz > 0.01)) continue
                if ((dx * sx + dz * sz) / (Math.hypot(dx, dz) * sl) <= 0.5) continue
                put(tier, 'hubFlat', x, z, face(dx, dz))
            }
        }

        pools.forEach((pool, t) => {
            const c = counts[t]!
            for (const piece of WALL_PIECES) {
                const mesh = pool[piece]
                mesh.count = Math.min(c[piece], mesh.instanceMatrix.count)
                mesh.visible = mesh.count > 0
                mesh.instanceMatrix.needsUpdate = true
                if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
            }
        })
    }

    // ─── Units ───────────────────────────────────────────────────────────

    private syncUnits(alpha: number, dt: number, simTime: number): void {
        const P = this.parts
        let nBody = 0
        let nWarrior = 0
        let nArcher = 0
        const anchorR = UNIT_ANCHORS.rightHand
        const anchorL = UNIT_ANCHORS.leftHand
        const grid = this.sim.grid
        for (const u of this.sim.units) {
            if (nBody >= MAX_UNITS) break
            let view = this.unitViews.get(u.id)
            if (!view) {
                view = { phase: Math.random() * 6, y: u.elevated ? WALL_HEIGHT : 0, seen: 0 }
                this.unitViews.set(u.id, view)
            }
            view.seen = this.clock
            const x = u.px + (u.x - u.px) * alpha
            const z = u.pz + (u.z - u.pz) * alpha
            const speed = Math.hypot(u.x - u.px, u.z - u.pz) / TICK
            const moving = speed > 0.25
            view.phase += dt * (moving ? 6 + speed * 3.5 : 0)
            // Marching boots kick up a little dust (cosmetic).
            if (moving && this.rig.dist < 42 && Math.random() < dt * 0.3) {
                this.particles.burst(x, view.y + 0.04, z, { color: 0xcdbb94, count: 1, speed: 0.25, up: 0.45, size: 0.08, life: 0.55, gravity: -0.15, spin: 1 })
            }
            const onWall = u.elevated || (u.side === PLAYER && this.sim.buildingAtCell(grid.cellAt(x, z))?.kind === 'wall')
            const targetY = onWall ? WALL_HEIGHT : 0
            view.y += (targetY - view.y) * Math.min(1, dt * 14)

            const since = simTime - u.spawnedAt
            let drop = 0
            let squash = 1
            if (u.side === PLAYER && since < 0.45) {
                const t = since / 0.45
                drop = (1 - t) * (1 - t) * 3.2
                squash = t > 0.8 ? 1 - Math.sin((t - 0.8) / 0.2 * Math.PI) * 0.25 : 1
            }
            const scaleIn = u.side === ENEMY ? Math.min(1, since / 0.3) : 1
            const bob = moving ? Math.abs(Math.sin(view.phase)) * 0.055 : Math.sin(this.clock * 2.2 + u.id) * 0.006
            const roll = moving ? Math.sin(view.phase) * 0.13 : 0
            const hitAgo = simTime - u.lastHitAt
            const hitKick = hitAgo < 0.15 ? (1 - hitAgo / 0.15) : 0

            q.setFromEuler(e.set(-hitKick * 0.25, u.angle, roll, 'YXZ'))
            const sc = UNIT_SCALE * scaleIn
            m4.compose(v.set(x, view.y + bob + drop, z), q, s3.set(sc / Math.sqrt(squash), sc * squash, sc / Math.sqrt(squash)))

            // Team colour, flashing white when hit.
            col.setHex(TEAM_COLOR[u.side])
            if (hitKick > 0) col.lerp(WHITE, hitKick * 0.7)
            const flashCol = col2.setRGB(1, 1, 1)
            if (u.side === ENEMY) flashCol.setRGB(0.85, 0.8, 0.8)

            P.body.setMatrixAt(nBody, m4)
            P.body.setColorAt(nBody, col)
            P.trim.setMatrixAt(nBody, m4)
            P.trim.setColorAt(nBody, flashCol)
            P.head.setMatrixAt(nBody, m4)
            P.head.setColorAt(nBody, hitKick > 0 ? col2.setRGB(1, 0.85, 0.85) : WHITE)

            q2.identity()
            m4b.compose(v2.set(x, 0.015 + view.y, z), q2, s3.set(0.34 * scaleIn, 1, 0.34 * scaleIn))
            P.blob.setMatrixAt(nBody, m4b)
            nBody++

            const atkAgo = simTime - u.lastAttackAt
            if (u.kind === 'warrior') {
                const i = nWarrior++
                P.helmet.setMatrixAt(i, m4)
                P.helmet.setColorAt(i, col2.setHex(HELMET_COLOR[u.side]))
                // Chop: a quick forward swing after each blow.
                let swing = -0.35
                if (atkAgo < 0.32) {
                    const t = atkAgo / 0.32
                    swing = -0.35 + Math.sin(t * Math.PI) * 2.1
                } else if (moving) {
                    swing = -0.35 + Math.sin(view.phase) * 0.25
                }
                m4b.makeRotationX(swing)
                m4c.makeTranslation(anchorR[0], anchorR[1], anchorR[2]).multiply(m4b)
                m4b.multiplyMatrices(m4, m4c)
                P.sword.setMatrixAt(i, m4b)
                P.sword.setColorAt(i, WHITE)
                const brace = atkAgo < 0.32 ? 0.05 : 0
                m4c.makeTranslation(anchorL[0] + 0.02, anchorL[1], anchorL[2] + 0.07 + brace)
                m4b.multiplyMatrices(m4, m4c)
                P.shield.setMatrixAt(i, m4b)
                P.shield.setColorAt(i, u.side === ENEMY ? col2.setRGB(0.75, 0.7, 0.7) : WHITE)
                P.emblem.setMatrixAt(i, m4b)
                P.emblem.setColorAt(i, col.setHex(TEAM_COLOR[u.side]))
            } else {
                const i = nArcher++
                P.hood.setMatrixAt(i, m4)
                P.hood.setColorAt(i, col.setHex(TEAM_COLOR[u.side]).multiplyScalar(u.side === PLAYER ? 0.85 : 0.8))
                // Aim: bow comes up level when engaged, recoils on release.
                const aiming = u.targetUnit >= 0 || u.targetBuilding >= 0 || atkAgo < 0.6
                const recoil = atkAgo < 0.15 ? (1 - atkAgo / 0.15) * 0.06 : 0
                e.set(aiming ? 0 : 0.5, 0, aiming ? -1.2 : -0.2)
                m4b.makeRotationFromEuler(e)
                m4c.makeTranslation(anchorL[0], anchorL[1] + (aiming ? 0.06 : 0), anchorL[2] + (aiming ? 0.1 - recoil : 0)).multiply(m4b)
                m4b.multiplyMatrices(m4, m4c)
                P.bow.setMatrixAt(i, m4b)
                P.bow.setColorAt(i, WHITE)
            }
        }
        P.body.count = P.trim.count = P.head.count = P.blob.count = nBody
        P.helmet.count = P.sword.count = P.shield.count = P.emblem.count = nWarrior
        P.hood.count = P.bow.count = nArcher
        for (const mesh of Object.values(P)) {
            mesh.instanceMatrix.needsUpdate = true
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        }
        // Forget views of units that are gone.
        if (this.unitViews.size > this.sim.units.length + 64) {
            for (const [id, view] of this.unitViews) if (view.seen < this.clock) this.unitViews.delete(id)
        }
    }

    private syncArrows(alpha: number): void {
        let n = 0
        // Thin geometry gets a minimum on-screen thickness when zoomed out.
        const thick = Math.max(1, this.rig.dist / 30)
        this.arrowThick = thick
        this.volleys.beginTrails()
        for (const a of this.sim.arrows) {
            if (n >= MAX_ARROWS) break
            const t = Math.min(1, (a.t + alpha * TICK) / a.duration)
            const dx = a.toX - a.fromX
            const dz = a.toZ - a.fromZ
            const dist = Math.hypot(dx, dz)
            const arc = dist * 0.16
            const y = a.fromY + (a.toY - a.fromY) * t + arc * 4 * t * (1 - t)
            const x = a.fromX + dx * t
            const z = a.fromZ + dz * t
            // Tangent of the arc for orientation.
            const dy = (a.toY - a.fromY) + arc * 4 * (1 - 2 * t)
            v.set(dx, dy, dz).normalize()
            q.setFromUnitVectors(Z_AXIS, v)
            const len = 0.42
            m4.compose(v2.set(x - v.x * len * 0.5, y - v.y * len * 0.5, z - v.z * len * 0.5), q, s3.set(thick, thick, len))
            this.arrows.setMatrixAt(n, m4)
            this.arrows.setColorAt(n, a.fire ? col.setRGB(3, 1.4, 0.4) : WHITE)
            n++
            this.volleys.trail(v2, v, thick, a.fire)
            let last = this.arrowLast.get(a.id)
            if (!last) {
                last = { x: 0, y: 0, z: 0, q: new THREE.Quaternion(), target: a.targetUnit, fire: a.fire, thick, seen: 0 }
                this.arrowLast.set(a.id, last)
                // A volley, not a lone arrow: companions loosed alongside it.
                if (this.rig.dist < 60) {
                    const escorts = a.side === PLAYER ? (a.fromY > 2 ? 3 : 2) : 1
                    this.volleys.escort(a.fromX, a.fromY, a.fromZ, a.toX, a.toY, a.toZ, a.duration, a.fire, escorts)
                }
            }
            last.x = v2.x
            last.y = v2.y
            last.z = v2.z
            last.q.copy(q)
            last.thick = thick
            last.seen = this.arrowFrame
        }
        // Arrows that landed this frame: ones that found a living target vanish into
        // it; misses and building hits stay stuck in the ground or the timber.
        for (const [id, last] of this.arrowLast) {
            if (last.seen === this.arrowFrame) continue
            this.arrowLast.delete(id)
            const target = last.target >= 0 ? this.sim.unit(last.target) : undefined
            if (target?.alive) continue
            const onBuilding = this.sim.buildingAtCell(this.sim.grid.cellAt(last.x, last.z))
            if (!onBuilding) last.y = Math.min(last.y, 0.06)
            v.set(last.x, last.y, last.z)
            this.remains.stickArrow(v, last.q, last.fire, last.thick)
        }
        this.arrowFrame++
        this.arrows.count = n
        this.arrows.instanceMatrix.needsUpdate = true
        if (this.arrows.instanceColor) this.arrows.instanceColor.needsUpdate = true
    }

    private syncBars(alpha: number): void {
        const cam = this.rig.camera
        const right = v2.setFromMatrixColumn(cam.matrixWorld, 0).normalize()
        const rx = right.x
        const ry = right.y
        const rz = right.z
        let n = 0
        const scale = Math.max(1, this.rig.dist / 34)
        const add = (x: number, y: number, z: number, w: number, frac: number, color: number): void => {
            if (n >= MAX_BARS) return
            const h = 0.07 * scale
            const width = w * scale
            m4.compose(v.set(x, y, z), cam.quaternion, s3.set(width + 0.04 * scale, h + 0.04 * scale, 1))
            this.barBg.setMatrixAt(n, m4)
            const fw = width * Math.max(0, Math.min(1, frac))
            const off = (fw - width) / 2
            m4.compose(v.set(x + rx * off, y + ry * off, z + rz * off), cam.quaternion, s3.set(Math.max(0.0001, fw), h, 1))
            this.barFill.setMatrixAt(n, m4)
            this.barFill.setColorAt(n, col.setHex(color))
            n++
        }
        const selPack = this.selection?.type === 'pack' ? this.selection.id : -1
        for (const u of this.sim.units) {
            const hurt = u.hp < u.maxHp && this.sim.time - u.lastHitAt < 4
            if (!hurt && u.packId !== selPack) continue
            const frac = u.hp / u.maxHp
            const view = this.unitViews.get(u.id)
            const x = u.px + (u.x - u.px) * alpha
            const z = u.pz + (u.z - u.pz) * alpha
            const color = u.side === ENEMY ? 0xef4444 : frac > 0.5 ? 0x4ade80 : frac > 0.25 ? 0xfacc15 : 0xf97316
            add(x, (view?.y ?? 0) + 1.1, z, 0.46, frac, color)
        }
        const selB = this.selection?.type === 'building' ? this.selection.id : -1
        for (const b of this.sim.buildings) {
            if (b.hp >= b.maxHp && b.id !== selB) continue
            if (BUILDINGS[b.kind].segment && b.id !== selB && this.sim.time - b.lastHitAt > 5) continue
            const view = this.buildings.get(b.id)
            const frac = b.hp / b.maxHp
            const h = view ? view.height + 0.45 : 1.6
            add(b.cx + b.size / 2, h, b.cz + b.size / 2, Math.min(2.4, 0.5 + b.size * 0.45), frac, frac > 0.5 ? 0x4ade80 : frac > 0.25 ? 0xfacc15 : 0xef4444)
        }
        this.barBg.count = n
        this.barFill.count = n
        this.barBg.instanceMatrix.needsUpdate = true
        this.barFill.instanceMatrix.needsUpdate = true
        if (this.barFill.instanceColor) this.barFill.instanceColor.needsUpdate = true
    }

    private syncSelection(alpha: number): void {
        let n = 0
        const pulse = 0.92 + Math.sin(this.clock * 6) * 0.08
        const addRing = (x: number, y: number, z: number, r: number, color: number): void => {
            if (n >= 200) return
            q.identity()
            m4.compose(v.set(x, y + 0.03, z), q, s3.set(r, 1, r))
            this.selRings.setMatrixAt(n, m4)
            this.selRings.setColorAt(n, col.setHex(color))
            n++
        }
        const packIds = new Set<number>()
        if (this.selection?.type === 'pack') packIds.add(this.selection.id)
        if (this.hoverUnitPack >= 0) packIds.add(this.hoverUnitPack)
        for (const u of this.sim.units) {
            if (!packIds.has(u.packId)) continue
            const selected = this.selection?.type === 'pack' && this.selection.id === u.packId
            const view = this.unitViews.get(u.id)
            addRing(u.px + (u.x - u.px) * alpha, view?.y ?? 0, u.pz + (u.z - u.pz) * alpha, 0.34 * (selected ? pulse : 1), selected ? 0x93e5ff : 0xffffff)
        }
        this.rangeRing.visible = false
        if (this.selection?.type === 'building') {
            const b = this.sim.building(this.selection.id)
            if (b) {
                addRing(b.cx + b.size / 2, 0, b.cz + b.size / 2, (b.size * 0.72 + 0.2) * pulse, 0x93e5ff)
                const atk = BUILDINGS[b.kind].attack
                if (atk && this.ghost.mode === 'none') {
                    const r = (atk.range[b.level - 1] ?? atk.range[0]!) + b.size / 2
                    this.rangeRing.visible = true
                    this.rangeRing.position.set(b.cx + b.size / 2, 0.05, b.cz + b.size / 2)
                    this.rangeRing.scale.setScalar(r)
                }
            }
        }
        // Where a selected pack is marching to.
        if (this.selection?.type === 'pack') {
            const pack = this.sim.packs.get(this.selection.id)
            if (pack?.moving) addRing(pack.anchorX, 0, pack.anchorZ, 0.6 + Math.sin(this.clock * 5) * 0.08, MOVE_COLOR)
        }
        this.selRings.count = n
        this.selRings.instanceMatrix.needsUpdate = true
        if (this.selRings.instanceColor) this.selRings.instanceColor.needsUpdate = true
    }

    // ─── Ghosts ──────────────────────────────────────────────────────────

    private syncGhost(dt: number): void {
        const g = this.ghost
        const k = 1 - Math.exp(-dt * 22)
        this.ghostBuilding.visible = false
        this.ghostTiles.count = 0
        this.ghostWalls.count = 0
        this.ghostGates.count = 0
        this.ghostRings.count = 0
        this.ghostBody.count = 0
        this.ghostHead.count = 0
        this.wallSpots.count = 0
        const archers = (g.mode === 'deploy' && g.unitKind === 'archer') || (g.mode === 'move' && g.unitKind === 'archer')
        if (archers) {
            // Every walkway an archer could hold, gently pulsing.
            let c = 0
            const pulse = 0.2 + Math.sin(this.clock * 4) * 0.03
            for (const b of this.sim.buildings) {
                if (b.kind !== 'wall' || c >= 600) continue
                const face = this.sim.wallFacing(b)
                q.identity()
                m4.compose(v.set(b.cx + 0.5 - Math.sin(face) * 0.14, WALL_HEIGHT + 0.03, b.cz + 0.5 - Math.cos(face) * 0.14), q, s3.set(pulse, 1, pulse))
                this.wallSpots.setMatrixAt(c, m4)
                this.wallSpots.setColorAt(c, col.setHex(0xffc24a))
                c++
            }
            this.wallSpots.count = c
            this.wallSpots.instanceMatrix.needsUpdate = true
            if (this.wallSpots.instanceColor) this.wallSpots.instanceColor.needsUpdate = true
        }
        if (g.mode === 'none') {
            this.ghostKey = ''
            return
        }
        const grid = this.sim.grid
        const n = grid.size
        const okColor = g.ok ? GHOST_OK : GHOST_BAD

        if (g.mode === 'building' && g.buildingKind && g.cx !== undefined && g.cz !== undefined) {
            const size = BUILDINGS[g.buildingKind].size
            const tx = g.cx + size / 2
            const tz = g.cz + size / 2
            const key = `b:${g.buildingKind}`
            if (this.ghostKey !== key) {
                this.ghostBuilding.geometry = buildingGeometry(g.buildingKind, 1)
                this.ghostPos.set(tx, 0, tz)
                this.ghostKey = key
            }
            this.ghostPos.x += (tx - this.ghostPos.x) * k
            this.ghostPos.z += (tz - this.ghostPos.z) * k
            this.ghostBuilding.position.copy(this.ghostPos)
            this.ghostBuilding.position.y = 0.02 + Math.sin(this.clock * 4) * 0.03
            this.ghostMat.color.setHex(okColor)
            this.ghostMat.emissive.setHex(g.ok ? 0x14532d : 0x7f1d1d)
            this.ghostBuilding.visible = true
            let t = 0
            for (let z = 0; z < size; z++) {
                for (let x = 0; x < size; x++) {
                    const cx = g.cx + x
                    const cz = g.cz + z
                    let ok = g.ok
                    if (!g.ok && grid.inBounds(cx, cz)) {
                        const i = grid.idx(cx, cz)
                        ok = !grid.solid(i) && grid.occupant[i]! < 0 && this.sim.inTerritory(cx + 0.5, cz + 0.5)
                    }
                    q.identity()
                    m4.compose(v.set(cx + 0.5, 0.03, cz + 0.5), q, s3.set(1, 1, 1))
                    this.ghostTiles.setMatrixAt(t, m4)
                    this.ghostTiles.setColorAt(t, col.setHex(ok ? GHOST_OK : GHOST_BAD))
                    t++
                }
            }
            this.ghostTiles.count = t
            if (g.range) {
                this.rangeRing.visible = true
                this.rangeRing.position.set(this.ghostPos.x, 0.05, this.ghostPos.z)
                this.rangeRing.scale.setScalar(g.range)
            }
        } else if (g.mode === 'walls' && g.cells && g.valid) {
            const gate = g.buildingKind === 'gate'
            const mesh = gate ? this.ghostGates : this.ghostWalls
            let c = 0
            g.cells.forEach((cell, idx) => {
                if (c >= MAX_GHOST) return
                const x = cell % n
                const z = (cell - x) / n
                const state = g.valid![idx]
                const color = state === true ? GHOST_OK : state === 'poor' ? GHOST_WARN : GHOST_BAD
                q.identity()
                m4.compose(v.set(x + 0.5, 0.01, z + 0.5), q, s3.set(1, 1, 1))
                mesh.setMatrixAt(c, m4)
                mesh.setColorAt(c, col.setHex(color))
                this.ghostTiles.setMatrixAt(c, m4)
                this.ghostTiles.setColorAt(c, col.setHex(color))
                c++
            })
            mesh.count = c
            this.ghostTiles.count = c
            this.ghostKey = 'walls'
        } else if ((g.mode === 'deploy' || g.mode === 'move') && g.slots) {
            const slots = g.slots
            const key = `${g.mode}:${slots.length}`
            if (this.ghostKey !== key || this.ghostSlots.length !== slots.length) {
                this.ghostSlots = slots.map(s => ({ ...s }))
                this.ghostKey = key
            }
            const color = g.mode === 'move' ? MOVE_COLOR : okColor
            const pulse = 1 + Math.sin(this.clock * 6) * 0.06
            slots.forEach((s, i) => {
                const cur = this.ghostSlots[i]!
                // Stagger the follow so the formation flows like a flock.
                const kk = 1 - Math.exp(-dt * (26 - i * 1.2))
                cur.x += (s.x - cur.x) * kk
                cur.z += (s.z - cur.z) * kk
                const wall = this.sim.buildingAtCell(grid.cellAt(cur.x, cur.z))?.kind === 'wall'
                const y = wall ? WALL_HEIGHT : 0
                q.identity()
                m4.compose(v.set(cur.x, y + 0.04, cur.z), q, s3.set(0.3 * pulse, 1, 0.3 * pulse))
                this.ghostRings.setMatrixAt(i, m4)
                this.ghostRings.setColorAt(i, col.setHex(color))
                if (g.mode === 'deploy') {
                    const hover = 0.08 + Math.sin(this.clock * 3 + i * 0.7) * 0.04
                    q.setFromEuler(e.set(0, Math.atan2(cur.x - this.sim.keepCenter.x, cur.z - this.sim.keepCenter.z), 0))
                    m4.compose(v.set(cur.x, y + hover, cur.z), q, s3.set(1, 1, 1))
                    this.ghostBody.setMatrixAt(i, m4)
                    this.ghostBody.setColorAt(i, col.setHex(color))
                    this.ghostHead.setMatrixAt(i, m4)
                    this.ghostHead.setColorAt(i, col.setHex(color))
                }
            })
            this.ghostRings.count = slots.length
            if (g.mode === 'deploy') {
                this.ghostBody.count = slots.length
                this.ghostHead.count = slots.length
            }
            if (g.range && slots.length > 0) {
                const c = slots.reduce((a, s) => ({ x: a.x + s.x / slots.length, z: a.z + s.z / slots.length }), { x: 0, z: 0 })
                this.rangeRing.visible = true
                this.rangeRing.position.set(c.x, 0.05, c.z)
                this.rangeRing.scale.setScalar(g.range)
            }
        }
        for (const mesh of [this.ghostTiles, this.ghostWalls, this.ghostGates, this.ghostRings, this.ghostBody, this.ghostHead]) {
            mesh.instanceMatrix.needsUpdate = true
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        }
    }

    private syncLanes(dt: number): void {
        this.sim.difficulty.lanes.forEach((_, k) => {
            const b = this.laneBeacons[k]!
            const open = this.sim.openLanes.has(k)
            b.shown += ((open ? 1 : 0) - b.shown) * Math.min(1, dt * 3)
            b.group.visible = b.shown > 0.01
            b.group.scale.setScalar(Math.max(0.001, b.shown))
            b.flag.rotation.y = Math.sin(this.clock * 2 + k) * 0.4
            // The warning column fades a few seconds after the wave spawns.
            const pending = this.sim.pending?.lanes.includes(k) ?? false
            if (!pending) b.warn = Math.max(0, b.warn - dt * 0.15)
            const mat = b.column.material as THREE.MeshBasicMaterial
            mat.opacity = b.warn * (0.22 + Math.sin(this.clock * 7) * 0.08)
            b.column.visible = b.warn > 0.01
        })
    }

    dispose(): void {
        this.post.dispose()
        this.renderer.dispose()
        this.renderer.domElement.remove()
        this.scene.traverse((o) => {
            const mesh = o as THREE.Mesh
            if (mesh.material) {
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
                for (const m of mats) m.dispose()
            }
            if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose()
        })
    }
}

/** Nearest player unit to a world point (for click-selection). */
export function pickPlayerUnit(sim: HoldfastSim, x: number, z: number, radius = 0.7): Unit | null {
    let best: Unit | null = null
    let bestD = radius * radius
    for (const u of sim.units) {
        if (u.side !== PLAYER) continue
        const d = (u.x - x) ** 2 + (u.z - z) ** 2
        if (d < bestD) {
            bestD = d
            best = u
        }
    }
    return best
}
