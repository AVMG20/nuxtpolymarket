import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DF_MAP } from '#shared/utils/dead-front/map'
import { dfBuildCollision } from '#shared/utils/dead-front/physics'
import type { DfWorldSnap } from '#shared/utils/dead-front/protocol'
import type { DfFx, DfRenderContext } from '../../app/utils/dead-front/context'
import type { DfWorldKit } from '../../app/utils/dead-front/world/kit'
import { createDfMysteryBox } from '../../app/utils/dead-front/world/interact/box'
import type { DfWeaponCache } from '../../app/utils/dead-front/world/interact/weapon-cache'
import { DF_WORLD_SOUNDS } from '../../app/utils/dead-front/world/sound-names'
import { dfVoxMaterial } from '../../app/utils/dead-front/voxel/material'

function world(box: DfWorldSnap['box']): DfWorldSnap {
    return {
        doors: [], planks: {}, power: false, box, pap: { state: 'idle', timer: 0 },
        egg: { step: 'power', fusesFound: [], charge: 0, chargeNeeded: 12, rodsOn: [], rodTimer: 0 }, double: 0, insta: 0
    } as DfWorldSnap
}

describe('dead front mystery box', () => {
    it('lifts off, bursts away and lands at the new spot under its beam', () => {
        const sounds: string[] = []
        const bursts: string[] = []
        const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200)
        const fx: DfFx = { burst: (p) => { bursts.push(p) }, tracer: () => {}, lightning: () => {}, decal: () => {}, flash: () => {}, shake: () => {} }
        const ctx = { scene: new THREE.Scene(), camera, fx, quality: 'high' } as unknown as DfRenderContext
        const root = new THREE.Group()
        const kit = {
            ctx, map: DF_MAP, root, mat: dfVoxMaterial(), quality: 'high', shadows: false, collision: dfBuildCollision(DF_MAP, new Set()),
            state: { powerOn: false, power: 0, powerAge: 0, time: 0 }, powerDelay: () => 0,
            play: (name: string) => { sounds.push(name) }
        } as unknown as DfWorldKit
        const cache = { get: () => new THREE.Group(), dispose: () => {} } as unknown as DfWeaponCache
        const part = createDfMysteryBox(kit, cache)
        const box = root.getObjectByName('df-mystery-box')!
        let t = 0
        const step = (w: DfWorldSnap, seconds: number) => {
            for (let i = 0; i < seconds * 60; i++) part.update(1 / 60, w, (t += 1 / 60))
        }
        step(world({ spot: 1, state: 'idle', timer: 0 }), 0.5)
        expect(box.position.x).toBeCloseTo(DF_MAP.boxSpots[1]!.pos.x)
        step(world({ spot: 1, state: 'moving', timer: 6 }), 1.5)
        const body = box.children[0]!
        expect(body.position.y).toBeGreaterThan(0.05)
        expect(body.visible).toBe(true)
        step(world({ spot: 1, state: 'moving', timer: 4 }), 1.5)
        expect(body.visible).toBe(false)
        expect(bursts).toContain('splinters')
        step(world({ spot: 2, state: 'idle', timer: 0 }), 2)
        expect(box.position.x).toBeCloseTo(DF_MAP.boxSpots[2]!.pos.x)
        expect(body.visible).toBe(true)
        expect(body.position.y).toBeCloseTo(0)
        expect(sounds).toContain(DF_WORLD_SOUNDS.boxLand)
        part.dispose()
    })
})
