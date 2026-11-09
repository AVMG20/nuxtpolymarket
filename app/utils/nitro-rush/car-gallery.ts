import * as THREE from 'three'
import { buildCar, type PlayerCar } from './car-models'
import { buildCityEnvironment } from './city'
import type { CarId } from './config'
import { gradeRenderer } from './post'

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

interface Slot {
    car: PlayerCar
    canvas: HTMLCanvasElement
    ctx: CanvasRenderingContext2D
    onScreen: boolean
}

/** Turns each car on its card from a single context: a live WebGL canvas per card would run past the browser's cap on contexts. */
export class CarGallery {
    private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    private readonly scene = new THREE.Scene()
    private readonly camera = new THREE.PerspectiveCamera(FOV, 1.6, 0.5, 40)
    private readonly env: THREE.WebGLRenderTarget
    private readonly slots: Slot[] = []
    private readonly resizes = new ResizeObserver(entries => entries.forEach(e => this.fit(e.target)))
    private readonly sights = new IntersectionObserver((entries) => {
        for (const e of entries) {
            const slot = this.slotOf(e.target)
            if (slot) slot.onScreen = e.isIntersecting
        }
    })

    private readonly pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
    private raf = 0
    private drawnAt = -Infinity

    constructor(private color: number) {
        gradeRenderer(this.renderer)
        this.renderer.setPixelRatio(1)
        this.renderer.setClearColor(0x000000, 0)
        this.env = buildCityEnvironment(this.renderer)
        this.scene.environment = this.env.texture
        const key = new THREE.DirectionalLight(0xffffff, 2.6)
        key.position.set(3, 6, 5)
        const rim = new THREE.DirectionalLight(0x8fc4ff, 1.6)
        rim.position.set(-5, 3, -4)
        this.scene.add(new THREE.HemisphereLight(0xcfdcff, 0x1a1c28, 1.1), key, rim)
        this.camera.position.copy(CAMERA_POS)
        this.camera.lookAt(LOOK_AT)
        this.raf = requestAnimationFrame(this.frame)
    }

    /** Shows `id` on `canvas`, in the gallery's paint. */
    add(id: CarId, canvas: HTMLCanvasElement) {
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const car = buildCar(id, this.color)
        car.group.visible = false
        this.scene.add(car.group)
        this.slots.push({ car, canvas, ctx, onScreen: true })
        this.fit(canvas)
        this.resizes.observe(canvas)
        this.sights.observe(canvas)
    }

    setPaint(color: number) {
        this.color = color
        for (const s of this.slots) s.car.paint.color.setHex(color)
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
        if ((now - this.drawnAt) / 1000 < FRAME_SECONDS - 0.002 || this.renderer.getContext().isContextLost()) return
        this.drawnAt = now
        const yaw = START_YAW + now / 1000 / TURN_SECONDS * Math.PI * 2
        for (const s of this.slots) {
            if (s.onScreen && s.canvas.width && s.canvas.height) this.draw(s, yaw)
        }
    }

    private draw({ car, canvas, ctx }: Slot, yaw: number) {
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
        cancelAnimationFrame(this.raf)
        this.resizes.disconnect()
        this.sights.disconnect()
        for (const s of this.slots) s.car.dispose()
        this.env.dispose()
        // Browsers cap contexts, so free this one now rather than at GC.
        this.renderer.forceContextLoss()
        this.renderer.dispose()
    }
}
