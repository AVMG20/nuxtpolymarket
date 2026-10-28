// Keyboard / mouse / pointer-lock input for the game view. Keys are tracked
// by `KeyboardEvent.code` so layouts don't matter for WASD.

/** Wheel events closer together than this belong to one scroll (one weapon step). */
const WHEEL_GESTURE_GAP_MS = 140
/** Scroll distance (px) per shop step: a wheel notch, or a stretch of trackpad scroll. */
const SCROLL_STEP_PX = 100

export class DfInput {
    readonly down = new Set<string>()
    private readonly pressedSet = new Set<string>()
    private readonly releasedSet = new Set<string>()
    mouseX = 0
    mouseY = 0
    /** Weapon-cycle steps from the scroll wheel this frame: one per scroll gesture, signed. */
    wheel = 0
    /** When the last wheel event arrived (ms): a gap of `WHEEL_GESTURE_GAP_MS` starts a new gesture. */
    private wheelAt = -Infinity
    /** Menu steps from the scroll wheel this frame: one per notch, signed (the workbench shop). */
    scroll = 0
    private scrollAcc = 0
    locked = false
    /** The chat box has the keyboard: keys are not game input. */
    typing = false
    onLockChange: ((locked: boolean) => void) | null = null
    /**
     * The pointer was let go for a menu (the workbench shop) so Escape reaches
     * the page instead of the browser eating it: the game still counts as locked.
     */
    private freed = false
    /** Development hook: a faked lock ignores real pointer-lock changes. */
    private devLocked = false
    /** Fired on every user gesture (audio unlock). */
    onGesture: (() => void) | null = null
    /**
     * Fired the moment a mouse button goes down while locked (after it is
     * recorded as pressed), so the engine can fire on the event itself instead
     * of waiting for the next frame.
     */
    onPress: ((code: string) => void) | null = null
    private readonly el: HTMLElement
    private readonly off: (() => void)[] = []

