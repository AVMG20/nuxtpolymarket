import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { canvas, finish } from './canvas'
import { GHOST_COLOR } from './config'
import { modelShared } from './car-kit'
import { buildPlayerCar } from './models'
import type { GhostFrame } from './types'

const OPACITY = 0.34
/** Ghosts fade out as the camera closes in, so one sitting on the lens doesn't fill the screen. */
const FADE_NEAR = 2
const FADE_FAR = 5.5
/** A ghost gone from the sources this long gives its model up; until then it's only hidden. */
const FORGET_MS = 10_000
/** Name tags: their height over the car, their height in the world, and the least they shrink to on screen (CSS px). */
const TAG_LIFT = 2.1
const TAG_HEIGHT = 0.55
const TAG_MIN_PX = 15

type Part = 'shell' | 'tail' | 'head'

/** The ghost car's shape: the player car merged into a translucent shell and its lamps, built once and shared by every ghost. */
function buildTemplate(): Map<Part, THREE.BufferGeometry> {
    const car = buildPlayerCar(0xffffff)
    const slots = modelShared().slots
    // Seats, the dash, the shadow and the flames would only clutter a see-through car.
    const skip = new Set<THREE.Material>([slots.cabin, slots.interior, modelShared().shadow])
    const partOf = (m: THREE.Material): Part | null => {
        if (skip.has(m) || m.blending === THREE.AdditiveBlending) return null
        if (m === slots.tail || m === slots.lens) return 'tail'
        if (m === slots.head) return 'head'
        return 'shell'
    }
    const parts = new Map<Part, THREE.BufferGeometry[]>()
    car.group.updateMatrixWorld(true)
    car.group.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return
        const part = partOf(o.material)
        if (!part) return
        const src = o.geometry as THREE.BufferGeometry
        const g = src.index ? src.toNonIndexed() : src.clone()
        for (const name of Object.keys(g.attributes)) {
            if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
        }
        if (!g.attributes.normal) g.computeVertexNormals()
        g.applyMatrix4(o.matrixWorld)
        const list = parts.get(part) ?? []
        list.push(g)
        parts.set(part, list)
    })
    car.dispose()
    const out = new Map<Part, THREE.BufferGeometry>()
    for (const [part, list] of parts) {
        const merged = mergeGeometries(list, false)
        for (const g of list) g.dispose()
        if (!merged) continue
        merged.computeBoundingSphere()
        out.set(part, merged)
    }
    return out
}

function tagTexture(text: string) {
    const [c, ctx] = canvas(512, 96)
    ctx.font = '600 52px ui-sans-serif, system-ui, sans-serif'
    const w = Math.min(500, ctx.measureText(text).width + 56)
    const x = (512 - w) / 2
    ctx.fillStyle = 'rgba(8, 10, 22, 0.62)'
    ctx.beginPath()
    ctx.roundRect(x, 10, w, 76, 38)
    ctx.fill()
    ctx.fillStyle = '#f2f6ff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 256, 50, 460)
    return finish(c)
}

class GhostModel {
    readonly group = new THREE.Group()
    readonly shell: THREE.MeshStandardMaterial
    private readonly lamps: THREE.MeshBasicMaterial[]
    private tag: THREE.Sprite | null = null
    private tagText = ''
    private color = -1
    lastSeen = 0

    constructor(template: Map<Part, THREE.BufferGeometry>) {
        this.shell = new THREE.MeshStandardMaterial({
            transparent: true, depthWrite: false, roughness: 0.3, metalness: 0.5, emissiveIntensity: 0.45
        })
        const tail = new THREE.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, depthWrite: false })
        const head = new THREE.MeshBasicMaterial({ color: 0xf4f8ff, transparent: true, depthWrite: false })
        this.lamps = [tail, head]
        const mats: Record<Part, THREE.Material> = { shell: this.shell, tail, head }
        for (const [part, geo] of template) this.group.add(new THREE.Mesh(geo, mats[part]))
    }

    set(frame: GhostFrame, opacity: number) {
        const p = frame.pose
        this.group.position.set(p.x, p.y, p.z)
        this.group.quaternion.set(p.qx, p.qy, p.qz, p.qw)
        const color = frame.color ?? GHOST_COLOR
        if (color !== this.color) {
            this.color = color
            this.shell.color.setHex(color)
            this.shell.emissive.setHex(color)
        }
        this.shell.opacity = OPACITY * opacity
        for (const m of this.lamps) m.opacity = 0.7 * opacity
        this.setTag(frame.label ?? '')
        if (this.tag) this.tag.material.opacity = Math.min(1, opacity * 1.5)
    }

    private setTag(text: string) {
        if (text === this.tagText) return
        this.tagText = text
        this.disposeTag()
        if (!text) return
        const map = tagTexture(text)
        this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, toneMapped: false }))
        this.tag.position.set(0, TAG_LIFT, 0)
        this.tag.renderOrder = 3
        this.group.add(this.tag)
    }

    /** Keeps the tag readable far off: never under TAG_MIN_PX tall on screen. */
    sizeTag(camera: THREE.PerspectiveCamera, viewHeight: number, tmp: THREE.Vector3) {
        if (!this.tag) return
        const dist = this.tag.getWorldPosition(tmp).distanceTo(camera.position)
        const perPx = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2) / Math.max(1, viewHeight)
        const h = Math.max(TAG_HEIGHT, TAG_MIN_PX * perPx)
        this.tag.scale.set(h * 512 / 96, h, 1)
    }

    private disposeTag() {
        if (!this.tag) return
        this.tag.removeFromParent()
        this.tag.material.map?.dispose()
        this.tag.material.dispose()
        this.tag = null
    }

    dispose() {
        this.group.removeFromParent()
        this.disposeTag()
        this.shell.dispose()
        for (const m of this.lamps) m.dispose()
    }
}

/**
 * Draws ghost cars: the player's best lap and other players on the course. Each
 * ghost is a see-through copy of the player car that writes no depth, so it never
 * hides the real car, and is keyed by its frame's id so its model lives on.
 */
export class GhostView {
    readonly group = new THREE.Group()
    private template: Map<Part, THREE.BufferGeometry> | null = null
    private readonly models = new Map<string, GhostModel>()
    private readonly tmp = new THREE.Vector3()

    constructor(scene: THREE.Scene) {
        scene.add(this.group)
    }

    /** Shows exactly `frames`; `viewHeight` is the canvas height in CSS px. */
    update(frames: readonly GhostFrame[], now: number, camera: THREE.PerspectiveCamera, viewHeight: number) {
        for (const m of this.models.values()) m.group.visible = false
        for (const f of frames) {
            let m = this.models.get(f.id)
            if (!m) {
                this.template ??= buildTemplate()
                m = new GhostModel(this.template)
                this.models.set(f.id, m)
                this.group.add(m.group)
            }
            m.lastSeen = now
            const dist = this.tmp.set(f.pose.x, f.pose.y, f.pose.z).distanceTo(camera.position)
            const fade = THREE.MathUtils.smoothstep(dist, FADE_NEAR, FADE_FAR)
            m.group.visible = fade > 0.01
            m.set(f, fade)
            m.sizeTag(camera, viewHeight, this.tmp)
        }
        for (const [id, m] of this.models) {
            if (now - m.lastSeen > FORGET_MS) {
                m.dispose()
                this.models.delete(id)
            }
        }
    }

    dispose() {
        for (const m of this.models.values()) m.dispose()
        this.models.clear()
        if (this.template) for (const g of this.template.values()) g.dispose()
        this.template = null
        this.group.removeFromParent()
    }
}
