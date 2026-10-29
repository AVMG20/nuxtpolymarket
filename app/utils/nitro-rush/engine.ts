import * as THREE from 'three'
import { COUNTDOWN_SECONDS, ENGINE_TOP_SPEED, KMH_PER_SPEED, NIGHT, NITRO_DURATION, PAINTS, PHYSICS_HZ, type PaintId } from './config'
import { LightTrail, Particles, Shockwaves, SkidMarks, SpeedLines } from './fx'
import { buildPlayerCar, disposeModelShared, type PlayerCar } from './models'
import { botInput, createCar, fireNitro, slipAngle, stepCar, type CarInput, type CarState, type StepEvents } from './physics'
import { RushPost } from './post'
import { formatLapTime, LapTimer, type LapEvent } from '#shared/utils/nitro-rush/timing'
import { newTrackPoint, Track, wrapAngle } from '#shared/utils/nitro-rush/track'
import { findTrack, TRACKS } from '#shared/utils/nitro-rush/tracks'
import { buildCityEnvironment, World } from './world'
import type { NitroAudio } from './audio'

/** `finished` is the pause after an open course's finish line, before the run restarts on its own. */
export type Phase = 'attract' | 'countdown' | 'racing' | 'finished'

export type Control = 'throttle' | 'brake' | 'left' | 'right' | 'handbrake'

export interface HudState {
    /** 1-based lap of this session, or run on an open course. */
    lap: number
    /** False on an open course, where each run is one lap. */
    closed: boolean
    lapTime: number
    lastLap: number | null
    /** Quickest lap of this session. */
    sessionBest: number | null
    /** The personal best on this track. */
    bestLap: number | null
    speedKmh: number
    /** The meter while charging, the time left while burning. */
    nitro: number
    nitroActive: boolean
    drifting: boolean
    wrongWay: boolean
}

/** The best lap on a track and its sector splits (lap time last), for live deltas. */
export interface TrackRecord {
    bestLap: number | null
    bestSplits: number[] | null
}

export type PopupTone = 'good' | 'bad' | 'best' | 'drift' | 'nitro' | 'count' | 'lap' | 'danger'

export interface Popup {
    text: string
    sub?: string
    tone: PopupTone
    big?: boolean
}

export interface EngineEvents {
    hud: (h: HudState) => void
    popup: (p: Popup) => void
    phase: (p: Phase) => void
    /** A new personal best lap; the component persists it and sends it to the leaderboard. */
    record: (trackId: string, r: TrackRecord) => void
}

/** The grid slot, this far behind the start line. */
const GRID_OFFSET = -14
/** How long an open course's finish holds before the next run lines up. */
const RESTART_DELAY = 2.5
const STEP = 1 / PHYSICS_HZ
/** Attract-mode demo laps run a touch off the limit. */
const DEMO_PACE = 0.85
/** Rear wheels in the car's local space (nose toward -z). */
const REAR_WHEELS = [new THREE.Vector2(-0.82, 1.42), new THREE.Vector2(0.82, 1.42)]
const TAIL_RED = new THREE.Color(0xff2040)
const NITRO_BLUE = new THREE.Color(0x4da3ff)
const NITRO_PALE = new THREE.Color(0x9fd0ff)
const WHITE = new THREE.Color(0xffffff)
const NITRO_SPARK = new THREE.Color(0x8fc4ff)
const TYRE_SMOKE = new THREE.Color(0x8a8c96)
const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

export class NitroRushEngine {
    private readonly host: HTMLElement
    private readonly events: EngineEvents
    private readonly audio: NitroAudio
    private readonly renderer: THREE.WebGLRenderer
    private readonly scene = new THREE.Scene()
    private readonly camera: THREE.PerspectiveCamera
    private readonly post: RushPost
    private track: Track
    private world: World
    private readonly envTarget: THREE.WebGLRenderTarget
    private readonly sparks: Particles
    private readonly smoke: Particles
    private readonly speedLines: SpeedLines
    private readonly shock: Shockwaves
    private readonly trails: LightTrail[]
    private readonly skids: SkidMarks
    private readonly car: PlayerCar
    private readonly frontWheels: THREE.Object3D[]
    private readonly headlight: THREE.SpotLight
    private readonly lampLight: THREE.PointLight
    private readonly lampPos = new THREE.Vector3()
    private readonly resizeObserver: ResizeObserver
    private readonly tmpV = new THREE.Vector3()
    private readonly tmpP = newTrackPoint()
    private readonly chasePos = new THREE.Vector3()
    private readonly chaseLook = new THREE.Vector3()
    private readonly orbitPos = new THREE.Vector3()
    private readonly orbitLook = new THREE.Vector3()
    private raf = 0
    private lastTime = 0
    private disposed = false
    private width = 1
    private height = 1
    private pixelRatio = 1
    private maxPixelRatio = 1
    private frameAvg = 1 / 60
    private resolutionChangedAt = 0