    constructor(el: HTMLElement) {
        this.el = el
        const on = <K extends keyof DocumentEventMap>(t: EventTarget, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
            t.addEventListener(type, fn as EventListener, opts)
            this.off.push(() => t.removeEventListener(type, fn as EventListener, opts))
        }
        on(window, 'keydown', (e: KeyboardEvent) => {
            this.onGesture?.()
            if (!this.locked || this.typing) return
            // keep the browser from scrolling / opening find etc. while playing
            if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Quote' || e.code === 'Slash' || (e.ctrlKey && e.code === 'KeyW')) e.preventDefault()
            if (e.repeat) return
            if (!this.down.has(e.code)) this.pressedSet.add(e.code)
            this.down.add(e.code)
        })
        on(window, 'keyup', (e: KeyboardEvent) => {
            if (this.down.has(e.code)) this.releasedSet.add(e.code)
            this.down.delete(e.code)
        })
        on(window, 'mousemove', (e: MouseEvent) => {
            if (!this.locked || this.freed) return
            // ignore the occasional huge spike some browsers report on lock
            if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return
            this.mouseX += e.movementX
            this.mouseY += e.movementY
        })
        on(window, 'mousedown', (e: MouseEvent) => {
            this.onGesture?.()
            if (!this.locked) return
            const code = `Mouse${e.button}`
            const fresh = !this.down.has(code)
            if (fresh) this.pressedSet.add(code)
            this.down.add(code)
            if (fresh) this.onPress?.(code)
        })
        on(window, 'mouseup', (e: MouseEvent) => {
            const code = `Mouse${e.button}`
            if (this.down.has(code)) this.releasedSet.add(code)
            this.down.delete(code)
        })
        on(window, 'wheel', (e: WheelEvent) => {
            if (!this.locked || Math.abs(e.deltaY) < 1) return
            // a notch with smooth scrolling, or a trackpad flick and its inertia, fires a burst
            // of events: count the burst once so it moves one weapon, not back and forth
            const fresh = e.timeStamp - this.wheelAt > WHEEL_GESTURE_GAP_MS
            this.wheelAt = e.timeStamp
            if (fresh) this.wheel += Math.sign(e.deltaY)
            // menus step per notch instead: line and page deltas to pixels, a turn back starts over
            const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? SCROLL_STEP_PX : 1)
            if (Math.sign(px) !== Math.sign(this.scrollAcc)) this.scrollAcc = 0
            this.scrollAcc += px
            if (Math.abs(this.scrollAcc) >= SCROLL_STEP_PX) {
                this.scroll += Math.sign(this.scrollAcc)
                this.scrollAcc = 0
            }
        }, { passive: true })
        on(window, 'contextmenu', (e: Event) => {
            if (this.locked) e.preventDefault()
        })
        on(window, 'blur', () => {
            if (this.freed) this.drop()
            this.clear()
        })
        on(document, 'pointerlockchange', () => {
            if (this.devLocked) return
            const locked = document.pointerLockElement === this.el
            if (this.freed) {
                if (locked) this.freed = false
                return
            }
            if (locked === this.locked) return
            this.locked = locked
            if (!locked) this.clear()
            this.onLockChange?.(locked)
        })
        on(document, 'pointerlockerror', () => {
            if (this.freed) this.drop()
            else this.onLockChange?.(false)
        })
    }

    lock(): void {
        // requestPointerLock returns a promise in current browsers and throws or
        // rejects when the document isn't focused (WrongDocumentError): swallow both
        // so a refused lock never surfaces as an uncaught error.
        const request = (opts?: object): void => {
            const p = (this.el.requestPointerLock as (o?: object) => Promise<void> | void)(opts)
            if (p && typeof p.catch === 'function') {
                p.catch(() => {
                    if (opts) request()
                })
            }
        }
        try {
            request({ unadjustedMovement: true })
        } catch {
            try {
                request()
            } catch {
                // ignore
            }
        }
    }

    /**
     * Development hook: pretend the pointer is locked so automation can drive the
     * game without a real lock (only called from the engine's dev-only `window.__df`).
     */
    devSetLocked(locked: boolean): void {
        this.devLocked = locked
        if (locked === this.locked) return
        this.locked = locked
        if (!locked) this.clear()
        this.onLockChange?.(locked)
    }

    /** Development hook: press or release a key / mouse code as if from a real event. */
    devInject(code: string, down: boolean): void {
        if (down) {
            const fresh = !this.down.has(code)
            if (fresh) this.pressedSet.add(code)
            this.down.add(code)
            if (fresh && code.startsWith('Mouse')) this.onPress?.(code)
        } else {
            if (this.down.has(code)) this.releasedSet.add(code)
            this.down.delete(code)
        }
    }

    /** Development hook: act as if the pointer were locked (automation can't take a real lock). */
    devLock(on: boolean): void {
        if (this.locked === on) return
        this.locked = on
        this.onLockChange?.(on)
    }

    /** Development hook: add mouse look as if the mouse moved (pixels). */
    devLook(dx: number, dy: number): void {
        this.mouseX += dx
        this.mouseY += dy
    }

    setTyping(on: boolean): void {
        this.typing = on
        if (on) this.clear()
    }

    unlock(): void {
        if (this.freed) this.drop()
        if (document.pointerLockElement === this.el) document.exitPointerLock()
    }

    /** Lets the pointer go for a menu without counting as unlocked (no pause), so Escape arrives as a key. */
    release(): void {
        if (this.freed || document.pointerLockElement !== this.el) return
        this.freed = true
        document.exitPointerLock()
    }

    /** Takes the pointer back after `release()`; the browser allows it without a click, and a refusal unlocks as usual. */
    retake(): void {
        if (this.freed) this.lock()
    }

    /** A released pointer that won't come back: unlocked after all. */
    private drop(): void {
        this.freed = false
        this.locked = false
        this.clear()
        this.onLockChange?.(false)
    }

    has(code: string): boolean {
        return this.down.has(code)
    }

    pressed(code: string): boolean {
        return this.pressedSet.has(code)
    }

    released(code: string): boolean {
        return this.releasedSet.has(code)
    }

    /** Takes the mouse movement gathered so far (pixels) and clears it. */
    takeLook(out: { x: number, y: number }): { x: number, y: number } {
        out.x = this.mouseX
        out.y = this.mouseY
        this.mouseX = 0
        this.mouseY = 0
        return out
    }

    /** Call at the end of each frame. */
    endFrame(): void {
        this.pressedSet.clear()
        this.releasedSet.clear()
        this.mouseX = 0
        this.mouseY = 0
        this.wheel = 0
        this.scroll = 0
    }

    clear(): void {
        for (const c of this.down) this.releasedSet.add(c)
        this.down.clear()
    }

    dispose(): void {
        for (const f of this.off) f()
        this.off.length = 0
        this.unlock()
    }
}
