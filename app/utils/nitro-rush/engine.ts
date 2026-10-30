import * as THREE from 'three'
import { ChaseCamera, shotFor } from './camera'
import { CarEffects, tyreSlide } from './car-fx'
import { disposeModelShared } from './car-kit'
import { poseCar, type PoseSample } from './car-pose'
import { CarView } from './car-view'
import { buildCityEnvironment } from './city'
import { COUNTDOWN_SECONDS, ENGINE_TOP_SPEED, findPaint, GHOST_COLOR, KMH_PER_SPEED, NIGHT, NITRO_DURATION, PHYSICS_HZ, type PaintId } from './config'
import { botInput, createCar, fireNitro, slipAngle, stepCar, type CarInput, type CarState, type StepEvents } from './physics'
import { GhostRecorder, replayGhost } from './ghost'
import { GhostView } from './ghost-view'
import { withGhost } from './record'
import { carInput } from './input'
import { RushPost } from './post'
import { AdaptiveResolution } from './resolution'
import { decodeGhost, encodeGhost, replacesGhost, type Ghost } from '#shared/utils/nitro-rush/ghost'
import { formatLapTime, LapTimer, type LapEvent } from '#shared/utils/nitro-rush/timing'
import { headingOf, Track, wrapAngle, type TrackDef } from '#shared/utils/nitro-rush/track'
import { World } from './world'
import type { NitroAudio } from './audio'
import { EMPTY_RECORD, type CarPose, type Control, type EngineEvents, type GhostFrame, type GhostSource, type LapEntry, type MapGhost, type Phase, type TrackRecord } from './types'

/** The grid slot, this far behind the start line. */
const GRID_OFFSET = -14
/** How long an open course's finish holds before the next run lines up. */
const RESTART_DELAY = 2.5
const STEP = 1 / PHYSICS_HZ
/** A car that drops into a jump's gap starts again this far before it, at a standstill. */
const RESPAWN_BACK = 120
/** Falling this fast onto the road shakes the camera. */
const HARD_LANDING = 8
/** Attract-mode demo laps run a touch off the limit. */
const DEMO_PACE = 0.85
/** Laps the HUD lists. */
const RECENT_LAPS = 3

