import type * as THREE from 'three'
import { GhostRecorder, replayGhost } from './ghost'
import { GhostView } from './ghost-view'
import type { CarPose, GhostFrame, GhostSource } from './types'
import type { Ghost, KeptGhost } from '#shared/utils/nitro-rush/ghost'
import type { CarId } from '#shared/utils/nitro-rush/cars'

interface GhostDraw {
    /** The lap clock as the car is drawn; null off the clock. */
    lapTime: number | null
    recording: boolean
    closed: boolean
    camera: THREE.PerspectiveCamera
    height: number
}

/** The race's ghosts: records the lap being driven, replays the kept one and draws every registered source. */
export class RaceGhosts {
    private readonly view: GhostView
    private readonly sources = new Set<GhostSource>()
    private readonly recorder = new GhostRecorder()
    private readonly recordPose: CarPose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }
    private readonly keptFrame: GhostFrame = { id: 'self:best', pose: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 } }
    private readonly drawnFrames: GhostFrame[] = []
    private ghost: Ghost | null = null
    private standing = false
    private shown = true
    private closed = false

    constructor(scene: THREE.Scene) {
        this.view = new GhostView(scene)
        this.sources.add(this.keptSource)
    }

    get group() {
        return this.view.group
    }

    get frames(): readonly GhostFrame[] {
        return this.drawnFrames
    }

    /** The kept ghost as the keep rule compares it, in seconds. */
    get kept(): KeptGhost | null {
        return this.ghost && { end: this.ghost.end, standing: this.standing }
    }

    setKept(ghost: Ghost | null, standing: boolean) {
        this.ghost = ghost
        this.standing = standing
    }

    /** Shows or hides the kept ghost; other sources are not affected. */
    setShown(on: boolean) {
        this.shown = on
    }

    /** Adds ghosts to draw every frame; returns the function that removes them. */
    addSource(src: GhostSource): () => void {
        this.sources.add(src)
        return () => {
            this.sources.delete(src)
        }
    }

    restartLap() {
        this.recorder.reset()
    }

    /** The ghost of the lap that just ended in `car`, if it recorded whole. */
    finishLap(time: number, car: CarId): Ghost | null {
        const ghost = this.recorder.lap(time)
        return ghost && { ...ghost, car }
    }

    // On a loop a flying ghost carries on past the line until the car crosses it.
    private readonly keptSource: GhostSource = (_now, lapTime) => {
        if (!this.shown || !this.ghost || lapTime === null) return []
        replayGhost(this.ghost, this.standing, this.closed, lapTime, this.keptFrame.pose)
        this.keptFrame.car = this.ghost.car
        return [this.keptFrame]
    }

    /** Records the car as drawn, then draws everything at the same lap time; runs after the car and camera are placed. */
    draw({ lapTime, recording, closed, camera, height }: GhostDraw, carPose: (out: CarPose) => CarPose) {
        this.closed = closed
        if (lapTime !== null && recording) this.recorder.add(lapTime, carPose(this.recordPose))
        const now = performance.now()
        const at = lapTime === null ? null : Math.max(0, lapTime)
        const frames = this.drawnFrames
        frames.length = 0
        for (const src of this.sources) {
            try {
                frames.push(...src(now, at))
            } catch (e) {
                // A broken source shouldn't stop the race being drawn.
                console.error('Nitro Rush: a ghost source failed and was removed', e)
                this.sources.delete(src)
            }
        }
        this.view.update(frames, now, camera, height)
    }

    dispose() {
        this.view.dispose()
        this.sources.clear()
    }
}
