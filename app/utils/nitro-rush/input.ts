import type { Control } from './types'

/** The car responds to held keys, so each one maps to a control that is down until keyup. */
export const CONTROL_KEYS: Readonly<Record<string, Control>> = {
    ArrowUp: 'throttle', KeyW: 'throttle',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'handbrake'
}

export const NITRO_KEYS: ReadonlySet<string> = new Set(['ShiftLeft', 'ShiftRight', 'KeyE', 'KeyN'])

/** Keys typed into a field belong to the field, not the car. */
export function isTyping(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null
    return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
}
