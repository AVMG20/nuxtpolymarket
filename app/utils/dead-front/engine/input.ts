// Keyboard / mouse / pointer-lock input for the game view. Keys are tracked
// by `KeyboardEvent.code` so layouts don't matter for WASD.

export class DfInput {
    readonly down = new Set<string>()
    private readonly pressedSet = new Set<string>()
    private readonly releasedSet = new Set<string>()
    mouseX = 0
    mouseY = 0
    wheel = 0
    locked = false
    onLockChange: ((locked: boolean) => void) | null = null
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
            if (!this.locked) return
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
            if (!this.locked) return
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
            if (!this.locked) return
            this.wheel += Math.sign(e.deltaY)
        }, { passive: true })
        on(window, 'contextmenu', (e: Event) => {
            if (this.locked) e.preventDefault()
        })
        on(window, 'blur', () => this.clear())
        on(document, 'pointerlockchange', () => {
            if (this.devLocked) return
            const locked = document.pointerLockElement === this.el
            if (locked === this.locked) return
            this.locked = locked
            if (!locked) this.clear()
            this.onLockChange?.(locked)
        })
        on(document, 'pointerlockerror', () => {
            this.onLockChange?.(false)
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

    unlock(): void {
        if (document.pointerLockElement === this.el) document.exitPointerLock()
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
