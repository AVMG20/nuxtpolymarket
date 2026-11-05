import * as THREE from 'three'
import { ChaseCamera, shotFor } from './camera'
import { CarEffects, tyreSlide } from './car-fx'
import { disposeModelShared } from './car-kit'
import { CarMotion } from './car-motion'
import { CarView } from './car-view'
import { buildCityEnvironment } from './city'
import { COUNTDOWN_SECONDS, ENGINE_TOP_SPEED, findPaint, GHOST_COLOR, KMH_PER_SPEED, NIGHT, NITRO_DURATION, PHYSICS_HZ, type PaintId } from './config'
import { botInput, createCar, fireNitro, slipAngle, stepCar, surging, type CarInput, type CarState } from './physics'
import { RaceFeedback } from './race-feedback'
import { RaceGhosts } from './race-ghosts'
import { RaceGrade } from './race-grade'
import { settleLap } from './record'
import { carInput } from './input'
import { createRushRenderer, RushPost } from './post'
import { prewarm } from './prewarm'
import { AdaptiveResolution } from './resolution'
import { decodeGhost } from '#shared/utils/nitro-rush/ghost'
import { LapTimer, type LapEvent } from '#shared/utils/nitro-rush/timing'
import { headingOf, Track, type TrackDef } from '#shared/utils/nitro-rush/track'
import { World } from './world'
import type { NitroAudio } from './audio'
import { EMPTY_RECORD, type CarPose, type Control, type EngineEvents, type GhostSource, type LapEntry, type MapGhost, type Phase, type TrackRecord } from './types'

