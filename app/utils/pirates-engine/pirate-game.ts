import type { PirateAutopilotSnapshot } from '#shared/utils/gamelogic/pirates-autopilot'
import { WORLD_H, WORLD_W } from './constants'
import { PirateRenderer } from './render'
import { PirateSim } from './sim'
import type { PirateGameCallbacks, PirateShipStats, Point, SimEvent } from './types'

// The facade the Vue side talks to. It owns the canvas, the animation loop and
// the input, and wires the pure PirateSim to the PirateRenderer: every frame it
// steps the sim, drains its events into the renderer and the sound callback,
// and pushes a HUD snapshot to the page about ten times a second.

const HUD_INTERVAL_MS = 100
const MAX_FRAME_MS = 100
const DRAG_STEER_INTERVAL_MS = 90
const DRAG_THRESHOLD_PX = 6

const STEER_KEYS: Record<string, [number, number]> = {
    w: [0, -1],
    arrowup: [0, -1],
    s: [0, 1],
    arrowdown: [0, 1],
    a: [-1, 0],
    arrowleft: [-1, 0],
    d: [1, 0],
    arrowright: [1, 0]
}

function isTypingTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export class PirateGame {
    private callbacks: PirateGameCallbacks
    private sim: PirateSim
    private renderer: PirateRenderer | null = null
    private canvas: HTMLCanvasElement | null = null
    private raf = 0
    private lastFrameAt = 0
    private paused = false
    private destroyed = false
    private hudTimerMs = 0
    private hudAfterEnd = false
    private redrawPaused = false
    private frameHook: ((deltaMS: number) => void) | null = null
    private cursor: Point | null = null
    private heldKeys = new Set<string>()
    private pointerDown: { x: number, y: number, dragging: boolean } | null = null
    private lastDragSteerAt = 0
    private cleanups: (() => void)[] = []

    constructor(callbacks: PirateGameCallbacks, initialStats: PirateShipStats) {
        this.callbacks = callbacks
        this.sim = new PirateSim({
            onGameOver: (result) => {
                this.heldKeys.clear()
                this.hudAfterEnd = true
                this.callbacks.onGameOver(result)
            },
            onAnnounce: announcement => this.callbacks.onAnnounce?.(announcement)
        })
        this.sim.prepare(initialStats)
    }

    get isRunning() {
        return this.sim.running && !this.paused
    }

    get isPaused() {
        return this.paused
    }

    /** The live sim, for tooling that wants to read state directly. */
    get state() {
        return this.sim
    }

    async mount(host: HTMLDivElement) {
        const canvas = document.createElement('canvas')
        canvas.classList.add('h-full', 'w-full', 'block', 'touch-none')
        host.appendChild(canvas)
        this.canvas = canvas
        this.renderer = new PirateRenderer(canvas, this.sim)
        this.bindInput(canvas)
        this.resize(host.clientWidth, host.clientHeight)
        this.lastFrameAt = performance.now()
        this.raf = requestAnimationFrame(this.loop)
    }

    /** Re-parent the live canvas into a new host (navigating back to a paused voyage). */
    attach(host: HTMLDivElement) {
        if (!this.canvas) return
        host.appendChild(this.canvas)
        this.resize(host.clientWidth, host.clientHeight)
        this.redrawPaused = true
    }

    resize(clientWidth: number, clientHeight?: number) {
        if (!this.renderer) return
        const width = Math.max(320, Math.round(clientWidth))
        const height = clientHeight && clientHeight > 0 ? Math.round(clientHeight) : Math.round(width * WORLD_H / WORLD_W)
        this.renderer.resize(width, height)
        this.redrawPaused = true
    }

    setPlayerSkin(skinId: string) {
        this.sim.setSkin(skinId)
        this.redrawPaused = true
    }

    start(stats: PirateShipStats, power: number, difficulty: number) {
        this.paused = false
        this.heldKeys.clear()
        this.hudAfterEnd = false
        this.sim.start(stats, power, difficulty)
        this.hudTimerMs = 0
        this.callbacks.onHud(this.sim.hud())
    }

    /** Freeze the voyage exactly where it stands (navigating away mid-run). */
    pause() {
        if (!this.sim.running || this.paused) return
        this.paused = true
        this.heldKeys.clear()
        this.sim.steer(0, 0)
    }

    resume() {
        if (!this.paused) return
        this.paused = false
        this.lastFrameAt = performance.now()
    }

    /** End the voyage early by player choice. */
    cancel() {
        if (this.destroyed || !this.sim.running) return
        this.paused = false
        this.sim.cancel()
    }

    destroy() {
        this.destroyed = true
        cancelAnimationFrame(this.raf)
        for (const cleanup of this.cleanups) cleanup()
        this.cleanups = []
        this.renderer?.destroy()
        this.renderer = null
        this.canvas?.remove()
        this.canvas = null
    }

    setPreferGemAmmo(prefer: boolean) {
        this.sim.setPreferGem(prefer)
    }

    /** Cast the equipped ability at the cursor (or just ahead of the bow without one). */
    castAbility() {
        if (!this.isRunning) return false
        const target = this.cursor ?? {
            x: this.sim.player.x + Math.cos(this.sim.player.angle) * 220,
            y: this.sim.player.y + Math.sin(this.sim.player.angle) * 220
        }
        return this.sim.castAbility(target.x, target.y)
    }

    // ─── Auto-pilot ─────────────────────────────────────────────────────────

    /** Called after every simulated frame while a voyage runs. */
    setFrameHook(hook: ((deltaMS: number) => void) | null) {
        this.frameHook = hook
    }

    /** The sea as the auto-pilot sees it, in world coordinates. */
    autopilotView(): PirateAutopilotSnapshot & { speed: number } {
        return this.sim.autopilotView()
    }

    /** True when a ship centred here would sit on an island. */
    autopilotBlocked(x: number, y: number) {
        return this.sim.blocked(x, y)
    }

    /** Sail to a point, pathing around islands, without a click marker. */
    autopilotSail(x: number, y: number) {
        this.sim.sailTo(x, y, false)
    }

    /** The attack order a click on an enemy gives. */
    autopilotAttack(enemyId: number) {
        return this.sim.attack(enemyId)
    }

    /** Stop where the ship is and drop any attack order. */
    autopilotHeaveTo() {
        this.sim.heaveTo()
    }

    /** Right-click the sea. Returns false while the ability is unavailable. */
    autopilotCastAbility(x: number, y: number) {
        if (!this.sim.abilityReady) return false
        return this.sim.castAbility(x, y)
    }

    // ─── Loop ───────────────────────────────────────────────────────────────

    private loop = (now: number) => {
        if (this.destroyed) return
        this.raf = requestAnimationFrame(this.loop)
        const dt = Math.min(MAX_FRAME_MS, Math.max(0, now - this.lastFrameAt))
        this.lastFrameAt = now

        if (this.paused) {
            // A frozen voyage only needs repainting when its canvas moved or resized.
            if (this.redrawPaused) {
                this.redrawPaused = false
                this.renderer?.frame(0, [])
            }
            return
        }

        const wasRunning = this.sim.running
        this.sim.step(dt)
        if (wasRunning && this.sim.running) this.frameHook?.(dt)
        const events = this.sim.drainEvents()
        this.routeSounds(events)
        this.renderer?.frame(dt, events)

        this.hudTimerMs -= dt
        if ((this.sim.running || this.hudAfterEnd) && this.hudTimerMs <= 0) {
            this.hudTimerMs = HUD_INTERVAL_MS
            this.hudAfterEnd = false
            this.callbacks.onHud(this.sim.hud())
        }
    }

    private routeSounds(events: SimEvent[]) {
        const onSound = this.callbacks.onSound
        if (!onSound) return
        for (const event of events) {
            if (event.type === 'sound') onSound(event.sound, event.options)
        }
    }

    // ─── Input ──────────────────────────────────────────────────────────────

    private toWorld(clientX: number, clientY: number): Point | null {
        return this.renderer ? this.renderer.screenToWorld(clientX, clientY) : null
    }

    private listen<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions) {
        target.addEventListener(type, handler, options)
        this.cleanups.push(() => target.removeEventListener(type, handler, options))
    }

    private listenWindow<K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void) {
        window.addEventListener(type, handler)
        this.cleanups.push(() => window.removeEventListener(type, handler))
    }

    private bindInput(canvas: HTMLCanvasElement) {
        this.listen(canvas, 'contextmenu', (event) => {
            event.preventDefault()
            if (!this.isRunning) return
            const world = this.toWorld(event.clientX, event.clientY)
            if (world) this.sim.castAbility(world.x, world.y)
        })

        this.listen(canvas, 'pointerdown', (event) => {
            if (event.button !== 0) return
            const world = this.toWorld(event.clientX, event.clientY)
            if (!world) return
            this.cursor = world
            this.pointerDown = { x: event.clientX, y: event.clientY, dragging: false }
            if (!this.isRunning) return
            const enemy = this.sim.enemyAt(world.x, world.y)
            if (enemy) {
                this.sim.attack(enemy.id)
                return
            }
            const pickup = this.sim.pickupAt(world.x, world.y)
            if (pickup) {
                this.sim.sailTo(pickup.x, pickup.y, false)
                return
            }
            this.sim.sailTo(world.x, world.y)
        })

        this.listen(canvas, 'pointermove', (event) => {
            const world = this.toWorld(event.clientX, event.clientY)
            if (!world) return
            this.cursor = world
            const down = this.pointerDown
            if (!down || (event.buttons & 1) === 0 || !this.isRunning) return
            if (!down.dragging && Math.hypot(event.clientX - down.x, event.clientY - down.y) < DRAG_THRESHOLD_PX) return
            down.dragging = true
            const now = performance.now()
            if (now - this.lastDragSteerAt < DRAG_STEER_INTERVAL_MS) return
            this.lastDragSteerAt = now
            this.sim.sailTo(world.x, world.y, false)
        })

        // The ability aim ring used to follow the pointer; it read as clutter,
        // so the cursor is tracked for Space/Q casts but never drawn.

        this.listenWindow('pointerup', () => {
            this.pointerDown = null
        })

        this.listenWindow('keydown', (event) => {
            if (!this.isRunning || !this.canvas?.isConnected || isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
            const key = event.key.toLowerCase()
            if (STEER_KEYS[key]) {
                event.preventDefault()
                this.heldKeys.add(key)
                this.applySteer()
            } else if (key === ' ' || key === 'q') {
                event.preventDefault()
                if (!event.repeat) this.castAbility()
            } else if (key === 'e' && !event.repeat) {
                this.sim.setPreferGem(!this.sim.prefersGem)
                this.callbacks.onHud(this.sim.hud())
            }
        })

        this.listenWindow('keyup', (event) => {
            const key = event.key.toLowerCase()
            if (!this.heldKeys.delete(key)) return
            this.applySteer()
        })

        this.listenWindow('blur', () => {
            if (!this.heldKeys.size) return
            this.heldKeys.clear()
            this.applySteer()
        })
    }

    private applySteer() {
        let dx = 0
        let dy = 0
        for (const key of this.heldKeys) {
            const dir = STEER_KEYS[key]
            if (!dir) continue
            dx += dir[0]
            dy += dir[1]
        }
        this.sim.steer(dx, dy)
    }
}
