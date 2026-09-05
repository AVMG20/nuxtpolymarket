// Voxel Arena — renders guns and blades for the arsenal: cached thumbnails
// for the list and a live, slowly spinning view for the detail panel.

import * as THREE from 'three'
import { buildModel, weaponParts, meleeParts } from './models'
import type { MeleeId, WeaponId } from './types'

export type PreviewKind = 'weapon' | 'melee'

export class ArsenalPreview {
    private renderer: THREE.WebGLRenderer
    private scene = new THREE.Scene()
    private camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 40)
    private model: THREE.Group | null = null
    private thumbs = new Map<string, string>()
    private container: HTMLElement | null = null
    private frame = 0
    private spin = 0
    private disposed = false

    constructor() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        this.renderer.setClearColor(0x000000, 0)
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping
        this.renderer.toneMappingExposure = 1.35
        this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2430, 2))
        const key = new THREE.DirectionalLight(0xfff1dc, 4)
        key.position.set(2, 3, 2.5)
        this.scene.add(key)
        const rim = new THREE.DirectionalLight(0x3ff0ff, 1.2)
        rim.position.set(-3, 1, -2)
        this.scene.add(rim)
        this.camera.position.set(0, 0.45, 3.8)
        this.camera.lookAt(0, 0, 0)
    }

    private setModel(kind: PreviewKind, id: string): void {
        if (this.model) this.scene.remove(this.model)
        const parts = kind === 'weapon' ? weaponParts(id as WeaponId) : meleeParts(id as MeleeId)
        const group = buildModel(parts).group
        // centre the model and fit its longest side into view
        const box = new THREE.Box3().setFromObject(group)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const longest = Math.max(size.x, size.y, size.z, 0.01)
        const wrap = new THREE.Group()
        group.position.sub(center)
        wrap.add(group)
        wrap.scale.setScalar(2.2 / longest)
        // barrels and blades point along +Z; turn them to run across the frame
        wrap.rotation.y = Math.PI / 2
        this.model = wrap
        this.scene.add(wrap)
    }

    /** A cached three-quarter view as a data URL, for list rows. */
    thumbnail(kind: PreviewKind, id: string): string {
        const key = `${kind}:${id}`
        const cached = this.thumbs.get(key)
        if (cached) return cached
        this.setModel(kind, id)
        this.model!.rotation.y = Math.PI / 2 + 0.55
        this.model!.rotation.x = 0.18
        this.renderer.setSize(224, 126, false)
        this.camera.aspect = 224 / 126
        this.camera.updateProjectionMatrix()
        this.renderer.render(this.scene, this.camera)
        const url = this.renderer.domElement.toDataURL('image/png')
        this.thumbs.set(key, url)
        if (this.container) this.resize()
        return url
    }

    /** Puts the live view inside `container` and starts spinning. */
    mount(container: HTMLElement): void {
        if (this.container === container) return
        this.unmount()
        this.container = container
        container.appendChild(this.renderer.domElement)
        this.renderer.domElement.style.width = '100%'
        this.renderer.domElement.style.height = '100%'
        this.resize()
        this.frame = requestAnimationFrame(this.loop)
    }

    unmount(): void {
        cancelAnimationFrame(this.frame)
        if (this.container) this.renderer.domElement.remove()
        this.container = null
    }

    show(kind: PreviewKind, id: string): void {
        this.setModel(kind, id)
        this.spin = 0
    }

    resize(): void {
        if (!this.container) return
        const w = Math.max(1, this.container.clientWidth)
        const h = Math.max(1, this.container.clientHeight)
        this.renderer.setSize(w, h, false)
        this.camera.aspect = w / h
        this.camera.updateProjectionMatrix()
    }

    private loop = (): void => {
        if (this.disposed || !this.container) return
        this.frame = requestAnimationFrame(this.loop)
        if (this.model) {
            this.spin += 0.012
            this.model.rotation.y = Math.PI / 2 + this.spin
            this.model.rotation.x = Math.sin(this.spin * 0.7) * 0.18
            this.model.position.y = Math.sin(this.spin * 1.3) * 0.05
        }
        this.renderer.render(this.scene, this.camera)
    }

    dispose(): void {
        this.disposed = true
        this.unmount()
        this.renderer.dispose()
    }
}
