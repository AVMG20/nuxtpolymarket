/** The car models to pick from; they only look different, so every one drives exactly like the others. */
export const CARS = [
    { id: 'kestrel', label: 'Kestrel' },
    { id: 'og', label: 'The OG' },
    { id: 'roadster', label: 'Roadster' },
    { id: 'spectre', label: 'Spectre' }
] as const

export type CarId = typeof CARS[number]['id']

export const isCarId = (id: unknown): id is CarId => CARS.some(c => c.id === id)

/** An unknown id (a stale stored choice, an older client) falls back to the first car. */
export const findCar = (id: unknown) => CARS.find(c => c.id === id) ?? CARS[0]
