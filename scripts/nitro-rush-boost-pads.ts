import { BOOST_DURATION, BOOST_KICK, KMH_PER_SPEED, PHYSICS_HZ } from '../app/utils/nitro-rush/config'
import { createCar, stepCar } from '../app/utils/nitro-rush/physics'
import { compileCustomTrack, type SectionId } from '../shared/utils/nitro-rush/custom'
import { Track } from '../shared/utils/nitro-rush/track'

/** What one boost pad is worth: the time to the end of a straight with and without it, entering at each speed. */

const DT = 1 / PHYSICS_HZ
const ENTRY_SPEEDS = [20, 40, 60, 80, 86, 100]
const LEAD_IN = 100

function course(middle: SectionId): Track {
    const sections: SectionId[] = ['straight-20', 'start', 'straight-100', middle, 'straight-200', 'straight-200', 'straight-200', 'finish', 'straight-200']
    const { def, error } = compileCustomTrack({ id: 'custom-balance', name: 'Balance', closed: false, sections })
    if (!def) throw new Error(error ?? 'no track')
    return new Track(def)
}

function run(track: Track, entry: number) {
    const car = createCar(track, LEAD_IN)
    car.speed = entry
    const end = track.finishS
    let time = 0
    let top = 0
    while (car.proj.s < end) {
        stepCar(car, { throttle: 1, brake: 0, steer: 0, drift: false }, track, DT)
        time += DT
        top = Math.max(top, car.speed)
    }
    return { time, top }
}

const plain = course('straight-20')
const boosted = course('boost-pad')
console.log(`kick ${BOOST_KICK} m/s, surge ${BOOST_DURATION} s`)
console.log('entry km/h | top km/h | time saved')
for (const entry of ENTRY_SPEEDS) {
    const without = run(plain, entry)
    const over = run(boosted, entry)
    console.log(`${String(Math.round(entry * KMH_PER_SPEED)).padStart(10)} | ${String(Math.round(over.top * KMH_PER_SPEED)).padStart(8)} | ${(without.time - over.time).toFixed(3)} s`)
}