    phase: Phase = 'attract'
    private paused = false
    private time = 0
    private countdown = 0
    private countdownShown = 0
    private finishedAt = 0

    // Car, physics and race
    private state: CarState
    private readonly prev = { x: 0, z: 0, y: 0, s: 0, heading: 0 }
    private accumulator = 0
    private timer: LapTimer | null = null
    private record: TrackRecord = { bestLap: null, bestSplits: null }
    private sessionBest: number | null = null
    /** Runs started this session, for the sprint HUD. */
    private runs = 0
    private readonly controls: Record<Control, boolean> = { throttle: false, brake: false, left: false, right: false, handbrake: false }
    private nitroReadyAnnounced = false
    private wrongWayTime = 0
    private lastLap: number | null = null
    private lastTravel = 0
    private lastSpeed = 0
    private latAcc = 0
    private longAcc = 0

    // Camera, body motion and post
    private camYaw = 0
    private camBlend = 0
    /** Set on a fresh run: the camera cuts to the grid rather than flying there. */
    private camCut = false
    private readonly camPos = new THREE.Vector3(0, 3, 9)
    private readonly camLook = new THREE.Vector3()
    private trauma = 0
    private aberrationPulse = 0
    private readonly flash = new THREE.Color(0, 0, 0)
    private readonly tint = new THREE.Color()
    private nitroK = 0
    private roll = 0
    private pitch = 0

    constructor(host: HTMLElement, events: EngineEvents, audio: NitroAudio, paint: PaintId, trackId: string) {
        this.host = host
        this.events = events
        this.audio = audio

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
        this.renderer.toneMapping = THREE.AgXToneMapping
        this.renderer.toneMappingExposure = 1.15
        this.renderer.outputColorSpace = THREE.SRGBColorSpace
        this.renderer.domElement.style.display = 'block'
        this.renderer.domElement.style.width = '100%'
        this.renderer.domElement.style.height = '100%'
        host.appendChild(this.renderer.domElement)

        // Retina already supersamples; standard screens get 1.5x for the thin neon. Never below native.
        const dpr = window.devicePixelRatio || 1
        this.maxPixelRatio = dpr >= 1.5 ? Math.min(dpr, 2) : 1.5
        this.pixelRatio = this.maxPixelRatio

        this.camera = new THREE.PerspectiveCamera(64, 1, 0.1, 2000)
        this.envTarget = buildCityEnvironment(this.renderer)
        this.scene.environment = this.envTarget.texture

        this.track = new Track(findTrack(trackId) ?? TRACKS[0]!)
        this.world = this.buildWorld()

        const p = PAINTS.find(x => x.id === paint) ?? PAINTS[0]
        this.car = buildPlayerCar(p.color)
        // Yaw first, then the road's slope in the car's own frame.
        this.car.group.rotation.order = 'YXZ'
        this.scene.add(this.car.group)
        for (const w of this.car.wheels) w.parent!.userData.baseYaw = w.parent!.rotation.y
        this.frontWheels = this.car.wheels.map(w => w.parent!).filter(w => w.position.z < 0)
        this.headlight = new THREE.SpotLight(0xe8f2ff, 40, 70, 0.42, 0.6, 1.2)
        this.headlight.position.set(0, 1.0, -1.8)
        this.headlight.target.position.set(0, 0, -30)
        this.car.group.add(this.headlight, this.headlight.target)
        // Rides with whichever floodlight is nearest, so the paint flares as each one passes.
        this.lampLight = new THREE.PointLight(0xffd2a0, 0, 30, 1.6)
        this.scene.add(this.lampLight)

        this.skids = new SkidMarks(2)
        this.sparks = new Particles()
        this.smoke = new Particles(2500, 'smoke')
        this.speedLines = new SpeedLines(200)
        this.shock = new Shockwaves()
        this.trails = [new LightTrail(TAIL_RED, 40), new LightTrail(TAIL_RED, 40)]
        this.scene.add(this.skids.mesh, this.sparks.points, this.smoke.points, this.speedLines.mesh, this.shock.group)
        for (const t of this.trails) this.scene.add(t.mesh)
        this.world.hideFromReflection(this.speedLines.mesh)

        this.post = new RushPost(this.renderer, this.scene, this.camera)

        this.state = createCar(this.track, this.gridS)
        this.placeCar()

        this.resizeObserver = new ResizeObserver(() => this.resize())
        this.resizeObserver.observe(host)
        this.resize()
        this.lastTime = performance.now()
        this.raf = requestAnimationFrame(this.frame)
    }

