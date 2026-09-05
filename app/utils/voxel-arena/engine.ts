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
import type { AbilityId, DraftCard, EliteAffix, EnemyDef, EnemyId, MeleeDef, MeleeId, PlayerStats, ShopState, SightKind, WeaponDef, WeaponId } from './types'
import { ENEMIES, WEAPONS, WEAPON_IDS, STARTER_WEAPON, MELEE, MELEE_WEAPONS, MELEE_IDS, STARTER_MELEE, AFFIXES, TURRET, BURN, ABILITIES, ABILITY_IDS, ABILITY_SLOTS, ECONOMY, planWave, affixHpMult, affixSpeedMult, defaultStats, magazineSize, killScore, dropChance, ammoDropChance, waveIncome, rerollPrice, reserveMax, refillPrice } from './data'
import type { WaveEvent } from './data'
import { dealDraft, applyCard } from './upgrades'
import type { DraftContext } from './upgrades'
import { ArenaAudio } from './audio'
import type { ArenaSound } from './audio'
import { sectorLandmarks, arenaLayout, coverSkin, perimeterModel, jumpPadModel, architecturalModel, orbitalModuleParts } from './arena-models'
import { BOX, FLASH_MATERIAL, FLASH_MATERIAL_SOFT, buildModel, voxMaterial, weaponParts, meleeParts, enemyParts, pickupParts, portalParts, orbitBladeParts, meteorParts, boulderParts, lanternParts, turretParts } from './models'
import type { VoxModel, VoxPart, PickupKind } from './models'
import { SpritePool, coneDir } from './fx'

// ── Public HUD contract ─────────────────────────────────────────────────

export type ArenaPhase = 'menu' | 'playing' | 'draft' | 'paused' | 'dead'

export interface HudWeapon {
    id: WeaponId
    name: string
    ammo: number
    magazine: number
    /** Rounds left outside the magazine. */
    reserve: number
    reloading: boolean
    reloadProgress: number
    color: string
}

/** A directional damage marker: where the last hits came from, relative to the view. */
export interface HudHit {
    id: number
    /** Radians clockwise from straight ahead. */
    angle: number
    /** 1 when fresh, fades to 0. */
    life: number
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
    /** Total spawns planned for this wave, for the progress bar. */
    waveTotal: number
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
    shield: number
    haste: number
    turrets: number
    credits: number
    rerollCost: number
    abilities: (HudAbility | null)[]
    hits: HudHit[]
    /** Sun Lance charge, 0-1, only meaningful with the boon. */
    lance: number
    /** Current effective spread in radians, for the crosshair gap. */
    spread: number
    fov: number
    sight: SightKind
    melee: { id: MeleeId, name: string, color: string }
    /** 0-based index of the next combo hit. */
    combo3: number
    /** Which weapon is raised: the blade stays out after a slash until you shoot or aim. */
    held: 'gun' | 'melee'
}

export interface HudAbility {
    id: AbilityId
    name: string
    cost: number
    color: string
    icon: string
}

export interface ArenaUi {
    hud: ArenaHud
    banner: (title: string, subtitle: string, tone: 'wave' | 'boss' | 'clear' | 'info') => void
    toast: (text: string, color: string) => void
    shop: (state: ShopState) => void
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
        waveTotal: 1,
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
        headshots: 0,
        shield: 0,
        haste: 0,
        turrets: 0,
        credits: 0,
        rerollCost: 30,
        abilities: [null, null],
        hits: [],
        lance: 0,
        spread: 0,
        fov: 75,
        sight: 'reddot',
        melee: { id: 'sword', name: 'Iron Sword', color: '#d8dde6' },
        combo3: 0,
        held: 'gun'
    }
}

// ── Internal types ──────────────────────────────────────────────────────

const ARENA_HALF = 38
const GRAVITY = 34
const STEP_HEIGHT = 0.65
const MAX_WEAPONS = 3
/** Viewmodel parts are authored at world scale; drawn smaller so a rifle does not fill the screen. */
const VM_SCALE = 0.42
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
    burnTick: number
    burnDps: number
    enraged: boolean
    /** Frost Rounds: seconds left moving at reduced speed. */
    slowTimer: number
}

interface Turret {
    group: THREE.Group
    head: THREE.Object3D
    pos: THREE.Vector3
    life: number
    fireTimer: number
    shots: number
}

interface WeaponState {
    def: WeaponDef
    ammo: number
    /** Rounds carried outside the magazine. */
    reserve: number
    reloading: boolean
    reloadTimer: number
    fireTimer: number
    /** Rounds still to fire in the current burst. */
    burstLeft: number
    burstTimer: number
    model: THREE.Group
}

/** Void Rift: a gravity well that drags enemies in, then detonates. */
interface Rift {
    pos: THREE.Vector3
    life: number
    group: THREE.Group
    core: THREE.Mesh
    ring: THREE.Mesh
    power: number
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
    /** Meteor Call meteors never hurt the player. */
    friendly: boolean
}

interface Pickup {
    kind: PickupKind
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
const _f1 = new THREE.Vector3()
const _f2 = new THREE.Vector3()
const WHITE = new THREE.Color(0xffffff)
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
    private muzzleLight = new THREE.PointLight(0xffc070, 0, 7, 2)
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
    private playerGroup = new THREE.Group()
    private viewmodel = new THREE.Group()
    private vmArmR!: THREE.Group
    private vmArmL!: THREE.Group
    private vmKatana!: THREE.Group
    private meleeDef: MeleeDef = MELEE_WEAPONS[STARTER_MELEE]
    private held: 'gun' | 'melee' = 'gun'
    private vmSway = new THREE.Vector2()
    private vmKick = 0
    private switchTimer = 0
    private lastYaw = 0
    private lastPitch = 0
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
    private meleeCooldown = 0
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
    private slideTimer = 0
    private slideDir = new THREE.Vector3()
    private slamming = false
    private headshots = 0
    private event: WaveEvent = 'none'
    private shield = 0
    private hasteTimer = 0
    private turrets: Turret[] = []
    private hitStop = 0
    private credits = 0
    private lastIncome = 0
    private boons: DraftCard[] = []
    private abilitySlots: (AbilityId | null)[] = [null, null]
    private fieldTimer = 0
    private rifts: Rift[] = []
    private stormTimer = 0
    private lanceTimer = 0
    private lanceReady = false
    private stormKills = 0
    private meteorCallTimer = 0
    private hitIndicators: HudHit[] = []
    private nextHitId = 1
    private minimap: HTMLCanvasElement | null = null
    private minimapStatic: HTMLCanvasElement | null = null
    private minimapFrame = 0
    private lungeTarget: Enemy | null = null
    private jumpPads: THREE.Vector3[] = []
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
    private glow!: SpritePool
    private smoke!: SpritePool
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
    private waveTotal = 1
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

    mount(container: HTMLElement): void {
        this.container = container
        const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
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
        this.bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.3, 0.45, 1.0)
        this.composer.addPass(this.bloom)
        this.composer.addPass(new OutputPass())

        this.buildLights()
        this.buildArena()
        this.buildPools()
        this.buildPlayer()
        this.scene.add(this.camera)
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
        this.glow.dispose()
        this.smoke.dispose()
        this.composer.dispose()
        this.renderer.dispose()
        this.renderer.domElement.remove()
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
        sun.shadow.camera.left = -50
        sun.shadow.camera.right = 50
        sun.shadow.camera.top = 50
        sun.shadow.camera.bottom = -50
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
        const size = 2048
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const g = canvas.getContext('2d')!
        const px = size / (tiles * 2)
        for (let x = 0; x < tiles * 2; x++) {
            for (let z = 0; z < tiles * 2; z++) {
                const wx = x - tiles + 0.5
                const wz = z - tiles + 0.5
                const ring = Math.max(Math.abs(wx), Math.abs(wz)) > 32
                const big = (Math.floor(x / 2) + Math.floor(z / 2)) % 2 === 0
                const lane = Math.abs(wx) < 5 || Math.abs(wz - 3) < 3
                const hue = wx < -7 ? 184 : wx > 7 && wz > 0 ? 18 : wz < -10 ? 260 : 204
                const l = ring ? 17 : lane ? 30 : big ? 24 : 22
                g.fillStyle = `hsl(${hue}, ${lane ? 18 : 38}%, ${l}%)`
                g.fillRect(x * px, z * px, px, px)
                g.fillStyle = 'rgba(0,0,0,0.35)'
                g.fillRect(x * px, z * px, px, 1)
                g.fillRect(x * px, z * px, 1, px)
                g.fillStyle = 'rgba(180,220,225,0.18)'
                g.fillRect(x * px + 4, z * px + 4, 2, 2)
                g.fillRect((x + 1) * px - 6, (z + 1) * px - 6, 2, 2)
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
        const glowMat = new THREE.MeshStandardMaterial({ color: 0x1a2a40, emissive: 0x3ff0ff, emissiveIntensity: 0.35, roughness: 1 })
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
        const stripMat = new THREE.MeshStandardMaterial({ color: 0x40204a, emissive: 0xb56bff, emissiveIntensity: 0.55, roughness: 1 })
        const strips = new THREE.InstancedMesh(BOX, stripMat, wallCount)
        i = 0
        for (let k = 0; k < tiles; k++) {
            const t = (k - tiles / 2) * 2 + 1
            const spots = [[t, -ARENA_HALF - 1], [t, ARENA_HALF + 1], [-ARENA_HALF - 1, t], [ARENA_HALF + 1, t]]
            for (const [wx, wz] of spots) {
                // tall enough that the lit rim sits well above eye level from anywhere in the arena
                const h = 11 + (k % 4 === 0 ? 2 : 0)
                dummy.position.set(wx!, h / 2, wz!)
                dummy.scale.set(2, h, 2)
                dummy.updateMatrix()
                walls.setMatrixAt(i, dummy.matrix)
                c.set(wx! < -20 ? 0x245964 : wx! > 20 ? 0x704138 : 0x40385f).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06)
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
        this.scene.add(perimeterModel(ARENA_HALF))

        // The same layout solids drive rendered architecture and collision.
        const props = arenaLayout()

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
        this.scene.add(coverSkin(props))
        this.scene.add(sectorLandmarks())

        // lanterns: coloured point lights at the axis pads and corners
        const lanternSpots: [number, number, number][] = [[18, 18, 0x3ff0ff], [-18, 18, 0xff6a2a], [18, -18, 0xb56bff], [-18, -18, 0x3dff7a], [7.5, -7.5, 0xffd166], [-7.5, 7.5, 0xffd166]]
        for (const [lx, lz, color] of lanternSpots) {
            const model = buildModel(lanternParts(color))
            model.group.position.set(lx, 0, lz)
            this.scene.add(model.group)
            this.colliders.push(new THREE.Box3(new THREE.Vector3(lx - 0.2, 0, lz - 0.2), new THREE.Vector3(lx + 0.2, 3.2, lz + 0.2)))
            const light = new THREE.PointLight(color, 9, 22, 1.6)
            light.position.set(lx, 3.4, lz)
            this.scene.add(light)
            this.lanterns.push(light)
        }

        // jump pads: launch high, made for aim-gliding over the pack
        const padSpots: [number, number][] = [[10, -10], [-10, 10], [-22, 8], [22, -8], [26, 26], [-26, -26]]
        const padMat = voxMaterial(0x1a3a44, 0x3ff0ff, 0.45)
        for (const [px, pz] of padSpots) {
            const py = this.groundHeight(px, pz, 0.5, 100)
            const pad = new THREE.Mesh(BOX, padMat)
            pad.position.set(px, py + 0.08, pz)
            pad.scale.set(2, 0.16, 2)
            this.scene.add(pad)
            const rim = new THREE.Mesh(BOX, voxMaterial(0x2b2540))
            rim.position.set(px, py + 0.05, pz)
            rim.scale.set(2.4, 0.1, 2.4)
            this.scene.add(rim)
            const detail = jumpPadModel()
            detail.position.set(px, py, pz)
            this.scene.add(detail)
            this.jumpPads.push(new THREE.Vector3(px, py, pz))
        }

        // spawn portals
        const portalSpots = [[34, 34], [-34, 34], [34, -34], [-34, -34], [35, 0], [-35, 0], [0, 35], [0, -35]]
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
            const g = architecturalModel(orbitalModuleParts(k))
            g.scale.setScalar(0.6 + Math.random() * 0.55)
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
                    const m = new THREE.Mesh(BOX, voxMaterial((x + y) % 2 ? 0xd9d3ff : 0xbfb6ee, 0x8f86c9, 0.2))
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
        // tracers and enemy shots add light instead of painting cubes
        const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
        this.tracers = new InstancePool(tracerMat, 900)
        this.tracers.mesh.renderOrder = 15
        this.scene.add(this.tracers.mesh)
        const shotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
        this.shotPool = new InstancePool(shotMat, 300)
        this.shotPool.mesh.renderOrder = 15
        this.scene.add(this.shotPool.mesh)
        this.glow = new SpritePool(6000, true)
        this.smoke = new SpritePool(1500, false)
        this.scene.add(this.smoke.mesh)
        this.scene.add(this.glow.mesh)
        const debrisMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true })
        this.debris = new InstancePool(debrisMat, this.DEBRIS_MAX)
        this.debris.mesh.castShadow = true
        this.scene.add(this.debris.mesh)
    }

    /** First-person viewmodel anchors, parented to the camera: the gun on the right, the katana on the left. */
    private buildPlayer(): void {
        this.scene.add(this.playerGroup)
        // no hands: the gun and the blade float in view, which keeps the models clean
        this.vmArmR = new THREE.Group()
        this.vmArmL = new THREE.Group()
        for (const arm of [this.vmArmR, this.vmArmL]) {
            // weapons are modelled with the barrel along +Z; the camera looks down -Z
            arm.rotation.y = Math.PI
            arm.scale.setScalar(VM_SCALE)
        }
        this.vmArmR.position.set(0.3, -0.34, -0.46)
        this.vmArmL.position.set(0.24, -0.28, -0.5)
        this.vmArmL.scale.setScalar(VM_SCALE * 1.5)
        this.vmArmL.visible = false
        // a soft fill light rides with the camera so the gun reads from any angle
        const fill = new THREE.PointLight(0xfff1dc, 1.1, 3.5, 1.5)
        fill.position.set(0.4, 0.5, 0.3)
        this.camera.add(fill)
        this.vmKatana = new THREE.Group()
        this.vmArmL.add(this.vmKatana)
        this.setMelee(STARTER_MELEE)
        this.viewmodel.add(this.vmArmR)
        this.viewmodel.add(this.vmArmL)
        this.camera.add(this.viewmodel)
    }

    /** Raises the gun or the blade; the other one drops out of view. */
    private hold(what: 'gun' | 'melee'): void {
        if (this.held === what) return
        this.held = what
        this.switchTimer = 0.2
        this.hud.held = what
    }

