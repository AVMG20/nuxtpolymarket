import * as THREE from 'three'
import { NITRO_DURATION, PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { poseCar } from '../../app/utils/nitro-rush/car-pose'
import { GhostRecorder } from '../../app/utils/nitro-rush/ghost'
import { botInput, createCar, stepCar, type CarInput, type CarState } from '../../app/utils/nitro-rush/physics'
import { compileCustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { decodeGhost, encodeGhost, type Ghost, type StoredGhost } from '#shared/utils/nitro-rush/ghost'
import { LapTimer } from '#shared/utils/nitro-rush/timing'
import { Track } from '#shared/utils/nitro-rush/track'

/** Real laps for the specs: the demo bot driving a course from the grid, recorded the way the engine records a ghost. */

const DT = 1 / PHYSICS_HZ
/** The engine's grid, behind the start line. */
const GRID_OFFSET = -14

export const RECTANGLE: SectionId[] = ['start', 'straight-100', 'right-tight', 'right-tight', 'straight-100', 'straight-20', 'right-tight', 'right-tight']
export const LONG_RECTANGLE: SectionId[] = RECTANGLE.map(s => s === 'straight-100' ? 'straight-200' : s)
export const STUNT_SPRINT: SectionId[] = ['straight-20', 'start', 'straight-100', 'jump', 'straight-100', 'looping-right', 'straight-100', 'corkscrew-left', 'straight-100', 'right-spiral-up', 'straight-100', 'left-banked', 'straight-60', 'right-hairpin', 'straight-100', 'big-jump', 'straight-100', 'finish', 'straight-200']

export function trackOf(closed: boolean, sections: SectionId[]) {
    const { def, error } = compileCustomTrack({ id: 'custom-drive', name: 'Drive', closed, sections })
    if (!def) throw new Error(error ?? 'no track')
    return new Track(def)
}

/** The demo bot's lap from the grid, recorded as the engine does; on a loop `lap` 1 is the first flying lap. */
export function drive(track: Track, lap = 0): Ghost {
    return recordRun(track, createCar(track, track.startS + GRID_OFFSET), car => botInput(car, track), lap)
}

/** A run down a straight course held at `speed` on the ground with nitro lit, `lateral` off the centreline: flights off jumps follow the real physics. */
export function driveFlatOut(track: Track, speed: number, lateral = 0): Ghost {
    const car = createCar(track, track.startS + GRID_OFFSET, lateral)
    car.speed = speed
    return recordRun(track, car, (c) => {
        c.nitroTime = NITRO_DURATION
        if (!c.airborne) c.speed = speed
        return { throttle: 1, brake: 0, steer: 0, drift: false }
    })
}

function recordRun(track: Track, car: CarState, input: (car: CarState) => CarInput, lap = 0): Ghost {
    const timer = new LapTimer(track.lapLength, track.closed, GRID_OFFSET, track.checkpointDistances)
    const recorder = new GhostRecorder()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const record = () => {
        poseCar(track, { x: car.x, z: car.z, y: car.y, along: car.proj.s, lateral: car.proj.lateral, heading: car.heading, rel: car.rel, vy: car.vy, speed: car.speed, onRail: car.onRail, airborne: car.airborne }, pos, quat)
        recorder.add(timer.lapTime, { x: pos.x, y: pos.y, z: pos.z, qx: quat.x, qy: quat.y, qz: quat.z, qw: quat.w })
    }
    record()
    for (let i = 0; i < PHYSICS_HZ * 240; i++) {
        const ev = stepCar(car, input(car), track, DT)
        if (ev.fell) throw new Error('the bot fell')
        for (const e of timer.update(track.closed ? car.proj.s : car.proj.s - track.startS, DT)) {
            if (e.type !== 'lap') continue
            const ghost = recorder.lap(e.time)
            if (e.lap === lap) {
                // Through the stored form, as the server sees it.
                const back = ghost && decodeGhost(encodeGhost(ghost))
                if (!back) throw new Error('no ghost')
                return back
            }
        }
        record()
    }
    throw new Error('the lap never closed')
}

/** The bot's lap on a course as the client sends it to publish: a loop's standing first lap, or a sprint's run. */
export function publishLap(closed: boolean, sections: SectionId[]): { ghost: StoredGhost, standing: boolean } {
    return { ghost: encodeGhost(drive(trackOf(closed, sections)))!, standing: closed }
}
