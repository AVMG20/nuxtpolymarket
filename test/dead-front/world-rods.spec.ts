import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DF_MAP } from '#shared/utils/dead-front/map'
import type { DfWorldSnap } from '#shared/utils/dead-front/protocol'
import type { DfAudio, DfFx, DfRenderContext } from '../../app/utils/dead-front/context'
import type { DfWorldKit } from '../../app/utils/dead-front/world/kit'
import { createDfRods } from '../../app/utils/dead-front/world/interact/rods'
import { DF_WORLD_SOUNDS } from '../../app/utils/dead-front/world/sound-names'
import { dfVoxMaterial } from '../../app/utils/dead-front/voxel/material'

function setup() {
    const sounds: string[] = []
    const bolts: { to: THREE.Vector3 }[] = []
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200)
    const fx: DfFx = {
        burst: () => {},
        tracer: () => {},
        lightning: (_a, b) => { bolts.push({ to: new THREE.Vector3(b.x, b.y, b.z) }) },
        decal: () => {},
        flash: () => {},
        shake: () => {}
    }
    const audio: DfAudio = { ctx: null, register: () => {}, play: (name) => { sounds.push(name) }, loop: () => {}, stopLoop: () => {} }
    const ctx = { renderer: {} as THREE.WebGLRenderer, scene, camera, vmScene: new THREE.Scene(), vmCamera: camera, fx, audio, quality: 'high' } as DfRenderContext
    const root = new THREE.Group()
    const kit = {
        ctx, map: DF_MAP, root, mat: dfVoxMaterial(), quality: 'high', shadows: false,
        state: { powerOn: true, power: 1, powerAge: 10, time: 0 },
        powerDelay: () => 0,
        play: (name: string) => { sounds.push(name) }
    } as unknown as DfWorldKit
    return { kit, sounds, bolts, root }
}

function world(step: DfWorldSnap['egg']['step'], rodsOn: string[]): DfWorldSnap {
    return {
        doors: [], planks: {}, power: true, box: { spot: 0, state: 'idle', timer: 0 }, pap: { state: 'idle', timer: 0 },
        egg: { step, fusesFound: [], charge: 0, chargeNeeded: 12, rodsOn, rodTimer: 0 }, double: 0, insta: 0
    } as DfWorldSnap
}

describe('dead front lightning rods', () => {
    it('builds a mast per rod, throws on events and fires the payoff when all three are live', () => {
        const { kit, sounds, bolts, root } = setup()
        const part = createDfRods(kit)
        expect(root.children.length).toBe(DF_MAP.egg.rods.length)
        const ids = DF_MAP.egg.rods.map(r => r.id)
        const step = (w: DfWorldSnap, n: number) => {
            for (let i = 0; i < n; i++) part.update(1 / 60, w, i / 60)
        }
        step(world('rods', []), 30)
        expect(sounds).not.toContain(DF_WORLD_SOUNDS.rodLever)
        part.onEvent!({ k: 'rod', id: ids[0]!, p: 0, on: true, n: 1 })
        expect(sounds).toContain(DF_WORLD_SOUNDS.rodLever)
        expect(bolts.some(b => b.to.y > DF_MAP.egg.rods[0]!.pos.y + 15)).toBe(true)
        step(world('rods', [ids[0]!]), 30)
        // A reset sputters out.
        part.onEvent!({ k: 'rod', id: ids[0]!, p: -1, on: false, n: 0 })
        expect(sounds).toContain(DF_WORLD_SOUNDS.rodSputter)
        step(world('rods', []), 30)
        expect(sounds).not.toContain(DF_WORLD_SOUNDS.rodThunder)
        for (const id of ids) part.onEvent!({ k: 'rod', id, p: 0, on: true, n: 1 })
        bolts.length = 0
        step(world('rods', ids), 150)
        expect(sounds).toContain(DF_WORLD_SOUNDS.rodThunder)
        const gen = DF_MAP.egg.generator.pos
        expect(bolts.filter(b => Math.hypot(b.to.x - gen.x, b.to.z - gen.z) < 0.1).length).toBeGreaterThanOrEqual(ids.length * 3)
        part.dispose()
        expect(root.children.length).toBe(0)
    })

    it('catches up quietly from the snapshot when the event was missed', () => {
        const { kit, sounds } = setup()
        const part = createDfRods(kit)
        for (let i = 0; i < 60; i++) part.update(1 / 60, world('rods', [DF_MAP.egg.rods[1]!.id]), i / 60)
        expect(sounds).not.toContain(DF_WORLD_SOUNDS.rodLever)
        part.dispose()
    })
})