    // ─── Public API ────────────────────────────────────────────────────────

    get trackId() {
        return this.track.def.id
    }

    get trackName() {
        return this.track.def.name
    }

    setPaint(id: PaintId) {
        const p = PAINTS.find(x => x.id === id) ?? PAINTS[0]
        this.car.paint.color.setHex(p.color)
    }

    setRecord(r: TrackRecord) {
        this.record = { ...r }
    }

    /** Swaps the course, rebuilding the scenery, and returns to the menu on it. */
    setTrack(id: string) {
        const def = findTrack(id)
        if (!def || def.id === this.track.def.id) return
        this.scene.remove(this.world.group)
        this.world.dispose()
        this.track = new Track(def)
        this.world = this.buildWorld()
        this.world.hideFromReflection(this.speedLines.mesh)
        this.world.setPixelRatio(this.pixelRatio)
        this.world.setReflectionSize(this.width * this.pixelRatio * 0.5, this.height * this.pixelRatio * 0.5)
        this.record = { bestLap: null, bestSplits: null }
        this.sessionBest = null
        this.toMenu()
        this.state = createCar(this.track, this.gridS)
        this.skids.clear()
        this.placeCar()
    }

    setPaused(paused: boolean) {
        this.paused = paused
        this.audio.muffle(paused ? 1 : 0)
        if (paused) {
            this.audio.engine(0, false, false)
            this.audio.skid(0)
        }
    }

    get isPaused() {
        return this.paused
    }

    setControl(c: Control, down: boolean) {
        this.controls[c] = down
    }

    releaseControls() {
        for (const k of Object.keys(this.controls) as Control[]) this.controls[k] = false
    }

    nitro() {
        if (this.paused || this.phase !== 'racing') return
        if (!fireNitro(this.state)) return
        this.audio.nitroStart()
        this.aberrationPulse = 1
        this.flash.setRGB(0.1, 0.2, 0.45)
        this.shock.fire(this.state.x, this.state.proj.y + 0.1, this.state.z, new THREE.Color(0x4d7cff), 9, 0.5)
        this.events.popup({ text: 'NITRO!', tone: 'nitro' })
        this.nitroReadyAnnounced = false
    }

    start() {
        this.resetRace()
        this.runs++
        this.phase = 'countdown'
        this.countdown = COUNTDOWN_SECONDS
        this.countdownShown = COUNTDOWN_SECONDS + 1
        this.camBlend = 0
        this.audio.muffle(0)
        this.world.setStartLights(0, false)
        this.events.phase(this.phase)
    }

    toMenu() {
        this.timer = null
        this.sessionBest = null
        this.lastLap = null
        this.runs = 0
        this.phase = 'attract'
        this.audio.skid(0)
        this.world.setStartLights(0, false)
        this.events.phase(this.phase)
    }

    dispose() {
        this.disposed = true
        cancelAnimationFrame(this.raf)
        this.resizeObserver.disconnect()
        this.audio.engine(0, false, false)
        this.audio.skid(0)
        this.post.dispose()
        this.world.dispose()
        this.sparks.dispose()
        this.smoke.dispose()
        this.speedLines.dispose()
        this.shock.dispose()
        this.skids.dispose()
        for (const t of this.trails) t.dispose()
        this.car.dispose()
        this.envTarget.dispose()
        disposeModelShared()
        this.renderer.dispose()
        this.renderer.domElement.remove()
    }

    // ─── Setup and reset ───────────────────────────────────────────────────

    private buildWorld() {
        const world = new World(this.scene, this.track, { w: 512, h: 512 })
        world.applyTheme(NIGHT, this.renderer, this.scene)
        return world
    }

    private get gridS() {
        return this.track.startS + GRID_OFFSET
    }

    /** The car's distance as the lap timer reads it: from the start line on an open course. */
    private timerS() {
        return this.track.closed ? this.state.proj.s : this.state.proj.s - this.track.startS
    }

