import type { CarInput } from './physics'
import type { Control } from './types'

/** The car responds to held keys, so each one maps to a control that is down until keyup. */
export const CONTROL_KEYS: Readonly<Record<string, Control>> = {
    ArrowUp: 'throttle', KeyW: 'throttle',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'drift',
    ShiftLeft: 'nitro', ShiftRight: 'nitro', KeyE: 'nitro', KeyN: 'nitro'
}

/** The held controls as the car's input; on touch the gas is held for the player and the pedal is brake and drift button in one. */
export function carInput(c: Readonly<Record<Control, boolean>>, touch: boolean, drifting: boolean): CarInput {
    const pedal = touch && c.drift
    return {
        // The pedal or brake key lifts the held gas to brake or reverse, but the pedal not through a drift.
        throttle: c.throttle || (touch && !c.brake && (!pedal || drifting)) ? 1 : 0,
        brake: c.brake || pedal ? 1 : 0,
        steer: (c.right ? 1 : 0) - (c.left ? 1 : 0),
        drift: c.drift,
        nitro: c.nitro
    }
}

/** The keys and the controller together, so a player can rest on either; the keys' steering wins as it's all or nothing. */
export function withPad(keys: CarInput, pad: CarInput | null): CarInput {
    if (!pad) return keys
    return {
        throttle: Math.max(keys.throttle, pad.throttle),
        brake: Math.max(keys.brake, pad.brake),
        steer: keys.steer || pad.steer,
        drift: keys.drift || pad.drift,
        nitro: !!(keys.nitro || pad.nitro)
    }
}

/** Keys typed into a field belong to the field, not the car. */
export function isTyping(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null
    return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
}
