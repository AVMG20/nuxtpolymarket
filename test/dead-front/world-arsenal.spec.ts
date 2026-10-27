import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DF_MAP } from '#shared/utils/dead-front/map'
import { dfBuildCollision } from '#shared/utils/dead-front/physics'
import type { DfEvent, DfWorldSnap } from '#shared/utils/dead-front/protocol'
import { dfPlanStrike } from '#shared/utils/dead-front/support'
import type { DfArsenalSnap } from '#shared/utils/dead-front/salvage'
import type { DfAudio, DfFx, DfRenderContext } from '../../app/utils/dead-front/context'
import { DF_ARSENAL_SND } from '../../app/utils/dead-front/engine/arsenal-sounds'
import type { DfWorldKit, DfWorldPart } from '../../app/utils/dead-front/world/kit'
import { createDfWorkbenches } from '../../app/utils/dead-front/world/interact/workbench'
import { createDfCrates } from '../../app/utils/dead-front/world/crates'
import { createDfKitDrops } from '../../app/utils/dead-front/world/kits'
import { createDfSalvageDrops } from '../../app/utils/dead-front/world/salvage'
import { createDfGear } from '../../app/utils/dead-front/world/sentry'
import { createDfStrikes } from '../../app/utils/dead-front/world/strikes'
import { dfVoxMaterial } from '../../app/utils/dead-front/voxel/material'

function setup() {
    const sounds: string[] = []
    const tracers: number[] = []
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200)
    camera.position.set(100, 50, 100)
    const shakes: number[] = []
    const fx: DfFx = { burst: () => {}, tracer: () => { tracers.push(1) }, lightning: () => {}, decal: () => {}, flash: () => {}, shake: (n) => { shakes.push(n) } }
    const audio: DfAudio = { ctx: null, register: () => {}, play: (name) => { sounds.push(name) }, loop: () => {}, stopLoop: () => {} }
    const ctx = { renderer: {} as THREE.WebGLRenderer, scene: new THREE.Scene(), camera, vmScene: new THREE.Scene(), vmCamera: camera, fx, audio, quality: 'high' } as DfRenderContext
    const root = new THREE.Group()
    const kit = {
        ctx, map: DF_MAP, root, mat: dfVoxMaterial(), quality: 'high', shadows: false,
        collision: dfBuildCollision(DF_MAP, new Set()),
        state: { powerOn: true, power: 1, powerAge: 10, time: 0 },
        powerDelay: () => 0,
        play: (name: string) => { sounds.push(name) }
    } as unknown as DfWorldKit
    return { kit, sounds, tracers, root, camera, shakes }
}

function world(arsenal: Partial<DfArsenalSnap>): DfWorldSnap {
    return {
        doors: [], planks: {}, power: true, box: { spot: 0, state: 'idle', timer: 0 }, pap: { state: 'idle', timer: 0 },
        egg: { step: 'power', fusesFound: [], charge: 0, chargeNeeded: 12, rodsOn: [], rodTimer: 0 }, double: 0, insta: 0,
        arsenal: { players: [], sentries: [], decoys: [], scrap: 0, parts: 0, ...arsenal }
    }
}

function drive(part: DfWorldPart, w: DfWorldSnap, seconds: number, t0 = 0): void {
    for (let t = 0; t < seconds; t += 1 / 30) part.update(1 / 30, w, t0 + t)
}