    private resize() {
        const w = Math.max(1, this.host.clientWidth)
        const h = Math.max(1, this.host.clientHeight)
        this.width = w
        this.height = h
        this.renderer.setPixelRatio(this.pixelRatio)
        this.renderer.setSize(w, h, false)
        this.post.setSize(w, h, this.pixelRatio)
        this.camera.aspect = w / h
        this.camera.updateProjectionMatrix()
        this.world.setPixelRatio(this.pixelRatio)
        // The wet-track mirror renders at half resolution; the streak blur hides it.
        this.world.setReflectionSize(w * this.pixelRatio * 0.5, h * this.pixelRatio * 0.5)
    }

    /** Back off resolution when frames run long, never below native. */
    private adaptResolution(dt: number) {
        this.frameAvg += (dt - this.frameAvg) * 0.05
        // Settle between changes: a resize mid-race is a visible hitch, so it must never flap.
        if (this.time - this.resolutionChangedAt < 3) return
        let next = this.pixelRatio
        if (this.frameAvg > 1 / 45 && this.pixelRatio > 1) {
            next = Math.max(1, this.pixelRatio - 0.25)
            // A ratio that ran slow is never tried again this session.
            this.maxPixelRatio = next
        } else if (this.frameAvg < 1 / 58 && this.pixelRatio < this.maxPixelRatio && this.time - this.resolutionChangedAt > 8) {
            next = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1)
        }
        if (Math.abs(next - this.pixelRatio) > 0.001) {
            this.pixelRatio = next
            this.resolutionChangedAt = this.time
            this.resize()
        }
    }

    /** Wider lens on narrow screens so the bends stay in view. */
    private baseFov() {
        const aspect = this.width / this.height
        const minHorizontal = THREE.MathUtils.degToRad(84)
        const needed = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minHorizontal / 2) / aspect))
        return THREE.MathUtils.clamp(Math.max(62, needed), 62, 104)
    }

    private resetRace() {
        this.state = createCar(this.track, this.gridS)
        // Every run starts with a full tank; the meter already says so, so no NITRO READY over the GO.
        this.state.nitro = 1
        this.accumulator = 0
        this.timer = new LapTimer(this.track.lapLength, this.track.closed, GRID_OFFSET, this.track.checkpointDistances)
        this.nitroReadyAnnounced = true
        this.wrongWayTime = 0
        this.skids.clear()
        this.sparks.clear()
        this.smoke.clear()
        this.placeCar()
        this.camYaw = this.state.heading
        this.camCut = true
    }

    /** Tilts the car to lie on the road: pitched by the slope ahead of its nose, rolled by the slope across it. */
    private poseOnSlope(heading: number) {
        const p = this.state.proj
        const gx = p.grade * p.tx
        const gz = p.grade * p.tz
        const sin = Math.sin(heading)
        const cos = Math.cos(heading)
        this.car.group.rotation.set(Math.atan(-gx * sin - gz * cos), heading, Math.atan(gx * cos - gz * sin))
    }

    /** Snaps the model and the interpolation history to the physics state. */
    private placeCar() {
        const s = this.state
        this.prev.x = s.x
        this.prev.z = s.z
        this.prev.heading = s.heading
        this.prev.y = s.proj.y
        this.prev.s = s.proj.s
        this.lastTravel = s.travel
        this.lastSpeed = s.speed
        this.car.group.position.set(s.x, s.proj.y, s.z)
        this.poseOnSlope(s.heading)
        for (let i = 0; i < 2; i++) {
            this.car.body.localToWorld(this.tmpV.copy(this.car.tailPoints[i]!))
            this.trails[i]!.reset(this.tmpV)
            this.skids.lift(i)
        }
    }

    // ─── Main loop ─────────────────────────────────────────────────────────

    private readonly frame = (now: number) => {
        if (this.disposed) return
        this.raf = requestAnimationFrame(this.frame)
        // rAF stamps the frame's start, which can precede the clock read in the constructor.
        const dt = THREE.MathUtils.clamp((now - this.lastTime) / 1000, 0, 0.1)
        this.lastTime = now
        this.adaptResolution(dt)
        if (this.paused) {
            this.post.render()
            return
        }
        this.time += dt
        this.update(dt)
        this.render(dt)
    }

    private input(): CarInput {
        const c = this.controls
        return { throttle: c.throttle ? 1 : 0, brake: c.brake ? 1 : 0, steer: (c.right ? 1 : 0) - (c.left ? 1 : 0), handbrake: c.handbrake }
    }

    private update(dt: number) {
        if (this.phase === 'countdown') {
            this.countdown -= dt
            const n = Math.ceil(this.countdown)
            const lit = Math.min(5, Math.floor((1 - this.countdown / COUNTDOWN_SECONDS) * 5) + 1)
            this.world.setStartLights(lit, false)
            if (n !== this.countdownShown && n > 0) {
                this.countdownShown = n
                this.events.popup({ text: String(n), tone: 'count', big: true })
                this.audio.countdown(false)
            }
            if (this.countdown <= 0) {
                this.phase = 'racing'
                this.world.setStartLights(5, true)
                this.audio.countdown(true)
                this.aberrationPulse = 1
                this.flash.setRGB(0.3, 0.3, 0.35)
                this.events.popup({ text: 'GO!', tone: 'count', big: true })
                this.events.phase(this.phase)
            }
        }

        // The grid holds the car still through the countdown; otherwise physics runs at a fixed rate.
        if (this.phase !== 'countdown') {
            this.accumulator += dt
            while (this.accumulator >= STEP) {
                this.accumulator -= STEP
                this.prev.x = this.state.x
                this.prev.z = this.state.z
                this.prev.heading = this.state.heading
                this.prev.y = this.state.proj.y
                this.prev.s = this.state.proj.s
                const racing = this.phase === 'racing'
                const ev = stepCar(this.state, this.stepInput(), this.track, STEP)
                if (racing) this.onStep(ev)
                if (racing && this.timer) for (const e of this.timer.update(this.timerS(), STEP)) this.onLapEvent(e)
            }
        }
        if (this.phase === 'finished' && this.time - this.finishedAt > RESTART_DELAY) this.start()
        // The menu's demo car on a sprint lines up again once it has pulled up past the finish.
        if (this.phase === 'attract' && !this.track.closed && this.state.proj.s > this.track.finishS && this.state.speed < 2) {
            this.state = createCar(this.track, this.gridS)
            this.skids.clear()
            this.placeCar()
        }

        const s = this.state
        // Body motion and the camera lean off the car's real accelerations, smoothed.
        const dTravel = wrapAngle(s.travel - this.lastTravel)
        this.latAcc += (s.speed * dTravel / Math.max(dt, 1e-3) - this.latAcc) * Math.min(1, dt * 8)
        this.longAcc += ((s.speed - this.lastSpeed) / Math.max(dt, 1e-3) - this.longAcc) * Math.min(1, dt * 6)
        this.lastTravel = s.travel
        this.lastSpeed = s.speed

        if (this.phase === 'racing') {
            // Going the wrong way for a while gets a warning.
            const along = Math.cos(s.travel - Math.atan2(-s.proj.tx, -s.proj.tz)) * s.speed
            this.wrongWayTime = along < -3 ? this.wrongWayTime + dt : 0
            if (s.nitro >= 1 && !this.nitroReadyAnnounced && s.nitroTime <= 0) {
                this.nitroReadyAnnounced = true
                this.audio.nitroReady()
                this.events.popup({ text: 'NITRO READY', sub: 'SHIFT TO BOOST', tone: 'nitro' })
            }
        }
        this.updateTyres(dt)

        this.world.update(dt, this.camera)
        const lampDist = this.world.nearestLamp(s.x, s.proj.y, s.z, this.lampPos)
        this.lampLight.position.copy(this.lampPos)
        this.lampLight.color.copy(this.world.lampColor)
        this.lampLight.intensity = 160 * Math.max(0, 1 - lampDist / 16)

        if (s.nitroTime > 0) {
            const p = this.car.group.position
            this.sparks.emit(p.x, p.y + 0.15, p.z, 3, { color: NITRO_SPARK, speed: 4, up: 2, life: 0.35, size: 0.16, gravity: 10 })
        }
        this.sparks.update(dt)
        this.smoke.update(dt)
        this.shock.update(dt)
    }

    private stepInput(): CarInput {
        if (this.phase === 'racing') return this.input()
        // Past the finish the car pulls itself up; the brake held at a standstill would reverse it.
        if (this.phase === 'finished') return { throttle: 0, brake: this.state.speed > 1 ? 1 : 0, steer: 0, handbrake: false }
        return botInput(this.state, this.track, DEMO_PACE)
    }

    private onStep(ev: StepEvents) {
        const s = this.state
        if (ev.wallImpact > 1.5) {
            const k = Math.min(1, ev.wallImpact / 14)
            this.trauma = Math.min(1, this.trauma + 0.15 + k * 0.45)
            // Sparks where the car meets the wall.
            const side = Math.sign(s.proj.lateral)
            const cx = s.x - s.proj.tz * side * 1.1
            const cz = s.z + s.proj.tx * side * 1.1
            this.sparks.emit(cx, s.proj.y + 0.4, cz, Math.round(10 + k * 50), {
                color: new THREE.Color(0xffb050), speed: 8 + k * 10, up: 2, life: 0.5, size: 0.13, gravity: 16,
                vx: -Math.sin(s.travel) * s.speed * 0.6, vz: -Math.cos(s.travel) * s.speed * 0.6
            })
            if (ev.wallImpact > 6) {
                this.audio.bump()
                this.aberrationPulse = Math.max(this.aberrationPulse, 0.5)
                this.shock.fire(cx, s.proj.y + 0.1, cz, new THREE.Color(0xffc070), 4, 0.35)
            } else {
                this.audio.scrape()
            }
        }
        if (ev.driftEnded > 0.6 && ev.nitroEarned > 0) {
            this.events.popup({ text: 'DRIFT', sub: `${ev.driftEnded.toFixed(1)}s · +NITRO`, tone: 'drift' })
        }
    }

    private onLapEvent(e: LapEvent) {
        const rec = this.record
        if (e.type === 'split') {
            // Splits saved before the course had these checkpoints mark other points on the lap.
            const best = rec.bestSplits?.length === this.track.checkpoints.length + 1 ? rec.bestSplits[e.sector] : undefined
            if (best === undefined) return
            const delta = e.time - best
            this.audio.split(delta < 0)
            this.events.popup({ text: formatLapTime(delta, true), sub: `SECTOR ${e.sector + 1}`, tone: delta < 0 ? 'good' : 'bad' })
        } else {
            const isBest = rec.bestLap === null || e.time < rec.bestLap
            const label = this.track.closed ? `LAP ${e.lap + 1}` : 'FINISH'
            const sub = rec.bestLap === null ? label : `${label} · ${formatLapTime(e.time - rec.bestLap, true)}`
            this.lastLap = e.time
            if (this.sessionBest === null || e.time < this.sessionBest) this.sessionBest = e.time
            if (isBest) {
                this.record = { ...rec, bestLap: e.time, bestSplits: [...e.splits, e.time] }
                this.events.record(this.track.def.id, this.record)
                this.flash.setRGB(0.25, 0.2, 0.05)
            }
            this.audio.lap(isBest)
            this.events.popup({ text: formatLapTime(e.time), sub: isBest ? `${sub} · BEST LAP` : sub, tone: isBest ? 'best' : 'lap', big: true })
            if (!this.track.closed) {
                this.phase = 'finished'
                this.finishedAt = this.time
                this.aberrationPulse = 1
                this.events.phase(this.phase)
            }
        }
    }

    /** Skid marks and smoke off the rear tyres while the car slides, locks up or spins them. */
    private updateTyres(dt: number) {
        const s = this.state
        const slip = Math.abs(slipAngle(s))
        const speed = Math.abs(s.speed)
        const c = this.controls
        const racing = this.phase === 'racing'
        const locked = racing && (c.handbrake || (c.brake && s.speed > 18))
        // Wheelspin off the line: flat out from low speed.
        const spin = racing && c.throttle && s.speed > 0 && s.speed < 14
        const amount = speed < 4 ? 0 : Math.max(Math.min(1, (slip - 0.06) * 3), locked ? 0.55 : 0, spin ? 0.7 : 0)
        this.audio.skid(racing || this.phase === 'finished' ? amount * Math.min(1, speed / 12) : 0)
        const cos = Math.cos(s.heading)
        const sin = Math.sin(s.heading)
        REAR_WHEELS.forEach((w, i) => {
            if (amount <= 0) {
                this.skids.lift(i)
                return
            }
            // The model's local frame turned by the heading.
            const x = s.x + w.x * cos + w.y * sin
            const z = s.z - w.x * sin + w.y * cos
            const y = s.proj.y + s.proj.grade * ((x - s.x) * s.proj.tx + (z - s.z) * s.proj.tz)
            this.skids.add(i, this.tmpV.set(x, y, z), 0.35 + amount * 0.65)
            if (Math.random() < amount * dt * 60) {
                this.smoke.emit(x, y + 0.35, z, 1 + Math.round(amount * 2), {
                    color: TYRE_SMOKE, speed: 1.2, up: 1.2, spread: 0.5, life: 1.6, size: 0.9, gravity: -0.8, drag: 1.4, grow: 3.2, jitter: 0.08,
                    vx: -Math.sin(s.travel) * s.speed * 0.25, vz: -Math.cos(s.travel) * s.speed * 0.25
                })
            }
        })
    }

    // ─── Camera, car pose, post and HUD ────────────────────────────────────

    private render(dt: number) {
        const s = this.state
        const racing = this.phase === 'racing'
        const nitro = s.nitroTime > 0
        this.nitroK += ((nitro ? 1 : 0) - this.nitroK) * Math.min(1, dt * (nitro ? 6 : 2.5))
        const speedK = THREE.MathUtils.clamp(Math.abs(s.speed) / ENGINE_TOP_SPEED, 0, 1)

        // Pose between the last two physics states, so motion is smooth at any refresh rate.
        const a = this.phase === 'countdown' ? 1 : this.accumulator / STEP
        const x = this.prev.x + (s.x - this.prev.x) * a
        const z = this.prev.z + (s.z - this.prev.z) * a
        const heading = this.prev.heading + wrapAngle(s.heading - this.prev.heading) * a
        const y = this.prev.y + (s.proj.y - this.prev.y) * a
        let ds = s.proj.s - this.prev.s
        // A loop's s jumps by its length at the start line.
        if (this.track.closed && Math.abs(ds) > this.track.length / 2) ds -= Math.sign(ds) * this.track.length
        const along = this.prev.s + ds * a
        const car = this.car
        car.group.position.set(x, y, z)
        this.poseOnSlope(heading)
        // The body leans out of bends and squats or dives with the throttle and brakes.
        this.roll += (THREE.MathUtils.clamp(-this.latAcc * 0.0035, -0.085, 0.085) - this.roll) * Math.min(1, dt * 10)
        this.pitch += (THREE.MathUtils.clamp(this.longAcc * 0.0022, -0.05, 0.04) - this.pitch) * Math.min(1, dt * 8)
        car.body.rotation.set(this.pitch, 0, this.roll)
        const steerVisual = -s.steer * 0.45 / (1 + Math.abs(s.speed) / 30)
        for (const w of this.frontWheels) w.rotation.y = (w.userData.baseYaw ?? 0) + steerVisual
        for (const w of car.wheels) w.rotation.x -= s.speed * dt / 0.37 * (w.userData.dir ?? 1)
        const flicker = 0.75 + Math.random() * 0.5
        for (const f of car.flames) {
            const k = nitro ? 1.6 * flicker : (racing && this.controls.throttle ? 0.3 * flicker : 0.001)
            f.scale.set(nitro ? 1.3 : 0.8, nitro ? 1.3 : 0.8, k)
        }
        car.flameMat.color.setHex(nitro ? 0x9fd0ff : 0xff7a2a)

        // Chase camera: it follows where the car is going more than where it points, so a drift shows the car sideways.
        const slip = slipAngle(s)
        const camTarget = s.speed < -1 ? s.heading : s.travel + slip * 0.3
        this.camYaw += wrapAngle(camTarget - this.camYaw) * Math.min(1, dt * 4.5)
        const fx = -Math.sin(this.camYaw)
        const fz = -Math.cos(this.camYaw)
        const back = 6.6 + speedK * 1.3 + this.nitroK * 0.6
        // Heights from the road behind and ahead, so the camera tips up a climb and down a drop.
        const roadBehind = this.track.pointAt(along - back, this.tmpP).y
        const roadAhead = this.track.pointAt(along + 9, this.tmpP).y
        const chasePos = this.chasePos.set(x - fx * back, roadBehind + 2.4 + speedK * 0.2, z - fz * back)
        const chaseLook = this.chaseLook.set(x + fx * 9, roadAhead + 1.1, z + fz * 9)
        const orbitA = this.time * 0.22
        const orbitPos = this.orbitPos.set(x + Math.sin(orbitA) * 9.5, y + 2.3 + Math.sin(this.time * 0.3) * 0.5, z + Math.cos(orbitA) * 9.5)
        const orbitLook = this.orbitLook.set(x, y + 0.9, z)

        let target: number
        if (this.phase === 'countdown') target = ease(THREE.MathUtils.clamp(1 - this.countdown / COUNTDOWN_SECONDS, 0, 1))
        else if (this.phase === 'racing') target = 1
        // A beat on the chase cam past the line, then the orbit takes over.
        else if (this.phase === 'finished') target = this.time - this.finishedAt < 1.5 ? 1 : 0
        else target = 0
        if (this.phase === 'countdown' || this.phase === 'attract') this.camBlend = target
        else this.camBlend += (target - this.camBlend) * Math.min(1, dt * (target < this.camBlend ? 0.8 : 4))
        const pos = orbitPos.lerp(chasePos, this.camBlend)
        const look = orbitLook.lerp(chaseLook, this.camBlend)
        if (this.camCut) {
            this.camPos.copy(pos)
            this.camLook.copy(look)
            this.camCut = false
        } else {
            this.camPos.lerp(pos, 1 - Math.exp(-dt * (this.camBlend > 0.98 ? 16 : 6)))
            this.camLook.lerp(look, 1 - Math.exp(-dt * 16))
        }

        this.trauma = Math.max(0, this.trauma - dt * 1.8)
        const shake = this.trauma * this.trauma
        const t = this.time * 40
        this.camera.position.set(this.camPos.x + Math.sin(t * 1.1) * shake * 0.4, this.camPos.y + Math.sin(t * 1.7 + 1) * shake * 0.3, this.camPos.z)
        this.camera.lookAt(this.camLook)
        this.camera.rotateZ(this.latAcc * 0.0012 * this.camBlend + Math.sin(t * 0.9) * shake * 0.03)
        const fov = this.baseFov() + (6 + speedK * 14) * this.camBlend + this.nitroK * 8
        if (Math.abs(fov - this.camera.fov) > 0.01) {
            this.camera.fov = fov
            this.camera.updateProjectionMatrix()
        }
        this.sparks.setScale(this.height, this.pixelRatio, this.camera.fov)
        this.smoke.setScale(this.height, this.pixelRatio, this.camera.fov)

        // Tail-light ribbons: a faint wake at speed, bright on nitro.
        for (let i = 0; i < 2; i++) {
            car.body.localToWorld(this.tmpV.copy(car.tailPoints[i]!))
            this.trails[i]!.setColor(nitro ? NITRO_BLUE : TAIL_RED)
            this.trails[i]!.update(this.tmpV, (this.nitroK * 0.5 + Math.max(0, speedK - 0.5) * 0.25) * this.camBlend, nitro ? 0.08 : 0.04)
        }

        // Speed lines sit around the camera, streaming back along its heading.
        this.speedLines.mesh.position.set(this.camera.position.x, y, this.camera.position.z)
        this.speedLines.mesh.rotation.y = this.camYaw
        const lineIntensity = this.camBlend * (Math.max(0, speedK - 0.45) * 0.7 + this.nitroK * 0.45)
        const minWidth = 1.6 / (this.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2))) * 8
        this.speedLines.update(dt, Math.abs(s.speed) * 3, lineIntensity, nitro ? NITRO_PALE : WHITE, minWidth)

        this.aberrationPulse = Math.max(0, this.aberrationPulse - dt * 2.6)
        this.flash.multiplyScalar(Math.exp(-dt * 7))
        this.post.set({
            radial: (this.nitroK * 0.16 + Math.max(0, speedK - 0.4) * 0.25) * this.camBlend,
            aberration: this.aberrationPulse + 0.08 * this.camBlend + this.nitroK * 0.25,
            flash: this.flash,
            // Nitro cools the grade toward blue.
            tint: this.tint.setRGB(0.75, 0.9, 1.25),
            tintAmount: this.nitroK * 0.35,
            saturation: 1,
            vignette: 0.25 + this.nitroK * 0.4,
            bloom: 0.55 + this.nitroK * 0.2
        })
        this.post.render()

        const live = this.phase !== 'attract'
        this.audio.engine(speedK, nitro, live)
        this.audio.setIntensity(racing ? 0.25 + speedK * 0.75 : 0)

        const timer = this.timer
        this.events.hud({
            lap: !this.track.closed ? this.runs : timer ? timer.lap + 1 : 1,
            closed: this.track.closed,
            lapTime: timer ? (timer.finished ? (this.lastLap ?? 0) : timer.lapTime) : 0,
            lastLap: this.lastLap,
            sessionBest: this.sessionBest,
            bestLap: this.record.bestLap,
            speedKmh: Math.round(Math.abs(s.speed) * KMH_PER_SPEED),
            nitro: nitro ? s.nitroTime / NITRO_DURATION : s.nitro,
            nitroActive: nitro,
            drifting: s.drifting,
            wrongWay: this.wrongWayTime > 1.2
        })
    }
}
