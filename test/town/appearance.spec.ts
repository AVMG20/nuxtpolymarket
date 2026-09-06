import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { TOWN_BUILDINGS } from '#shared/utils/gamelogic/town'
import { createBuildingModel } from '../../app/utils/town/models'
import { townBuildingPortrait, townVisualLevel } from '../../app/utils/town/appearance'

describe('Polytown upgrade artwork', () => {
    for (const def of TOWN_BUILDINGS.filter(b => b.kind !== 'road')) {
        it(`${def.name}: every level has distinct, finite geometry and a portrait`, () => {
            const signatures = new Set<string>()
            for (let level = 1; level <= 20; level++) {
                const model = createBuildingModel(def.id, level)
                const bounds = new THREE.Box3().setFromObject(model)
                expect(Number.isFinite(bounds.max.y)).toBe(true)
                expect(bounds.max.y).toBeGreaterThan(0)
                // Upgrades add height rather than sprawling across adjacent roads.
                expect(bounds.max.x - bounds.min.x).toBeLessThan(1.15)
                expect(bounds.max.z - bounds.min.z).toBeLessThan(1.15)
                expect(model.userData.visualLevel).toBe(level)
                let vertices = 0
                model.traverse(o => {
                    if (!(o instanceof THREE.Mesh)) return
                    const positions = o.geometry.getAttribute('position')
                    vertices += positions.count
                    expect(positions.array.every(v => Number.isFinite(v))).toBe(true)
                })
                signatures.add(`${vertices}:${bounds.max.y}`)
                expect(existsSync(resolve('public', townBuildingPortrait(def.id, level).slice(1)))).toBe(true)
                if (def.id === 'mill') expect(model.getObjectByName('spin')?.children).toHaveLength(4)
            }
            expect(signatures.size).toBe(20)
        })
    }
    it('preserves level-one defaults and keeps roads at their single appearance', () => {
        expect(townVisualLevel(0)).toBe(1)
        expect(townVisualLevel(NaN)).toBe(1)
        expect(townVisualLevel(500)).toBe(20)
        expect(createBuildingModel('road', 20).userData.visualLevel).toBe(1)
        expect(townBuildingPortrait('house')).toBe('/town/buildings/house.png')
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
