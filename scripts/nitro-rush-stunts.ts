/**
 * Drives the menu's demo bot through Nitro Rush's stunt sections and reports
 * how each went: time, seconds on rails and in the air, falls, height and the
 * hardest landing. For tuning jumps, loopings and corkscrews.
 *
 *   bun --tsconfig-override .nuxt/tsconfig.app.json scripts/nitro-rush-stunts.ts
 *
 * (The override gives Bun the `#shared` alias; run `bunx nuxt prepare` first on a fresh checkout.)
 */
import { compileCustomTrack, newCustomTrack, type SectionId } from '../shared/utils/nitro-rush/custom'
import { Track } from '../shared/utils/nitro-rush/track'
import { botInput, createCar, stepCar } from '../app/utils/nitro-rush/physics'

const HZ = 120
const RESPAWN_BACK = 120

function drive(label: string, sections: SectionId[], pace = 1) {
    const course = newCustomTrack(false)
    course.sections = sections
    const compiled = compileCustomTrack(course)
    if (!compiled.def) return console.log(label.padEnd(14), 'does not build:', compiled.error)
    const track = new Track(compiled.def)
    const car = createCar(track, track.startS - 14)
    let rail = 0
    let air = 0
    let falls = 0
    let top = 0
    let landing = 0
    let slowestOnRail = Infinity
    let steps = 0
    for (; steps < HZ * 120 && car.proj.s < track.finishS; steps++) {
        const ev = stepCar(car, botInput(car, track, pace), track, 1 / HZ)
        if (car.onRail) {
            rail++
            slowestOnRail = Math.min(slowestOnRail, car.speed)
        }
        if (car.airborne) air++
        if (ev.fell) {
            falls++
            Object.assign(car, createCar(track, Math.max(track.startS, car.proj.s - RESPAWN_BACK)))
        }
        landing = Math.max(landing, ev.landed)
        top = Math.max(top, car.y)
        if (!Number.isFinite(car.x + car.z + car.y + car.speed)) return console.log(label.padEnd(14), 'went NaN after', steps, 'steps')
    }
    console.log(label.padEnd(14), [
        car.proj.s >= track.finishS ? `finished in ${(steps / HZ).toFixed(1)}s` : 'did not finish',
        `rails ${(rail / HZ).toFixed(1)}s`,
        `air ${(air / HZ).toFixed(1)}s`,
        `falls ${falls}`,
        `top ${top.toFixed(1)}m`,
        `hardest landing ${landing.toFixed(1)}m/s`,
        slowestOnRail < Infinity ? `slowest on rails ${slowestOnRail.toFixed(1)}m/s` : ''
    ].filter(Boolean).join(' · '))
}

const runIn: SectionId[] = ['straight-20', 'start']
const runOut: SectionId[] = ['finish', 'straight-200']
drive('looping', [...runIn, 'straight-200', 'straight-200', 'looping-right', 'straight-100', ...runOut])
drive('looping cold', [...runIn, 'looping-right', 'straight-100', ...runOut])
drive('corkscrew', [...runIn, 'straight-200', 'corkscrew-left', 'straight-100', ...runOut])
drive('jumps', [...runIn, 'straight-200', 'jump', 'straight-100', 'big-jump', 'straight-200', ...runOut])
drive('jump cold', [...runIn, 'straight-50', 'big-jump', 'straight-100', ...runOut])
drive('banks', [...runIn, 'straight-100', 'right-banked', 'straight-100', 'left-banked', 'straight-100', ...runOut])
