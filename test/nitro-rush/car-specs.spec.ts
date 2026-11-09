import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '../../app/utils/nitro-rush/config'
import type { PlayerCar } from '../../app/utils/nitro-rush/car-models'
import { CARS } from '../../shared/utils/nitro-rush/cars'

/** How far short of the hitbox the main body may stop; further means a stray part squeezed the rest of the car. */
const MAX_BODY_GAP = 0.1
/** Below the mirrors and wings, so this measures the car's real hull. */
const HULL_TOP = 0.75
/** Along the doors, so the narrow nose and tail don't count. */
const FLANK_REACH = 1.5
const SLICE = 0.1
/** The nose and tail slope with height, so these are judged nearer their furthest slice than the flanks are. */
const END_SHARE = 0.66

// Easter egg cars may be worse but never better, so they get their own rules once one exists.
const RACE_CARS = CARS.filter(c => !(c as Record<string, unknown>).easterEgg)
const RACE_IDS = RACE_CARS.map(c => c.id)

const ctx: any = new Proxy({}, {
    get: (_t, p) => p === 'measureText' ? () => ({ width: 10 }) : p === 'canvas' ? {} : () => ctx,
    set: () => true
})

async function build(id: typeof RACE_IDS[number]) {
    const { buildCar } = await import('../../app/utils/nitro-rush/car-models')
    const { modelShared } = await import('../../app/utils/nitro-rush/car-kit')
    const car = buildCar(id, 0xffffff)
    car.group.updateMatrixWorld(true)
    return { car, shadow: modelShared().shadow }
}

/** Calls `visit` with every vertex of the car's shape, leaving out the soft shadow and the nitro flames. */
function eachVertex(car: PlayerCar, shadow: THREE.Material, visit: (v: THREE.Vector3, wheel: boolean) => void) {
    const v = new THREE.Vector3()
    const hubs = new Set(car.wheels.map(w => w.parent))
    car.group.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o.material === shadow || o.material === car.flameMat) return
        const wheel = hubs.has(o.parent) || hubs.has(o.parent?.parent ?? null)
        const position = o.geometry.attributes.position!
        for (let i = 0; i < position.count; i++) visit(v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld), wheel)
    })
}

/** Reach at a share of the slices, as the single furthest point could be a stalk or spike rather than the hull. */
function typicalReach(slices: Map<number, number>, share = 0.5) {
    const sorted = [...slices.values()].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length * share)]!
}

function hullReach(car: PlayerCar, shadow: THREE.Material) {
    const flanks = new Map<number, number>()
    const noses = new Map<number, number>()
    const tails = new Map<number, number>()
    const reach = (slices: Map<number, number>, at: number, value: number) => {
        const slice = Math.round(at / SLICE)
        slices.set(slice, Math.max(slices.get(slice) ?? 0, value))
    }
    eachVertex(car, shadow, (v, wheel) => {
        if (wheel || v.y > HULL_TOP) return
        if (Math.abs(v.z) < FLANK_REACH) reach(flanks, v.z, Math.abs(v.x))
        // By height, as extruded bodies have few vertices across their middle.
        reach(noses, v.y, -v.z)
        reach(tails, v.y, v.z)
    })
    return { flank: typicalReach(flanks), nose: typicalReach(noses, END_SHARE), tail: typicalReach(tails, END_SHARE) }
}

describe('every race car has the same specs', () => {
    beforeEach(() => {
        vi.stubGlobal('document', { createElement: () => ({ width: 1, height: 1, getContext: () => ctx }) })
    })

    it('adds nothing but a name to the car list', () => {
        const stats = RACE_CARS.map(({ id: _id, label: _label, ...rest }) => rest)
        for (const s of stats) expect(s).toEqual(stats[0])
    })

    // A lap comparison would pass trivially while physics can't tell cars apart, so this guards that premise instead.
    it('keeps the physics blind to which car is driving', () => {
        const physics = readFileSync('app/utils/nitro-rush/physics.ts', 'utf8')
        expect(physics).not.toMatch(/carId|\bCARS\b|findCar|car-models|nitro-rush\/cars/i)
    })

    it.each(RACE_IDS)('builds %s with the parts the game drives', async (id) => {
        const { car } = await build(id)
        expect(car.wheels).toHaveLength(4)
        expect(car.tailPoints).toHaveLength(2)
        expect(car.flames.length).toBeGreaterThan(0)
    })

    it.each(RACE_IDS)('stands %s on the road at the origin', async (id) => {
        const { car } = await build(id)
        expect(car.group.matrixWorld.equals(new THREE.Matrix4())).toBe(true)
        for (const w of car.wheels) expect(new THREE.Box3().setFromObject(w.parent!).min.y).toBeCloseTo(0)
    })

    it.each(RACE_IDS)('rolls the wheels of %s at road speed', async (id) => {
        const { car } = await build(id)
        for (const w of car.wheels) {
            const box = new THREE.Box3().setFromObject(w.parent!)
            expect(box.max.y / 2).toBeCloseTo(car.wheelRadius, 2)
        }
    })

    it.each(RACE_IDS)('fills the hitbox with the shape of %s', async (id) => {
        const { car, shadow } = await build(id)
        const box = new THREE.Box3()
        eachVertex(car, shadow, v => box.expandByPoint(v))
        for (const [edge, hitbox] of [[box.min.x, -CAR_HALF_WIDTH], [box.max.x, CAR_HALF_WIDTH], [box.min.z, -CAR_HALF_LENGTH], [box.max.z, CAR_HALF_LENGTH]]) {
            expect(Math.abs(edge! - hitbox!)).toBeLessThan(0.01)
        }
    })

    it.each(RACE_IDS)('takes the hitbox up with the hull of %s, not with stray parts', async (id) => {
        const { car, shadow } = await build(id)
        const { flank, nose, tail } = hullReach(car, shadow)
        expect(flank).toBeGreaterThan(CAR_HALF_WIDTH - MAX_BODY_GAP)
        expect(nose).toBeGreaterThan(CAR_HALF_LENGTH - MAX_BODY_GAP)
        expect(tail).toBeGreaterThan(CAR_HALF_LENGTH - MAX_BODY_GAP)
    })
})
