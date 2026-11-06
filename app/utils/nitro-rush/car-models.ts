import type * as THREE from 'three'
import type { CarId } from '#shared/utils/nitro-rush/cars'
import { buildKestrel } from './car-kestrel'

/** What every car model hands the view; a model only changes the look, so physics never sees which one is picked. */
export interface PlayerCar {
    group: THREE.Group
    body: THREE.Group
    paint: THREE.MeshPhysicalMaterial
    wheels: THREE.Object3D[]
    flames: THREE.Mesh[]
    flameMat: THREE.MeshBasicMaterial
    /** Tail-light positions in the car's local space, for the light trails. */
    tailPoints: THREE.Vector3[]
    dispose(): void
}

/** Keyed by every `CarId`, so a car added to the list without a model fails the typecheck. */
const MODELS: Record<CarId, (color: number) => PlayerCar> = {
    kestrel: buildKestrel
}

export const buildCar = (id: CarId, color: number) => MODELS[id](color)
