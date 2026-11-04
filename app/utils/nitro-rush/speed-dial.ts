/** The speedometer's scale: where each speed sits on the dial, and the ticks and arcs drawn round it. */

import { ENGINE_TOP_SPEED, KMH_PER_SPEED, NITRO_TOP_SPEED_MULT } from './config'

/** The dial's view box side, in its own units. */
export const DIAL_VIEW = 100
const CENTRE = DIAL_VIEW / 2
/** Zero sits low on the left and the top of the scale low on the right, like a car's dial; screen angles, y down. */
const START = Math.PI * 5 / 6
const SWEEP = Math.PI * 4 / 3

/** Rounded up past nitro's top speed, so the needle never pins. */
export const DIAL_MAX_KMH = Math.ceil(ENGINE_TOP_SPEED * NITRO_TOP_SPEED_MULT * KMH_PER_SPEED / 50) * 50
/** Past the engine's own top speed only nitro reaches. */
export const DIAL_NITRO_KMH = Math.round(ENGINE_TOP_SPEED * KMH_PER_SPEED)
const MINOR_KMH = 20
const MAJOR_KMH = 100

export interface DialTick {
    x1: number
    y1: number
    x2: number
    y2: number
    major: boolean
}

export interface DialLabel {
    x: number
    y: number
    text: string
}

/** A speed's screen angle on the dial, clamped onto the scale. */
export function dialAngle(kmh: number, max = DIAL_MAX_KMH) {
    return START + SWEEP * Math.min(1, Math.max(0, kmh / max))
}

/** SVG rotation, in degrees, that turns a needle drawn pointing right to `kmh`. */
export const needleRotation = (kmh: number) => dialAngle(kmh) * 180 / Math.PI

const num = (v: number) => Math.round(v * 100) / 100

function onDial(angle: number, r: number): [number, number] {
    return [num(CENTRE + Math.cos(angle) * r), num(CENTRE + Math.sin(angle) * r)]
}

/** An arc round the dial's centre from one speed to another, as an SVG path; empty when it has no length. */
export function dialArc(fromKmh: number, toKmh: number, r: number) {
    const a = dialAngle(fromKmh)
    const b = dialAngle(toKmh)
    if (b - a < 1e-4) return ''
    const [x1, y1] = onDial(a, r)
    const [x2, y2] = onDial(b, r)
    return `M${x1} ${y1}A${r} ${r} 0 ${b - a > Math.PI ? 1 : 0} 1 ${x2} ${y2}`
}

/** A tick every 20 km/h from `r` inward, the hundreds longer. */
export function dialTicks(r: number): DialTick[] {
    const ticks: DialTick[] = []
    for (let kmh = 0; kmh <= DIAL_MAX_KMH; kmh += MINOR_KMH) {
        const major = kmh % MAJOR_KMH === 0
        const a = dialAngle(kmh)
        const [x1, y1] = onDial(a, r)
        const [x2, y2] = onDial(a, r - (major ? 7 : 4))
        ticks.push({ x1, y1, x2, y2, major })
    }
    return ticks
}

/** The hundreds, written just inside the ticks at radius `r`. */
export function dialLabels(r: number): DialLabel[] {
    const labels: DialLabel[] = []
    for (let kmh = 0; kmh <= DIAL_MAX_KMH; kmh += MAJOR_KMH) {
        const [x, y] = onDial(dialAngle(kmh), r)
        labels.push({ x, y, text: String(kmh) })
    }
    return labels
}