    /** Swaps the blade in hand. */
    private setMelee(id: MeleeId): void {
        this.meleeDef = MELEE_WEAPONS[id]
        for (const child of [...this.vmKatana.children]) this.vmKatana.remove(child)
        const model = buildModel(meleeParts(id)).group
        model.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = false })
        this.vmKatana.add(model)
        this.vmKatana.position.set(0, 0.1, 0.55)
        this.vmKatana.rotation.x = -0.7
        this.hud.melee = { id, name: this.meleeDef.name, color: hexToCss(this.meleeDef.color) }
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
        this.glow.clear()
        this.smoke.clear()

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
        this.shield = 0
        this.hasteTimer = 0
        this.hitStop = 0
        this.credits = 0
        this.lastIncome = 0
        this.boons = []
        this.abilitySlots = [null, null]
        this.fieldTimer = 0
        for (const r of this.rifts) this.scene.remove(r.group)
        this.rifts = []
        this.stormTimer = 0
        this.lanceTimer = 0
        this.lanceReady = false
        this.stormKills = 0
        this.meteorCallTimer = 0
        this.hitIndicators = []
        this.lungeTarget = null
        for (const t of this.turrets) this.scene.remove(t.group)
        this.turrets = []
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
        this.held = 'gun'
        this.hud.held = 'gun'
        this.setMelee(STARTER_MELEE)
        this.addWeapon(STARTER_WEAPON, true)
        this.active = 0
        this.showWeapon()
        this.syncBladeCount()
        this.playerGroup.scale.setScalar(1)
        this.viewmodel.visible = true
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
        this.waveTotal = plan.spawns.length
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
        this.shield = Math.max(this.shield, this.stats.bulwark)
        this.meteorTimer = 3
        this.applyEventLighting(plan.event)
        if (plan.event === 'frenzy') this.spawnInterval *= 0.7
        const eventText = plan.event === 'meteors' ? 'METEOR STORM — watch the sky' : plan.event === 'frenzy' ? 'FRENZY — everything is faster' : plan.event === 'blackout' ? 'BLACKOUT — follow the eyes' : plan.event === 'bounty' ? 'BOUNTY — a gilded brute walks the arena' : ''
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
        this.bloom.threshold = blackout ? 0.75 : 1.0
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
                this.meteors.push({ target, mesh, timer: 1.5, total: 1.5, warning, friendly: false })
            }
        }
        if (this.stats.meteorCall > 0 && this.enemies.length > 0) {
            this.meteorCallTimer -= dt
            if (this.meteorCallTimer <= 0) {
                this.meteorCallTimer = 9 / this.stats.meteorCall
                this.callMeteor()
            }
        }
        for (let i = this.meteors.length - 1; i >= 0; i--) {
            const m = this.meteors[i]!
            m.timer -= dt
            const t = 1 - Math.max(0, m.timer) / m.total
            m.mesh.position.set(m.target.x + 6 * (1 - t), m.target.y + 46 * (1 - t * t), m.target.z - 4 * (1 - t))
            m.mesh.rotation.x += dt * 4
            m.mesh.rotation.y += dt * 3
            if (dt > 0) {
                const mp = m.mesh.position
                this.glow.emit({ x: mp.x, y: mp.y, z: mp.z, life: 0.25, size: 2.2, sizeEnd: 0.6, color: 0xfff0a0, colorEnd: 0xff5a1a, alpha: 0.6, shape: 'soft' })
                this.glow.emit({ x: mp.x + (Math.random() - 0.5), y: mp.y + Math.random(), z: mp.z + (Math.random() - 0.5), vx: (Math.random() - 0.5) * 4, vy: 4 + Math.random() * 4, vz: (Math.random() - 0.5) * 4, life: 0.4, size: 0.15, sizeEnd: 0.03, color: 0xffe14d, colorEnd: 0xff3a10, shape: 'spark', stretch: 0.05 })
                this.smoke.emit({ x: mp.x, y: mp.y + 0.8, z: mp.z, vy: 1, life: 1.1, size: 1.2, sizeEnd: 3, color: 0x3a3038, colorEnd: 0x101010, alpha: 0.35, shape: 'soft', rot: Math.random() * 6, spin: 1, fadeIn: 0.2 })
            }
            const ws = 3.5 * (1 - t) + 0.6
            m.warning.scale.set(ws, ws, 1)
            ;(m.warning.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(this.elapsed * 18) * 0.3
            if (m.timer <= 0) {
                this.scene.remove(m.mesh)
                this.scene.remove(m.warning)
                m.warning.geometry.dispose()
                ;(m.warning.material as THREE.Material).dispose()
                this.meteors.splice(i, 1)
                if (m.friendly) this.explode(m.target.clone().setY(m.target.y + 0.6), 4.5, 90 * this.stats.damageMult * this.waveHpMult * 0.5, 0xffa23a, false)
                else this.explode(m.target.clone().setY(m.target.y + 0.6), 3.6, 34 * this.waveDmgMult, 0xff7a2a, true)
                this.burst(m.target.x, m.target.y + 0.5, m.target.z, 30, [0x3a3040, 0x2c2434, 0xff7a2a], 8, 0.22)
            }
        }
    }

    /** Meteor Call: drop a friendly meteor on the densest cluster of enemies. */
    private callMeteor(): void {
        let best: Enemy | null = null
        let bestScore = -1
        for (const e of this.enemies) {
            if (!e.alive || e.state === 'spawn') continue
            let near = 0
            for (const o of this.enemies) if (o.alive && o.pos.distanceToSquared(e.pos) < 16) near++
            if (near > bestScore) {
                bestScore = near
                best = e
            }
        }
        if (!best) return
        const target = best.pos.clone()
        target.y = this.groundHeight(target.x, target.z, 0.5, 100)
        const mesh = buildModel(meteorParts(), 1.3).group
        mesh.position.set(target.x + 6, target.y + 46, target.z - 4)
        this.scene.add(mesh)
        const warning = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa23a).multiplyScalar(1.6), toneMapped: false, transparent: true, side: THREE.DoubleSide }))
        warning.rotation.x = -Math.PI / 2
        warning.position.set(target.x, target.y + 0.06, target.z)
        this.scene.add(warning)
        this.meteors.push({ target, mesh, timer: 1.1, total: 1.1, warning, friendly: true })
        this.audio.play('charge', 0.4)
    }

    private completeWave(): void {
        this.event = 'none'
        this.applyEventLighting('none')
        for (const m of this.meteors) {
            this.scene.remove(m.mesh)
            this.scene.remove(m.warning)
        }
        this.meteors = []
        for (const r of this.rifts) this.scene.remove(r.group)
        this.rifts = []
        // a fixed payout per wave, boosted by Bounty Hunter
        this.lastIncome = Math.round(waveIncome(this.wave) * (1 + this.stats.income))
        this.credits += this.lastIncome
        this.hud.phase = 'draft'
        this.audio.play('wave-clear')
        this.ui.banner('WAVE CLEAR', `+${this.lastIncome} credits`, 'clear')
        this.hp = Math.min(this.stats.maxHealth, this.hp + this.stats.maxHealth * 0.25)
        this.keys.clear()
        this.mouseDown = false
        this.rightDown = false
        if (document.pointerLockElement) document.exitPointerLock()
        this.boons = dealDraft(this.draftContext())
        this.pushShop()
        this.syncHud()
    }

    private draftContext(): DraftContext {
        return {
            wave: this.wave,
            stacks: this.stacks,
            ownedAbilities: this.abilitySlots.filter((a): a is AbilityId => a !== null),
            rng: randomFloat
        }
    }

    private reserveMaxOf(w: WeaponState): number {
        return reserveMax(w.def, this.stats)
    }

    private magazineOf(w: WeaponState): number {
        return magazineSize(w.def, this.stats)
    }

    /** Snapshot of everything the between-wave arsenal can sell. */
    private shopState(): ShopState {
        const weapons = WEAPON_IDS.map(id => {
            const def = WEAPONS[id]
            const slot = this.weapons.findIndex(w => w.def.id === id)
            const owned = slot >= 0
            const state = owned ? this.weapons[slot]! : null
            const max = reserveMax(def, this.stats)
            return {
                id,
                name: def.name,
                tagline: def.tagline,
                rarity: def.rarity,
                price: def.price,
                owned,
                slot,
                magazine: magazineSize(def, this.stats),
                reserve: state ? state.reserve : max,
                reserveMax: max,
                refillPrice: state ? refillPrice(def, state.reserve, max) : 0
            }
        })
        const melee = MELEE_IDS.map(id => {
            const def = MELEE_WEAPONS[id]
            return { id, name: def.name, tagline: def.tagline, rarity: def.rarity, price: ECONOMY.meleePrice[def.rarity], owned: this.meleeDef.id === id }
        })
        const abilities = ABILITY_IDS.map(id => {
            const def = ABILITIES[id]
            return { id, name: def.name, description: def.description, energy: def.energy, price: ECONOMY.abilityPrice, owned: this.abilitySlots.includes(id), icon: def.icon, color: def.color }
        })
        return {
            credits: Math.floor(this.credits),
            wave: this.wave,
            income: this.lastIncome,
            boons: this.boons,
            rerollCost: rerollPrice(this.wave),
            weapons,
            melee,
            abilities,
            slots: Array.from({ length: MAX_WEAPONS }, (_, i) => this.weapons[i]?.def.id ?? null),
            maxWeapons: MAX_WEAPONS,
            refillAllPrice: weapons.reduce((sum, w) => sum + w.refillPrice, 0)
        }
    }

    private pushShop(): void {
        this.ui.shop(this.shopState())
    }

    private spend(cost: number): boolean {
        if (this.hud.phase !== 'draft') return false
        if (this.credits < cost) {
            this.audio.play('dry', 0.5)
            return false
        }
        this.credits -= cost
        return true
    }

    /** A fresh hand of boons. Returns false if you cannot afford it. */
    rerollBoons(): boolean {
        if (!this.spend(rerollPrice(this.wave))) return false
        this.audio.play('select', 0.8)
        this.boons = dealDraft(this.draftContext())
        this.pushShop()
        this.syncHud()
        return true
    }

    /** Buys one boon from the hand. */
    buyBoon(card: DraftCard): boolean {
        if (!this.boons.some(c => c.draftKey === card.draftKey)) return false
        if (!this.spend(card.cost)) return false
        const before = this.stats.maxHealth
        applyCard(card, this.stats, this.stacks)
        if (card.id === 'health') this.hp = this.stats.maxHealth
        else if (this.stats.maxHealth > before) this.hp += this.stats.maxHealth - before
        this.hp = Math.min(this.hp, this.stats.maxHealth)
        // reserve boons widen every gun's pockets straight away
        for (const w of this.weapons) w.reserve = Math.min(w.reserve, this.reserveMaxOf(w))
        this.boons = this.boons.filter(c => c.draftKey !== card.draftKey)
        this.takenUpgrades.push(card.name)
        this.syncBladeCount()
        this.audio.play('upgrade', 0.8)
        this.pushShop()
        this.syncHud()
        return true
    }

    /**
     * Buys a gun. With a free slot it goes there; when the loadout is full the
     * UI must pass the slot to replace, otherwise 'slot' is returned.
     */
    buyWeapon(id: WeaponId, slot?: number): 'ok' | 'poor' | 'slot' | 'owned' {
        if (this.hud.phase !== 'draft') return 'poor'
        if (this.weapons.some(w => w.def.id === id)) return 'owned'
        const def = WEAPONS[id]
        const price = def.price
        if (this.credits < price) {
            this.audio.play('dry', 0.5)
            return 'poor'
        }
        if (this.weapons.length >= MAX_WEAPONS && slot === undefined) return 'slot'
        this.credits -= price
        this.addWeapon(id, false, slot)
        this.takenUpgrades.push(def.name)
        this.pushShop()
        this.syncHud()
        return 'ok'
    }

    /** Fills a gun's reserve, or every gun's with 'all'. */
    refillAmmo(id: WeaponId | 'all'): boolean {
        const targets = this.weapons.filter(w => id === 'all' || w.def.id === id)
        const price = targets.reduce((sum, w) => sum + refillPrice(w.def, w.reserve, this.reserveMaxOf(w)), 0)
        if (price <= 0 || !this.spend(price)) return false
        for (const w of targets) w.reserve = this.reserveMaxOf(w)
        this.audio.play('reload-done', 0.9)
        this.pushShop()
        this.syncHud()
        return true
    }

    buyMelee(id: MeleeId): boolean {
        if (this.meleeDef.id === id) return false
        const def = MELEE_WEAPONS[id]
        if (!this.spend(ECONOMY.meleePrice[def.rarity])) return false
        this.setMelee(id)
        this.takenUpgrades.push(def.name)
        this.ui.toast(`${this.meleeDef.name} equipped`, hexToCss(this.meleeDef.color))
        this.audio.play('upgrade', 0.8)
        this.pushShop()
        this.syncHud()
        return true
    }

    /** Abilities bind to Q and E; when both are taken the UI must pass the slot to replace. */
    buyAbility(id: AbilityId, slot?: number): 'ok' | 'poor' | 'slot' | 'owned' {
        if (this.hud.phase !== 'draft') return 'poor'
        if (this.abilitySlots.includes(id)) return 'owned'
        if (this.credits < ECONOMY.abilityPrice) {
            this.audio.play('dry', 0.5)
            return 'poor'
        }
        let target = slot ?? this.abilitySlots.indexOf(null)
        if (target < 0) return 'slot'
        target = THREE.MathUtils.clamp(target, 0, ABILITY_SLOTS - 1)
        this.credits -= ECONOMY.abilityPrice
        this.abilitySlots[target] = id
        this.takenUpgrades.push(ABILITIES[id].name)
        this.ui.toast(`${ABILITIES[id].name} bound to ${target === 0 ? 'Q' : 'E'}`, ABILITIES[id].color)
        this.audio.play('upgrade', 0.8)
        this.pushShop()
        this.syncHud()
        return 'ok'
    }

    /** Leave the shop and start the next wave. Magazines top up from the reserve. */
    finishShop(): void {
        if (this.hud.phase !== 'draft') return
        this.dashCharges = Math.min(this.stats.dashCharges, this.dashCharges + 1)
        for (const w of this.weapons) {
            const mag = this.magazineOf(w)
            const take = Math.min(mag - w.ammo, w.reserve)
            if (take > 0) {
                w.ammo += take
                w.reserve -= take
            }
            w.reloading = false
            w.burstLeft = 0
        }
        this.boons = []
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
        this.viewmodel.visible = false
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
            this.castSlot(0)
        } else if (code === 'KeyE') {
            this.castSlot(1)
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

    /** Where the camera actually looks, recoil included — bullets follow this exactly. */
    private aimDir(out: THREE.Vector3): THREE.Vector3 {
        return this.camera.getWorldDirection(out)
    }

    private eyeHeight(): number {
        return (1.62 - (this.slideTimer > 0 ? 0.55 : 0)) * this.stats.scale
    }

    /** Puts the camera at the eyes; called before firing so the muzzle matches the frame. */
    private placeCamera(): void {
        const moving = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 6)
        const bob = this.onGround && this.slideTimer <= 0 ? Math.sin(this.walkPhase * 2) * 0.028 * moving : 0
        this.camera.position.set(this.pos.x, this.pos.y + this.eyeHeight() + bob, this.pos.z)
        this.camera.rotation.set(this.pitch + this.recoilPitch, this.yaw, this.slideTimer > 0 ? 0.05 : 0, 'YXZ')
    }

    private playerCenter(out: THREE.Vector3): THREE.Vector3 {
        return out.set(this.pos.x, this.pos.y + 1.1 * this.stats.scale, this.pos.z)
    }

    private get playerRadius(): number {
        return 0.5 * this.stats.scale
    }

    private frenzyMult(): number {
        return (1 + this.frenzyStacks * 0.06) * (this.hasteTimer > 0 ? 1.35 : 1) * (this.adrenalineOn() ? 1.15 : 1)
    }

    private adrenalineOn(): boolean {
        return this.stats.adrenaline > 0 && this.hp < this.stats.maxHealth * 0.4
    }

    /** Damage multiplier from temporary states: overdrive, adrenaline. */
    private damageBoost(): number {
        return (this.overdriveTimer > 0 ? 2 : 1) * (this.adrenalineOn() ? 1 + 0.4 * this.stats.adrenaline : 1)
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
        this.glow.emit({ x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z, life: 0.25, size: 1, sizeEnd: 4, color: 0x3ff0ff, alpha: 0.6, shape: 'ring' })
        for (let i = 0; i < 14; i++) {
            const s = 6 + Math.random() * 8
            this.glow.emit({ x: this.pos.x + (Math.random() - 0.5), y: this.pos.y + Math.random() * 1.4, z: this.pos.z + (Math.random() - 0.5), vx: -this.dashDir.x * s, vy: (Math.random() - 0.5) * 2, vz: -this.dashDir.z * s, life: 0.25 + Math.random() * 0.2, size: 0.08, sizeEnd: 0.02, color: 0xffffff, colorEnd: 0x3ff0ff, drag: 4, shape: 'spark', stretch: 0.08 })
        }
        if (this.stats.thunderStep > 0) this.thunderStep()
    }

    /** Thunder Step: lightning leaps from you into the nearest enemies as you dash. */
    private thunderStep(): void {
        const from = this.playerCenter(new THREE.Vector3())
        const seen = new Set<number>()
        const dmg = 28 * this.stats.thunderStep * this.stats.damageMult
        let struck = 0
        for (let i = 0; i < 4; i++) {
            const next = this.nearestEnemy(from, 11, seen)
            if (!next) break
            seen.add(next.id)
            const nc = new THREE.Vector3(next.pos.x, next.pos.y + next.height * next.scale * 0.5, next.pos.z)
            this.spawnLightning(from, nc, 0x7dd3fc, 0.16)
            this.hitEnemy(next, dmg, nc.clone().sub(from).normalize(), 3, 'explosion')
            struck++
        }
        if (struck > 0) this.audio.play('storm', 0.35)
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
        if (this.hasteTimer > 0) this.hasteTimer -= dt
        if (this.meleeComboTimer > 0) {
            this.meleeComboTimer -= dt
            if (this.meleeComboTimer <= 0) this.meleeCombo = 0
        }
        if (this.meleeCooldown > 0) this.meleeCooldown -= dt
        if (this.regenDelay > 0) this.regenDelay -= dt
        else if (s.healthRegen > 0 && this.hp < s.maxHealth) this.hp = Math.min(s.maxHealth, this.hp + s.healthRegen * dt)

        // zoom blend — aiming in the air also glides
        if (this.adsHeld && this.held === 'melee') {
            this.hold('gun')
            this.meleeTimer = 0
            this.meleeComboTimer = 0
        }
        const wantAds = this.adsHeld && this.meleeTimer <= 0 && this.dashTimer <= 0
        this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 12)
        if (this.ads < 0.002) this.ads = 0
        this.spreadBloom = Math.max(0, this.spreadBloom - dt * 0.16)
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
        // melee lunge — toward the locked target if there is one, else straight ahead
        if (this.meleeTimer > 0 && this.meleeTimer > this.meleeDef.swingTime * 0.4) {
            const lunge = this.meleeDef.lunge
            const t = this.lungeTarget
            if (t && t.alive) {
                const d = _v2.set(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z)
                const len = d.length()
                if (len > 1.6) {
                    d.divideScalar(len)
                    this.vel.x += d.x * lunge * dt * 9
                    this.vel.z += d.z * lunge * dt * 9
                }
            } else {
                const f = this.forward(_v2)
                this.vel.x += f.x * lunge * dt * 4
                this.vel.z += f.z * lunge * dt * 4
            }
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
            // jump pads fling you skyward the moment you touch them
            for (const pad of this.jumpPads) {
                if (Math.abs(pad.y - ground) < 0.3 && Math.hypot(this.pos.x - pad.x, this.pos.z - pad.z) < 1.1) {
                    this.vel.y = 25
                    this.onGround = false
                    this.jumpsUsed = 1
                    this.slideTimer = 0
                    this.fovKick = 0.9
                    this.audio.play('jump', 1)
                    this.audio.play('dash', 0.5)
                    this.burst(pad.x, pad.y + 0.3, pad.z, 26, [0x3ff0ff, 0xffffff], 7, 0.14)
                    this.spawnShockwave(pad, 2.4, 0x3ff0ff, 0.3)
                    break
                }
            }
        } else if (this.pos.y > ground + 0.08) {
            this.onGround = false
        }

        const moving = Math.hypot(this.vel.x, this.vel.z)
        this.walkPhase += moving * dt * 1.6
        this.playerGroup.position.copy(this.pos)
        this.recoilPitch *= Math.max(0, 1 - dt * 12)
        if (this.switchTimer > 0) this.switchTimer -= dt
        this.placeCamera()
        this.updateViewmodel(dt)

        // combat inputs held — after posing so the muzzle matches the drawn gun.
        // With the blade out the trigger swings it; the gun comes back with RMB, 1-3 or the wheel.
        if (this.mouseDown || this.mouseJustDown) {
            if (this.held === 'melee') this.melee()
            else this.tryFire()
        }
        this.mouseJustDown = false
        this.updateWeapon(dt)
        this.updateMelee(dt)
        this.updateBlades(dt)
        this.updateAura(dt)
        this.updateTurrets(dt)
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
        this.placeCamera()
        // shake
        if (this.shake > 0) {
            this.shake = Math.max(0, this.shake - dt * 3)
            this.shakeVec.set((Math.random() - 0.5), (Math.random() - 0.5), 0).multiplyScalar(this.shake * 0.12)
            this.camera.position.add(this.shakeVec)
            this.camera.rotation.z += (Math.random() - 0.5) * this.shake * 0.04
            this.camera.rotation.x += (Math.random() - 0.5) * this.shake * 0.03
        }
        this.fovKick = Math.max(0, this.fovKick - dt * 4)
        const w = this.weapon
        const adsFov = w ? w.def.adsFov : 55
        const fov = THREE.MathUtils.lerp(78 + this.fovKick * 12 + (this.overdriveTimer > 0 ? 4 : 0), adsFov, this.ads)
        if (Math.abs(this.camera.fov - fov) > 0.05) {
            this.camera.fov = fov
            this.camera.updateProjectionMatrix()
        }
        this.sun.target.position.copy(this.pos)
        this.sun.position.set(this.pos.x + 28, 52, this.pos.z + 18)
    }

    private updateViewmodel(dt: number): void {
        const w = this.weapon
        const dy = this.yaw - this.lastYaw
        const dp = this.pitch - this.lastPitch
        this.lastYaw = this.yaw
        this.lastPitch = this.pitch
        this.vmSway.x += (THREE.MathUtils.clamp(-dy * 1.6, -0.09, 0.09) - this.vmSway.x) * Math.min(1, dt * 9)
        this.vmSway.y += (THREE.MathUtils.clamp(-dp * 1.6, -0.09, 0.09) - this.vmSway.y) * Math.min(1, dt * 9)
        this.vmKick *= Math.max(0, 1 - dt * 15)
        const moving = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 7)
        const grounded = this.onGround && this.slideTimer <= 0 ? 1 : 0
        const bobX = Math.sin(this.walkPhase) * 0.022 * moving * grounded
        const bobY = Math.abs(Math.cos(this.walkPhase)) * 0.02 * moving * grounded
        const ads = this.ads
        // hip pose → aim pose that puts the sight on the camera axis
        const hip = _v1.set(0.3 + bobX, -0.34 + bobY, -0.46)
        // aiming parks the sight just under the reticle so the gun never covers the target
        const aim = _v2.set(0, -(this.sightHeight(w?.def) + 0.14) * VM_SCALE, -0.46)
        this.vmArmR.position.copy(hip).lerp(aim, ads)
        this.vmArmR.position.x += this.vmSway.x * (1 - ads * 0.8)
        this.vmArmR.position.y += this.vmSway.y * (1 - ads * 0.8) - this.switchTimer * 1.2
        this.vmArmR.position.z += this.vmKick * 0.14
        this.vmArmR.rotation.set(-this.vmKick * 0.45 - this.vmSway.y * 0.4 + this.switchTimer * 1.2, Math.PI + this.vmSway.x * 0.5, 0)
        if (this.dashTimer > 0) this.vmArmR.rotation.z = 0.22
        if (this.slideTimer > 0) this.vmArmR.rotation.z = -0.18
        if (w?.reloading) {
            const total = w.def.reloadTime * this.stats.reloadMult
            const t = 1 - w.reloadTimer / total
            this.vmArmR.rotation.x += Math.sin(t * Math.PI) * 0.9
            this.vmArmR.rotation.z += Math.sin(t * Math.PI * 2) * 0.35
            this.vmArmR.position.y -= Math.sin(t * Math.PI) * 0.12
        }
        // only the held weapon is drawn; the scope hides the rifle while you look through the glass
        this.vmArmR.visible = this.held === 'gun' && !(w && w.def.sight === 'scope' && ads > 0.7)
        const melee = this.meleeTimer > 0
        this.vmArmL.visible = this.held === 'melee' || this.slamming
        if (this.vmArmL.visible && !melee && !this.slamming) {
            // idle guard: blade in the right hand, angled up across the view, bobbing with the walk
            this.vmArmL.position.set(0.24 + bobX, -0.3 + bobY - this.switchTimer * 1.2, -0.5)
            this.vmArmL.rotation.set(-0.5 + this.switchTimer * 1.5, Math.PI - 0.7 + this.vmSway.x * 0.5, -0.45)
        } else if (this.vmArmL.visible) {
            const t = melee ? 1 - this.meleeTimer / this.meleeDef.swingTime : 0
            const swing = melee ? Math.sin(t * Math.PI) : 0
            const side = this.meleeCombo % 2 ? 1 : -1
            const finisher = this.meleeCombo === MELEE.comboLength - 1
            // sweep the blade across the view from the right hand: right-to-left, back, then the big overhead
            const sweep = melee ? t : 0
            this.vmArmL.position.set(side < 0 ? 0.28 - sweep * 0.65 : -0.3 + sweep * 0.6, -0.3 + (this.slamming ? 0.25 : 0) + (finisher ? Math.sin(sweep * Math.PI) * 0.35 : 0), -0.5 - swing * 0.2)
            this.vmArmL.rotation.set(-0.3 - (finisher ? sweep * 1.8 : 0) + (this.slamming ? -1.3 : 0), Math.PI - 0.9 * side + sweep * 1.8 * side, -side * (0.5 - sweep * 1.4))
        }
    }

    /** How far above the grip the sight sits, so ADS lands it on the reticle. */
    private sightHeight(def?: WeaponDef): number {
        if (!def) return 0.6
        switch (def.sight) {
            case 'scope': return 0.62
            case 'holo': return 0.59
            case 'iron': return 0.48
            case 'ring': return 0.58
            default: return 0.58
        }
    }

    // ── Weapons ──────────────────────────────────────────────────────────

    /** Adds a gun to the loadout. With a full loadout `slot` says which gun it replaces (defaults to the active one). */
    private addWeapon(id: WeaponId, silent: boolean, slot?: number): void {
        const existing = this.weapons.findIndex(w => w.def.id === id)
        if (existing >= 0) {
            this.switchWeapon(existing)
            return
        }
        const def = WEAPONS[id]
        const model = buildModel(weaponParts(id)).group
        model.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = false })
        model.position.set(0, 0.28, 0.12)
        model.visible = false
        this.vmArmR.add(model)
        const state: WeaponState = { def, ammo: magazineSize(def, this.stats), reserve: reserveMax(def, this.stats), reloading: false, reloadTimer: 0, fireTimer: 0, burstLeft: 0, burstTimer: 0, model }
        if (this.weapons.length >= MAX_WEAPONS) {
            const at = THREE.MathUtils.clamp(slot ?? this.active, 0, this.weapons.length - 1)
            const old = this.weapons[at]!
            old.model.parent?.remove(old.model)
            this.weapons[at] = state
            this.active = at
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
        this.hud.sight = this.weapon?.def.sight ?? 'reddot'
        this.switchTimer = 0.22
    }

    private switchWeapon(index: number): void {
        if (index < 0 || index >= this.weapons.length) return
        if (index === this.active) {
            // the same slot while the blade is out just brings the gun back
            if (this.held === 'melee') {
                this.hold('gun')
                this.meleeComboTimer = 0
                this.audio.play('select', 0.7)
            }
            return
        }
        const cur = this.weapons[this.active]
        if (cur?.reloading) {
            cur.reloading = false
            cur.reloadTimer = 0
        }
        this.active = index
        this.showWeapon()
        this.hold('gun')
        this.audio.play('select', 0.7)
    }

    private get weapon(): WeaponState {
        return this.weapons[this.active]!
    }

    private startReload(): void {
        const w = this.weapon
        const mag = this.magazineOf(w)
        if (w.reloading || w.ammo >= mag) return
        if (w.reserve <= 0) {
            this.audio.play('dry', 0.5)
            this.ui.toast('No reserve ammo — switch weapon', '#f87171')
            return
        }
        w.reloading = true
        w.burstLeft = 0
        w.reloadTimer = w.def.reloadTime * this.stats.reloadMult
        this.audio.play('reload')
    }

    /** Picks the next gun with rounds left, or null when every gun is dry. */
    private nextLoadedWeapon(): number {
        for (let i = 1; i <= this.weapons.length; i++) {
            const idx = (this.active + i) % this.weapons.length
            const w = this.weapons[idx]!
            if (w.ammo > 0 || w.reserve > 0) return idx
        }
        return -1
    }

    private updateWeapon(dt: number): void {
        for (const w of this.weapons) {
            if (w.fireTimer > 0) w.fireTimer -= dt
            if (w.burstLeft > 0) {
                w.burstTimer -= dt
                if (w.burstTimer <= 0 && w === this.weapon && this.held === 'gun' && this.meleeTimer <= 0) this.fireRound(w, true)
                else if (w !== this.weapon) w.burstLeft = 0
            }
            if (w.reloading) {
                w.reloadTimer -= dt
                if (w.reloadTimer <= 0) {
                    w.reloading = false
                    const take = Math.min(this.magazineOf(w) - w.ammo, w.reserve)
                    w.ammo += take
                    w.reserve -= take
                    if (w === this.weapon) {
                        this.audio.play('reload-done')
                        if (this.stats.reloadBlast > 0) this.reloadBlast()
                    }
                }
            }
        }
        if (this.stats.lance > 0 && !this.lanceReady) {
            this.lanceTimer -= dt
            if (this.lanceTimer <= 0) {
                this.lanceReady = true
                this.ui.toast('SUN LANCE READY', '#fde68a')
                this.audio.play('chrono', 0.4)
            }
        }
        this.muzzleLight.intensity *= Math.max(0, 1 - dt * 22)
        this.flashLight.intensity *= Math.max(0, 1 - dt * 9)
    }

    private muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
        const w = this.weapon
        this.camera.updateMatrixWorld(true)
        if (!this.vmArmR.visible) return this.camera.localToWorld(out.set(0.05, -0.1, -0.7))
        return w.model.localToWorld(out.set(0, 0.06, 1.0))
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
        if (!w) return
        if (this.held === 'melee' || this.meleeTimer > 0) return
        if (!w.def.auto && !this.mouseJustDown) return
        if (w.fireTimer > 0 || w.burstLeft > 0) return
        if (w.reloading) return
        if (w.ammo <= 0) {
            if (w.reserve <= 0) {
                // bone dry: hand over to the next gun that still has rounds
                const next = this.nextLoadedWeapon()
                if (next >= 0 && this.mouseJustDown) {
                    this.switchWeapon(next)
                    this.ui.toast(`${w.def.name} empty — switched to ${this.weapons[next]!.def.name}`, '#fbbf24')
                } else if (this.mouseJustDown) {
                    this.audio.play('dry', 0.5)
                    this.ui.toast('Out of ammo — use your blade', '#f87171')
                }
                return
            }
            this.startReload()
            if (this.mouseJustDown) this.audio.play('dry', 0.5)
            return
        }
        if (w.def.burst > 1) {
            w.burstLeft = w.def.burst
            w.fireTimer = w.def.burstGap + w.def.burst / (w.def.fireRate * this.stats.fireRateMult * this.frenzyMult())
        }
        this.fireRound(w, false)
    }

    /** Fires one round from `w`; bursts call this once per round. */
    private fireRound(w: WeaponState, inBurst: boolean): void {
        if (w.ammo <= 0) {
            w.burstLeft = 0
            return
        }
        w.ammo--
        const rate = w.def.fireRate * this.stats.fireRateMult * this.frenzyMult()
        if (w.def.burst > 1) {
            w.burstLeft = Math.max(0, w.burstLeft - 1)
            w.burstTimer = 1 / rate
        } else {
            w.fireTimer = 1 / rate
        }
        const lance = this.lanceReady && this.stats.lance > 0
        if (lance) {
            this.lanceReady = false
            this.lanceTimer = 7
        }
        const muzzle = this.muzzleWorld(new THREE.Vector3())
        const aim = this.aimPoint(new THREE.Vector3())
        const dir = aim.sub(muzzle).normalize()
        const color = new THREE.Color(w.def.color)
        const special = w.def.kind === 'plasma' || w.def.kind === 'arc' || w.def.kind === 'flame'
        this.audio.play(`shoot-${w.def.id}` as ArenaSound, inBurst ? 0.85 : 1)
        this.recoilPitch += w.def.recoil * 0.022 * (1 - this.ads * 0.45)
        this.pitch = Math.min(0.9, this.pitch + w.def.recoil * 0.003 * (1 - this.ads * 0.5))
        this.yaw += (Math.random() - 0.5) * w.def.recoil * 0.004
        this.vmKick = Math.min(1, this.vmKick + w.def.recoil * 0.4)
        this.shake = Math.max(this.shake, w.def.recoil * 0.12)
        const spreadMult = THREE.MathUtils.lerp(1, w.def.adsSpread, this.ads)
        const baseSpread = (w.def.spread + this.spreadBloom) * spreadMult
        this.spreadBloom = Math.min(0.06, this.spreadBloom + w.def.bloom)
        this.muzzleLight.color.set(special ? w.def.color : 0xffc070)
        this.muzzleLight.position.copy(muzzle).addScaledVector(dir, 1.6)
        this.muzzleLight.intensity = 1.4 + w.def.recoil * 0.8
        this.spawnMuzzleFlash(muzzle, dir, special ? color : _c1.set(0xffd9a0), (special ? 0.2 : 0.12 + w.def.recoil * 0.03) * (1 - this.ads * 0.4), special ? w.def.kind : 'gun', this.ads)
        if (!special) this.ejectCasing()

        const dmg = w.def.damage * this.stats.damageMult
        if (lance) {
            this.fireLance(muzzle, dir, dmg * w.def.pellets * 6)
        } else if (w.def.kind === 'rail') {
            this.fireRail(this.camera.position.clone(), this.aimDir(new THREE.Vector3()), dmg, w.def, muzzle)
        } else if (w.def.kind === 'arc') {
            this.fireArc(this.camera.position.clone(), this.aimDir(new THREE.Vector3()), dmg, w.def, muzzle)
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
                    // fire starts a little past the nozzle so the cubes never fill the camera
                    pos: w.def.kind === 'flame' ? muzzle.clone().addScaledVector(d, 1.1) : muzzle.clone(),
                    vel: d.multiplyScalar(w.def.projectileSpeed * this.stats.projectileSpeedMult),
                    life: w.def.kind === 'flame' ? 0.42 : 2.6,
                    damage: dmg,
                    def: w.def,
                    color,
                    size: (w.def.kind === 'plasma' ? 0.42 : w.def.kind === 'disc' ? 0.55 : w.def.kind === 'flame' ? 0.3 : 0.11) * (1 + this.stats.bulletSize * 0.6),
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
        if (w.ammo <= 0 && w.burstLeft <= 0 && w.reserve > 0) this.startReload()
    }

    /** Sun Lance: a blinding beam that goes through everything in front of you. */
    private fireLance(origin: THREE.Vector3, dir: THREE.Vector3, damage: number): void {
        const end = origin.clone().addScaledVector(dir, 90)
        let hits = 0
        for (const e of this.enemies) {
            if (!e.alive || e.state === 'spawn') continue
            const c = _v1.set(e.pos.x, e.pos.y + e.height * e.scale * 0.5, e.pos.z)
            if (segmentSphere(origin, end, c, e.radius * e.scale + 0.9) >= 0) {
                this.hitEnemy(e, damage, dir, 14, 'bullet')
                hits++
            }
        }
        this.spawnBeam(origin, end, 0xfff1a8, 1.1, 0.5)
        this.spawnBeam(origin, end, 0xffffff, 0.35, 0.3)
        this.spawnShockwave(this.pos, 3, 0xfde68a, 0.3)
        this.flashLight.color.set(0xfff1a8)
        this.flashLight.position.copy(origin).addScaledVector(dir, 4)
        this.flashLight.intensity = 60
        this.shake = Math.max(this.shake, 1.2)
        this.fovKick = 1.3
        this.hitStop = Math.max(this.hitStop, hits > 0 ? 0.05 : 0)
        this.audio.play('lance', 1)
    }

    /** Kinetic Reload: a shockwave rolls out of you when the magazine seats. */
    private reloadBlast(): void {
        const radius = (5 + this.stats.reloadBlast * 1.5) * this.stats.scale
        const dmg = 25 * this.stats.reloadBlast * this.stats.damageMult
        for (const e of this.enemies) {
            if (!e.alive || e.state === 'spawn') continue
            const d = e.pos.distanceTo(this.pos)
            if (d > radius + e.radius * e.scale) continue
            this.hitEnemy(e, dmg, _v1.copy(e.pos).sub(this.pos).setY(0.3).normalize(), 16, 'nova')
        }
        this.spawnShockwave(this.pos, radius, 0xa5f3fc, 0.4)
        this.burst(this.pos.x, this.pos.y + 1, this.pos.z, 24, [0xa5f3fc, 0xffffff], 7, 0.14)
        this.audio.play('nova', 0.45)
        this.shake = Math.max(this.shake, 0.4)
    }

    private applyBurn(e: Enemy, seconds: number, dps: number): void {
        if (seconds <= 0 || !e.alive) return
        e.burnTimer = Math.max(e.burnTimer, seconds)
        e.burnDps = Math.max(e.burnDps, dps)
    }

    /** E: drop a sentry turret in front of you for a while. */
    private deployTurret(): void {
        if (this.turrets.length >= TURRET.maxActive) {
            const old = this.turrets.shift()!
            this.scene.remove(old.group)
            this.burst(old.pos.x, old.pos.y + 0.5, old.pos.z, 12, [0x3a3f4b, 0xd9a63c], 4, 0.14)
        }
        const f = this.forward(_v1)
        const pos = new THREE.Vector3(this.pos.x + f.x * 1.8, 0, this.pos.z + f.z * 1.8)
        pos.x = THREE.MathUtils.clamp(pos.x, -ARENA_HALF + 1, ARENA_HALF - 1)
        pos.z = THREE.MathUtils.clamp(pos.z, -ARENA_HALF + 1, ARENA_HALF - 1)
        pos.y = this.groundHeight(pos.x, pos.z, 0.5, this.pos.y + STEP_HEIGHT)
        const model = buildModel(turretParts())
        model.group.position.copy(pos)
        model.group.scale.setScalar(0.01)
        this.scene.add(model.group)
        this.turrets.push({ group: model.group, head: model.parts.get('head') ?? model.group, pos, life: TURRET.duration + 6 * this.stats.sentry, fireTimer: 0.4, shots: 0 })
        this.burst(pos.x, pos.y + 0.4, pos.z, 16, [0x3ff0ff, 0xd9a63c], 4, 0.12)
        this.spawnShockwave(pos, 2, 0x3ff0ff, 0.3)
        this.audio.play('pickup-weapon', 0.6)
    }

    private updateTurrets(dt: number): void {
        for (let i = this.turrets.length - 1; i >= 0; i--) {
            const t = this.turrets[i]!
            t.life -= dt
            t.group.scale.setScalar(Math.min(1, t.group.scale.x + dt * 6))
            if (t.life <= 0) {
                this.scene.remove(t.group)
                this.burst(t.pos.x, t.pos.y + 0.5, t.pos.z, 14, [0x3a3f4b, 0xe9e4d6, 0x3ff0ff], 5, 0.14)
                this.turrets.splice(i, 1)
                continue
            }
            const muzzle = _v1.set(t.pos.x, t.pos.y + 0.7, t.pos.z)
            const target = this.nearestEnemy(muzzle, TURRET.range)
            if (!target) {
                t.head.rotation.y += dt * 1.2
                continue
            }
            const tc = _v2.set(target.pos.x, target.pos.y + target.height * target.scale * 0.5, target.pos.z)
            t.head.rotation.y = Math.atan2(tc.x - t.pos.x, tc.z - t.pos.z)
            t.fireTimer -= dt
            if (t.fireTimer > 0 || t.life < 0.3) continue
            t.fireTimer = 1 / TURRET.fireRate
            const dir = tc.clone().sub(muzzle).normalize()
            dir.x += (Math.random() - 0.5) * 0.04
            dir.y += (Math.random() - 0.5) * 0.04
            this.glow.emit({ x: muzzle.x + dir.x * 0.7, y: muzzle.y + dir.y * 0.7, z: muzzle.z + dir.z * 0.7, life: 0.06, size: 0.6, sizeEnd: 0.2, color: 0xffffff, colorEnd: 0x3ff0ff, shape: 'star', rot: Math.random() * 3 })
            this.projectiles.push({
                pos: muzzle.clone().addScaledVector(dir, 0.6),
                vel: dir.multiplyScalar(60),
                life: 1.6,
                damage: TURRET.damage * (1 + 0.5 * this.stats.sentry) * this.stats.damageMult,
                def: WEAPONS.rifle,
                color: new THREE.Color(0x3ff0ff),
                size: 0.12,
                pierceLeft: 0,
                ricochetLeft: 0,
                hit: new Set(),
                homing: 0,
                explosionRadius: 0,
                spin: 0,
                alive: true
            })
            t.shots++
            if (t.shots % 3 === 0) this.audio.play('shoot-smg', 0.25)
        }
    }

    /** A brass casing kicked out to the right of the gun; it bounces on the floor. */
    private ejectCasing(): void {
        this.camera.updateMatrixWorld(true)
        const at = this.camera.localToWorld(_v1.set(0.22, -0.18, -0.55))
        const right = _v2.set(1, 0.4, 0.2).applyQuaternion(this.camera.quaternion).normalize()
        this.spawnDebris(at.x, at.y, at.z, right.x * 2.5 + (Math.random() - 0.5), right.y * 3 + 1, right.z * 2.5 + (Math.random() - 0.5), 0xd9b25a, 0.045, 1.4 + Math.random() * 0.6)
    }

    private fireRail(origin: THREE.Vector3, dir: THREE.Vector3, damage: number, def: WeaponDef, muzzle: THREE.Vector3): void {
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
            this.sparks(p, dir, 10, def.color, 9, 0.7)
            this.glow.emit({ x: p.x, y: p.y, z: p.z, life: 0.12, size: 1.4, sizeEnd: 0.4, color: 0xffffff, colorEnd: def.color, shape: 'star', rot: Math.random() * 3 })
            count++
        }
        // beam is drawn to the far point, or where it stops piercing
        let stopT = 1
        for (const b of this.colliders) {
            const hit = new THREE.Ray(origin, dir).intersectBox(b, _v1)
            if (hit) stopT = Math.min(stopT, origin.distanceTo(hit) / maxDist)
        }
        const beamEnd = origin.clone().lerp(end, stopT)
        this.spawnBeam(muzzle, beamEnd, 0xffe6b8, 0.035, 0.1)
        if (stopT < 1) this.impactWall(beamEnd, dir, 0xffe0a0, true)
        this.shake = Math.max(this.shake, 0.5)
    }

    private fireArc(origin: THREE.Vector3, dir: THREE.Vector3, damage: number, def: WeaponDef, muzzle: THREE.Vector3): void {
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
            this.spawnLightning(muzzle, end.clone().lerp(origin, 0.55), def.color, 0.12)
            return
        }
        const hit = new Set<number>()
        let from = muzzle.clone()
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
        this.glow.emit({ x: at.x, y: at.y, z: at.z, life: 0.1, size: 1, sizeEnd: 0.3, color: 0xffffff, colorEnd: 0x3ff0ff, shape: 'star', rot: Math.random() * 3 })
        this.glow.emit({ x: at.x, y: at.y, z: at.z, life: 0.2, size: 0.3, sizeEnd: 2.2, color: 0x3ff0ff, alpha: 0.6, shape: 'ring' })
        this.sparks(at, null, 8, 0x3ff0ff, 6)
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
        if (this.meleeTimer > 0 || this.meleeCooldown > 0 || this.slamming) return
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
        const m = this.meleeDef
        this.hold('melee')
        this.meleeTimer = m.swingTime
        this.meleeCooldown = 1 / (m.rate * this.frenzyMult())
        this.meleeHitDone = false
        this.meleeComboTimer = MELEE.comboWindow
        // lock the nearest enemy in a forward cone so the swing carries you to it
        const f = this.forward(_v2)
        let best: Enemy | null = null
        let bestD = (4 + m.range) * this.stats.scale
        for (const e of this.enemies) {
            if (!e.alive || e.state === 'spawn') continue
            const dx = e.pos.x - this.pos.x
            const dz = e.pos.z - this.pos.z
            const d = Math.hypot(dx, dz)
            if (d > bestD || d < 0.01 || Math.abs(e.pos.y - this.pos.y) > 2.5) continue
            if ((dx * f.x + dz * f.z) / d < 0.5) continue
            bestD = d
            best = e
        }
        this.lungeTarget = best
        const finisher = this.meleeCombo === MELEE.comboLength - 1
        this.audio.play('slash', finisher ? 1.3 : 0.9 + m.swingTime)
        this.fovKick = Math.max(this.fovKick, finisher ? 0.7 : 0.35)
    }

    private updateMelee(dt: number): void {
        if (this.meleeTimer <= 0) return
        this.meleeTimer -= dt
        const m = this.meleeDef
        const mid = m.swingTime * 0.55
        if (!this.meleeHitDone && this.meleeTimer <= mid) {
            this.meleeHitDone = true
            const finisher = this.meleeCombo === MELEE.comboLength - 1
            const kind = finisher ? m.finisher : 'slash'
            const rangeMult = kind === 'thrust' ? 1.6 : kind === 'slam' ? 1.15 : 1
            const range = m.range * rangeMult * this.stats.meleeRangeMult * this.stats.scale
            const arc = kind === 'spin' ? Math.PI * 2 : kind === 'thrust' ? Math.PI * 0.22 : m.arc
            const dmg = m.damage * this.stats.meleeDamageMult * this.stats.damageMult * (finisher ? m.finisherMult : 1)
            const f = this.forward(_v2)
            const center = this.playerCenter(_v1)
            let any = 0
            for (const e of this.enemies) {
                if (!e.alive || e.state === 'spawn') continue
                const dx = e.pos.x - center.x
                const dz = e.pos.z - center.z
                const dy = (e.pos.y + e.height * e.scale * 0.5) - center.y
                const d = Math.hypot(dx, dz)
                if (d > range + e.radius * e.scale || Math.abs(dy) > 2.6) continue
                const dot = (dx * f.x + dz * f.z) / Math.max(0.001, d)
                if (arc < Math.PI * 2 && dot < Math.cos(arc / 2) && d > 1) continue
                this.hitEnemy(e, dmg, _v3.set(dx, kind === 'slam' ? 0.5 : 0, dz).normalize(), m.knockback * (finisher ? 2 : 1), 'melee')
                any++
            }
            if (any > 0) {
                this.audio.play('slash-hit', Math.min(1.4, 0.7 + any * 0.15))
                this.shake = Math.max(this.shake, finisher ? 0.7 : 0.25)
                if (m.id === 'scythe') this.hp = Math.min(this.stats.maxHealth, this.hp + dmg * 0.05 * any)
            }
            if (kind === 'slam') {
                this.spawnShockwave(this.pos, range, m.color, 0.4)
                this.burst(this.pos.x + f.x * 2, this.pos.y + 0.2, this.pos.z + f.z * 2, 20, [m.color, 0x8a8f9c], 6, 0.16)
                this.dustRing(this.pos.x + f.x * 1.5, this.pos.y, this.pos.z + f.z * 1.5, range * 0.7)
                this.sparks(_v3.set(this.pos.x + f.x * 2, this.pos.y + 0.3, this.pos.z + f.z * 2), null, 20, m.color, 8)
                this.audio.play('slam', 0.6)
            } else if (kind === 'thrust') {
                const tip = center.clone().addScaledVector(f, range)
                this.spawnBeam(center.clone().addScaledVector(f, 1), tip, m.color, 0.12, 0.14)
                this.burst(tip.x, tip.y, tip.z, 10, [m.color, 0xffffff], 4, 0.1)
            } else {
                this.spawnSlash(center, f, range, finisher, arc, m.color)
            }
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
        this.burst(this.pos.x, this.pos.y + 0.2, this.pos.z, 30, [0xd9a63c, 0x3ff0ff, 0x8a8f9c], 7, 0.16)
        this.dustRing(this.pos.x, this.pos.y, this.pos.z, radius)
        this.sparks(_v3.set(this.pos.x, this.pos.y + 0.3, this.pos.z), null, 30, 0xd9a63c, 9)
        this.audio.play('slam', 0.8)
        this.shake = Math.max(this.shake, 0.9)
        this.meleeComboTimer = MELEE.comboWindow
        this.meleeCombo = 0
    }

    // ── Abilities ────────────────────────────────────────────────────────

    private abilityCost(id: AbilityId): number {
        if (id === 'nova') return this.stats.abilityCost
        if (id === 'sentry') return this.stats.turretCost
        return ABILITIES[id].energy
    }

    private castSlot(slot: number): void {
        const id = this.abilitySlots[slot]
        if (!id) return
        const cost = this.abilityCost(id)
        if (this.energy < cost) {
            this.audio.play('dry', 0.4)
            return
        }
        switch (id) {
            case 'nova': this.nova(); break
            case 'sentry': this.deployTurret(); break
            case 'blink': this.blink(); break
            case 'chrono': this.chronoField(); break
        }
        this.energy -= cost
    }

    /** Teleport forward through the pack, cutting everything on the way. */
    private blink(): void {
        const f = this.forward(new THREE.Vector3())
        const start = this.pos.clone()
        const end = start.clone()
        const probe = start.clone()
        for (let step = 0; step < 18; step++) {
            probe.addScaledVector(f, 0.5)
            const before = probe.clone()
            this.resolveWalls(probe, this.playerRadius, this.pos.y, 1.8)
            if (probe.distanceToSquared(before) > 0.01) break
            end.copy(probe)
        }
        const dmg = 45 * this.stats.meleeDamageMult * this.stats.damageMult * this.stats.abilityMult
        for (const e of this.enemies) {
            if (!e.alive || e.state === 'spawn') continue
            const c = _v1.set(e.pos.x, e.pos.y + e.height * e.scale * 0.5, e.pos.z)
            const t = segmentSphere(start.clone().setY(c.y), end.clone().setY(c.y), c, e.radius * e.scale + 1.4)
            if (t >= 0) this.hitEnemy(e, dmg, f, 6, 'melee')
        }
        this.spawnBeam(start.clone().setY(this.pos.y + 1.2), end.clone().setY(this.pos.y + 1.2), 0xb56bff, 0.6, 0.3)
        this.burst(start.x, start.y + 1, start.z, 18, [0xb56bff, 0xffffff], 5, 0.14)
        this.pos.copy(end)
        this.pos.y = this.groundHeight(end.x, end.z, this.playerRadius, this.pos.y + STEP_HEIGHT)
        this.burst(end.x, end.y + 1, end.z, 24, [0xb56bff, 0x3ff0ff], 6, 0.14)
        this.invuln = Math.max(this.invuln, 0.4)
        this.fovKick = 1.2
        this.audio.play('chrono', 0.8)
        this.audio.play('slash', 0.8)
        this.hitStop = Math.max(this.hitStop, 0.03)
    }

    /** Freeze every enemy for a few seconds. */
    private chronoField(): void {
        this.fieldTimer = 3
        this.spawnShockwave(this.pos, 30, 0x7dd3fc, 0.8)
        this.burst(this.pos.x, this.pos.y + 1, this.pos.z, 40, [0x7dd3fc, 0xffffff], 9, 0.16)
        this.flashLight.color.set(0x7dd3fc)
        this.flashLight.position.copy(this.playerCenter(_v1))
        this.flashLight.intensity = 30
        this.audio.play('chrono', 1.2)
        this.audio.play('nova', 0.4)
        this.fovKick = 0.8
    }

    private nova(): void {
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
            if (Math.random() < dt * 18) this.flameAt(cell.pos.x, cell.pos.y + 0.2, cell.pos.z, 1.2)
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
            const glow = new THREE.Mesh(BOX, voxMaterial(AFFIXES[affix].color, AFFIXES[affix].color, 0.6))
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
            throwTimer: 4,
            burnTick: 0,
            burnDps: 0,
            enraged: false,
            slowTimer: 0
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
                if (e.flashTimer <= 0) for (const m of e.model.meshes) m.material = m.userData.baseMaterial as THREE.Material
            }
            if (e.bladeCooldown > 0) e.bladeCooldown -= dt
            if (e.barTimer > 0) e.barTimer -= dt
            if (e.burnTimer > 0) {
                e.burnTimer -= edt
                e.burnTick -= edt
                if (e.burnTick <= 0) {
                    e.burnTick = BURN.tick
                    this.hitEnemy(e, e.burnDps * BURN.tick, UP, 0, 'aura')
                    if (!e.alive) continue
                }
                if (Math.random() < dt * 30) this.flameAt(e.pos.x, e.pos.y + Math.random() * e.height * e.scale, e.pos.z, 0.8 * e.scale)
                if (e.burnTimer <= 0) e.burnDps = 0
            }
            e.stateTimer -= edt
            if (e.attackTimer > 0) e.attackTimer -= edt
            if (e.slowTimer > 0) {
                e.slowTimer -= edt
                if (Math.random() < dt * 12) this.glow.emit({ x: e.pos.x + (Math.random() - 0.5) * e.scale, y: e.pos.y + Math.random() * e.height * e.scale, z: e.pos.z + (Math.random() - 0.5) * e.scale, vy: 0.6, life: 0.5 + Math.random() * 0.4, size: 0.12, sizeEnd: 0.03, color: 0xffffff, colorEnd: 0xbae6fd, alpha: 0.8, shape: 'star', rot: Math.random() * 3, spin: 2 })
            }

            const toPlayer = _v1.set(this.pos.x - e.pos.x, 0, this.pos.z - e.pos.z)
            const dist = toPlayer.length()
            const dir = toPlayer.clone().divideScalar(Math.max(0.001, dist))
            const move = _v2.set(0, 0, 0)
            let speed = e.speed * (e.slowTimer > 0 ? 0.55 : 1)
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
                        speed = (e.state === 'charge' ? e.speed * 2.4 : e.speed) * (e.slowTimer > 0 ? 0.55 : 1)
                        break
                    case 'charger':
                        speed = this.aiCharger(e, dist, dir, move, edt) * (e.slowTimer > 0 ? 0.55 : 1)
                        break
                    case 'boss':
                        this.aiBoss(e, dist, dir, move, edt)
                        break
                    case 'bomber':
                        this.aiBomber(e, dist, dir, move)
                        if (!e.alive) continue
                        break
                    case 'mender':
                        this.aiMender(e, dist, dir, move)
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

    private aiBomber(e: Enemy, dist: number, dir: THREE.Vector3, move: THREE.Vector3): void {
        const reach = e.def.attackRange * e.scale + this.playerRadius
        if (e.state === 'windup') {
            // fuse burning: flash faster and faster, then detonate
            const t = 1 - Math.max(0, e.stateTimer) / 0.55
            const on = Math.sin(this.elapsed * (30 + t * 60)) > 0
            for (const m of e.model.meshes) {
                const part = m.userData.part as VoxPart
                if (part.name === 'core') m.material = on ? FLASH_MATERIAL : m.userData.baseMaterial as THREE.Material
            }
            if (e.stateTimer <= 0) {
                const center = new THREE.Vector3(e.pos.x, e.pos.y + e.height * e.scale * 0.5, e.pos.z)
                this.removeEnemy(e)
                this.explode(center, 3.6, e.damage, 0xff7a2a, true)
            }
            return
        }
        move.copy(dir)
        if (dist < reach + 0.4) {
            e.state = 'windup'
            e.stateTimer = 0.55
            this.audio.play('charge', 0.5)
        }
    }

    private aiMender(e: Enemy, dist: number, dir: THREE.Vector3, move: THREE.Vector3): void {
        // hangs back and keeps the pack alive — kill it first
        if (dist > 14) move.copy(dir)
        else if (dist < 9) move.copy(dir).negate()
        else move.set(-dir.z, 0, dir.x).multiplyScalar(e.strafeSign * 0.6)
        if (e.attackTimer > 0) return
        e.attackTimer = e.def.attackCooldown
        const from = new THREE.Vector3(e.pos.x, e.pos.y + 1.6 * e.scale, e.pos.z)
        let healed = 0
        for (const o of this.enemies) {
            if (o === e || !o.alive || o.state === 'spawn' || o.hp >= o.maxHp) continue
            if (o.pos.distanceTo(e.pos) > 9) continue
            const amount = Math.round(o.maxHp * 0.12)
            o.hp = Math.min(o.maxHp, o.hp + amount)
            o.barTimer = 2
            const oc = new THREE.Vector3(o.pos.x, o.pos.y + o.height * o.scale * 0.5, o.pos.z)
            this.spawnLightning(from, oc, 0x7dff5a, 0.25)
            this.popup(oc, `+${amount}`, '#86efac', 13)
            healed++
            if (healed >= 6) break
        }
        if (healed > 0) {
            this.audio.play('pickup', 0.35)
            const armR = e.model.parts.get('armR')
            if (armR) armR.rotation.x = -1.6
        }
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
            for (let i = 0; i < 3; i++) {
                const at = e.pos.clone()
                at.x += (Math.random() - 0.5) * 4
                at.z += (Math.random() - 0.5) * 4
                const spawned = this.spawnEnemy('runner', null, at)
                spawned.pos.y = e.pos.y
            }
        }
        if (!e.enraged && e.hp < e.maxHp * 0.5) {
            e.enraged = true
            e.speed *= 1.35
            this.ui.banner('ENRAGED', 'The Titan is furious', 'boss')
            this.audio.play('boss', 0.8)
            this.spawnShockwave(e.pos, 6, 0xff3a3a, 0.5)
            this.burst(e.pos.x, e.pos.y + 2, e.pos.z, 40, [0xff3a3a, 0xff6a2a], 8, 0.2)
            this.shake = Math.max(this.shake, 0.8)
            for (const m of e.model.meshes) {
                const part = m.userData.part as VoxPart
                if (part.emissive) m.material = voxMaterial(0xff3a3a, 0xff3a3a, 3)
            }
        }
        e.throwTimer -= dt
        if (e.throwTimer <= 0 && e.state === 'chase' && dist > 7) {
            e.throwTimer = e.enraged ? 3.2 : 5.5
            const from = new THREE.Vector3(e.pos.x, e.pos.y + 2.2 * e.scale, e.pos.z)
            const target = this.pos.clone().addScaledVector(this.vel, 0.6)
            const flight = 1.3
            const v = target.sub(from).divideScalar(flight)
            v.y += 0.5 * 30 * flight
            const mesh = buildModel(boulderParts(), 1.6).group
            this.scene.add(mesh)
            this.enemyShots.push({ pos: from, vel: v, life: 4, damage: e.damage * 0.9, alive: true, gravity: 30, mesh, blast: 4 })
            this.audio.play('charge', 0.8)
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
        if (source !== 'aura') dmg *= this.damageBoost()
        dmg = Math.max(1, Math.round(dmg))
        e.hp -= dmg
        this.damageDealt += dmg
        e.barTimer = 2.5
        if (e.flashTimer <= 0) for (const m of e.model.meshes) m.material = e.scale >= 1.5 ? FLASH_MATERIAL_SOFT : FLASH_MATERIAL
        e.flashTimer = 0.06
        const kbScale = knockback / Math.max(0.6, e.scale * (e.def.behavior === 'boss' ? 6 : 1.4))
        e.knock.x += dir.x * kbScale * 2.2
        e.knock.z += dir.z * kbScale * 2.2
        if (source === 'melee' || source === 'nova') e.knock.y += kbScale * 0.8

        if (this.stats.lifesteal > 0 && source !== 'aura') this.hp = Math.min(this.stats.maxHealth, this.hp + dmg * this.stats.lifesteal)

        if (source !== 'aura') {
            const center = new THREE.Vector3(e.pos.x, e.pos.y + e.height * e.scale * 0.7, e.pos.z)
            this.popup(center, headshot ? `${dmg} HEADSHOT` : String(dmg), headshot ? '#fb923c' : crit ? '#fde047' : source === 'explosion' ? '#fb923c' : source === 'melee' ? '#7dd3fc' : '#f8fafc', headshot ? 22 : crit ? 24 : source === 'melee' ? 19 : 15)
            this.impactEnemy(center, dir, e.parts[0]?.color ?? 0xffffff, crit, headshot, source)
            this.hitMarker = headshot ? 0.2 : 0.14
            this.hud.hitKind = headshot ? 'head' : crit ? 'crit' : 'hit'
            if (this.hitSoundTimer <= 0) {
                this.audio.play(crit ? 'crit' : 'hit', headshot ? 0.9 : 0.6)
                this.hitSoundTimer = 0.04
            }
        }

        if (source === 'bullet' && this.stats.incendiary > 0) this.applyBurn(e, 2 * this.stats.incendiary, BURN.dps * this.stats.damageMult)

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

        if (e.alive && e.hp > 0 && this.stats.execute > 0 && source !== 'aura' && source !== 'thorns') {
            // Death Mark: finish anything already on its last legs
            const threshold = (e.def.behavior === 'boss' ? 0.08 : 0.15) * this.stats.execute
            if (e.hp / e.maxHp < threshold) {
                e.hp = 0
                const c = new THREE.Vector3(e.pos.x, e.pos.y + e.height * e.scale * 0.9, e.pos.z)
                this.popup(c, 'EXECUTED', '#f87171', 20)
                this.spawnSlash(c, dir, 2.2 * e.scale, true, Math.PI * 0.9, 0xf87171)
                this.audio.play('execute', 0.8)
                this.hitStop = Math.max(this.hitStop, 0.04)
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

        // the body blasts into its own voxels
        this.shatter(e, dir)
        this.deathBurst(center, e.parts[0]?.color ?? 0xffffff, e.scale, boss)
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
        if (e.def.behavior === 'bomber') {
            this.explode(center, 3, e.damage * 0.7, 0xff7a2a, true, e.id)
        }
        if (this.stats.shrapnel > 0) {
            // the corpse throws out a ring of lethal shards
            const count = 6 * this.stats.shrapnel
            for (let i = 0; i < count; i++) {
                const a = (i / count) * Math.PI * 2 + Math.random() * 0.4
                const v = new THREE.Vector3(Math.cos(a), 0.15, Math.sin(a)).multiplyScalar(30)
                this.projectiles.push({ pos: center.clone(), vel: v, life: 0.7, damage: 14 * this.stats.damageMult, def: WEAPONS.shotgun, color: new THREE.Color(e.parts[0]?.color ?? 0xffffff), size: 0.3, pierceLeft: 1, ricochetLeft: 0, hit: new Set([e.id]), homing: 0, explosionRadius: 0, spin: Math.random() * 6, alive: true })
            }
        }
        if (this.meleeTimer > 0 || this.slamming) this.hitStop = Math.max(this.hitStop, 0.045)
        if (this.stats.bloodlust > 0) this.hp = Math.min(this.stats.maxHealth, this.hp + this.stats.bloodlust)
        if (this.stats.bulletStorm > 0) {
            this.stormKills++
            if (this.stormKills >= 5) {
                this.stormKills = 0
                this.bulletStorm()
            }
        }
        if (this.stats.rift > 0 && !boss && randomChance(0.12 * this.stats.rift)) this.openRift(center)

        // drops
        if (e.affix === 'gilded') {
            this.spawnPickup('ammo', e.pos)
            this.spawnPickup('overdrive', e.pos.clone().add(new THREE.Vector3(2, 0, 0)))
            this.spawnPickup(randomPick(['shield', 'haste'] as PickupKind[]), e.pos.clone().add(new THREE.Vector3(-2, 0, 0)))
            this.spawnPickup('health', e.pos.clone().add(new THREE.Vector3(0, 0, 2)))
            this.ui.banner('BOUNTY CLAIMED', 'Spoils delivered', 'clear')
        } else if (boss) {
            this.spawnPickup('ammo', e.pos)
            this.spawnPickup('overdrive', e.pos.clone().add(new THREE.Vector3(2, 0, 0)))
            this.spawnPickup('health', e.pos.clone().add(new THREE.Vector3(-2, 0, 0)))
        } else if (randomChance(ammoDropChance(e.def, this.stats.ammoLuck))) {
            this.spawnPickup('ammo', e.pos)
        } else if (randomChance(dropChance(e.def, this.stats.luck))) {
            const kinds: PickupKind[] = ['health', 'health', 'energy', 'energy', 'overdrive', 'shield', 'haste']
            this.spawnPickup(randomPick(kinds), e.pos)
        }
        this.removeEnemy(e)
        if (boss) this.ui.banner('TITAN DOWN', 'The arena is yours', 'clear')
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
                this.damagePlayer(damage * (1 - d / (radius + 1)), null, center)
                const kb = this.pos.clone().sub(center).setY(0).normalize().multiplyScalar(10)
                this.vel.add(kb)
                this.vel.y = Math.max(this.vel.y, 6)
            }
        }
        this.spawnExplosion(center, radius, color)
        this.burst(center.x, center.y, center.z, Math.round(6 + radius * 4), [color, 0x3a3f4b, 0x1a1a20], 4 + radius, 0.16)
        this.flashLight.color.set(color)
        this.flashLight.position.copy(center)
        this.flashLight.intensity = Math.max(this.flashLight.intensity, 10 + radius * 6)
        this.audio.play('explosion', Math.min(1, 0.35 + radius * 0.12))
        this.shake = Math.max(this.shake, Math.min(1, radius * 0.12))
    }

    /** Records where a hit came from so the HUD can point at it. */
    private markHit(from: THREE.Vector3 | null): void {
        if (!from) return
        const dx = from.x - this.pos.x
        const dz = from.z - this.pos.z
        if (dx * dx + dz * dz < 0.01) return
        // yaw 0 looks down -Z; angle is clockwise from straight ahead
        const world = Math.atan2(dx, -dz)
        let angle = world + this.yaw
        while (angle > Math.PI) angle -= Math.PI * 2
        while (angle < -Math.PI) angle += Math.PI * 2
        this.hitIndicators.push({ id: this.nextHitId++, angle, life: 1 })
        if (this.hitIndicators.length > 6) this.hitIndicators.shift()
    }

    private damagePlayer(amount: number, attacker: Enemy | null, from: THREE.Vector3 | null = attacker?.pos ?? null): void {
        if (this.invuln > 0 || this.hud.phase !== 'playing') return
        this.markHit(from)
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
        let remaining = dmg
        if (this.shield > 0) {
            const absorbed = Math.min(this.shield, remaining)
            this.shield -= absorbed
            remaining -= absorbed
            this.burst(this.pos.x, this.pos.y + 1.2, this.pos.z, 10, [0x8ad8ff, 0xffffff], 4, 0.1)
            this.audio.play('hit', 0.5)
            this.invuln = 0.12
            if (this.shield <= 0) this.spawnShockwave(this.pos, 3, 0x8ad8ff, 0.3)
            if (remaining <= 0) return
        }
        this.hp -= remaining
        this.invuln = 0.12
        this.regenDelay = 3
        this.hurtFlash = 1
        this.shake = Math.max(this.shake, 0.4 + Math.min(0.6, remaining / this.stats.maxHealth * 2))
        this.fovKick = Math.max(this.fovKick, 0.5)
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
                if (p.def.burn > 0) this.applyBurn(closest, p.def.burn, BURN.dps * this.stats.damageMult)
                if (this.stats.frost > 0 && closest.alive) {
                    closest.slowTimer = Math.max(closest.slowTimer, 1.5 * this.stats.frost)
                    if (Math.random() < 0.3) this.audio.play('freeze', 0.25)
                }
                if (headshot && this.stats.headhunter > 0) {
                    // Headhunter: the round comes back
                    const w = this.weapons.find(x => x.def === p.def)
                    if (w && !w.reloading && w.ammo < this.magazineOf(w)) w.ammo++
                }
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
                    this.impactWall(p.pos, p.vel, p.def.color, p.def.kind !== 'bullet')
                }
                p.alive = false
                continue
            }

            // draw
            if (p.def.kind === 'flame') {
                // fire: every frame the tongue sheds a rolling flame sprite that blooms and darkens, with wisps of smoke near the end
                const t = 1 - p.life / 0.42
                this.glow.emit({ x: p.pos.x + (Math.random() - 0.5) * 0.3, y: p.pos.y + (Math.random() - 0.5) * 0.3, z: p.pos.z + (Math.random() - 0.5) * 0.3, vx: p.vel.x * 0.12, vy: 1.6 + p.vel.y * 0.12, vz: p.vel.z * 0.12, life: 0.2 + t * 0.2, size: 0.3 + t * 0.9, sizeEnd: 1 + t * 1.3, color: t < 0.4 ? 0xfff0a0 : 0xffb04a, colorEnd: 0xff3a10, alpha: 0.5 * (1 - t * 0.6), shape: 'soft', drag: 2, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 4 })
                if (t > 0.5 && Math.random() < 0.3) this.smoke.emit({ x: p.pos.x, y: p.pos.y + 0.3, z: p.pos.z, vx: p.vel.x * 0.08, vy: 2, vz: p.vel.z * 0.08, life: 0.7 + Math.random() * 0.5, size: 0.5, sizeEnd: 1.8, color: 0x2a2226, colorEnd: 0x101010, alpha: 0.22, shape: 'soft', rot: Math.random() * 6, spin: 1, fadeIn: 0.2 })
                continue
            }
            if (slot + 1 < this.tracers.size) {
                _c1.copy(p.color).multiplyScalar(1.3)
                if (p.def.kind === 'plasma') {
                    q.setFromAxisAngle(UP, p.spin)
                    this.tracers.set(slot, p.pos, q, p.size, p.size, p.size, _c1)
                    // a halo and a trail of embers
                    this.glow.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, life: 0.07, size: p.size * 4, sizeEnd: p.size * 5, color: p.color, alpha: 0.6, shape: 'soft' })
                    this.glow.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2 + 1, vz: (Math.random() - 0.5) * 2, life: 0.3 + Math.random() * 0.3, size: p.size * 1.2, sizeEnd: p.size * 0.2, color: 0xffffff, colorEnd: p.color, alpha: 0.7, shape: 'soft', drag: 2 })
                } else if (p.def.kind === 'disc') {
                    q.setFromAxisAngle(UP, p.spin * 1.5)
                    this.tracers.set(slot, p.pos, q, p.size, 0.08, p.size, _c1)
                    this.glow.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, life: 0.1, size: p.size * 2.4, sizeEnd: p.size * 2.8, color: p.color, alpha: 0.4, shape: 'ring', rot: p.spin })
                    if (Math.random() < 0.5) this.glow.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: (Math.random() - 0.5) * 3, vy: -1, vz: (Math.random() - 0.5) * 3, life: 0.25, size: 0.06, color: 0xffffff, colorEnd: p.color, gravity: 10, shape: 'spark', stretch: 0.05 })
                } else {
                    const dir = _v2.copy(p.vel).normalize()
                    q.setFromUnitVectors(Z_AXIS, dir)
                    const thin = p.def.kind === 'bullet' ? 0.5 : 1
                    const len = p.def.tracerLength * (1 + this.stats.bulletSize * 0.3)
                    // a hot core inside a wider, dimmer halo so rounds read as streaks of light
                    this.tracers.set(slot, p.pos, q, p.size * thin, p.size * thin, len, _c1.copy(p.color).lerp(WHITE, 0.55).multiplyScalar(1.5))
                    slot++
                    this.tracers.set(slot, p.pos, q, p.size * thin * 2.8, p.size * thin * 2.8, len * 0.85, _c1.copy(p.color).multiplyScalar(0.3))
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
                else this.damagePlayer(shot.damage, null, prev)
                shot.alive = false
            } else if (shot.pos.y <= 0 || Math.abs(shot.pos.x) > ARENA_HALF || Math.abs(shot.pos.z) > ARENA_HALF || this.colliders.some(b => b.containsPoint(shot.pos))) {
                if (shot.blast > 0) this.explode(shot.pos.clone().setY(Math.max(0.3, shot.pos.y)), shot.blast, shot.damage, 0xff6a2a, true)
                else this.burst(shot.pos.x, Math.max(0.1, shot.pos.y), shot.pos.z, 6, [0xff4dd8, 0xffffff], 3, 0.1)
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
            if (shot.alive && s + 2 < this.shotPool.size) {
                // a bright magenta orb with two fading trail cubes so incoming fire reads at a glance
                q.setFromAxisAngle(UP, this.elapsed * 6)
                _c1.set(0xff4dd8).multiplyScalar(1.3)
                this.shotPool.set(s, shot.pos, q, 0.5, 0.5, 0.5, _c1)
                const back = _v2.copy(shot.vel).normalize()
                _c1.set(0xff9ae8).multiplyScalar(1.2)
                this.shotPool.set(s + 1, _v1.copy(shot.pos).addScaledVector(back, -0.5), q, 0.32, 0.32, 0.32, _c1)
                _c1.set(0xffc4f0).multiplyScalar(0.8)
                this.shotPool.set(s + 2, _v1.copy(shot.pos).addScaledVector(back, -0.95), q, 0.18, 0.18, 0.18, _c1)
                s += 3
                this.glow.emit({ x: shot.pos.x, y: shot.pos.y, z: shot.pos.z, life: 0.06, size: 1.6, sizeEnd: 1.2, color: 0xff4dd8, alpha: 0.45, shape: 'soft' })
                if (Math.random() < 0.5) this.glow.emit({ x: shot.pos.x, y: shot.pos.y, z: shot.pos.z, vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5, vz: (Math.random() - 0.5) * 1.5, life: 0.3, size: 0.2, sizeEnd: 0.04, color: 0xffc4f0, colorEnd: 0xff4dd8, alpha: 0.8, shape: 'soft' })
            }
        }
        for (let i = s; i < this.shotPool.size; i++) this.shotPool.hide(i)
        this.shotPool.commit()
        for (let i = this.enemyShots.length - 1; i >= 0; i--) if (!this.enemyShots[i]!.alive) this.enemyShots.splice(i, 1)
    }

    // ── Boon systems: rifts, storms, bullet rings ───────────────────────

    /** Void Rift: a black sphere that reels enemies in for two seconds, then bursts. */
    private openRift(at: THREE.Vector3): void {
        const group = new THREE.Group()
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), new THREE.MeshBasicMaterial({ color: 0x05020a, toneMapped: false }))
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.08, 6, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb56bff).multiplyScalar(2), toneMapped: false }))
        ring.rotation.x = Math.PI / 2
        group.add(core)
        group.add(ring)
        group.position.copy(at).setY(Math.max(1.2, at.y))
        this.scene.add(group)
        this.rifts.push({ pos: group.position.clone(), life: 2, group, core, ring, power: this.stats.rift })
        this.audio.play('rift', 0.9)
        this.spawnShockwave(group.position, 4, 0xb56bff, 0.4)
    }

    private updateRifts(dt: number): void {
        for (let i = this.rifts.length - 1; i >= 0; i--) {
            const r = this.rifts[i]!
            r.life -= dt
            const radius = 8 + r.power * 2
            const t = 1 - Math.max(0, r.life) / 2
            r.core.scale.setScalar(1 + t * 1.2 + Math.sin(this.elapsed * 30) * 0.08)
            r.ring.rotation.z += dt * 6
            r.ring.rotation.x = Math.PI / 2 + Math.sin(this.elapsed * 3) * 0.4
            r.ring.scale.setScalar(1 + t * 0.8)
            for (const e of this.enemies) {
                if (!e.alive || e.state === 'spawn' || e.def.behavior === 'boss') continue
                const dx = r.pos.x - e.pos.x
                const dz = r.pos.z - e.pos.z
                const d = Math.hypot(dx, dz)
                if (d > radius || d < 0.2) continue
                const pull = (1 - d / radius) * 22 + 6
                e.knock.x += dx / d * pull * dt * 4
                e.knock.z += dz / d * pull * dt * 4
            }
            for (const shot of this.enemyShots) if (shot.pos.distanceTo(r.pos) < radius * 0.6) shot.alive = false
            if (dt > 0) {
                for (let k = 0; k < 3; k++) {
                    const a = Math.random() * Math.PI * 2
                    const rr = 2 + Math.random() * 4
                    this.glow.emit({ x: r.pos.x + Math.cos(a) * rr, y: r.pos.y + (Math.random() - 0.5) * 3, z: r.pos.z + Math.sin(a) * rr, vx: -Math.cos(a) * rr * 2.5, vy: 0, vz: -Math.sin(a) * rr * 2.5, life: 0.4, size: 0.2, sizeEnd: 0.05, color: 0xffffff, colorEnd: Math.random() < 0.5 ? 0xb56bff : 0x3ff0ff, alpha: 0.9, shape: 'spark', stretch: 0.06 })
                }
                this.glow.emit({ x: r.pos.x, y: r.pos.y, z: r.pos.z, life: 0.1, size: 2.5 + t * 2, sizeEnd: 2, color: 0xb56bff, alpha: 0.5, shape: 'soft' })
            }
            if (Math.random() < dt * 30) {
                const a = Math.random() * Math.PI * 2
                const rr = radius * (0.4 + Math.random() * 0.6)
                this.spawnDebris(r.pos.x + Math.cos(a) * rr, r.pos.y + (Math.random() - 0.5) * 2, r.pos.z + Math.sin(a) * rr, -Math.cos(a) * rr * 2, 0, -Math.sin(a) * rr * 2, Math.random() < 0.5 ? 0xb56bff : 0x3ff0ff, 0.1, 0.5)
            }
            if (r.life <= 0) {
                this.scene.remove(r.group)
                r.core.geometry.dispose()
                r.ring.geometry.dispose()
                this.rifts.splice(i, 1)
                this.explode(r.pos, 5 + r.power, 70 * r.power * this.stats.damageMult * (1 + this.wave * 0.08), 0xb56bff, false)
                this.spawnShockwave(r.pos, 7 + r.power * 2, 0xb56bff, 0.5)
                this.shake = Math.max(this.shake, 0.9)
            }
        }
    }

    /** Lightning Storm: bolts from the sky on random enemies. */
    private updateStorm(dt: number): void {
        if (this.stats.storm <= 0 || this.enemies.length === 0) return
        this.stormTimer -= dt
        if (this.stormTimer > 0) return
        this.stormTimer = 5 / this.stats.storm
        const targets = this.enemies.filter(e => e.alive && e.state !== 'spawn')
        if (targets.length === 0) return
        const count = Math.min(5, targets.length)
        const dmg = 60 * this.stats.storm * this.stats.damageMult * (1 + this.wave * 0.06)
        for (let i = 0; i < count; i++) {
            const e = targets.splice(Math.floor(randomFloat() * targets.length), 1)[0]!
            const top = new THREE.Vector3(e.pos.x + (Math.random() - 0.5) * 3, e.pos.y + 22, e.pos.z + (Math.random() - 0.5) * 3)
            const at = new THREE.Vector3(e.pos.x, e.pos.y + e.height * e.scale * 0.5, e.pos.z)
            this.spawnLightning(top, at, 0xbae6fd, 0.22)
            this.spawnLightning(top, at, 0xffffff, 0.1)
            this.hitEnemy(e, dmg, UP, 4, 'explosion')
            this.burst(at.x, at.y, at.z, 14, [0xbae6fd, 0xffffff], 6, 0.12)
            e.state = 'stunned'
            e.stateTimer = Math.max(e.stateTimer, 0.5)
        }
        this.flashLight.color.set(0xbae6fd)
        this.flashLight.position.copy(this.playerCenter(_v1)).setY(8)
        this.flashLight.intensity = 40
        this.audio.play('storm', 1)
        this.shake = Math.max(this.shake, 0.5)
    }

    /** Bullet Storm: a ring of rounds bursts out of you. */
    private bulletStorm(): void {
        const w = this.weapon
        const count = 16 * this.stats.bulletStorm
        const center = this.playerCenter(new THREE.Vector3())
        const dmg = 20 * this.stats.damageMult * (1 + this.wave * 0.05)
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2
            const v = new THREE.Vector3(Math.cos(a), 0.05, Math.sin(a)).multiplyScalar(60)
            this.projectiles.push({ pos: center.clone(), vel: v, life: 1.2, damage: dmg, def: w?.def ?? WEAPONS.pistol, color: new THREE.Color(0xfde68a), size: 0.14, pierceLeft: 1 + this.stats.pierce, ricochetLeft: this.stats.ricochet, hit: new Set(), homing: this.stats.homing * 3, explosionRadius: 0, spin: 0, alive: true })
        }
        this.spawnShockwave(this.pos, 3, 0xfde68a, 0.3)
        this.audio.play('shoot-shotgun', 0.8)
        this.audio.play('nova', 0.3)
        this.shake = Math.max(this.shake, 0.4)
    }

    // ── Minimap ──────────────────────────────────────────────────────────

    /** Hands the engine a canvas to draw the minimap into each frame. */
    attachMinimap(canvas: HTMLCanvasElement | null): void {
        this.minimap = canvas
        this.minimapStatic = null
    }

    /** Walls and pillars never move, so they are drawn once into an offscreen canvas. */
    private buildMinimapStatic(size: number): HTMLCanvasElement {
        const c = document.createElement('canvas')
        c.width = size
        c.height = size
        const ctx = c.getContext('2d')!
        const scale = size / (ARENA_HALF * 2)
        ctx.fillStyle = 'rgba(10, 14, 26, 0.9)'
        ctx.fillRect(0, 0, size, size)
        ctx.fillStyle = 'rgba(160, 175, 200, 0.55)'
        for (const b of this.colliders) {
            if (b.max.y < 0.5) continue
            const x = (b.min.x + ARENA_HALF) * scale
            const y = (b.min.z + ARENA_HALF) * scale
            ctx.fillRect(x, y, Math.max(1, (b.max.x - b.min.x) * scale), Math.max(1, (b.max.z - b.min.z) * scale))
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'
        ctx.lineWidth = 2
        ctx.strokeRect(1, 1, size - 2, size - 2)
        ctx.fillStyle = 'rgba(181, 107, 255, 0.9)'
        for (const p of this.portals) {
            ctx.beginPath()
            ctx.arc((p.x + ARENA_HALF) * scale, (p.z + ARENA_HALF) * scale, 3, 0, Math.PI * 2)
            ctx.fill()
        }
        return c
    }

    private drawMinimap(): void {
        const canvas = this.minimap
        if (!canvas || this.hud.phase === 'menu') return
        const size = canvas.width
        if (size === 0) return
        if (!this.minimapStatic || this.minimapStatic.width !== size * 2) this.minimapStatic = this.buildMinimapStatic(size * 2)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const view = 30
        const scale = size / (view * 2)
        ctx.clearRect(0, 0, size, size)
        ctx.save()
        ctx.beginPath()
        ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2)
        ctx.clip()
        ctx.fillStyle = 'rgba(6, 8, 16, 0.85)'
        ctx.fillRect(0, 0, size, size)
        // rotate the world so the player always faces up
        ctx.translate(size / 2, size / 2)
        ctx.rotate(this.yaw)
        ctx.scale(scale, scale)
        ctx.translate(-this.pos.x, -this.pos.z)
        ctx.drawImage(this.minimapStatic, -ARENA_HALF, -ARENA_HALF, ARENA_HALF * 2, ARENA_HALF * 2)
        const dot = (x: number, z: number, r: number, color: string): void => {
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(x, z, r, 0, Math.PI * 2)
            ctx.fill()
        }
        for (const p of this.pickups) dot(p.pos.x, p.pos.z, 0.8, p.kind === 'ammo' ? '#ffc14d' : p.kind === 'health' ? '#3dff7a' : '#8ad8ff')
        for (const r of this.rifts) dot(r.pos.x, r.pos.z, 1.6, 'rgba(181,107,255,0.8)')
        for (const t of this.turrets) dot(t.pos.x, t.pos.z, 0.9, '#d9a63c')
        for (const e of this.enemies) {
            if (!e.alive) continue
            const boss = e.def.behavior === 'boss'
            const color = boss ? '#fb923c' : e.affix ? hexToCss(AFFIXES[e.affix].color) : e.def.behavior === 'ranged' || e.def.behavior === 'mender' ? '#ff4dd8' : e.def.behavior === 'bomber' ? '#ff7a2a' : '#f43f5e'
            dot(e.pos.x, e.pos.z, boss ? 2.2 : 0.7 + e.scale * 0.35, color)
        }
        ctx.restore()
        // the player arrow sits at the centre pointing up
        ctx.save()
        ctx.translate(size / 2, size / 2)
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.moveTo(0, -6)
        ctx.lineTo(4.5, 5)
        ctx.lineTo(0, 2.5)
        ctx.lineTo(-4.5, 5)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2)
        ctx.stroke()
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
                this.popup(p.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), `+${Math.round(this.stats.maxHealth * 0.3)} HP`, '#3dff7a', 16)
                this.audio.play('pickup')
                break
            case 'energy':
                this.energy = Math.min(this.stats.energyMax, this.energy + 40)
                this.popup(p.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), '+40 ENERGY', '#4da6ff', 16)
                this.audio.play('pickup')
                break
            case 'overdrive':
                this.overdriveTimer = 10
                this.ui.toast('Overdrive', '#ff3a3a')
                this.audio.play('pickup-weapon')
                break
            case 'shield':
                this.shield = Math.min(150, this.shield + 60)
                this.popup(p.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), '+60 SHIELD', '#8ad8ff', 16)
                this.audio.play('pickup')
                break
            case 'haste':
                this.hasteTimer = 10
                this.ui.toast('Haste', '#ffe14d')
                this.audio.play('pickup-weapon', 0.7)
                break
            case 'ammo': {
                // a crate tops every gun up by a good chunk of its reserve
                let filled = 0
                for (const w of this.weapons) {
                    const max = this.reserveMaxOf(w)
                    const add = Math.min(max - w.reserve, Math.max(1, Math.round(max * 0.35)))
                    if (add > 0) {
                        w.reserve += add
                        filled++
                    }
                }
                this.popup(p.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), filled > 0 ? '+AMMO' : 'AMMO FULL', '#ffc14d', 16)
                this.audio.play('ammo')
                break
            }
        }
        const tint = { health: 0x3dff7a, energy: 0x4da6ff, overdrive: 0xff3a3a, shield: 0x8ad8ff, haste: 0xffe14d, ammo: 0xffc14d }[p.kind]
        this.glow.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, life: 0.3, size: 0.5, sizeEnd: 3, color: tint, alpha: 0.7, shape: 'ring' })
        this.glow.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, life: 0.15, size: 1.5, sizeEnd: 0.4, color: 0xffffff, colorEnd: tint, shape: 'star', rot: Math.random() * 3 })
        for (let i = 0; i < 18; i++) {
            this.glow.emit({ x: p.pos.x + (Math.random() - 0.5) * 0.6, y: p.pos.y, z: p.pos.z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 1.5, vy: 2.5 + Math.random() * 4, vz: (Math.random() - 0.5) * 1.5, life: 0.6 + Math.random() * 0.6, size: 0.1 + Math.random() * 0.12, sizeEnd: 0.02, color: 0xffffff, colorEnd: tint, alpha: 0.9, shape: 'soft', drag: 1.5 })
        }
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

    /** Layered muzzle flash: a star flare, a hot core, a tongue of fire, a cone of sparks and (for gunpowder) smoke. */
    private spawnMuzzleFlash(at: THREE.Vector3, dir: THREE.Vector3, color: THREE.Color, size: number, kind: WeaponDef['kind'] | 'gun', ads: number): void {
        const gun = kind === 'gun'
        const bright = gun ? 0xfff4d6 : 0xffffff
        const tx = at.x + dir.x * 0.25
        const ty = at.y + dir.y * 0.25
        const tz = at.z + dir.z * 0.25
        this.glow.emit({ x: tx, y: ty, z: tz, life: 0.06, size: size * 3.2, sizeEnd: size * 1.4, color: bright, colorEnd: color, alpha: 1, shape: 'star', rot: Math.random() * Math.PI })
        this.glow.emit({ x: tx, y: ty, z: tz, life: 0.09, size: size * 2.2, sizeEnd: size * 3.4, color, alpha: 0.75, shape: 'soft' })
        const mx = at.x + dir.x * (0.5 + size)
        const my = at.y + dir.y * (0.5 + size)
        const mz = at.z + dir.z * (0.5 + size)
        this.glow.emit({ x: mx, y: my, z: mz, vx: dir.x * 7, vy: dir.y * 7, vz: dir.z * 7, life: 0.07, size: size * 1.8, sizeEnd: size * 0.5, color: bright, colorEnd: color, alpha: 0.9, shape: 'soft', stretch: 0.2, drag: 8 })
        const n = gun ? 4 + Math.round(size * 20) : 8
        for (let i = 0; i < n; i++) {
            const d = coneDir(_f1, dir, gun ? 0.3 : 0.6)
            const s = 8 + Math.random() * 14
            this.glow.emit({ x: tx, y: ty, z: tz, vx: d.x * s, vy: d.y * s, vz: d.z * s, life: 0.1 + Math.random() * 0.18, size: 0.04 + Math.random() * 0.04, color: gun ? 0xfff0b0 : 0xffffff, colorEnd: gun ? 0xff7a2a : color, gravity: 14, drag: 3, shape: 'spark', stretch: 0.06 })
        }
        if (gun) {
            for (let i = 0; i < 3; i++) {
                const d = coneDir(_f1, dir, 0.5)
                const s = 1.5 + Math.random() * 2
                this.smoke.emit({ x: tx + d.x * 0.2, y: ty + d.y * 0.2, z: tz + d.z * 0.2, vx: d.x * s, vy: d.y * s + 0.8, vz: d.z * s, life: 0.5 + Math.random() * 0.4, size: size * 1.2, sizeEnd: size * 5, color: 0x5a5a60, colorEnd: 0x2a2a30, alpha: 0.26 * (1 - ads * 0.5), drag: 3, shape: 'soft', rot: Math.random() * 6, spin: (Math.random() - 0.5) * 3, fadeIn: 0.15 })
            }
        } else if (kind !== 'flame') {
            // energy weapons throw a small ring instead of smoke
            this.glow.emit({ x: tx, y: ty, z: tz, life: 0.14, size: size * 1.2, sizeEnd: size * 4, color, alpha: 0.5, shape: 'ring' })
        }
    }

    /** Hot sparks flying out of a cone around `dir`, or everywhere when `dir` is null. They bounce on the floor. */
    private sparks(at: THREE.Vector3, dir: THREE.Vector3 | null, count: number, color: number, speed: number, cone = 1.1): void {
        for (let i = 0; i < count; i++) {
            let d: THREE.Vector3
            if (dir) {
                d = coneDir(_f1, dir, cone)
            } else {
                const a = Math.random() * Math.PI * 2
                const e = Math.random() * Math.PI - Math.PI / 2
                d = _f1.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e))
            }
            const s = speed * (0.4 + Math.random() * 0.9)
            this.glow.emit({ x: at.x, y: at.y, z: at.z, vx: d.x * s, vy: d.y * s + 1, vz: d.z * s, life: 0.25 + Math.random() * 0.4, size: 0.05 + Math.random() * 0.05, sizeEnd: 0.02, color: 0xfff4c0, colorEnd: color, gravity: 16, drag: 1.5, shape: 'spark', stretch: 0.07, bounce: 0.4 })
        }
    }

    /** A bullet meets concrete: a flash, ricochet sparks and a dust puff. Energy rounds add a ring. */
    private impactWall(at: THREE.Vector3, vel: THREE.Vector3, color: number, energy: boolean): void {
        const x = at.x
        const y = Math.max(0.1, at.y)
        const z = at.z
        const back = _f2.copy(vel).normalize().negate()
        this.glow.emit({ x, y, z, life: 0.07, size: 0.5, sizeEnd: 0.9, color: 0xffffff, colorEnd: color, alpha: 0.9, shape: 'star', rot: Math.random() * 3 })
        this.sparks(_v3.set(x, y, z), back, 5 + Math.floor(Math.random() * 4), color, 8)
        this.smoke.emit({ x: x + back.x * 0.2, y: y + back.y * 0.2, z: z + back.z * 0.2, vx: back.x * 1.2, vy: 0.8, vz: back.z * 1.2, life: 0.5, size: 0.3, sizeEnd: 1.1, color: 0x7a7a80, colorEnd: 0x3a3a40, alpha: 0.3, shape: 'soft', rot: Math.random() * 6, spin: 1 })
        if (energy) this.glow.emit({ x, y, z, life: 0.14, size: 0.3, sizeEnd: 1.6, color, alpha: 0.6, shape: 'ring' })
        this.burst(x, y, z, 2, [0x8a8f9c], 3, 0.06)
    }

    /** A hit lands on a body: a flash, glowing chips in the enemy's colour and sparks back along the shot. */
    private impactEnemy(at: THREE.Vector3, dir: THREE.Vector3, color: number, crit: boolean, headshot: boolean, source: string): void {
        const big = crit || headshot
        this.glow.emit({ x: at.x, y: at.y, z: at.z, life: 0.07, size: big ? 1.1 : 0.6, sizeEnd: big ? 0.5 : 0.3, color: headshot ? 0xffb060 : crit ? 0xfff07a : 0xffffff, colorEnd: color, alpha: big ? 1 : 0.8, shape: big ? 'star' : 'soft', rot: Math.random() * 3 })
        const back = _f2.copy(dir).negate()
        this.sparks(at, back, big ? 12 : 6, color, 6, 1.2)
        const n = big ? 8 : 4
        for (let i = 0; i < n; i++) {
            this.glow.emit({ x: at.x, y: at.y, z: at.z, vx: (Math.random() - 0.5) * 4, vy: 1 + Math.random() * 3, vz: (Math.random() - 0.5) * 4, life: 0.3 + Math.random() * 0.3, size: 0.12 + Math.random() * 0.1, sizeEnd: 0.03, color: 0xffffff, colorEnd: color, gravity: 8, drag: 2, shape: 'soft' })
        }
        this.burst(at.x, at.y, at.z, big ? 6 : 3, [color], 3.5, 0.08)
        if (source === 'melee') this.glow.emit({ x: at.x, y: at.y, z: at.z, life: 0.12, size: 0.4, sizeEnd: 1.8, color: 0x7dd3fc, alpha: 0.7, shape: 'ring' })
    }

    /** The body's light escapes: a flash, a ring and a fountain of motes in the enemy's colour. */
    private deathBurst(center: THREE.Vector3, color: number, scale: number, boss: boolean): void {
        const { x, y, z } = center
        const s = boss ? 3 : scale
        this.glow.emit({ x, y, z, life: 0.12, size: s * 0.8, sizeEnd: s * 2, color: 0xffffff, colorEnd: color, alpha: 0.7, shape: 'soft' })
        this.glow.emit({ x, y, z, life: 0.25, size: s * 0.8, sizeEnd: s * 4, color, alpha: 0.6, shape: 'ring' })
        const n = boss ? 80 : Math.round(10 + s * 10)
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2
            const e = Math.random() * Math.PI * 0.5
            const sp = (2 + Math.random() * 4) * s
            this.glow.emit({ x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 2, vz: Math.sin(a) * Math.cos(e) * sp, life: 0.5 + Math.random() * 0.7, size: 0.08 + Math.random() * 0.1 * s, sizeEnd: 0.02, color: 0xffffff, colorEnd: color, gravity: 6, drag: 1.5, shape: 'soft' })
        }
        if (boss || scale > 1.5) {
            for (let i = 0; i < 6; i++) {
                this.smoke.emit({ x: x + (Math.random() - 0.5) * s, y: y + (Math.random() - 0.5) * s, z: z + (Math.random() - 0.5) * s, vy: 1 + Math.random() * 1.5, life: 1.2 + Math.random(), size: s * 0.6, sizeEnd: s * 1.8, color: 0x3a3038, colorEnd: 0x101010, alpha: 0.4, shape: 'soft', rot: Math.random() * 6, spin: (Math.random() - 0.5) * 2, fadeIn: 0.15 })
            }
        }
    }

    /** A licking flame with the odd wisp of smoke, for burning bodies and fire on the floor. */
    private flameAt(x: number, y: number, z: number, size: number): void {
        this.glow.emit({ x: x + (Math.random() - 0.5) * size, y, z: z + (Math.random() - 0.5) * size, vx: (Math.random() - 0.5) * 0.6, vy: 1.5 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 0.6, life: 0.3 + Math.random() * 0.25, size: size * 0.6, sizeEnd: size * 0.15, color: 0xfff0a0, colorEnd: 0xff3a10, alpha: 0.7, shape: 'soft', rot: Math.random() * 6, spin: (Math.random() - 0.5) * 4 })
        if (Math.random() < 0.2) this.smoke.emit({ x, y: y + size * 0.4, z, vy: 1.5, life: 0.8, size: size * 0.4, sizeEnd: size * 1.2, color: 0x2a2226, colorEnd: 0x101010, alpha: 0.22, shape: 'soft', rot: Math.random() * 6, spin: 1, fadeIn: 0.2 })
    }

    /** A ring of dust skidding out across the floor. */
    private dustRing(x: number, y: number, z: number, radius: number, color = 0x6a6058): void {
        const n = 8 + Math.round(radius * 3)
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + Math.random() * 0.4
            const s = 4 + radius * 2 + Math.random() * 3
            this.smoke.emit({ x: x + Math.cos(a) * 0.4, y: y + 0.25, z: z + Math.sin(a) * 0.4, vx: Math.cos(a) * s, vy: 0.6, vz: Math.sin(a) * s, life: 0.6 + Math.random() * 0.4, size: radius * 0.3, sizeEnd: radius * 0.8, color, colorEnd: 0x2a2626, alpha: 0.35, shape: 'soft', drag: 3.5, rot: Math.random() * 6 })
        }
    }

    /** A dark scorch mark that lingers on the floor and slowly fades. */
    private spawnScorch(x: number, y: number, z: number, radius: number): void {
        const geo = new THREE.CircleGeometry(radius * 0.9, 24)
        const mat = new THREE.MeshBasicMaterial({ color: 0x050405, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.rotation.x = -Math.PI / 2
        mesh.rotation.z = Math.random() * 6
        mesh.position.set(x, y + 0.03, z)
        this.addEffect(mesh, 9, (fx, t) => {
            mat.opacity = 0.55 * (1 - t * t)
        }, () => {
            geo.dispose()
            mat.dispose()
        })
    }

    private spawnBeam(from: THREE.Vector3, to: THREE.Vector3, color: number, width: number, life: number): void {
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(WHITE, 0.5).multiplyScalar(2.4), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
        const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.7), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
        const core = new THREE.Mesh(BOX, mat)
        const halo = new THREE.Mesh(BOX, haloMat)
        const group = new THREE.Group()
        group.add(halo)
        group.add(core)
        const len = from.distanceTo(to)
        group.position.copy(from).lerp(to, 0.5)
        group.quaternion.setFromUnitVectors(Z_AXIS, to.clone().sub(from).normalize())
        this.addEffect(group, life, (fx, t) => {
            core.scale.set(width * (1 - t), width * (1 - t), len)
            halo.scale.set(width * 3.5 * (1 - t * 0.6), width * 3.5 * (1 - t * 0.6), len)
            mat.opacity = 1 - t * t
            haloMat.opacity = (1 - t) * 0.8
        }, () => {
            mat.dispose()
            haloMat.dispose()
        })
        // sparkles drift off along the beam
        const n = Math.min(40, Math.round(len * 0.8))
        for (let i = 0; i < n; i++) {
            const p = _f2.copy(from).lerp(to, Math.random())
            this.glow.emit({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2, life: 0.2 + Math.random() * 0.3, size: 0.06 + width * 0.6, sizeEnd: 0.02, color: 0xffffff, colorEnd: color, alpha: 0.9, shape: 'spark', drag: 2 })
        }
        this.glow.emit({ x: from.x, y: from.y, z: from.z, life: 0.1, size: width * 8 + 0.3, sizeEnd: width * 4, color: 0xffffff, colorEnd: color, shape: 'star', rot: Math.random() * 3 })
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
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(WHITE, 0.5).multiplyScalar(2.5), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
        const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.8), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
        const group = new THREE.Group()
        for (let i = 0; i < n; i++) {
            const a = pts[i]!
            const b = pts[i + 1]!
            const seg = new THREE.Mesh(BOX, mat)
            seg.position.copy(a).lerp(b, 0.5)
            seg.quaternion.setFromUnitVectors(Z_AXIS, _v1.copy(b).sub(a).normalize())
            seg.scale.set(0.07, 0.07, a.distanceTo(b) * 1.05)
            group.add(seg)
            const halo = new THREE.Mesh(BOX, haloMat)
            halo.position.copy(seg.position)
            halo.quaternion.copy(seg.quaternion)
            halo.scale.set(0.28, 0.28, a.distanceTo(b) * 1.05)
            group.add(halo)
            // the joints glow
            this.glow.emit({ x: a.x, y: a.y, z: a.z, life, size: 0.5, sizeEnd: 0.2, color: 0xffffff, colorEnd: color, alpha: 0.8, shape: 'soft' })
        }
        this.addEffect(group, life, (fx, t) => {
            mat.opacity = 1 - t
            haloMat.opacity = (1 - t) * 0.7
            fx.obj.position.set((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06)
        }, () => {
            mat.dispose()
            haloMat.dispose()
        })
        this.glow.emit({ x: to.x, y: to.y, z: to.z, life: 0.1, size: 1.2, sizeEnd: 0.4, color: 0xffffff, colorEnd: color, shape: 'star', rot: Math.random() * 3 })
        this.sparks(to, null, 6, color, 5)
    }

    private spawnSlash(center: THREE.Vector3, forward: THREE.Vector3, range: number, finisher: boolean, arc: number, colorHex: number): void {
        // a crescent: a coloured band with a hot white edge, not a disc around the player
        const geo = new THREE.RingGeometry(range * 0.7, range, 32, 1, 0, arc)
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(finisher ? 0xffffff : colorHex).multiplyScalar(finisher ? 1.4 : 1.5), toneMapped: false, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
        const core = new THREE.Mesh(new THREE.RingGeometry(range * 0.9, range * 0.98, 32, 1, 0, arc), new THREE.MeshBasicMaterial({ color: new THREE.Color(colorHex).lerp(WHITE, 0.6).multiplyScalar(2), toneMapped: false, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }))
        core.rotation.x = -Math.PI / 2
        core.position.y = 0.02
        // a trail of light streaks along the blade's path
        const n = finisher ? 22 : 12
        for (let i = 0; i < n; i++) {
            const a = Math.atan2(forward.x, forward.z) + (Math.random() - 0.5) * arc
            const r = range * (0.55 + Math.random() * 0.45)
            const tangent = this.meleeCombo % 2 ? 1 : -1
            this.glow.emit({ x: center.x + Math.sin(a) * r, y: center.y + (Math.random() - 0.5) * 0.6, z: center.z + Math.cos(a) * r, vx: Math.cos(a) * 5 * tangent + Math.sin(a) * 2, vy: 1 + Math.random() * 2, vz: -Math.sin(a) * 5 * tangent + Math.cos(a) * 2, life: 0.2 + Math.random() * 0.25, size: 0.05 + Math.random() * 0.06, sizeEnd: 0.02, color: 0xffffff, colorEnd: colorHex, gravity: 8, drag: 2, shape: 'spark', stretch: 0.08 })
        }
        const tipX = center.x + forward.x * range * 0.8
        const tipZ = center.z + forward.z * range * 0.8
        this.glow.emit({ x: tipX, y: center.y, z: tipZ, life: 0.1, size: finisher ? 1.6 : 0.9, sizeEnd: 0.3, color: 0xffffff, colorEnd: colorHex, alpha: 0.9, shape: 'star', rot: Math.random() * 3 })
        const mesh = new THREE.Mesh(geo, mat)
        // the ring lies in XY; lay it flat so geometry angle θ points along yaw θ + π/2
        mesh.rotation.x = -Math.PI / 2
        const yaw = Math.atan2(forward.x, forward.z)
        const baseRot = yaw - Math.PI / 2 - arc / 2
        const holder = new THREE.Group()
        holder.position.copy(center)
        holder.rotation.order = 'YXZ'
        holder.rotation.y = baseRot
        holder.rotation.x = finisher ? 0 : (this.meleeCombo % 2 ? 0.35 : -0.35)
        holder.add(mesh)
        holder.add(core)
        const dirSign = this.meleeCombo % 2 ? 1 : -1
        this.addEffect(holder, 0.22, (fx, t) => {
            mat.opacity = (1 - t) * 0.8
            ;(core.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t * 1.6)
            fx.obj.rotation.y = baseRot + dirSign * (t - 0.5) * 1.1
            fx.obj.scale.setScalar(0.8 + t * 0.4)
        }, () => {
            geo.dispose()
            mat.dispose()
            core.geometry.dispose()
            ;(core.material as THREE.Material).dispose()
        })
    }

    /** Core flash, boiling fireballs, embers, rolling smoke, a dust ring on the floor and a scorch that lingers. */
    private spawnExplosion(center: THREE.Vector3, radius: number, color: number): void {
        const { x, y, z } = center
        const r = Math.max(1, radius)
        this.glow.emit({ x, y, z, life: 0.1, size: r * 1.2, sizeEnd: r * 2.6, color: 0xffffff, colorEnd: 0xfff0a0, alpha: 1, shape: 'soft' })
        this.glow.emit({ x, y, z, life: 0.14, size: r * 2.6, sizeEnd: r * 1.2, color: 0xffffff, colorEnd: color, alpha: 0.9, shape: 'star', rot: Math.random() * 3 })
        const balls = 5 + Math.round(r * 2)
        for (let i = 0; i < balls; i++) {
            const a = Math.random() * Math.PI * 2
            const e = Math.random() * Math.PI - Math.PI / 2
            const rr = Math.random() * r * 0.45
            const ox = Math.cos(a) * Math.cos(e) * rr
            const oy = Math.abs(Math.sin(e)) * rr
            const oz = Math.sin(a) * Math.cos(e) * rr
            const s = 2 + Math.random() * 3
            this.glow.emit({ x: x + ox, y: y + oy, z: z + oz, vx: ox * s, vy: oy * s + 2.5, vz: oz * s, life: 0.3 + Math.random() * 0.3, size: r * 0.5, sizeEnd: r * (1.1 + Math.random() * 0.5), color: 0xfff0a0, colorEnd: color, alpha: 0.75, shape: 'soft', drag: 4, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 4 })
        }
        const embers = 20 + Math.round(r * 10)
        for (let i = 0; i < embers; i++) {
            const a = Math.random() * Math.PI * 2
            const e = Math.random() * Math.PI * 0.6 - 0.1
            const s = 5 + Math.random() * (6 + r * 3)
            this.glow.emit({ x, y, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + 2, vz: Math.sin(a) * Math.cos(e) * s, life: 0.5 + Math.random() * 0.8, size: 0.06 + Math.random() * 0.08, sizeEnd: 0.02, color: 0xfff4c0, colorEnd: color, gravity: 14, drag: 1.2, shape: 'spark', stretch: 0.07, bounce: 0.45 })
        }
        const puffs = 5 + Math.round(r * 2)
        for (let i = 0; i < puffs; i++) {
            const a = Math.random() * Math.PI * 2
            const rr = Math.random() * r * 0.5
            const s = 1 + Math.random() * 2
            this.smoke.emit({ x: x + Math.cos(a) * rr, y: y + Math.random() * r * 0.3, z: z + Math.sin(a) * rr, vx: Math.cos(a) * s, vy: 1.5 + Math.random() * 2, vz: Math.sin(a) * s, life: 1 + Math.random() * 1.2, size: r * 0.5, sizeEnd: r * 1.8, color: 0x4a3f3a, colorEnd: 0x15121a, alpha: 0.5, shape: 'soft', drag: 1.5, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 1.5, fadeIn: 0.1 })
        }
        const groundY = this.groundHeight(x, z, 0.5, y + 1)
        this.dustRing(x, groundY, z, r)
        this.spawnShockwave(center, radius * 1.3, color, 0.3)
        this.spawnScorch(x, groundY, z, r)
    }

    /** Two rings race out across the floor: a wide coloured wash and a thin bright edge, with a bloom of light above. */
    private spawnShockwave(at: THREE.Vector3, radius: number, color: number, life: number): void {
        const geo = new THREE.RingGeometry(0.7, 1, 40)
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), toneMapped: false, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
        const edgeGeo = new THREE.RingGeometry(0.94, 1, 48)
        const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(WHITE, 0.6).multiplyScalar(2.2), toneMapped: false, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
        const mesh = new THREE.Mesh(geo, mat)
        const edge = new THREE.Mesh(edgeGeo, edgeMat)
        const y = this.groundHeight(at.x, at.z, 0.5, at.y + 1) + 0.08
        const group = new THREE.Group()
        group.position.set(at.x, y, at.z)
        mesh.rotation.x = -Math.PI / 2
        edge.rotation.x = -Math.PI / 2
        edge.position.y = 0.01
        group.add(mesh)
        group.add(edge)
        this.addEffect(group, life, (fx, t) => {
            const s = radius * (0.1 + t * 0.9)
            mesh.scale.set(s, s, 1)
            const s2 = radius * (0.15 + t * 0.95)
            edge.scale.set(s2, s2, 1)
            mat.opacity = (1 - t) * 0.8
            edgeMat.opacity = (1 - t) * (1 - t)
        }, () => {
            geo.dispose()
            mat.dispose()
            edgeGeo.dispose()
            edgeMat.dispose()
        })
        this.glow.emit({ x: at.x, y: y + 0.3, z: at.z, life: life * 0.8, size: radius * 0.6, sizeEnd: radius * 1.6, color, alpha: 0.35, shape: 'soft' })
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
        let dt = playing ? rawDt : 0
        if (this.hitStop > 0) {
            // a few frozen milliseconds sell a melee kill
            this.hitStop -= rawDt
            dt = 0
        }
        if (playing) {
            this.elapsed += dt
            if (this.fieldTimer > 0) this.fieldTimer -= dt
            if (this.chronoTimer > 0) this.chronoTimer -= dt
            this.timeScale = this.fieldTimer > 0 ? 0.06 : this.chronoTimer > 0 ? 0.3 : 1
            if (this.comboTimer > 0) {
                this.comboTimer -= dt
                if (this.comboTimer <= 0) this.combo = 0
            }
            if (this.hitSoundTimer > 0) this.hitSoundTimer -= dt
            this.updatePlayer(dt)
            this.updateEnemies(dt)
            this.updateProjectiles(dt)
            this.updatePickups(dt)
            this.updateFireCells(dt)
            this.updateMeteors(dt)
            this.updateRifts(dt)
            this.updateStorm(dt)
            this.updateWave(dt)
        }
        for (let i = this.hitIndicators.length - 1; i >= 0; i--) {
            const h = this.hitIndicators[i]!
            h.life -= rawDt * 0.9
            if (h.life <= 0) this.hitIndicators.splice(i, 1)
        }
        this.minimapFrame++
        if (this.minimapFrame % 2 === 0) this.drawMinimap()
        const fxDt = rawDt * (playing ? 1 : 0.15)
        this.updateDebris(fxDt)
        this.glow.update(fxDt)
        this.smoke.update(fxDt)
        this.updateEffects(rawDt)
        for (const ring of this.portalRings) ring.rotation.z += rawDt * 0.8
        for (const l of this.lanterns) l.intensity = (this.event === 'blackout' ? 4 : 9) * (0.9 + Math.sin(this.elapsed * 7 + l.position.x) * 0.1)
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
        this.bloom.strength = 0.3 + (this.overdriveTimer > 0 ? 0.15 : 0) + (this.timeScale < 1 ? 0.2 : 0)
        this.composer.render()
    }

    /**
     * Test hook: runs the simulation for `seconds` at 60 Hz without rendering,
     * optionally holding the trigger and auto-aiming at the nearest enemy.
     */
    debugAdvance(seconds: number, opts: { fire?: boolean, aim?: boolean, ads?: boolean, move?: string[] } = {}): { enemies: number, kills: number, wave: number, phase: ArenaPhase, hp: number, credits: number } {
        const dt = 1 / 60
        const frames = Math.round(seconds / dt)
        for (let i = 0; i < frames; i++) {
            if (opts.move) for (const k of opts.move) this.keys.add(k)
            if (opts.aim) {
                const target = this.nearestEnemy(this.playerCenter(_v1), 80)
                if (target) {
                    const c = _v2.set(target.pos.x, target.pos.y + target.height * target.scale * 0.5, target.pos.z)
                    const d = c.sub(this.camera.position)
                    this.yaw = Math.atan2(-d.x, -d.z)
                    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) - this.recoilPitch
                }
            }
            this.adsHeld = !!opts.ads
            this.mouseDown = !!opts.fire
            this.mouseJustDown = !!opts.fire && i % 10 === 0
            this.step(dt)
        }
        this.mouseDown = false
        // the aim key stays held between calls so a screenshot can capture the sight
        this.adsHeld = !!opts.ads
        if (opts.move) for (const k of opts.move) this.keys.delete(k)
        return { enemies: this.enemies.length, kills: this.kills, wave: this.wave, phase: this.hud.phase, hp: this.hp, credits: Math.floor(this.credits) }
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
        h.waveTotal = this.waveTotal
        h.alive = this.enemies.length
        h.kills = this.kills
        h.score = this.score
        h.combo = this.combo
        h.comboFill = this.combo > 0 ? this.comboTimer / 2.6 : 0
        const weapons = this.weapons.map(w => {
            const mag = this.magazineOf(w)
            const total = w.def.reloadTime * this.stats.reloadMult
            return {
                id: w.def.id,
                name: w.def.name,
                ammo: w.ammo,
                magazine: mag,
                reserve: w.reserve,
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
                if (a.id !== b.id || a.ammo !== b.ammo || a.magazine !== b.magazine || a.reserve !== b.reserve || a.reloading !== b.reloading || Math.abs(a.reloadProgress - b.reloadProgress) > 0.01) {
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
        h.shield = this.shield
        h.haste = Math.max(0, this.hasteTimer)
        h.turrets = this.turrets.length
        h.credits = Math.floor(this.credits)
        h.rerollCost = rerollPrice(this.wave)
        h.lance = this.stats.lance > 0 ? (this.lanceReady ? 1 : 1 - Math.max(0, this.lanceTimer) / 7) : 0
        if (h.hits.length !== this.hitIndicators.length || this.hitIndicators.length > 0) h.hits = this.hitIndicators.map(x => ({ ...x }))
        const slots = this.abilitySlots.map(id => id ? { id, name: ABILITIES[id].name, cost: this.abilityCost(id), color: ABILITIES[id].color, icon: ABILITIES[id].icon } : null)
        if (slots.some((a, i) => (a?.id ?? null) !== (h.abilities[i]?.id ?? null) || (a?.cost ?? 0) !== (h.abilities[i]?.cost ?? 0))) h.abilities = slots
        h.chrono = this.timeScale < 1
        h.combo3 = this.meleeComboTimer > 0 ? this.meleeCombo : 0
        h.fov = this.camera.fov
        const wd = this.weapon?.def
        h.spread = wd ? (wd.spread + this.spreadBloom) * THREE.MathUtils.lerp(1, wd.adsSpread, this.ads) + (this.onGround ? 0 : 0.02) : 0
    }
}
