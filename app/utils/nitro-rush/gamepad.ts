import type { CarInput } from './physics'

/** What the buttons of a standard controller do besides driving; each fires once per press. */
export type PadCommand = 'confirm' | 'back' | 'nitro' | 'pause' | 'restart' | 'previous' | 'next'

/** A controller as far as the game reads it. */
export type PadSource = Pick<Gamepad, 'axes' | 'buttons'>

export interface PadRead {
    car: CarInput
    /** Commands whose button is down. */
    held: ReadonlySet<PadCommand>
    /** Anything pressed or pushed past its dead zone. */
    active: boolean
}

// Button numbers of the browser's standard mapping, which every pad we accept has been mapped onto.
const A = 0
const B = 1
const X = 2
const LB = 4
const RB = 5
const LT = 6
const RT = 7
const BACK = 8
const START = 9
const UP = 12
const DOWN = 13
const LEFT = 14
const RIGHT = 15

const COMMAND_BUTTONS: Readonly<Record<PadCommand, readonly number[]>> = {
    confirm: [A],
    back: [B],
    nitro: [X, LB],
    pause: [START],
    restart: [BACK],
    previous: [UP, LEFT],
    next: [DOWN, RIGHT]
}
const COMMANDS = Object.keys(COMMAND_BUTTONS) as PadCommand[]

/** Worn sticks rest off centre, and triggers rest a little open. */
const STICK_DEAD_ZONE = 0.15
const TRIGGER_DEAD_ZONE = 0.05

/** `v` with its dead zone cut out, rescaled so the wheel still starts from nothing and reaches full lock. */
function pastDeadZone(v: number, zone: number) {
    const size = Math.abs(v)
    return size <= zone ? 0 : Math.sign(v) * Math.min(1, (size - zone) / (1 - zone))
}

/** The controller to drive with: pads with no standard mapping have unknown buttons, and some keyboards and mice report as one. */
export function firstPad<T extends Pick<Gamepad, 'mapping'>>(pads: readonly (T | null)[]): T | null {
    return pads.find(p => p?.mapping === 'standard') ?? null
}

export function readPad({ axes, buttons }: PadSource): PadRead {
    const value = (i: number) => buttons[i]?.value ?? 0
    const down = (i: number) => !!buttons[i]?.pressed
    const stick = pastDeadZone(axes[0] ?? 0, STICK_DEAD_ZONE)
    const throttle = pastDeadZone(value(RT), TRIGGER_DEAD_ZONE)
    const brake = pastDeadZone(value(LT), TRIGGER_DEAD_ZONE)
    const steer = stick || (down(RIGHT) ? 1 : 0) - (down(LEFT) ? 1 : 0)
    const held = new Set(COMMANDS.filter(c => COMMAND_BUTTONS[c].some(down)))
    const drift = down(A) || down(RB)
    return {
        car: { throttle, brake, steer, drift },
        held,
        active: held.size > 0 || !!(throttle || brake || steer || drift)
    }
}

/** Turns what's held each frame into what was just pressed. */
export class PadPresses {
    private last: ReadonlySet<PadCommand> = new Set()

    take(held: ReadonlySet<PadCommand>) {
        const pressed = COMMANDS.filter(c => held.has(c) && !this.last.has(c))
        this.last = held
        return pressed
    }
}
