import * as THREE from 'three'
import { modelShared, wheelGeos, type Kit } from './car-kit'
import type { PlayerCar } from './car-models'
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from './config'
import { plateTexture } from './signs'

/** What a car model builds itself; everything faces -z, the direction of travel. */
export interface CarParts {
    kit: Kit
    /** Worn by the `skin` and `paint` slots; the menu's paint sets its colour. */
    paint: THREE.MeshPhysicalMaterial
    wheel: { r: number, w: number, halfTrack: number, axles: readonly number[] }
    /** Where each exhaust's nitro flame starts, in the car's local space. */
    flames: readonly THREE.Vector3[]
    /** Left and right tail light, for the light trails. */
    tailPoints: THREE.Vector3[]
    /** Anything else the model made for this car alone, such as its livery. */
    owned?: { dispose(): void }[]
}

const SIDES = [-1, 1] as const

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

    // Backlit like the billboards, so the ad still reads at night.
    const plateMap = own(plateTexture())
    const plate = own(new THREE.MeshStandardMaterial({ map: plateMap, emissiveMap: plateMap, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.45 }))
    for (const [slot, geo] of p.kit.bake()) {
        own(geo)
        const material = slot === 'skin' || slot === 'paint' ? p.paint : slot === 'plate' ? plate : s.slots[slot]
        const mesh = new THREE.Mesh(geo, material)
        if (slot === 'decal') mesh.renderOrder = 1
        body.add(mesh)
    }

    const { r, w: width, halfTrack, axles } = p.wheel
    const wheelSet = wheelGeos(r, width)
    const wheels: THREE.Object3D[] = []
    for (const u of axles) {
        for (const side of SIDES) {
            const w = new THREE.Group()
            const spin = new THREE.Group()
            spin.add(new THREE.Mesh(wheelSet.tire, s.slots.rubber), new THREE.Mesh(wheelSet.rim, s.slots.rim), new THREE.Mesh(wheelSet.lip, s.slots.chrome), new THREE.Mesh(wheelSet.disc, s.slots.disc), new THREE.Mesh(wheelSet.letters, s.slots.decal))
            // The left wheel is turned round, so it spins the other way about its local axis.
            spin.userData.dir = side
            // The caliper stays put while the wheel turns.
            w.add(spin, new THREE.Mesh(wheelSet.caliper, s.slots.caliper))
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

    const flameGeo = own(new THREE.ConeGeometry(0.09, 1.1, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.55))
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
