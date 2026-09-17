/** Camera-relative right/forward movement projected onto the town's ground. */
export function townCameraMove(right: number, forward: number, yaw: number) {
    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    return { x: right * cos - forward * sin, z: -right * sin - forward * cos }
}

/** Grab the ground: the town follows the pointer on both screen axes. */
export function townDragDelta(dx: number, dy: number, yaw: number, pitch: number, unitsPerPixel: number) {
    return townCameraMove(-dx * unitsPerPixel, dy * unitsPerPixel / Math.sin(pitch), yaw)
}

export function townKeyboardDelta(right: number, forward: number, yaw: number, distance: number) {
    const length = Math.hypot(right, forward)
    if (!length) return { x: 0, z: 0 }
    return townCameraMove(right / length * distance, forward / length * distance, yaw)
}

export function townIsTyping(target: EventTarget | null) {
    return target instanceof HTMLElement && (!!target.closest('input, textarea, select, [role="textbox"]') || target.isContentEditable)
}

/**
 * Turn one wheel event into a zoom factor to multiply the camera distance by.
 * Proportional to how far the wheel actually moved, so a trackpad's stream of
 * tiny deltas zooms gently instead of firing a full notch each — and clamped,
 * so one violent flick cannot throw the camera across its whole range.
 * Lines and pages (Firefox, some mice) are converted to pixels first.
 */
export function townWheelZoomFactor(deltaY: number, deltaMode = 0) {
    const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY
    const clamped = Math.max(-60, Math.min(60, pixels))
    return Math.exp(clamped * 0.0025)
}

/** Quarter-turn snap: how many 45° steps a dragged distance has crossed, and what is left over. */
export function townSnapTurn(accumulated: number, pixelsPerStep = 70) {
    const steps = Math.trunc(accumulated / pixelsPerStep)
    return { steps, remainder: accumulated - steps * pixelsPerStep }
}
