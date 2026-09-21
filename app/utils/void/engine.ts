// Void Runner — the engine. Owns the renderer, the post stack, the hangar
// showroom and the flight simulation: player ship, turrets, drones,
// projectiles, pickups, the sector itself and the chase camera. Enemy
// behaviour lives in enemies.ts and the 2D overlay in overlay.ts.

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { randomFloat } from '#shared/utils/random'
import {
    VOID_ABILITIES, VOID_UNIT_SCALE, voidBundleUnits, voidGun, voidResource, voidShip, voidTurret, voidTurretBonus,
    type VoidAbilityId, type VoidResourceBundle, type VoidResourceId, type VoidTurretId
} from '#shared/utils/gamelogic/void'
import { AsteroidField, ORE_GLOW, raySphere, type Asteroid } from './asteroids'
import type { VoidAudio, VoidSfx } from './audio'
import { depthDesolators, depthExtraWing, depthPatrolMult, dropMult } from './data'
import {
    DebrisSystem, FlashLights, LineBatch, ParticleSystem, RingPool, ShieldBubble, SparkSystem, Trail,
    createFlame, explosion, hitSpark, muzzleFlash, type FxContext, type ParticleOpts
} from './fx'
import {
    ModelBuilder, RIM_COLOR,
    octa, ring, type BuiltModel
} from './models'
import { createSky, SpaceDust, type Sky } from './sky'
import { buildShip, shipGlow } from './ships'
import { buildBeacon, buildGate, buildStation, buildWreck } from './structures'
import { buildDrone, buildTurret, turretMounts, turretMountScale } from './turrets'
import { drawOverlay } from './overlay'
import { ObjectiveTracker } from './objectives'
import { EventDirector } from './events'
import { BeaconControl } from './beacons'
import { SectorHazards } from './hazards'
import { EnemyThreats } from './threats'
import { SkillRunner } from './skills'
import { ShipSystems } from './systems'
import { ZoneAtmosphere } from './zones'
import { VOID_ZONE_PLAIN, VOID_ZONES, voidDepthLoot, voidDepthThreat, voidZone, type VoidZoneModifier, type VoidZoneMods } from '#shared/utils/gamelogic/void-pilot'
import { voidItemType } from '#shared/utils/gamelogic/void-items'
import { VOID_SUPPLIES } from '#shared/utils/gamelogic/void-station'
import type { VoidWeaponFit } from '#shared/utils/gamelogic/void-items'
import { CAPITALS, capitalOf, spawnCapital } from './capitals'
import { RunTelemetry } from './telemetry'
import { damageEnemy, enemyRayHit, spawnCoalitionPatrol, spawnEnemy, spawnMothership, spawnTrader, spawnPatrol, spawnWarden, updateCorpses, updateEnemies, WARDEN_TRIGGER_RANGE } from './enemies'
import type {
    Drone, Enemy, EngineEvents, FloatText, HudState, Phase, Pickup, Projectile, RunConfig, RunResult, Tracer, TurretSlot
} from './types'

const BASE_EXPOSURE = 1.05

export type VoidAntialias = 'off' | 'auto' | 'high'

