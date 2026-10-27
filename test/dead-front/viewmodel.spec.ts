import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DF_WEAPON_IDS, DF_WEAPONS, dfWeaponStats } from '#shared/utils/dead-front/weapons'
import { dfBuildGunRig } from '../../app/utils/dead-front/weapons/models'
import { DF_WSND } from '../../app/utils/dead-front/weapons/sounds'
import { createDfViewmodelImpl, dfAdsPose } from '../../app/utils/dead-front/weapons/viewmodel'

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

describe('dead front viewmodel actions', () => {
    it('gives the new guns their actions: a lever, break-open barrels, a turning cylinder, a flame lance', () => {
        const win = dfBuildGunRig('win1895', 0)
        expect(win.cycle).toBe('lever')
        expect(win.lever).not.toBeNull()
        expect(dfBuildGunRig('kar98k', 0).cycle).toBe('bolt')
        const web = dfBuildGunRig('webley', 0)
        expect(web.barrel).not.toBeNull()
        expect(web.chambers).toBe(6)
        expect(web.panSpin).toBe('z')
        // the cylinder and the speedloader ride in the barrel group as it tips open
        expect(web.pan!.parent).toBe(web.barrel)
        expect(web.mag!.parent).toBe(web.barrel)
        expect(web.mag!.visible).toBe(false)
        const coach = dfBuildGunRig('sawnoff', 0)
        expect(coach.barrel).not.toBeNull()
        expect(coach.reload).toBe('break')
        expect(coach.mag!.visible).toBe(false)
        expect(dfBuildGunRig('flammen', 0).flame).toBe(true)
        expect(dfBuildGunRig('chauchat', 0).flame).toBe(false)
        expect(dfBuildGunRig('lewis', 0).panSpin).toBe('y')
    })

    function harness() {
        const vmScene = new THREE.Scene()
        const vmCamera = new THREE.PerspectiveCamera(54, 16 / 9, 0.01, 10)
        const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200)
        const played: string[] = []
        const bursts: string[] = []
        const noop = () => {}
        const ctx = {
            renderer: null, scene: new THREE.Scene(), camera, vmScene, vmCamera, quality: 'high',
            fx: { burst: (k: string) => bursts.push(k), tracer: noop, lightning: noop, decal: noop, flash: noop, shake: noop },
            audio: { ctx: null, register: noop, play: (n: string) => played.push(n), loop: noop, stopLoop: noop }
        } as unknown as Parameters<typeof createDfViewmodelImpl>[0]
        const vm = createDfViewmodelImpl(ctx)
        const input = { speed: 0, sprinting: false, crouching: false, grounded: true, look: { x: 0, y: 0 }, ads: false, adsMult: 1, sliding: false, strafe: 0, vy: 0 }
        const run = (seconds: number, o: Partial<typeof input> = {}) => {
            for (let t = 0; t < seconds; t += 1 / 60) vm.update(1 / 60, { ...input, ...o })
        }
        return { vm, run, played, bursts }
    }

    it('animates every weapon through raise, fire, reload, inspect, sprint and slide without a hitch', () => {
        for (const id of DF_WEAPON_IDS) {
            const { vm, run } = harness()
            vm.equip({ id, pap: 0, attachments: {} }, 1)
            run(0.6)
            for (let i = 0; i < 3; i++) {
                vm.fire()
                run(0.2)
            }
            const s = dfWeaponStats(id, 0)
            vm.reload(true, s.perRoundReload > 0 ? s.perRoundReload : s.reloadEmptyTime, s.perRoundReload > 0)
            run(s.reloadEmptyTime + 0.2)
            vm.inspect?.()
            run(0.5)
            run(0.5, { sprinting: true, speed: 1 })
            run(0.5, { sliding: true, crouching: true, speed: 1, strafe: 0.5 })
            run(0.3, { grounded: false, vy: 4 })
            run(0.3, { grounded: true, vy: -6 })
            const p = new THREE.Vector3()
            vm.root.traverse(o => expect(Number.isFinite(o.position.x + o.position.y + o.position.z), `${id} ${o.name}`).toBe(true))
            vm.muzzleWorld(new THREE.PerspectiveCamera(), p)
            expect(Number.isFinite(p.x + p.y + p.z), id).toBe(true)
            vm.dispose()
        }
    })

    it('breaks the coach gun open and spills the hulls on a reload, then snaps it shut', () => {
        const { vm, run, played } = harness()
        vm.equip({ id: 'sawnoff', pap: 0, attachments: {} }, 1)
        run(0.6)
        vm.fire()
        run(0.2)
        vm.fire()
        run(0.2)
        vm.reload(true, 1.7, false)
        let opened = 0
        let shellsShown = false
        let barrel: THREE.Object3D | null = null
        vm.root.traverse((o) => {
            if (o.name === 'barrel') barrel = o
        })
        for (let t = 0; t < 1.8; t += 1 / 60) {
            run(1 / 60)
            opened = Math.max(opened, -((barrel as THREE.Object3D | null)?.rotation.x ?? 0))
            vm.root.traverse((o) => {
                if (o.name === 'mag' && o.visible) shellsShown = true
            })
        }
        expect(opened).toBeGreaterThan(0.4)
        expect(shellsShown).toBe(true)
        expect((barrel as THREE.Object3D | null)?.rotation.x ?? 1).toBeCloseTo(0, 3)
        for (const n of [DF_WSND.breakOpen, DF_WSND.eject, DF_WSND.breakClose]) expect(played, n).toContain(n)
    })

    it('works the Winchester lever between shots and turns the Webley cylinder a chamber per shot', () => {
        const a = harness()
        a.vm.equip({ id: 'win1895', pap: 0, attachments: {} }, 1)
        a.run(0.6)
        a.vm.fire()
        let lever: THREE.Object3D | null = null
        a.vm.root.traverse((o) => {
            if (o.name === 'lever') lever = o
        })
        let thrown = 0
        for (let t = 0; t < 0.7; t += 1 / 60) {
            a.run(1 / 60)
            thrown = Math.max(thrown, (lever as THREE.Object3D | null)?.rotation.x ?? 0)
        }
        expect(thrown).toBeGreaterThan(0.5)
        expect(a.played).toContain(DF_WSND.leverOpen)
        expect(a.played).toContain(DF_WSND.leverClose)

        const b = harness()
        b.vm.equip({ id: 'webley', pap: 0, attachments: {} }, 1)
        b.run(0.6)
        let pan: THREE.Object3D | null = null
        b.vm.root.traverse((o) => {
            if (o.name === 'pan') pan = o
        })
        b.vm.fire()
        b.run(0.4)
        expect((pan as THREE.Object3D | null)?.rotation.z ?? 0).toBeCloseTo(Math.PI / 3, 2)
    })

    it('throws a jet of fire instead of a flash from the flamethrower', () => {
        const { vm, run, bursts } = harness()
        vm.equip({ id: 'flammen', pap: 0, attachments: {} }, 1)
        run(0.6)
        vm.fire()
        expect(bursts).toContain('flame')
        expect(bursts).not.toContain('muzzle-smoke')
    })
})
