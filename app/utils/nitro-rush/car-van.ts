import * as THREE from 'three'
import { assembleCar } from './car-assembly'
import { Kit, modelShared, SIDES, type Slot } from './car-kit'
import type { PlayerCar } from './car-models'
import { VAN_BODY, VAN_WHEEL, type PackedMesh } from './car-van-mesh'

/**
 * The Bang Bus: a panel van modelled in Blender (`scripts/nitro-rush-van`) rather than built from code like the other cars.
 * Its wrap is one image, so the paint the player picks only shows on the hub caps.
 */

const LIVERY_URL = '/games/nitro-rush/van-livery.webp'
/** The wrap's base blue, worn until the image arrives. */
const LIVERY_BLUE = [138, 212, 243] as const

const WHEEL_R = 0.36
const WHEEL_W = 0.27
const HALF_TRACK = 0.735
/** How far ahead of the middle each axle sits. */
const AXLES = [1.42, -1.36]
/** The model's rear face, where the plate and lamps sit, and the bumper's face at the other end. */
const TAIL_Z = 2.25
const NOSE_Z = 2.25
const PIPE = new THREE.Vector3(-0.48, 0.25, TAIL_Z)
const LAMP_X = 0.765
const LAMP_Y = 1.2

function bytes(packed: string) {
    const raw = atob(packed)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
    return out.buffer
}

function unpack(m: PackedMesh) {
    const packed = new Uint16Array(bytes(m.position))
    const position = new Float32Array(packed.length)
    for (let i = 0; i < packed.length; i++) position[i] = m.min[i % 3]! + packed[i]! / 65535 * m.size[i % 3]!
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(new Int8Array(bytes(m.normal)), n => n / 127), 3))
    if (m.uv) geo.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(new Uint16Array(bytes(m.uv)), v => v / 65535), 2))
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(bytes(m.index)), 1))
    return geo
}

/** Swaps the wrap in for a plain blue texel once it has loaded: the material keeps its map, so its shader never recompiles mid-race. */
function loadLivery(skin: THREE.MeshPhysicalMaterial) {
    const plain = new THREE.DataTexture(new Uint8Array([...LIVERY_BLUE, 255]), 1, 1)
    plain.colorSpace = THREE.SRGBColorSpace
    plain.needsUpdate = true
    skin.map = plain
    let livery: THREE.Texture | null = null
    let disposed = false
    const image = document.createElement('img')
    image.onload = () => {
        if (disposed) return
        livery = new THREE.Texture(image)
        livery.colorSpace = THREE.SRGBColorSpace
        livery.anisotropy = 8
        livery.needsUpdate = true
        skin.map = livery
        plain.dispose()
    }
    image.src = LIVERY_URL
    return {
        dispose() {
            disposed = true
            plain.dispose()
            livery?.dispose()
        }
    }
}

export function buildVan(color: number): PlayerCar {
    const s = modelShared()
    // Only the hub caps: the body is wrapped.
    const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 })
    const skin = new THREE.MeshPhysicalMaterial({ roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 })
    const livery = loadLivery(skin)
    const amber = new THREE.MeshStandardMaterial({ color: 0x4a2a08, emissive: 0xffa040, emissiveIntensity: 2.2, roughness: 0.3 })
    // Dark steel wheels, like a van on its winter set; a shade off black so the vents in them still read.
    const steel = new THREE.MeshStandardMaterial({ color: 0x1f2126, roughness: 0.42, metalness: 0.75, side: THREE.DoubleSide })

    const kit = new Kit()
    for (const [slot, mesh] of Object.entries(VAN_BODY)) {
        const geo = unpack(mesh)
        kit.add(slot as Slot, geo)
        geo.dispose()
    }
    // A plate at each end; the front one is turned to face ahead.
    const plate = new THREE.PlaneGeometry(0.52, 0.12)
    kit.add('plate', plate, 0, 0.8, TAIL_Z + 0.016)
    kit.add('plate', plate, 0, 0.535, -NOSE_Z - 0.006, 0, Math.PI)
    plate.dispose()

    const wheel = {
        tire: unpack(VAN_WHEEL.tire), rim: unpack(VAN_WHEEL.steel), cap: unpack(VAN_WHEEL.paint),
        nuts: unpack(VAN_WHEEL.chrome), vents: unpack(VAN_WHEEL.trim)
    }
    return assembleCar({
        kit,
        paint,
        // The indicators sit in the kit's `caliper` bucket.
        materials: { skin, caliper: amber },
        wheel: {
            r: WHEEL_R,
            w: WHEEL_W,
            halfTrack: HALF_TRACK,
            axles: AXLES,
            parts: () => [
                new THREE.Mesh(wheel.tire, s.slots.rubber), new THREE.Mesh(wheel.rim, steel), new THREE.Mesh(wheel.cap, paint),
                new THREE.Mesh(wheel.nuts, s.slots.chrome), new THREE.Mesh(wheel.vents, s.slots.trim)
            ]
        },
        flames: [PIPE],
        flame: { r: 0.07, length: 1.1 },
        tailPoints: SIDES.map(side => new THREE.Vector3(side * LAMP_X, LAMP_Y, TAIL_Z + 0.02)),
        owned: [skin, livery, amber, steel, ...Object.values(wheel)]
    })
}
