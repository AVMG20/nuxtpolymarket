// Voxel Arena — the game engine. A third-person voxel wave-survival shooter
// built directly on three.js. The Vue component owns the DOM/HUD; this class
// owns the scene, simulation and rendering and writes into a reactive HUD
// object the component hands it.

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { randomFloat, randomChance, randomPick } from '#shared/utils/random'
import type { DraftCard, EliteAffix, EnemyDef, EnemyId, PlayerStats, WeaponDef, WeaponId } from './types'
import { ENEMIES, WEAPONS, MELEE, AFFIXES, planWave, affixHpMult, affixSpeedMult, defaultStats, magazineSize, killScore, dropChance } from './data'
import type { WaveEvent } from './data'
import { dealDraft, applyCard } from './upgrades'
import { ArenaAudio } from './audio'
import type { ArenaSound } from './audio'
import { BOX, FLASH_MATERIAL, buildModel, voxMaterial, playerParts, weaponParts, kataneParts, enemyParts, pickupParts, portalParts, orbitBladeParts, meteorParts, boulderParts, lanternParts } from './models'
import type { VoxModel, VoxPart, PickupKind } from './models'

// ── Public HUD contract ─────────────────────────────────────────────────

export type ArenaPhase = 'menu' | 'playing' | 'draft' | 'paused' | 'dead'

export interface HudWeapon {
    id: WeaponId
    name: string
    ammo: number
    magazine: number
    reloading: boolean
    reloadProgress: number
    color: string
}

export interface HudPopup {
    id: number
    left: number
    top: number
    opacity: number
    color: string
    size: number
    text: string
}

export interface RunSummary {
    wave: number
    score: number
    kills: number
    time: number
    damage: number
    bestWave: number
    bestScore: number
    newBest: boolean
    upgrades: string[]
    headshots: number
}

export interface ArenaHud {
    phase: ArenaPhase
    locked: boolean
    health: number
    maxHealth: number
    energy: number
    energyMax: number
    abilityCost: number
    wave: number
    remaining: number
    alive: number
    kills: number
    score: number
    combo: number
    comboFill: number
    weapons: HudWeapon[]
    activeWeapon: number
    dashCharges: number
    dashMax: number
    dashFill: number
    boss: { name: string, hp: number, maxHp: number } | null
    hitMarker: number
    hitKind: 'hit' | 'crit' | 'kill' | 'head' | 'block'
    hurt: number
    overdrive: number
    chrono: boolean
    frenzy: number
    popups: HudPopup[]
    time: number
    fps: number
    /** 0 = hip, 1 = fully zoomed in. */
    ads: number
    gliding: boolean
    sliding: boolean
    dashing: number
    event: WaveEvent
    headshots: number
}

export interface ArenaUi {
    hud: ArenaHud
    banner: (title: string, subtitle: string, tone: 'wave' | 'boss' | 'clear' | 'info') => void
    toast: (text: string, color: string) => void
    draft: (cards: DraftCard[]) => void
    dead: (summary: RunSummary) => void
}

export function createHud(): ArenaHud {
    return {
        phase: 'menu',
        locked: false,
        health: 100,
        maxHealth: 100,
        energy: 0,
        energyMax: 100,
        abilityCost: 50,
        wave: 0,
        remaining: 0,
        alive: 0,
        kills: 0,
        score: 0,
        combo: 0,
        comboFill: 0,
        weapons: [],
        activeWeapon: 0,
        dashCharges: 2,
        dashMax: 2,
        dashFill: 1,
        boss: null,
        hitMarker: 0,
        hitKind: 'hit',
        hurt: 0,
        overdrive: 0,
        chrono: false,
        frenzy: 0,
        popups: [],
        time: 0,
        fps: 0,
        ads: 0,
        gliding: false,
        sliding: false,
        dashing: 0,
        event: 'none',
        headshots: 0
    }
}

// ── Internal types ──────────────────────────────────────────────────────

const ARENA_HALF = 32
const GRAVITY = 34
const STEP_HEIGHT = 0.65
const MAX_WEAPONS = 3
const BEST_KEY = 'voxel-arena-best'

type EnemyState = 'spawn' | 'chase' | 'windup' | 'charge' | 'stunned'

interface Enemy {
    id: number
    def: EnemyDef
    affix: EliteAffix | null
    model: VoxModel
    parts: VoxPart[]
    pos: THREE.Vector3
    knock: THREE.Vector3
    hp: number
    maxHp: number
    speed: number
    damage: number
    radius: number
    height: number
    scale: number
    yaw: number
    attackTimer: number
    state: EnemyState
    stateTimer: number
    flashTimer: number
    walkPhase: number
    strafeSign: number
    chargeDir: THREE.Vector3
    hover: number
    roarTimer: number
    bladeCooldown: number
    burnTimer: number
    hpBar: THREE.Group
    hpFill: THREE.Mesh
    barTimer: number
    alive: boolean
    stuckTimer: number
    avoidTimer: number
    avoidSign: number
    lastX: number
    lastZ: number
    throwTimer: number
}

interface WeaponState {
    def: WeaponDef
    ammo: number
    reloading: boolean
    reloadTimer: number
    fireTimer: number
    model: THREE.Group
}

interface Projectile {
    pos: THREE.Vector3
    vel: THREE.Vector3
    life: number
    damage: number
    def: WeaponDef
    color: THREE.Color
    size: number
    pierceLeft: number
    ricochetLeft: number
    hit: Set<number>
    homing: number
    explosionRadius: number
    spin: number
    alive: boolean
}

interface EnemyProjectile {
    pos: THREE.Vector3
    vel: THREE.Vector3
    life: number
    damage: number
    alive: boolean
    gravity: number
    /** Boulders carry their own mesh and explode on impact. */
    mesh?: THREE.Group
    blast: number
}

interface Meteor {
    target: THREE.Vector3
    mesh: THREE.Group
    timer: number
    total: number
    warning: THREE.Mesh
}

interface Pickup {
    kind: PickupKind
    weaponId?: WeaponId
    group: THREE.Group
    pos: THREE.Vector3
    life: number
    phase: number
}

interface Effect {
    obj: THREE.Object3D
    life: number
    maxLife: number
    update: (fx: Effect, t: number, dt: number) => void
    dispose?: () => void
}

interface FireCell {
    pos: THREE.Vector3
    mesh: THREE.Mesh
    life: number
    tick: number
    damage: number
}

interface Popup {
    id: number
    pos: THREE.Vector3
    text: string
    color: string
    size: number
    life: number
    maxLife: number
    rise: number
}

/** A fixed-size instanced mesh pool with per-instance colour. */
class InstancePool {
    mesh: THREE.InstancedMesh
    private dummy = new THREE.Object3D()
    private hidden = new THREE.Matrix4().makeScale(0, 0, 0)

    constructor(material: THREE.Material, readonly size: number, geometry: THREE.BufferGeometry = BOX) {
        this.mesh = new THREE.InstancedMesh(geometry, material, size)
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        this.mesh.frustumCulled = false
        for (let i = 0; i < size; i++) {
            this.mesh.setMatrixAt(i, this.hidden)
            this.mesh.setColorAt(i, new THREE.Color(1, 1, 1))
        }
    }

    set(i: number, pos: THREE.Vector3, quat: THREE.Quaternion, sx: number, sy: number, sz: number, color?: THREE.Color): void {
        this.dummy.position.copy(pos)
        this.dummy.quaternion.copy(quat)
        this.dummy.scale.set(sx, sy, sz)
        this.dummy.updateMatrix()
        this.mesh.setMatrixAt(i, this.dummy.matrix)
        if (color) this.mesh.setColorAt(i, color)
    }

    hide(i: number): void {
        this.mesh.setMatrixAt(i, this.hidden)
    }

    commit(): void {
        this.mesh.instanceMatrix.needsUpdate = true
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    }
}

const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _q1 = new THREE.Quaternion()
const _c1 = new THREE.Color()
const UP = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)

/** Distance along a segment (0..1) where it first enters a sphere, or -1. */
function segmentSphere(a: THREE.Vector3, b: THREE.Vector3, center: THREE.Vector3, radius: number): number {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const fx = a.x - center.x
    const fy = a.y - center.y
    const fz = a.z - center.z
    const A = dx * dx + dy * dy + dz * dz
    if (A < 1e-8) return fx * fx + fy * fy + fz * fz <= radius * radius ? 0 : -1
    const B = 2 * (fx * dx + fy * dy + fz * dz)
    const C = fx * fx + fy * fy + fz * fz - radius * radius
    const disc = B * B - 4 * A * C
    if (disc < 0) return -1
    const sq = Math.sqrt(disc)
    const t1 = (-B - sq) / (2 * A)
    if (t1 >= 0 && t1 <= 1) return t1
    const t2 = (-B + sq) / (2 * A)
    if (t2 >= 0 && t2 <= 1) return 0
    return -1
}

function hexToCss(hex: number): string {
    return `#${hex.toString(16).padStart(6, '0')}`
}

export class VoxelArenaGame {
    // three.js core
    private renderer!: THREE.WebGLRenderer
    private scene = new THREE.Scene()
    private camera = new THREE.PerspectiveCamera(75, 1, 0.1, 260)
    private composer!: EffectComposer
    private bloom!: UnrealBloomPass
    private container!: HTMLElement
    private frame = 0
    private lastTime = 0
    private fpsAccum = 0
    private fpsFrames = 0
    private sun!: THREE.DirectionalLight
    private muzzleLight = new THREE.PointLight(0x4df2ff, 0, 10, 2)
    private flashLight = new THREE.PointLight(0xffa23a, 0, 24, 2)

    // world
    private colliders: THREE.Box3[] = []
    private portals: THREE.Vector3[] = []
    private portalRings: THREE.Object3D[] = []
    private skyChunks: { obj: THREE.Object3D, spin: number, rate: number }[] = []
    private elapsed = 0

    // player
    private stats: PlayerStats = defaultStats()
    private stacks = new Map<string, number>()
    private takenUpgrades: string[] = []
    private playerModel!: VoxModel
    private playerGroup = new THREE.Group()
    private katana!: THREE.Group
    private pos = new THREE.Vector3()
    private vel = new THREE.Vector3()
    private yaw = 0
    private pitch = -0.15
    private onGround = true
    private jumpsUsed = 0
    private hp = 100
    private energy = 0
    private weapons: WeaponState[] = []
    private active = 0
    private dashTimer = 0
    private dashDir = new THREE.Vector3()
    private dashCharges = 2
    private dashRecharge = 0
    private dashTrailTimer = 0
    private invuln = 0
    private meleeTimer = 0
    private meleeCombo = 0
    private meleeComboTimer = 0
    private meleeHitDone = false
    private walkPhase = 0
    private frenzyStacks = 0
    private frenzyTimer = 0
    private overdriveTimer = 0
    private secondWindUsed = false
    private auraTimer = 0
    private blades: THREE.Group[] = []
    private bladeAngle = 0
    private hurtFlash = 0
    private hitMarker = 0
    private ads = 0
    private adsHeld = false
    private spreadBloom = 0
    private glideTime = 0
    private camPos = new THREE.Vector3()
    private camInit = false
    private slideTimer = 0
    private slideDir = new THREE.Vector3()
    private slamming = false
    private headshots = 0
    private streakCount = 0
    private streakTimer = 0
    private event: WaveEvent = 'none'
    private meteorTimer = 0
    private meteors: Meteor[] = []
    private lanterns: THREE.PointLight[] = []
    private hemi!: THREE.HemisphereLight
    private regenDelay = 0
    private damageDealt = 0
    private kills = 0
    private score = 0
    private combo = 0
    private comboTimer = 0
    private timeScale = 1
    private chronoTimer = 0
    private shake = 0
    private shakeVec = new THREE.Vector3()
    private fovKick = 0
    private recoilPitch = 0
    private hitSoundTimer = 0

    // entities
    private enemies: Enemy[] = []
    private nextEnemyId = 1
    private projectiles: Projectile[] = []
    private enemyShots: EnemyProjectile[] = []
    private pickups: Pickup[] = []
    private effects: Effect[] = []
    private fireCells: FireCell[] = []
    private popups: Popup[] = []
    private nextPopupId = 1
    private tracers!: InstancePool
    private shotPool!: InstancePool
    private debris!: InstancePool
    private debrisPos: Float32Array
    private debrisVel: Float32Array
    private debrisRot: Float32Array
    private debrisLife: Float32Array
    private debrisSize: Float32Array
    private debrisColor: Float32Array
    private debrisCursor = 0
    private readonly DEBRIS_MAX = 4000

    // waves
    private wave = 0
    private spawnQueue: { enemy: EnemyId, affix: EliteAffix | null }[] = []
    private spawnTimer = 0
    private waveHpMult = 1
    private waveDmgMult = 1
    private maxAlive = 12
    private spawnInterval = 1
    private batchSize = 2
    private waveClearTimer = -1
    private bossEnemy: Enemy | null = null

    // input
    private keys = new Set<string>()
    private mouseDown = false
    private mouseJustDown = false
    private rightDown = false
    private wheelDelta = 0
    private locked = false

    readonly audio = new ArenaAudio()
    private disposed = false
    private quality: 'high' | 'low' = 'high'

    constructor(private ui: ArenaUi) {
        this.debrisPos = new Float32Array(this.DEBRIS_MAX * 3)
        this.debrisVel = new Float32Array(this.DEBRIS_MAX * 3)
        this.debrisRot = new Float32Array(this.DEBRIS_MAX * 4)
        this.debrisLife = new Float32Array(this.DEBRIS_MAX)
        this.debrisSize = new Float32Array(this.DEBRIS_MAX)
        this.debrisColor = new Float32Array(this.DEBRIS_MAX * 3)
    }

    private get hud(): ArenaHud {
        return this.ui.hud
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    mount(container: HTMLElement, quality: 'high' | 'low' = 'high'): void {
        this.container = container
        this.quality = quality
        const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
        renderer.setPixelRatio(quality === 'low' ? 1 : Math.min(window.devicePixelRatio, 1.5))
        renderer.setSize(container.clientWidth, container.clientHeight)
        renderer.shadowMap.enabled = true
        renderer.shadowMap.type = THREE.PCFShadowMap
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.15
        container.appendChild(renderer.domElement)
        this.renderer = renderer

        this.scene.background = new THREE.Color(0x0a0c16)
        this.scene.fog = new THREE.Fog(0x0a0c16, 45, 140)

        this.composer = new EffectComposer(renderer)
        this.composer.addPass(new RenderPass(this.scene, this.camera))
        this.bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.55, 0.5, 0.92)
        this.composer.addPass(this.bloom)
        this.composer.addPass(new OutputPass())

        this.buildLights()
        this.buildArena()
        this.buildPools()
        this.buildPlayer()
        this.setQuality(quality)
        this.resize()

        window.addEventListener('resize', this.resize)
        window.addEventListener('keydown', this.onKeyDown)
        window.addEventListener('keyup', this.onKeyUp)
        window.addEventListener('blur', this.onBlur)
        document.addEventListener('mousemove', this.onMouseMove)
        document.addEventListener('mousedown', this.onMouseDown)
        document.addEventListener('mouseup', this.onMouseUp)
        document.addEventListener('wheel', this.onWheel, { passive: false })
        document.addEventListener('contextmenu', this.onContext)
        document.addEventListener('pointerlockchange', this.onLockChange)

        this.resetRun()
        this.lastTime = performance.now()
        this.frame = requestAnimationFrame(this.loop)
    }

    dispose(): void {
        this.disposed = true
        cancelAnimationFrame(this.frame)
        window.removeEventListener('resize', this.resize)
        window.removeEventListener('keydown', this.onKeyDown)
        window.removeEventListener('keyup', this.onKeyUp)
        window.removeEventListener('blur', this.onBlur)
        document.removeEventListener('mousemove', this.onMouseMove)
        document.removeEventListener('mousedown', this.onMouseDown)
        document.removeEventListener('mouseup', this.onMouseUp)
        document.removeEventListener('wheel', this.onWheel)
        document.removeEventListener('contextmenu', this.onContext)
        document.removeEventListener('pointerlockchange', this.onLockChange)
        if (document.pointerLockElement) document.exitPointerLock()
        this.audio.dispose()
        this.composer.dispose()
        this.renderer.dispose()
        this.renderer.domElement.remove()
    }

