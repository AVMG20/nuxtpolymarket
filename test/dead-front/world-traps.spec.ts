import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DF_MAP, dfInteractables } from '#shared/utils/dead-front/map'
import type { DfPlayerSnap, DfTrapSnap, DfWorldSnap } from '#shared/utils/dead-front/protocol'
import { DF_TRAP } from '#shared/utils/dead-front/specials'
import type { DfAudio, DfFx, DfRenderContext } from '../../app/utils/dead-front/context'
import { dfPromptFor } from '../../app/utils/dead-front/engine/prompt'
import { DF_SPECIAL_SND } from '../../app/utils/dead-front/engine/specials-sounds'
import type { DfWorldKit } from '../../app/utils/dead-front/world/kit'
import { createDfTraps } from '../../app/utils/dead-front/world/interact/traps'
import { dfVoxMaterial } from '../../app/utils/dead-front/voxel/material'
import { dfBuildCollision } from '#shared/utils/dead-front/physics'

function setup() {
    const sounds: string[] = []
    const bolts: { from: THREE.Vector3, to: THREE.Vector3 }[] = []
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200)
    const fx: DfFx = {
        burst: () => {},
        tracer: () => {},
        lightning: (a, b) => { bolts.push({ from: new THREE.Vector3(a.x, a.y, a.z), to: new THREE.Vector3(b.x, b.y, b.z) }) },
        decal: () => {},
        flash: () => {},
        shake: () => {}
    }
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
    return { kit, sounds, bolts, root }
}

function world(traps: DfTrapSnap[], power = true): DfWorldSnap {
    return {
        doors: [], planks: {}, power, box: { spot: 0, state: 'idle', timer: 0 }, pap: { state: 'idle', timer: 0 },
        egg: { step: 'power', fusesFound: [], charge: 0, chargeNeeded: 12, rodsOn: [], rodTimer: 0 }, double: 0, insta: 0, traps
    } as DfWorldSnap
}

const traps = DF_MAP.traps ?? []

describe('dead front electric traps (client)', () => {
    it('are on the live map as use targets', () => {
        expect(traps.length).toBe(2)
        const its = dfInteractables(DF_MAP).filter(i => i.kind === 'trap')
        expect(its.map(i => i.id).sort()).toEqual(traps.map(t => t.id).sort())
    })

    it('prompt: power, cost, running and cooldown', () => {
        const it_ = dfInteractables(DF_MAP).find(i => i.id === traps[0]!.id)!
        const me = { pid: 0, life: 'alive', points: 500, weapons: [], slot: 0, perks: [] } as unknown as DfPlayerSnap
        const ctx = (w: DfWorldSnap, points = 500) => ({ map: DF_MAP, world: w, me: { ...me, points }, solo: true })
        expect(dfPromptFor(it_, ctx(world([], false)))!.text).toBe('Requires power')
        const poor = dfPromptFor(it_, ctx(world([])))!
        expect(poor.cost).toBe(DF_TRAP.cost)
        expect(poor.ok).toBe(false)
        expect(poor.sub).toContain(traps[0]!.label)
        const rich = dfPromptFor(it_, ctx(world([]), 5000))!
        expect(rich.ok).toBe(true)
        expect(rich.action).toBe('use')
        const running = dfPromptFor(it_, ctx(world([{ id: traps[0]!.id, state: 'active', timer: 12.3 }]), 5000))!
        expect(running.action).toBe('none')
        expect(running.sub).toContain('13 s')
        const cooling = dfPromptFor(it_, ctx(world([{ id: traps[0]!.id, state: 'cooldown', timer: 40 }]), 5000))!
        expect(cooling.text).toContain('cooling down')
        expect(cooling.sub).toContain('40 s')
    })

    it('view: starts on the buy, arcs and hums while live, fries kills, winds down and comes back ready', () => {
        const { kit, sounds, bolts, root } = setup()
        const part = createDfTraps(kit)
        expect(root.children.length).toBeGreaterThan(traps.length)
        const id = traps[0]!.id
        const step = (w: DfWorldSnap, n: number) => {
            for (let i = 0; i < n; i++) part.update(1 / 60, w, i / 60)
        }
        step(world([]), 30)
        expect(sounds).toHaveLength(0)
        part.onEvent!({ k: 'buy', p: 0, what: `trap:${id}` })
        expect(sounds).toContain(DF_SPECIAL_SND.trapStart)
        // the snapshot lags the event: it must not switch the trap back off
        step(world([]), 10)
        expect(sounds).not.toContain(DF_SPECIAL_SND.trapOff)
        step(world([{ id, state: 'active', timer: 20 }]), 120)
        expect(sounds).toContain(DF_SPECIAL_SND.trapHum)
        expect(bolts.length).toBeGreaterThan(3)
        const a = traps[0]!.area
        const pos = { x: (a.min.x + a.max.x) / 2, y: 0, z: (a.min.z + a.max.z) / 2 }
        part.onEvent!({ k: 'kill', z: 1, p: -1, zone: 'body', weapon: 'trap', pos })
        expect(sounds).toContain(DF_SPECIAL_SND.trapFry)
        step(world([{ id, state: 'cooldown', timer: 60 }]), 2)
        expect(sounds).toContain(DF_SPECIAL_SND.trapOff)
        step(world([{ id, state: 'idle', timer: 0 }]), 2)
        expect(sounds).toContain(DF_SPECIAL_SND.trapReady)
        part.dispose()
        expect(root.children.length).toBe(0)
    })

    it('joining mid-run catches up quietly', () => {
        const { kit, sounds } = setup()
        const part = createDfTraps(kit)
        for (let i = 0; i < 60; i++) part.update(1 / 60, world([{ id: traps[1]!.id, state: 'active', timer: 10 }]), i / 60)
        expect(sounds).not.toContain(DF_SPECIAL_SND.trapStart)
        part.dispose()
    })
})
