import * as THREE from 'three'
import { ChaseCamera, shotFor } from './camera'
import { CarEffects, tyreSlide } from './car-fx'
import { disposeModelShared } from './car-kit'
import { CarView } from './car-view'
import { buildCityEnvironment } from './city'
import { COUNTDOWN_SECONDS, ENGINE_TOP_SPEED, findPaint, KMH_PER_SPEED, NIGHT, NITRO_DURATION, PHYSICS_HZ, type PaintId } from './config'
import { botInput, createCar, fireNitro, slipAngle, stepCar, type CarInput, type CarState, type StepEvents } from './physics'
import { RushPost } from './post'
import { AdaptiveResolution } from './resolution'
import { formatLapTime, LapTimer, type LapEvent } from '#shared/utils/nitro-rush/timing'
import { Track, wrapAngle } from '#shared/utils/nitro-rush/track'
import { findTrack, TRACKS } from '#shared/utils/nitro-rush/tracks'
import { World } from './world'
import type { NitroAudio } from './audio'
import { EMPTY_RECORD, type Control, type EngineEvents, type Phase, type TrackRecord } from './types'

/** The grid slot, this far behind the start line. */
const GRID_OFFSET = -14
/** How long an open course's finish holds before the next run lines up. */
const RESTART_DELAY = 2.5
const STEP = 1 / PHYSICS_HZ
/** Attract-mode demo laps run a touch off the limit. */
const DEMO_PACE = 0.85

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
    private readonly prev = { x: 0, z: 0, y: 0, s: 0, heading: 0 }
    private accumulator = 0
    private timer: LapTimer | null = null
    private record: TrackRecord = { ...EMPTY_RECORD }
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

    // Post
    private aberrationPulse = 0
    private readonly flash = new THREE.Color(0, 0, 0)
    private readonly tint = new THREE.Color()
    private nitroK = 0

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

        this.envTarget = buildCityEnvironment(this.renderer)
        this.scene.environment = this.envTarget.texture

        this.track = new Track(findTrack(trackId) ?? TRACKS[0]!)
        this.cam = new ChaseCamera(this.track)
        this.fx = new CarEffects(this.scene)
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

    get trackId() {
        return this.track.def.id
    }

    get trackName() {
        return this.track.def.name
    }

    setPaint(id: PaintId) {
        this.car.setPaint(findPaint(id).color)
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
        this.cam.setTrack(this.track)
        this.world = this.buildWorld()
        this.sizeWorld()
        this.record = { ...EMPTY_RECORD }
        this.sessionBest = null
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
        this.phase = 'countdown'
        this.countdown = COUNTDOWN_SECONDS
        this.countdownShown = COUNTDOWN_SECONDS + 1
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
        this.silence()
        this.post.dispose()
        this.world.dispose()
        this.fx.dispose()
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
        world.hideFromReflection(this.fx.speedLines.mesh)
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
        this.car.place(s.x, s.proj.y, s.z, s.heading, s.proj)
        this.fx.place(this.car.tailLights(this.tails))
    }

    /** The state before a physics step, which rendering interpolates from. */
    private keepPrev() {
        const s = this.state
        this.prev.x = s.x
        this.prev.z = s.z
        this.prev.heading = s.heading
        this.prev.y = s.proj.y
        this.prev.s = s.proj.s
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
                this.keepPrev()
                const racing = this.phase === 'racing'
                const ev = stepCar(this.state, this.stepInput(), this.track, STEP)
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
            const along = Math.cos(s.travel - Math.atan2(-s.proj.tx, -s.proj.tz)) * s.speed
            this.wrongWayTime = along < -3 ? this.wrongWayTime + dt : 0
            if (s.nitro >= 1 && !this.nitroReadyAnnounced && s.nitroTime <= 0) {
                this.nitroReadyAnnounced = true
                this.audio.nitroReady()
                this.events.popup({ text: 'NITRO READY', sub: 'SHIFT TO BOOST', tone: 'nitro' })
            }
        }
        const racing = this.phase === 'racing'
        const slide = tyreSlide(s, this.controls, racing)
        this.audio.skid(racing || this.phase === 'finished' ? slide * Math.min(1, Math.abs(s.speed) / 12) : 0)
        this.fx.tyres(dt, s, slide)

        this.world.update(dt, this.cam.camera)
        const lampDist = this.world.nearestLamp(s.x, s.proj.y, s.z, this.lampPos)
        this.lampLight.position.copy(this.lampPos)
        this.lampLight.color.copy(this.world.lampColor)
        this.lampLight.intensity = 160 * Math.max(0, 1 - lampDist / 16)

        this.fx.update(dt, this.car.group.position, s.nitroTime > 0)
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
        this.car.place(x, y, z, heading, s.proj)
        this.car.animate(dt, s, this.latAcc, this.longAcc, racing && this.controls.throttle)

        this.cam.update(dt, this.time, {
            x, y, z, along, heading: s.heading, travel: s.travel, slip: slipAngle(s), speed: s.speed, speedK, nitroK: this.nitroK, latAcc: this.latAcc
        }, shotFor(this.phase, this.countdown, this.time - this.finishedAt))
        const blend = this.cam.blend
        this.fx.frame(dt, {
            camera: this.cam.camera, height: this.height, pixelRatio: this.resolution.ratio, yaw: this.cam.yaw, blend,
            roadY: y, speed: s.speed, speedK, nitroK: this.nitroK, nitro, tails: this.car.tailLights(this.tails)
        })

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
