import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { TOWN_BUILDINGS, townBuildingMaxLevel } from '#shared/utils/gamelogic/town'
import { createBuildingModel, TOWN_MODEL_VARIANTS } from '../../app/utils/town/models'
import { TOWN_VISUAL_LEVELS, townVisualLevel, townVisualStage } from '../../app/utils/town/appearance'

function signature(model: THREE.Group) {
    let vertices = 0
    model.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const positions = o.geometry.getAttribute('position')
        vertices += positions.count
        expect(positions.array.every((v: number) => Number.isFinite(v))).toBe(true)
    })
    return `${vertices}:${new THREE.Box3().setFromObject(model).max.y.toFixed(4)}`
}

describe('Polytown building artwork', () => {
    it('draws five looks, at levels 1, 5, 10, 15 and 20', () => {
        expect([...TOWN_VISUAL_LEVELS]).toEqual([1, 5, 10, 15, 20])
        expect([1, 4, 5, 9, 10, 14, 15, 19, 20].map(townVisualStage)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4])
        expect([0, NaN, 3, 7, 12, 19, 500].map(townVisualLevel)).toEqual([1, 1, 1, 5, 10, 15, 20])
    })

    for (const def of TOWN_BUILDINGS.filter(b => b.kind !== 'road')) {
        it(`${def.name}: every look it can reach is distinct and stays on its tile`, () => {
            const signatures = new Set<string>()
            const looks = TOWN_VISUAL_LEVELS.filter(level => level <= townBuildingMaxLevel(def))
            for (const level of looks) {
                const model = createBuildingModel(def.id, level)
                const bounds = new THREE.Box3().setFromObject(model)
                expect(bounds.max.y).toBeGreaterThan(0)
                // Buildings fill the tile edge to edge and never spill onto the next one.
                expect(bounds.max.x - bounds.min.x).toBeGreaterThan(0.95)
                expect(bounds.max.z - bounds.min.z).toBeGreaterThan(0.95)
                expect(Math.max(bounds.max.x, -bounds.min.x, bounds.max.z, -bounds.min.z)).toBeLessThanOrEqual(0.53)
                expect(model.userData.visualLevel).toBe(level)
                signatures.add(signature(model))
            }
            expect(signatures.size).toBe(looks.length)
            // Levels inside a stage share its artwork.
            expect(signature(createBuildingModel(def.id, 3))).toBe(signature(createBuildingModel(def.id, 1)))
        })
    }

    for (const def of TOWN_BUILDINGS.filter(b => b.kind !== 'road')) {
        it(`${def.name}: grows taller with every look`, () => {
            const heights = TOWN_VISUAL_LEVELS.filter(level => level <= townBuildingMaxLevel(def)).map(level => createBuildingModel(def.id, level).userData.height as number)
            heights.slice(1).forEach((height, i) => expect(height).toBeGreaterThan(heights[i]! + 0.05))
        })
    }

    it('paints a look the same on every tile, so a plot shows its tier', () => {
        const palette = (variant: number) => {
            const colours = new Set<string>()
            createBuildingModel('house', 10, variant).traverse((o) => {
                if (!(o instanceof THREE.Mesh)) return
                const c = o.geometry.getAttribute('color')
                for (let i = 0; i < c.count; i++) colours.add(new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)).getHexString())
            })
            return colours
        }
        const first = palette(0)
        for (let variant = 1; variant < TOWN_MODEL_VARIANTS; variant++) {
            const other = palette(variant)
            const shared = [...other].filter(c => first.has(c)).length
            expect(shared / other.size).toBeGreaterThan(0.9)
        }
    })

    it('keeps roads at their single appearance and the mill turning', () => {
        expect(createBuildingModel('road', 20).userData.visualLevel).toBe(1)
        const sails = createBuildingModel('mill', 1).getObjectByName('spin')!
        expect(sails.userData.spinAxis).toBe('z')
    })

    it('keeps independently animated windows from changing another building', () => {
        const first = createBuildingModel('house', 20)
        const second = createBuildingModel('house', 20)
        const a = first.getObjectByName('glow') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
        const b = second.getObjectByName('glow') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
        a.material.emissiveIntensity = 0
        expect(b.material.emissiveIntensity).toBeGreaterThan(0)
        expect(a.geometry).toBe(b.geometry)
    })
})
