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
