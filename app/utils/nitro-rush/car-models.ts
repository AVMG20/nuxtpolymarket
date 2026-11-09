import type { CarId } from '#shared/utils/nitro-rush/cars'
import { buildPlayerCar, type PlayerCar } from './models'
import { buildRoadster } from './models-roadster'

/** The model for a car in the garage, wearing `color`. */
export function buildCar(id: CarId, color: number): PlayerCar {
    return id === 'roadster' ? buildRoadster(color) : buildPlayerCar(color)
}
