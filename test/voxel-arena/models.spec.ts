import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { WEAPON_IDS, MELEE_IDS, ENEMIES } from '../../app/utils/voxel-arena/data'
import { buildModel, weaponParts, meleeParts, enemyParts, pickupParts, portalParts, turretParts } from '../../app/utils/voxel-arena/models'
import { arenaLayout } from '../../app/utils/voxel-arena/arena-models'
import type { EnemyId } from '../../app/utils/voxel-arena/types'

describe('arena model assemblies', () => {
    it('builds every loadout, enemy and pickup with finite geometry', () => {
        const models = [
            ...WEAPON_IDS.map(weaponParts),
            ...MELEE_IDS.map(meleeParts),
            ...(Object.keys(ENEMIES) as EnemyId[]).map(enemyParts),
            ...(['health', 'energy', 'ammo', 'shield', 'haste', 'overdrive'] as const).map(pickupParts),
            portalParts(), turretParts()
        ]
        for (const parts of models) {
            const model = buildModel(parts)
            const bounds = new THREE.Box3().setFromObject(model.group)
            expect(bounds.isEmpty()).toBe(false)
            model.group.traverse(object => {
                if (!(object instanceof THREE.Mesh)) return
                const positions = object.geometry.getAttribute('position')
                expect(Array.from(positions.array).every(Number.isFinite)).toBe(true)
            })
        }
    })

    it('keeps decorative armor attached to animated limbs and out of death debris', () => {
        const model = buildModel(enemyParts('grunt'))
        const arm = model.parts.get('armR')!
        const decoration = arm.children.find(child => child instanceof THREE.Mesh && !model.meshes.includes(child))!
        expect(decoration).toBeDefined()
        const before = new THREE.Box3().setFromObject(decoration).getCenter(new THREE.Vector3())
        arm.rotation.x = 0.7
        model.group.updateMatrixWorld(true)
        const after = new THREE.Box3().setFromObject(decoration).getCenter(new THREE.Vector3())
        expect(before.distanceTo(after)).toBeGreaterThan(0.02)
        expect(model.meshes.every(mesh => !mesh.userData.part.detail)).toBe(true)
    })

    it('shares decorative geometry between repeated spawns', () => {
        const meshes = () => {
            const model = buildModel(enemyParts('titan'))
            const geometries: THREE.BufferGeometry[] = []
            model.group.traverse(object => {
                if (object instanceof THREE.Mesh && !model.meshes.includes(object)) geometries.push(object.geometry)
            })
            return geometries
        }
        const first = meshes()
        const second = meshes()
        expect(first.length).toBeGreaterThan(0)
        first.forEach((geometry, index) => expect(geometry).toBe(second[index]))
    })

    it('retains portal and turret animation pivots', () => {
        expect(buildModel(portalParts()).parts.get('ring')).toBeInstanceOf(THREE.Group)
        const head = buildModel(turretParts()).parts.get('head')!
        expect(head).toBeInstanceOf(THREE.Group)
        expect(head.children.length).toBeGreaterThan(4)
    })
})

describe('arena layout', () => {
    it('keeps the player start, portals and jump pads clear of raised solids', () => {
        const points = [[0, 3], [34, 34], [-34, 34], [34, -34], [-34, -34], [35, 0], [-35, 0], [0, 35], [0, -35], [10, -10], [-10, 10], [-22, 8], [22, -8], [26, 26], [-26, -26]]
        for (const [x, z] of points) {
            expect(arenaLayout().filter(p => Math.abs(x! - p.x) < p.w / 2 + 0.6 && Math.abs(z! - p.z) < p.d / 2 + 0.6 && p.y - p.h / 2 < 2)).toEqual([])
        }
    })

    it('keeps solid cover inside the outer circulation loop', () => {
        for (const p of arenaLayout()) {
            expect(Math.abs(p.x) + p.w / 2).toBeLessThan(30)
            expect(Math.abs(p.z) + p.d / 2).toBeLessThan(30)
            expect(Math.min(p.w, p.h, p.d)).toBeGreaterThan(0)
        }
    })
})
