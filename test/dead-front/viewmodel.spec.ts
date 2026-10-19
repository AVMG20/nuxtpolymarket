import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DF_WEAPON_IDS, DF_WEAPONS } from '#shared/utils/dead-front/weapons'
import { dfBuildGunRig } from '../../app/utils/dead-front/weapons/models'
import { dfAdsPose } from '../../app/utils/dead-front/weapons/viewmodel'

// The sight picture: at full ADS the rear notch and the front post (both
// measured from the voxels) must sit exactly on the camera axis, so the round
// goes where the sights point.

function onAxis(id: Parameters<typeof dfBuildGunRig>[0], pap: number, attachments = {}) {
    const rig = dfBuildGunRig(id, pap, attachments)
    const pos = new THREE.Vector3()
    const pitch = dfAdsPose(rig, pos)
    const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, 0, 'YXZ')), new THREE.Vector3(1, 1, 1))
    const rear = rig.sight.clone().applyMatrix4(m)
    const front = rig.sightFront.clone().applyMatrix4(m)
    return { rig, rear, front }
}

describe('dead front viewmodel sights', () => {
    for (const id of DF_WEAPON_IDS) {
        it(`${id}: the sight line runs down the camera axis at full ADS`, () => {
            const { rig, rear, front } = onAxis(id, 0)
            expect(Math.abs(rear.x)).toBeLessThan(1e-6)
            expect(Math.abs(rear.y)).toBeLessThan(1e-6)
            expect(Math.abs(front.x)).toBeLessThan(1e-6)
            expect(Math.abs(front.y)).toBeLessThan(1e-6)
            expect(rear.z).toBeCloseTo(-rig.eyeRelief, 6)
            expect(front.z).toBeLessThan(rear.z - 0.05)
            // The front sight is a real post: above the bore line, below the rear ears.
            expect(rig.sightFront.y).toBeGreaterThan(rig.muzzle.position.y)
        })
    }

    it('keeps the alignment with every attachment and Pack-a-Punch tier', () => {
        for (const id of DF_WEAPON_IDS) {
            for (const a of DF_WEAPONS[id].attachments) {
                for (const pap of [0, 3]) {
                    const { rear, front } = onAxis(id, pap, { [a.slot]: a.id })
                    expect(Math.hypot(rear.x, rear.y), `${id} ${a.id}`).toBeLessThan(1e-6)
                    expect(Math.hypot(front.x, front.y), `${id} ${a.id}`).toBeLessThan(1e-6)
                }
            }
        }
    })

    it('builds every weapon on one voxel size with its moving parts', () => {
        for (const id of DF_WEAPON_IDS) {
            const rig = dfBuildGunRig(id, 0)
            const box = new THREE.Box3().setFromObject(rig.root)
            const len = box.max.z - box.min.z
            const cls = DF_WEAPONS[id].class
            if (cls === 'pistol' || id === 'xray') expect(len).toBeLessThan(0.36)
            else expect(len).toBeGreaterThan(0.7)
            expect(rig.mag ?? rig.pan ?? rig.pump, id).not.toBeNull()
        }
    })
    it('draws every attachment on its weapon', () => {
        // A fitting that leaves the model untouched is one that never shows in the armory or the match.
        const signature = (id: Parameters<typeof dfBuildGunRig>[0], attachments = {}) => {
            const rig = dfBuildGunRig(id, 0, attachments)
            let sum = 0
            rig.root.traverse((o) => {
                const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
                if (!geo) return
                for (const attr of Object.values(geo.attributes)) {
                    const arr = attr.array as ArrayLike<number>
                    for (let i = 0; i < arr.length; i += 7) sum += (arr[i] ?? 0) * ((i % 13) + 1)
                    sum += arr.length
                }
            })
            return sum
        }
        for (const id of DF_WEAPON_IDS) {
            const bare = signature(id)
            for (const a of DF_WEAPONS[id].attachments) {
                expect(signature(id, { [a.slot]: a.id }), `${id} ${a.id}`).not.toBe(bare)
            }
        }
    })

    it('puts a red dot lens in the glass of every red dot sight', () => {
        for (const id of DF_WEAPON_IDS) {
            for (const a of DF_WEAPONS[id].attachments.filter(x => x.id.endsWith('-reddot'))) {
                const rig = dfBuildGunRig(id, 0, { optic: a.id })
                expect(rig.lens, `${id} ${a.id}`).not.toBeNull()
                // Clear of the iron sights: the window sits above the bore, on the sight line.
                expect(rig.sight.y, a.id).toBeGreaterThan(rig.muzzle.position.y + 0.03)
                expect(Math.abs(rig.lens!.position.y - rig.sight.y), a.id).toBeLessThan(1e-6)
            }
        }
    })
})
