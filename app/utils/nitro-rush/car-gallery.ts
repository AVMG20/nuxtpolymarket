import * as THREE from 'three'
import { BuildQueue } from './build-queue'
import { buildCar, type PlayerCar } from './car-models'
import { buildCityEnvironment } from './city'
import type { CarId } from './config'
import { gradeRenderer } from './post'
import { eachTexture } from './prewarm'

const TURN_SECONDS = 24
/** The nose starts towards the viewer, a little off to one side. */
const START_YAW = Math.PI + 0.6
/** Slow turning loses nothing at this rate, and the race behind the menu keeps the rest of the frame. */
const FRAME_SECONDS = 1 / 30
const MAX_PIXEL_RATIO = 2
const FOV = 26
/** Far enough that a car's corners stay in view at every angle on a 16:10 card. */
const CAMERA_POS = new THREE.Vector3(0, 1.9, 6.5)
const LOOK_AT = new THREE.Vector3(0, 0.43, 0)
const COMPILE_POLL_MS = 10

interface Slot {
    id: CarId
    canvas: HTMLCanvasElement
    ctx: CanvasRenderingContext2D
    onScreen: boolean
    car: PlayerCar | null
    /** Built, compiled and its textures uploaded in an idle moment, so its first draw stays light. */
    ready: boolean
}

interface CompiledMaterial {
    currentProgram?: { isReady(): boolean | null }
}

/** Turns each car on its card from a single context: a live WebGL canvas per card would run past the browser's cap on contexts. */
export class CarGallery {
    private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    private readonly scene = new THREE.Scene()
    private readonly camera = new THREE.PerspectiveCamera(FOV, 1.6, 0.5, 40)
    private env: THREE.WebGLRenderTarget | null = null
    private readonly slots: Slot[] = []
    private readonly resizes = new ResizeObserver(entries => entries.forEach(e => this.fit(e.target)))
    private readonly sights = new IntersectionObserver((entries) => {
        for (const e of entries) {
            const slot = this.slotOf(e.target)
            if (slot) slot.onScreen = e.isIntersecting
        }
    })

    /** Builds the environment, then one car per idle moment, so opening the garage never blocks the race behind it. */
    private readonly queue = new BuildQueue(() => this.contextLost())
    private readonly pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
    private raf = 0
    private drawnAt = -Infinity
    private disposed = false

    constructor(private color: number, private readonly onReady: (id: CarId) => void = () => {}) {
        gradeRenderer(this.renderer)
        this.renderer.setPixelRatio(1)
        this.renderer.setClearColor(0x000000, 0)
        const key = new THREE.DirectionalLight(0xffffff, 2.6)
        key.position.set(3, 6, 5)
        const rim = new THREE.DirectionalLight(0x8fc4ff, 1.6)
        rim.position.set(-5, 3, -4)
        this.scene.add(new THREE.HemisphereLight(0xcfdcff, 0x1a1c28, 1.1), key, rim)
        this.camera.position.copy(CAMERA_POS)
        this.camera.lookAt(LOOK_AT)
        // First in the queue: cars compiled without it would recompile, in one stall, once it arrived.
        this.queue.add({
            urgent: () => true,
            run: () => {
                this.env = buildCityEnvironment(this.renderer)
                this.scene.environment = this.env.texture
            }
        })
        this.raf = requestAnimationFrame(this.frame)
    }

    /** Shows `id` on `canvas`, in the gallery's paint, once it is built; `onReady` reports when. */
    add(id: CarId, canvas: HTMLCanvasElement) {
        const ctx = canvas.getContext('2d')
        if (!ctx || this.disposed) return
        const slot: Slot = { id, canvas, ctx, onScreen: false, car: null, ready: false }
        this.slots.push(slot)
        this.fit(canvas)
        this.resizes.observe(canvas)
        this.sights.observe(canvas)
        this.queue.add({ urgent: () => slot.onScreen, run: () => this.load(slot) })
    }