export class NitroRushEngine {
    private readonly host: HTMLElement
    private readonly events: EngineEvents
    private readonly audio: NitroAudio
    private readonly renderer: THREE.WebGLRenderer
    private readonly scene = new THREE.Scene()
    private readonly cam: ChaseCamera
    private readonly post: RushPost
    private track: Track
    private world: World
    private readonly envTarget: THREE.WebGLRenderTarget
    private readonly fx: CarEffects
    private readonly car: CarView
    private readonly lampLight: THREE.PointLight
    private readonly lampPos = new THREE.Vector3()
    private readonly resizeObserver: ResizeObserver
    private readonly tails: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()]
    private raf = 0
    private lastTime = 0
    private disposed = false
    private width = 1
    private height = 1
    private readonly resolution = new AdaptiveResolution(window.devicePixelRatio || 1)

    phase: Phase = 'attract'
    private paused = false
    private time = 0
    private countdown = 0
    private countdownShown = 0
    private finishedAt = 0

    // Car, physics and race
    private state: CarState
    private readonly prev = { x: 0, z: 0, y: 0, s: 0, heading: 0, lateral: 0, rel: 0 }
    /** The car as drawn this frame, between the last two physics states. */
    private readonly drawn: PoseSample = { x: 0, z: 0, y: 0, along: 0, lateral: 0, heading: 0, rel: 0, vy: 0, speed: 0, onRail: false, airborne: false }
    private readonly drawnPos = new THREE.Vector3()
    private readonly drawnQuat = new THREE.Quaternion()
    private accumulator = 0
    private timer: LapTimer | null = null
    private record: TrackRecord = { ...EMPTY_RECORD }
    /** Newest first; replaced, never mutated, so each HUD frame holds a stable list. */
    private recentLaps: readonly LapEntry[] = []
    /** Runs started this session, for the sprint HUD. */
    private runs = 0
    private readonly controls: Record<Control, boolean> = { throttle: false, brake: false, left: false, right: false, drift: false }
    private touch = false
    private nitroReadyAnnounced = false
    private wrongWayTime = 0
    private lastTravel = 0
    private lastSpeed = 0
    private latAcc = 0
    private longAcc = 0

    // Ghosts: the kept lap's replay and any others registered, all drawn by one view.
    private readonly ghosts: GhostView
    private readonly ghostSources = new Set<GhostSource>()
    private readonly ghostFrames: GhostFrame[] = []
    private readonly recorder = new GhostRecorder()
    private readonly recordPose: CarPose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }
    private readonly poseMatrix = new THREE.Matrix4()
    private readonly posePos = new THREE.Vector3()
    private readonly poseQuat = new THREE.Quaternion()
    private readonly poseScale = new THREE.Vector3()
    private bestGhost: Ghost | null = null
    private bestGhostOn = true
    private readonly bestGhostFrame: GhostFrame = { id: 'self:best', pose: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 } }

    // Post
    private aberrationPulse = 0
    private readonly flash = new THREE.Color(0, 0, 0)
    private readonly tint = new THREE.Color()
    private nitroK = 0

    constructor(host: HTMLElement, events: EngineEvents, audio: NitroAudio, paint: PaintId, track: TrackDef) {
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

        this.envTarget = buildCityEnvironment(this.renderer)
        this.scene.environment = this.envTarget.texture

        this.track = new Track(track)
        this.cam = new ChaseCamera(this.track)
        this.fx = new CarEffects(this.scene)
        this.ghosts = new GhostView(this.scene)
        this.ghostSources.add(this.bestGhostSource)
        this.world = this.buildWorld()

        this.car = new CarView(findPaint(paint).color)
        this.scene.add(this.car.group)
        // Rides with whichever floodlight is nearest, so the paint flares as each one passes.
        this.lampLight = new THREE.PointLight(0xffd2a0, 0, 30, 1.6)
        this.scene.add(this.lampLight)

        this.post = new RushPost(this.renderer, this.scene, this.cam.camera)

        this.state = createCar(this.track, this.gridS)
        this.placeCar()

        this.resizeObserver = new ResizeObserver(() => this.resize())
        this.resizeObserver.observe(host)
        this.resize()
        this.lastTime = performance.now()
        this.raf = requestAnimationFrame(this.frame)
    }

    // ─── Public API ────────────────────────────────────────────────────────

    get trackDef() {
        return this.track.def
    }

    setPaint(id: PaintId) {
        this.car.setPaint(findPaint(id).color)
    }

    setRecord(r: TrackRecord) {
        this.record = { ...r }
        this.bestGhost = decodeGhost(r.ghost)
    }

    /** Shows or hides the kept lap's ghost; other ghost sources are not affected. */
    setBestGhost(on: boolean) {
        this.bestGhostOn = on
    }

    /**
     * Adds ghosts to draw: every rendered frame the engine calls `src(performance.now(), lapTime)`
     * and draws the frames it returns. Returns the function that removes it again.
     */
    addGhostSource(src: GhostSource): () => void {
        this.ghostSources.add(src)
        return () => {
            this.ghostSources.delete(src)
        }
    }

    /** The player's car where it is drawn this frame, read off the model so it holds every tilt the model takes. */
    carPose(out: CarPose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }): CarPose {
        this.car.group.updateWorldMatrix(true, false)
        this.poseMatrix.copy(this.car.group.matrixWorld).decompose(this.posePos, this.poseQuat, this.poseScale)
        out.x = this.posePos.x
        out.y = this.posePos.y
        out.z = this.posePos.z
        out.qx = this.poseQuat.x
        out.qy = this.poseQuat.y
        out.qz = this.poseQuat.z
        out.qw = this.poseQuat.w
        return out
    }

    /** Swaps the course, rebuilding the scenery, and returns to the menu on it. A rebuilt custom course comes in as a new def under the same id. */
    setTrack(def: TrackDef) {
        if (def === this.track.def) return
        this.scene.remove(this.world.group)
        this.world.dispose()
        this.track = new Track(def)
        this.cam.setTrack(this.track)
        this.world = this.buildWorld()
        this.sizeWorld()
        this.record = { ...EMPTY_RECORD }
        this.bestGhost = null
        this.toMenu()
        this.lineUpDemo()
    }

    setPaused(paused: boolean) {
        this.paused = paused
        this.audio.muffle(paused ? 1 : 0)
        if (paused) this.silence()
    }

    get isPaused() {
        return this.paused
    }

    setControl(c: Control, down: boolean) {
        this.controls[c] = down
    }

    /** Touch play holds the gas for the player. */
    setTouch(touch: boolean) {
        this.touch = touch
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
        this.fx.nitroFired(this.state)
        this.events.popup({ text: 'NITRO!', tone: 'nitro' })
        this.nitroReadyAnnounced = false
    }

    start() {
        this.resetRace()
        this.runs++
        // A loop's restart is a new attempt; a sprint's runs are its laps, so they stay listed.
        if (this.track.closed) this.recentLaps = []
        this.phase = 'countdown'
        this.countdown = COUNTDOWN_SECONDS
        this.countdownShown = COUNTDOWN_SECONDS + 1
        this.audio.muffle(0)
        this.world.setStartLights(0, false)
        this.events.phase(this.phase)
    }

    toMenu() {
        this.timer = null
        this.recorder.reset()
        this.recentLaps = []
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
        this.silence()
        this.post.dispose()
        this.world.dispose()
        this.fx.dispose()
        this.ghosts.dispose()
        this.ghostSources.clear()
        this.car.dispose()
        this.envTarget.dispose()
        disposeModelShared()
        this.renderer.dispose()
        this.renderer.domElement.remove()
    }

    private silence() {
        this.audio.engine(0, false, false)
        this.audio.skid(0)
    }

    // ─── Setup and reset ───────────────────────────────────────────────────

    private buildWorld() {
        const world = new World(this.scene, this.track, { w: 512, h: 512 })
        world.applyTheme(NIGHT, this.renderer, this.scene)
        world.hideFromReflection(this.fx.speedLines.mesh, this.ghosts.group)
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
        this.renderer.setPixelRatio(this.resolution.ratio)
        this.renderer.setSize(w, h, false)
        this.post.setSize(w, h, this.resolution.ratio)
        this.cam.setViewport(w, h)
        this.sizeWorld()
    }

    private sizeWorld() {
        this.world.setPixelRatio(this.resolution.ratio)
        // The wet-track mirror renders at half resolution; the streak blur hides it.
        this.world.setReflectionSize(this.width * this.resolution.ratio * 0.5, this.height * this.resolution.ratio * 0.5)
    }

    private resetRace() {
        this.state = createCar(this.track, this.gridS)
        // Every run starts with a full tank; the meter already says so, so no NITRO READY over the GO.
        this.state.nitro = 1
        this.accumulator = 0
        this.timer = new LapTimer(this.track.lapLength, this.track.closed, GRID_OFFSET, this.track.checkpointDistances)
        this.recorder.reset()
        this.nitroReadyAnnounced = true
        this.wrongWayTime = 0
        this.fx.clear()
        this.placeCar()
        this.cam.cut(this.state.heading)
    }

    /** The menu's demo car back on the grid. */
    private lineUpDemo() {
        this.state = createCar(this.track, this.gridS)
        this.fx.clearSkids()
        this.placeCar()
    }

    /** Snaps the model and the interpolation history to the physics state. */
    private placeCar() {
        const s = this.state
        this.keepPrev()
        this.lastTravel = s.travel
        this.lastSpeed = s.speed
        this.poseAt(1)
        this.fx.place(this.car.tailLights(this.tails))
    }

    /** Poses the model `a` of the way from the last physics state to the current one. */
    private poseAt(a: number) {
        const s = this.state
        const p = this.prev
        const d = this.drawn
        let ds = s.proj.s - p.s
        // A loop's s jumps by its length at the start line.
        if (this.track.closed && Math.abs(ds) > this.track.length / 2) ds -= Math.sign(ds) * this.track.length
        d.x = p.x + (s.x - p.x) * a
        d.z = p.z + (s.z - p.z) * a
        d.y = p.y + (s.y - p.y) * a
        d.along = p.s + ds * a
        d.lateral = p.lateral + (s.proj.lateral - p.lateral) * a
        d.heading = p.heading + wrapAngle(s.heading - p.heading) * a
        d.rel = p.rel + wrapAngle(s.rel - p.rel) * a
        d.vy = s.vy
        d.speed = s.speed
        d.onRail = s.onRail
        d.airborne = s.airborne
        poseCar(this.track, d, this.drawnPos, this.drawnQuat)
        this.car.place(this.drawnPos, this.drawnQuat)
    }

    /** Back on the road before the gap the car fell into, stopped; the clock keeps running. */
    private respawn() {
        const s = this.state
        const gap = this.track.gaps.find(([a, b]) => s.proj.s >= a && s.proj.s < b)
        // Never far enough back to read as a lap the wrong way, nor past the start of an open course.
        const back = Math.min(RESPAWN_BACK, this.track.closed ? this.track.length / 2 - 5 : Infinity)
        const at = (gap ? gap[0] : s.proj.s) - back
        const nitro = s.nitro
        this.state = createCar(this.track, this.track.closed ? this.track.wrapS(at) : Math.max(this.track.startS - 10, at))
        this.state.nitro = nitro
        // A lap with a jump back in it makes no ghost.
        this.recorder.reset()
        this.fx.clearSkids()
        this.placeCar()
        this.cam.cut(this.state.heading)
        if (this.phase === 'racing') this.events.popup({ text: 'RESPAWN', tone: 'danger' })
    }

    /** The state before a physics step, which rendering interpolates from. */
    private keepPrev() {
        const s = this.state
        this.prev.x = s.x
        this.prev.z = s.z
        this.prev.heading = s.heading
        this.prev.y = s.y
        this.prev.s = s.proj.s
        this.prev.lateral = s.proj.lateral
        this.prev.rel = s.rel
    }

    // ─── Main loop ─────────────────────────────────────────────────────────

    private readonly frame = (now: number) => {
        if (this.disposed) return
        this.raf = requestAnimationFrame(this.frame)
        // rAF stamps the frame's start, which can precede the clock read in the constructor.
        const dt = THREE.MathUtils.clamp((now - this.lastTime) / 1000, 0, 0.1)
        this.lastTime = now
        if (this.resolution.sample(dt, this.time)) this.resize()
        if (this.paused) {
            this.post.render()
            return
        }
        this.time += dt
        this.update(dt)
        this.render(dt)
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
                this.keepPrev()
                const racing = this.phase === 'racing'
                const ev = stepCar(this.state, this.stepInput(), this.track, STEP)
                if (ev.fell) this.respawn()
                if (racing) this.onStep(ev)
                if (racing && this.timer) for (const e of this.timer.update(this.timerS(), STEP)) this.onLapEvent(e)
            }
        }
        if (this.phase === 'finished' && this.time - this.finishedAt > RESTART_DELAY) this.start()
        // The menu's demo car on a sprint lines up again once it has pulled up past the finish.
        if (this.phase === 'attract' && !this.track.closed && this.state.proj.s > this.track.finishS && this.state.speed < 2) this.lineUpDemo()

        const s = this.state
        // Body motion and the camera lean off the car's real accelerations, smoothed.
        const dTravel = wrapAngle(s.travel - this.lastTravel)
        this.latAcc += (s.speed * dTravel / Math.max(dt, 1e-3) - this.latAcc) * Math.min(1, dt * 8)
        this.longAcc += ((s.speed - this.lastSpeed) / Math.max(dt, 1e-3) - this.longAcc) * Math.min(1, dt * 6)
        this.lastTravel = s.travel
        this.lastSpeed = s.speed

        if (this.phase === 'racing') {
            // Going the wrong way for a while gets a warning.
            const along = Math.cos(s.travel - headingOf(s.proj.tx, s.proj.tz)) * s.speed
            this.wrongWayTime = along < -3 ? this.wrongWayTime + dt : 0
            if (s.nitro >= 1 && !this.nitroReadyAnnounced && s.nitroTime <= 0) {
                this.nitroReadyAnnounced = true
                this.audio.nitroReady()
                this.events.popup({ text: 'NITRO READY', sub: 'SHIFT TO BOOST', tone: 'nitro' })
            }
        }
        const racing = this.phase === 'racing'
        // Off the plan (rails) or off the ground, there's no tarmac to leave marks on.
        const slide = s.onRail || s.airborne ? 0 : tyreSlide(s, this.playerInput(), racing)
        this.audio.skid(racing || this.phase === 'finished' ? slide * Math.min(1, Math.abs(s.speed) / 12) : 0)
        this.fx.tyres(dt, s, slide)

        this.world.update(dt, this.cam.camera)
        const lampDist = this.world.nearestLamp(s.x, s.proj.y, s.z, this.lampPos)
        this.lampLight.position.copy(this.lampPos)
        this.lampLight.color.copy(this.world.lampColor)
        this.lampLight.intensity = 160 * Math.max(0, 1 - lampDist / 16)

        this.fx.update(dt, this.car.group.position, s.nitroTime > 0)
    }

    private playerInput() {
        return carInput(this.controls, this.touch, this.state.drifting)
    }

    private stepInput(): CarInput {
        if (this.phase === 'racing') return this.playerInput()
        // Past the finish the car pulls itself up; the brake held at a standstill would reverse it.
        if (this.phase === 'finished') return { throttle: 0, brake: this.state.speed > 1 ? 1 : 0, steer: 0, drift: false }
        return botInput(this.state, this.track, DEMO_PACE)
    }

    private onStep(ev: StepEvents) {
        const s = this.state
        if (ev.landed > HARD_LANDING) {
            this.cam.shake(Math.min(0.8, ev.landed / 30))
            this.audio.bump()
        }
        if (ev.wallImpact > 1.5) {
            const k = Math.min(1, ev.wallImpact / 14)
            const hard = ev.wallImpact > 6
            this.cam.shake(0.15 + k * 0.45)
            this.fx.wallHit(s, k, hard)
            if (hard) {
                this.audio.bump()
                this.aberrationPulse = Math.max(this.aberrationPulse, 0.5)
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
            this.recentLaps = [{ lap: this.lapNumber(e.lap), time: e.time }, ...this.recentLaps].slice(0, RECENT_LAPS)
            const lapGhost = this.recorder.lap(e.time)
            const standing = this.track.closed && e.lap === 0
            const kept = this.bestGhost && { end: this.bestGhost.end, standing: !!rec.ghostStanding }
            // A lap that couldn't record a ghost keeps the old one, which is still a real lap.
            const stored = lapGhost && replacesGhost(kept, { time: e.time, standing }) ? encodeGhost(lapGhost) : null
            if (isBest || stored) {
                const next: TrackRecord = isBest ? { ...rec, bestLap: e.time, bestSplits: [...e.splits, e.time] } : { ...rec }
                this.record = stored ? withGhost(next, stored, standing) : next
                if (stored) this.bestGhost = decodeGhost(stored)
                this.events.record(this.track.def.id, this.record)
            }
            if (isBest) this.flash.setRGB(0.25, 0.2, 0.05)
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

    // ─── Ghosts ────────────────────────────────────────────────────────────

    /**
     * The lap clock at the moment the car is drawn, up to a physics step behind the timer;
     * null off the clock. Past a sprint's finish it keeps running, so a ghost still behind
     * gets to cross the line.
     */
    private drawnLapTime(): number | null {
        const timer = this.timer
        if (!timer || this.phase === 'attract') return null
        if (this.phase === 'finished') return (this.lastLap ?? 0) + (this.time - this.finishedAt)
        if (this.phase === 'countdown') return 0
        return Math.max(0, timer.clock - STEP + this.accumulator) - timer.lapStart
    }

    /** The kept ghost, replayed against the lap clock; on a loop a flying one carries on past the line until the car crosses it. */
    private readonly bestGhostSource: GhostSource = (_now, lapTime) => {
        const g = this.bestGhost
        if (!this.bestGhostOn || !g || lapTime === null) return []
        replayGhost(g, !!this.record.ghostStanding, this.track.closed, lapTime, this.bestGhostFrame.pose)
        return [this.bestGhostFrame]
    }

    /** Records the car as drawn, then draws every source's ghosts at the same lap time. Runs after the car and camera are placed. */
    private drawGhosts() {
        const lapTime = this.drawnLapTime()
        if (lapTime !== null && (this.phase === 'countdown' || this.phase === 'racing')) this.recorder.add(lapTime, this.carPose(this.recordPose))
        const now = performance.now()
        const shown = lapTime === null ? null : Math.max(0, lapTime)
        const frames = this.ghostFrames
        frames.length = 0
        for (const src of this.ghostSources) {
            try {
                frames.push(...src(now, shown))
            } catch (e) {
                // A broken source shouldn't stop the race being drawn.
                console.error('Nitro Rush: a ghost source failed and was removed', e)
                this.ghostSources.delete(src)
            }
        }
        this.ghosts.update(frames, now, this.cam.camera, this.height)
    }

    // ─── Camera, car pose, post and HUD ────────────────────────────────────

    private render(dt: number) {
        const s = this.state
        const racing = this.phase === 'racing'
        const nitro = s.nitroTime > 0
        this.nitroK += ((nitro ? 1 : 0) - this.nitroK) * Math.min(1, dt * (nitro ? 6 : 2.5))
        const speedK = THREE.MathUtils.clamp(Math.abs(s.speed) / ENGINE_TOP_SPEED, 0, 1)

        // Pose between the last two physics states, so motion is smooth at any refresh rate.
        this.poseAt(this.phase === 'countdown' ? 1 : this.accumulator / STEP)
        const { x, z, along } = this.drawn
        const y = this.drawnPos.y
        this.car.animate(dt, s, this.latAcc, this.longAcc, racing && this.controls.throttle)

        this.cam.update(dt, this.time, {
            x, y, z, along, heading: s.heading, travel: s.travel, slip: slipAngle(s), speed: s.speed, speedK, nitroK: this.nitroK, latAcc: this.latAcc,
            pos: this.drawnPos, quat: this.drawnQuat, onRail: s.onRail, airborne: s.airborne
        }, shotFor(this.phase, this.countdown, this.time - this.finishedAt))
        const blend = this.cam.blend
        this.fx.frame(dt, {
            camera: this.cam.camera, height: this.height, pixelRatio: this.resolution.ratio, yaw: this.cam.yaw, blend,
            roadY: y, speed: s.speed, speedK, nitroK: this.nitroK, nitro, tails: this.car.tailLights(this.tails)
        })

        this.drawGhosts()

        this.aberrationPulse = Math.max(0, this.aberrationPulse - dt * 2.6)
        this.flash.multiplyScalar(Math.exp(-dt * 7))
        this.post.set({
            radial: (this.nitroK * 0.16 + Math.max(0, speedK - 0.4) * 0.25) * blend,
            aberration: this.aberrationPulse + 0.08 * blend + this.nitroK * 0.25,
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
            lap: this.lapNumber(),
            closed: this.track.closed,
            lapTime: timer ? (timer.finished ? (this.lastLap ?? 0) : timer.lapTime) : 0,
            recentLaps: this.recentLaps,
            bestLap: this.record.bestLap,
            speedKmh: Math.round(Math.abs(s.speed) * KMH_PER_SPEED),
            nitro: nitro ? s.nitroTime / NITRO_DURATION : s.nitro,
            nitroActive: nitro,
            drifting: s.drifting,
            wrongWay: this.wrongWayTime > 1.2,
            car: { x: this.drawnPos.x, z: this.drawnPos.z, heading: this.drawn.heading },
            ghosts: this.ghostFrames.map((f): MapGhost => ({ x: f.pose.x, z: f.pose.z, color: f.color ?? GHOST_COLOR }))
        })
    }

    private get lastLap() {
        return this.recentLaps[0]?.time ?? null
    }

    /** 1-based number of the timer's 0-based `lap`, or of the run on an open course. */
    private lapNumber(lap = this.timer?.lap ?? 0) {
        return this.track.closed ? lap + 1 : this.runs
    }
}
