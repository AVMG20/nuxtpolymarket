import * as THREE from 'three'
import { modelShared, SIDES, wheelGeos, type Kit, type Slot } from './car-kit'
import type { PlayerCar } from './car-models'
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from './config'
import { plateTexture } from './signs'

/** What a car model builds itself; everything faces -z, the direction of travel. */
export interface CarParts {
    kit: Kit
    /** Worn by the `skin` and `paint` slots; the menu's paint sets its colour. */
    paint: THREE.MeshPhysicalMaterial
    /** Slots this car wears its own material in, instead of the shared one. */
    materials?: Partial<Record<Slot, THREE.Material>>
    /** `parts` replaces the kit's wheel altogether. */
    wheel: { r: number, w: number, halfTrack: number, axles: readonly number[], parts?: () => THREE.Object3D[] }
    /** Where each exhaust's nitro flame starts, in the car's local space. */
    flames: readonly THREE.Vector3[]
    /** For exhausts narrower than the kit's flame. */
    flame?: { r: number, length: number }
    /** Left and right tail light, for the light trails. */
    tailPoints: THREE.Vector3[]
    /** Anything else the model made for this car alone, such as its livery. */
    owned?: { dispose(): void }[]
}

/** Fills the hitbox exactly, so what the player sees is what hits the wall; height follows length to keep the wheels round. */
function fitToHitbox(fit: THREE.Group) {
    const box = new THREE.Box3().setFromObject(fit)
    const across = CAR_HALF_WIDTH * 2 / (box.max.x - box.min.x)
    const along = CAR_HALF_LENGTH * 2 / (box.max.z - box.min.z)
    fit.scale.set(across, along, along)
    fit.position.z = -along * (box.max.z + box.min.z) / 2
    return along
}

/** Bakes a model's parts and adds what every car shares: wheels, shadow, number plate and exhaust flames. */
export function assembleCar(p: CarParts): PlayerCar {
    const s = modelShared()
    const owned: { dispose(): void }[] = [p.paint, ...p.owned ?? []]
    const own = <T extends { dispose(): void }>(x: T) => {
        owned.push(x)
        return x
    }
    const group = new THREE.Group()
    // Its own group, as `group` is where the game places and turns the car.
    const fit = new THREE.Group()
    const body = new THREE.Group()
    group.add(fit)
    fit.add(body)

    let plate = p.materials?.plate
    if (!plate) {
        // Backlit like the billboards, so the ad still reads at night.
        const plateMap = own(plateTexture())
        plate = own(new THREE.MeshStandardMaterial({ map: plateMap, emissiveMap: plateMap, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.45 }))
    }
    for (const [slot, geo] of p.kit.bake()) {
        own(geo)
        const material = slot === 'plate' ? plate : p.materials?.[slot] ?? (slot === 'skin' || slot === 'paint' ? p.paint : s.slots[slot])
        const mesh = new THREE.Mesh(geo, material)
        if (slot === 'decal') mesh.renderOrder = 1
        body.add(mesh)
    }

    const { r, w: width, halfTrack, axles, parts } = p.wheel
    const wheels: THREE.Object3D[] = []
    for (const u of axles) {
        for (const side of SIDES) {
            const w = new THREE.Group()
            const spin = new THREE.Group()
            // The left wheel is turned round, so it spins the other way about its local axis.
            spin.userData.dir = side
            w.add(spin)
            if (parts) {
                spin.add(...parts())
            } else {
                const wheelSet = wheelGeos(r, width)
                spin.add(new THREE.Mesh(wheelSet.tire, s.slots.rubber), new THREE.Mesh(wheelSet.rim, s.slots.rim), new THREE.Mesh(wheelSet.lip, s.slots.chrome), new THREE.Mesh(wheelSet.disc, s.slots.disc), new THREE.Mesh(wheelSet.letters, s.slots.decal))
                // The caliper stays put while the wheel turns.
                w.add(new THREE.Mesh(wheelSet.caliper, s.slots.caliper))
            }
            w.position.set(side * halfTrack, r, -u)
            if (side < 0) w.rotation.y = Math.PI
            fit.add(w)
            wheels.push(spin)
        }
    }
    // Before the shadow and flames, which aren't part of the car's shape.
    const along = fitToHitbox(fit)

    const shadow = new THREE.Mesh(s.shadowGeo, s.shadow)
    shadow.scale.set(2.8, 1, 5.6)
    // The fit scales this too, and the lift is what keeps it off the road.
    shadow.position.y = 0.03 / along
    shadow.renderOrder = 2
    fit.add(shadow)

    const { r: flameR, length: flameLength } = p.flame ?? { r: 0.09, length: 1.1 }
    const flameGeo = own(new THREE.ConeGeometry(flameR, flameLength, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, flameLength / 2))
    const flameMat = own(new THREE.MeshBasicMaterial({ color: 0x7ab8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
    const flames = p.flames.map((at) => {
        const f = new THREE.Mesh(flameGeo, flameMat)
        f.position.copy(at)
        f.scale.setScalar(0.001)
        body.add(f)
        return f
    })

    return {
        group,
        body,
        paint: p.paint,
        wheelRadius: r * along,
        wheels,
        flames,
        flameMat,
        tailPoints: p.tailPoints,
        dispose: () => owned.forEach(o => o.dispose())
    }
}