    setPaint(color: number) {
        this.color = color
        for (const s of this.slots) s.car?.paint.color.setHex(color)
    }

    private async load(slot: Slot) {
        if (this.disposed) return
        try {
            const car = buildCar(slot.id, this.color)
            car.group.visible = false
            slot.car = car
            this.scene.add(car.group)
            await this.compile(car.group)
            if (this.disposed) return
            if (!this.contextLost()) this.uploadTextures(car.group)
            slot.ready = true
        } finally {
            // Also on a throw, so a broken model leaves a blank card rather than one that pulses forever.
            if (!this.disposed) this.onReady(slot.id)
        }
    }

    /** Uploads now rather than in the first draw, where a large livery would stall the frame. */
    private uploadTextures(group: THREE.Object3D) {
        const textures = new Set<THREE.Texture>()
        group.traverse((o) => {
            const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
            for (const m of [material ?? []].flat()) eachTexture(m, t => textures.add(t))
        })
        for (const t of textures) this.renderer.initTexture(t)
    }

    /** compileAsync's own poll throws or spins forever once the renderer is disposed or its context lost, so this one gives up instead. */
    private async compile(group: THREE.Object3D) {
        const materials = [...this.renderer.compile(group, this.camera, this.scene)]
        const props = this.renderer.properties
        while (!this.disposed && !this.contextLost()) {
            if (materials.every(m => (props.get(m) as CompiledMaterial).currentProgram?.isReady() ?? true)) return
            await new Promise(resolve => setTimeout(resolve, COMPILE_POLL_MS))
        }
    }

    private contextLost() {
        return this.renderer.getContext().isContextLost()
    }

    private slotOf(el: Element) {
        return this.slots.find(s => s.canvas === el)
    }

    private fit(el: Element) {
        const slot = this.slotOf(el)
        if (!slot) return
        const width = Math.round(slot.canvas.clientWidth * this.pixelRatio)
        const height = Math.round(slot.canvas.clientHeight * this.pixelRatio)
        if (slot.canvas.width !== width) slot.canvas.width = width
        if (slot.canvas.height !== height) slot.canvas.height = height
        // Only ever grows: resizing a live context reallocates its buffers.
        const size = this.renderer.getSize(new THREE.Vector2())
        if (width > size.x || height > size.y) this.renderer.setSize(Math.max(width, size.x), Math.max(height, size.y), false)
    }

    private readonly frame = (now: number) => {
        this.raf = requestAnimationFrame(this.frame)
        if ((now - this.drawnAt) / 1000 < FRAME_SECONDS - 0.002 || this.contextLost()) return
        this.drawnAt = now
        const yaw = START_YAW + now / 1000 / TURN_SECONDS * Math.PI * 2
        for (const s of this.slots) {
            if (s.ready && s.onScreen && s.canvas.width && s.canvas.height) this.draw(s, yaw)
        }
    }

    private draw({ car, canvas, ctx }: Slot, yaw: number) {
        if (!car) return
        const { width, height } = canvas
        car.group.visible = true
        car.group.rotation.y = yaw
        this.camera.aspect = width / height
        this.camera.updateProjectionMatrix()
        this.renderer.setViewport(0, 0, width, height)
        this.renderer.render(this.scene, this.camera)
        car.group.visible = false
        const source = this.renderer.domElement
        ctx.clearRect(0, 0, width, height)
        // Copied before the frame ends, since the drawing buffer isn't kept; GL's origin is the bottom left.
        ctx.drawImage(source, 0, source.height - height, width, height, 0, 0, width, height)
    }

    dispose() {
        this.disposed = true
        this.queue.stop()
        cancelAnimationFrame(this.raf)
        this.resizes.disconnect()
        this.sights.disconnect()
        // A car still compiling is on its slot already, so it goes here too.
        for (const s of this.slots) s.car?.dispose()
        this.env?.dispose()
        // Browsers cap contexts, so free this one now rather than at GC.
        this.renderer.forceContextLoss()
        this.renderer.dispose()
    }
}