describe('dead front arsenal (client world parts)', () => {
    it('workbenches build on the map and hammer on a craft', () => {
        const { kit, sounds, root } = setup()
        const part = createDfWorkbenches(kit)
        expect(root.children.length).toBe(DF_MAP.benches!.length)
        drive(part, world({ scrap: 20, parts: 1 }), 0.5)
        part.onEvent!({ k: 'craft', p: 0, item: 'sentry', bench: DF_MAP.benches![0]!.id })
        drive(part, world({ scrap: 13 }), 1.5)
        expect(sounds).toContain(DF_ARSENAL_SND.craft)
        part.dispose()
        expect(root.children.length).toBe(0)
    })

    it('salvage pops out, is taken when walked over (heard at once), and is gone once settled', () => {
        const { kit, sounds, root, camera } = setup()
        const part = createDfSalvageDrops(kit)
        const drop = { id: 7, kind: 'part' as const, pos: { x: 2, y: 0, z: 30 }, n: 1, ttl: 30 }
        drive(part, world({ drops: [drop] }), 0.5)
        expect(root.children.length).toBe(1)
        camera.position.set(2.2, 1.6, 30.1)
        drive(part, world({ drops: [drop] }), 0.4)
        expect(sounds).toContain(DF_ARSENAL_SND.part)
        // the server's event doesn't play it twice
        part.onEvent!({ k: 'salvage', p: 0, kind: 'part', n: 1, id: 7, pos: drop.pos })
        expect(sounds.filter(s => s === DF_ARSENAL_SND.part)).toHaveLength(1)
        drive(part, world({ drops: [] }), 0.4)
        expect(root.children.length).toBe(0)
        part.dispose()
    })

    it('a sentry swings, draws a tracer per shot and is retired by its event; a gramophone plays', () => {
        const { kit, sounds, tracers, root } = setup()
        const part = createDfGear(kit)
        const s = { id: 3, owner: 0, pos: { x: 2, y: 0, z: 28 }, yaw: 0, ammo: 1, life: 50, hp: 0.4, shots: 0, tgt: { x: 2, y: 1.1, z: 22 } }
        drive(part, world({ sentries: [s], decoys: [{ id: 4, owner: 0, pos: { x: 5, y: 0, z: 28 }, yaw: 0, fuse: 6 }] }), 0.5)
        drive(part, world({ sentries: [{ ...s, shots: 3 }], decoys: [{ id: 4, owner: 0, pos: { x: 5, y: 0, z: 28 }, yaw: 0, fuse: 1.5 }] }), 1.6)
        expect(tracers.length).toBe(3)
        expect(sounds).toContain(DF_ARSENAL_SND.sentryShot)
        expect(sounds.some(n => n.startsWith(DF_ARSENAL_SND.waltz))).toBe(true)
        part.onEvent!({ k: 'sentry', id: 3, what: 'broken', pos: s.pos })
        part.onEvent!({ k: 'decoy', id: 4, pos: s.pos })
        expect(sounds).toContain(DF_ARSENAL_SND.sentryBroken)
        drive(part, world({}), 0.2)
        expect(root.children.length).toBe(0)
        part.dispose()
    })

    it('upgrade kits sit on the ground in their colour and go when the snapshot drops them', () => {
        const { kit, root } = setup()
        const part = createDfKitDrops(kit)
        const k = { id: 9, tier: 3, pos: { x: 0, y: 0, z: 30 }, yaw: 0, ttl: 10 }
        drive(part, world({ kits: [k] }), 0.5)
        expect(root.children.length).toBe(1)
        drive(part, world({ kits: [] }), 0.1)
        expect(root.children.length).toBe(0)
        part.dispose()
    })

    it('supply crates: drawn in their colour, flaring when they open, gone with their event', () => {
        const { kit, sounds, root } = setup()
        const part = createDfCrates(kit)
        const c = { id: 5, item: 'bomber' as const, pos: { x: 0, y: 0, z: 30 }, owner: 0, open: false, opensIn: 10, ttl: 50 }
        drive(part, world({ crates: [c] }), 0.5)
        expect(root.children.length).toBe(1)
        drive(part, world({ crates: [{ ...c, open: true, opensIn: 0 }] }), 0.5)
        part.onEvent!({ k: 'crate', p: 1, owner: 0, item: 'bomber', id: 5, pos: c.pos })
        expect(sounds).toContain(DF_ARSENAL_SND.crate)
        expect(root.children.length).toBe(0)
        part.dispose()
    })

    it('stages every strike: whistles ahead of the shells and bombs, the flyers come and go, the carpet shakes', () => {
        const { kit, sounds, root, shakes } = setup()
        const part = createDfStrikes(kit)
        const at = { x: 4, y: 0, z: 20 }
        for (const reward of ['barrage', 'zeppelin', 'bomber'] as const) {
            const plan = dfPlanStrike(reward, at, { x: 0, y: 0, z: -1 }, () => 0.5)
            const ev: DfEvent = { k: 'strike', p: 0, reward, id: 1, at, dir: { x: 0, y: 0, z: -1 }, hits: plan.hits }
            part.onEvent!(ev)
        }
        // the zeppelin and the bomber
        expect(root.children.length).toBe(2)
        drive(part, world({}), 12)
        expect(sounds.filter(s => s === DF_ARSENAL_SND.whistle).length).toBeGreaterThanOrEqual(8 + 11 + 10)
        expect(sounds).toContain(DF_ARSENAL_SND.zeppelin)
        expect(sounds).toContain(DF_ARSENAL_SND.bomber)
        expect(sounds).toContain(DF_ARSENAL_SND.carpet)
        expect(shakes.some(s => s >= 0.5)).toBe(true)
        drive(part, world({}), 4)
        expect(root.children.length).toBe(0)
        part.dispose()
    })
})
