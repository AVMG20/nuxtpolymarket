import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { TOWN_BUILDINGS, townBuildingMaxLevel } from '#shared/utils/gamelogic/town'
import { createBuildingModel } from '../../app/utils/town/models'
import { townBuildingPortrait, townVisualLevel } from '../../app/utils/town/appearance'

/**
 * Buildings with a 3D model but no hand-drawn portrait yet. The UI renders
 * their own model instead of showing a glyph, so they still look like
 * buildings. The list is asserted below so it cannot quietly grow, and a
 * building leaves it the moment a PNG lands.
 */
const AWAITING_ARTWORK = ['bathhouse', 'theatre']

describe('Polytown upgrade artwork', () => {
    it('has artwork for everything but the buildings still waiting on the asset pass', () => {
        const undrawn = TOWN_BUILDINGS
            .filter(b => b.kind !== 'road')
            .filter(b => !existsSync(resolve('public', townBuildingPortrait(b.id, 1).slice(1))))
            .map(b => b.id)
        expect(undrawn.sort()).toEqual([...AWAITING_ARTWORK].sort())
    })

    for (const def of TOWN_BUILDINGS.filter(b => b.kind !== 'road')) {
        it(`${def.name}: every level it can reach has distinct, finite geometry`, () => {
            const signatures = new Set<string>()
            // Up to its OWN ceiling: a park stops at 12 and a bathhouse at 8,
            // and a level a building can never reach needs no artwork.
            const cap = townBuildingMaxLevel(def)
            for (let level = 1; level <= cap; level++) {
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
                if (!AWAITING_ARTWORK.includes(def.id)) {
                    expect(existsSync(resolve('public', townBuildingPortrait(def.id, level).slice(1)))).toBe(true)
                }
                if (def.id === 'mill') expect(model.getObjectByName('spin')?.children).toHaveLength(4)
            }
            expect(signatures.size).toBe(cap)
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
