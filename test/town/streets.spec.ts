import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createCar, createTruck, TOWN_VEHICLE_SIZE } from '../../app/utils/town/vehicles'
import { createRoadParts } from '../../app/utils/town/roads'

describe('town street artwork', () => {
    for (const [kind, create] of [['car', createCar], ['truck', createTruck]] as const) {
        it(`${kind} fits the dimensions used by traffic spacing`, () => {
            const first = create(0xb95046)
            const second = create(0xb95046)
            const size = new THREE.Box3().setFromObject(first).getSize(new THREE.Vector3())
            expect(size.x).toBeLessThanOrEqual(TOWN_VEHICLE_SIZE[kind].width)
            expect(size.z).toBeLessThanOrEqual(TOWN_VEHICLE_SIZE[kind].length)
            expect(first).not.toBe(second)
            expect((first.children[0] as THREE.Mesh).geometry).toBe((second.children[0] as THREE.Mesh).geometry)
            expect(first.children.every(child => !child.castShadow)).toBe(true)
        })
    }
    for (let mask = 0; mask < 16; mask++) {
        it(`keeps road connection pattern ${mask} inside its tile`, () => {
            const road = createRoadParts(Array.from({ length: 4 }, (_, i) => Boolean(mask & (1 << i))))
            const bounds = new THREE.Box3().setFromObject(road)
            expect(bounds.min.x).toBeGreaterThanOrEqual(-0.500001)
            expect(bounds.min.z).toBeGreaterThanOrEqual(-0.500001)
            expect(bounds.max.x).toBeLessThanOrEqual(0.500001)
            expect(bounds.max.z).toBeLessThanOrEqual(0.500001)
        })
    }
})