/** The grid slot, this far behind the start line. */
const GRID_OFFSET = -14
/** How long an open course's finish holds before the next run lines up. */
const RESTART_DELAY = 2.5
const STEP = 1 / PHYSICS_HZ
/** A car that drops into a jump's gap starts again this far before it, at a standstill. */
const RESPAWN_BACK = 120
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
    private readonly motion = new CarMotion()
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

    private readonly ghosts: RaceGhosts
    private readonly grade = new RaceGrade()
    private readonly feedback: RaceFeedback

    constructor(host: HTMLElement, events: EngineEvents, audio: NitroAudio, paint: PaintId, track: TrackDef) {
        this.host = host
        this.events = events
        this.audio = audio

        this.renderer = createRushRenderer(host)

        this.envTarget = buildCityEnvironment(this.renderer)
        this.scene.environment = this.envTarget.texture

        this.track = new Track(track)
        this.cam = new ChaseCamera(this.track)
        this.fx = new CarEffects(this.scene)
        this.ghosts = new RaceGhosts(this.scene)
        this.feedback = new RaceFeedback({ audio, events, grade: this.grade, cam: this.cam, fx: this.fx })
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
        prewarm(this.renderer, this.scene, this.cam.camera, this.post.sceneTarget)
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
        this.ghosts.setKept(decodeGhost(r.ghost), !!r.ghostStanding)
    }

    /** Shows or hides the kept lap's ghost; other ghost sources are not affected. */
    setBestGhost(on: boolean) {
        this.ghosts.setShown(on)
    }

    /** Adds ghosts to draw: every rendered frame the engine calls `src(performance.now(), lapTime)` and draws what it returns. */
    addGhostSource(src: GhostSource): () => void {
        return this.ghosts.addSource(src)
    }

    /** The player's car where it is drawn this frame. */
    carPose(out?: CarPose): CarPose {
        return this.car.pose(out)
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
        prewarm(this.renderer, this.scene, this.cam.camera, this.post.sceneTarget)
        this.record = { ...EMPTY_RECORD }
        this.ghosts.setKept(null, false)
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
        this.feedback.nitroFired(this.state)
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
        this.ghosts.restartLap()
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
        this.resolution.fit(w, h)
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
        this.ghosts.restartLap()
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
        this.motion.snap(this.state, this.track)
        this.car.place(this.motion.pos, this.motion.quat)
        this.fx.place(this.car.tailLights(this.tails))
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
        this.ghosts.restartLap()
        this.fx.clearSkids()
        this.placeCar()
        this.cam.cut(this.state.heading)
        if (this.phase === 'racing') this.events.popup({ text: 'RESPAWN', tone: 'danger' })
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
                this.feedback.countdown(n)
            }
            if (this.countdown <= 0) {
                this.phase = 'racing'
                this.world.setStartLights(5, true)
                this.feedback.go()
                this.events.phase(this.phase)
            }
        }

        // The grid holds the car still through the countdown; otherwise physics runs at a fixed rate.
        if (this.phase !== 'countdown') {
            this.accumulator += dt
            while (this.accumulator >= STEP) {
                this.accumulator -= STEP
                this.motion.keep(this.state)
                const racing = this.phase === 'racing'
                const ev = stepCar(this.state, this.stepInput(), this.track, STEP)
                if (ev.fell) this.respawn()
                if (racing) this.feedback.step(ev, this.state)
                if (racing && this.timer) for (const e of this.timer.update(this.timerS(), STEP)) this.onLapEvent(e)
            }
        }
        if (this.phase === 'finished' && this.time - this.finishedAt > RESTART_DELAY) this.start()
        // The menu's demo car on a sprint lines up again once it has pulled up past the finish.
        if (this.phase === 'attract' && !this.track.closed && this.state.proj.s > this.track.finishS && this.state.speed < 2) this.lineUpDemo()

        const s = this.state
        this.motion.sense(s, dt)

        if (this.phase === 'racing') {
            // Going the wrong way for a while gets a warning.
            const along = Math.cos(s.travel - headingOf(s.proj.tx, s.proj.tz)) * s.speed
            this.wrongWayTime = along < -3 ? this.wrongWayTime + dt : 0
            if (s.nitro >= 1 && !this.nitroReadyAnnounced && s.nitroTime <= 0) {
                this.nitroReadyAnnounced = true
                this.feedback.nitroReady()
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

        this.fx.update(dt, this.car.group.position, surging(s))
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

    private onLapEvent(e: LapEvent) {
        const rec = this.record
        if (e.type === 'split') {
            // Splits saved before the course had these checkpoints mark other points on the lap.
            const best = rec.bestSplits?.length === this.track.checkpoints.length + 1 ? rec.bestSplits[e.sector] : undefined
            if (best === undefined) return
            this.feedback.split(e.time - best, e.sector)
        } else {
            const label = this.track.closed ? `LAP ${e.lap + 1}` : 'FINISH'
            this.recentLaps = [{ lap: this.lapNumber(e.lap), time: e.time }, ...this.recentLaps].slice(0, RECENT_LAPS)
            const { isBest, record, stored, standing } = settleLap(rec, e, this.track.closed, this.ghosts.kept, this.ghosts.finishLap(e.time))
            if (record) {
                this.record = record
                if (stored) this.ghosts.setKept(decodeGhost(stored), standing)
                this.events.record(this.track.def.id, record)
            }
            this.feedback.lap(label, e.time, rec.bestLap, isBest)
            if (!this.track.closed) {
                this.phase = 'finished'
                this.finishedAt = this.time
                this.feedback.finish()
                this.events.phase(this.phase)
            }
        }
    }

    /** The lap clock as the car is drawn, up to a step behind the timer; past a sprint's finish it runs on so a ghost behind can still cross. */
    private drawnLapTime(): number | null {
        const timer = this.timer
        if (!timer || this.phase === 'attract') return null
        if (this.phase === 'finished') return (this.lastLap ?? 0) + (this.time - this.finishedAt)
        if (this.phase === 'countdown') return 0
        return Math.max(0, timer.clock - STEP + this.accumulator) - timer.lapStart
    }

    // ─── Camera, car pose, post and HUD ────────────────────────────────────

    private render(dt: number) {
        const s = this.state
        const racing = this.phase === 'racing'
        const surge = surging(s)
        this.grade.easeNitro(dt, surge)
        const nitroK = this.grade.nitroK
        const speedK = THREE.MathUtils.clamp(Math.abs(s.speed) / ENGINE_TOP_SPEED, 0, 1)

        // Pose between the last two physics states, so motion is smooth at any refresh rate.
        const m = this.motion
        m.pose(s, this.track, this.phase === 'countdown' ? 1 : this.accumulator / STEP)
        this.car.place(m.pos, m.quat)
        const { x, z, along, lateral } = m.drawn
        const y = m.pos.y
        this.car.animate(dt, s, m.latAcc, m.longAcc, racing && this.controls.throttle)

        this.cam.update(dt, this.time, {
            x, y, z, along, lateral, heading: s.heading, travel: s.travel, slip: slipAngle(s), speed: s.speed, speedK, nitroK, latAcc: m.latAcc,
            pos: m.pos, quat: m.quat, onRail: s.onRail, airborne: s.airborne
        }, shotFor(this.phase, this.countdown, this.time - this.finishedAt))
        const blend = this.cam.blend
        this.fx.frame(dt, {
            camera: this.cam.camera, height: this.height, pixelRatio: this.resolution.ratio, yaw: this.cam.yaw, blend,
            roadY: y, speed: s.speed, speedK, nitroK, nitro: surge, tails: this.car.tailLights(this.tails)
        })

        this.ghosts.draw({
            lapTime: this.drawnLapTime(),
            recording: this.phase === 'countdown' || this.phase === 'racing',
            closed: this.track.closed,
            camera: this.cam.camera,
            height: this.height
        }, out => this.car.pose(out))

        this.grade.apply(this.post, dt, speedK, blend)
        this.post.render()

        const live = this.phase !== 'attract'
        this.audio.engine(speedK, surge, live)
        this.audio.setIntensity(racing ? 0.25 + speedK * 0.75 : 0)
        // Nothing shows a HUD on the menu, and each one re-renders the game's root component.
        if (live) this.emitHud(s.nitroTime > 0)
    }

    private emitHud(nitro: boolean) {
        const s = this.state
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
            car: { x: this.motion.pos.x, z: this.motion.pos.z, heading: this.motion.drawn.heading },
            ghosts: this.ghosts.frames.map((f): MapGhost => ({ x: f.pose.x, z: f.pose.z, color: f.color ?? GHOST_COLOR }))
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