    /** Low quality drops shadows, bloom and the pixel ratio for weak GPUs. */
    setQuality(quality: 'high' | 'low'): void {
        this.quality = quality
        const low = quality === 'low'
        this.renderer.shadowMap.enabled = !low
        this.sun.castShadow = !low
        this.bloom.enabled = !low
        this.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 1.5))
        this.scene.traverse(o => {
            if (o instanceof THREE.Mesh) o.material.needsUpdate = true
        })
        this.resize()
    }

    private resize = (): void => {
        if (!this.container) return
        const w = this.container.clientWidth
        const h = this.container.clientHeight
        this.camera.aspect = w / h
        this.camera.updateProjectionMatrix()
        this.renderer.setSize(w, h)
        this.composer.setSize(w, h)
    }

    // ── Scene construction ───────────────────────────────────────────────

    private buildLights(): void {
        const hemi = new THREE.HemisphereLight(0x6f84c4, 0x2a1f33, 1.1)
        this.scene.add(hemi)
        this.hemi = hemi
        const sun = new THREE.DirectionalLight(0xfff0d8, 2.6)
        sun.position.set(28, 52, 18)
        sun.castShadow = true
        sun.shadow.mapSize.set(2048, 2048)
        sun.shadow.camera.left = -42
        sun.shadow.camera.right = 42
        sun.shadow.camera.top = 42
        sun.shadow.camera.bottom = -42
        sun.shadow.camera.near = 10
        sun.shadow.camera.far = 140
        sun.shadow.bias = -0.0015
        sun.shadow.normalBias = 0.03
        this.scene.add(sun)
        this.scene.add(sun.target)
        this.sun = sun
        const rim = new THREE.DirectionalLight(0x4df2ff, 0.5)
        rim.position.set(-30, 20, -30)
        this.scene.add(rim)
        this.scene.add(this.muzzleLight)
        this.scene.add(this.flashLight)
    }

    private buildArena(): void {
        const tiles = ARENA_HALF
        const dummy = new THREE.Object3D()
        const c = new THREE.Color()
        let i = 0
        const glowTiles: THREE.Vector3[] = []
        // The floor is one plane with a hand-drawn pixel tile texture: crisp
        // voxel look, one draw call, and shadows still land on it.
        const size = 512
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const g = canvas.getContext('2d')!
        const px = size / (tiles * 2)
        for (let x = 0; x < tiles * 2; x++) {
            for (let z = 0; z < tiles * 2; z++) {
                const wx = x - tiles + 0.5
                const wz = z - tiles + 0.5
                const ring = Math.max(Math.abs(wx), Math.abs(wz)) > 26
                const big = (Math.floor(x / 2) + Math.floor(z / 2)) % 2 === 0
                const l = (ring ? 22 : big ? 30 : 27) + (Math.random() - 0.5) * 4
                g.fillStyle = `hsl(${ring ? 262 : 228}, ${ring ? 22 : 26}%, ${l}%)`
                g.fillRect(x * px, z * px, px, px)
                g.fillStyle = 'rgba(0,0,0,0.35)'
                g.fillRect(x * px, z * px, px, 1)
                g.fillRect(x * px, z * px, 1, px)
                if (!ring && (x + z) % 2 === 0 && Math.random() < 0.03) glowTiles.push(new THREE.Vector3(wx, 0.02, wz))
            }
        }
        // conduit lines radiating from the centre
        g.fillStyle = 'rgba(63,240,255,0.35)'
        g.fillRect(size / 2 - 1, 0, 2, size)
        g.fillRect(0, size / 2 - 1, size, 2)
        const tex = new THREE.CanvasTexture(canvas)
        tex.magFilter = THREE.NearestFilter
        tex.minFilter = THREE.NearestMipmapLinearFilter
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = 4
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(tiles * 2, tiles * 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }))
        floor.rotation.x = -Math.PI / 2
        floor.receiveShadow = true
        this.scene.add(floor)
        // a wide dark apron outside the walls so the void has a floor
        const apron = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x0d0f1a, roughness: 1 }))
        apron.rotation.x = -Math.PI / 2
        apron.position.y = -0.05
        this.scene.add(apron)

        // glowing accent tiles and the central sigil
        const glowMat = new THREE.MeshStandardMaterial({ color: 0x1a2a40, emissive: 0x3ff0ff, emissiveIntensity: 1.2, roughness: 1 })
        const glow = new THREE.InstancedMesh(BOX, glowMat, glowTiles.length)
        glowTiles.forEach((p, idx) => {
            dummy.position.copy(p)
            dummy.scale.set(1.2, 0.06, 1.2)
            dummy.updateMatrix()
            glow.setMatrixAt(idx, dummy.matrix)
        })
        this.scene.add(glow)

        // perimeter walls
        const wallCount = tiles * 4
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true })
        const walls = new THREE.InstancedMesh(BOX, wallMat, wallCount)
        walls.castShadow = true
        walls.receiveShadow = true
        const stripMat = new THREE.MeshStandardMaterial({ color: 0x40204a, emissive: 0xb56bff, emissiveIntensity: 1.6, roughness: 1 })
        const strips = new THREE.InstancedMesh(BOX, stripMat, wallCount)
        i = 0
        for (let k = 0; k < tiles; k++) {
            const t = (k - tiles / 2) * 2 + 1
            const spots = [[t, -ARENA_HALF - 1], [t, ARENA_HALF + 1], [-ARENA_HALF - 1, t], [ARENA_HALF + 1, t]]
            for (const [wx, wz] of spots) {
                const h = 4 + Math.round(Math.random() * 3) + ((k % 5 === 0) ? 3 : 0)
                dummy.position.set(wx!, h / 2, wz!)
                dummy.scale.set(2, h, 2)
                dummy.updateMatrix()
                walls.setMatrixAt(i, dummy.matrix)
                c.set(0x2b2540).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06)
                walls.setColorAt(i, c)
                dummy.position.set(wx!, h + 0.08, wz!)
                dummy.scale.set(2.04, 0.16, 2.04)
                dummy.updateMatrix()
                strips.setMatrixAt(i, dummy.matrix)
                i++
            }
        }
        this.scene.add(walls)
        this.scene.add(strips)

        // props: pillars, platforms, crates, barricades — every one is a collider
        const props: { x: number, y: number, z: number, w: number, h: number, d: number, color: number }[] = []
        const push = (x: number, z: number, w: number, h: number, d: number, color: number, y = h / 2) => props.push({ x, y, z, w, h, d, color })

        // central platform with steps on four sides
        push(0, 0, 8, 1.2, 8, 0x3a4260)
        push(0, 0, 3, 1.5, 3, 0x454e70)
        for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            push(sx! * 5.5, sz! * 5.5, sx ? 3 : 3, 0.6, sz ? 3 : 3, 0x323a55)
        }
        // pillars at the quadrants — each with a voxel staircase up to a sniper perch
        for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            push(sx! * 15, sz! * 15, 3, 4.2, 3, 0x3b3350)
            push(sx! * 15, sz! * 15, 3.6, 0.3, 3.6, 0x5a4a7a, 4.35)
            push(sx! * 15, sz! * 15, 1.2, 1.2, 1.2, 0x4a4066, 5.1)
            for (let step = 1; step <= 6; step++) {
                // stairs run toward the arena centre along x
                const h = step * 0.6
                push(sx! * (15 - 1.5 - (7 - step) * 1.1), sz! * 15, 1.1, h, 2.2, step % 2 ? 0x3a3255 : 0x413860)
            }
        }
        // raised pads on the axes
        for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            push(sx! * 22, sz! * 22, 5, 0.9, 5, 0x38405e)
            push(sx! * 22 + (sz ? 0 : -sx! * 3.5), sz! * 22 + (sz ? -sz! * 3.5 : 0), sz ? 3 : 2, 0.45, sz ? 2 : 3, 0x323a55)
        }
        // crate clusters
        const crateSpots = [[-9, 20], [9, -20], [20, -9], [-20, 9], [-8, -8], [8, 8], [-24, -24], [24, 24], [26, -14], [-26, 14]]
        for (const [cx, cz] of crateSpots) {
            const n = 2 + Math.floor(Math.random() * 3)
            for (let k = 0; k < n; k++) {
                const ox = (Math.random() - 0.5) * 3
                const oz = (Math.random() - 0.5) * 3
                push(cx! + ox, cz! + oz, 1.5, 1.5, 1.5, k % 2 ? 0x6b5a3a : 0x7a6644)
            }
            if (Math.random() < 0.5) push(cx!, cz!, 1.5, 1.5, 1.5, 0x8a7550, 2.25)
        }
        // barricades
        push(0, 13, 7, 1.3, 1, 0x4a3d66)
        push(0, -13, 7, 1.3, 1, 0x4a3d66)
        push(13, 0, 1, 1.3, 7, 0x4a3d66)
        push(-13, 0, 1, 1.3, 7, 0x4a3d66)

        const propMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true })
        const propMesh = new THREE.InstancedMesh(BOX, propMat, props.length)
        propMesh.castShadow = true
        propMesh.receiveShadow = true
        props.forEach((p, idx) => {
            dummy.position.set(p.x, p.y, p.z)
            dummy.scale.set(p.w, p.h, p.d)
            dummy.updateMatrix()
            propMesh.setMatrixAt(idx, dummy.matrix)
            c.set(p.color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.04)
            propMesh.setColorAt(idx, c)
            this.colliders.push(new THREE.Box3(
                new THREE.Vector3(p.x - p.w / 2, p.y - p.h / 2, p.z - p.d / 2),
                new THREE.Vector3(p.x + p.w / 2, p.y + p.h / 2, p.z + p.d / 2)
            ))
        })
        this.scene.add(propMesh)

        // lanterns: coloured point lights at the axis pads and corners
        const lanternSpots: [number, number, number][] = [[18, 18, 0x3ff0ff], [-18, 18, 0xff6a2a], [18, -18, 0xb56bff], [-18, -18, 0x3dff7a], [7.5, -7.5, 0xffd166], [-7.5, 7.5, 0xffd166]]
        for (const [lx, lz, color] of lanternSpots) {
            const model = buildModel(lanternParts(color))
            model.group.position.set(lx, 0, lz)
            this.scene.add(model.group)
            this.colliders.push(new THREE.Box3(new THREE.Vector3(lx - 0.2, 0, lz - 0.2), new THREE.Vector3(lx + 0.2, 3.2, lz + 0.2)))
            const light = new THREE.PointLight(color, 14, 22, 1.6)
            light.position.set(lx, 3.4, lz)
            this.scene.add(light)
            this.lanterns.push(light)
        }

        // spawn portals
        const portalSpots = [[28, 28], [-28, 28], [28, -28], [-28, -28], [29, 0], [-29, 0], [0, 29], [0, -29]]
        for (const [px, pz] of portalSpots) {
            const model = buildModel(portalParts())
            model.group.position.set(px!, 0, pz!)
            model.group.rotation.y = Math.atan2(-px!, -pz!)
            for (const m of model.meshes) m.castShadow = false
            this.scene.add(model.group)
            this.portals.push(new THREE.Vector3(px!, 0, pz!))
            const ring = model.parts.get('ring')
            if (ring) this.portalRings.push(ring)
        }

        // floating voxel chunks in the sky and a star field
        for (let k = 0; k < 26; k++) {
            const a = Math.random() * Math.PI * 2
            const r = 48 + Math.random() * 40
            const g = new THREE.Group()
            const n = 3 + Math.floor(Math.random() * 5)
            for (let j = 0; j < n; j++) {
                const m = new THREE.Mesh(BOX, voxMaterial(j === 0 ? 0x2c3350 : 0x222a44, j === n - 1 ? 0x3ff0ff : 0, 0.8))
                m.position.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4)
                m.scale.setScalar(1 + Math.random() * 2.5)
                g.add(m)
            }
            g.position.set(Math.cos(a) * r, 6 + Math.random() * 26, Math.sin(a) * r)
            this.scene.add(g)
            this.skyChunks.push({ obj: g, spin: Math.random() * Math.PI, rate: 0.05 + Math.random() * 0.1 })
        }
        // sky: a painted gradient with faint nebulae, and a voxel moon
        const skyCanvas = document.createElement('canvas')
        skyCanvas.width = 512
        skyCanvas.height = 256
        const sg = skyCanvas.getContext('2d')!
        const grad = sg.createLinearGradient(0, 0, 0, 256)
        grad.addColorStop(0, '#06070f')
        grad.addColorStop(0.42, '#0c1024')
        grad.addColorStop(0.5, '#1b1538')
        grad.addColorStop(0.56, '#0e0b1c')
        grad.addColorStop(1, '#050409')
        sg.fillStyle = grad
        sg.fillRect(0, 0, 512, 256)
        for (let k = 0; k < 14; k++) {
            const nx = Math.random() * 512
            const ny = 70 + Math.random() * 70
            const r = 30 + Math.random() * 60
            const neb = sg.createRadialGradient(nx, ny, 0, nx, ny, r)
            neb.addColorStop(0, k % 2 ? 'rgba(90,60,160,0.22)' : 'rgba(40,120,170,0.18)')
            neb.addColorStop(1, 'rgba(0,0,0,0)')
            sg.fillStyle = neb
            sg.fillRect(nx - r, ny - r, r * 2, r * 2)
        }
        const skyTex = new THREE.CanvasTexture(skyCanvas)
        skyTex.mapping = THREE.EquirectangularReflectionMapping
        skyTex.colorSpace = THREE.SRGBColorSpace
        this.scene.background = skyTex
        const moon = new THREE.Group()
        for (let x = -3; x <= 3; x++) {
            for (let y = -3; y <= 3; y++) {
                for (let z = -3; z <= 3; z++) {
                    if (x * x + y * y + z * z > 10.5 || x * x + y * y + z * z < 5) continue
                    const m = new THREE.Mesh(BOX, voxMaterial((x + y) % 2 ? 0xd9d3ff : 0xbfb6ee, 0x8f86c9, 0.35))
                    m.position.set(x, y, z)
                    moon.add(m)
                }
            }
        }
        moon.scale.setScalar(3.2)
        moon.position.set(-90, 70, -140)
        this.scene.add(moon)
        this.skyChunks.push({ obj: moon, spin: 0, rate: 0.02 })
        const starGeo = new THREE.BufferGeometry()
        const starPos = new Float32Array(600 * 3)
        for (let k = 0; k < 600; k++) {
            const a = Math.random() * Math.PI * 2
            const e = Math.random() * 0.9 + 0.05
            const r = 200
            starPos[k * 3] = Math.cos(a) * Math.cos(e) * r
            starPos[k * 3 + 1] = Math.sin(e) * r
            starPos[k * 3 + 2] = Math.sin(a) * Math.cos(e) * r
        }
        starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
        const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfd6ff, size: 1.6, sizeAttenuation: true, fog: false }))
        this.scene.add(stars)
    }

    private buildPools(): void {
        const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
        this.tracers = new InstancePool(tracerMat, 400)
        this.scene.add(this.tracers.mesh)
        const shotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
        this.shotPool = new InstancePool(shotMat, 160)
        this.scene.add(this.shotPool.mesh)
        const debrisMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true })
        this.debris = new InstancePool(debrisMat, this.DEBRIS_MAX)
        this.debris.mesh.castShadow = true
        this.scene.add(this.debris.mesh)
    }

    private buildPlayer(): void {
        this.playerModel = buildModel(playerParts())
        this.playerGroup.add(this.playerModel.group)
        this.scene.add(this.playerGroup)
        const katana = buildModel(kataneParts())
        this.katana = katana.group
        const armL = this.playerModel.parts.get('armL')
        if (armL) {
            this.katana.position.set(0, -0.72, 0.1)
            this.katana.rotation.x = Math.PI / 2
            armL.add(this.katana)
        }
    }

    // ── Run flow ─────────────────────────────────────────────────────────

    private resetRun(): void {
        for (const e of this.enemies) this.scene.remove(e.model.group)
        this.enemies = []
        this.bossEnemy = null
        for (const p of this.pickups) this.scene.remove(p.group)
        this.pickups = []
        for (const fx of this.effects) {
            this.scene.remove(fx.obj)
            fx.dispose?.()
        }
        this.effects = []
        for (const cell of this.fireCells) this.scene.remove(cell.mesh)
        this.fireCells = []
        for (const b of this.blades) this.playerGroup.remove(b)
        this.blades = []
        this.projectiles = []
        this.enemyShots = []
        this.popups = []
        this.debrisLife.fill(0)
        for (let i = 0; i < this.DEBRIS_MAX; i++) this.debris.hide(i)
        this.debris.commit()
        for (let i = 0; i < this.tracers.size; i++) this.tracers.hide(i)
        this.tracers.commit()
        for (let i = 0; i < this.shotPool.size; i++) this.shotPool.hide(i)
        this.shotPool.commit()

        this.stats = defaultStats()
        this.stacks = new Map()
        this.takenUpgrades = []
        this.hp = this.stats.maxHealth
        this.energy = 0
        this.pos.set(0, 1.4, 3)
        this.vel.set(0, 0, 0)
        this.yaw = 0
        this.pitch = -0.12
        this.dashCharges = this.stats.dashCharges
        this.dashRecharge = 0
        this.dashTimer = 0
        this.invuln = 0
        this.meleeTimer = 0
        this.meleeCombo = 0
        this.frenzyStacks = 0
        this.overdriveTimer = 0
        this.secondWindUsed = false
        this.timeScale = 1
        this.chronoTimer = 0
        this.ads = 0
        this.adsHeld = false
        this.spreadBloom = 0
        this.slideTimer = 0
        this.slamming = false
        this.headshots = 0
        this.streakCount = 0
        this.event = 'none'
        for (const m of this.meteors) {
            this.scene.remove(m.mesh)
            this.scene.remove(m.warning)
        }
        this.meteors = []
        this.applyEventLighting('none')
        this.kills = 0
        this.score = 0
        this.combo = 0
        this.damageDealt = 0
        this.elapsed = 0
        this.wave = 0
        this.spawnQueue = []
        this.waveClearTimer = -1
        for (const w of this.weapons) w.model.parent?.remove(w.model)
        this.weapons = []
        this.addWeapon('pulse', true)
        this.active = 0
        this.showWeapon()
        this.syncBladeCount()
        this.playerGroup.scale.setScalar(1)
        this.playerModel.group.visible = true
        this.camInit = false
        this.syncHud()
    }

    start(): void {
        this.audio.ensure()
        this.audio.startMusic()
        this.resetRun()
        this.hud.phase = 'playing'
        this.requestLock()
        this.nextWave()
    }

    restart(): void {
        this.start()
    }

    pause(): void {
        if (this.hud.phase !== 'playing') return
        this.hud.phase = 'paused'
        this.keys.clear()
        this.mouseDown = false
        this.rightDown = false
        this.adsHeld = false
        if (document.pointerLockElement) document.exitPointerLock()
    }

    resume(): void {
        if (this.hud.phase !== 'paused') return
        this.hud.phase = 'playing'
        this.audio.ensure()
        this.requestLock()
    }

    setMuted(muted: boolean): void {
        this.audio.setMuted(muted)
    }

    requestLock(): void {
        const canvas = this.renderer?.domElement
        if (!canvas || document.pointerLockElement === canvas) return
        try {
            const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined
            p?.catch?.(() => {})
        } catch {
            // Some browsers throw synchronously when lock is refused; the game still runs unlocked.
        }
    }

    private nextWave(): void {
        this.wave++
        const plan = planWave(this.wave, randomFloat)
        this.spawnQueue = plan.spawns
        this.waveHpMult = plan.hpMult
        this.waveDmgMult = plan.damageMult
        this.maxAlive = plan.maxAlive
        this.spawnInterval = plan.spawnInterval
        this.batchSize = plan.batchSize
        this.spawnTimer = 1.6
        this.waveClearTimer = -1
        this.secondWindUsed = false
        this.audio.intensity = this.wave
        this.event = plan.event
        this.meteorTimer = 3
        this.applyEventLighting(plan.event)
        if (plan.event === 'frenzy') this.spawnInterval *= 0.7
        const eventText = plan.event === 'meteors' ? 'METEOR STORM — watch the sky' : plan.event === 'frenzy' ? 'FRENZY — everything is faster' : plan.event === 'blackout' ? 'BLACKOUT — follow the eyes' : ''
        if (plan.boss) {
            this.ui.banner(`WAVE ${this.wave}`, 'A TITAN APPROACHES', 'boss')
            this.audio.play('boss')
        } else {
            this.ui.banner(`WAVE ${this.wave}`, eventText || `${plan.spawns.length} hostiles inbound`, plan.event === 'none' ? 'wave' : 'boss')
            this.audio.play('wave-start')
        }
        this.syncHud()
    }

    private applyEventLighting(event: WaveEvent): void {
        const blackout = event === 'blackout'
        this.sun.intensity = blackout ? 0.25 : 2.6
        this.hemi.intensity = blackout ? 0.18 : 1.1
        const fog = this.scene.fog as THREE.Fog
        fog.near = blackout ? 12 : 45
        fog.far = blackout ? 60 : 140
        this.bloom.threshold = blackout ? 0.6 : 0.92
    }

    private updateMeteors(dt: number): void {
        if (this.event === 'meteors' && this.spawnQueue.length + this.enemies.length > 0) {
            this.meteorTimer -= dt
            if (this.meteorTimer <= 0) {
                this.meteorTimer = 1.1 + Math.random() * 1.4
                // aim near the player or a random spot so the storm matters
                const nearPlayer = Math.random() < 0.55
                const tx = nearPlayer ? this.pos.x + (Math.random() - 0.5) * 14 : (Math.random() - 0.5) * ARENA_HALF * 1.8
                const tz = nearPlayer ? this.pos.z + (Math.random() - 0.5) * 14 : (Math.random() - 0.5) * ARENA_HALF * 1.8
                const target = new THREE.Vector3(THREE.MathUtils.clamp(tx, -ARENA_HALF + 2, ARENA_HALF - 2), 0, THREE.MathUtils.clamp(tz, -ARENA_HALF + 2, ARENA_HALF - 2))
                target.y = this.groundHeight(target.x, target.z, 0.5, 100)
                const mesh = buildModel(meteorParts(), 1 + Math.random() * 0.8).group
                mesh.position.set(target.x + 6, target.y + 46, target.z - 4)
                this.scene.add(mesh)
                const warning = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3a3a).multiplyScalar(1.6), toneMapped: false, transparent: true, side: THREE.DoubleSide }))
                warning.rotation.x = -Math.PI / 2
                warning.position.set(target.x, target.y + 0.06, target.z)
                this.scene.add(warning)
                this.meteors.push({ target, mesh, timer: 1.5, total: 1.5, warning })
            }
        }
        for (let i = this.meteors.length - 1; i >= 0; i--) {
            const m = this.meteors[i]!
            m.timer -= dt
            const t = 1 - Math.max(0, m.timer) / m.total
            m.mesh.position.set(m.target.x + 6 * (1 - t), m.target.y + 46 * (1 - t * t), m.target.z - 4 * (1 - t))
            m.mesh.rotation.x += dt * 4
            m.mesh.rotation.y += dt * 3
            const ws = 3.5 * (1 - t) + 0.6
            m.warning.scale.set(ws, ws, 1)
            ;(m.warning.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(this.elapsed * 18) * 0.3
            if (m.timer <= 0) {
                this.scene.remove(m.mesh)
                this.scene.remove(m.warning)
                m.warning.geometry.dispose()
                ;(m.warning.material as THREE.Material).dispose()
                this.meteors.splice(i, 1)
                this.explode(m.target.clone().setY(m.target.y + 0.6), 3.6, 34 * this.waveDmgMult, 0xff7a2a, true)
                this.burst(m.target.x, m.target.y + 0.5, m.target.z, 30, [0x3a3040, 0x2c2434, 0xff7a2a], 8, 0.22)
            }
        }
    }

    private completeWave(): void {
        this.event = 'none'
        this.applyEventLighting('none')
        for (const m of this.meteors) {
            this.scene.remove(m.mesh)
            this.scene.remove(m.warning)
        }
        this.meteors = []
        this.hud.phase = 'draft'
        this.audio.play('wave-clear')
        this.ui.banner('WAVE CLEAR', 'Choose up to three upgrades', 'clear')
        this.hp = Math.min(this.stats.maxHealth, this.hp + this.stats.maxHealth * 0.25)
        this.keys.clear()
        this.mouseDown = false
        this.rightDown = false
        if (document.pointerLockElement) document.exitPointerLock()
        const cards = dealDraft({
            wave: this.wave,
            stacks: this.stacks,
            ownedWeapons: this.weapons.map(w => w.def.id),
            rng: randomFloat
        })
        this.ui.draft(cards)
    }

    /** Called by the UI once the player confirms their picks. */
    applyDraft(cards: DraftCard[]): void {
        for (const card of cards) {
            if (card.kind === 'weapon' && card.weaponId) {
                this.addWeapon(card.weaponId, false)
            } else {
                const before = this.stats.maxHealth
                applyCard(card, this.stats, this.stacks)
                if (card.id === 'health') this.hp = this.stats.maxHealth
                else if (this.stats.maxHealth > before) this.hp += this.stats.maxHealth - before
                this.hp = Math.min(this.hp, this.stats.maxHealth)
            }
            this.takenUpgrades.push(card.name)
        }
        this.dashCharges = Math.min(this.stats.dashCharges, this.dashCharges + 1)
        this.syncBladeCount()
        this.playerGroup.scale.setScalar(this.stats.scale)
        for (const w of this.weapons) {
            w.ammo = magazineSize(w.def, this.stats)
            w.reloading = false
        }
        this.audio.play('upgrade')
        this.hud.phase = 'playing'
        this.requestLock()
        this.nextWave()
    }

    private die(): void {
        this.hud.phase = 'dead'
        this.audio.play('death')
        this.audio.stopMusic()
        this.keys.clear()
        this.mouseDown = false
        if (document.pointerLockElement) document.exitPointerLock()
        let bestWave = 0
        let bestScore = 0
        try {
            const raw = localStorage.getItem(BEST_KEY)
            if (raw) {
                const parsed = JSON.parse(raw) as { wave?: number, score?: number }
                bestWave = parsed.wave ?? 0
                bestScore = parsed.score ?? 0
            }
        } catch {
            // storage unavailable — best-run tracking is a convenience only
        }
        const newBest = this.score > bestScore || this.wave > bestWave
        bestWave = Math.max(bestWave, this.wave)
        bestScore = Math.max(bestScore, this.score)
        try {
            localStorage.setItem(BEST_KEY, JSON.stringify({ wave: bestWave, score: bestScore }))
        } catch {
            // ignore
        }
        this.burst(this.pos.x, this.pos.y + 1, this.pos.z, 90, [0xe9e4d6, 0xd9a63c, 0x3ff0ff], 9, 0.28)
        this.playerModel.group.visible = false
        this.ui.dead({
            wave: this.wave,
            score: this.score,
            kills: this.kills,
            time: this.elapsed,
            damage: Math.round(this.damageDealt),
            bestWave,
            bestScore,
            newBest,
            upgrades: this.takenUpgrades,
            headshots: this.headshots
        })
    }

    // ── Input ────────────────────────────────────────────────────────────

    private onKeyDown = (e: KeyboardEvent): void => {
        if (e.repeat) return
        const code = e.code
        if (code === 'Escape') {
            if (this.hud.phase === 'playing') this.pause()
            return
        }
        if (this.hud.phase !== 'playing') return
        this.keys.add(code)
        if (code === 'Space') {
            e.preventDefault()
            this.jump()
        } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
            this.dash()
        } else if (code === 'KeyR') {
            this.startReload()
        } else if (code === 'KeyQ') {
            this.nova()
        } else if (code === 'KeyF' || code === 'KeyV') {
            this.melee()
        } else if (code === 'ControlLeft' || code === 'ControlRight') {
            this.slide()
        } else if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
            this.switchWeapon(Number(code.slice(5)) - 1)
        }
    }

    private onKeyUp = (e: KeyboardEvent): void => {
        this.keys.delete(e.code)
    }

    private onBlur = (): void => {
        this.keys.clear()
        this.mouseDown = false
        this.rightDown = false
        this.adsHeld = false
    }

    private onMouseMove = (e: MouseEvent): void => {
        if (!this.locked || this.hud.phase !== 'playing') return
        // aiming zooms the view, so scale sensitivity by the zoom to keep the feel constant
        const sens = 0.0022 * (this.camera.fov / 75)
        this.yaw -= e.movementX * sens
        this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * sens, -1.1, 0.9)
    }

    private onMouseDown = (e: MouseEvent): void => {
        if (this.hud.phase !== 'playing') return
        if (!this.locked) {
            this.requestLock()
            return
        }
        if (e.button === 0) {
            this.mouseDown = true
            this.mouseJustDown = true
        } else if (e.button === 2) {
            this.rightDown = true
            this.adsHeld = true
        }
    }

    private onMouseUp = (e: MouseEvent): void => {
        if (e.button === 0) this.mouseDown = false
        if (e.button === 2) {
            this.rightDown = false
            this.adsHeld = false
        }
    }

    private onWheel = (e: WheelEvent): void => {
        if (!this.locked || this.hud.phase !== 'playing') return
        e.preventDefault()
        this.wheelDelta += e.deltaY
        if (Math.abs(this.wheelDelta) > 40) {
            this.switchWeapon((this.active + (this.wheelDelta > 0 ? 1 : this.weapons.length - 1)) % this.weapons.length)
            this.wheelDelta = 0
        }
    }

    private onContext = (e: Event): void => {
        if (this.hud.phase === 'playing') e.preventDefault()
    }

    private onLockChange = (): void => {
        this.locked = document.pointerLockElement === this.renderer.domElement
        this.hud.locked = this.locked
        if (!this.locked && this.hud.phase === 'playing') this.pause()
    }

    // ── Player ───────────────────────────────────────────────────────────

    private forward(out: THREE.Vector3): THREE.Vector3 {
        return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    }

    private aimDir(out: THREE.Vector3): THREE.Vector3 {
        const cp = Math.cos(this.pitch)
        return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp)
    }

    private playerCenter(out: THREE.Vector3): THREE.Vector3 {
        return out.set(this.pos.x, this.pos.y + 1.1 * this.stats.scale, this.pos.z)
    }

    private get playerRadius(): number {
        return 0.5 * this.stats.scale
    }

    private frenzyMult(): number {
        return 1 + this.frenzyStacks * 0.06
    }

    private slide(): void {
        if (!this.onGround || this.slideTimer > 0 || this.dashTimer > 0) return
        const dir = this.wishDir(_v1)
        if (dir.lengthSq() < 0.01) return
        this.slideDir.copy(dir).normalize()
        this.slideTimer = 0.7
        this.audio.play('dash', 0.5)
        this.burst(this.pos.x, this.pos.y + 0.1, this.pos.z, 8, [0x8a8f9c, 0x3ff0ff], 3, 0.1)
    }

    private jump(): void {
        if (this.slamming) return
        if (this.onGround && this.slideTimer > 0) {
            // bullet jump: a slide-cancelled leap that launches you along the slide
            this.slideTimer = 0
            const boost = 19 * (1 + (this.stats.moveSpeed / 9 - 1) * 0.5)
            this.vel.x = this.slideDir.x * boost
            this.vel.z = this.slideDir.z * boost
            this.vel.y = 12
            this.onGround = false
            this.jumpsUsed = 1
            this.invuln = Math.max(this.invuln, 0.15)
            this.fovKick = 1
            this.audio.play('dash', 0.9)
            this.audio.play('jump', 0.6)
            this.burst(this.pos.x, this.pos.y + 0.4, this.pos.z, 22, [0x3ff0ff, 0xe9e4d6, 0xd9a63c], 6, 0.14)
            this.spawnShockwave(this.pos, 2.2, 0x3ff0ff, 0.3)
            return
        }
        if (this.onGround) {
            this.vel.y = 12.5
            this.onGround = false
            this.jumpsUsed = 1
            this.audio.play('jump', 0.6)
        } else if (this.jumpsUsed < this.stats.jumpCharges) {
            this.vel.y = 11.5
            this.jumpsUsed++
            this.audio.play('jump', 0.8)
            this.burst(this.pos.x, this.pos.y, this.pos.z, 10, [0x3ff0ff, 0xffffff], 3, 0.12)
        }
    }

    private dash(): void {
        if (this.dashCharges <= 0 || this.dashTimer > 0) return
        const dir = this.wishDir(_v1)
        if (dir.lengthSq() < 0.01) this.forward(dir)
        this.dashDir.copy(dir).normalize()
        this.dashTimer = 0.2
        if (this.dashCharges >= this.stats.dashCharges) this.dashRecharge = this.stats.dashCooldown
        this.dashCharges--
        this.invuln = Math.max(this.invuln, 0.25)
        this.fovKick = 1
        this.audio.play('dash')
        this.burst(this.pos.x, this.pos.y + 0.6, this.pos.z, 14, [0x3ff0ff, 0xe9e4d6], 4, 0.14)
    }

    private wishDir(out: THREE.Vector3): THREE.Vector3 {
        out.set(0, 0, 0)
        const f = this.forward(_v2)
        const r = _v3.set(-f.z, 0, f.x)
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) out.add(f)
        if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) out.sub(f)
        if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) out.add(r)
        if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) out.sub(r)
        if (out.lengthSq() > 1) out.normalize()
        return out
    }

    private updatePlayer(dt: number): void {
        const s = this.stats
        // timers
        if (this.dashCharges < s.dashCharges) {
            this.dashRecharge -= dt
            if (this.dashRecharge <= 0) {
                this.dashCharges++
                this.dashRecharge = s.dashCooldown
            }
        }
        if (this.invuln > 0) this.invuln -= dt
        if (this.frenzyTimer > 0) {
            this.frenzyTimer -= dt
            if (this.frenzyTimer <= 0) this.frenzyStacks = 0
        }
        if (this.overdriveTimer > 0) this.overdriveTimer -= dt
        if (this.meleeComboTimer > 0) {
            this.meleeComboTimer -= dt
            if (this.meleeComboTimer <= 0) this.meleeCombo = 0
        }
        if (this.regenDelay > 0) this.regenDelay -= dt
        else if (s.healthRegen > 0 && this.hp < s.maxHealth) this.hp = Math.min(s.maxHealth, this.hp + s.healthRegen * dt)

        // zoom blend — aiming in the air also glides
        const wantAds = this.adsHeld && this.meleeTimer <= 0 && this.dashTimer <= 0
        this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 12)
        if (this.ads < 0.002) this.ads = 0
        this.spreadBloom = Math.max(0, this.spreadBloom - dt * 0.09)
        const gliding = wantAds && !this.onGround && !this.slamming && this.vel.y < 2 && this.glideTime < 1.6
        if (gliding) this.glideTime += dt
        if (this.onGround) this.glideTime = 0
        this.hud.gliding = gliding

        // horizontal movement
        const wish = this.wishDir(_v1)
        const speed = s.moveSpeed * this.frenzyMult() * (1 - this.ads * 0.3)
        if (this.slideTimer > 0) {
            this.slideTimer -= dt
            const t = this.slideTimer / 0.7
            this.vel.x = this.slideDir.x * speed * (0.9 + t * 0.9)
            this.vel.z = this.slideDir.z * speed * (0.9 + t * 0.9)
            if (!this.onGround) this.slideTimer = 0
        } else if (this.dashTimer > 0) {
            this.dashTimer -= dt
            this.vel.x = this.dashDir.x * 26
            this.vel.z = this.dashDir.z * 26
            this.dashTrailTimer -= dt
            if (s.fireTrail > 0 && this.dashTrailTimer <= 0) {
                this.dashTrailTimer = 0.07
                this.spawnFireCell(this.pos.x, this.pos.z)
            }
        } else {
            const accel = this.onGround ? 16 : 7
            const tx = wish.x * speed
            const tz = wish.z * speed
            this.vel.x += (tx - this.vel.x) * Math.min(1, accel * dt)
            this.vel.z += (tz - this.vel.z) * Math.min(1, accel * dt)
        }
        // melee lunge
        if (this.meleeTimer > 0 && this.meleeTimer > MELEE.swingTime * 0.4) {
            const f = this.forward(_v2)
            this.vel.x += f.x * MELEE.lunge * dt * 4
            this.vel.z += f.z * MELEE.lunge * dt * 4
        }

        this.vel.y -= GRAVITY * dt * (this.slamming ? 4 : gliding ? 0.12 : 1)
        if (gliding && this.vel.y < -3) this.vel.y += (-3 - this.vel.y) * Math.min(1, dt * 8)
        this.pos.x += this.vel.x * dt
        this.pos.z += this.vel.z * dt
        this.resolveWalls(this.pos, this.playerRadius, this.pos.y, 1.8 * s.scale)
        const ground = this.groundHeight(this.pos.x, this.pos.z, this.playerRadius, this.pos.y + (this.onGround ? STEP_HEIGHT : 0.05))
        this.pos.y += this.vel.y * dt
        if (this.pos.y <= ground) {
            if (!this.onGround && this.vel.y < -14) this.burst(this.pos.x, ground, this.pos.z, 8, [0x8a8f9c], 3, 0.1)
            if (this.slamming) this.landSlam()
            this.pos.y = ground
            this.vel.y = 0
            this.onGround = true
            this.jumpsUsed = 0
        } else if (this.pos.y > ground + 0.08) {
            this.onGround = false
        }

        // animate the voxel body
        const moving = Math.hypot(this.vel.x, this.vel.z)
        this.walkPhase += moving * dt * 1.6
        const m = this.playerModel
        const swing = Math.sin(this.walkPhase) * Math.min(1, moving / 6) * 0.8
        const legL = m.parts.get('legL')
        const legR = m.parts.get('legR')
        const armL = m.parts.get('armL')
        const armR = m.parts.get('armR')
        const head = m.parts.get('head')
        if (legL) legL.rotation.x = this.onGround ? swing : 0.5
        if (legR) legR.rotation.x = this.onGround ? -swing : -0.3
        if (armR) armR.rotation.x = -Math.PI / 2 - this.pitch + this.recoilPitch * 0.6
        if (armL) {
            const meleeT = this.meleeTimer > 0 ? 1 - this.meleeTimer / MELEE.swingTime : 0
            armL.rotation.x = this.meleeTimer > 0 ? -Math.PI * 0.9 + meleeT * Math.PI * 1.1 : -0.3 - swing * 0.4
            armL.rotation.z = this.meleeTimer > 0 ? 0.5 - meleeT : 0
        }
        if (head) head.rotation.x = -this.pitch * 0.5
        m.group.rotation.y = this.yaw + Math.PI
        m.group.rotation.x = this.dashTimer > 0 ? 0.35 : this.slideTimer > 0 ? -0.55 : moving > 1 ? 0.08 : 0
        m.group.position.z = this.slideTimer > 0 ? 0.3 : 0
        if (this.slideTimer > 0) {
            if (legL) legL.rotation.x = -1.3
            if (legR) legR.rotation.x = 0.4
        }
        m.group.position.y = this.slideTimer > 0 ? -0.35 : this.onGround ? Math.abs(Math.sin(this.walkPhase)) * 0.06 * Math.min(1, moving / 6) : 0
        if (gliding) {
            if (legL) legL.rotation.x = 0.9
            if (legR) legR.rotation.x = 0.6
            m.group.rotation.x = -0.15
        }
        this.katana.visible = this.meleeTimer > 0 || this.meleeComboTimer > 0
        this.playerGroup.position.copy(this.pos)
        this.recoilPitch *= Math.max(0, 1 - dt * 14)

        // combat inputs held — after posing so the muzzle matches the drawn gun
        if (this.mouseDown || this.mouseJustDown) this.tryFire()
        this.mouseJustDown = false
        this.updateWeapon(dt)
        this.updateMelee(dt)
        this.updateBlades(dt)
        this.updateAura(dt)
    }

    private groundHeight(x: number, z: number, radius: number, maxTop: number): number {
        let best = 0
        for (const b of this.colliders) {
            if (x + radius * 0.6 < b.min.x || x - radius * 0.6 > b.max.x || z + radius * 0.6 < b.min.z || z - radius * 0.6 > b.max.z) continue
            if (b.max.y <= maxTop && b.max.y > best) best = b.max.y
        }
        return best
    }

    /** Pushes a circle out of every collider it overlaps, honouring step-up. */
    private resolveWalls(p: THREE.Vector3, radius: number, feetY: number, height: number): void {
        const lim = ARENA_HALF - radius
        p.x = THREE.MathUtils.clamp(p.x, -lim, lim)
        p.z = THREE.MathUtils.clamp(p.z, -lim, lim)
        for (const b of this.colliders) {
            if (feetY >= b.max.y - STEP_HEIGHT || feetY + height <= b.min.y) continue
            const cx = THREE.MathUtils.clamp(p.x, b.min.x, b.max.x)
            const cz = THREE.MathUtils.clamp(p.z, b.min.z, b.max.z)
            const dx = p.x - cx
            const dz = p.z - cz
            const d2 = dx * dx + dz * dz
            if (d2 >= radius * radius) continue
            if (d2 < 1e-6) {
                // centre is inside the box — push out along the thinnest axis
                const pushX = p.x < (b.min.x + b.max.x) / 2 ? b.min.x - radius - p.x : b.max.x + radius - p.x
                const pushZ = p.z < (b.min.z + b.max.z) / 2 ? b.min.z - radius - p.z : b.max.z + radius - p.z
                if (Math.abs(pushX) < Math.abs(pushZ)) p.x += pushX
                else p.z += pushZ
            } else {
                const d = Math.sqrt(d2)
                p.x += dx / d * (radius - d)
                p.z += dz / d * (radius - d)
            }
        }
    }

    private updateCamera(dt: number): void {
        const s = this.stats
        const target = this.playerCenter(_v1)
        target.y += 0.5 * s.scale
        const f = this.aimDir(_v2)
        const right = _v3.set(-f.z, 0, f.x).normalize()
        const zoom = this.ads
        const back = (5.4 + s.scale * 0.8) * (1 - zoom * 0.5)
        const desired = target.clone().addScaledVector(f, -back).addScaledVector(right, 1.15 - zoom * 0.25).addScaledVector(UP, 0.9 - zoom * 0.45)
        // pull the camera in when the view is blocked by a prop or wall
        const ray = new THREE.Ray(target, desired.clone().sub(target).normalize())
        let dist = target.distanceTo(desired)
        for (const b of this.colliders) {
            const hit = ray.intersectBox(b, new THREE.Vector3())
            if (hit) dist = Math.min(dist, target.distanceTo(hit) - 0.3)
        }
        const lim = ARENA_HALF + 1.4
        dist = Math.max(0.9, dist)
        desired.copy(target).addScaledVector(ray.direction, dist)
        // when a wall pushes the camera into the body, hide the body instead of clipping through it
        this.playerModel.group.visible = this.hud.phase !== 'dead' && dist > 1.9
        desired.x = THREE.MathUtils.clamp(desired.x, -lim, lim)
        desired.z = THREE.MathUtils.clamp(desired.z, -lim, lim)
        desired.y = Math.max(0.4, desired.y)
        // a touch of positional smoothing takes the jitter out of jumps and slides; aim stays instant
        if (!this.camInit) {
            this.camPos.copy(desired)
            this.camInit = true
        } else {
            this.camPos.lerp(desired, Math.min(1, dt * 22))
        }
        this.camera.position.copy(this.camPos)
        this.camera.rotation.set(this.pitch + this.recoilPitch * 0.35, this.yaw, this.slideTimer > 0 ? 0.04 : 0, 'YXZ')
        // shake
        if (this.shake > 0) {
            this.shake = Math.max(0, this.shake - dt * 3)
            this.shakeVec.set((Math.random() - 0.5), (Math.random() - 0.5), 0).multiplyScalar(this.shake * 0.35)
            this.camera.position.add(this.shakeVec)
            this.camera.rotation.z += (Math.random() - 0.5) * this.shake * 0.05
        }
        this.fovKick = Math.max(0, this.fovKick - dt * 4)
        const w = this.weapon
        const adsFov = w ? w.def.adsFov : 55
        const fov = THREE.MathUtils.lerp(75 + this.fovKick * 12 + (this.overdriveTimer > 0 ? 4 : 0), adsFov, this.ads)
        if (Math.abs(this.camera.fov - fov) > 0.05) {
            this.camera.fov = fov
            this.camera.updateProjectionMatrix()
        }
        this.sun.target.position.copy(this.pos)
        this.sun.position.set(this.pos.x + 28, 52, this.pos.z + 18)
    }

    // ── Weapons ──────────────────────────────────────────────────────────

    private addWeapon(id: WeaponId, silent: boolean): void {
        const existing = this.weapons.findIndex(w => w.def.id === id)
        if (existing >= 0) {
            this.weapons[existing]!.ammo = magazineSize(this.weapons[existing]!.def, this.stats)
            this.switchWeapon(existing)
            return
        }
        const def = WEAPONS[id]
        const model = buildModel(weaponParts(id)).group
        model.position.set(0, -0.74, 0.14)
        model.rotation.x = Math.PI / 2
        model.visible = false
        const armR = this.playerModel.parts.get('armR')
        armR?.add(model)
        const state: WeaponState = { def, ammo: magazineSize(def, this.stats), reloading: false, reloadTimer: 0, fireTimer: 0, model }
        if (this.weapons.length >= MAX_WEAPONS) {
            const old = this.weapons[this.active]!
            old.model.parent?.remove(old.model)
            this.weapons[this.active] = state
            if (!silent) this.ui.toast(`${def.name} replaced ${old.def.name}`, hexToCss(def.color))
        } else {
            this.weapons.push(state)
            this.active = this.weapons.length - 1
            if (!silent) this.ui.toast(`${def.name} acquired`, hexToCss(def.color))
        }
        if (!silent) this.audio.play('pickup-weapon')
        this.showWeapon()
    }

    private showWeapon(): void {
        this.weapons.forEach((w, i) => { w.model.visible = i === this.active })
    }

    private switchWeapon(index: number): void {
        if (index < 0 || index >= this.weapons.length || index === this.active) return
        const cur = this.weapons[this.active]
        if (cur?.reloading) {
            cur.reloading = false
            cur.reloadTimer = 0
        }
        this.active = index
        this.showWeapon()
        this.audio.play('select', 0.7)
    }

    private get weapon(): WeaponState {
        return this.weapons[this.active]!
    }

    private startReload(): void {
        const w = this.weapon
        const mag = magazineSize(w.def, this.stats)
        if (w.reloading || w.ammo >= mag) return
        w.reloading = true
        w.reloadTimer = w.def.reloadTime * this.stats.reloadMult
        this.audio.play('reload')
    }

    private updateWeapon(dt: number): void {
        for (const w of this.weapons) {
            if (w.fireTimer > 0) w.fireTimer -= dt
            if (w.reloading) {
                w.reloadTimer -= dt
                if (w.reloadTimer <= 0) {
                    w.reloading = false
                    w.ammo = magazineSize(w.def, this.stats)
                    if (w === this.weapon) this.audio.play('reload-done')
                }
            }
        }
        this.muzzleLight.intensity *= Math.max(0, 1 - dt * 22)
        this.flashLight.intensity *= Math.max(0, 1 - dt * 9)
        // the held weapon tilts with reload
        const w = this.weapon
        if (w) {
            const total = w.def.reloadTime * this.stats.reloadMult
            const t = w.reloading ? 1 - w.reloadTimer / total : 0
            w.model.rotation.z = w.reloading ? Math.sin(t * Math.PI) * 0.9 : 0
        }
    }

    private muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
        const w = this.weapon
        this.playerGroup.updateMatrixWorld(true)
        return w.model.localToWorld(out.set(0, 0, 0.75))
    }

    /** World point under the crosshair: nearest enemy, prop, floor, or far away. */
    private aimPoint(out: THREE.Vector3): THREE.Vector3 {
        const origin = this.camera.position
        const dir = this.aimDir(_v2)
        let best = 90
        for (const e of this.enemies) {
            if (!e.alive || e.state === 'spawn') continue
            const c = _v3.set(e.pos.x, e.pos.y + e.height * e.scale * 0.5, e.pos.z)
            const end = out.copy(origin).addScaledVector(dir, best)
            const t = segmentSphere(origin, end, c, e.radius * e.scale * 1.1)
            if (t >= 0) {
                const d = t * best
                if (d > 2.5 && d < best) best = d
            }
        }
        const ray = new THREE.Ray(origin, dir)
        for (const b of this.colliders) {
            const hit = ray.intersectBox(b, out)
            if (hit) {
                const d = origin.distanceTo(hit)
                if (d > 2.5 && d < best) best = d
            }
        }
        if (dir.y < 0) {
            const d = -origin.y / dir.y
            if (d > 2.5 && d < best) best = d
        }
        return out.copy(origin).addScaledVector(dir, best)
    }

    private tryFire(): void {
        const w = this.weapon
        if (!w || this.meleeTimer > 0) return
        if (!w.def.auto && !this.mouseJustDown) return
        if (w.fireTimer > 0) return
        if (w.reloading) return
        if (w.ammo <= 0) {
            this.startReload()
            if (this.mouseJustDown) this.audio.play('dry', 0.5)
            return
        }
        w.ammo--
        const rate = w.def.fireRate * this.stats.fireRateMult * this.frenzyMult()
        w.fireTimer = 1 / rate
        const muzzle = this.muzzleWorld(new THREE.Vector3())
        const aim = this.aimPoint(new THREE.Vector3())
        const dir = aim.sub(muzzle).normalize()
        const color = new THREE.Color(w.def.color)
        this.audio.play(`shoot-${w.def.id}` as ArenaSound)
        this.recoilPitch += w.def.recoil * 0.02 * (1 - this.ads * 0.4)
        this.yaw += (Math.random() - 0.5) * w.def.recoil * 0.004
        this.shake = Math.max(this.shake, w.def.recoil * 0.12)
        const spreadMult = THREE.MathUtils.lerp(1, w.def.adsSpread, this.ads)
        const baseSpread = (w.def.spread + this.spreadBloom) * spreadMult
        this.spreadBloom = Math.min(0.09, this.spreadBloom + w.def.bloom)
        this.muzzleLight.color.set(w.def.color)
        this.muzzleLight.position.copy(muzzle)
        this.muzzleLight.intensity = 6 + w.def.recoil * 3
        this.spawnMuzzleFlash(muzzle, dir, color, 0.35 + w.def.recoil * 0.1)

        const dmg = w.def.damage * this.stats.damageMult
        if (w.def.kind === 'rail') {
            this.fireRail(muzzle, dir, dmg, w.def)
        } else if (w.def.kind === 'arc') {
            this.fireArc(muzzle, dir, dmg, w.def)
        } else {
            const count = w.def.pellets + this.stats.splitShot
            for (let i = 0; i < count; i++) {
                const d = dir.clone()
                const spread = baseSpread + (i >= w.def.pellets ? 0.05 : 0)
                if (spread > 0) {
                    d.x += (Math.random() - 0.5) * spread * 2
                    d.y += (Math.random() - 0.5) * spread * 2
                    d.z += (Math.random() - 0.5) * spread * 2
                    d.normalize()
                }
                this.projectiles.push({
                    pos: muzzle.clone(),
                    vel: d.multiplyScalar(w.def.projectileSpeed * this.stats.projectileSpeedMult),
                    life: 2.6,
                    damage: dmg,
                    def: w.def,
                    color,
                    size: (w.def.kind === 'plasma' ? 0.42 : w.def.kind === 'disc' ? 0.55 : 0.13) * (1 + this.stats.bulletSize * 0.6),
                    pierceLeft: w.def.pierce + this.stats.pierce,
                    ricochetLeft: w.def.ricochet + this.stats.ricochet,
                    hit: new Set(),
                    homing: w.def.homing + this.stats.homing * 3,
                    explosionRadius: w.def.explosionRadius,
                    spin: Math.random() * Math.PI,
                    alive: true
                })
            }
        }
        if (w.ammo <= 0) this.startReload()
    }

    private fireRail(origin: THREE.Vector3, dir: THREE.Vector3, damage: number, def: WeaponDef): void {
        const maxDist = 90
        const end = origin.clone().addScaledVector(dir, maxDist)
        const hits: { e: Enemy, t: number }[] = []
        for (const e of this.enemies) {
            if (!e.alive || e.state === 'spawn') continue
            const c = _v3.set(e.pos.x, e.pos.y + e.height * e.scale * 0.5, e.pos.z)
            const t = segmentSphere(origin, end, c, e.radius * e.scale * 1.15)
            if (t >= 0) hits.push({ e, t })
        }
        hits.sort((a, b) => a.t - b.t)
        const pierce = def.pierce + this.stats.pierce
        let count = 0
        for (const h of hits) {
            if (count > pierce) break
            const p = origin.clone().lerp(end, h.t)
            if (this.shieldBlocks(h.e, dir)) {
                this.blockedHit(h.e, p)
                break
            }
            const fall = Math.pow(0.85, count)
            const head = this.headCenter(h.e, _v1)
            const headshot = !!head && segmentSphere(origin, end, head, h.e.def.headRadius * h.e.scale * 1.2) >= 0
            this.hitEnemy(h.e, damage * fall, dir, def.knockback, 'bullet', headshot)
            this.burst(p.x, p.y, p.z, 10, [def.color, 0xffffff], 5, 0.1)
            count++
        }
        // beam is drawn to the far point, or where it stops piercing
        let stopT = 1
        for (const b of this.colliders) {
            const hit = new THREE.Ray(origin, dir).intersectBox(b, _v1)
            if (hit) stopT = Math.min(stopT, origin.distanceTo(hit) / maxDist)
        }
        const beamEnd = origin.clone().lerp(end, stopT)
        this.spawnBeam(origin, beamEnd, 0xffffff, 0.08, 0.2)
        this.spawnBeam(origin, beamEnd, def.color, 0.28, 0.32)
        this.burst(beamEnd.x, beamEnd.y, beamEnd.z, 8, [def.color], 4, 0.1)
        this.shake = Math.max(this.shake, 0.5)
    }

    private fireArc(origin: THREE.Vector3, dir: THREE.Vector3, damage: number, def: WeaponDef): void {
        const maxDist = 42
        const end = origin.clone().addScaledVector(dir, maxDist)
        let first: Enemy | null = null
        let bestT = 2
        for (const e of this.enemies) {
            if (!e.alive || e.state === 'spawn') continue
            const c = _v3.set(e.pos.x, e.pos.y + e.height * e.scale * 0.5, e.pos.z)
            const t = segmentSphere(origin, end, c, e.radius * e.scale * 1.6)
            if (t >= 0 && t < bestT) {
                bestT = t
                first = e
            }
        }
        if (!first) {
            this.spawnLightning(origin, end.clone().lerp(origin, 0.55), def.color, 0.12)
            return
        }
        const hit = new Set<number>()
        let from = origin.clone()
        let target: Enemy | null = first
        let dmg = damage
        const chain = def.chain + this.stats.chainLightning
        for (let i = 0; i <= chain && target; i++) {
            const c = new THREE.Vector3(target.pos.x, target.pos.y + target.height * target.scale * 0.5, target.pos.z)
            this.spawnLightning(from, c, def.color, 0.14)
            this.hitEnemy(target, dmg, c.clone().sub(from).normalize(), def.knockback, 'bullet')
            hit.add(target.id)
            from = c
            dmg *= 0.75
            target = this.nearestEnemy(c, 8, hit)
        }
    }

    /** World-space centre of the head hit-sphere, or null for headless enemies. */
    private headCenter(e: Enemy, out: THREE.Vector3): THREE.Vector3 | null {
        if (e.def.headRadius <= 0) return null
        const fz = e.def.id === 'charger' ? 0.85 : 0.05
        out.set(e.pos.x + Math.sin(e.yaw) * fz * e.scale, e.pos.y + e.def.headY * e.scale, e.pos.z + Math.cos(e.yaw) * fz * e.scale)
        return out
    }

    /** True when a bullet travelling along `dir` hits a Warden's raised shield. */
    private shieldBlocks(e: Enemy, dir: THREE.Vector3): boolean {
        if (!e.def.shieldArc || e.state === 'stunned') return false
        const fx = Math.sin(e.yaw)
        const fz = Math.cos(e.yaw)
        const len = Math.hypot(dir.x, dir.z) || 1
        const dot = (-dir.x * fx - dir.z * fz) / len
        return dot > Math.cos(e.def.shieldArc)
    }

    private blockedHit(e: Enemy, at: THREE.Vector3): void {
        this.burst(at.x, at.y, at.z, 6, [0x3ff0ff, 0xffffff], 4, 0.08)
        this.popup(at, 'BLOCKED', '#67e8f9', 12)
        this.hitMarker = 0.1
        this.hud.hitKind = 'block'
        if (this.hitSoundTimer <= 0) {
            this.audio.play('hit', 0.3)
            this.hitSoundTimer = 0.05
        }
        e.barTimer = 1.5
    }

    private nearestEnemy(from: THREE.Vector3, range: number, exclude?: Set<number>): Enemy | null {
        let best: Enemy | null = null
        let bestD = range * range
        for (const e of this.enemies) {
            if (!e.alive || e.state === 'spawn' || exclude?.has(e.id)) continue
            const d = (e.pos.x - from.x) ** 2 + (e.pos.y + e.height * e.scale * 0.5 - from.y) ** 2 + (e.pos.z - from.z) ** 2
            if (d < bestD) {
                bestD = d
                best = e
            }
        }
        return best
    }

    // ── Melee ────────────────────────────────────────────────────────────

    private melee(): void {
        if (this.meleeTimer > 0 || this.slamming) return
        if (!this.onGround && this.pos.y - this.groundHeight(this.pos.x, this.pos.z, this.playerRadius, this.pos.y) > 1.4) {
            // aerial slam: drop like a stone and detonate on landing
            this.slamming = true
            this.vel.y = Math.min(this.vel.y, -6)
            this.vel.x *= 0.3
            this.vel.z *= 0.3
            this.audio.play('charge', 0.5)
            this.fovKick = 0.8
            return
        }
        this.meleeTimer = MELEE.swingTime
        this.meleeHitDone = false
        this.meleeComboTimer = MELEE.comboWindow
        this.audio.play('slash', this.meleeCombo === 3 ? 1.3 : 1)
        this.fovKick = Math.max(this.fovKick, 0.4)
    }

    private updateMelee(dt: number): void {
        if (this.meleeTimer <= 0) return
        this.meleeTimer -= dt
        const mid = MELEE.swingTime * 0.55
        if (!this.meleeHitDone && this.meleeTimer <= mid) {
            this.meleeHitDone = true
            const finisher = this.meleeCombo === 3
            const range = MELEE.range * this.stats.meleeRangeMult * this.stats.scale
            const dmg = MELEE.damage * this.stats.meleeDamageMult * this.stats.damageMult * (finisher ? MELEE.finisherMult : 1)
            const f = this.forward(_v2)
            const center = this.playerCenter(_v1)
            let any = false
            for (const e of this.enemies) {
                if (!e.alive || e.state === 'spawn') continue
                const dx = e.pos.x - center.x
                const dz = e.pos.z - center.z
                const dy = (e.pos.y + e.height * e.scale * 0.5) - center.y
                const d = Math.hypot(dx, dz)
                if (d > range + e.radius * e.scale || Math.abs(dy) > 2.6) continue
                const dot = (dx * f.x + dz * f.z) / Math.max(0.001, d)
                if (dot < Math.cos(MELEE.arc / 2) && d > 1) continue
                this.hitEnemy(e, dmg, _v3.set(dx, 0, dz).normalize(), MELEE.knockback * (finisher ? 2 : 1), 'melee')
                any = true
            }
            if (any) {
                this.audio.play('slash-hit')
                this.shake = Math.max(this.shake, finisher ? 0.7 : 0.3)
            }
            this.spawnSlash(center, f, range, finisher)
            this.meleeCombo = finisher ? 0 : this.meleeCombo + 1
        }
    }

    private landSlam(): void {
        this.slamming = false
        const radius = MELEE.slamRadius * this.stats.meleeRangeMult * this.stats.scale
        const dmg = MELEE.slamDamage * this.stats.meleeDamageMult * this.stats.damageMult
        for (const e of this.enemies) {
            if (!e.alive || e.state === 'spawn') continue
            const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z)
            if (d > radius + e.radius * e.scale || Math.abs(e.pos.y - this.pos.y) > 2.5) continue
            this.hitEnemy(e, dmg * (1 - d / (radius * 2)), _v1.set(e.pos.x - this.pos.x, 0.3, e.pos.z - this.pos.z).normalize(), 14, 'melee')
        }
        this.spawnShockwave(this.pos, radius, 0xd9a63c, 0.45)
        this.burst(this.pos.x, this.pos.y + 0.2, this.pos.z, 40, [0xd9a63c, 0x3ff0ff, 0x8a8f9c], 7, 0.16)
        this.audio.play('slam', 0.8)
        this.shake = Math.max(this.shake, 0.9)
        this.meleeComboTimer = MELEE.comboWindow
        this.meleeCombo = 0
    }

    // ── Nova ability ─────────────────────────────────────────────────────

    private nova(): void {
        const cost = this.stats.abilityCost
        if (this.energy < cost) {
            this.audio.play('dry', 0.4)
            return
        }
        this.energy -= cost
        const radius = 9 * this.stats.scale
        const dmg = 70 * this.stats.abilityMult * this.stats.damageMult
        const center = this.playerCenter(new THREE.Vector3())
        for (const e of this.enemies) {
            if (!e.alive || e.state === 'spawn') continue
            const d = e.pos.distanceTo(this.pos)
            if (d > radius + e.radius * e.scale) continue
            const dir = _v1.copy(e.pos).sub(this.pos).setY(0.4).normalize()
            this.hitEnemy(e, dmg * (1 - d / (radius * 1.6)), dir, 18, 'nova')
            e.state = 'stunned'
            e.stateTimer = Math.max(e.stateTimer, 0.9)
        }
        for (const shot of this.enemyShots) if (shot.pos.distanceTo(center) < radius) shot.alive = false
        this.spawnShockwave(this.pos, radius, 0x3ff0ff, 0.5)
        this.burst(center.x, center.y, center.z, 70, [0x3ff0ff, 0xffffff, 0xd9a63c], 10, 0.18)
        this.flashLight.color.set(0x3ff0ff)
        this.flashLight.position.copy(center)
        this.flashLight.intensity = 40
        this.shake = Math.max(this.shake, 1.1)
        this.fovKick = 1.2
        this.audio.play('nova')
    }

    // ── Orbital blades, aura, fire trails ────────────────────────────────

    private syncBladeCount(): void {
        const want = this.stats.orbitBlades
        while (this.blades.length < want) {
            const b = buildModel(orbitBladeParts()).group
            this.playerGroup.add(b)
            this.blades.push(b)
        }
        while (this.blades.length > want) {
            const b = this.blades.pop()!
            this.playerGroup.remove(b)
        }
    }

    private updateBlades(dt: number): void {
        if (this.blades.length === 0) return
        this.bladeAngle += dt * 4.2
        const r = 2.4
        this.blades.forEach((b, i) => {
            const a = this.bladeAngle + (i / this.blades.length) * Math.PI * 2
            b.position.set(Math.cos(a) * r, 1.2 + Math.sin(a * 2) * 0.3, Math.sin(a) * r)
            b.rotation.y = -a * 3
            const wx = this.pos.x + b.position.x * this.stats.scale
            const wz = this.pos.z + b.position.z * this.stats.scale
            for (const e of this.enemies) {
                if (!e.alive || e.state === 'spawn' || e.bladeCooldown > 0) continue
                const d = Math.hypot(e.pos.x - wx, e.pos.z - wz)
                if (d < 1 + e.radius * e.scale) {
                    e.bladeCooldown = 0.28
                    this.hitEnemy(e, 16 * this.stats.meleeDamageMult * this.stats.damageMult, _v1.set(e.pos.x - this.pos.x, 0, e.pos.z - this.pos.z).normalize(), 3, 'blade')
                }
            }
        })
    }

    private updateAura(dt: number): void {
        if (this.stats.vampireAura <= 0) return
        this.auraTimer -= dt
        if (this.auraTimer > 0) return
        this.auraTimer = 0.5
        const radius = 5.5 * this.stats.scale
        let hits = 0
        for (const e of this.enemies) {
            if (!e.alive || e.state === 'spawn') continue
            if (e.pos.distanceTo(this.pos) > radius) continue
            this.hitEnemy(e, 7 * this.stats.vampireAura * this.stats.damageMult, _v1.set(0, 1, 0), 0, 'aura')
            hits++
        }
        if (hits > 0) this.hp = Math.min(this.stats.maxHealth, this.hp + hits * 1.2 * this.stats.vampireAura)
    }

    private spawnFireCell(x: number, z: number): void {
        const mesh = new THREE.Mesh(BOX, voxMaterial(0xff6a2a, 0xff9a3a, 2))
        mesh.position.set(x, this.groundHeight(x, z, 0.3, this.pos.y + STEP_HEIGHT) + 0.3, z)
        mesh.scale.set(0.9, 0.6, 0.9)
        this.scene.add(mesh)
        this.fireCells.push({ pos: mesh.position.clone(), mesh, life: 3.2, tick: 0, damage: 9 * this.stats.fireTrail * this.stats.damageMult })
    }

    private updateFireCells(dt: number): void {
        for (let i = this.fireCells.length - 1; i >= 0; i--) {
            const cell = this.fireCells[i]!
            cell.life -= dt
            cell.tick -= dt
            const flicker = 0.5 + Math.random() * 0.5
            cell.mesh.scale.set(0.7 + flicker * 0.4, 0.4 + flicker * 0.7, 0.7 + flicker * 0.4)
            cell.mesh.rotation.y += dt * 3
            if (cell.tick <= 0) {
                cell.tick = 0.4
                for (const e of this.enemies) {
                    if (!e.alive || e.state === 'spawn') continue
                    if (Math.hypot(e.pos.x - cell.pos.x, e.pos.z - cell.pos.z) < 1.3 + e.radius * e.scale && Math.abs(e.pos.y - cell.pos.y) < 2) {
                        this.hitEnemy(e, cell.damage, _v1.set(0, 1, 0), 0, 'aura')
                    }
                }
            }
            if (cell.life <= 0) {
                this.scene.remove(cell.mesh)
                this.fireCells.splice(i, 1)
            }
        }
    }

    // ── Enemies ──────────────────────────────────────────────────────────

    private spawnEnemy(id: EnemyId, affix: EliteAffix | null, at?: THREE.Vector3): Enemy {
        const def = ENEMIES[id]
        const parts = enemyParts(id)
        const model = buildModel(parts, def.scale)
        const portal = at ?? randomPick(this.portals)
        const pos = portal.clone()
        pos.x += (Math.random() - 0.5) * 3
        pos.z += (Math.random() - 0.5) * 3
        pos.x = THREE.MathUtils.clamp(pos.x, -ARENA_HALF + 1, ARENA_HALF - 1)
        pos.z = THREE.MathUtils.clamp(pos.z, -ARENA_HALF + 1, ARENA_HALF - 1)
        pos.y = def.behavior === 'flyer' ? 3 : 0
        const hp = Math.round(def.hp * this.waveHpMult * affixHpMult(affix))
        const barBg = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false }))
        const barFill = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: affix ? AFFIXES[affix].color : 0xff3a3a, toneMapped: false }))
        const barW = 0.9 + def.scale * 0.5
        barBg.scale.set(barW, 0.1, 0.04)
        barFill.scale.set(barW, 0.1, 0.05)
        const hpBar = new THREE.Group()
        hpBar.add(barBg)
        hpBar.add(barFill)
        hpBar.visible = false
        this.scene.add(hpBar)
        if (affix) {
            const glow = new THREE.Mesh(BOX, voxMaterial(AFFIXES[affix].color, AFFIXES[affix].color, 1.4))
            glow.scale.set(0.5, 0.18, 0.5)
            glow.position.y = def.height + 0.35
            glow.name = 'affix'
            model.group.add(glow)
            const aura = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: AFFIXES[affix].color, transparent: true, opacity: 0.18 }))
            aura.scale.set(def.radius * 2.6, 0.08, def.radius * 2.6)
            aura.position.y = 0.05
            model.group.add(aura)
        }
        model.group.position.copy(pos)
        model.group.scale.setScalar(0.01)
        this.scene.add(model.group)
        const enemy: Enemy = {
            id: this.nextEnemyId++,
            def,
            affix,
            model,
            parts,
            pos,
            knock: new THREE.Vector3(),
            hp,
            maxHp: hp,
            speed: def.speed * affixSpeedMult(affix) * (0.92 + Math.random() * 0.16),
            damage: def.damage * this.waveDmgMult,
            radius: def.radius,
            height: def.height,
            scale: def.scale,
            yaw: Math.atan2(-pos.x, -pos.z),
            attackTimer: def.attackCooldown * (0.5 + Math.random() * 0.5),
            state: 'spawn',
            stateTimer: 0.45,
            flashTimer: 0,
            walkPhase: Math.random() * 10,
            strafeSign: Math.random() < 0.5 ? -1 : 1,
            chargeDir: new THREE.Vector3(),
            hover: Math.random() * Math.PI * 2,
            roarTimer: 7,
            bladeCooldown: 0,
            burnTimer: 0,
            hpBar,
            hpFill: barFill,
            barTimer: 0,
            alive: true,
            stuckTimer: 0,
            avoidTimer: 0,
            avoidSign: Math.random() < 0.5 ? -1 : 1,
            lastX: pos.x,
            lastZ: pos.z,
            throwTimer: 4
        }
        if (this.event === 'frenzy') enemy.speed *= 1.3
        this.enemies.push(enemy)
        this.burst(pos.x, pos.y + 1, pos.z, 16, [0xb56bff, 0x3a2a52], 4, 0.14)
        this.spawnBeam(new THREE.Vector3(pos.x, 0, pos.z), new THREE.Vector3(pos.x, 14, pos.z), 0xb56bff, 0.5 * def.scale, 0.35)
        if (def.behavior === 'boss') {
            this.bossEnemy = enemy
            this.shake = Math.max(this.shake, 0.8)
        }
        return enemy
    }

    private removeEnemy(e: Enemy): void {
        e.alive = false
        this.scene.remove(e.model.group)
        this.scene.remove(e.hpBar)
        for (const child of e.hpBar.children) ((child as THREE.Mesh).material as THREE.Material).dispose()
        if (this.bossEnemy === e) this.bossEnemy = null
    }

    private updateEnemies(dt: number): void {
        const pc = this.playerCenter(new THREE.Vector3())
        for (const e of this.enemies) {
            if (!e.alive) continue
            const edt = dt * this.timeScale
            if (e.flashTimer > 0) {
                e.flashTimer -= dt
                if (e.flashTimer <= 0) for (const m of e.model.meshes) m.material = voxMaterial((m.userData.part as VoxPart).color, (m.userData.part as VoxPart).emissive ?? 0, (m.userData.part as VoxPart).glow ?? 1)
            }
            if (e.bladeCooldown > 0) e.bladeCooldown -= dt
            if (e.barTimer > 0) e.barTimer -= dt
            e.stateTimer -= edt
            if (e.attackTimer > 0) e.attackTimer -= edt

            const toPlayer = _v1.set(this.pos.x - e.pos.x, 0, this.pos.z - e.pos.z)
            const dist = toPlayer.length()
            const dir = toPlayer.clone().divideScalar(Math.max(0.001, dist))
            const move = _v2.set(0, 0, 0)
            let speed = e.speed
            const g = e.model.group

            if (e.state === 'spawn') {
                const t = 1 - Math.max(0, e.stateTimer) / 0.45
                g.scale.setScalar(Math.max(0.01, e.scale * t))
                if (e.stateTimer <= 0) {
                    e.state = 'chase'
                    g.scale.setScalar(e.scale)
                }
            } else if (e.state === 'stunned') {
                g.rotation.z = Math.sin(this.elapsed * 30) * 0.12
                if (e.stateTimer <= 0) {
                    e.state = 'chase'
                    g.rotation.z = 0
                }
            } else {
                switch (e.def.behavior) {
                    case 'melee':
                        this.aiMelee(e, dist, dir, move, edt)
                        break
                    case 'ranged':
                        this.aiRanged(e, dist, dir, move, pc)
                        break
                    case 'flyer':
                        this.aiFlyer(e, dist, dir, move, pc, edt)
                        speed = e.state === 'charge' ? e.speed * 2.4 : e.speed
                        break
                    case 'charger':
                        speed = this.aiCharger(e, dist, dir, move, edt)
                        break
                    case 'boss':
                        this.aiBoss(e, dist, dir, move, edt)
                        break
                }
            }

            // separation from neighbours keeps the pack from stacking
            if (e.state === 'chase' || e.state === 'charge') {
                for (const o of this.enemies) {
                    if (o === e || !o.alive) continue
                    const dx = e.pos.x - o.pos.x
                    const dz = e.pos.z - o.pos.z
                    const minD = (e.radius * e.scale + o.radius * o.scale) * 1.05
                    const d2 = dx * dx + dz * dz
                    if (d2 < minD * minD && d2 > 1e-4) {
                        const d = Math.sqrt(d2)
                        const push = (minD - d) / minD
                        move.x += dx / d * push * 1.6
                        move.z += dz / d * push * 1.6
                    }
                }
            }

            // obstacle avoidance: if we tried to move but barely did, sidestep for a while
            if (e.state === 'chase' && move.lengthSq() > 0.2 && e.def.behavior !== 'flyer') {
                const moved = Math.hypot(e.pos.x - e.lastX, e.pos.z - e.lastZ)
                if (moved < speed * edt * 0.25) e.stuckTimer += edt
                else e.stuckTimer = Math.max(0, e.stuckTimer - edt * 2)
                if (e.stuckTimer > 0.25 && e.avoidTimer <= 0) {
                    e.avoidTimer = 0.9
                    e.stuckTimer = 0
                    e.avoidSign *= Math.random() < 0.3 ? -1 : 1
                }
            }
            e.lastX = e.pos.x
            e.lastZ = e.pos.z
            if (e.avoidTimer > 0) {
                e.avoidTimer -= edt
                const mx = move.x
                const mz = move.z
                const a = e.avoidSign * 1.2
                move.x = mx * Math.cos(a) - mz * Math.sin(a)
                move.z = mx * Math.sin(a) + mz * Math.cos(a)
            }

            // integrate
            if (move.lengthSq() > 1) move.normalize()
            const slow = this.timeScale
            e.pos.x += (move.x * speed + e.knock.x) * edt
            e.pos.z += (move.z * speed + e.knock.z) * edt
            if (e.def.behavior !== 'flyer') {
                e.pos.y += e.knock.y * edt
                this.resolveWalls(e.pos, e.radius * e.scale, e.pos.y, e.height * e.scale)
                const ground = this.groundHeight(e.pos.x, e.pos.z, e.radius * e.scale, e.pos.y + STEP_HEIGHT)
                if (e.pos.y > ground + 0.01) {
                    e.knock.y -= GRAVITY * edt
                    if (e.pos.y + e.knock.y * edt < ground) e.knock.y = 0
                } else {
                    e.pos.y = ground
                    e.knock.y = 0
                }
                if (e.pos.y < ground) e.pos.y = ground
            } else {
                const lim = ARENA_HALF - 1
                e.pos.x = THREE.MathUtils.clamp(e.pos.x, -lim, lim)
                e.pos.z = THREE.MathUtils.clamp(e.pos.z, -lim, lim)
            }
            e.knock.x *= Math.max(0, 1 - edt * 6)
            e.knock.z *= Math.max(0, 1 - edt * 6)

            // orientation and gait
            if (move.lengthSq() > 0.01 && e.state !== 'windup') {
                const target = Math.atan2(move.x, move.z)
                let d = target - e.yaw
                while (d > Math.PI) d -= Math.PI * 2
                while (d < -Math.PI) d += Math.PI * 2
                e.yaw += d * Math.min(1, edt * 9)
            } else if (dist > 0.5) {
                e.yaw = Math.atan2(dir.x, dir.z)
            }
            g.position.copy(e.pos)
            g.rotation.y = e.yaw
            if (e.state !== 'spawn' && e.state !== 'stunned') this.animateEnemy(e, move.length() * speed, edt, slow)

            // contact damage for anything overlapping the player (chargers/flyers in charge state)
            if (e.state === 'charge' && dist < e.radius * e.scale + this.playerRadius + 0.3 && Math.abs(e.pos.y - this.pos.y) < 2.5) {
                this.damagePlayer(e.damage, e)
                const kb = dir.clone().multiplyScalar(14)
                this.vel.x += kb.x
                this.vel.z += kb.z
                this.vel.y = Math.max(this.vel.y, 5)
                e.state = 'stunned'
                e.stateTimer = 0.6
                e.attackTimer = e.def.attackCooldown
            }

            // health bar
            if (e.barTimer > 0 || e.def.behavior === 'boss') {
                e.hpBar.visible = e.def.behavior !== 'boss'
                e.hpBar.position.set(e.pos.x, e.pos.y + e.height * e.scale + 0.45, e.pos.z)
                e.hpBar.quaternion.copy(this.camera.quaternion)
                const frac = Math.max(0, e.hp / e.maxHp)
                const w = e.hpFill.scale.x = (0.9 + e.def.scale * 0.5) * frac
                e.hpFill.position.x = -((0.9 + e.def.scale * 0.5) - w) / 2
            } else {
                e.hpBar.visible = false
            }
        }
        for (let i = this.enemies.length - 1; i >= 0; i--) if (!this.enemies[i]!.alive) this.enemies.splice(i, 1)
    }

    private animateEnemy(e: Enemy, moveSpeed: number, dt: number, slow: number): void {
        e.walkPhase += moveSpeed * dt * (e.def.behavior === 'flyer' ? 0 : 1.4 / e.scale)
        const swing = Math.sin(e.walkPhase) * Math.min(1, moveSpeed / 4) * 0.9
        const p = e.model.parts
        const legL = p.get('legL')
        const legR = p.get('legR')
        const armL = p.get('armL')
        const armR = p.get('armR')
        const head = p.get('head')
        const rotor = p.get('rotor')
        if (legL) legL.rotation.x = swing
        if (legR) legR.rotation.x = -swing
        if (e.state === 'windup') {
            const t = 1 - Math.max(0, e.stateTimer) / 0.4
            if (armR) armR.rotation.x = -Math.PI * 0.8 * t
            if (armL) armL.rotation.x = -Math.PI * 0.8 * t
            if (head) head.rotation.x = -0.3 * t
            e.model.group.position.y = e.pos.y + (e.def.behavior === 'boss' ? t * 2.4 : 0)
        } else {
            if (armR) armR.rotation.x = -swing * 0.6
            if (armL) armL.rotation.x = swing * 0.6
            if (head) head.rotation.x = e.def.behavior === 'charger' && e.state === 'charge' ? 0.4 : 0
        }
        if (rotor) rotor.rotation.y += dt * 40 * slow
        if (e.def.behavior === 'flyer') {
            e.model.group.rotation.z = Math.sin(this.elapsed * 3 + e.hover) * 0.12
        }
        if (e.state === 'charge' && e.def.behavior === 'charger') {
            e.model.group.rotation.x = 0.18
        } else {
            e.model.group.rotation.x = 0
        }
    }

    private aiMelee(e: Enemy, dist: number, dir: THREE.Vector3, move: THREE.Vector3, dt: number): void {
        const reach = e.def.attackRange * e.scale + this.playerRadius
        if (e.state === 'windup') {
            if (e.stateTimer <= 0) {
                e.state = 'chase'
                e.attackTimer = e.def.attackCooldown
                if (dist < reach + 0.6 && Math.abs(this.pos.y - e.pos.y) < 2.2) {
                    this.damagePlayer(e.damage, e)
                    this.vel.x += dir.x * 4
                    this.vel.z += dir.z * 4
                } else {
                    this.audio.play('slash', 0.25)
                }
            }
            return
        }
        if (dist > reach * 0.85) {
            move.copy(dir)
        } else if (e.attackTimer <= 0) {
            e.state = 'windup'
            e.stateTimer = 0.4
        }
        void dt
    }

    private aiRanged(e: Enemy, dist: number, dir: THREE.Vector3, move: THREE.Vector3, pc: THREE.Vector3): void {
        if (dist > 15) move.copy(dir)
        else if (dist < 8) move.copy(dir).negate()
        else {
            move.set(-dir.z, 0, dir.x).multiplyScalar(e.strafeSign * 0.7)
            if (Math.random() < 0.004) e.strafeSign *= -1
        }
        if (e.attackTimer <= 0 && dist < e.def.attackRange) {
            e.attackTimer = e.def.attackCooldown
            const from = new THREE.Vector3(e.pos.x, e.pos.y + 1.6 * e.scale, e.pos.z)
            from.addScaledVector(dir, 0.5 * e.scale)
            const lead = pc.clone().addScaledVector(this.vel, dist / (e.def.projectileSpeed ?? 16) * 0.8)
            const v = lead.sub(from).normalize().multiplyScalar(e.def.projectileSpeed ?? 16)
            this.enemyShots.push({ pos: from, vel: v, life: 3.2, damage: e.damage, alive: true, gravity: 0, blast: 0 })
            this.audio.play('spit', 0.7)
            const head = e.model.parts.get('head')
            if (head) head.rotation.x = -0.5
        }
    }

    private aiFlyer(e: Enemy, dist: number, dir: THREE.Vector3, move: THREE.Vector3, pc: THREE.Vector3, dt: number): void {
        e.hover += dt * 1.4
        if (e.state === 'charge') {
            // dive along the stored direction; the contact check lives in updateEnemies
            move.copy(e.chargeDir)
            e.pos.y += e.chargeDir.y * e.speed * 2.2 * dt
            if (e.stateTimer <= 0 || e.pos.y < 0.6) {
                e.state = 'chase'
                e.attackTimer = e.def.attackCooldown
            }
            return
        }
        const targetY = 3.4 + Math.sin(e.hover) * 0.8 + this.pos.y
        e.pos.y += (targetY - e.pos.y) * Math.min(1, dt * 3)
        const orbitR = 6.5
        if (dist > orbitR + 1.5) move.copy(dir)
        else {
            move.set(-dir.z, 0, dir.x).multiplyScalar(e.strafeSign)
            if (dist < orbitR - 1.5) move.sub(dir)
        }
        if (e.attackTimer <= 0 && dist < 11) {
            e.state = 'charge'
            e.stateTimer = 0.75
            e.chargeDir.copy(pc).sub(e.pos).normalize()
            e.chargeDir.y = Math.min(0, e.chargeDir.y)
            this.audio.play('charge', 0.4)
        }
        void dt
    }

    private aiCharger(e: Enemy, dist: number, dir: THREE.Vector3, move: THREE.Vector3, dt: number): number {
        if (e.state === 'charge') {
            move.copy(e.chargeDir)
            const ahead = _v3.copy(e.pos).addScaledVector(e.chargeDir, e.radius * e.scale + 0.5)
            const blocked = Math.abs(ahead.x) > ARENA_HALF - 0.5 || Math.abs(ahead.z) > ARENA_HALF - 0.5
                || this.colliders.some(b => ahead.x > b.min.x && ahead.x < b.max.x && ahead.z > b.min.z && ahead.z < b.max.z && e.pos.y < b.max.y - STEP_HEIGHT)
            if (blocked || e.stateTimer <= 0) {
                e.state = 'stunned'
                e.stateTimer = blocked ? 1.4 : 0.5
                e.attackTimer = e.def.attackCooldown
                if (blocked) {
                    this.burst(ahead.x, e.pos.y + 1, ahead.z, 14, [0x8f2a2a, 0x3a3f4b], 5, 0.14)
                    this.audio.play('slam', 0.4)
                    this.shake = Math.max(this.shake, 0.3)
                }
            }
            return e.speed * 4.6
        }
        if (e.state === 'windup') {
            e.model.group.position.x += (Math.random() - 0.5) * 0.06
            if (e.stateTimer <= 0) {
                e.state = 'charge'
                e.stateTimer = 1.1
                e.chargeDir.copy(dir)
                this.audio.play('charge')
            }
            return 0
        }
        if (e.attackTimer <= 0 && dist > 3.5 && dist < 18) {
            e.state = 'windup'
            e.stateTimer = 0.65
            return 0
        }
        move.copy(dir)
        void dt
        return e.speed
    }

    private aiBoss(e: Enemy, dist: number, dir: THREE.Vector3, move: THREE.Vector3, dt: number): void {
        e.roarTimer -= dt
        if (e.roarTimer <= 0 && e.state === 'chase') {
            e.roarTimer = 9
            this.audio.play('boss', 0.6)
            this.ui.toast('The Titan calls reinforcements', '#ff6a2a')
            for (let i = 0; i < 3; i++) {
                const at = e.pos.clone()
                at.x += (Math.random() - 0.5) * 4
                at.z += (Math.random() - 0.5) * 4
                const spawned = this.spawnEnemy('runner', null, at)
                spawned.pos.y = e.pos.y
            }
        }
        e.throwTimer -= dt
        if (e.throwTimer <= 0 && e.state === 'chase' && dist > 7) {
            e.throwTimer = 5.5
            const from = new THREE.Vector3(e.pos.x, e.pos.y + 2.2 * e.scale, e.pos.z)
            const target = this.pos.clone().addScaledVector(this.vel, 0.6)
            const flight = 1.3
            const v = target.sub(from).divideScalar(flight)
            v.y += 0.5 * 30 * flight
            const mesh = buildModel(boulderParts(), 1.6).group
            this.scene.add(mesh)
            this.enemyShots.push({ pos: from, vel: v, life: 4, damage: e.damage * 0.9, alive: true, gravity: 30, mesh, blast: 4 })
            this.audio.play('charge', 0.8)
            this.ui.toast('Incoming boulder', '#ff6a2a')
            const armR = e.model.parts.get('armR')
            if (armR) armR.rotation.x = -2.4
        }
        const reach = e.def.attackRange * e.scale * 0.5
        if (e.state === 'windup') {
            if (e.stateTimer <= 0) {
                e.state = 'chase'
                e.attackTimer = e.def.attackCooldown
                e.model.group.position.y = e.pos.y
                const radius = 7.5
                this.spawnShockwave(e.pos, radius, 0xff6a2a, 0.55)
                this.burst(e.pos.x, e.pos.y + 0.3, e.pos.z, 50, [0x4a3d6b, 0xff6a2a, 0x2a3147], 8, 0.22)
                this.audio.play('slam')
                this.shake = Math.max(this.shake, 1.2)
                if (dist < radius && this.onGround && this.pos.y < e.pos.y + 1.5) {
                    this.damagePlayer(e.damage, e)
                    this.vel.x += dir.x * 12
                    this.vel.z += dir.z * 12
                    this.vel.y = 7
                }
            }
            return
        }
        if (dist > reach) move.copy(dir)
        else if (e.attackTimer <= 0) {
            e.state = 'windup'
            e.stateTimer = 0.8
        }
    }

    // ── Damage ───────────────────────────────────────────────────────────

    private hitEnemy(e: Enemy, amount: number, dir: THREE.Vector3, knockback: number, source: 'bullet' | 'melee' | 'explosion' | 'blade' | 'aura' | 'nova' | 'thorns', headshot = false): void {
        if (!e.alive) return
        let dmg = amount
        let crit = false
        if (source === 'bullet' || source === 'melee' || source === 'blade') {
            if (headshot || randomChance(this.stats.critChance)) {
                crit = true
                dmg *= headshot ? Math.max(2, this.stats.critMult) : this.stats.critMult
            }
        }
        if (headshot) this.headshots++
        if (this.overdriveTimer > 0) dmg *= 2
        dmg = Math.max(1, Math.round(dmg))
        e.hp -= dmg
        this.damageDealt += dmg
        e.barTimer = 2.5
        if (e.flashTimer <= 0) for (const m of e.model.meshes) m.material = FLASH_MATERIAL
        e.flashTimer = 0.06
        const kbScale = knockback / Math.max(0.6, e.scale * (e.def.behavior === 'boss' ? 6 : 1.4))
        e.knock.x += dir.x * kbScale * 2.2
        e.knock.z += dir.z * kbScale * 2.2
        if (source === 'melee' || source === 'nova') e.knock.y += kbScale * 0.8

        if (this.stats.lifesteal > 0 && source !== 'aura') this.hp = Math.min(this.stats.maxHealth, this.hp + dmg * this.stats.lifesteal)

        if (source !== 'aura') {
            const center = new THREE.Vector3(e.pos.x, e.pos.y + e.height * e.scale * 0.7, e.pos.z)
            this.popup(center, headshot ? `${dmg} HEADSHOT` : String(dmg), headshot ? '#fb923c' : crit ? '#fde047' : source === 'explosion' ? '#fb923c' : source === 'melee' ? '#7dd3fc' : '#f8fafc', headshot ? 22 : crit ? 24 : source === 'melee' ? 19 : 15)
            this.burst(center.x, center.y, center.z, crit ? 10 : 5, [(e.parts[0]?.color ?? 0xffffff), 0xffffff], 3.5, 0.09)
            this.hitMarker = headshot ? 0.2 : 0.14
            this.hud.hitKind = headshot ? 'head' : crit ? 'crit' : 'hit'
            if (this.hitSoundTimer <= 0) {
                this.audio.play(crit ? 'crit' : 'hit', headshot ? 0.9 : 0.6)
                this.hitSoundTimer = 0.04
            }
        }

        // explosive rounds and static charge only proc from direct hits
        if (source === 'bullet' && this.stats.explosiveRounds > 0) {
            const c = new THREE.Vector3(e.pos.x, e.pos.y + e.height * e.scale * 0.5, e.pos.z)
            this.explode(c, 1.5 + this.stats.explosiveRounds * 0.5, dmg * 0.35, 0xffa23a, false, e.id)
        }
        if ((source === 'bullet' || source === 'melee') && this.stats.chainLightning > 0 && randomChance(0.25 * this.stats.chainLightning)) {
            const c = new THREE.Vector3(e.pos.x, e.pos.y + e.height * e.scale * 0.5, e.pos.z)
            const seen = new Set<number>([e.id])
            let from = c
            for (let i = 0; i < 3; i++) {
                const next = this.nearestEnemy(from, 7, seen)
                if (!next) break
                const nc = new THREE.Vector3(next.pos.x, next.pos.y + next.height * next.scale * 0.5, next.pos.z)
                this.spawnLightning(from, nc, 0xb56bff, 0.12)
                this.hitEnemy(next, dmg * 0.4, nc.clone().sub(from).normalize(), 1, 'explosion')
                seen.add(next.id)
                from = nc
            }
        }

        if (e.hp <= 0) this.killEnemy(e, dir)
    }

    private killEnemy(e: Enemy, dir: THREE.Vector3): void {
        if (!e.alive) return
        const boss = e.def.behavior === 'boss'
        this.kills++
        this.combo++
        this.comboTimer = 2.6
        const gained = killScore(e.def, this.wave, this.combo, e.affix)
        this.score += gained
        this.energy = Math.min(this.stats.energyMax, this.energy + (e.def.energy + this.stats.energyPerKill) * 0.5)
        const center = new THREE.Vector3(e.pos.x, e.pos.y + e.height * e.scale * 0.5, e.pos.z)
        this.popup(center.clone().add(new THREE.Vector3(0, 0.6, 0)), `+${gained}`, e.affix ? hexToCss(AFFIXES[e.affix].color) : '#a3e635', boss ? 30 : 14)
        this.hitMarker = 0.2
        this.hud.hitKind = 'kill'
        if (this.streakTimer > 0) {
            this.streakCount++
            const label = this.streakCount === 2 ? 'DOUBLE KILL' : this.streakCount === 3 ? 'TRIPLE KILL' : this.streakCount === 4 ? 'QUAD KILL' : this.streakCount >= 5 ? 'RAMPAGE' : ''
            if (label) this.ui.toast(label, this.streakCount >= 5 ? '#f472b6' : '#fde047')
        } else {
            this.streakCount = 1
        }
        this.streakTimer = 1.1

        // the body blasts into its own voxels
        this.shatter(e, dir)
        this.audio.play(boss || e.scale > 1.5 ? 'kill-big' : 'kill', boss ? 1.4 : 0.9)
        this.shake = Math.max(this.shake, boss ? 1.4 : e.scale > 1.5 ? 0.45 : 0.12)

        if (this.stats.frenzy > 0) {
            this.frenzyStacks = Math.min(10 * this.stats.frenzy, this.frenzyStacks + 1)
            this.frenzyTimer = 4
        }
        if (this.stats.chronoKill > 0) {
            this.chronoTimer = Math.max(this.chronoTimer, 0.28 + this.stats.chronoKill * 0.12)
            this.audio.play('chrono', 0.5)
        }
        if (this.stats.killBlast > 0) {
            this.explode(center, 2.2 + this.stats.killBlast * 0.6, 18 * this.stats.killBlast * this.stats.damageMult * this.waveHpMult, 0xff6a2a, false, e.id)
        }
        if (e.affix === 'volatile') {
            this.explode(center, 3.2, e.damage * 1.5, 0xff6a2a, true, e.id)
        }

        // drops
        const roll = randomFloat()
        if (roll < dropChance(e.def, this.stats.luck)) {
            const kinds: PickupKind[] = ['health', 'health', 'energy', 'energy', 'weapon', 'overdrive']
            this.spawnPickup(boss ? 'weapon' : randomPick(kinds), e.pos)
            if (boss) this.spawnPickup('overdrive', e.pos.clone().add(new THREE.Vector3(2, 0, 0)))
        }
        this.removeEnemy(e)
        if (boss) this.ui.toast('TITAN DESTROYED', '#fbbf24')
    }

    private shatter(e: Enemy, dir: THREE.Vector3): void {
        const g = e.model.group
        g.updateMatrixWorld(true)
        const world = new THREE.Vector3()
        for (const m of e.model.meshes) {
            const part = m.userData.part as VoxPart
            m.getWorldPosition(world)
            const volume = part.w * part.h * part.d * e.scale ** 3
            const n = Math.min(26, Math.max(2, Math.round(volume * 22)))
            const cube = Math.max(0.1, Math.min(0.32, Math.cbrt(volume / n) * 0.9))
            for (let i = 0; i < n; i++) {
                const ox = (Math.random() - 0.5) * part.w * e.scale
                const oy = (Math.random() - 0.5) * part.h * e.scale
                const oz = (Math.random() - 0.5) * part.d * e.scale
                const vx = dir.x * 4 + ox * 6 + (Math.random() - 0.5) * 5
                const vy = 4 + Math.random() * 7 + oy * 3
                const vz = dir.z * 4 + oz * 6 + (Math.random() - 0.5) * 5
                this.spawnDebris(world.x + ox, world.y + oy, world.z + oz, vx, vy, vz, part.emissive ?? part.color, cube, 1.4 + Math.random() * 1.2)
            }
        }
    }

    private explode(center: THREE.Vector3, radius: number, damage: number, color: number, hurtsPlayer: boolean, ignoreId = -1): void {
        for (const e of this.enemies) {
            if (!e.alive || e.id === ignoreId || e.state === 'spawn') continue
            const d = center.distanceTo(_v1.set(e.pos.x, e.pos.y + e.height * e.scale * 0.5, e.pos.z))
            if (d > radius + e.radius * e.scale) continue
            const fall = 1 - Math.max(0, d - e.radius * e.scale) / radius * 0.6
            this.hitEnemy(e, damage * fall, _v2.copy(e.pos).sub(center).setY(0.3).normalize(), 5, 'explosion')
        }
        if (hurtsPlayer) {
            const d = center.distanceTo(this.playerCenter(_v1))
            if (d < radius + this.playerRadius) {
                this.damagePlayer(damage * (1 - d / (radius + 1)), null)
                const kb = this.pos.clone().sub(center).setY(0).normalize().multiplyScalar(10)
                this.vel.add(kb)
                this.vel.y = Math.max(this.vel.y, 6)
            }
        }
        this.spawnExplosion(center, radius, color)
        this.burst(center.x, center.y, center.z, Math.round(10 + radius * 6), [color, 0xffe14d, 0x3a3f4b], 4 + radius, 0.16)
        this.flashLight.color.set(color)
        this.flashLight.position.copy(center)
        this.flashLight.intensity = Math.max(this.flashLight.intensity, 10 + radius * 6)
        this.audio.play('explosion', Math.min(1, 0.35 + radius * 0.12))
        this.shake = Math.max(this.shake, Math.min(1, radius * 0.12))
    }

    private damagePlayer(amount: number, attacker: Enemy | null): void {
        if (this.invuln > 0 || this.hud.phase !== 'playing') return
        const dmg = Math.max(1, Math.round(amount * (1 - this.stats.armor)))
        if (this.stats.thorns > 0 && attacker) {
            this.hitEnemy(attacker, dmg * this.stats.thorns, _v1.copy(attacker.pos).sub(this.pos).setY(0).normalize(), 2, 'thorns')
        }
        if (this.hp - dmg <= 0 && this.stats.secondWind > 0 && !this.secondWindUsed) {
            this.secondWindUsed = true
            this.hp = this.stats.maxHealth * 0.5
            this.invuln = 1.2
            this.ui.toast('SECOND WIND', '#f472b6')
            this.spawnShockwave(this.pos, 6, 0xf472b6, 0.4)
            this.audio.play('nova', 0.5)
            return
        }
        this.hp -= dmg
        this.invuln = 0.12
        this.regenDelay = 3
        this.hurtFlash = 1
        this.shake = Math.max(this.shake, 0.4)
        this.audio.play('hurt', 0.8)
        this.burst(this.pos.x, this.pos.y + 1.2, this.pos.z, 8, [0xff3a3a, 0xe9e4d6], 3, 0.1)
        if (this.hp <= 0) {
            this.hp = 0
            this.die()
        }
    }

    // ── Projectiles ──────────────────────────────────────────────────────

    private updateProjectiles(dt: number): void {
        const q = _q1
        let slot = 0
        for (const p of this.projectiles) {
            if (!p.alive) continue
            p.life -= dt
            if (p.life <= 0) {
                p.alive = false
                continue
            }
            if (p.homing > 0) {
                const target = this.nearestEnemy(p.pos, 14, p.hit)
                if (target) {
                    const tc = _v1.set(target.pos.x, target.pos.y + target.height * target.scale * 0.5, target.pos.z)
                    const want = tc.sub(p.pos).normalize()
                    const speed = p.vel.length()
                    const cur = _v2.copy(p.vel).divideScalar(speed)
                    if (cur.dot(want) > 0.2) {
                        cur.lerp(want, Math.min(1, p.homing * dt)).normalize()
                        p.vel.copy(cur).multiplyScalar(speed)
                    }
                }
            }
            if (p.def.gravity > 0) p.vel.y -= p.def.gravity * dt
            const prev = _v3.copy(p.pos)
            p.pos.addScaledVector(p.vel, dt)
            p.spin += dt * 20

            // enemies
            let closest: Enemy | null = null
            let closestT = 2
            for (const e of this.enemies) {
                if (!e.alive || e.state === 'spawn' || p.hit.has(e.id)) continue
                const c = _v1.set(e.pos.x, e.pos.y + e.height * e.scale * 0.5, e.pos.z)
                const t = segmentSphere(prev, p.pos, c, e.radius * e.scale + p.size * 0.5)
                if (t >= 0 && t < closestT) {
                    closestT = t
                    closest = e
                }
            }
            if (closest) {
                p.hit.add(closest.id)
                const dir = _v2.copy(p.vel).normalize()
                if (p.explosionRadius > 0) {
                    const c = prev.clone().lerp(p.pos, closestT)
                    this.explode(c, p.explosionRadius, p.damage, p.def.color, false)
                    p.alive = false
                    continue
                }
                if (this.shieldBlocks(closest, dir)) {
                    this.blockedHit(closest, prev.clone().lerp(p.pos, closestT))
                    p.alive = false
                    continue
                }
                const head = this.headCenter(closest, _v1)
                const headshot = !!head && segmentSphere(prev, p.pos, head, closest.def.headRadius * closest.scale + p.size * 0.5) >= 0
                this.hitEnemy(closest, p.damage, dir, p.def.knockback, 'bullet', headshot)
                if (p.pierceLeft > 0) {
                    p.pierceLeft--
                    p.damage *= 0.85
                } else if (p.ricochetLeft > 0) {
                    const next = this.nearestEnemy(p.pos, 16, p.hit)
                    if (next) {
                        p.ricochetLeft--
                        const speed = p.vel.length()
                        const nc = _v1.set(next.pos.x, next.pos.y + next.height * next.scale * 0.5, next.pos.z)
                        p.vel.copy(nc.sub(p.pos).normalize().multiplyScalar(speed))
                        p.life = Math.max(p.life, 1.2)
                        this.spawnLightning(p.pos, p.pos.clone().addScaledVector(p.vel, 0.02), p.def.color, 0.08)
                    } else {
                        p.alive = false
                        continue
                    }
                } else {
                    p.alive = false
                    continue
                }
            }

            // world
            const outside = Math.abs(p.pos.x) > ARENA_HALF || Math.abs(p.pos.z) > ARENA_HALF || p.pos.y > 60
            let blocked = outside || p.pos.y <= 0
            if (!blocked) {
                for (const b of this.colliders) {
                    if (b.containsPoint(p.pos)) {
                        blocked = true
                        break
                    }
                }
            }
            if (blocked) {
                if (p.explosionRadius > 0) {
                    this.explode(p.pos.clone().setY(Math.max(0.2, p.pos.y)), p.explosionRadius, p.damage, p.def.color, false)
                } else if (p.def.kind === 'disc' && p.ricochetLeft > 0 && !outside) {
                    // saw discs bounce off geometry
                    p.ricochetLeft--
                    p.pos.copy(prev)
                    if (p.pos.y <= 0.2) p.vel.y = Math.abs(p.vel.y)
                    else {
                        p.vel.x *= -1
                        p.vel.z *= -1
                    }
                    this.burst(p.pos.x, p.pos.y, p.pos.z, 4, [p.def.color], 3, 0.08)
                    continue
                } else {
                    this.burst(p.pos.x, Math.max(0.1, p.pos.y), p.pos.z, 5, [p.def.color, 0x8a8f9c], 3, 0.08)
                }
                p.alive = false
                continue
            }

            // draw
            if (slot < this.tracers.size) {
                _c1.copy(p.color).multiplyScalar(1.8)
                if (p.def.kind === 'plasma') {
                    q.setFromAxisAngle(UP, p.spin)
                    this.tracers.set(slot, p.pos, q, p.size, p.size, p.size, _c1)
                } else if (p.def.kind === 'disc') {
                    q.setFromAxisAngle(UP, p.spin * 1.5)
                    this.tracers.set(slot, p.pos, q, p.size, 0.08, p.size, _c1)
                } else {
                    const dir = _v2.copy(p.vel).normalize()
                    q.setFromUnitVectors(Z_AXIS, dir)
                    this.tracers.set(slot, p.pos, q, p.size, p.size, p.def.tracerLength * (1 + this.stats.bulletSize * 0.3), _c1)
                }
                slot++
            }
        }
        for (let i = slot; i < this.tracers.size; i++) this.tracers.hide(i)
        this.tracers.commit()
        for (let i = this.projectiles.length - 1; i >= 0; i--) if (!this.projectiles[i]!.alive) this.projectiles.splice(i, 1)

        // enemy shots
        const pc = this.playerCenter(_v3)
        let s = 0
        for (const shot of this.enemyShots) {
            if (!shot.alive) continue
            const edt = dt * this.timeScale
            shot.life -= edt
            shot.vel.y -= shot.gravity * edt
            const prev = _v1.copy(shot.pos)
            shot.pos.addScaledVector(shot.vel, edt)
            const hitRadius = this.playerRadius + (shot.blast > 0 ? 0.9 : 0.55) * this.stats.scale
            if (shot.life <= 0) shot.alive = false
            else if (segmentSphere(prev, shot.pos, pc, hitRadius) >= 0) {
                if (shot.blast > 0) this.explode(shot.pos.clone(), shot.blast, shot.damage, 0xff6a2a, true)
                else this.damagePlayer(shot.damage, null)
                shot.alive = false
            } else if (shot.pos.y <= 0 || Math.abs(shot.pos.x) > ARENA_HALF || Math.abs(shot.pos.z) > ARENA_HALF || this.colliders.some(b => b.containsPoint(shot.pos))) {
                if (shot.blast > 0) this.explode(shot.pos.clone().setY(Math.max(0.3, shot.pos.y)), shot.blast, shot.damage, 0xff6a2a, true)
                else this.burst(shot.pos.x, Math.max(0.1, shot.pos.y), shot.pos.z, 5, [0x7dff5a], 3, 0.1)
                shot.alive = false
            }
            if (shot.mesh) {
                if (!shot.alive) this.scene.remove(shot.mesh)
                else {
                    shot.mesh.position.copy(shot.pos)
                    shot.mesh.rotation.x += edt * 5
                    shot.mesh.rotation.z += edt * 3
                }
                continue
            }
            if (shot.alive && s < this.shotPool.size) {
                q.setFromAxisAngle(UP, this.elapsed * 6)
                _c1.set(0x7dff5a).multiplyScalar(1.6)
                this.shotPool.set(s, shot.pos, q, 0.36, 0.36, 0.36, _c1)
                s++
            }
        }
        for (let i = s; i < this.shotPool.size; i++) this.shotPool.hide(i)
        this.shotPool.commit()
        for (let i = this.enemyShots.length - 1; i >= 0; i--) if (!this.enemyShots[i]!.alive) this.enemyShots.splice(i, 1)
    }

    // ── Pickups ──────────────────────────────────────────────────────────

    private spawnPickup(kind: PickupKind, at: THREE.Vector3): void {
        const model = buildModel(pickupParts(kind))
        for (const m of model.meshes) m.castShadow = false
        const pos = at.clone()
        pos.y = this.groundHeight(pos.x, pos.z, 0.3, 100) + 0.8
        model.group.position.copy(pos)
        this.scene.add(model.group)
        const pickup: Pickup = { kind, group: model.group, pos, life: 28, phase: Math.random() * Math.PI * 2 }
        if (kind === 'weapon') {
            const options = (Object.keys(WEAPONS) as WeaponId[]).filter(id => !this.weapons.some(w => w.def.id === id))
            pickup.weaponId = options.length ? randomPick(options) : randomPick(Object.keys(WEAPONS) as WeaponId[])
        }
        this.pickups.push(pickup)
    }

    private updatePickups(dt: number): void {
        const pc = this.playerCenter(_v1)
        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const p = this.pickups[i]!
            p.life -= dt
            p.phase += dt * 3
            const d = p.pos.distanceTo(pc)
            if (d < this.stats.pickupRange * 2.5) {
                p.pos.lerp(pc, Math.min(1, dt * (10 / Math.max(1, d))))
            }
            p.group.position.set(p.pos.x, p.pos.y + Math.sin(p.phase) * 0.15, p.pos.z)
            p.group.rotation.y += dt * 2
            if (p.life < 5) p.group.visible = Math.sin(p.life * 12) > 0
            if (d < this.stats.pickupRange || p.life <= 0) {
                if (p.life > 0) this.collect(p)
                this.scene.remove(p.group)
                this.pickups.splice(i, 1)
            }
        }
    }

    private collect(p: Pickup): void {
        switch (p.kind) {
            case 'health':
                this.hp = Math.min(this.stats.maxHealth, this.hp + this.stats.maxHealth * 0.3)
                this.ui.toast('+30% health', '#3dff7a')
                this.audio.play('pickup')
                break
            case 'energy':
                this.energy = Math.min(this.stats.energyMax, this.energy + 40)
                this.ui.toast('+40 energy', '#4da6ff')
                this.audio.play('pickup')
                break
            case 'overdrive':
                this.overdriveTimer = 10
                this.ui.toast('OVERDRIVE — double damage', '#ff3a3a')
                this.audio.play('pickup-weapon')
                break
            case 'weapon':
                if (p.weaponId) this.addWeapon(p.weaponId, false)
                break
        }
        this.burst(p.pos.x, p.pos.y, p.pos.z, 14, [0xffffff, 0x3ff0ff], 4, 0.1)
    }

    // ── Debris & effects ─────────────────────────────────────────────────

    private spawnDebris(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, size: number, life: number): void {
        const i = this.debrisCursor
        this.debrisCursor = (this.debrisCursor + 1) % this.DEBRIS_MAX
        this.debrisPos[i * 3] = x
        this.debrisPos[i * 3 + 1] = y
        this.debrisPos[i * 3 + 2] = z
        this.debrisVel[i * 3] = vx
        this.debrisVel[i * 3 + 1] = vy
        this.debrisVel[i * 3 + 2] = vz
        this.debrisRot[i * 4] = Math.random() * Math.PI
        this.debrisRot[i * 4 + 1] = Math.random() * Math.PI
        this.debrisRot[i * 4 + 2] = (Math.random() - 0.5) * 12
        this.debrisRot[i * 4 + 3] = (Math.random() - 0.5) * 12
        this.debrisLife[i] = life
        this.debrisSize[i] = size
        _c1.set(color)
        this.debrisColor[i * 3] = _c1.r
        this.debrisColor[i * 3 + 1] = _c1.g
        this.debrisColor[i * 3 + 2] = _c1.b
    }

    /** A quick spray of cubes in the given colours — sparks, dust, impacts. */
    private burst(x: number, y: number, z: number, count: number, colors: number[], speed: number, size: number): void {
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2
            const e = Math.random() * Math.PI - Math.PI / 2
            const s = speed * (0.4 + Math.random() * 0.8)
            this.spawnDebris(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.abs(Math.sin(e)) * s + 2, Math.sin(a) * Math.cos(e) * s, colors[Math.floor(Math.random() * colors.length)]!, size * (0.6 + Math.random() * 0.8), 0.5 + Math.random() * 0.7)
        }
    }

    private updateDebris(dt: number): void {
        const q = _q1
        const pos = _v1
        const euler = new THREE.Euler()
        for (let i = 0; i < this.DEBRIS_MAX; i++) {
            const life = this.debrisLife[i]!
            if (life <= 0) continue
            const nl = life - dt
            this.debrisLife[i] = nl
            if (nl <= 0) {
                this.debris.hide(i)
                continue
            }
            const i3 = i * 3
            this.debrisVel[i3 + 1]! -= 26 * dt
            let x = this.debrisPos[i3]! + this.debrisVel[i3]! * dt
            let y = this.debrisPos[i3 + 1]! + this.debrisVel[i3 + 1]! * dt
            let z = this.debrisPos[i3 + 2]! + this.debrisVel[i3 + 2]! * dt
            const size = this.debrisSize[i]!
            if (y < size * 0.5) {
                y = size * 0.5
                this.debrisVel[i3 + 1] = -this.debrisVel[i3 + 1]! * 0.42
                this.debrisVel[i3] = this.debrisVel[i3]! * 0.7
                this.debrisVel[i3 + 2] = this.debrisVel[i3 + 2]! * 0.7
                this.debrisRot[i * 4 + 2] = this.debrisRot[i * 4 + 2]! * 0.5
                this.debrisRot[i * 4 + 3] = this.debrisRot[i * 4 + 3]! * 0.5
            }
            const lim = ARENA_HALF - 0.2
            if (x < -lim || x > lim) {
                x = THREE.MathUtils.clamp(x, -lim, lim)
                this.debrisVel[i3] = -this.debrisVel[i3]! * 0.5
            }
            if (z < -lim || z > lim) {
                z = THREE.MathUtils.clamp(z, -lim, lim)
                this.debrisVel[i3 + 2] = -this.debrisVel[i3 + 2]! * 0.5
            }
            this.debrisPos[i3] = x
            this.debrisPos[i3 + 1] = y
            this.debrisPos[i3 + 2] = z
            this.debrisRot[i * 4] = this.debrisRot[i * 4]! + this.debrisRot[i * 4 + 2]! * dt
            this.debrisRot[i * 4 + 1] = this.debrisRot[i * 4 + 1]! + this.debrisRot[i * 4 + 3]! * dt
            const shrink = nl < 0.35 ? nl / 0.35 : 1
            euler.set(this.debrisRot[i * 4]!, this.debrisRot[i * 4 + 1]!, 0)
            q.setFromEuler(euler)
            _c1.setRGB(this.debrisColor[i3]!, this.debrisColor[i3 + 1]!, this.debrisColor[i3 + 2]!)
            this.debris.set(i, pos.set(x, y, z), q, size * shrink, size * shrink, size * shrink, _c1)
        }
        this.debris.commit()
    }

    private addEffect(obj: THREE.Object3D, life: number, update: Effect['update'], dispose?: () => void): void {
        this.scene.add(obj)
        this.effects.push({ obj, life, maxLife: life, update, dispose })
    }

    private updateEffects(dt: number): void {
        for (let i = this.effects.length - 1; i >= 0; i--) {
            const fx = this.effects[i]!
            fx.life -= dt
            if (fx.life <= 0) {
                this.scene.remove(fx.obj)
                fx.dispose?.()
                this.effects.splice(i, 1)
                continue
            }
            fx.update(fx, 1 - fx.life / fx.maxLife, dt)
        }
    }

    private spawnMuzzleFlash(at: THREE.Vector3, dir: THREE.Vector3, color: THREE.Color, size: number): void {
        const mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2), toneMapped: false, transparent: true })
        const mesh = new THREE.Mesh(BOX, mat)
        mesh.position.copy(at).addScaledVector(dir, 0.2)
        mesh.quaternion.setFromUnitVectors(Z_AXIS, dir)
        mesh.rotation.z = Math.random() * Math.PI
        this.addEffect(mesh, 0.07, (fx, t) => {
            fx.obj.scale.set(size * (1 - t * 0.5), size * (1 - t * 0.5), size * 2.5 * (1 - t))
            mat.opacity = 1 - t
        }, () => mat.dispose())
    }

    private spawnBeam(from: THREE.Vector3, to: THREE.Vector3, color: number, width: number, life: number): void {
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), toneMapped: false, transparent: true })
        const mesh = new THREE.Mesh(BOX, mat)
        const len = from.distanceTo(to)
        mesh.position.copy(from).lerp(to, 0.5)
        mesh.quaternion.setFromUnitVectors(Z_AXIS, to.clone().sub(from).normalize())
        this.addEffect(mesh, life, (fx, t) => {
            fx.obj.scale.set(width * (1 - t), width * (1 - t), len)
            mat.opacity = 1 - t * t
        }, () => mat.dispose())
    }

    private spawnLightning(from: THREE.Vector3, to: THREE.Vector3, color: number, life: number): void {
        const n = 9
        const pts: THREE.Vector3[] = []
        const dir = to.clone().sub(from)
        const len = dir.length()
        const perp = new THREE.Vector3().crossVectors(dir, UP).normalize()
        if (perp.lengthSq() < 0.01) perp.set(1, 0, 0)
        for (let i = 0; i <= n; i++) {
            const t = i / n
            const p = from.clone().addScaledVector(dir, t)
            if (i > 0 && i < n) {
                p.addScaledVector(perp, (Math.random() - 0.5) * len * 0.12)
                p.y += (Math.random() - 0.5) * len * 0.1
            }
            pts.push(p)
        }
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), toneMapped: false, transparent: true })
        const group = new THREE.Group()
        for (let i = 0; i < n; i++) {
            const a = pts[i]!
            const b = pts[i + 1]!
            const seg = new THREE.Mesh(BOX, mat)
            seg.position.copy(a).lerp(b, 0.5)
            seg.quaternion.setFromUnitVectors(Z_AXIS, _v1.copy(b).sub(a).normalize())
            seg.scale.set(0.09, 0.09, a.distanceTo(b) * 1.05)
            group.add(seg)
        }
        this.addEffect(group, life, (fx, t) => {
            mat.opacity = 1 - t
            fx.obj.position.set((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06)
        }, () => mat.dispose())
        this.burst(to.x, to.y, to.z, 4, [color, 0xffffff], 3, 0.08)
    }

    private spawnSlash(center: THREE.Vector3, forward: THREE.Vector3, range: number, finisher: boolean): void {
        const geo = new THREE.RingGeometry(range * 0.35, range, 20, 1, 0, MELEE.arc)
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(finisher ? 0xd9a63c : 0x3ff0ff).multiplyScalar(2), toneMapped: false, transparent: true, side: THREE.DoubleSide })
        const mesh = new THREE.Mesh(geo, mat)
        // the ring lies in XY; lay it flat so geometry angle θ points along yaw θ + π/2
        mesh.rotation.x = -Math.PI / 2
        const yaw = Math.atan2(forward.x, forward.z)
        const baseRot = yaw - Math.PI / 2 - MELEE.arc / 2
        const holder = new THREE.Group()
        holder.position.copy(center)
        holder.rotation.order = 'YXZ'
        holder.rotation.y = baseRot
        holder.rotation.x = finisher ? 0 : (this.meleeCombo % 2 ? 0.35 : -0.35)
        holder.add(mesh)
        const dirSign = this.meleeCombo % 2 ? 1 : -1
        this.addEffect(holder, 0.2, (fx, t) => {
            mat.opacity = 1 - t
            fx.obj.rotation.y = baseRot + dirSign * (t - 0.5) * 1.1
            fx.obj.scale.setScalar(0.8 + t * 0.4)
        }, () => {
            geo.dispose()
            mat.dispose()
        })
    }

    private spawnExplosion(center: THREE.Vector3, radius: number, color: number): void {
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8), toneMapped: false, transparent: true })
        const mesh = new THREE.Mesh(BOX, mat)
        mesh.position.copy(center)
        this.addEffect(mesh, 0.28, (fx, t) => {
            const s = radius * (0.3 + t * 1.2)
            fx.obj.scale.set(s, s, s)
            fx.obj.rotation.set(t * 2, t * 3, 0)
            mat.opacity = (1 - t) * 0.9
        }, () => mat.dispose())
        this.spawnShockwave(center.clone().setY(Math.max(0.05, center.y - 1)), radius * 1.3, color, 0.3)
    }

    private spawnShockwave(at: THREE.Vector3, radius: number, color: number, life: number): void {
        const geo = new THREE.RingGeometry(0.7, 1, 40)
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8), toneMapped: false, transparent: true, side: THREE.DoubleSide })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(at.x, this.groundHeight(at.x, at.z, 0.5, at.y + 1) + 0.08, at.z)
        mesh.rotation.x = -Math.PI / 2
        this.addEffect(mesh, life, (fx, t) => {
            const s = radius * (0.1 + t * 0.9)
            fx.obj.scale.set(s, s, 1)
            mat.opacity = 1 - t
        }, () => {
            geo.dispose()
            mat.dispose()
        })
    }

    private popup(pos: THREE.Vector3, text: string, color: string, size: number): void {
        if (this.popups.length > 60) this.popups.shift()
        this.popups.push({ id: this.nextPopupId++, pos: pos.clone(), text, color, size, life: 0.8, maxLife: 0.8, rise: 1.6 + Math.random() * 0.6 })
    }

    private projectPopups(dt: number): void {
        const out: HudPopup[] = []
        const w = this.container.clientWidth
        const h = this.container.clientHeight
        for (let i = this.popups.length - 1; i >= 0; i--) {
            const p = this.popups[i]!
            p.life -= dt
            if (p.life <= 0) {
                this.popups.splice(i, 1)
                continue
            }
            const t = 1 - p.life / p.maxLife
            _v1.copy(p.pos)
            _v1.y += t * p.rise
            _v1.project(this.camera)
            if (_v1.z > 1) continue
            out.push({
                id: p.id,
                left: (_v1.x * 0.5 + 0.5) * w,
                top: (-_v1.y * 0.5 + 0.5) * h,
                opacity: t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3,
                color: p.color,
                size: p.size * (t < 0.1 ? 1.4 - t * 4 : 1),
                text: p.text
            })
        }
        this.hud.popups = out
    }

    // ── Waves & loop ─────────────────────────────────────────────────────

    private updateWave(dt: number): void {
        if (this.spawnQueue.length > 0) {
            this.spawnTimer -= dt
            if (this.spawnTimer <= 0 && this.enemies.length < this.maxAlive) {
                this.spawnTimer = this.spawnInterval
                const n = Math.min(this.batchSize, this.spawnQueue.length)
                for (let i = 0; i < n; i++) {
                    const next = this.spawnQueue.shift()!
                    this.spawnEnemy(next.enemy, next.affix)
                }
            }
        } else if (this.enemies.length === 0) {
            if (this.waveClearTimer < 0) this.waveClearTimer = 1.4
            this.waveClearTimer -= dt
            if (this.waveClearTimer <= 0) this.completeWave()
        }
    }

    private loop = (now: number): void => {
        if (this.disposed) return
        this.frame = requestAnimationFrame(this.loop)
        const realDt = (now - this.lastTime) / 1000
        const rawDt = Math.min(0.05, realDt)
        this.lastTime = now
        this.fpsAccum += realDt
        this.fpsFrames++
        if (this.fpsAccum >= 0.5) {
            this.hud.fps = Math.round(this.fpsFrames / this.fpsAccum)
            this.fpsAccum = 0
            this.fpsFrames = 0
        }
        this.step(rawDt)
        this.render()
    }

    /** Advances everything by one frame; cosmetics keep moving while paused. */
    private step(rawDt: number): void {
        const playing = this.hud.phase === 'playing'
        const dt = playing ? rawDt : 0
        if (playing) {
            this.elapsed += dt
            if (this.chronoTimer > 0) {
                this.chronoTimer -= dt
                this.timeScale = this.chronoTimer > 0 ? 0.3 : 1
            } else {
                this.timeScale = 1
            }
            if (this.comboTimer > 0) {
                this.comboTimer -= dt
                if (this.comboTimer <= 0) this.combo = 0
            }
            if (this.hitSoundTimer > 0) this.hitSoundTimer -= dt
            if (this.streakTimer > 0) this.streakTimer -= dt
            this.updatePlayer(dt)
            this.updateEnemies(dt)
            this.updateProjectiles(dt)
            this.updatePickups(dt)
            this.updateFireCells(dt)
            this.updateMeteors(dt)
            this.updateWave(dt)
        }
        this.updateDebris(rawDt * (playing ? 1 : 0.15))
        this.updateEffects(rawDt)
        for (const ring of this.portalRings) ring.rotation.z += rawDt * 0.8
        for (const l of this.lanterns) l.intensity = (this.event === 'blackout' ? 5 : 14) * (0.9 + Math.sin(this.elapsed * 7 + l.position.x) * 0.1)
        for (const chunk of this.skyChunks) {
            chunk.spin += rawDt * chunk.rate
            chunk.obj.rotation.y = chunk.spin
            chunk.obj.position.y += Math.sin(chunk.spin * 3) * rawDt * 0.2
        }
        if (this.hitMarker > 0) this.hitMarker -= rawDt
        if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - rawDt * 2.5)
        this.updateCamera(rawDt)
        this.projectPopups(rawDt)
        this.syncHud()
    }

    private render(): void {
        this.bloom.strength = 0.55 + (this.overdriveTimer > 0 ? 0.25 : 0) + (this.timeScale < 1 ? 0.3 : 0)
        this.composer.render()
    }

    /**
     * Test hook: runs the simulation for `seconds` at 60 Hz without rendering,
     * optionally holding the trigger and auto-aiming at the nearest enemy.
     */
    debugAdvance(seconds: number, opts: { fire?: boolean, aim?: boolean, move?: string[] } = {}): { enemies: number, kills: number, wave: number, phase: ArenaPhase, hp: number } {
        const dt = 1 / 60
        const frames = Math.round(seconds / dt)
        for (let i = 0; i < frames; i++) {
            if (opts.move) for (const k of opts.move) this.keys.add(k)
            if (opts.aim) {
                const target = this.nearestEnemy(this.playerCenter(_v1), 80)
                if (target) {
                    const c = this.headCenter(target, _v2) ?? _v2.set(target.pos.x, target.pos.y + target.height * target.scale * 0.5, target.pos.z)
                    const d = c.sub(this.camera.position)
                    this.yaw = Math.atan2(-d.x, -d.z)
                    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z))
                }
            }
            this.mouseDown = !!opts.fire
            this.mouseJustDown = !!opts.fire && i % 10 === 0
            this.step(dt)
        }
        this.mouseDown = false
        if (opts.move) for (const k of opts.move) this.keys.delete(k)
        return { enemies: this.enemies.length, kills: this.kills, wave: this.wave, phase: this.hud.phase, hp: this.hp }
    }

    private syncHud(): void {
        const h = this.hud
        h.health = this.hp
        h.maxHealth = this.stats.maxHealth
        h.energy = this.energy
        h.energyMax = this.stats.energyMax
        h.abilityCost = this.stats.abilityCost
        h.wave = this.wave
        h.remaining = this.spawnQueue.length + this.enemies.length
        h.alive = this.enemies.length
        h.kills = this.kills
        h.score = this.score
        h.combo = this.combo
        h.comboFill = this.combo > 0 ? this.comboTimer / 2.6 : 0
        const weapons = this.weapons.map(w => {
            const mag = magazineSize(w.def, this.stats)
            const total = w.def.reloadTime * this.stats.reloadMult
            return {
                id: w.def.id,
                name: w.def.name,
                ammo: w.ammo,
                magazine: mag,
                reloading: w.reloading,
                reloadProgress: w.reloading ? 1 - w.reloadTimer / total : 0,
                color: hexToCss(w.def.color)
            }
        })
        // only replace the array when something changed to keep Vue churn low
        const prev = h.weapons
        let same = prev.length === weapons.length
        if (same) {
            for (let i = 0; i < weapons.length; i++) {
                const a = prev[i]!
                const b = weapons[i]!
                if (a.id !== b.id || a.ammo !== b.ammo || a.magazine !== b.magazine || a.reloading !== b.reloading || Math.abs(a.reloadProgress - b.reloadProgress) > 0.01) {
                    same = false
                    break
                }
            }
        }
        if (!same) h.weapons = weapons
        h.activeWeapon = this.active
        h.dashCharges = this.dashCharges
        h.dashMax = this.stats.dashCharges
        h.dashFill = this.dashCharges >= this.stats.dashCharges ? 1 : 1 - Math.max(0, this.dashRecharge) / this.stats.dashCooldown
        if (this.bossEnemy && this.bossEnemy.alive) {
            if (!h.boss || h.boss.hp !== this.bossEnemy.hp) h.boss = { name: this.bossEnemy.def.name, hp: Math.max(0, this.bossEnemy.hp), maxHp: this.bossEnemy.maxHp }
        } else if (h.boss) {
            h.boss = null
        }
        h.hitMarker = this.hitMarker
        h.hurt = this.hurtFlash
        h.overdrive = Math.max(0, this.overdriveTimer)
        h.chrono = this.timeScale < 1
        h.frenzy = this.frenzyStacks
        h.time = this.elapsed
        h.ads = this.ads
        h.sliding = this.slideTimer > 0
        h.dashing = Math.max(0, this.dashTimer)
        h.event = this.event
        h.headshots = this.headshots
    }
}
