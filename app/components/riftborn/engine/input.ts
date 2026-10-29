/*
 * Keyboard, mouse and touch input. Pause keys belong to the UI.
 */

const MOVE_KEYS: Record<string, [number, number]> = {
    KeyW: [0, -1],
    ArrowUp: [0, -1],
    KeyS: [0, 1],
    ArrowDown: [0, 1],
    KeyA: [-1, 0],
    ArrowLeft: [-1, 0],
    KeyD: [1, 0],
    ArrowRight: [1, 0]
}

/** Physical keys for ability slots 1..3 */
const ABILITY_CODES = ['KeyQ', 'KeyF', 'KeyR']

function isTyping(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el || !el.tagName) return false
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

export class Input {
    private readonly keys = new Set<string>()
    dashQueued = false
    ultQueued = false
    /** Q / F / R presses waiting for the next sim step */
    readonly abilityQueued = [false, false, false]
    /** Set while a level-up, chest or pause menu is open: action keys belong to the menu */
    blocked = false
    /** Canvas-local CSS px */
    mouseX = 0
    mouseY = 0
    /** performance.now() / 1000 of the last mouse move */
    mouseT = -1e9
    mouseDown = false
    private touch: { id: number, ox: number, oy: number, x: number, y: number } | null = null
    private readonly offs: (() => void)[] = []

    constructor(private readonly canvas: HTMLCanvasElement, private readonly onGesture: () => void) {}

    attach(): void {
        const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (ev: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
            target.addEventListener(type, fn as EventListener, opts)
            this.offs.push(() => target.removeEventListener(type, fn as EventListener, opts))
        }
        on(window, 'keydown', e => {
            if (isTyping(e.target)) return
            this.onGesture()
            if (MOVE_KEYS[e.code]) {
                this.keys.add(e.code)
                if (e.code.startsWith('Arrow')) e.preventDefault()
            }
            if (this.blocked) return
            if ((e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) {
                this.dashQueued = true
                if (e.code === 'Space') e.preventDefault()
            }
            if (e.code === 'KeyE' && !e.repeat) this.ultQueued = true
            if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const slot = ABILITY_CODES.indexOf(e.code)
                if (slot >= 0) this.abilityQueued[slot] = true
            }
        })
        on(window, 'keyup', e => {
            this.keys.delete(e.code)
        })
        on(window, 'blur', () => {
            this.keys.clear()
            this.touch = null
            this.mouseDown = false
        })
        const local = (e: PointerEvent) => {
            const r = this.canvas.getBoundingClientRect()
            return { x: e.clientX - r.left, y: e.clientY - r.top }
        }
        on(this.canvas, 'pointermove', e => {
            const p = local(e)
            if (e.pointerType === 'touch') {
                if (this.touch && this.touch.id === e.pointerId) {
                    this.touch.x = p.x
                    this.touch.y = p.y
                }
                return
            }
            this.mouseX = p.x
            this.mouseY = p.y
            this.mouseT = performance.now() / 1000
        })
        on(this.canvas, 'pointerdown', e => {
            this.onGesture()
            const p = local(e)
            if (e.pointerType === 'touch') {
                if (!this.touch) this.touch = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y }
                else this.dashQueued = true
                return
            }
            if (e.button === 2) {
                this.ultQueued = true
                return
            }
            this.mouseDown = true
            this.mouseX = p.x
            this.mouseY = p.y
            this.mouseT = performance.now() / 1000
        })
        const up = (e: PointerEvent) => {
            if (this.touch && this.touch.id === e.pointerId) this.touch = null
            if (e.button === 0) this.mouseDown = false
        }
        on(this.canvas, 'pointerup', up)
        on(this.canvas, 'pointercancel', up)
        on(this.canvas, 'contextmenu', e => e.preventDefault())
    }

    /** Movement vector, length 0..1 */
    move(): { x: number, y: number } {
        let x = 0
        let y = 0
        // e.code is the physical key, so AZERTY's ZQSD already arrives as WASD
        for (const k of this.keys) {
            const v = MOVE_KEYS[k]
            if (!v) continue
            x += v[0]
            y += v[1]
        }
        if (this.touch) {
            const dx = this.touch.x - this.touch.ox
            const dy = this.touch.y - this.touch.oy
            const d = Math.hypot(dx, dy)
            if (d > 8) {
                const m = Math.min(1, d / 50)
                x += (dx / d) * m
                y += (dy / d) * m
            }
        }
        const len = Math.hypot(x, y)
        if (len > 1) {
            x /= len
            y /= len
        }
        return { x, y }
    }

    /** Mouse aim counts for this long after the last move */
    mouseActive(now: number): boolean {
        return this.mouseDown || now - this.mouseT < 1.6
    }

    clearQueued(): void {
        this.dashQueued = false
        this.ultQueued = false
        this.abilityQueued.fill(false)
    }

    detach(): void {
        for (const off of this.offs) off()
        this.offs.length = 0
        this.keys.clear()
    }
}
