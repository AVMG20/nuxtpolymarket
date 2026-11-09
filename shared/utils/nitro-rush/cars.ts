/** The cars in the garage: cosmetic only, every one drives on the same physics. Sent with each live pose so other players see the same car. */
export const CARS = [
    { id: 'kestrel', label: 'Kestrel' },
    { id: 'roadster', label: 'Roadster' }
] as const

export type CarId = typeof CARS[number]['id']

export const isCarId = (id: unknown): id is CarId => CARS.some(c => c.id === id)

/** An unknown id (a stale stored choice, an older client) falls back to the first car. */
export const findCar = (id: unknown) => CARS.find(c => c.id === id) ?? CARS[0]