const FINAL_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uAberration: { value: 0.0 },
        uDamage: { value: 0 },
        uShield: { value: 0 },
        uVignette: { value: 0.55 },
        uFlash: { value: 0 }
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uAberration;
        uniform float uDamage;
        uniform float uShield;
        uniform float uVignette;
        uniform float uFlash;
        varying vec2 vUv;
        // Arithmetic hash: sin-based hashes lose precision on some GPUs (ANGLE
        // on Windows) and smear into visible patterns.
        float hash(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
        }
        void main() {
            vec2 c = vUv - 0.5;
            float d2 = dot(c, c);
            vec2 off = c * d2 * (0.012 + uAberration);
            vec3 col;
            col.r = texture2D(tDiffuse, vUv + off).r;
            col.g = texture2D(tDiffuse, vUv).g;
            col.b = texture2D(tDiffuse, vUv - off).b;
            float vig = smoothstep(0.95, 0.15, length(c * vec2(1.0, 0.85)));
            col *= mix(1.0, vig, uVignette);
            float edge = smoothstep(0.15, 0.75, length(c));
            col = mix(col, col * vec3(1.6, 0.35, 0.3) + vec3(0.08, 0.0, 0.0), uDamage * edge);
            col += vec3(0.05, 0.25, 0.45) * uShield * edge * edge;
            col += vec3(uFlash);
            // Grain scales with the colour: this buffer is linear, so added noise
            // gets amplified in the shadows by the sRGB encode. One grain per
            // pixel keeps it equally fine on any screen size. A trace of added
            // noise stays as dither, so dark nebula gradients do not band.
            float grain = hash(gl_FragCoord.xy + floor(fract(uTime * 0.37) * 997.0)) - 0.5;
            col = col * (1.0 + grain * 0.05) + grain * 0.004;
            gl_FragColor = vec4(col, 1.0);
        }`
}

/** Projectile tint for socketed relic mods, so a modded gun reads at a glance. */
const MOD_TINT: Record<string, number> = { chain: 0x8fb8ff, burn: 0xff7a2e, overcharge: 0xfff27a, frost: 0x9fe8ff, prism: 0xff7ae6 }

/** Minutes before time alone starts adding to the hunt. */
const DIRECTOR_GRACE_MINUTES = 8
/** Heat at which the sector hunts you as hard as it ever will (wanted level 5). */
const HEAT_MAX = 50
/** Heat per wanted star. */
const HEAT_PER_STAR = HEAT_MAX / 5
/** How long turrets and drones keep mining on their own after the pilot shoots a rock. */
const MINE_INTENT_SECONDS = 8
/** How far drones stray from the ship to fight or mine before they break off. */
const DRONE_LEASH = 240
const DRONE_RANGE = 170
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const FORWARD = new THREE.Vector3(0, 0, -1)
// Chase camera pull-in for heavy hulls, as a share of ship length at full heft.
const CAM = { back: 0.55, up: 0.12 }
export const SECTOR_RADIUS = 2600
/** Seconds the jump drive spools between picking a zone at the gate and leaving. */
const JUMP_SPOOL = 1.3

const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _v4 = new THREE.Vector3()
const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _e1 = new THREE.Euler()
const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Y = new THREE.Vector3(0, 1, 0)
const AXIS_Z = new THREE.Vector3(0, 0, 1)
const _c1 = new THREE.Color()
const _c2 = new THREE.Color()
// Reused for every void orb drawn, so a Desolator's volley costs no garbage.
const VOID_MOTE: ParticleOpts = { life: 0.45, size: 1.3, sizeEnd: 0, color: 0xc07bff, intensity: 2.5, drag: 1 }
const _m1 = new THREE.Matrix4()

export interface Structure {
    kind: 'station' | 'beacon'
    group: THREE.Group
    pos: THREE.Vector3
    radius: number
    dockRadius: number
    spin: THREE.Object3D[]
}

export interface PlayerState {
    root: THREE.Group
    model: BuiltModel
    pos: THREE.Vector3
    vel: THREE.Vector3
    quat: THREE.Quaternion
    radius: number
    hull: number
    shield: number
    shieldDelay: number
    energy: number
    boosting: boolean
    boostLock: boolean
    turrets: TurretSlot[]
    drones: Drone[]
    flames: { mesh: THREE.Mesh, material: THREE.ShaderMaterial, radius: number }[]
    trails: Trail[]
    shieldBubble: ShieldBubble
    gunCooldown: number
    gunSide: number
    gunBeam: boolean
    ability: VoidAbilityId | null
    abilityCooldown: number
    abilityTime: number
    abilityCharge: number
    gunShots: number
    repairT: number
    surgeT: number
    surgeCd: number
    staticCd: number
    tethered: number
    alive: boolean
    invuln: number
}

export class VoidEngine {
    readonly renderer: THREE.WebGLRenderer
    readonly overlay: HTMLCanvasElement
    private overlayCtx: CanvasRenderingContext2D
    private composer: EffectComposer
    private renderPass: RenderPass
    private bloom: UnrealBloomPass
    private scrubPass: ShaderPass
    /** Accessibility: softer bloom, a lower brightness ceiling and faint screen flashes. */
    reduceFlashes = false
    private finalPass: ShaderPass
    readonly camera = new THREE.PerspectiveCamera(68, 1, 0.3, 6000)
    scene = new THREE.Scene()
    private hangarScene = new THREE.Scene()
    private pmrem: THREE.PMREMGenerator
    private envTarget: THREE.WebGLRenderTarget | null = null
    private raf = 0
    private lastTime = 0
    time = 0
    private disposed = false
    width = 1
    height = 1

    phase: Phase = 'hangar'
    paused = false
    locked = false

    // ── Shared effect systems (live in whichever scene is active)
    particles = new ParticleSystem(9000, true)
    smoke = new ParticleSystem(2500, false)
    lines = new LineBatch(9000)
    sparks = new SparkSystem(3000)
    rings = new RingPool(24)
    debris = new DebrisSystem(260)
    flashes = new FlashLights(5)
    fx: FxContext

    // ── Flight state
    config: RunConfig | null = null
    player: PlayerState | null = null
    asteroids: AsteroidField | null = null
    enemies: Enemy[] = []
    projectiles: Projectile[] = []
    pickups: Pickup[] = []
    tracers: Tracer[] = []
    floats: FloatText[] = []
    structures: Structure[] = []
    sky: Sky | null = null
    dust = new SpaceDust()
    lair = new THREE.Vector3()
    warden: Enemy | null = null
    wardenKilled = false
    wardenSpawned = false
    cargo: VoidResourceBundle = {}
    kills = 0
    elapsed = 0
    trauma = 0
    /** 0 for the smallest hull, 1 for the Leviathan. Drives how heavy the ship flies, looks and sounds. */
    private heft = 0
    private turnRate = 0
    hurt = 0
    shieldHurt = 0
    whiteFlash = 0
    threat = 0
    /**
     * How hard the sector is hunting *you*. Kills raise it and quiet minutes
     * bleed it off, so clearing the wing off a rock and mining in peace stays
     * calm while a long killing spree brings wings down on your head. It only
     * drives the hunting waves; the sector's standing patrols are unaffected,
     * so there is always something to shoot.
     */
    heat = 0
    /** Last wanted level announced, so a change is called out once. */
    private wantedShown = 0
    private directorTimer = 40
    private patrolTimer = 20
    private dockHold = 0
    private endTimer = 0
    private endResult: RunResult | null = null
    private hudTimer = 0
    private cargoFullTimer = 0
    private lowHullTimer = 0
    private pickupMesh: THREE.InstancedMesh
    private sunLight = new THREE.DirectionalLight(0xffffff, 3)
    private fillLight = new THREE.HemisphereLight(0x4466aa, 0x110818, 0.5)
    private playerLight = new THREE.PointLight(0x88ccff, 0, 40, 2)
    private nextEnemyId = 1
    focus: Enemy | null = null
    focusRock: Asteroid | null = null
    /**
     * Seconds left of "the pilot is mining". Turrets only chew on rock while
     * this is running, so they never wander off a fight to shoot a pebble, and
     * they stop as soon as you stop.
     */
    private mineIntent = 0
    private focusStick = 0
    outOfBounds = false
    hitMarker = 0
    corpses: { group: THREE.Group, vel: THREE.Vector3, spin: THREE.Vector3, life: number, size: number, glow: number }[] = []
    lootPopups: { resource: VoidResourceId, amount: number, life: number, pop: number }[] = []
    cargoPulse = 0
    private pickupCombo = 0
    streak = 0
    streakTimer = 0
    damageDirs: { from: THREE.Vector3, life: number, shield: boolean, strength: number }[] = []
    killMarker = 0
    private warp = 0
    private warpRing = 0
    objectives: ObjectiveTracker | null = null
    sectorEvents: EventDirector | null = null
    beacons: BeaconControl | null = null
    hazards: SectorHazards | null = null
    threats = new EnemyThreats(this)
    /** What this run reports about itself for balance audits. */
    telemetry = new RunTelemetry()
    skills: SkillRunner | null = null
    supplies: Record<string, number> = {}
    suppliesUsed: Record<string, number> = {}
    relics = 0
    gearCaches = 0
    /** Pilot XP from bounties, reported with the run. */
    pilotBonusXp = 0
    systems: ShipSystems | null = null
    // Jump chain state
    depth = 1
    zone: VoidZoneModifier = 'calm'
    fuel = 1
    gate: { pos: THREE.Vector3, group: THREE.Group, spin: THREE.Object3D } | null = null
    gateOptions: VoidZoneModifier[] | null = null
    private gateCooldown = 0
    private fuelWarn = 0
    trader: Enemy | null = null
    private zoneProps: THREE.Object3D[] = []
    /** The look and ambience of a zone past a gate; the home zone has none. */
    zoneFx: ZoneAtmosphere | null = null
    /** Wind-up before a jump: the zone picked at the gate and the seconds left on the spool. */
    private jumpSpool: { zone: VoidZoneModifier, t: number } | null = null
    private baseThreat = 1
    private revived = false
    cockpit = false
    /** Set by the UI while the trade window is open. */
    modalOpen = false
    private gateArmed = true
    // Hit-stop and slow motion
    private timeScale = 1
    private slowT = 0
    private slowScale = 1

    // ── Camera
    aimQuat = new THREE.Quaternion()
    private camPos = new THREE.Vector3()
    private camQuat = new THREE.Quaternion()
    private fov = 68
    aimPoint = new THREE.Vector3()
    private leadTmp = new THREE.Vector3()

    // ── Input
    private keys = new Set<string>()
    private mouseDX = 0
    private mouseDY = 0
    private firing = false
    private abilityPressed = false
    private skillPressed = false
    sensitivity = 1
    invertY = false

    // ── Hangar
    private hangarShip: THREE.Group | null = null
    private hangarTurrets: TurretSlot[] = []
    private hangarDrones: THREE.Group[] = []
    private hangarFlames: { material: THREE.ShaderMaterial }[] = []
    private hangarOrbit = 2.3
    /** The hangar camera slowly circles the ship; off for players who get motion sick. */
    hangarSpin = true
    private hangarSize = 3
    private hangarSky: Sky | null = null
    private hangarDrag = false
    private hangarPitch = 0.18
    private hangarZoom = 1
    private hangarSwap = 0

    constructor(private container: HTMLElement, public audio: VoidAudio, public events: EngineEvents) {
        if (!container) throw new Error('Void Runner needs a mounted container')
        const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false })
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = BASE_EXPOSURE
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.domElement.style.display = 'block'
        container.appendChild(renderer.domElement)
        this.renderer = renderer

        this.overlay = document.createElement('canvas')
        Object.assign(this.overlay.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' })
        container.appendChild(this.overlay)
        this.overlayCtx = this.overlay.getContext('2d')!

        this.pmrem = new THREE.PMREMGenerator(renderer)
        const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
        this.composer = new EffectComposer(renderer, target)
        this.renderPass = new RenderPass(this.hangarScene, this.camera)
        this.composer.addPass(this.renderPass)
        // One NaN pixel turns into a black rectangle once the bloom blurs it
        // across its mip chain, so scrub the HDR buffer before bloom sees it.
        // The ceiling also caps how hot a pixel gets, so explosions never glare.
        this.scrubPass = new ShaderPass({
            uniforms: { tDiffuse: { value: null }, uCeiling: { value: 12 } },
            vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: `uniform sampler2D tDiffuse; uniform float uCeiling; varying vec2 vUv;
                void main() {
                    vec4 c = texture2D(tDiffuse, vUv);
                    if (!(c.r == c.r && c.g == c.g && c.b == c.b) || max(c.r, max(c.g, c.b)) > 60000.0) c = vec4(0.0, 0.0, 0.0, 1.0);
                    gl_FragColor = vec4(min(c.rgb, vec3(uCeiling)), 1.0);
                }`
        })
        this.composer.addPass(this.scrubPass)
        this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.9)
        this.composer.addPass(this.bloom)
        this.finalPass = new ShaderPass(FINAL_SHADER)
        this.composer.addPass(this.finalPass)
        this.composer.addPass(new OutputPass())

        this.fx = { particles: this.particles, smoke: this.smoke, sparks: this.sparks, rings: this.rings, debris: this.debris, lights: this.flashes }
        const pickupGeo = octa(0.7)
        this.pickupMesh = new THREE.InstancedMesh(pickupGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), 1500)
        this.pickupMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        this.pickupMesh.frustumCulled = false
        this.pickupMesh.count = 0

        this.bindInput()
        this.resize()
        window.addEventListener('resize', this.resize)
        this.lastTime = performance.now()
        this.raf = requestAnimationFrame(this.loop)
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────

    /** Adaptive resolution multiplier, lowered when frames run long. */
    private resScale = 1
    private frameAcc = 0
    private frameCount = 0
    private fastWindows = 0

    /**
     * Render resolution: the HDR, MSAA and bloom chain costs per pixel, so a
     * Retina screen at full density misses frames and the aim stutters. Cap
     * the pixel count above native density, but never drop below it: on a
     * 1440p monitor that upscale reads as blur, where Retina hides it.
     *
     * A standard-density monitor also needs supersampling: at one render
     * pixel per screen pixel a far light's white core and coloured halo land
     * in the same pixel and add up to white, and thin beams break into dots.
     * Auto renders those screens at the density a Retina laptop gets.
     *
     * The adaptive scale trims any of this when frames run long.
     */
    private targetPixelRatio() {
        const area = Math.max(1, this.width * this.height)
        const dpr = window.devicePixelRatio || 1
        const native = Math.min(dpr, 1)
        let pr = Math.max(Math.min(dpr, 1.5, Math.sqrt(2.8e6 / area)), native)
        // Supersampling has its own pixel budget, so a 4K monitor at 100%
        // scaling never asks for a 30-megapixel HDR target.
        if (this.antialias === 'high') pr = Math.max(pr, Math.min(2, Math.sqrt(16e6 / area)))
        else if (this.antialias === 'auto' && dpr < 1.5) pr = Math.max(pr, Math.min(1.5, Math.sqrt(9e6 / area)))
        return Math.max(0.5, pr * this.resScale)
    }

    private antialias: VoidAntialias = 'auto'

    /** Supersampling: `auto` lifts standard-density screens to Retina-like density, `high` renders at 2x everywhere. */
    setAntialias(mode: VoidAntialias) {
        if (mode === this.antialias) return
        this.antialias = mode
        this.resScale = 1
        this.resize()
    }

    /** Called every frame: steps resolution down when frames run long, back up when there is headroom. */
    private adaptResolution(dt: number) {
        this.frameAcc += dt
        this.frameCount++
        if (this.frameAcc < 1.5) return
        const avg = this.frameAcc / this.frameCount
        this.frameAcc = 0
        this.frameCount = 0
        if (avg > 0.021 && this.resScale > 0.6) {
            this.resScale = Math.max(0.6, this.resScale - 0.1)
            this.fastWindows = 0
            this.resize()
        } else if (avg < 0.0175 && this.resScale < 1) {
            if (++this.fastWindows >= 3) {
                this.fastWindows = 0
                this.resScale = Math.min(1, this.resScale + 0.05)
                this.resize()
            }
        } else {
            this.fastWindows = 0
        }
    }

    private resize = () => {
        const w = this.container.clientWidth || window.innerWidth
        const h = this.container.clientHeight || window.innerHeight
        this.width = w
        this.height = h
        const ratio = this.targetPixelRatio()
        this.renderer.setPixelRatio(ratio)
        this.composer.setPixelRatio(ratio)
        this.renderer.setSize(w, h)
        this.composer.setSize(w, h)
        this.bloom.resolution.set(w / 2, h / 2)
        this.camera.aspect = w / h
        this.camera.updateProjectionMatrix()
        // The 2D overlay is redrawn every frame too; it does not need full Retina density.
        const dpr = Math.min(window.devicePixelRatio, 1.5)
        this.overlay.width = w * dpr
        this.overlay.height = h * dpr
        this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
        const pr = this.renderer.getPixelRatio()
        this.particles.setViewportHeight(h * pr, this.camera.fov)
        this.smoke.setViewportHeight(h * pr, this.camera.fov)
        this.lines.setViewportHeight(h * pr, this.camera.fov)
        this.dust.setViewport(h * pr, this.camera.fov, pr)
        this.sky?.setPixelRatio(pr)
        this.hangarSky?.setPixelRatio(pr)
    }

    dispose() {
        this.disposed = true
        cancelAnimationFrame(this.raf)
        window.removeEventListener('resize', this.resize)
        this.unbindInput()
        if (document.pointerLockElement) document.exitPointerLock()
        this.teardownRun()
        this.sky?.dispose()
        this.hangarSky?.dispose()
        this.asteroids?.dispose()
        this.envTarget?.dispose()
        this.pmrem.dispose()
        this.composer.dispose()
        this.renderer.dispose()
        this.renderer.domElement.remove()
        this.overlay.remove()
    }

    private loop = (now: number) => {
        if (this.disposed) return
        this.raf = requestAnimationFrame(this.loop)
        const raw = (now - this.lastTime) / 1000
        const dt = Math.min(0.05, Math.max(0.0001, raw))
        this.lastTime = now
        // Hidden tabs report huge gaps; those say nothing about render cost.
        if (raw < 0.25) this.adaptResolution(raw)
        this.time += dt

        if (this.phase === 'hangar') {
            this.updateHangar(dt)
            this.renderPass.scene = this.hangarScene
        } else {
            if (!this.paused) {
                // Hit-stop and slow motion ease back to real time.
                if (this.slowT > 0) {
                    this.slowT -= dt
                    this.timeScale = THREE.MathUtils.lerp(this.timeScale, this.slowScale, 1 - Math.exp(-20 * dt))
                } else {
                    this.timeScale = THREE.MathUtils.lerp(this.timeScale, 1, 1 - Math.exp(-8 * dt))
                }
                this.updateFlight(dt * this.timeScale)
            }
            this.renderPass.scene = this.scene
        }
        this.finalPass.uniforms.uTime!.value = this.time
        this.composer.render(dt)
        this.overlayCtx.clearRect(0, 0, this.width, this.height)
        if (this.phase !== 'hangar' && this.player) drawOverlay(this.overlayCtx, this)
    }

    private setEnvironment(sky: Sky) {
        const parent = sky.group.parent
        const envScene = new THREE.Scene()
        envScene.add(sky.group)
        const rt = this.pmrem.fromScene(envScene, 0, 0.1, 1000)
        envScene.remove(sky.group)
        // Object3D has one parent: put the sky back where it came from.
        parent?.add(sky.group)
        this.envTarget?.dispose()
        this.envTarget = rt
        return rt.texture
    }

    // ─── Input ─────────────────────────────────────────────────────────────

    private bindInput() {
        window.addEventListener('keydown', this.onKeyDown)
        window.addEventListener('keyup', this.onKeyUp)
        window.addEventListener('mousemove', this.onMouseMove)
        window.addEventListener('mousedown', this.onMouseDown)
        window.addEventListener('mouseup', this.onMouseUp)
        window.addEventListener('wheel', this.onWheel, { passive: true })
        window.addEventListener('blur', this.onBlur)
        document.addEventListener('pointerlockchange', this.onPointerLock)
        this.renderer.domElement.addEventListener('contextmenu', this.preventMenu)
    }

    private unbindInput() {
        window.removeEventListener('keydown', this.onKeyDown)
        window.removeEventListener('keyup', this.onKeyUp)
        window.removeEventListener('mousemove', this.onMouseMove)
        window.removeEventListener('mousedown', this.onMouseDown)
        window.removeEventListener('mouseup', this.onMouseUp)
        window.removeEventListener('wheel', this.onWheel)
        window.removeEventListener('blur', this.onBlur)
        document.removeEventListener('pointerlockchange', this.onPointerLock)
        this.renderer.domElement.removeEventListener('contextmenu', this.preventMenu)
    }

    private preventMenu = (e: Event) => e.preventDefault()

    private onKeyDown = (e: KeyboardEvent) => {
        if (this.phase === 'hangar') return
        if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return
        this.keys.add(e.code)
        if (['Space', 'Tab', 'ControlLeft'].includes(e.code)) e.preventDefault()
        if (e.code === 'KeyR') this.abilityPressed = true
        if (e.code === 'KeyQ' && !e.repeat) this.skillPressed = true
        if (!e.repeat && this.phase === 'flying' && this.locked && this.systems) {
            if (e.code === 'KeyE') this.systems.secondaryDown()
            if (e.code === 'KeyG') this.systems.useDevice()
            if (e.code === 'KeyT') this.systems.scan()
            if (e.code === 'KeyV') this.toggleCockpit()
            if (e.code === 'KeyF' && this.traderInReach()) this.events.trade()
        }
        if (!e.repeat && this.phase === 'flying' && this.locked) {
            const supply = VOID_SUPPLIES.find(s => `Digit${s.key}` === e.code)
            if (supply) this.useSupply(supply.id)
        }
        // Esc never unpauses behind the gate or trade windows; those close through their buttons.
        if (e.code === 'Escape' && !this.locked && !this.modalOpen && !this.gateOptions) this.setPaused(!this.paused)
    }

    get mapOpen() {
        return this.keys.has('Tab') || this.keys.has('KeyM')
    }

    /** Softer bloom, a lower brightness ceiling and faint screen flashes for sensitive eyes. */
    setReduceFlashes(on: boolean) {
        this.reduceFlashes = on
        this.scrubPass.uniforms.uCeiling!.value = on ? 4 : 12
        this.applyGlow()
    }

    private glow = 1

    /**
     * Bloom strength multiplier, 0 turns it off. Bloom spreads over a share of
     * the screen, so a big monitor throws far more of it at the eye than a
     * laptop does; players tune it to their screen.
     */
    setGlow(amount: number) {
        this.glow = THREE.MathUtils.clamp(amount, 0, 1.5)
        this.applyGlow()
    }

    private applyGlow() {
        this.bloom.strength = (this.reduceFlashes ? 0.3 : 0.55) * this.glow
        this.bloom.enabled = this.glow > 0
    }

    /** Exposure multiplier, for bright desktop monitors or dim laptop screens. */
    setBrightness(amount: number) {
        this.renderer.toneMappingExposure = BASE_EXPOSURE * THREE.MathUtils.clamp(amount, 0.6, 1.4)
    }

    private onKeyUp = (e: KeyboardEvent) => {
        this.keys.delete(e.code)
        if (e.code === 'KeyE' && this.phase === 'flying' && this.locked && !this.paused) this.systems?.secondaryUp()
    }

    private onBlur = () => {
        this.keys.clear()
        this.firing = false
    }

    private onMouseMove = (e: MouseEvent) => {
        if (this.phase === 'hangar') {
            if (this.hangarDrag) {
                this.hangarOrbit -= e.movementX * 0.006
                this.hangarPitch = THREE.MathUtils.clamp(this.hangarPitch + e.movementY * 0.004, -0.3, 0.7)
            }
            return
        }
        if (!this.locked) return
        // Chrome occasionally reports a huge bogus delta under pointer lock; drop it.
        if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return
        this.mouseDX += e.movementX
        this.mouseDY += e.movementY
    }

    private onMouseDown = (e: MouseEvent) => {
        if (this.phase === 'hangar') {
            if (e.target === this.renderer.domElement) this.hangarDrag = true
            return
        }
        if (!this.locked) return
        if (e.button === 0) this.firing = true
        if (e.button === 2) this.skillPressed = true
    }

    private onMouseUp = (e: MouseEvent) => {
        this.hangarDrag = false
        if (e.button === 0) this.firing = false
    }

    private onWheel = (e: WheelEvent) => {
        // Only zoom when the wheel is over the 3D view itself, not a scrolling panel on top of it.
        if (this.phase === 'hangar' && e.target === this.renderer.domElement) {
            this.hangarZoom = THREE.MathUtils.clamp(this.hangarZoom + e.deltaY * 0.0008, 0.6, 1.6)
        }
    }

    private onPointerLock = () => {
        this.locked = document.pointerLockElement === this.renderer.domElement
        if (!this.locked) {
            this.firing = false
            this.keys.clear()
            if (this.phase === 'flying' && !this.paused) this.setPaused(true)
        }
    }

    requestLock() {
        this.audio.unlock()
        const el = this.renderer.domElement as HTMLCanvasElement & { requestPointerLock(opts?: { unadjustedMovement?: boolean }): Promise<void> | void }
        // Raw mouse input where the browser supports it; plain lock otherwise.
        // A refused lock (no user gesture yet) is fine: the engage overlay asks for a click.
        const plain = () => {
            try {
                const retry = el.requestPointerLock() as Promise<void> | void
                if (retry) retry.catch(() => {})
            } catch {
                // not allowed right now
            }
        }
        try {
            const result = el.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | void
            if (result) result.catch((err: { name?: string }) => {
                if (err?.name === 'NotSupportedError') plain()
            })
        } catch {
            plain()
        }
    }

    setPaused(paused: boolean) {
        if (this.phase === 'hangar') return
        this.paused = paused
        if (paused) {
            this.audio.updateEngine(0, false, 0)
            if (document.pointerLockElement) document.exitPointerLock()
        }
        this.events.pause(paused)
    }

    // ─── Hangar ────────────────────────────────────────────────────────────

    showHangar(shipId: string, turrets: (VoidTurretId | null)[], drones: number, tier = 1, palette?: readonly [number, number, number], shipTier?: number) {
        this.phase = 'hangar'
        this.paused = false
        if (!this.hangarSky || palette) {
            this.hangarSky?.dispose()
            if (this.hangarSky) this.hangarScene.remove(this.hangarSky.group)
            this.hangarSky = createSky(palette ?? [0x050b1f, 0x1b4a8a, 0x5ec8ff], 7 + tier * 13)
            this.hangarSky.setPixelRatio(this.renderer.getPixelRatio())
            this.hangarScene.add(this.hangarSky.group)
            this.hangarScene.environment = this.setEnvironment(this.hangarSky)
            this.buildHangarSet()
        }
        if (this.hangarShip) {
            this.hangarScene.remove(this.hangarShip)
            disposeTree(this.hangarShip)
        }
        for (const d of this.hangarDrones) this.hangarScene.remove(d)
        const model = buildShip(shipId, shipTier)
        const root = new THREE.Group()
        root.add(model.group)
        this.hangarTurrets = this.mountTurrets(model, turrets, root, voidTurretBonus(voidShip(shipId)))
        this.hangarFlames = []
        const palette2 = { glow: shipGlow(shipId, shipTier) }
        for (const e of model.engines) {
            const flame = createFlame(e.radius, palette2.glow)
            flame.mesh.position.copy(e.position)
            root.add(flame.mesh)
            this.hangarFlames.push(flame)
        }
        this.hangarShip = root
        this.hangarSize = voidShip(shipId).size
        this.hangarSwap = 1
        this.rings.spawn(new THREE.Vector3(0, 0.6, 0), 9, shipGlow(shipId, shipTier), 0.6, 2.5, new THREE.Vector3(0, 1, 0))
        this.hangarScene.add(root)
        this.hangarDrones = Array.from({ length: drones }, () => {
            const d = buildDrone(palette2.glow)
            d.scale.setScalar(1.1)
            this.hangarScene.add(d)
            return d
        })
    }

    private buildHangarSet() {
        const s = this.hangarScene
        for (const child of [...s.children]) {
            if (child !== this.hangarSky?.group && child !== this.hangarShip) s.remove(child)
        }
        const key = new THREE.DirectionalLight(0xfff1dd, 2.2)
        key.position.set(8, 10, 6)
        const rim = new THREE.DirectionalLight(0x6fb8ff, 1.4)
        rim.position.set(-10, 3, -12)
        const under = new THREE.PointLight(0x4fa8ff, 14, 26, 2)
        under.position.set(0, -4, 0)
        s.add(key, rim, under, new THREE.HemisphereLight(0x3b5580, 0x0a0a12, 0.5))
        // A hexagonal cradle the ship floats over.
        const b = new ModelBuilder()
        b.solid(new THREE.CylinderGeometry(9, 10, 0.8, 6), 0x252a33, [0, -5, 0])
        b.solid(new THREE.CylinderGeometry(6, 6.5, 0.9, 6), 0x3a404c, [0, -4.9, 0])
        b.glow(ring(7.6, 0.05, 3, 6), 0x5ec8ff, 1.3, [0, -4.52, 0], [Math.PI / 2, 0, Math.PI / 6])
        b.glow(ring(4.6, 0.03, 3, 36), 0x5ec8ff, 1.1, [0, -4.42, 0], [Math.PI / 2, 0, 0])
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 6
            b.solid(new THREE.BoxGeometry(0.5, 0.9, 0.5), 0x2c323c, [Math.cos(a) * 9.6, -4.4, Math.sin(a) * 9.6])
            b.glow(new THREE.BoxGeometry(0.16, 0.16, 0.16), 0xffb35e, 2.5, [Math.cos(a) * 9.6, -3.85, Math.sin(a) * 9.6])
        }
        const cradle = b.build().group
        cradle.position.y = -1.5
        cradle.name = 'cradle'
        s.add(cradle)
        s.add(this.particles.points, this.smoke.points, this.lines.mesh, this.rings.group)
    }

    private updateHangar(dt: number) {
        const ship = this.hangarShip
        if (!ship) return
        const size = this.hangarSize
        // Normalise every hull to roughly the same on-screen size, big ships a little bigger.
        this.hangarSwap = Math.max(0, this.hangarSwap - dt * 3)
        // New hulls ease in from a slight shrink as they materialise.
        const swap = 1 - this.hangarSwap * this.hangarSwap * 0.12
        ship.scale.setScalar((5 / size) * (1 + Math.min(1, size / 16) * 0.6) * swap)
        const sway = this.hangarSpin ? 1 : 0
        ship.position.y = 0.6 + Math.sin(this.time * 1.2) * 0.25 * sway
        ship.rotation.z = Math.sin(this.time * 0.7) * 0.03 * sway
        ship.rotation.x = Math.sin(this.time * 0.9) * 0.02 * sway
        if (!this.hangarDrag && this.hangarSpin) this.hangarOrbit += dt * 0.12
        const dist = 15 * this.hangarZoom
        this.camera.position.set(Math.sin(this.hangarOrbit) * dist, dist * this.hangarPitch + 2.5, Math.cos(this.hangarOrbit) * dist)
        // Look slightly right of the ship so it sits left of the side panel.
        const right = _v1.set(Math.cos(this.hangarOrbit), 0, -Math.sin(this.hangarOrbit)).multiplyScalar(this.width > 1100 ? 2.6 : 0)
        this.camera.lookAt(right.x, 0.2, right.z)
        this.camera.fov = 45
        this.camera.updateProjectionMatrix()
        this.hangarSky?.update(this.camera, this.time)

        // Turrets sweep idly, like they are running diagnostics.
        ship.updateMatrixWorld(true)
        this.hangarTurrets.forEach((t, i) => {
            const yaw = Math.sin(this.time * 0.6 + i * 1.3) * 1.2
            const pitch = 0.2 + Math.sin(this.time * 0.9 + i) * 0.25
            t.model.yaw.rotation.y = yaw
            t.model.pitch.rotation.x = pitch
        })
        for (const f of this.hangarFlames) {
            f.material.uniforms.uTime!.value = this.time
            f.material.uniforms.uPower!.value = 0.38 + Math.sin(this.time * 3) * 0.04
        }
        this.hangarDrones.forEach((d, i) => {
            const a = this.time * 0.5 + (i / this.hangarDrones.length) * Math.PI * 2
            d.position.set(Math.cos(a) * 6.5, 1.8 + Math.sin(a * 2) * 0.6, Math.sin(a) * 6.5)
            d.lookAt(Math.cos(a + 0.1) * 6.5, 1.8, Math.sin(a + 0.1) * 6.5)
        })
        // Ambient motes drifting past.
        if (Math.random() < dt * 20) {
            this.particles.emit((Math.random() - 0.5) * 30, -4 + Math.random() * 10, (Math.random() - 0.5) * 30, 0, 0.6, 0, { life: 3, size: 0.15, color: 0x7fc8ff, intensity: 2, drag: 0 })
        }
        this.particles.update(dt)
        this.particles.flush()
        this.smoke.update(dt)
        this.smoke.flush()
        this.rings.update(dt, this.camera)
        this.lines.flush()
        this.finalPass.uniforms.uDamage!.value = 0
        this.finalPass.uniforms.uShield!.value = 0
        this.finalPass.uniforms.uFlash!.value = 0
        this.finalPass.uniforms.uAberration!.value = 0
    }

    // ─── Run setup ─────────────────────────────────────────────────────────

    startRun(config: RunConfig) {
        this.teardownRun()
        this.config = config
        this.phase = 'flying'
        this.paused = false
        this.cargo = {}
        this.kills = 0
        this.elapsed = 0
        this.threat = 0
        this.heat = 0
        this.wantedShown = 0
        this.wardenKilled = false
        this.wardenSpawned = false
        this.warden = null
        this.directorTimer = 55
        this.patrolTimer = 25
        this.dockHold = 0
        this.endTimer = 0
        this.endResult = null
        this.telemetry = new RunTelemetry()
        this.whiteFlash = 0.9
        this.warp = 1.6
        this.fov = 100

        const scene = new THREE.Scene()
        this.scene = scene
        const tier = config.sector.tier
        this.sky = createSky(config.sector.palette, 1000 + tier * 17 + Math.floor(randomFloat() * 1000))
        this.sky.setPixelRatio(this.renderer.getPixelRatio())
        scene.add(this.sky.group)
        scene.environment = this.setEnvironment(this.sky)
        this.sunLight.position.copy(this.sky.sunDirection).multiplyScalar(100)
        this.sunLight.color.copy(this.sky.sunColor)
        this.fillLight.color.set(config.sector.palette[2])
        this.fillLight.intensity = 0.9
        // A zone past a gate may have left its own light and dust behind.
        this.sunLight.intensity = 3
        this.dust.setLook(0x9fb6d8)
        RIM_COLOR.value.set(config.sector.palette[2]).lerp(new THREE.Color(0xffffff), 0.35).multiplyScalar(0.55)
        scene.add(this.sunLight, this.fillLight, this.playerLight, new THREE.AmbientLight(0x2a3040, 0.9))
        scene.add(this.particles.points, this.smoke.points, this.lines.mesh, this.rings.group, this.debris.mesh, this.flashes.group, this.pickupMesh, this.dust.points, this.dust.lines.mesh)
        this.particles.clear()
        this.smoke.clear()
        this.sparks.clear()
        this.debris.clear()

        this.asteroids?.dispose()
        this.asteroids = new AsteroidField(tier * 7 + 3)
        scene.add(this.asteroids.group)
        this.depth = 1
        this.zone = 'calm'
        this.telemetry.enterZone(this.zone, 0)
        this.fuel = 1 + (config.perks?.tanks ?? 0)
        this.gateOptions = null
        this.revived = false
        this.timeScale = 1
        this.slowT = 0
        this.baseThreat = config.sector.threat
        this.systems = new ShipSystems(this)
        this.beacons = null
        this.generateSector()
        this.spawnPlayer()
        this.skills = new SkillRunner(this, config.skill)
        this.supplies = { ...config.supplies }
        this.suppliesUsed = {}
        this.relics = 0
        this.gearCaches = 0
        this.pilotBonusXp = 0
        this.objectives = new ObjectiveTracker(this, !!config.tutorial)
        this.sectorEvents = new EventDirector(this)
        this.audio.startEngine()
        this.audio.startAmbient([55, 49, 41.2, 46.2, 36.7][tier - 1] ?? 55)
        this.audio.play('undock')
        setTimeout(() => this.events.banner(config.sector.name, `Sector ${tier} · ${config.sector.description}`, 'info'), 900)
    }

    private teardownRun() {
        if (this.player) disposeTree(this.player.root)
        for (const e of this.enemies) disposeTree(e.group)
        for (const c of this.corpses) disposeTree(c.group)
        this.corpses = []
        this.enemies = []
        this.projectiles = []
        this.pickups = []
        this.tracers = []
        this.floats = []
        this.structures = []
        this.player = null
        this.hazards?.dispose()
        this.hazards = null
        this.threats.clear()
        this.beacons = null
        this.skills?.dispose()
        this.skills = null
        this.systems?.dispose()
        this.systems = null
        if (this.gate) disposeTree(this.gate.group)
        this.gate = null
        for (const prop of this.zoneProps) disposeTree(prop)
        this.zoneProps = []
        this.zoneFx?.dispose()
        this.zoneFx = null
        this.jumpSpool = null
        this.gateOptions = null
        this.modalOpen = false
        this.trader = null
        this.cockpit = false
        this.skillPressed = false
        this.focus = null
        this.focusRock = null
        this.mineIntent = 0
        this.asteroids?.clear()
        this.sky?.dispose()
        this.sky = null
        this.audio.stopEngine()
        this.audio.stopAmbient()
        this.audio.stopCombat()
    }

    returnToHangar() {
        if (document.pointerLockElement) document.exitPointerLock()
        this.teardownRun()
        this.config = null
        this.phase = 'hangar'
        this.paused = false
        this.particles.clear()
        this.smoke.clear()
        this.sparks.clear()
        this.debris.clear()
        this.buildHangarSet()
        if (this.hangarShip) this.hangarScene.add(this.hangarShip)
        for (const d of this.hangarDrones) this.hangarScene.add(d)
    }

    private rand(min: number, max: number) {
        return min + randomFloat() * (max - min)
    }

    private randomDir(flatten = 0.3) {
        return new THREE.Vector3(randomFloat() - 0.5, (randomFloat() - 0.5) * flatten, randomFloat() - 0.5).normalize()
    }

    private generateSector() {
        const cfg = this.config!
        const tier = cfg.sector.tier
        const accent = cfg.sector.palette[2]

        const zone = this.zone
        const mods = this.zoneMods
        // Past a gate the zone dresses the whole sector: sky, murk, light, dust and rock.
        this.zoneFx = this.depth > 1 ? new ZoneAtmosphere(this, zone) : null
        this.asteroids!.setLook(this.zoneFx?.look.rock[0] ?? 0xffffff, this.zoneFx?.look.rock[1] ?? 1)
        if (this.depth === 1) {
            const station = buildStation(accent)
            this.scene.add(station.group)
            this.structures.push({ kind: 'station', group: station.group, pos: new THREE.Vector3(), radius: 50, dockRadius: 75, spin: [station.ring] })
        } else {
            // Deeper jumps have no station: an extraction beacon waits where you arrive.
            const arrival = buildBeacon(0x3dffb0)
            arrival.group.position.set(0, 0, -40)
            arrival.group.scale.setScalar(2.2)
            this.scene.add(arrival.group)
            this.structures.push({ kind: 'beacon', group: arrival.group, pos: arrival.group.position, radius: 16, dockRadius: 40, spin: [arrival.ringA, arrival.ringB] })
        }

        // The home zone's beacons are fixed places the pilot fights for; the first
        // flight and the zones past a gate keep plain, open ones.
        this.beacons ??= new BeaconControl(this)
        const beaconDirs: THREE.Vector3[] = this.depth === 1 && !cfg.tutorial ? this.beacons.setup(cfg.beacons ?? []) : []
        for (let i = 0; i < 2 && !this.beacons.sites.length; i++) {
            const dir = this.randomDir(0.25)
            const pos = dir.multiplyScalar(this.rand(1300, 1650))
            beaconDirs.push(pos.clone().normalize())
            const beacon = buildBeacon(0x3dffb0)
            beacon.group.position.copy(pos)
            beacon.group.scale.setScalar(2.2)
            this.scene.add(beacon.group)
            this.structures.push({ kind: 'beacon', group: beacon.group, pos, radius: 16, dockRadius: 40, spin: [beacon.ringA, beacon.ringB] })
        }

        // The warden's lair sits far out, away from the beacons.
        let lairDir = this.randomDir(0.3)
        for (let tries = 0; tries < 20 && beaconDirs.some(d => d.dot(lairDir) > 0.4); tries++) lairDir = this.randomDir(0.3)
        this.lair.copy(lairDir).multiplyScalar(this.rand(1900, 2150))

        const ores = Object.entries(cfg.sector.ores) as [VoidResourceId, number][]
        const rollOre = (): VoidResourceId => {
            const total = ores.reduce((s, [, w]) => s + w, 0)
            let roll = randomFloat() * total
            for (const [id, w] of ores) {
                roll -= w
                if (roll < 0) return id
            }
            return ores[0]![0]
        }
        const hpMult = 1 + (tier - 1) * 0.35
        const field = this.asteroids!

        const addCluster = (center: THREE.Vector3, radius: number, count: number, oreChance: number) => {
            for (let i = 0; i < count; i++) {
                const p = center.clone().add(new THREE.Vector3(randomFloat() - 0.5, (randomFloat() - 0.5) * 0.6, randomFloat() - 0.5).multiplyScalar(radius * 2))
                const roll = randomFloat()
                const r = roll < 0.55 ? this.rand(3, 8) : roll < 0.88 ? this.rand(8, 15) : this.rand(18, 42)
                let overlap = false
                field.query(p, r + 4, () => {
                    overlap = true
                })
                if (overlap || p.length() < 160) continue
                const ore = r < 18 && randomFloat() < oreChance ? rollOre() : null
                field.add(p, r, ore, hpMult)
            }
        }

        const veins = this.depth > 1 && zone === 'rich'
        const clusters = Math.round(16 * mods.rocks)
        const oreBonus = veins ? 0.2 : 0
        for (let i = 0; i < clusters; i++) {
            const dist = this.rand(380, 2350)
            const center = this.randomDir(0.35).multiplyScalar(dist)
            if (center.distanceTo(this.lair) < 350) continue
            const rich = dist > 1300
            // Rich veins pack their rock tight, so a vein reads as one glittering knot.
            addCluster(center, veins ? this.rand(70, 130) : this.rand(90, 190), Math.round(this.rand(12, 22)), (rich ? 0.75 : 0.5) + oreBonus)
            // Sentinels sit on the far seams; in rich veins they sit on every one.
            if ((rich || veins) && randomFloat() < (veins ? 0.9 : 0.6) && (tier >= 2 || veins)) {
                for (let k = 0; k < 1 + Math.floor(randomFloat() * 2); k++) {
                    spawnEnemy(this, 'sentinel', center.clone().add(this.randomDir(0.5).multiplyScalar(60)), { aggro: false })
                }
            }
        }
        // Every beacon sits on good rock, so holding one is worth the fight.
        for (const site of this.beacons?.sites ?? []) {
            for (let k = 0; k < 2; k++) addCluster(site.structure.pos.clone().add(this.randomDir(0.3).multiplyScalar(this.rand(170, 300))), 90, 12, 0.85)
        }
        // A thin belt around the lair so it reads as a place.
        addCluster(this.lair, 260, 26, 0.35)
        for (let k = 0; k < 2 + Math.min(2, tier - 1); k++) {
            spawnEnemy(this, 'sentinel', this.lair.clone().add(this.randomDir(0.4).multiplyScalar(170)), { aggro: false })
        }
        // Some loose rock close to home so the first minute has something to shoot.
        for (let i = 0; i < 3; i++) addCluster(this.randomDir(0.3).multiplyScalar(this.rand(240, 380)), 70, 8, 0.7)

        // A capital ship somewhere out in the dark, with no marker. Its orbit is
        // cleared of rock so it never grinds through an asteroid.
        let shipDir = this.randomDir(0.25)
        for (let tries = 0; tries < 30 && (shipDir.dot(lairDir) > 0.2 || beaconDirs.some(d => d.dot(shipDir) > 0.6)); tries++) shipDir = this.randomDir(0.25)
        const shipAt = shipDir.multiplyScalar(this.rand(1250, 1750))
        const doomed: Asteroid[] = []
        field.query(shipAt, 440, rock => doomed.push(rock))
        for (const rock of doomed) field.remove(rock)
        // The first zone always hides a carrier; deeper jumps sometimes do.
        // The first flight stays gentle: no carrier, trader or Coalition to distract from the basics.
        const tutorial = !!cfg.tutorial
        if (!tutorial && (this.depth === 1 || randomFloat() < 0.5)) spawnMothership(this, shipAt)

        // The warp gate to the next zone, far from home and from the lair.
        let gateDir = this.randomDir(0.2)
        for (let tries = 0; tries < 30 && (gateDir.dot(lairDir) > 0.3 || gateDir.dot(shipDir) > 0.5); tries++) gateDir = this.randomDir(0.2)
        const gatePos = gateDir.multiplyScalar(this.rand(1500, 1900))
        const gateGroup = new THREE.Group()
        const gateModel = buildGate(0xc07bff)
        gateGroup.add(gateModel.group)
        gateGroup.position.copy(gatePos)
        gateGroup.lookAt(0, gatePos.y, 0)
        this.scene.add(gateGroup)
        const gateClear: Asteroid[] = []
        field.query(gatePos, 120, rock => gateClear.push(rock))
        for (const rock of gateClear) field.remove(rock)
        this.gate = { pos: gatePos, group: gateGroup, spin: gateModel.spin }

        // Two more capitals hide out here with no marker: a Tyrant in every
        // zone and, past the first jump, an Eclipse Harbinger. Each parks well
        // clear of the lair, the gate, the beacons and the other capitals.
        if (!tutorial) {
            const avoid = [this.lair, shipAt, gatePos]
            for (const id of this.depth > 1 ? ['tyrant', 'harbinger'] as const : ['tyrant'] as const) {
                let at = this.randomDir(0.25).multiplyScalar(this.rand(1350, 1900))
                for (let tries = 0; tries < 40 && (avoid.some(a => a.distanceTo(at) < 800) || beaconDirs.some(d => d.dot(at) / at.length() > 0.7)); tries++) {
                    at = this.randomDir(0.25).multiplyScalar(this.rand(1350, 1900))
                }
                avoid.push(at)
                const parked: Asteroid[] = []
                field.query(at, CAPITALS[id].orbit + 280, rock => parked.push(rock))
                for (const rock of parked) field.remove(rock)
                spawnCapital(this, id, at)
            }
        }

        // A Free Trader parks near the arrival point, and a Coalition patrol hunts raiders.
        if (!tutorial && randomFloat() < (this.depth === 1 ? 0.45 : 0.7)) {
            this.trader = spawnTrader(this, this.randomDir(0.2).multiplyScalar(this.rand(260, 380)))
        }
        if (!tutorial && randomFloat() < 0.7) spawnCoalitionPatrol(this, this.randomDir(0.3).multiplyScalar(this.rand(700, 1600)))

        // Wrecks with salvage crates.
        const graveyard = this.depth > 1 && zone === 'graveyard'
        for (let i = 0; i < Math.round(7 * mods.wrecks); i++) {
            // A graveyard's first few wrecks are hulks the size of a station, and solid.
            const hulk = graveyard && i < 5
            const pos = this.randomDir(0.3).multiplyScalar(hulk ? this.rand(500, 1700) : this.rand(450, 2200))
            if (hulk && (pos.distanceTo(gatePos) < 300 || pos.distanceTo(shipAt) < 600 || pos.distanceTo(this.lair) < 400)) continue
            const wreck = buildWreck(Math.floor(randomFloat() * 1e6))
            const scale = hulk ? this.rand(9, 14) : this.rand(1.5, 2.6)
            wreck.group.position.copy(pos)
            wreck.group.rotation.set(randomFloat() * 6, randomFloat() * 6, randomFloat() * 6)
            wreck.group.scale.setScalar(scale)
            this.scene.add(wreck.group)
            this.zoneProps.push(wreck.group)
            if (hulk) {
                const solid = wreck.radius * scale * 0.4
                const crushed: Asteroid[] = []
                field.query(pos, solid + 30, rock => crushed.push(rock))
                for (const rock of crushed) field.remove(rock)
                this.zoneFx?.addSolid(pos, solid)
            }
            const crates = 2 + Math.floor(randomFloat() * 3)
            for (let k = 0; k < crates; k++) {
                spawnEnemy(this, 'crate', pos.clone().add(this.randomDir(0.8).multiplyScalar(hulk ? wreck.radius * scale * 0.4 + this.rand(14, 30) : this.rand(18, 34))), {})
            }
        }

        this.hazards = new SectorHazards(this)
        this.hazards.setup()
        this.systems?.seedZone(graveyard, mods.caches)
        this.zoneFx?.populate()
        this.applyZoneLook()

        // Initial patrols out in the dark: more of them with every jump.
        const groups = Math.round((9 + tier) * mods.patrols * depthPatrolMult(this.depth))
        for (let i = 0; i < groups; i++) {
            spawnPatrol(this, this.randomDir(0.3).multiplyScalar(this.rand(550, 2300)), false)
        }
        // Desolators only fly past a gate, and there is always one out there with its escort.
        for (let i = 0; i < depthDesolators(this.depth); i++) {
            const at = this.randomDir(0.3).multiplyScalar(this.rand(700, 1900))
            const wing = 700_000 + this.nextId()
            spawnEnemy(this, 'desolator', at, { aggro: false, group: wing })
            for (let k = 0; k < 2; k++) spawnEnemy(this, 'raider', at.clone().add(this.randomDir(0.5).multiplyScalar(this.rand(30, 50))), { aggro: false, group: wing })
        }
    }

    private spawnPlayer() {
        const cfg = this.config!
        const ship = voidShip(cfg.shipId)
        const model = buildShip(cfg.shipId, cfg.shipTier)
        const root = new THREE.Group()
        root.add(model.group)
        this.heft = Math.pow(THREE.MathUtils.clamp((ship.size - 3.2) / 12.8, 0, 1), 0.7)
        this.turnRate = 0
        const palette = { glow: shipGlow(cfg.shipId, cfg.shipTier) }
        const turrets = this.mountTurrets(model, cfg.turrets, root, voidTurretBonus(ship))
        const flames = model.engines.map((e) => {
            const f = createFlame(e.radius, palette.glow)
            f.mesh.position.copy(e.position)
            root.add(f.mesh)
            return { ...f, radius: e.radius }
        })
        const shieldBubble = new ShieldBubble(ship.size * 0.72, 0x6fd8ff)
        root.add(shieldBubble.mesh)
        // Undock: start in front of a docking arm, pointing away from the station.
        const start = new THREE.Vector3(0, -8, 130)
        root.position.copy(start)
        const quat = new THREE.Quaternion().setFromRotationMatrix(_m1.lookAt(start, start.clone().add(new THREE.Vector3(0, 0.05, 1)), WORLD_UP))
        root.quaternion.copy(quat)
        this.aimQuat.copy(quat)
        this.camQuat.copy(quat)
        this.camPos.copy(start).add(new THREE.Vector3(0, 6, -30))
        this.scene.add(root)

        // Short: the chase camera sits a few ship lengths back and a long trail would run through the lens.
        const trails = model.engines.map(e => new Trail(6, palette.glow, e.radius * 0.5, 0.02))
        trails.forEach(t => t.reset(start))

        const drones: Drone[] = []
        this.player = {
            root,
            model,
            pos: root.position,
            vel: new THREE.Vector3(0, 0, 1).applyQuaternion(quat).multiplyScalar(-cfg.stats.speed * 0.8),
            quat: root.quaternion,
            radius: ship.size * 0.45,
            hull: cfg.stats.hull,
            shield: cfg.stats.shield,
            shieldDelay: 0,
            energy: 1,
            boosting: false,
            boostLock: false,
            turrets,
            drones,
            flames,
            trails,
            shieldBubble,
            gunCooldown: 0,
            gunSide: 1,
            gunBeam: false,
            ability: ship.ability,
            abilityCooldown: 1,
            abilityTime: 0,
            abilityCharge: 0,
            gunShots: 0,
            repairT: 0,
            surgeT: 0,
            surgeCd: 0,
            staticCd: 0,
            tethered: 0,
            alive: true,
            invuln: 2
        }
        this.player.vel.copy(FORWARD).applyQuaternion(quat).multiplyScalar(cfg.stats.speed * 0.9)
        for (let i = 0; i < cfg.stats.drones; i++) this.addDrone(0)
    }

    addDrone(temporary: number, wing?: Drone['wing']) {
        const p = this.player!
        const palette = { glow: wing?.color ?? (temporary > 0 ? 0xffe14f : shipGlow(this.config!.shipId, this.config!.shipTier)) }
        const group = buildDrone(palette.glow)
        const size = voidShip(this.config!.shipId).size
        group.scale.setScalar(Math.max(1, size / 5))
        group.position.copy(p.pos)
        this.scene.add(group)
        p.drones.push({
            group,
            pos: group.position,
            vel: new THREE.Vector3(),
            angle: randomFloat() * Math.PI * 2,
            slot: this.droneSlot(p.drones.length, size),
            orbitDir: randomFloat() < 0.5 ? 1 : -1,
            cooldown: randomFloat(),
            target: null,
            rock: null,
            retarget: 0,
            temporary,
            wing,
            trail: new Trail(10, palette.glow, 0.25, 0.03)
        })
        return p.drones[p.drones.length - 1]!
    }

    /** Mounts fitted turrets. Empty hardpoints stay bare. */
    mountTurrets(model: BuiltModel, fits: (VoidWeaponFit | VoidTurretId | null)[], parent: THREE.Object3D, heavy = 0): TurretSlot[] {
        const scale = turretMountScale(model, heavy)
        const slots: TurretSlot[] = []
        const mounts = turretMounts(model, fits.length)
        mounts.forEach((mount, i) => {
            const entry = fits[i]
            if (!entry) return
            const fit = typeof entry === 'string' ? null : entry
            const type = (typeof entry === 'string' ? entry : entry.type) as VoidTurretId
            const base = voidTurret(type)
            // Gear scales the type's ballistics: damage by item power, rate and range by affixes.
            const mountMult = this.config?.stats.turretMult ?? 1
            const def = fit ? { ...base, damage: base.damage * fit.power * mountMult * (base.rate === 0 ? fit.rate : 1), rate: base.rate * fit.rate, range: base.range * fit.range } : base
            const turretModel = buildTurret(type, def.color)
            turretModel.root.position.copy(mount.position)
            turretModel.root.quaternion.setFromUnitVectors(WORLD_UP, mount.normal)
            turretModel.root.scale.setScalar(scale)
            parent.add(turretModel.root)
            slots.push({
                type,
                def,
                fit,
                shots: 0,
                model: turretModel,
                mount,
                cooldown: randomFloat() * 0.5,
                target: null,
                rock: null,
                retarget: randomFloat() * 0.2,
                aligned: false,
                beam: false,
                beamPoint: new THREE.Vector3(),
                aimPoint: new THREE.Vector3(),
                recoil: 0,
                worldPos: new THREE.Vector3(),
                worldNormal: new THREE.Vector3(),
                muzzle: new THREE.Vector3()
            })
        })
        return slots
    }

    // ─── Flight update ─────────────────────────────────────────────────────

    private updateFlight(dt: number) {
        const p = this.player
        if (!p || !this.config) return
        this.elapsed += dt

        if (this.phase === 'flying') {
            this.updateControls(dt)
            this.updateAbility(dt)
            if (this.skillPressed) {
                this.skillPressed = false
                this.skills?.trigger()
            }
            this.skills?.update(dt)
            this.systems?.update(dt)
            this.updateGate(dt)
            this.updateWeapons(dt)
            this.updateDrones(dt)
            this.updateDocking(dt)
            this.updateDirector(dt)
            this.objectives?.update(dt)
            this.sectorEvents?.update(dt, !!this.objectives?.tutorialRunning)
        } else {
            this.updateEnding(dt)
        }
        this.updateShipVisuals(dt)
        updateEnemies(this, dt * (this.systems?.enemyTimeScale ?? 1))
        updateCorpses(this, dt)
        this.updateProjectiles(dt)
        this.updatePickups(dt)
        this.asteroids?.update(dt)
        this.hazards?.update(dt)
        this.zoneFx?.update(dt)
        this.threats.update(dt)
        this.beacons?.update(dt)
        for (const s of this.structures) {
            s.spin.forEach((o, i) => {
                o.rotation[i === 1 ? 'x' : 'y'] += dt * (i === 0 ? 0.05 : 0.3)
            })
        }
        this.drawDockZones()
        this.updateCamera(dt)
        this.sky?.update(this.camera, this.time)
        this.updateTracers(dt)
        this.dust.update(this.camera.position, p.alive ? p.vel : _v1.set(0, 0, 0))
        this.particles.update(dt)
        this.smoke.update(dt)
        this.sparks.update(dt, this.lines)
        this.rings.update(dt, this.camera)
        this.debris.update(dt, this.particles)
        this.flashes.update(dt)
        this.floats = this.floats.filter((f) => {
            f.life -= dt
            f.pos.y += dt * 3
            return f.life > 0
        })
        this.particles.flush()
        this.smoke.flush()
        this.lines.flush()

        this.hitMarker = Math.max(0, this.hitMarker - dt)
        this.streakTimer -= dt
        if (this.streakTimer <= 0) this.streak = 0
        this.damageDirs = this.damageDirs.filter(d => (d.life -= dt * 1.2) > 0)
        this.killMarker = Math.max(0, this.killMarker - dt)
        this.updateWarp(dt)
        this.updateJumpSpool(dt)
        this.trauma = Math.max(0, this.trauma - dt * 1.6)
        this.hurt = Math.max(0, this.hurt - dt * 1.8)
        this.shieldHurt = Math.max(0, this.shieldHurt - dt * 2.5)
        this.finalPass.uniforms.uShield!.value = this.shieldHurt
        this.whiteFlash = Math.max(0, this.whiteFlash - dt * 1.4)
        const hullFrac = p.hull / this.config.stats.hull
        this.finalPass.uniforms.uDamage!.value = Math.min(1, this.hurt * 0.8 + (hullFrac < 0.3 && p.alive ? (0.3 - hullFrac) * 1.2 * (0.7 + Math.sin(this.time * 5) * 0.3) : 0))
        this.finalPass.uniforms.uFlash!.value = Math.min(1, this.whiteFlash) * (this.reduceFlashes ? 0.12 : 0.3)
        this.finalPass.uniforms.uAberration!.value = (p.boosting ? 0.03 : 0) + this.hurt * 0.04 + (p.abilityTime > 0 && p.ability === 'phase' ? 0.05 : 0)

        // Combat music follows how many hostiles are actively engaged nearby.
        let engaged = 0
        if (p.alive) for (const en of this.enemies) if (en.alive && en.hostile && en.aggro && en.pos.distanceToSquared(p.pos) < 450 * 450) engaged += en.elite ? 3 : 1
        this.audio.setCombat(this.phase === 'flying' ? Math.min(1, engaged / 4) + (this.warden?.alive ? 0.5 : 0) : 0)

        this.hudTimer -= dt
        if (this.hudTimer <= 0) {
            this.hudTimer = 0.08
            this.events.hud(this.hudState())
        }
    }

    private updateControls(dt: number) {
        const p = this.player!
        const stats = this.config!.stats
        const k = this.keys

        // Mouse steers the aim; the hull follows at its own turn rate.
        const sens = 0.0021 * this.sensitivity
        if (this.mouseDX || this.mouseDY) {
            this.aimQuat.multiply(_q1.setFromAxisAngle(AXIS_Y, -this.mouseDX * sens))
            this.aimQuat.multiply(_q1.setFromAxisAngle(AXIS_X, -this.mouseDY * sens * (this.invertY ? -1 : 1)))
            this.mouseDX = 0
            this.mouseDY = 0
        }
        const roll = (k.has('KeyZ') ? 1 : 0) - (k.has('KeyX') ? 1 : 0)
        if (roll) {
            this.aimQuat.multiply(_q1.setFromAxisAngle(AXIS_Z, roll * 1.8 * dt))
        } else {
            // Gently settle the horizon back to the sector plane.
            const fwd = _v1.copy(FORWARD).applyQuaternion(this.aimQuat)
            if (Math.abs(fwd.dot(WORLD_UP)) < 0.85) {
                const right = _v2.set(1, 0, 0).applyQuaternion(this.aimQuat)
                const err = Math.asin(THREE.MathUtils.clamp(right.dot(WORLD_UP), -1, 1))
                this.aimQuat.multiply(_q1.setFromAxisAngle(AXIS_Z, -err * Math.min(1, dt * 1.4)))
            }
        }
        this.aimQuat.normalize()

        // Keep the aim within a cone of the nose so the crosshair never runs away.
        // A hard clamp: easing it back fought the mouse and made fast flicks stutter.
        const maxDev = THREE.MathUtils.degToRad(38)
        const dev = p.quat.angleTo(this.aimQuat)
        if (dev > maxDev) this.aimQuat.copy(_q2.copy(p.quat).rotateTowards(this.aimQuat, maxDev))
        // A heavy hull takes a moment to get its mass swinging; it stops as soon as it is on the aim.
        const wantTurn = dev < 0.004 ? 0 : stats.agility * (0.7 + Math.min(1, dev * 3))
        this.turnRate = wantTurn < this.turnRate ? wantTurn : THREE.MathUtils.lerp(this.turnRate, wantTurn, 1 - Math.exp(-(20 - this.heft * 17.5) * dt))
        p.quat.rotateTowards(this.aimQuat, this.turnRate * dt)

        // Thrust
        const forward = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0)
        const strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0)
        const lift = (k.has('Space') ? 1 : 0) - (k.has('ControlLeft') || k.has('KeyC') ? 1 : 0)
        const enginesOk = (this.systems?.speedMult ?? 1) >= 1
        const wantBoost = (k.has('ShiftLeft') || k.has('ShiftRight')) && forward > 0 && enginesOk
        if (p.energy <= 0.02) p.boostLock = true
        if (p.boostLock && p.energy > 0.25) p.boostLock = false
        const boosting = wantBoost && !p.boostLock
        if (boosting && !p.boosting) this.audio.play('boost')
        p.boosting = boosting
        p.energy = THREE.MathUtils.clamp(p.energy + (boosting ? -0.32 : 0.2) * dt, 0, 1)

        let speed = stats.speed
        if (boosting) speed *= stats.boost
        if (p.abilityTime > 0 && p.ability === 'phase') speed *= 1.5
        if (p.tethered > 0) speed *= 0.55
        speed *= this.systems?.speedMult ?? 1
        const local = _v1.set(strafe * 0.65, lift * 0.65, forward > 0 ? -1 : forward < 0 ? 0.45 : 0)
        // Diagonals used to outrun a straight line; cap the stick at full deflection.
        if (local.lengthSq() > 1) local.normalize()
        const desired = local.multiplyScalar(speed).applyQuaternion(p.quat)
        // Slowing down bites harder than speeding up, or the ship swims.
        // Mass: a big hull builds speed slowly and carries it a long way.
        const accel = (desired.lengthSq() < p.vel.lengthSq() ? 4 : boosting ? 2.6 : 1.7) * (1 - this.heft * 0.55)
        p.vel.lerp(desired, 1 - Math.exp(-accel * dt))
        p.pos.addScaledVector(p.vel, dt)

        // Sector edge
        const dist = p.pos.length()
        this.outOfBounds = dist > SECTOR_RADIUS
        if (dist > SECTOR_RADIUS * 1.6) {
            // Far out past the charted edge there is nothing but the deep, so a
            // gentle current keeps the run inside a world that still has content.
            const push = _v2.copy(p.pos).normalize().multiplyScalar(-(dist - SECTOR_RADIUS * 1.6) * 0.6 * dt)
            p.vel.add(push)
        }

        // Rock collisions (phase drive passes straight through).
        if (!(p.abilityTime > 0 && p.ability === 'phase')) {
            this.asteroids?.query(p.pos, p.radius, (rock) => {
                const n = _v2.subVectors(p.pos, rock.pos)
                const d = n.length()
                const minD = rock.radius * 0.9 + p.radius
                if (d >= minD || d < 0.001) return
                n.divideScalar(d)
                p.pos.addScaledVector(n, minD - d)
                const into = p.vel.dot(n)
                if (into < 0) {
                    // Small ships ricochet; a capital hull grinds along the rock.
                    p.vel.addScaledVector(n, -into * (1.5 - this.heft * 0.4))
                    if (-into > 25) {
                        this.damagePlayer((-into - 25) * 0.6, rock.pos, 'collision')
                        this.trauma = Math.min(1, this.trauma + 0.4)
                        hitSpark(this.fx, _v3.copy(p.pos).addScaledVector(n, -p.radius), n, 0xffc080, 2)
                        this.audio.play('rockHit', { volume: 1.5 })
                    }
                }
            })
            // The station and beacons are solid too.
            for (const s of this.structures) {
                const d = p.pos.distanceTo(s.pos)
                const minD = s.radius * (s.kind === 'station' ? 0.55 : 1) + p.radius
                if (d < minD && d > 0.001) {
                    const n = _v2.subVectors(p.pos, s.pos).divideScalar(d)
                    p.pos.addScaledVector(n, minD - d)
                    const into = p.vel.dot(n)
                    if (into < 0) p.vel.addScaledVector(n, -into * 1.2)
                }
            }
        }

        // Shield and hull regeneration
        const repair = stats.hullRepair + (stats.defenceMods.includes('nanoweave') ? 0.01 : 0) + (p.repairT > 0 ? 0.4 / 3 : 0)
        if (p.repairT > 0) p.repairT -= dt
        if (repair > 0 && p.hull < stats.hull && p.alive) p.hull = Math.min(stats.hull, p.hull + stats.hull * repair * dt)
        p.surgeCd = Math.max(0, p.surgeCd - dt)
        p.staticCd = Math.max(0, p.staticCd - dt)
        if (p.surgeT > 0) {
            p.surgeT -= dt
            if (p.surgeT <= 0) {
                p.shield = Math.max(p.shield, stats.shield * 0.5)
                this.rings.spawn(p.pos, voidShip(this.config!.shipId).size * 2.4, 0x6fd8ff, 0.5, 3)
                this.audio.play('shieldHit', { pitch: 1.6 })
            }
        }
        if (p.shieldDelay > 0) p.shieldDelay -= dt
        else if (p.shield < stats.shield) p.shield = Math.min(stats.shield, p.shield + stats.shieldRegen * dt * (this.systems?.shieldRegenMult ?? 1) * this.zoneMods.shieldRegen)
        // Radiation eats the hull whenever the shield is down.
        if (this.depth > 1 && this.zone === 'radiation' && p.shield <= 0 && p.alive && p.invuln <= 0 && this.phase === 'flying') {
            p.hull -= stats.hull * 0.004 * dt
            if (p.hull <= 0) this.hullDepleted()
        }
        if (p.invuln > 0) p.invuln -= dt
        if (p.tethered > 0) p.tethered -= dt

        // Crosshair target: whatever sits closest to the aim ray.
        this.updateFocus(dt)
    }

    /** The fitted gun, or a weak bare emitter when the slot is empty. */
    get gunFit(): VoidWeaponFit {
        return this.config?.gun ?? { itemId: '', type: 'blaster', tier: 1, rarity: 0, level: 0, power: 0.6, rate: 1, range: 1, crit: 0, mod: null, damageType: 'energy', extra: 1, cycle: 1 }
    }

    /** Speed of the equipped nose gun's shots; hitscan guns never need to lead. */
    private gunSpeed() {
        const gun = voidGun(this.gunFit.type)
        return gun.hitscan || gun.beam ? 0 : gun.speed
    }

    /**
     * Where a shot fired now meets a moving target. Shots inherit the ship's
     * velocity, so the target's motion is taken relative to ours.
     */
    leadPoint(e: Enemy, out: THREE.Vector3) {
        const p = this.player!
        const speed = this.gunSpeed()
        out.copy(e.pos)
        if (speed <= 0 || e.vel.lengthSq() < 0.01) return out
        const relVel = _v3.subVectors(e.vel, p.vel)
        let t = e.pos.distanceTo(p.pos) / speed
        for (let i = 0; i < 3; i++) {
            out.copy(e.pos).addScaledVector(relVel, t)
            t = out.distanceTo(p.pos) / speed
        }
        return out
    }

    private updateFocus(dt: number) {
        const cam = this.camera.position
        const dir = _v1.copy(FORWARD).applyQuaternion(this.aimQuat)
        let best: Enemy | null = null
        let bestScore = Infinity
        const maxRange = 520
        // Aim assist: the crosshair counts as "on" an enemy when it covers the
        // enemy itself or the point its shots need to be led to.
        const perpTo = (pos: THREE.Vector3) => {
            const to = _v2.subVectors(pos, cam)
            const along = to.dot(dir)
            if (along < 0 || along > maxRange) return { perp: Infinity, along }
            return { perp: Math.sqrt(Math.max(0, to.lengthSq() - along * along)), along }
        }
        for (const e of this.enemies) {
            if (!e.alive || !e.group.visible || e.kind === 'trader') continue
            const a = perpTo(e.pos)
            const lead = perpTo(this.leadPoint(e, this.leadTmp))
            const perp = Math.min(a.perp, lead.perp)
            const along = Math.min(a.along, lead.along)
            if (!Number.isFinite(perp)) continue
            const slack = e.radius * 1.3 + along * 0.06
            if (perp > slack) continue
            // A capital hull is huge; its batteries and reactors win the crosshair when both are under it.
            const score = perp / slack + along / maxRange + (e.hostile ? 0 : 0.5) + (e.kind === 'mothership' ? 1 : 0)
            if (score < bestScore) {
                bestScore = score
                best = e
            }
        }
        let rock: Asteroid | null = null
        if (!best) {
            const hit = this.asteroids?.raycast(cam, _v3.copy(cam).addScaledVector(dir, 420), 2)
            if (hit && hit.rock.ore) rock = hit.rock
        }
        if (best || rock) {
            this.focus = best
            this.focusRock = rock
            this.focusStick = 0.35
        } else {
            this.focusStick -= dt
            if (this.focusStick <= 0 || (this.focus && !this.focus.alive) || (this.focusRock && !this.focusRock.alive)) {
                this.focus = null
                this.focusRock = null
            }
        }
        // Nose guns converge on the lead point of the focus, or far down the aim ray.
        if (this.focus?.alive) this.leadPoint(this.focus, this.aimPoint)
        else if (this.focusRock) this.aimPoint.copy(this.focusRock.pos)
        else this.aimPoint.copy(cam).addScaledVector(dir, 420)
    }

    // ─── Abilities ─────────────────────────────────────────────────────────

    private updateAbility(dt: number) {
        const p = this.player!
        if (!p.ability) {
            this.abilityPressed = false
            return
        }
        const def = VOID_ABILITIES[p.ability]
        p.abilityCooldown = Math.max(0, p.abilityCooldown - dt)
        if (p.abilityTime > 0) {
            p.abilityTime -= dt
            this.abilityTick(dt)
            if (p.abilityTime <= 0) this.abilityEnd()
        }
        if (this.abilityPressed) {
            this.abilityPressed = false
            if (p.abilityCooldown <= 0 && p.abilityTime <= 0) {
                p.abilityCooldown = def.cooldown
                p.abilityTime = def.duration
                this.abilityStart()
                this.objectives?.onAbility()
            } else {
                this.audio.play('uiError', { volume: 0.5 })
            }
        }
    }

    private abilityStart() {
        const p = this.player!
        const stats = this.config!.stats
        const fwd = _v1.copy(FORWARD).applyQuaternion(this.aimQuat)
        this.audio.play('ability')
        switch (p.ability) {
            case 'blink': {
                const from = p.pos.clone()
                let dist = 110
                const hit = this.asteroids?.raycast(from, _v2.copy(from).addScaledVector(fwd, dist), p.radius)
                if (hit) dist = Math.max(0, hit.t - p.radius * 2)
                p.pos.addScaledVector(fwd, dist)
                p.trails.forEach(t => t.reset(p.pos))
                this.camPos.addScaledVector(fwd, dist)
                for (const at of [from, p.pos]) {
                    this.rings.spawn(at, 14, 0xffd66b, 0.45, 2.5)
                    for (let i = 0; i < 30; i++) {
                        const d = this.randomDir(1).multiplyScalar(20 + Math.random() * 30)
                        this.sparks.emit(at.x, at.y, at.z, d.x, d.y, d.z, 0.4, _c1.set(0xffd66b).multiplyScalar(3), 0.15)
                    }
                }
                for (let i = 0; i < 12; i++) {
                    const t = i / 12
                    this.particles.emit(from.x + fwd.x * dist * t, from.y + fwd.y * dist * t, from.z + fwd.z * dist * t, 0, 0, 0, { life: 0.4, size: 3, sizeEnd: 0, color: 0xffd66b, intensity: 2 })
                }
                this.audio.play('blink')
                p.abilityTime = 0
                break
            }
            case 'tractor':
                this.rings.spawn(p.pos, stats.magnet * 6, 0x3dffb0, 0.8, 1.5)
                break
            case 'salvo': {
                const targets = this.enemies.filter(e => e.alive && e.hostile && e.pos.distanceTo(p.pos) < 420)
                    .sort((a, b) => a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos))
                for (let i = 0; i < 8; i++) {
                    const target = targets[i % Math.max(1, targets.length)] ?? null
                    const side = i % 2 ? 1 : -1
                    const dir = new THREE.Vector3(side * 0.8, 0.5, -0.4).applyQuaternion(p.quat).normalize()
                    this.projectiles.push({
                        pos: p.pos.clone().addScaledVector(dir, p.radius),
                        vel: dir.multiplyScalar(60),
                        life: 5,
                        damage: 45 * stats.damageMult,
                        hostile: false,
                        color: new THREE.Color(0xff4f6d).multiplyScalar(3),
                        width: 0.5,
                        length: 2,
                        splash: 16,
                        homing: target,
                        kind: 'missile',
                        mining: 0.5,
                        source: 'missile'
                    })
                }
                this.audio.play('missile', { volume: 1.4 })
                p.abilityTime = 0
                break
            }
            case 'phase':
                p.shieldBubble.setColor(0xc49bff, 1.2)
                break
            case 'bulwark':
                p.shieldBubble.setColor(0x7fa2ff, 2)
                p.shield = stats.shield
                break
            case 'swarm':
                for (let i = 0; i < 6; i++) this.addDrone(VOID_ABILITIES.swarm.duration)
                break
            case 'nova': {
                const radius = 90
                this.rings.spawn(p.pos, radius, 0xff9be6, 0.7, 3)
                this.rings.spawn(p.pos, radius * 0.6, 0xffffff, 0.5, 2)
                this.flashes.flash(p.pos, 0xff9be6, 80, 160)
                this.trauma = Math.min(1, this.trauma + 0.6)
                for (const e of this.enemies) {
                    if (!e.alive) continue
                    const d = e.pos.distanceTo(p.pos)
                    if (d < radius + e.radius) damageEnemy(this, e, 160 * stats.damageMult * (1 - d / (radius * 1.4)), e.pos, 'nova')
                }
                for (let i = 0; i < 60; i++) {
                    const d = this.randomDir(1).multiplyScalar(80 + Math.random() * 80)
                    this.sparks.emit(p.pos.x, p.pos.y, p.pos.z, d.x, d.y, d.z, 0.6, _c1.set(0xff9be6).multiplyScalar(3), 0.3)
                }
                this.audio.play('explosionLarge')
                p.abilityTime = 0
                break
            }
            case 'overdrive':
                this.rings.spawn(p.pos, 30, 0xff4d4d, 0.6, 2)
                break
            case 'lance':
                p.abilityCharge = 0
                this.audio.play('charge', { volume: 2 })
                break
        }
    }

    private abilityTick(dt: number) {
        const p = this.player!
        const stats = this.config!.stats
        if (p.ability === 'tractor') {
            for (const pk of this.pickups) {
                const d = pk.pos.distanceTo(p.pos)
                if (d < stats.magnet * 7 && !pk.pulled) {
                    pk.pulled = true
                    pk.pullTime = 0
                }
            }
        }
        if (p.ability === 'lance') {
            p.abilityCharge += dt
            const fwd = _v1.copy(FORWARD).applyQuaternion(p.quat)
            const nose = _v2.copy(p.pos).addScaledVector(fwd, voidShip(this.config!.shipId).size * 0.7)
            if (p.abilityCharge < 0.6) {
                const c = p.abilityCharge / 0.6
                this.particles.glow(nose.x, nose.y, nose.z, _c1.set(0x9ff4ff).multiplyScalar(3 * c), 6 + c * 10)
                return
            }
            const end = _v3.copy(nose).addScaledVector(fwd, 700)
            const w = 2.5 + Math.sin(this.time * 60) * 0.4
            this.lines.pushV(nose, end, _c1.set(0x9ff4ff).multiplyScalar(4), 1, w * 1.5, w)
            this.lines.pushV(nose, end, _c1.set(0xffffff).multiplyScalar(3), 1, w * 0.4, w * 0.3)
            this.particles.glow(nose.x, nose.y, nose.z, _c1.set(0x9ff4ff).multiplyScalar(4), 18)
            this.trauma = Math.max(this.trauma, 0.35)
            for (const e of this.enemies) {
                if (!e.alive) continue
                const t = e.kind === 'mothership' ? enemyRayHit(e, nose, fwd, 700) : raySphere(nose, fwd, e.pos, e.radius + 4)
                if (t !== null && t < 700) damageEnemy(this, e, 420 * stats.damageMult * dt, e.pos, 'lance')
            }
            this.asteroids?.query(_v3.copy(nose).addScaledVector(fwd, 350), 360, (rock) => {
                if (!rock.ore) return
                const t = raySphere(nose, fwd, rock.pos, rock.radius + 3)
                if (t !== null && t < 700) this.damageRock(rock, 300 * stats.damageMult * dt, rock.pos)
            })
        }
    }

    private abilityEnd() {
        const p = this.player!
        p.shieldBubble.setColor(0x6fd8ff, 1.6)
    }

    // ─── Weapons ───────────────────────────────────────────────────────────

    private updateWeapons(dt: number) {
        const p = this.player!
        const stats = this.config!.stats
        p.root.updateMatrixWorld(true)

        this.fireGun(dt)
        // Runs down after the pilot stops shooting rock, so the turrets finish
        // the one they were on rather than cutting off mid-shot.
        this.mineIntent = Math.max(0, this.mineIntent - dt)

        const rateMult = stats.fireRateMult * (p.abilityTime > 0 && p.ability === 'overdrive' ? 2 : 1) * (this.skills?.rateMult ?? 1) * (this.systems?.weaponRate ?? 1)
        let beams = 0
        for (const t of p.turrets) {
            t.worldPos.copy(t.mount.position).applyMatrix4(p.model.group.matrixWorld)
            t.worldNormal.copy(t.mount.normal).transformDirection(p.model.group.matrixWorld)
            t.retarget -= dt
            if (t.retarget <= 0) {
                t.retarget = 0.25
                this.pickTurretTarget(t)
            }
            if (t.target && !t.target.alive) t.target = null
            if (t.rock && !t.rock.alive) t.rock = null
            const targetPos = t.target?.pos ?? t.rock?.pos ?? null
            let aim: THREE.Vector3 | null = null
            if (targetPos) {
                aim = t.aimPoint.copy(targetPos)
                // Missiles home on their own; everything else leads the target.
                if (t.target && t.def.projectileSpeed > 0 && t.def.id !== 'missile') this.turretLead(t, t.target, aim)
            }
            this.aimTurret(t, aim, dt)
            t.recoil = Math.max(0, t.recoil - dt * 6)
            t.model.barrel.position.z = t.recoil * 0.18
            t.model.barrel.updateMatrixWorld(true)
            t.muzzle.copy(t.model.muzzle).applyMatrix4(t.model.barrel.matrixWorld)

            t.beam = false
            if (!targetPos || !t.aligned) {
                t.cooldown = Math.max(0, t.cooldown - dt)
                continue
            }
            const def = t.def
            const damage = def.damage
            if (def.id === 'beam') {
                t.beam = true
                beams++
                this.fireBeam(t, damage * dt, dt)
                continue
            }
            t.cooldown -= dt * rateMult
            if (t.cooldown > 0) continue
            t.cooldown += 1 / def.rate
            if (t.cooldown < 0) t.cooldown = 0
            t.recoil = 1
            this.fireTurret(t, damage, t.def.id === 'rail' || t.def.id === 'missile' ? targetPos : aim!)
        }
        this.audio.updateEngine(Math.min(1, p.vel.length() / Math.max(1, stats.speed)), p.boosting, beams + (p.gunBeam ? 2 : 0), this.heft)
    }

    private fireGun(dt: number) {
        const p = this.player!
        const stats = this.config!.stats
        const fit = this.gunFit
        const gun = voidGun(fit.type)
        const size = voidShip(this.config!.shipId).size
        const range = gun.range * fit.range
        p.gunCooldown -= dt * (gun.beam ? 1 : stats.fireRateMult * fit.rate * (this.skills?.rateMult ?? 1) * (this.systems?.weaponRate ?? 1))
        p.gunBeam = false
        if (!this.firing) return
        // Firing at rock is what tells the turrets and drones to help mine:
        // for a while after, they strip every ore rock in reach.
        if (this.focusRock?.alive) this.mineIntent = MINE_INTENT_SECONDS
        this.systems?.breakCloak()
        const noseFwd = _v3.copy(FORWARD).applyQuaternion(p.quat)
        const muzzleFor = (side: number) => new THREE.Vector3(side * size * 0.16, -size * 0.03, -size * 0.45).applyMatrix4(p.root.matrixWorld)
        const aimDir = (from: THREE.Vector3) => {
            const dir = new THREE.Vector3().subVectors(this.aimPoint, from).normalize()
            return dir.dot(noseFwd) < 0.7 ? noseFwd.clone() : dir
        }
        // Beams have no rate of fire; rolled fire rate feeds their damage instead.
        let damage = gun.damage * stats.gun * stats.damageMult * (gun.beam ? fit.rate : 1)
        const color = new THREE.Color(fit.mod ? MOD_TINT[fit.mod] ?? gun.color : gun.color)
        const extra = { crit: fit.crit, mod: fit.mod, dtype: fit.damageType }

        if (gun.beam) {
            // The lance drains energy while it burns.
            p.energy = Math.max(0, p.energy - 0.1 * dt)
            if (p.energy <= 0.02) return
            const from = muzzleFor(0)
            const dir = aimDir(from)
            let length = range
            const rockHit = this.asteroids?.raycast(from, _v1.copy(from).addScaledVector(dir, range), 0.5)
            if (rockHit) length = rockHit.t
            let hitEnemy: Enemy | null = null
            for (const e of this.enemies) {
                if (!e.alive || !e.group.visible || e.kind === 'trader' || (e.data.coalition && !e.hostile)) continue
                const t = enemyRayHit(e, from, dir, length)
                if (t !== null && t < length) {
                    length = t
                    hitEnemy = e
                }
            }
            const end = new THREE.Vector3().copy(from).addScaledVector(dir, length)
            const w = 0.3 + size * 0.03 + Math.sin(this.time * 60) * 0.05
            this.lines.pushV(from, end, _c1.copy(color).multiplyScalar(3), 1, w * 1.6, w)
            this.lines.pushV(from, end, _c1.setRGB(3, 3, 3), 1, w * 0.4, w * 0.3)
            this.particles.glow(from.x, from.y, from.z, _c1.copy(color).multiplyScalar(3), 2 + size * 0.3)
            if (hitEnemy || rockHit) {
                this.particles.glow(end.x, end.y, end.z, _c1.copy(color).multiplyScalar(3), 4 + size * 0.3)
                if (Math.random() < dt * 25) hitSpark(this.fx, end, _v2.copy(dir).negate(), gun.color, 0.8)
            }
            if (hitEnemy) damageEnemy(this, hitEnemy, damage * dt, end, 'beam', { dtype: 'energy', mod: Math.random() < dt * 3 ? fit.mod : null })
            else if (rockHit) this.damageRock(rockHit.rock, damage * dt * 1.8 * stats.miningMult, end)
            p.gunBeam = true
            return
        }

        if (p.gunCooldown > 0) return
        p.gunCooldown += 1 / gun.rate
        p.gunShots++
        const overcharged = fit.mod === 'overcharge' && p.gunShots % 5 === 0
        if (overcharged) damage *= 3
        if (p.gunCooldown < 0) p.gunCooldown = 0
        p.gunSide *= -1
        const from = muzzleFor(gun.pellets > 1 || gun.hitscan ? 0 : p.gunSide)
        const dir = aimDir(from)

        if (gun.hitscan) {
            let limit = range
            const rockHit = this.asteroids?.raycast(from, _v1.copy(from).addScaledVector(dir, range), 0)
            if (rockHit) limit = rockHit.t
            for (const e of this.enemies) {
                if (!e.alive) continue
                const t = enemyRayHit(e, from, dir, limit)
                if (t !== null && t < limit) damageEnemy(this, e, damage, _v2.copy(from).addScaledVector(dir, t), 'rail', extra)
            }
            const end = from.clone().addScaledVector(dir, limit)
            if (rockHit) this.damageRock(rockHit.rock, damage * stats.miningMult, end)
            this.tracers.push({ a: from.clone(), b: end, color: color.clone().multiplyScalar(4), life: 0.4, maxLife: 0.4, width: 0.5 + size * 0.05 })
            this.tracers.push({ a: from.clone(), b: end.clone(), color: new THREE.Color(3, 3, 3), life: 0.15, maxLife: 0.15, width: 0.2 })
            this.rings.spawn(from, 2 + size * 0.3, gun.color, 0.35, 2.5, dir.clone())
            muzzleFlash(this.fx, from, gun.color, 3)
            this.trauma = Math.min(1, this.trauma + 0.12)
            p.vel.addScaledVector(dir, -6)
            this.audio.play('rail', { volume: 0.9, pitch: 0.8 })
            return
        }

        for (let i = 0; i < gun.pellets; i++) {
            const d = dir.clone()
            if (gun.spread > 0) {
                d.x += (Math.random() - 0.5) * gun.spread * 2
                d.y += (Math.random() - 0.5) * gun.spread * 2
                d.z += (Math.random() - 0.5) * gun.spread * 2
                d.normalize()
            }
            this.projectiles.push({
                pos: from.clone(),
                vel: d.multiplyScalar(gun.speed).add(p.vel),
                life: range / gun.speed,
                damage,
                crit: fit.crit,
                mod: fit.mod,
                dtype: fit.damageType,
                hostile: false,
                color: color.clone().multiplyScalar(3.2),
                width: (gun.id === 'plasma' ? 0.9 : gun.id === 'scatter' ? 0.2 : 0.28) * (overcharged ? 2.2 : 1),
                length: gun.id === 'plasma' ? 3 : gun.id === 'autocannon' ? 5 : 7,
                splash: gun.splash,
                homing: null,
                kind: gun.id === 'plasma' ? 'plasma' : gun.pellets > 1 ? 'pellet' : 'bolt',
                mining: 1,
                source: 'gun'
            })
        }
        muzzleFlash(this.fx, from, color.getHex(), (gun.pellets > 1 ? 2 : gun.id === 'plasma' ? 2.5 : 1.2) * (overcharged ? 2.5 : 1))
        if (overcharged) this.audio.play('rail', { volume: 0.5, pitch: 1.6 })
        const sfx: VoidSfx = gun.id === 'scatter' ? 'flak' : gun.id === 'autocannon' ? 'gatling' : gun.id === 'plasma' ? 'plasma' : 'gun'
        this.audio.play(sfx, { volume: 0.7 })
    }

    private pickTurretTarget(t: TurretSlot) {
        const p = this.player!
        const range = t.def.range
        const valid = (pos: THREE.Vector3, radius: number) => {
            const to = _v1.subVectors(pos, t.worldPos)
            const d = to.length()
            if (d > range + radius) return false
            return to.dot(t.worldNormal) > -d * 0.15
        }
        // The crosshair wins when a turret can reach it — but only on a hostile.
        // Painting a Coalition patrol or a trader must never open fire for you.
        if (this.focus?.alive && this.focus.hostile && valid(this.focus.pos, this.focus.radius)) {
            t.target = this.focus
            t.rock = null
            return
        }
        let best: Enemy | null = null
        let bestD = Infinity
        for (const e of this.enemies) {
            if (!e.alive || !e.hostile) continue
            const d = e.pos.distanceToSquared(p.pos)
            if (d < bestD && valid(e.pos, e.radius)) {
                bestD = d
                best = e
            }
        }
        if (best) {
            t.target = best
            t.rock = null
            return
        }
        t.target = null
        // Idle turrets chew on crates in reach whatever the pilot is doing.
        for (const e of this.enemies) {
            if (e.alive && e.kind === 'crate' && e.group.visible && valid(e.pos, e.radius)) {
                t.target = e
                return
            }
        }
        // Rock is only a target while the pilot is mining it themselves.
        if (this.mineIntent <= 0) {
            t.rock = null
            return
        }
        if (this.focusRock?.alive && valid(this.focusRock.pos, this.focusRock.radius)) {
            t.rock = this.focusRock
            return
        }
        if (t.rock?.alive && valid(t.rock.pos, t.rock.radius)) return
        let rock: Asteroid | null = null
        let rockD = Infinity
        this.asteroids?.query(p.pos, Math.min(range, 120), (r) => {
            if (!r.ore) return
            const d = r.pos.distanceToSquared(p.pos)
            if (d < rockD && valid(r.pos, r.radius)) {
                rockD = d
                rock = r
            }
        })
        t.rock = rock
    }

    /**
     * Where a turret round meets a moving target. Rounds inherit the ship's
     * velocity, so in the ship's frame the target moves at its relative
     * velocity; a few fixed-point steps converge on the intercept.
     */
    private turretLead(t: TurretSlot, target: Enemy, out: THREE.Vector3) {
        const speed = t.def.projectileSpeed
        const rel = _v2.copy(target.vel).sub(this.player!.vel)
        const from = t.muzzle.lengthSq() > 0 ? t.muzzle : t.worldPos
        out.copy(target.pos)
        for (let i = 0; i < 3; i++) {
            const time = Math.min(2, out.distanceTo(from) / speed)
            out.copy(target.pos).addScaledVector(rel, time)
        }
        return out
    }

    private aimTurret(t: TurretSlot, aim: THREE.Vector3 | null, dt: number) {
        const model = t.model
        let yaw = model.yaw.rotation.y
        let pitch = model.pitch.rotation.x
        let wantYaw = yaw
        let wantPitch = 0.05
        if (aim) {
            // Direction to the aim point in the turret base's local frame.
            model.root.updateMatrixWorld(true)
            const local = _v2.copy(aim)
            _m1.copy(model.root.matrixWorld).invert()
            local.applyMatrix4(_m1)
            local.y -= 0.3
            wantYaw = Math.atan2(-local.x, -local.z)
            const flat = Math.hypot(local.x, local.z)
            wantPitch = THREE.MathUtils.clamp(Math.atan2(local.y, flat), -0.12, 1.45)
        }
        const turn = 7 * dt
        const dy = Math.atan2(Math.sin(wantYaw - yaw), Math.cos(wantYaw - yaw))
        yaw += THREE.MathUtils.clamp(dy, -turn, turn)
        pitch += THREE.MathUtils.clamp(wantPitch - pitch, -turn, turn)
        model.yaw.rotation.y = yaw
        model.pitch.rotation.x = pitch
        t.aligned = !!aim && Math.abs(dy) < 0.25 && Math.abs(wantPitch - pitch) < 0.25
    }

    private fireTurret(t: TurretSlot, damage: number, targetPos: THREE.Vector3) {
        const p = this.player!
        const def = t.def
        const muzzle = t.muzzle
        const barrelDir = _v3.copy(FORWARD).transformDirection(t.model.barrel.matrixWorld)
        const mod = t.fit?.mod ?? null
        const color = new THREE.Color(mod ? MOD_TINT[mod] ?? def.color : def.color)
        const extra = { crit: t.fit?.crit ?? 0, mod, dtype: t.fit?.damageType }
        t.shots++
        if (mod === 'overcharge' && t.shots % 5 === 0) {
            damage *= 3
            muzzleFlash(this.fx, muzzle, 0xfff27a, 3)
        }

        if (def.id === 'tesla') {
            // Lightning jumps from the target to up to two more nearby hostiles.
            let from = muzzle.clone()
            let target = t.target
            let dmg = damage
            const struck = new Set<Enemy>()
            for (let j = 0; j < 3 && target; j++) {
                this.lightning(from, target.pos, def.color)
                damageEnemy(this, target, dmg, target.pos, 'tesla', extra)
                struck.add(target)
                from = target.pos.clone()
                dmg *= 0.7
                let next: Enemy | null = null
                let bestD = 60 * 60
                for (const e of this.enemies) {
                    if (!e.alive || !e.hostile || struck.has(e)) continue
                    const d = e.pos.distanceToSquared(from)
                    if (d < bestD) {
                        bestD = d
                        next = e
                    }
                }
                target = next
            }
            if (!t.target && t.rock) {
                this.lightning(muzzle, t.rock.pos, def.color)
                this.damageRock(t.rock, damage * def.mining * this.config!.stats.miningMult, t.rock.pos)
            }
            this.audio.play('tesla', { distance: muzzle.distanceTo(this.camera.position) * 0.4, volume: 0.5 })
            muzzleFlash(this.fx, muzzle, def.color, 1.4)
            return
        }
        const camDist = muzzle.distanceTo(this.camera.position)
        const mortar = def.id === 'mortar'
        const sfx = ({ pulse: 'pulse', gatling: 'gatling', flak: 'flak', missile: 'missile', rail: 'rail', beam: 'pulse', tesla: 'tesla', mortar: 'mortar' } as Record<string, VoidSfx>)[def.id] ?? 'pulse'
        this.audio.play(sfx, { distance: camDist * 0.3, volume: mortar ? 0.8 : 0.55 })

        if (def.id === 'rail') {
            const dir = _v1.subVectors(targetPos, muzzle).normalize()
            const end = muzzle.clone().addScaledVector(dir, def.range)
            const rockHit = this.asteroids?.raycast(muzzle, end, 0)
            const limit = rockHit ? rockHit.t : def.range
            for (const e of this.enemies) {
                if (!e.alive) continue
                const hitT = enemyRayHit(e, muzzle, dir, limit)
                if (hitT !== null && hitT < limit) damageEnemy(this, e, damage, _v2.copy(muzzle).addScaledVector(dir, hitT), 'rail', extra)
            }
            if (rockHit) {
                end.copy(muzzle).addScaledVector(dir, rockHit.t)
                this.damageRock(rockHit.rock, damage * def.mining * this.config!.stats.miningMult, end)
            }
            this.tracers.push({ a: muzzle.clone(), b: end, color: color.clone().multiplyScalar(4), life: 0.35, maxLife: 0.35, width: 0.7 })
            this.tracers.push({ a: muzzle.clone(), b: end.clone(), color: new THREE.Color(3, 3, 3), life: 0.12, maxLife: 0.12, width: 0.25 })
            muzzleFlash(this.fx, muzzle, def.color, 3)
            this.rings.spawn(muzzle, 3, def.color, 0.3, 2, dir.clone())
            return
        }

        for (let i = 0; i < def.pellets; i++) {
            const dir = _v1.subVectors(targetPos, muzzle).normalize()
            if (dir.dot(barrelDir) < 0.9) dir.copy(barrelDir)
            dir.x += (Math.random() - 0.5) * def.spread * 2
            dir.y += (Math.random() - 0.5) * def.spread * 2
            dir.z += (Math.random() - 0.5) * def.spread * 2
            dir.normalize()
            const missile = def.id === 'missile'
            this.projectiles.push({
                pos: muzzle.clone(),
                vel: dir.clone().multiplyScalar(missile ? 50 : def.projectileSpeed).add(p.vel),
                life: missile ? 5 : (def.range * 1.15) / def.projectileSpeed,
                damage,
                crit: extra.crit,
                mod,
                dtype: extra.dtype,
                hostile: false,
                color: color.clone().multiplyScalar(missile ? 2.5 : 3),
                width: mortar ? 1.3 : def.id === 'flak' ? 0.22 : def.id === 'gatling' ? 0.16 : 0.3,
                length: def.id === 'gatling' ? 4 : def.id === 'flak' ? 2.5 : 5,
                splash: def.splash,
                homing: missile ? t.target : null,
                homingRock: missile && !t.target ? t.rock : null,
                kind: missile ? 'missile' : mortar ? 'plasma' : def.id === 'flak' ? 'pellet' : 'bolt',
                mining: def.mining,
                source: def.id
            })
        }
        muzzleFlash(this.fx, muzzle, color.getHex(), mortar ? 3 : def.id === 'flak' ? 2 : 1)
        if (mortar) {
            this.rings.spawn(muzzle, 3, def.color, 0.35, 2, barrelDir.clone())
            t.recoil = 2
        }
    }

    /** A jagged bolt of lightning between two points. */
    lightning(a: THREE.Vector3, b: THREE.Vector3, color: number) {
        const segs = 6
        let prev = a.clone()
        const len = a.distanceTo(b)
        const c = _c1.set(color).multiplyScalar(3.5)
        for (let i = 1; i <= segs; i++) {
            const next = a.clone().lerp(b, i / segs)
            if (i < segs) next.add(this.randomDir(1).multiplyScalar(len * 0.06))
            this.tracers.push({ a: prev, b: next, color: c.clone(), life: 0.14, maxLife: 0.14, width: 0.35 })
            prev = next
        }
        this.particles.glow(b.x, b.y, b.z, c, 4)
    }

    private fireBeam(t: TurretSlot, damage: number, dt: number) {
        const target = t.target
        const rock = t.rock
        const center = target?.pos ?? rock?.pos
        if (!center) return
        const radius = target?.radius ?? rock!.radius * 0.9
        const dir = _v1.subVectors(center, t.muzzle).normalize()
        const hitT = raySphere(t.muzzle, dir, center, radius) ?? t.muzzle.distanceTo(center)
        const point = t.beamPoint.copy(t.muzzle).addScaledVector(dir, hitT)
        const color = _c1.set(t.def.color).multiplyScalar(3)
        const w = 0.35 + Math.sin(this.time * 50 + t.worldPos.x) * 0.06
        this.lines.pushV(t.muzzle, point, color, 1, w * 1.8, w * 1.2)
        this.lines.pushV(t.muzzle, point, _c1.setRGB(2.5, 2.5, 2.5), 1, w * 0.35, w * 0.3)
        this.particles.glow(point.x, point.y, point.z, color.set(t.def.color).multiplyScalar(2.5), 4 + Math.random() * 2)
        if (Math.random() < dt * 30) hitSpark(this.fx, point, _v2.copy(dir).negate(), t.def.color, 0.6)
        if (target) damageEnemy(this, target, damage, point, 'beam', t.fit?.mod && Math.random() < dt * 3 ? { mod: t.fit.mod } : undefined)
        else if (rock) this.damageRock(rock, damage * t.def.mining * this.config!.stats.miningMult, point)
    }

    // ─── Drones ────────────────────────────────────────────────────────────

    /** A formation spot above and behind the ship, fanned out wing by wing. */
    private droneSlot(index: number, size: number) {
        const side = index % 2 === 0 ? 1 : -1
        const row = Math.floor(index / 2)
        const s = size * 1.1 + 4
        return new THREE.Vector3(side * s * (0.9 + row * 0.45), s * (0.35 + (row % 2) * 0.25), s * (0.7 + row * 0.55))
    }

    /**
     * Drones pick targets the way turrets do: the pilot's hostile target
     * first, then the nearest hostile, then crates, then ore rock while the
     * pilot has been mining. They only consider things within their leash of
     * the ship, so they never wander off after something far away.
     */
    private droneRetarget(d: Drone) {
        const p = this.player!
        const leash = DRONE_LEASH * DRONE_LEASH
        d.target = null
        if (this.focus?.alive && this.focus.hostile && this.focus.pos.distanceToSquared(p.pos) < leash) {
            d.target = this.focus
            d.rock = null
            return
        }
        let best = Infinity
        for (const e of this.enemies) {
            if (!e.alive || !e.hostile || !e.group.visible) continue
            const dist = e.pos.distanceToSquared(p.pos)
            if (dist < leash && dist < best) {
                best = dist
                d.target = e
            }
        }
        if (d.target) {
            d.rock = null
            return
        }
        best = 160 * 160
        for (const e of this.enemies) {
            if (!e.alive || e.kind !== 'crate' || !e.group.visible) continue
            const dist = e.pos.distanceToSquared(p.pos)
            if (dist < best) {
                best = dist
                d.target = e
            }
        }
        if (d.target || this.mineIntent <= 0) {
            d.rock = null
            return
        }
        if (this.focusRock?.alive) {
            d.rock = this.focusRock
            return
        }
        if (d.rock?.alive && d.rock.pos.distanceToSquared(p.pos) < 140 * 140) return
        // Spread out over the field: each drone takes a rock the others have not.
        const taken = new Set(this.player!.drones.filter(o => o !== d && o.rock).map(o => o.rock))
        let rockBest = Infinity
        d.rock = null
        this.asteroids?.query(p.pos, 140, (r) => {
            if (!r.ore) return
            const dist = r.pos.distanceToSquared(p.pos) * (taken.has(r) ? 3 : 1)
            if (dist < rockBest) {
                rockBest = dist
                d.rock = r
            }
        })
    }

    private updateDrones(dt: number) {
        const p = this.player!
        const stats = this.config!.stats
        const size = voidShip(this.config!.shipId).size
        p.drones = p.drones.filter((d) => {
            if (d.temporary > 0) {
                d.temporary -= dt
                if (d.temporary <= 0) {
                    explosion(this.fx, d.pos, d.vel, 0.4, d.wing?.color ?? 0xffe14f, false)
                    this.scene.remove(d.group)
                    return false
                }
            }
            return true
        })
        // Fast enough to catch a boosting ship, never so fast they teleport.
        const maxSpeed = Math.max(stats.speed * 2.2, p.vel.length() * 1.35 + 40)
        p.drones.forEach((d, i) => {
            d.angle += dt
            d.retarget -= dt
            if (d.retarget <= 0) {
                d.retarget = 0.35 + randomFloat() * 0.2
                this.droneRetarget(d)
            }
            if (d.target && (!d.target.alive || d.target.pos.distanceTo(p.pos) > DRONE_LEASH * 1.2)) d.target = null
            if (d.rock && !d.rock.alive) d.rock = null

            // Where the drone wants to be: its slot beside the ship when idle,
            // circling its own target at a stand-off distance when busy.
            const goal = _v1
            const fromShip = d.pos.distanceTo(p.pos)
            const busy = (d.target || d.rock) && fromShip < DRONE_LEASH
            if (busy) {
                const tp = d.target?.pos ?? d.rock!.pos
                const radius = d.target ? d.target.radius : d.rock!.radius
                const standoff = radius + (d.target ? 38 : 18)
                // Circle the target on a tilted ring of its own.
                const orbit = d.angle * 0.7 * d.orbitDir + i * 2.1
                goal.set(Math.cos(orbit) * standoff, Math.sin(orbit * 0.6 + i) * standoff * 0.35, Math.sin(orbit) * standoff).add(tp)
                // Stay between the target and the ship rather than on its far side.
                goal.lerp(p.pos, 0.15)
            } else {
                goal.copy(d.slot)
                // A lazy drift so an idle wing looks alive, not bolted on.
                goal.x += Math.sin(d.angle * 0.8 + i) * 1.5
                goal.y += Math.sin(d.angle * 1.3 + i * 2) * 1
                goal.applyQuaternion(p.quat).add(p.pos)
                // Lead the ship a little so they keep formation at speed.
                goal.addScaledVector(p.vel, 0.25)
            }

            // Arrive: full speed when far, easing in near the goal, matching the ship when idle.
            const to = _v2.subVectors(goal, d.pos)
            const dist = to.length()
            const want = _v3.copy(to).multiplyScalar(Math.min(maxSpeed, dist * 2.2) / Math.max(dist, 0.001))
            if (!busy) want.addScaledVector(p.vel, Math.max(0, 1 - dist / 12))
            // Keep a little room from the other drones and the hull.
            for (const o of p.drones) {
                if (o === d) continue
                const away = _v4.subVectors(d.pos, o.pos)
                const gap = away.length()
                if (gap > 0.01 && gap < 6) want.addScaledVector(away, (6 - gap) * 4 / gap)
            }
            const hull = _v4.subVectors(d.pos, p.pos)
            const hullGap = hull.length()
            const minGap = size * 0.9 + 2
            if (hullGap > 0.01 && hullGap < minGap) want.addScaledVector(hull, (minGap - hullGap) * 6 / hullGap)
            d.vel.lerp(want, 1 - Math.exp(-3.5 * dt))
            if (d.vel.length() > maxSpeed) d.vel.setLength(maxSpeed)
            d.pos.addScaledVector(d.vel, dt)

            // Face the target while fighting, otherwise the way it is flying.
            const look = busy ? (d.target?.pos ?? d.rock?.pos) : null
            if (look) {
                _m1.lookAt(d.pos, look, WORLD_UP)
                _q1.setFromRotationMatrix(_m1)
                d.group.quaternion.slerp(_q1, 1 - Math.exp(-10 * dt))
            } else if (d.vel.lengthSq() > 4) {
                _m1.lookAt(d.pos, _v4.copy(d.pos).add(d.vel), WORLD_UP)
                _q1.setFromRotationMatrix(_m1)
                d.group.quaternion.slerp(_q1, 1 - Math.exp(-6 * dt))
            } else {
                d.group.quaternion.slerp(p.quat, 1 - Math.exp(-4 * dt))
            }
            d.trail.update(dt, d.pos)
            d.trail.draw(this.lines, d.pos, 0.6)

            d.cooldown -= dt * stats.fireRateMult * (this.skills?.rateMult ?? 1)
            if (!busy || d.cooldown > 0) return
            const target = d.target
            const aim = _v2
            if (target) {
                // Lead a moving target like the turrets do.
                aim.copy(target.pos)
                for (let k = 0; k < 2; k++) aim.copy(target.pos).addScaledVector(target.vel, Math.min(1.5, aim.distanceTo(d.pos) / 380))
            } else {
                aim.copy(d.rock!.pos)
            }
            if (d.pos.distanceTo(aim) > DRONE_RANGE) return
            // Only fire roughly along the nose, so shots read as aimed.
            const dir = _v3.subVectors(aim, d.pos).normalize()
            const nose = _v4.set(0, 0, -1).applyQuaternion(d.group.quaternion)
            if (nose.dot(dir) < 0.8) return
            d.cooldown = d.wing ? 1 / d.wing.rate : 0.45
            const color = new THREE.Color(d.wing?.color ?? (d.temporary > 0 ? 0xffe14f : shipGlow(this.config!.shipId, this.config!.shipTier))).multiplyScalar(3)
            this.projectiles.push({
                pos: d.pos.clone(),
                vel: dir.clone().multiplyScalar(380).add(d.vel),
                life: 0.7,
                damage: d.wing?.damage ?? 7 * stats.droneDamageMult,
                hostile: false,
                color,
                width: 0.2,
                length: 3.5,
                splash: 0,
                homing: null,
                kind: 'bolt',
                mining: 1.4,
                source: d.wing ? 'wingman' : 'drone'
            })
            if (Math.random() < 0.4) this.audio.play('pulse', { distance: d.pos.distanceTo(this.camera.position) * 0.5, volume: 0.3, pitch: 1.4 })
        })
    }

    // ─── Projectiles ───────────────────────────────────────────────────────

    private updateProjectiles(dt: number) {
        const p = this.player
        const next: Projectile[] = []
        const hostileScale = this.systems?.enemyTimeScale ?? 1
        for (const pr of this.projectiles) {
            const step = pr.hostile ? dt * hostileScale : dt
            pr.life -= step
            if (pr.life <= 0) {
                if (pr.kind === 'missile' || pr.kind === 'plasma') this.missileBlast(pr, pr.pos)
                continue
            }
            if (pr.kind === 'missile') {
                if (pr.homing && !pr.homing.alive) pr.homing = null
                const speed = Math.min(pr.hostile ? 110 : 240, pr.vel.length() + dt * 260)
                if (pr.homingRock && !pr.homingRock.alive) pr.homingRock = null
                const mark = pr.homing?.pos ?? pr.homingRock?.pos
                if (mark && !pr.hostile) {
                    // Lead a mover, and brake into the turn when the mark is off the nose: a missile
                    // at full burn has a wider turning circle than a parked target and would orbit it.
                    const to = _v1.subVectors(mark, pr.pos)
                    const dist = to.length()
                    if (pr.homing) to.addScaledVector(pr.homing.vel, Math.min(1.2, dist / Math.max(speed, 1)))
                    const aligned = Math.max(0, to.normalize().dot(_v4.copy(pr.vel).normalize()))
                    const cruise = speed * (0.4 + 0.6 * aligned)
                    const turn = 4.5 * (pr.turn ?? 1) * (1 + 60 / Math.max(dist, 12))
                    pr.vel.lerp(to.multiplyScalar(cruise), 1 - Math.exp(-turn * dt))
                    pr.vel.setLength(cruise)
                    if (pr.homing && dist < pr.homing.radius + 2.5) {
                        this.missileBlast(pr, pr.pos)
                        continue
                    }
                } else if (pr.homing) {
                    const want = _v1.subVectors(pr.homing.pos, pr.pos).normalize().multiplyScalar(speed)
                    pr.vel.lerp(want, 1 - Math.exp(-1.8 * dt))
                    pr.vel.setLength(speed)
                } else if (pr.hostile && p?.alive) {
                    const want = _v1.subVectors(p.pos, pr.pos).normalize().multiplyScalar(speed)
                    pr.vel.lerp(want, 1 - Math.exp(-1.4 * dt))
                    pr.vel.setLength(speed)
                } else {
                    pr.vel.setLength(speed)
                }
                if (Math.random() < 0.8) {
                    this.smoke.emit(pr.pos.x, pr.pos.y, pr.pos.z, 0, 0, 0, { life: 0.7, size: 0.8, sizeEnd: 2.6, color: 0x8a8a96, alpha: 0.18, drag: 0 })
                    this.particles.emit(pr.pos.x, pr.pos.y, pr.pos.z, 0, 0, 0, { life: 0.15, size: 1.6, sizeEnd: 0.3, color: 0xffb070, intensity: 2.5, drag: 0 })
                }
            }
            // A Desolator's orbs swing in on the pilot for a moment, then commit to their line.
            if (pr.curve && pr.curve > 0 && p?.alive) {
                pr.curve -= step
                const speed = pr.vel.length()
                pr.vel.lerp(_v1.subVectors(p.pos, pr.pos).setLength(speed), 1 - Math.exp(-1.7 * step)).setLength(speed)
            }
            const from = _v2.copy(pr.pos)
            const to = _v3.copy(pr.pos).addScaledVector(pr.vel, step)
            let consumed = false

            if (pr.hostile) {
                if (this.skills?.intercept(pr)) continue
                if (p?.alive && this.phase === 'flying') {
                    const hitR = Math.max(2.2, p.radius) + (pr.kind === 'orb' ? 1 : 0.4)
                    if (segmentSphere(from, to, p.pos, hitR)) {
                        this.damagePlayer(pr.damage, pr.pos, pr.by)
                        hitSpark(this.fx, pr.pos, _v1.subVectors(pr.pos, p.pos).normalize(), pr.color, 1.2)
                        consumed = true
                    }
                }
            } else {
                let bestT = Infinity
                let bestEnemy: Enemy | null = null
                const segLen = from.distanceTo(to)
                const dir = _v1.subVectors(to, from).divideScalar(Math.max(segLen, 1e-6))
                for (const e of this.enemies) {
                    if (!e.alive || !e.group.visible) continue
                    if (pr.source === 'coalition' && (e.data.coalition || !e.hostile)) continue
                    // Only your own nose guns can hit a friendly Coalition ship.
                    if (e.data.ally || (e.data.coalition && !e.hostile && pr.source !== 'gun')) continue
                    if (pr.source !== 'coalition' && e.kind === 'trader') continue
                    if (Math.abs(e.pos.x - from.x) > e.radius + segLen + 2) continue
                    const t = enemyRayHit(e, from, dir, segLen)
                    if (t !== null && t <= segLen && t < bestT) {
                        bestT = t
                        bestEnemy = e
                    }
                }
                const rockHit = this.asteroids?.raycast(from, to, 0)
                if (rockHit && rockHit.t < bestT) {
                    const point = from.clone().addScaledVector(dir, rockHit.t)
                    if (pr.kind === 'missile' || pr.kind === 'plasma') this.missileBlast(pr, point)
                    else {
                        this.damageRock(rockHit.rock, pr.damage * pr.mining * (this.config?.stats.miningMult ?? 1), point)
                        hitSpark(this.fx, point, _v3.subVectors(point, rockHit.rock.pos).normalize(), pr.color.clone().multiplyScalar(0.4), 0.8)
                    }
                    consumed = true
                } else if (bestEnemy) {
                    const point = from.clone().addScaledVector(dir, bestT)
                    if (pr.kind === 'missile' || pr.kind === 'plasma') this.missileBlast(pr, point)
                    else damageEnemy(this, bestEnemy, pr.damage, point, pr.source, pr)
                    consumed = true
                }
            }
            if (consumed) continue
            pr.pos.copy(to)
            next.push(pr)

            // Draw
            const speed = pr.vel.length()
            const tail = _v1.copy(pr.pos).addScaledVector(pr.vel, -Math.min(pr.length, speed * 0.03) / Math.max(speed, 1))
            if (pr.kind === 'plasma') {
                this.particles.glow(pr.pos.x, pr.pos.y, pr.pos.z, pr.color, 5, 1)
                this.particles.glow(pr.pos.x, pr.pos.y, pr.pos.z, _c1.setRGB(2, 2, 2), 1.6, 1)
                if (Math.random() < 0.6) this.particles.emit(pr.pos.x, pr.pos.y, pr.pos.z, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, { life: 0.35, size: 2, sizeEnd: 0, color: pr.color, drag: 2 })
            } else if (pr.kind === 'orb') {
                this.particles.glow(pr.pos.x, pr.pos.y, pr.pos.z, pr.color, 3.2 * pr.width)
                // Void orbs: a wide violet halo, shedding motes while they still steer.
                if (pr.curve !== undefined) {
                    this.particles.glow(pr.pos.x, pr.pos.y, pr.pos.z, _c2.copy(pr.color).multiplyScalar(0.16), 5.5 * pr.width, 0.6)
                    if (pr.curve > 0 && Math.random() < 0.5) this.particles.emit(pr.pos.x, pr.pos.y, pr.pos.z, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, VOID_MOTE)
                }
                this.lines.push(tail.x, tail.y, tail.z, pr.pos.x, pr.pos.y, pr.pos.z, pr.color, 0.8, pr.width * 0.3, pr.width * 0.8)
            } else if (pr.kind === 'missile') {
                this.lines.push(tail.x, tail.y, tail.z, pr.pos.x, pr.pos.y, pr.pos.z, _c1.setRGB(0.8, 0.8, 0.85), 0.8, pr.width * 0.6, pr.width)
                this.particles.glow(tail.x, tail.y, tail.z, pr.color, 2.2)
            } else {
                this.lines.push(tail.x, tail.y, tail.z, pr.pos.x, pr.pos.y, pr.pos.z, pr.color, 1, pr.width * 0.4, pr.width)
                if (pr.kind === 'bolt') this.particles.glow(pr.pos.x, pr.pos.y, pr.pos.z, pr.color, pr.width * 5, 0.4)
            }
        }
        this.projectiles = next
    }

    private missileBlast(pr: Projectile, point: THREE.Vector3) {
        const radius = pr.splash || 10
        const mortar = pr.source === 'mortar'
        explosion(this.fx, point, _v1.set(0, 0, 0), pr.hostile ? 1 : mortar ? 2.2 : pr.kind === 'plasma' ? 0.8 : 1.1, pr.hostile ? 0xff4fa8 : mortar ? 0xffa23d : pr.kind === 'plasma' ? 0x7dff6b : 0xff7a3d, false)
        if (mortar) {
            this.rings.spawn(point, radius, 0xffa23d, 0.5, 2.5)
            this.trauma = Math.min(1, this.trauma + Math.max(0, 0.25 - point.distanceTo(this.camera.position) / 800))
        }
        this.audio.play('explosionSmall', { distance: point.distanceTo(this.camera.position), pan: this.panOf(point) })
        if (pr.hostile) {
            const p = this.player
            if (p?.alive && p.pos.distanceTo(point) < radius + p.radius) this.damagePlayer(pr.damage, point, pr.by)
            return
        }
        const skill = pr.source === 'skill' ? this.skills : null
        for (const e of this.enemies) {
            if (!e.alive) continue
            const d = e.pos.distanceTo(point)
            const amount = pr.damage * (1 - 0.5 * d / (radius + e.radius))
            if (d >= radius + e.radius) continue
            if (skill) skill.hit(e, amount, e.pos)
            else damageEnemy(this, e, amount, e.pos, mortar ? 'mortar' : pr.kind === 'plasma' ? 'plasma' : 'missile', pr)
        }
        if (pr.cluster) {
            // Bomblets scatter out of the burst and pop a moment later.
            for (let i = 0; i < pr.cluster; i++) {
                const dir = this.randomDir(1)
                this.projectiles.push({
                    ...pr,
                    pos: point.clone().addScaledVector(dir, 2),
                    vel: dir.multiplyScalar(35 + randomFloat() * 20),
                    life: 0.35 + randomFloat() * 0.25,
                    damage: pr.damage * 0.3,
                    splash: radius * 0.6,
                    homing: null,
                    cluster: 0,
                    width: 0.3,
                    color: pr.color.clone()
                })
            }
        }
        this.asteroids?.query(point, radius, (rock) => {
            if (rock.ore) this.damageRock(rock, pr.damage * pr.mining * (this.config?.stats.miningMult ?? 1), point)
        })
    }

    private updateTracers(dt: number) {
        this.tracers = this.tracers.filter((t) => {
            t.life -= dt
            if (t.life <= 0) return false
            const k = t.life / t.maxLife
            this.lines.pushV(t.a, t.b, t.color, k, t.width * (0.5 + k * 0.5), t.width * k)
            return true
        })
    }

    // ─── Damage ────────────────────────────────────────────────────────────

    /** `cause` names the source for the run's telemetry; left out, the hostile whose turn it is takes the blame. */
    damagePlayer(amount: number, from: THREE.Vector3, cause?: string) {
        const p = this.player
        if (!p?.alive || this.phase !== 'flying' || amount <= 0) return
        if (p.invuln > 0) return
        if (p.abilityTime > 0 && p.ability === 'phase') return
        if (this.skills) amount = this.skills.onPlayerHit(amount, from)
        const stats = this.config!.stats
        if (amount <= 0) return
        this.telemetry.onDamage(amount, cause)
        const local = _v1.subVectors(from, p.pos)
        _q1.copy(p.quat).invert()
        local.applyQuaternion(_q1)
        if (p.abilityTime > 0 && p.ability === 'bulwark') {
            p.shieldBubble.impact(local)
            this.audio.play('shieldHit', { volume: 0.6 })
            return
        }
        // Directional hit marker: blue while the shield soaks it, red once it reaches the hull.
        const onShield = p.shield > amount * 0.5
        const strength = Math.min(1, 0.45 + amount / Math.max(20, this.config!.stats.hull * 0.15))
        const near = this.damageDirs.find(d => d.from.distanceToSquared(from) < 400 && d.shield === onShield)
        if (near) {
            near.life = 1
            near.strength = Math.min(1, Math.max(near.strength, strength) + 0.1)
        } else {
            if (this.damageDirs.length > 8) this.damageDirs.shift()
            this.damageDirs.push({ from: from.clone(), life: 1, shield: onShield, strength })
        }
        let rest = amount
        if (p.shield > 0) {
            const absorbed = Math.min(p.shield, rest)
            p.shield -= absorbed
            if (stats.defenceMods.includes('static') && p.staticCd <= 0) {
                const target = this.nearestHostile(from, 110)
                if (target) {
                    p.staticCd = 0.5
                    this.lightning(p.pos, target.pos, 0xc49bff)
                    damageEnemy(this, target, (absorbed * 0.5 + stats.damageMult * 4) * (target.kind === 'warden' ? 0.3 : 1), target.pos, 'chain')
                }
            }
            if (p.shield <= 0) {
                if (stats.defenceMods.includes('surge') && p.surgeCd <= 0) {
                    p.surgeT = 1.5
                    p.surgeCd = 25
                }
                // Shield collapse: a hard ring and a glassy crack.
                this.rings.spawn(p.pos, voidShip(this.config!.shipId).size * 2.2, 0x6fd8ff, 0.45, 3)
                for (let i = 0; i < 24; i++) {
                    const d = this.randomDir(1).multiplyScalar(30 + Math.random() * 30)
                    this.sparks.emit(p.pos.x, p.pos.y, p.pos.z, d.x + p.vel.x, d.y + p.vel.y, d.z + p.vel.z, 0.4, _c1.set(0x9fe8ff).multiplyScalar(3), 0.12)
                }
                this.audio.play('shieldDown')
                this.telemetry.onShieldBreak()
                this.events.toast('Shields down', 'warn')
            }
            rest -= absorbed
            p.shieldBubble.impact(local)
            this.shieldHurt = Math.min(1, this.shieldHurt + 0.35 + amount / 80)
            this.audio.play('shieldHit', { pan: this.panOf(from) })
            this.trauma = Math.min(1, this.trauma + Math.min(0.25, amount / 80))
        }
        p.shieldDelay = stats.shieldDelay
        if (rest > 0) {
            rest *= 1 - stats.resist
            if (stats.defenceMods.includes('reactive') && p.staticCd <= 0) {
                const target = this.nearestHostile(from, 140)
                if (target) {
                    p.staticCd = 0.5
                    this.lightning(p.pos, target.pos, 0xffc27a)
                    damageEnemy(this, target, (rest * 0.5 + stats.damageMult * 6) * (target.kind === 'warden' ? 0.3 : 1), target.pos, 'chain')
                }
            }
            p.hull -= rest
            this.systems?.onHullHit(rest)
            this.hurt = Math.min(1, this.hurt + 0.25 + rest / 60)
            this.trauma = Math.min(1, this.trauma + Math.min(0.5, 0.15 + rest / 40))
            this.audio.play('hullHit', { pan: this.panOf(from) })
            hitSpark(this.fx, _v2.copy(p.pos).addScaledVector(_v3.subVectors(from, p.pos).normalize(), p.radius), _v3, 0xffa040, 1.5)
            if (p.hull <= 0) this.hullDepleted()
        }
    }

    /** Hull hit zero: Second Chance catches it once per run, otherwise the ship is lost. */
    private hullDepleted() {
        const p = this.player!
        if (!p.alive) return
        if ((this.config!.perks?.revive ?? 0) > 0 && !this.revived) {
            this.revived = true
            p.hull = this.config!.stats.hull * 0.3
            p.invuln = 2
            this.whiteFlash = 0.6
            this.rings.spawn(p.pos, 40, 0xff6b8a, 0.8, 3)
            this.events.banner('Second Chance', 'Emergency systems kept you alive', 'good')
            this.slowMotion(1, 0.3)
            return
        }
        this.killPlayer()
    }

    private killPlayer() {
        const p = this.player!
        p.alive = false
        p.hull = 0
        this.phase = 'dead'
        this.endTimer = 3
        const size = voidShip(this.config!.shipId).size
        explosion(this.fx, p.pos, p.vel, Math.max(2.5, size * 0.5), 0xff8a3d)
        setTimeout(() => {
            if (!this.player) return
            explosion(this.fx, p.pos.clone().add(this.randomDir(1).multiplyScalar(size * 0.4)), p.vel, Math.max(1.8, size * 0.35), 0xffc070)
        }, 180)
        this.whiteFlash = 0.8
        this.trauma = 1
        p.root.visible = false
        p.drones.forEach(d => this.scene.remove(d.group))
        this.audio.play('explosionLarge', { volume: 1.5 })
        this.audio.play('death')
        this.audio.updateEngine(0, false, 0)
        this.endResult = { reason: 'destroyed', haul: {}, lost: { ...this.cargo }, kills: this.kills, wardenKilled: this.wardenKilled, elapsedMs: Math.round(this.elapsed * 1000), skillUses: this.skills?.uses ?? 0, suppliesUsed: { ...this.suppliesUsed }, relics: 0, gearCaches: 0, bonusXp: this.pilotBonusXp, depth: this.depth, carrierKilled: false, tyrantKilled: false, harbingerKilled: false, lore: [], telemetry: (this.telemetry.onDeath(this.elapsed, this.depth, this.zone), this.telemetry.report()), beaconsCaptured: [...(this.beacons?.captured ?? [])], beaconsDefended: [...(this.beacons?.defended ?? [])] }
        this.events.toast('Ship destroyed. The hold is lost.', 'bad')
    }

    nearestHostile(from: THREE.Vector3, range: number) {
        let best: Enemy | null = null
        let bestD = range * range
        for (const e of this.enemies) {
            if (!e.alive || !e.hostile || e.kind === 'mine') continue
            const d = e.pos.distanceToSquared(from)
            if (d < bestD) {
                bestD = d
                best = e
            }
        }
        return best
    }

    // ─── Supplies and relics ───────────────────────────────────────────────

    useSupply(id: string) {
        const p = this.player
        const stats = this.config?.stats
        if (!p?.alive || !stats) return
        if ((this.supplies[id] ?? 0) <= 0) {
            this.audio.play('uiError', { volume: 0.5 })
            return
        }
        this.supplies[id]! -= 1
        this.suppliesUsed[id] = (this.suppliesUsed[id] ?? 0) + 1
        const size = voidShip(this.config!.shipId).size
        if (id === 'nanites') {
            p.repairT = 3
            this.systems?.repairSubsystems()
            this.rings.spawn(p.pos, size * 2, 0x7dff9a, 0.6, 2.5)
            this.audio.play('dock', { volume: 0.6, pitch: 1.4 })
        } else if (id === 'cell') {
            p.shield = Math.min(Math.max(stats.shield, this.skills?.shieldCap ?? 0), p.shield + stats.shield * 0.6)
            p.shieldDelay = 0
            p.shieldBubble.setColor(0x6fd8ff, 2.4)
            this.rings.spawn(p.pos, size * 2.4, 0x6fd8ff, 0.5, 3)
            this.audio.play('shieldHit', { pitch: 0.7, volume: 1.2 })
        } else if (id === 'emp') {
            const radius = 80
            this.rings.spawn(p.pos, radius, 0xc49bff, 0.7, 3)
            this.rings.spawn(p.pos, radius * 0.5, 0xffffff, 0.4, 2)
            this.flashes.flash(p.pos, 0xc49bff, 70, radius * 2)
            this.trauma = Math.min(1, this.trauma + 0.3)
            this.audio.play('blink', { pitch: 0.4, volume: 1.2 })
            for (const e of this.enemies) {
                if (!e.alive || !e.hostile || e.pos.distanceTo(p.pos) > radius + e.radius) continue
                if (e.kind === 'warden') continue
                const stun = e.elite || e.def?.elite ? 0.75 : 1.5
                e.data.stunT = stun
                e.cooldown = Math.max(e.cooldown, stun)
                e.vel.multiplyScalar(0.5)
                for (let i = 0; i < 6; i++) {
                    const d = this.randomDir(1).multiplyScalar(20)
                    this.sparks.emit(e.pos.x, e.pos.y, e.pos.z, d.x, d.y, d.z, 0.5, _c1.set(0xc49bff).multiplyScalar(3), 0.12)
                }
            }
        }
    }

    dropFuel(pos: THREE.Vector3) {
        this.pickups.push({ pos: pos.clone(), vel: this.randomDir(1).multiplyScalar(6), resource: 'core', amount: 0, life: 120, spin: 0, pulled: false, pullTime: 0, fuel: true })
    }

    /** `quiet` skips the toast when the cache lands right on the ship (bounty rewards). */
    dropGear(pos: THREE.Vector3, quiet = false) {
        this.pickups.push({ pos: pos.clone(), vel: this.randomDir(1).multiplyScalar(6), resource: 'core', amount: 0, life: 120, spin: 0, pulled: false, pullTime: 0, gear: true })
        this.rareDropFx(pos, 0xc08bff)
        if (!quiet) this.events.toast('Salvaged gear dropped', 'good')
    }

    /** A rare cache falling out of a wreck: a bell, a ring and a flash of its colour. */
    private rareDropFx(pos: THREE.Vector3, color: number) {
        this.audio.play('rareDrop', { distance: pos.distanceTo(this.camera.position), pan: this.panOf(pos) })
        this.rings.spawn(pos, 7, color, 0.7, 2.6)
        this.rings.spawn(pos, 12, color, 1.1, 1.6)
        for (let i = 0; i < 18; i++) {
            const d = this.randomDir(1).multiplyScalar(6 + Math.random() * 10)
            this.particles.emit(pos.x, pos.y, pos.z, d.x, d.y, d.z, { life: 1.1, size: 0.5, sizeEnd: 0.1, color, intensity: 3, drag: 1.4 })
        }
    }

    get relicMult() {
        return (1 + (this.config?.perks?.relics ?? 0) * 0.4) * this.zoneMods.relics
    }

    itemName(type: string) {
        return voidItemType(type)?.name ?? type
    }

    get zoneName() {
        return voidZone(this.zone).name
    }

    /** What the zone changes. The home zone, before any jump, plays by the plain rules. */
    get zoneMods(): VoidZoneMods {
        return this.depth > 1 ? voidZone(this.zone).mods : VOID_ZONE_PLAIN
    }

    /** Swaps the sky, fog, lights and dust for the zone's own. Called once a zone past a gate is built. */
    private applyZoneLook() {
        const look = this.zoneFx?.look
        if (!look || !this.config) return
        this.sky?.dispose()
        if (this.sky) this.scene.remove(this.sky.group)
        this.sky = createSky(look.palette, 4000 + this.depth * 131 + Math.floor(randomFloat() * 1000), look.sky)
        this.sky.setPixelRatio(this.renderer.getPixelRatio())
        this.scene.add(this.sky.group)
        this.scene.environment = this.setEnvironment(this.sky)
        if (look.fog) this.scene.fog = new THREE.FogExp2(look.fog[0], look.fog[1])
        this.sunLight.position.copy(this.sky.sunDirection).multiplyScalar(100)
        this.sunLight.color.set(look.sun[0])
        this.sunLight.intensity = look.sun[1]
        this.fillLight.color.set(look.fill[0])
        this.fillLight.intensity = look.fill[1]
        RIM_COLOR.value.set(look.palette[2]).lerp(_c1.set(0xffffff), 0.35).multiplyScalar(0.55)
        this.dust.setLook(...look.dust)
    }

    slowMotion(duration: number, scale: number) {
        this.slowT = Math.max(this.slowT, duration)
        this.slowScale = Math.min(this.slowT > duration ? this.slowScale : 1, scale)
        // A 60ms hit-stop has no time to ease into anything; snap it or it is mush.
        if (duration < 0.2) this.timeScale = scale
    }

    /** Kills in quick succession pay more, up to half again. */
    get streakLoot() {
        return 1 + Math.min(0.5, Math.max(0, this.streak - 2) * 0.06)
    }

    toggleCockpit() {
        this.cockpit = !this.cockpit
        if (this.player) this.player.root.visible = !this.cockpit
        this.audio.play('ui')
    }

    traderInReach() {
        return !!this.trader?.alive && !!this.player && this.trader.pos.distanceTo(this.player.pos) < 90
    }

    /** Trades cargo for supplies or fuel at the Free Trader. Takes from the largest stacks first. */
    trade(offer: 'nanites' | 'cell' | 'fuel') {
        const cost = offer === 'fuel' ? 250 : offer === 'nanites' ? 150 : 120
        const tradeable = voidBundleUnits(this.cargo) - (this.cargo.core ?? 0)
        if (tradeable < cost) {
            this.audio.play('uiError')
            return false
        }
        let left = cost
        const next: VoidResourceBundle = { ...this.cargo }
        while (left > 0) {
            const [id, amount] = (Object.entries(next) as [VoidResourceId, number][]).filter(([k]) => k !== 'core').sort((a, b) => b[1] - a[1])[0]!
            const take = Math.min(left, amount)
            next[id] = amount - take
            left -= take
        }
        this.cargo = Object.fromEntries(Object.entries(next).filter(([, v]) => (v ?? 0) > 0))
        if (offer === 'fuel') this.fuel++
        else this.supplies[offer] = (this.supplies[offer] ?? 0) + 1
        this.audio.play('uiConfirm')
        return true
    }

    /** Warp gate: fly in with fuel to choose the next zone. */
    private updateGate(dt: number) {
        const p = this.player
        this.gateCooldown = Math.max(0, this.gateCooldown - dt)
        this.fuelWarn = Math.max(0, this.fuelWarn - dt)
        if (!this.gate || !p?.alive || this.gateOptions || this.gateCooldown > 0) return
        this.gate.spin.rotation.z += dt * 0.4
        const gateDist = p.pos.distanceTo(this.gate.pos)
        // After "Stay", the gate only reopens once you have flown clear of it.
        if (gateDist > 90) this.gateArmed = true
        if (gateDist > 45 || !this.gateArmed) return
        if (this.fuel < 1) {
            if (this.fuelWarn <= 0) {
                this.fuelWarn = 4
                this.events.toast('The gate needs a fuel cell. Crack crates and kill elites to find one.', 'warn')
                this.audio.play('uiError')
            }
            return
        }
        const pool = VOID_ZONES.map(z => z.id).filter(id => id !== this.zone)
        const options: VoidZoneModifier[] = []
        while (options.length < 3 && pool.length) options.push(pool.splice(Math.floor(randomFloat() * pool.length), 1)[0]!)
        this.gateOptions = options
        this.setPaused(true)
        if (document.pointerLockElement) document.exitPointerLock()
        this.events.gate(options)
    }

    /** Leave the gate without jumping. */
    cancelGate() {
        this.gateOptions = null
        this.gateArmed = false
        this.setPaused(false)
    }

    /** Jumps to the next zone of the chain: a new sector, same ship, same hold. */
    jump(zone: VoidZoneModifier) {
        const p = this.player
        if (!p || !this.config || this.fuel < 1) return
        this.fuel--
        this.depth++
        this.zone = zone
        this.telemetry.leaveZone()
        this.telemetry.enterZone(zone, this.elapsed)
        this.gateOptions = null
        this.gateCooldown = 5
        // Tear the old zone down but keep the pilot.
        for (const e of this.enemies) {
            e.alive = false
            disposeTree(e.group)
        }
        for (const c of this.corpses) disposeTree(c.group)
        this.enemies = []
        this.corpses = []
        this.projectiles = []
        this.pickups = []
        this.tracers = []
        for (const t of p.turrets) {
            t.target = null
            t.rock = null
        }
        for (const d of p.drones) {
            d.target = null
            d.rock = null
        }
        for (const s of this.structures) disposeTree(s.group)
        this.structures = []
        if (this.gate) disposeTree(this.gate.group)
        this.gate = null
        for (const prop of this.zoneProps) disposeTree(prop)
        this.zoneProps = []
        this.zoneFx?.dispose()
        this.zoneFx = null
        this.jumpSpool = null
        this.trader = null
        this.hazards?.dispose()
        this.hazards = null
        this.threats.clear()
        this.beacons?.clear()
        this.asteroids?.clear()
        this.systems?.clearZone()
        this.warden = null
        this.wardenSpawned = false
        this.focus = null
        this.focusRock = null
        this.objectives?.onJump()
        this.scene.fog = null
        this.config = { ...this.config, sector: { ...this.config.sector, threat: this.baseThreat * voidDepthThreat(this.depth) } }
        this.sectorEvents = new EventDirector(this)
        this.directorTimer = 45
        this.patrolTimer = 25
        this.generateSector()
        p.pos.set(0, 20, 90)
        // The ship drops out of the tunnel still carrying its speed.
        p.vel.copy(FORWARD).applyQuaternion(p.quat).multiplyScalar(this.config.stats.speed * 1.5)
        p.invuln = Math.max(p.invuln, 2)
        this.camPos.copy(p.pos)
        p.trails.forEach(t => t.reset(p.pos))
        this.warp = 2
        this.whiteFlash = 0.8
        this.fov = 110
        this.audio.play('undock')
        this.setPaused(false)
        // generateSector() built the new zone's atmosphere; the compiler only saw the teardown.
        ;(this.zoneFx as ZoneAtmosphere | null)?.arrive()
        this.events.banner(voidZone(zone).name, `Jump ${this.depth}`, 'info', { id: zone, depth: this.depth })
    }

    /**
     * What the gate dialog calls: the drive spools for a moment, the ship is
     * flung down the gate's throat, and only then does the zone change.
     */
    startJump(zone: VoidZoneModifier) {
        const p = this.player
        if (!p || !this.config || this.fuel < 1 || this.jumpSpool) return
        this.gateOptions = null
        this.gateCooldown = 8
        this.jumpSpool = { zone, t: JUMP_SPOOL }
        p.invuln = Math.max(p.invuln, JUMP_SPOOL + 1)
        this.setPaused(false)
        this.audio.play('charge', { pitch: 0.7, volume: 1.3 })
    }

    /** The spool: streaks converge on the nose, the view stretches, and the ship surges forward. */
    private updateJumpSpool(dt: number) {
        const spool = this.jumpSpool
        const p = this.player
        if (!spool || !p) return
        spool.t -= dt
        const k = 1 - Math.max(0, spool.t) / JUMP_SPOOL
        const fwd = _v1.copy(FORWARD).applyQuaternion(p.quat)
        p.vel.addScaledVector(fwd, (120 + k * 700) * dt)
        this.fov = Math.min(125, this.fov + dt * 60 * k)
        this.trauma = Math.max(this.trauma, k * 0.25)
        this.warpStreaks(dt, k, voidZone(spool.zone).color, true)
        if (spool.t > 0) return
        this.jumpSpool = null
        this.jump(spool.zone)
    }

    dropRelic(pos: THREE.Vector3) {
        this.pickups.push({ pos: pos.clone(), vel: this.randomDir(1).multiplyScalar(6), resource: 'core', amount: 0, life: 120, spin: 0, pulled: false, pullTime: 0, relic: true })
        this.rareDropFx(pos, 0xffd35e)
        this.events.toast('Relic cache dropped', 'good')
    }

    damageRock(rock: Asteroid, amount: number, point: THREE.Vector3) {
        if (!rock.alive || !rock.ore || !this.asteroids) return
        rock.hp -= amount
        this.asteroids.hit(rock)
        if (Math.random() < 0.25) this.audio.play('rockHit', { distance: point.distanceTo(this.camera.position), pan: this.panOf(point), volume: 0.6 })
        const color = ORE_GLOW[rock.ore] ?? 0xffffff
        if (Math.random() < 0.35) {
            const n = _v1.subVectors(point, rock.pos).normalize()
            this.particles.emit(point.x, point.y, point.z, n.x * 8, n.y * 8, n.z * 8, { life: 0.5, size: 1.2, sizeEnd: 0, color, intensity: 2 })
            this.smoke.emit(point.x, point.y, point.z, n.x * 4, n.y * 4, n.z * 4, { life: 1, size: 1, sizeEnd: 4, color: 0x3a3632, alpha: 0.35, drag: 1 })
        }
        // Every quarter of the rock chipped away knocks a little ore loose.
        const chips = Math.floor((1 - Math.max(0, rock.hp) / rock.maxHp) * 4)
        while (rock.chips < chips && rock.chips < 3) {
            rock.chips++
            this.dropPickup(rock.ore, VOID_UNIT_SCALE, point, _v1.subVectors(point, rock.pos).normalize().multiplyScalar(12))
        }
        if (rock.hp <= 0) this.breakRock(rock)
    }

    private breakRock(rock: Asteroid) {
        const ore = rock.ore!
        const color = ORE_GLOW[ore] ?? 0xffffff
        const tier = this.config!.sector.tier
        const zoneOre = this.zoneMods.ore
        const yieldUnits = Math.max(2, Math.round(rock.radius * 0.8 * (0.8 + randomFloat() * 0.4) * this.config!.stats.miningMult * (1 + (tier - 1) * 0.12) * zoneOre * (this.beacons?.oreMult(rock.pos) ?? 1) * voidDepthLoot(this.depth) * VOID_UNIT_SCALE))
        const stacks = Math.min(12, Math.ceil(yieldUnits / 3))
        let left = yieldUnits
        for (let i = 0; i < stacks; i++) {
            const amount = i === stacks - 1 ? left : Math.max(1, Math.floor(yieldUnits / stacks))
            left -= amount
            if (amount <= 0) break
            const dir = this.randomDir(1)
            this.dropPickup(ore, amount, rock.pos.clone().addScaledVector(dir, rock.radius * 0.5), dir.multiplyScalar(10 + Math.random() * 12))
        }
        const size = rock.radius / 5
        this.rings.spawn(rock.pos, rock.radius * 2.5, color, 0.6, 1.6)
        this.debris.spawn(rock.pos, _v1.set(0, 0, 0), Math.round(6 + rock.radius), rock.radius * 0.6, rock.radius * 1.2, Math.random)
        for (let i = 0; i < 20 + rock.radius * 2; i++) {
            const d = this.randomDir(1).multiplyScalar(rock.radius * (1 + Math.random() * 2))
            this.smoke.emit(rock.pos.x, rock.pos.y, rock.pos.z, d.x, d.y, d.z, { life: 1.5 + Math.random(), size: size * 2, sizeEnd: size * 7, color: 0x46403a, alpha: 0.5, drag: 1.4 })
        }
        for (let i = 0; i < 25; i++) {
            const d = this.randomDir(1).multiplyScalar(30 + Math.random() * 40)
            this.sparks.emit(rock.pos.x, rock.pos.y, rock.pos.z, d.x, d.y, d.z, 0.5 + Math.random() * 0.4, _c1.set(color).multiplyScalar(3), 0.2)
        }
        this.flashes.flash(rock.pos, color, 25, rock.radius * 6)
        this.audio.play('rockBreak', { distance: rock.pos.distanceTo(this.camera.position) * 0.6, pan: this.panOf(rock.pos) })
        this.asteroids!.remove(rock)
        if (this.focusRock === rock) this.focusRock = null
        this.objectives?.onRockBroken()
        this.telemetry.onRockMined()
        this.hazards?.onRockBroken(rock.pos)
    }

    dropLoot(resource: VoidResourceId, min: number, max: number, pos: THREE.Vector3, chance = 1) {
        if (randomFloat() >= chance) return
        const salvage = resource === 'scrap' || resource === 'alloy'
        const mult = dropMult(this.config!.sector.tier) * voidDepthLoot(this.depth)
            * (salvage ? this.zoneMods.salvage : 1) * (salvage ? 1 + (this.config!.perks?.salvager ?? 0) * 0.15 : 1)
        const scale = resource === 'core' ? 1 : mult * VOID_UNIT_SCALE
        const amount = Math.max(1, Math.round((min + randomFloat() * (max - min)) * scale))
        const stacks = Math.min(6, Math.ceil(amount / (resource === 'core' ? 1 : 4)))
        let left = amount
        for (let i = 0; i < stacks; i++) {
            const n = i === stacks - 1 ? left : Math.floor(amount / stacks)
            left -= n
            if (n > 0) this.dropPickup(resource, n, pos, this.randomDir(1).multiplyScalar(8 + Math.random() * 14))
        }
    }

    dropPickup(resource: VoidResourceId, amount: number, pos: THREE.Vector3, vel: THREE.Vector3) {
        if (this.pickups.length > 1400) return
        this.pickups.push({ pos: pos.clone(), vel: vel.clone(), resource, amount, life: 90, spin: Math.random() * 6, pulled: false, pullTime: 0 })
    }

    addFloat(pos: THREE.Vector3, text: string, color: string, size = 14) {
        if (this.floats.length > 60) this.floats.shift()
        this.floats.push({ pos: pos.clone(), text, color, life: 0.9, maxLife: 0.9, size })
    }

    panOf(pos: THREE.Vector3) {
        const right = _v1.set(1, 0, 0).applyQuaternion(this.camera.quaternion)
        const to = _v2.subVectors(pos, this.camera.position).normalize()
        return THREE.MathUtils.clamp(to.dot(right), -1, 1) * 0.8
    }

    // ─── Pickups ───────────────────────────────────────────────────────────

    /** Adds to the stacked "+N Ferrite" popup above the ship, merging repeat pickups. */
    private lootPopup(resource: VoidResourceId, amount: number) {
        const existing = this.lootPopups.find(l => l.resource === resource)
        if (existing) {
            existing.amount += amount
            existing.life = 1.6
            existing.pop = 1
        } else {
            if (this.lootPopups.length >= 5) this.lootPopups.shift()
            this.lootPopups.push({ resource, amount, life: 1.6, pop: 1 })
        }
    }

    private updatePickups(dt: number) {
        const p = this.player
        const stats = this.config!.stats
        const cap = stats.cargo
        let units = voidBundleUnits(this.cargo)
        const next: Pickup[] = []
        const mesh = this.pickupMesh
        let n = 0
        this.cargoFullTimer -= dt
        this.pickupCombo = Math.max(0, this.pickupCombo - dt * 1.2)
        this.lootPopups = this.lootPopups.filter((l) => {
            l.life -= dt
            l.pop = Math.max(0, l.pop - dt * 5)
            return l.life > 0
        })
        for (const pk of this.pickups) {
            pk.life -= dt
            if (pk.life <= 0) continue
            pk.spin += dt * (pk.pulled ? 12 : 2)
            if (p?.alive && this.phase === 'flying') {
                const d = pk.pos.distanceTo(p.pos)
                const full = units >= cap && !pk.relic && !pk.fuel && !pk.gear
                if (!full && !pk.pulled && d < stats.magnet * (pk.relic ? 1.6 : 1)) {
                    pk.pulled = true
                    pk.pullTime = 0
                    // A little hop away first, so the snap back toward the ship reads.
                    pk.vel.addScaledVector(_v1.subVectors(pk.pos, p.pos).normalize(), 14)
                }
                if (full && pk.pulled) pk.pulled = false
                if (pk.pulled) {
                    pk.pullTime += dt
                    // Ease-in homing: slow for a beat, then whips into the hull.
                    const speed = 30 + pk.pullTime * pk.pullTime * 1600 + p.vel.length()
                    const want = _v1.subVectors(p.pos, pk.pos).normalize().multiplyScalar(speed)
                    pk.vel.lerp(want, 1 - Math.exp(-(6 + pk.pullTime * 30) * dt))
                } else {
                    pk.vel.multiplyScalar(Math.exp(-1.2 * dt))
                }
                const reach = p.radius + 2.5 + pk.vel.length() * dt
                if (d < reach && pk.gear) {
                    this.gearCaches++
                    this.audio.play('gear')
                    this.flashes.flash(p.pos, 0xc38bff, 40, 60)
                    this.rings.spawn(p.pos, 16, 0xc38bff, 0.6, 3)
                    this.events.toast('Salvaged gear secured. Extract to open it.', 'good')
                    continue
                }
                if (d < reach && pk.fuel) {
                    this.fuel++
                    this.audio.play('pickup', { pitch: 0.7, volume: 1 })
                    this.rings.spawn(p.pos, 10, 0xffa23d, 0.4, 2.5)
                    this.events.toast(`Fuel cell (${this.fuel})`, 'good')
                    continue
                }
                if (d < reach && pk.relic) {
                    this.relics++
                    this.audio.play('levelUp', { volume: 0.9 })
                    this.flashes.flash(p.pos, 0xffd27a, 40, 60)
                    this.rings.spawn(p.pos, 14, 0xffd27a, 0.6, 3)
                    this.events.banner('Relic cache', 'Bank it at a dock to reveal the mod inside', 'good')
                    continue
                }
                if (d < reach) {
                    if (!full) {
                        const take = Math.min(pk.amount, cap - units)
                        this.cargo[pk.resource] = (this.cargo[pk.resource] ?? 0) + take
                        units += take
                        pk.amount -= take
                        const res = voidResource(pk.resource)
                        this.pickupCombo = Math.min(12, this.pickupCombo + 1)
                        // Each pickup in a quick run climbs the scale.
                        this.audio.play('pickup', { pitch: Math.pow(2, Math.floor(this.pickupCombo) / 12) })
                        this.lootPopup(pk.resource, take)
                        this.cargoPulse = 1
                        const at = _v1.copy(p.pos)
                        this.particles.emit(at.x, at.y, at.z, 0, 0, 0, { life: 0.18, size: 1.6 + Math.min(3, take * 0.5), sizeEnd: 0, color: res.color, intensity: 1.6, drag: 0 })
                        for (let i = 0; i < 4; i++) {
                            const dir = this.randomDir(1).multiplyScalar(14 + Math.random() * 14)
                            this.sparks.emit(at.x, at.y, at.z, dir.x + p.vel.x, dir.y + p.vel.y, dir.z + p.vel.z, 0.22, _c1.set(res.color).multiplyScalar(2), 0.08)
                        }
                        if (pk.amount <= 0) continue
                    } else if (this.cargoFullTimer <= 0) {
                        this.cargoFullTimer = 4
                        this.audio.play('cargoFull')
                        this.events.toast('Cargo hold full. Dock to bank it.', 'warn')
                    }
                }
            } else {
                pk.vel.multiplyScalar(Math.exp(-1.2 * dt))
            }
            pk.pos.addScaledVector(pk.vel, dt)
            next.push(pk)
            if (n < 1500 && pk.pos.distanceToSquared(this.camera.position) < 900 * 900) {
                const res = pk.relic ? { color: 0xffd27a } : pk.gear ? { color: 0xc38bff } : pk.fuel ? { color: 0xffa23d } : voidResource(pk.resource)
                const size = pk.relic || pk.gear ? 2.4 : pk.fuel ? 1.8 : 0.8 + Math.min(1.4, Math.sqrt(pk.amount / (pk.resource === 'core' ? 1 : VOID_UNIT_SCALE)) * 0.35)
                // Idle loot bobs; flying loot stretches along its path.
                const bob = pk.pulled ? 0 : Math.sin(this.time * 3 + pk.spin) * 0.25
                _q1.setFromEuler(_e1.set(pk.spin * 0.7, pk.spin, 0))
                _m1.compose(_v2.copy(pk.pos).setY(pk.pos.y + bob), _q1, _v1.set(size, size * 1.3, size))
                mesh.setMatrixAt(n, _m1)
                mesh.setColorAt(n, _c1.set(res.color).multiplyScalar(pk.pulled ? 3.2 : 2.2))
                const fade = Math.min(1, pk.life / 5)
                const glint = pk.pulled ? 1.4 : 0.8 + Math.max(0, Math.sin(this.time * 2.2 + pk.spin * 3)) * 0.8
                this.particles.glow(pk.pos.x, pk.pos.y + bob, pk.pos.z, _c1.set(res.color).multiplyScalar(0.9 * fade * glint), 3.2 * size, 0.6)
                if (pk.pulled) {
                    const tail = _v1.copy(pk.pos).addScaledVector(pk.vel, -0.05)
                    this.lines.push(tail.x, tail.y, tail.z, pk.pos.x, pk.pos.y, pk.pos.z, _c1.set(res.color).multiplyScalar(2.5), 0.9, size * 0.12, size * 0.35)
                }
                if (pk.relic || pk.gear || pk.resource === 'core' || pk.resource === 'alloy') {
                    // Rare salvage throws a light pillar so it is never missed in a fight.
                    const hgt = pk.relic || pk.gear ? 70 : pk.resource === 'core' ? 40 : 18
                    const pulse = 0.6 + Math.sin(this.time * 4 + pk.spin) * 0.25
                    this.lines.push(pk.pos.x, pk.pos.y - hgt * 0.2, pk.pos.z, pk.pos.x, pk.pos.y + hgt, pk.pos.z, _c1.set(res.color).multiplyScalar(2), pulse * fade, 0.5, 0.05)
                }
                n++
            }
        }
        this.cargoPulse = Math.max(0, this.cargoPulse - dt * 3)
        mesh.count = n
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        this.pickups = next
    }

    // ─── Docking, director, ending ────────────────────────────────────────

    dockTarget(): { structure: Structure, dist: number } | null {
        const p = this.player
        if (!p) return null
        let best: { structure: Structure, dist: number } | null = null
        for (const s of this.structures) {
            if (s.dockRadius <= 0) continue
            const dist = s.pos.distanceTo(p.pos)
            if (!best || dist < best.dist) best = { structure: s, dist }
        }
        return best
    }

    private updateDocking(dt: number) {
        const p = this.player!
        const near = this.dockTarget()
        const inZone = near && near.dist < near.structure.dockRadius + 25
        if (inZone && this.keys.has('KeyF')) {
            this.dockHold += dt
            const s = near.structure
            this.lines.pushV(s.pos, p.pos, _c1.set(0x3dffb0).multiplyScalar(1.5), 0.3 + Math.random() * 0.4, 0.6, 0.3)
            if (this.dockHold >= 1.5) this.extract()
        } else {
            this.dockHold = Math.max(0, this.dockHold - dt * 2)
        }
    }

    private extract() {
        const p = this.player!
        this.phase = 'docking'
        this.endTimer = 2.2
        this.dockHold = 0
        this.audio.play('dock')
        this.whiteFlash = 0.4
        this.rings.spawn(p.pos, 30, 0x3dffb0, 0.9, 2.5)
        this.rings.spawn(p.pos, 60, 0xffffff, 1.2, 1, undefined, 0.04)
        this.endResult = {
            reason: 'extracted',
            haul: { ...this.cargo },
            kills: this.kills,
            wardenKilled: this.wardenKilled,
            elapsedMs: Math.round(this.elapsed * 1000),
            skillUses: this.skills?.uses ?? 0,
            suppliesUsed: { ...this.suppliesUsed },
            relics: this.relics,
            gearCaches: this.gearCaches,
            bonusXp: this.pilotBonusXp,
            depth: this.depth,
            carrierKilled: !!this.systems?.carrierKilled,
            tyrantKilled: !!this.systems?.tyrantKilled,
            harbingerKilled: !!this.systems?.harbingerKilled,
            telemetry: this.telemetry.report(),
            lore: [...(this.systems?.loreFound ?? [])],
            beaconsCaptured: [...(this.beacons?.captured ?? [])],
            beaconsDefended: [...(this.beacons?.defended ?? [])]
        }
        if (document.pointerLockElement) document.exitPointerLock()
    }

    private updateEnding(dt: number) {
        const p = this.player!
        this.endTimer -= dt
        if (this.phase === 'docking') {
            // Warp out: stretch forward and vanish in a flash.
            const fwd = _v1.copy(FORWARD).applyQuaternion(p.quat)
            p.vel.addScaledVector(fwd, dt * 900 * Math.max(0, 1.6 - this.endTimer))
            p.pos.addScaledVector(p.vel, dt)
            this.fov = Math.min(110, this.fov + dt * 20)
            if (this.endTimer < 0.5 && this.endTimer > 0) this.whiteFlash = Math.max(this.whiteFlash, (0.5 - this.endTimer) * 2.4)
        }
        if (this.endTimer <= 0 && this.endResult) {
            const result = this.endResult
            this.endResult = null
            this.audio.stopEngine()
            // Freeze the frame behind the debrief; the warp flash fades to the scene.
            if (this.phase === 'docking') {
                p.root.visible = false
                p.drones.forEach(d => (d.group.visible = false))
            }
            this.events.end(result)
        }
    }

    /** 0-5 stars, the way the pilot sees it. */
    get wanted() {
        return Math.min(5, Math.floor(this.heat / HEAT_PER_STAR))
    }

    /** Calls out a wanted level as it climbs, and the moment it clears. */
    private announceWanted() {
        const now = this.wanted
        if (now === this.wantedShown) return
        if (now > this.wantedShown) {
            // At four stars the wings arrive faster than the heat can bleed off,
            // so in practice there is no shaking them: dock or die.
            if (now === 4) this.events.banner('Hunted', 'They are coming faster than you can lose them. Bank your hold or die out here.', 'bad')
            else this.events.toast(`Wanted level ${now}`, now > 4 ? 'bad' : 'warn')
            this.audio.play(now >= 4 ? 'wardenAlert' : 'warning', { pitch: 1 + now * 0.06 })
        } else if (now === 0) {
            this.events.toast('You lost them', 'good')
        }
        this.wantedShown = now
    }

    private updateDirector(dt: number) {
        const p = this.player!
        const minutes = this.elapsed / 60
        // The first eight minutes are the run: long enough to cross the sector,
        // find the warden and fight it. Pressure only builds after that.
        const ramp = Math.max(0, minutes - DIRECTOR_GRACE_MINUTES)
        // Heat bleeds off on its own, and twice as fast once you have shaken
        // everyone off your tail: breaking away really does lose them.
        const hunted = this.enemies.some(e => e.alive && e.hostile && e.aggro && e.pos.distanceTo(p.pos) < 600)
        // Capped, or a long spree would take minutes of hiding before the first star drops.
        this.heat = Math.max(0, Math.min(HEAT_MAX, this.heat) - dt * (hunted ? 0.18 : 0.36))
        this.threat = Math.min(1, this.heat / HEAT_MAX)
        this.announceWanted()
        this.telemetry.sample(p.hull / this.config!.stats.hull, this.wanted)
        this.directorTimer -= dt
        if (this.objectives?.suppressWaves) this.directorTimer = Math.max(this.directorTimer, 20)
        // A boss fight is the fight; wings stop piling in on top of it.
        const bossFight = this.enemies.some(e => e.alive && (e.kind === 'warden' || e.kind === 'mothership') && e.pos.distanceTo(p.pos) < 700)
        if (bossFight || this.beacons?.fighting) this.directorTimer = Math.max(this.directorTimer, 25)
        if (this.directorTimer <= 0) {
            // Waves come a little faster and a little heavier the longer a run
            // runs, and out past the charted edge they come heavier still.
            const far = p.pos.length() > SECTOR_RADIUS ? 1 : 0
            const heat = Math.min(HEAT_MAX, this.heat)
            this.directorTimer = Math.max(30, 100 - heat * 1.5 - ramp * 4 - far * 12) * (0.8 + randomFloat() * 0.4)
            // Every jump past the second adds to the hunt.
            const wings = Math.min(5, 1 + Math.floor(heat / 15) + Math.floor(ramp / 6) + far + Math.floor((this.depth - 1) / 2))
            const dir = this.randomDir(0.5)
            spawnPatrol(this, p.pos.clone().addScaledVector(dir, 260 + randomFloat() * 80), true, wings)
            this.events.toast(far ? 'Deep space patrol inbound' : 'Hostile wing inbound', 'warn')
            this.audio.play('warning')
        }
        this.patrolTimer -= dt
        if (this.patrolTimer <= 0) {
            this.patrolTimer = 16 / this.zoneMods.patrols
            // The hidden carrier's group never crowds out ordinary patrols.
            const alive = this.enemies.filter(e => e.alive && e.hostile && e.kind !== 'sentinel' && e.kind !== 'mine' && !e.data.carrier).length
            if (alive < (26 + this.config!.sector.tier * 3) * this.zoneMods.patrols * depthPatrolMult(this.depth)) {
                const pos = this.randomDir(0.3).multiplyScalar(this.rand(700, SECTOR_RADIUS * 1.4))
                if (pos.distanceTo(p.pos) > 500) spawnPatrol(this, pos, false, randomFloat() < depthExtraWing(this.depth) ? 1 : 0)
            }
        }
        if (!this.wardenSpawned && !this.objectives?.suppressWaves && p.pos.distanceTo(this.lair) < WARDEN_TRIGGER_RANGE) {
            this.wardenSpawned = true
            spawnWarden(this)
        }
    }

    // ─── Visuals: ship, camera ─────────────────────────────────────────────

    /** Holographic rings that mark where docking works. */
    private drawDockZones() {
        const p = this.player
        if (!p) return
        for (const s of this.structures) {
            if (s.dockRadius <= 0) continue
            const d = s.pos.distanceTo(p.pos)
            if (d > 900) continue
            const r = s.dockRadius + 25
            const inside = d < r
            const pulse = 0.5 + Math.sin(this.time * 3) * 0.2
            const color = _c1.set(0x3dffb0).multiplyScalar(inside ? 2.2 : 1.2)
            const alpha = (inside ? 0.9 : 0.45 * pulse) * Math.min(1, (900 - d) / 300)
            const y = s.pos.y + (s.kind === 'station' ? -8 : 0)
            const n = 64
            for (let i = 0; i < n; i++) {
                if (i % 4 === 3) continue
                const a0 = (i / n) * Math.PI * 2 + this.time * 0.1
                const a1 = ((i + 1) / n) * Math.PI * 2 + this.time * 0.1
                this.lines.push(s.pos.x + Math.cos(a0) * r, y, s.pos.z + Math.sin(a0) * r, s.pos.x + Math.cos(a1) * r, y, s.pos.z + Math.sin(a1) * r, color, alpha, 0.5)
            }
        }
    }

    /** Arrival: streaks rushing past the camera while the FOV settles. */
    private updateWarp(dt: number) {
        if (this.warp <= 0) return
        this.warp -= dt
        const k = Math.max(0, this.warp / 1.6)
        this.warpStreaks(dt, Math.min(1, k), this.depth > 1 ? voidZone(this.zone).color : this.config!.sector.palette[2], this.depth > 1)
    }

    /**
     * The jump tunnel: streaks down the view axis, and for a gate jump a run of
     * rings in the zone's colour that open out past the canopy. `k` is 0..1.
     */
    private warpStreaks(dt: number, k: number, tint: number, tunnel: boolean) {
        const cam = this.camera.position
        const fwd = _v1.copy(FORWARD).applyQuaternion(this.camera.quaternion)
        const right = _v2.set(1, 0, 0).applyQuaternion(this.camera.quaternion)
        const up = _v3.set(0, 1, 0).applyQuaternion(this.camera.quaternion)
        const color = _c1.set(tint).lerp(_c2.set(0xffffff), 0.4).multiplyScalar(2.5)
        const count = tunnel ? 90 : 60
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2
            const r = 6 + Math.random() * 40
            const ahead = 20 + Math.random() * 160
            const x = cam.x + fwd.x * ahead + (right.x * Math.cos(a) + up.x * Math.sin(a)) * r
            const y = cam.y + fwd.y * ahead + (right.y * Math.cos(a) + up.y * Math.sin(a)) * r
            const z = cam.z + fwd.z * ahead + (right.z * Math.cos(a) + up.z * Math.sin(a)) * r
            const len = 30 + k * 120
            this.lines.push(x, y, z, x - fwd.x * len, y - fwd.y * len, z - fwd.z * len, color, k * k * 0.8, 0.12)
        }
        if (!tunnel) return
        this.warpRing -= dt
        if (this.warpRing > 0 || k < 0.15) return
        this.warpRing = 0.09
        _v4.copy(cam).addScaledVector(fwd, 150)
        this.rings.spawn(_v4, 120 + Math.random() * 60, tint, 0.55, 0.7 + k * 1.3, fwd, 0.05)
    }


    private updateShipVisuals(dt: number) {
        const p = this.player!
        const stats = this.config!.stats
        if (p.alive && !this.cockpit) {
            // Damage you can see: smoke below half hull, fire and sparks when critical or a system is down.
            const frac = p.hull / stats.hull
            const size = voidShip(this.config!.shipId).size
            if (frac < 0.5 && Math.random() < dt * (frac < 0.25 ? 20 : 8)) {
                this.smoke.emit(p.pos.x, p.pos.y, p.pos.z, p.vel.x * 0.4, p.vel.y * 0.4 + 2, p.vel.z * 0.4, { life: 1, size: size * 0.25, sizeEnd: size * 0.9, color: 0x2e2a28, alpha: 0.4, drag: 1 })
            }
            if ((frac < 0.25 || (this.systems?.disabled.engines ?? 0) > 0) && Math.random() < dt * 12) {
                const d = this.randomDir(1).multiplyScalar(size * 0.4)
                this.particles.emit(p.pos.x + d.x, p.pos.y + d.y, p.pos.z + d.z, p.vel.x, p.vel.y + 3, p.vel.z, { life: 0.35, size: size * 0.18, sizeEnd: 0, color: 0xff7a2e, colorEnd: 0xff2a0a, intensity: 2.2, drag: 0.5 })
            }
            if (this.systems?.subsystemsDown && Math.random() < dt * 8) {
                const d = this.randomDir(1).multiplyScalar(size * 0.35)
                this.sparks.emit(p.pos.x + d.x, p.pos.y + d.y, p.pos.z + d.z, d.x * 20, d.y * 20, d.z * 20, 0.3, _c1.set(0x9fe8ff).multiplyScalar(3), 0.08)
            }
        }
        const throttle = Math.min(1.6, p.vel.length() / stats.speed)
        const power = !p.alive ? 0 : 0.35 + throttle * 0.5 + (p.boosting ? 0.5 : 0)
        for (const f of p.flames) {
            f.material.uniforms.uTime!.value = this.time
            f.material.uniforms.uPower!.value = power
            f.mesh.scale.set(1, 1, 0.6 + power * 1.1)
        }
        p.root.updateMatrixWorld(true)
        p.model.engines.forEach((e, i) => {
            const world = _v1.copy(e.position).applyMatrix4(p.model.group.matrixWorld)
            const trail = p.trails[i]!
            trail.update(dt, world)
            // From the chase camera a trail points straight into the lens and projects
            // as a long streak down the screen, so only draw it when seen side-on.
            const side = 1 - Math.abs(_v2.copy(FORWARD).applyQuaternion(p.quat).dot(_v3.copy(FORWARD).applyQuaternion(this.camera.quaternion)))
            if (p.alive && side > 0.25) trail.draw(this.lines, world, Math.min(0.6, 0.12 + power * 0.3) * Math.min(1, (side - 0.25) * 2))
            if (p.alive) this.particles.glow(world.x, world.y, world.z, _c1.set(shipGlow(this.config!.shipId, this.config!.shipTier)).multiplyScalar(0.35 * power), e.radius * 3, 0.4)
        })
        // Bank into turns: roll the model (not the physics body) by yaw rate.
        const localAngVel = _v2.copy(FORWARD).applyQuaternion(this.aimQuat)
        _q1.copy(p.quat).invert()
        localAngVel.applyQuaternion(_q1)
        // Fighters throw themselves into a turn; a capital ship barely leans, and takes its time doing it.
        const lean = 1 - this.heft * 0.8
        const leanRate = 1 - Math.exp(-(5 - this.heft * 3.5) * dt)
        const bank = THREE.MathUtils.clamp(-localAngVel.x * 1.6, -0.7, 0.7) * lean
        p.model.group.rotation.z = THREE.MathUtils.lerp(p.model.group.rotation.z, bank, leanRate)
        p.model.group.rotation.x = THREE.MathUtils.lerp(p.model.group.rotation.x, THREE.MathUtils.clamp(localAngVel.y * 0.6, -0.3, 0.3) * lean, leanRate)

        const phase = p.abilityTime > 0 && p.ability === 'phase'
        const bulwark = p.abilityTime > 0 && p.ability === 'bulwark'
        p.shieldBubble.strength = bulwark ? 0.9 : phase ? 0.6 : 0
        p.shieldBubble.update(dt, this.time, 0)
        p.model.group.visible = p.alive && !(phase && Math.sin(this.time * 40) > 0.3)

        this.playerLight.position.copy(p.pos).addScaledVector(_v1.copy(FORWARD).applyQuaternion(p.quat), voidShip(this.config!.shipId).size)
        this.playerLight.intensity = p.alive ? 30 + power * 30 : 0
        this.playerLight.color.set(shipGlow(this.config!.shipId, this.config!.shipTier))

        if (p.hull / stats.hull < 0.3 && p.alive) {
            this.lowHullTimer -= dt
            if (this.lowHullTimer <= 0) {
                this.lowHullTimer = 1.2
                this.audio.play('lowHull')
            }
            if (Math.random() < dt * 20) {
                this.smoke.emit(p.pos.x, p.pos.y, p.pos.z, p.vel.x * 0.2, p.vel.y * 0.2 + 3, p.vel.z * 0.2, { life: 1.2, size: 1, sizeEnd: 4, color: 0x222222, alpha: 0.6, drag: 1 })
                if (Math.random() < 0.3) this.particles.emit(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, { life: 0.3, size: 1.5, sizeEnd: 0, color: 0xff7a2e, intensity: 3 })
            }
        }
    }

    private updateCamera(dt: number) {
        const p = this.player!
        const size = voidShip(this.config!.shipId).size
        const stats = this.config!.stats
        // Big hulls pull the camera in close and high, so the deck runs out ahead of you and fills the lower screen.
        const h = this.heft
        const back = size * (1.55 - h * CAM.back) + 4.4
        const up = size * (0.66 - h * CAM.up) + 1.2
        const speedFrac = Math.min(2, p.vel.length() / stats.speed)
        const targetFov = 66 + (speedFrac * 5 + (p.boosting ? 9 : 0)) * (1 - h * 0.5)
        if (this.phase !== 'docking') this.fov = THREE.MathUtils.lerp(this.fov, targetFov, 1 - Math.exp(-3 * dt))
        this.camera.fov = this.fov
        this.camera.updateProjectionMatrix()

        if (this.phase === 'dead') {
            // Drift back from the wreck.
            this.camPos.addScaledVector(_v1.subVectors(this.camPos, p.pos).normalize(), dt * 12)
            this.camera.position.copy(this.camPos)
            this.camera.lookAt(p.pos)
        } else {
            // Rotation tracks the aim tightly so the crosshair stays put on screen; position still lags for speed.
            this.camQuat.slerp(this.aimQuat, 1 - Math.exp(-45 * dt))
            const offset = _v1.set(0, up, back).applyQuaternion(this.camQuat)
            const desired = _v2.copy(p.pos).add(offset)
            // Lag a little behind the ship so speed reads, but never too far.
            this.camPos.lerp(desired, 1 - Math.exp(-(this.phase === 'docking' ? 2 : 11 - h * 5) * dt))
            const lag = this.camPos.distanceTo(desired)
            if (lag > back * 0.8) this.camPos.lerp(desired, 1 - (back * 0.8) / lag)
            this.camera.position.copy(this.camPos)
            this.camera.quaternion.copy(this.camQuat)
            if (this.cockpit && p.alive) {
                // Cockpit view: sit at the canopy and look down the aim.
                const size = voidShip(this.config!.shipId).size
                this.camera.position.copy(p.pos).add(_v1.set(0, size * 0.12, -size * 0.25).applyQuaternion(p.quat))
                this.camera.quaternion.copy(this.aimQuat)
                this.camPos.copy(desired)
            }
        }
        if (this.trauma > 0) {
            // The same hit rattles a scout far more than a dreadnought.
            const s = this.trauma * this.trauma * (1 - this.heft * 0.45)
            this.camera.position.x += (Math.random() - 0.5) * s * 1.6
            this.camera.position.y += (Math.random() - 0.5) * s * 1.6
            this.camera.rotateZ((Math.random() - 0.5) * s * 0.04)
        }
        this.camera.updateMatrixWorld()
        const pr = this.renderer.getPixelRatio()
        this.particles.setViewportHeight(this.height * pr, this.camera.fov)
        this.smoke.setViewportHeight(this.height * pr, this.camera.fov)
        this.lines.setViewportHeight(this.height * pr, this.camera.fov)
        this.dust.setViewport(this.height * pr, this.camera.fov, pr)
    }

    // ─── HUD ───────────────────────────────────────────────────────────────

    private hudState(): HudState {
        const p = this.player!
        const cfg = this.config!
        const def = p.ability ? VOID_ABILITIES[p.ability] : null
        const near = this.dockTarget()
        const inZone = !!near && near.dist < near.structure.dockRadius + 25
        let target: HudState['target'] = null
        if (this.focus?.alive) {
            target = { name: this.focus.name, hp: Math.max(0, this.focus.hp), maxHp: this.focus.maxHp, shield: this.focus.data.shield ?? 0, shieldMax: this.focus.data.shieldMax ?? 0, kind: this.focus.kind === 'crate' ? 'crate' : 'enemy', detail: this.focus.elite ? 'Elite' : '', dist: this.focus.pos.distanceTo(p.pos), hostile: this.focus.hostile }
        } else if (this.focusRock?.alive && this.focusRock.ore) {
            target = { name: `${voidResource(this.focusRock.ore).name} deposit`, hp: Math.max(0, this.focusRock.hp), maxHp: this.focusRock.maxHp, shield: 0, shieldMax: 0, kind: 'rock', detail: '', dist: this.focusRock.pos.distanceTo(p.pos), hostile: false }
        }
        // The nearest capital that is awake takes the boss bar.
        const carrier = this.warden?.alive ? null : this.enemies.filter(e => e.alive && e.kind === 'mothership' && e.aggro && e.pos.distanceToSquared(p.pos) < 1500 * 1500).sort((a, b) => a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos))[0]
        const capital = carrier ? capitalOf(carrier)?.spec : undefined
        return {
            phase: this.phase,
            paused: this.paused,
            locked: this.locked,
            hull: Math.max(0, p.hull),
            maxHull: cfg.stats.hull,
            shield: Math.max(0, p.shield),
            maxShield: Math.max(cfg.stats.shield, this.skills?.shieldCap ?? 0),
            energy: p.energy,
            boosting: p.boosting,
            speed: p.vel.length(),
            cargo: { ...this.cargo },
            cargoUnits: voidBundleUnits(this.cargo),
            cargoCap: cfg.stats.cargo,
            abilityName: def?.name ?? null,
            abilityReady: def && def.cooldown > 0 ? 1 - p.abilityCooldown / def.cooldown : 1,
            abilityActive: p.abilityTime > 0,
            kills: this.kills,
            elapsed: this.elapsed,
            dock: inZone ? { label: near!.structure.kind === 'station' ? 'Station' : 'Beacon', progress: Math.min(1, this.dockHold / 1.5), ready: true } : null,
            warden: this.warden?.alive
                ? { name: cfg.sector.warden, hp: this.warden.hp, maxHp: this.warden.maxHp, shield: this.warden.data.shield ?? 0, shieldMax: this.warden.data.shieldMax ?? 0 }
                : carrier
                    ? { name: carrier.name, hp: carrier.hp, maxHp: carrier.maxHp, shield: 0, shieldMax: 0, carrier: true, locks: ((carrier.group.userData.reactors as Enemy[] | undefined) ?? []).filter(r => r.alive).length, lockLabel: capital ? 'Pylons' : undefined, marks: capital?.marks }
                    : null,
            wardenKilled: this.wardenKilled,
            threat: this.threat,
            wanted: this.wanted,
            target,
            lowHull: p.hull / cfg.stats.hull < 0.3,
            objectives: this.objectives?.view() ?? null,
            streak: this.streak >= 3 ? this.streak : 0,
            outOfBounds: this.outOfBounds,
            skill: this.skills?.hud() ?? null,
            supplies: VOID_SUPPLIES.map(s => ({ id: s.id, name: s.name, key: s.key, count: this.supplies[s.id] ?? 0, color: `#${s.color.toString(16).padStart(6, '0')}` })),
            relics: this.relics,
            gearCaches: this.gearCaches,
            systems: this.systems?.hud() ?? null,
            energyLow: p.energy < 0.2,
            gate: this.gate ? { distance: Math.round(this.gate.pos.distanceTo(p.pos)), fuel: this.fuel } : null,
            trader: this.traderInReach(),
            cockpit: this.cockpit
        }
    }

    nextId() {
        return this.nextEnemyId++
    }
}

export function segmentSphere(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, r: number) {
    const abx = b.x - a.x
    const aby = b.y - a.y
    const abz = b.z - a.z
    const acx = c.x - a.x
    const acy = c.y - a.y
    const acz = c.z - a.z
    const len2 = abx * abx + aby * aby + abz * abz
    const t = len2 > 0 ? Math.max(0, Math.min(1, (acx * abx + acy * aby + acz * abz) / len2)) : 0
    const dx = a.x + abx * t - c.x
    const dy = a.y + aby * t - c.y
    const dz = a.z + abz * t - c.z
    return dx * dx + dy * dy + dz * dz <= r * r
}

export function disposeTree(obj: THREE.Object3D) {
    obj.parent?.remove(obj)
    obj.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
            mesh.geometry.dispose()
            const mat = mesh.material as THREE.Material
            // Shared materials are module-level singletons; only dispose per-object shader clones.
            if ((mat as THREE.ShaderMaterial).isShaderMaterial || mat.userData.owned || (mat as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending) mat.dispose()
        }
    })
}

