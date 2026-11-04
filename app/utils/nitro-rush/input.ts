import type { CarInput } from './physics'
import type { Control } from './types'

/** The car responds to held keys, so each one maps to a control that is down until keyup. */
export const CONTROL_KEYS: Readonly<Record<string, Control>> = {
    ArrowUp: 'throttle', KeyW: 'throttle',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'drift'
}

export const NITRO_KEYS: ReadonlySet<string> = new Set(['ShiftLeft', 'ShiftRight', 'KeyE', 'KeyN'])

/** The held controls as the car's input; on touch the gas is held for the player and the pedal is brake and drift button in one. */
export function carInput(c: Readonly<Record<Control, boolean>>, touch: boolean, drifting: boolean): CarInput {
    const pedal = touch && c.drift
    return {
        // The pedal or brake key lifts the held gas to brake or reverse, but the pedal not through a drift.
        throttle: c.throttle || (touch && !c.brake && (!pedal || drifting)) ? 1 : 0,
        brake: c.brake || pedal ? 1 : 0,
        steer: (c.right ? 1 : 0) - (c.left ? 1 : 0),
        drift: c.drift
    }
}

/** Keys typed into a field belong to the field, not the car. */
export function isTyping(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null
    return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
}
