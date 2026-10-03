/** Where the screen being left sat as its iris shut, in viewport pixels. */
export interface HqIntroRect {
    x: number
    y: number
    width: number
    height: number
}

/** A point in an element, as shares of its width and height. */
export interface HqFocus {
    x: number
    y: number
}

/** How long a hand-over waits for the next screen to mount, over a slow first load, before going stale. */
const INTRO_FRESH_MS = 3000
const IRIS_CLOSE_MS = 450
const IRIS_OPEN_MS = 550
const GROW_MS = 420

/**
 * The hand-over between Hero Quest's screens (the splash, the battle stage, the prestige bridge):
 * the box the one leaving shut its iris on, for the one arriving to grow out of.
 */
export function useHqIntro() {
    return useState<(HqIntroRect & { at: number }) | null>('hq-intro', () => null)
}

/** Hand the box over, or null to go straight in. */
export function handOverHqIntro(rect: HqIntroRect | null): void {
    useHqIntro().value = rect ? { ...rect, at: performance.now() } : null
}

/**
 * Take the hand-over, once: the box to grow out of, or null. A stale one (the player went in on
 * another tab, and reached the battle later) is dropped rather than played late.
 */
export function takeHqIntro(): HqIntroRect | null {
    const state = useHqIntro()
    const handed = state.value
    state.value = null
    return handed && performance.now() - handed.at < INTRO_FRESH_MS ? handed : null
}

/** A player who asked for less motion goes straight in. */
export function prefersReducedMotion(): boolean {
    return import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function rectOf(el: HTMLElement): HqIntroRect {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
}

/** The circle at `focus` that just covers the element: its centre and radius in pixels. */
function circleOver(el: HTMLElement, focus: HqFocus) {
    const r = el.getBoundingClientRect()
    const cx = r.width * focus.x
    const cy = r.height * focus.y
    return { cx, cy, reach: Math.hypot(Math.max(cx, r.width - cx), Math.max(cy, r.height - cy)) }
}

/** Shut a circle onto `focus`, leaving the element clipped away. Resolves once shut, or if it is cancelled. */
export function irisClose(el: HTMLElement, focus: HqFocus): Promise<void> {
    const { cx, cy, reach } = circleOver(el, focus)
    return el.animate([
        { clipPath: `circle(${reach}px at ${cx}px ${cy}px)` },
        { clipPath: `circle(0px at ${cx}px ${cy}px)` }
    ], { duration: IRIS_CLOSE_MS, easing: 'ease-in', fill: 'forwards' }).finished.then(() => {}, () => {})
}

/** Open a circle out of `focus` until the element is whole again. */
export function irisOpen(el: HTMLElement, focus: HqFocus): Promise<void> {
    const { cx, cy, reach } = circleOver(el, focus)
    return el.animate([
        { clipPath: `circle(0px at ${cx}px ${cy}px)` },
        { clipPath: `circle(${reach}px at ${cx}px ${cy}px)` }
    ], { duration: IRIS_OPEN_MS, easing: 'ease-out' }).finished.then(() => {}, () => {})
}

/** Slide and scale the element from where `from` sat to where it is (FLIP). Start it before the element first paints. */
export function growFrom(el: HTMLElement, from: HqIntroRect): Promise<void> {
    const to = el.getBoundingClientRect()
    if (to.width <= 0 || to.height <= 0) return Promise.resolve()
    const start = `translate(${from.x - to.left}px, ${from.y - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`
    return el.animate([
        { transformOrigin: 'top left', transform: start },
        { transformOrigin: 'top left', transform: 'none' }
    ], { duration: GROW_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' }).finished.then(() => {}, () => {})
}
