import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { DfZombieSnap } from '#shared/utils/dead-front/protocol'
import type { DfFx, DfAudio, DfRenderContext } from '../../app/utils/dead-front/context'
import { createDfZombieView } from '../../app/utils/dead-front/world/zombies'
import { DF_WORLD_SOUNDS } from '../../app/utils/dead-front/world/sound-names'
import { DF_ZOMBIE_TYPES, P, dfZombieOutfitCount } from '../../app/utils/dead-front/world/zombies/models'
import { dfZombieBatchOf } from '../../app/utils/dead-front/world/zombies/rig'
import type { DfZombieBatch } from '../../app/utils/dead-front/world/zombies/rig'

function mockCtx() {
    const sounds: string[] = []
    const bursts: string[] = []
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200)
    camera.position.set(0, 1.6, 6)
    const fx: DfFx = {
        burst: p => { bursts.push(p) },
        tracer: () => {},
        lightning: () => {},
        decal: () => {},
        flash: () => {},
        shake: () => {}
    }
    const played: { name: string, pos: { x: number, y: number, z: number } | undefined, t: number }[] = []
    const audio: DfAudio = {
        ctx: null,
        register: () => {},
        play: (name, opts) => {
            sounds.push(name)
            played.push({ name, pos: opts?.pos, t: performance.now() })
        },
        loop: () => {},
        stopLoop: () => {}
    }
    const renderer = {
        compile: () => new Set(),
        getDrawingBufferSize: (v: THREE.Vector2) => v.set(1920, 1080)
    } as unknown as THREE.WebGLRenderer
    const ctx: DfRenderContext = { renderer, scene, camera, vmScene: new THREE.Scene(), vmCamera: camera, fx, audio, quality: 'high' }
    return { ctx, sounds, bursts, scene, played }
}

function snap(id: number, type: DfZombieSnap['type'], x: number, z: number, anim: DfZombieSnap['anim'], extra: Partial<DfZombieSnap> = {}): DfZombieSnap {
    return { id, type, pos: { x, y: 0, z }, yaw: 0, hp: 1, anim, ...extra }
}

describe('dead front zombie view', () => {
    it('spawns, animates, kills into corpses that sink away', () => {
        const { ctx, sounds, bursts, scene } = mockCtx()
        const view = createDfZombieView(ctx)
        const dt = 1 / 60
        let t = 0
        const step = (list: DfZombieSnap[], frames: number) => {
            for (let f = 0; f < frames; f++) {
                t += dt
                view.update(dt, list.map(z => ({ ...z, pos: { ...z.pos, z: z.pos.z + t * 1.2 } })))
            }
        }
        const zs = [
            snap(1, 'shambler', 0, 0, 'rise'),
            snap(2, 'ghoul', 1, 0, 'sprint'),
            snap(3, 'brute', -1, 0, 'walk', { armored: true }),
            snap(4, 'bloater', 2, 0, 'spit')
        ]
        step(zs, 30)
        expect(sounds).toContain(DF_WORLD_SOUNDS.rise)
        expect(bursts).toContain('dust')
        // Zombies are drawn through one instanced batch per type and outfit: count the drawn instances.
        const zombiesInScene = () => scene.children
            .filter(c => c.name.startsWith('df-zombies-'))
            .reduce((n, c) => n + (c as THREE.InstancedMesh).count, 0)
        const batches = DF_ZOMBIE_TYPES.reduce((n, t) => n + dfZombieOutfitCount(t), 0)
        expect(scene.children.filter(c => c.name.startsWith('df-zombies-')).length).toBe(batches)
        expect(zombiesInScene()).toBe(4)

        // Helmet knocked off.
        zs[2] = { ...zs[2]!, armored: false, anim: 'stagger' }
        step(zs, 5)
        expect(sounds).toContain(DF_WORLD_SOUNDS.helmetClang)

        // Tells: the ghoul crouches and hisses, the brute roars (both speak however busy the horde is).
        const before = sounds.length
        zs[1] = { ...zs[1]!, anim: 'attack', tell: 'lunge' }
        zs[2] = { ...zs[2]!, anim: 'attack', tell: 'charge' }
        step(zs, 3)
        expect(sounds.slice(before)).toContain('df:attack:ghoul')
        expect(sounds.slice(before)).toContain('df:attack:brute')
        zs[1] = { ...zs[1]!, anim: 'sprint', tell: undefined }
        zs[2] = { ...zs[2]!, anim: 'stagger', tell: undefined }
        step(zs, 3)

        // Attacks play the swipe.
        zs[0] = { ...zs[0]!, anim: 'attack' }
        step(zs, 90)
        expect(sounds).toContain(DF_WORLD_SOUNDS.swipe)
        view.onEvent({ k: 'zhit', z: 1, p: 0, dmg: 50 })

        view.onEvent({ k: 'hit', z: 2, p: 0, zone: 'head', pos: { x: 1, y: 1.5, z: 0.5 }, dmg: 100 })
        expect(bursts).toContain('blood')
        view.onEvent({ k: 'kill', z: 1, p: 0, zone: 'head', weapon: 'kar98k', pos: { x: 0, y: 1.6, z: 1 } })
        view.onEvent({ k: 'kill', z: 2, p: 0, zone: 'body', weapon: 'grenade', pos: { x: 1, y: 1, z: 0 }, gib: true })
        view.onEvent({ k: 'kill', z: 4, p: 0, zone: 'body', weapon: 'arc', pos: { x: 2, y: 1, z: 1 } })
        view.onEvent({ k: 'gas', pos: { x: 2, y: 0, z: 0 }, radius: 2.5, seconds: 6 })
        expect(sounds).toContain(DF_WORLD_SOUNDS.headPop)
        expect(sounds).toContain(DF_WORLD_SOUNDS.gib)
        expect(bursts).toContain('electric')
        // The killed zombies are still listed for a moment (interpolation delay).
        step(zs, 6)
        step([zs[2]!], 120)
        expect(sounds).toContain(DF_WORLD_SOUNDS.bodyFall)
        // Brute (3) still alive; corpses of 1 and 4 still lying; 2's limbs (almost always some) still tumbling.
        expect(zombiesInScene()).toBeGreaterThanOrEqual(3)
        expect(zombiesInScene()).toBeLessThanOrEqual(4)
        step([zs[2]!], 60 * 8)
        expect(zombiesInScene()).toBe(1)
        // Despawn without a kill sinks quickly.
        step([], 120)
        expect(zombiesInScene()).toBe(0)
        view.dispose()
        expect(scene.children.map(c => c.type + ':' + c.name)).toEqual([])
    })

    it('spaces groans out: a global budget and a cooldown per zombie', () => {
        const { ctx, played } = mockCtx()
        const view = createDfZombieView(ctx)
        const list: DfZombieSnap[] = []
        for (let i = 0; i < 24; i++) list.push(snap(100 + i, 'shambler', (i % 6) * 1.5, Math.floor(i / 6) * 1.5, 'walk'))
        const groanAt: number[] = []
        const lastBy = new Map<string, number>()
        let minGap = Infinity
        for (let f = 0; f < 60 * 30; f++) {
            const before = played.length
            view.update(1 / 60, list)
            for (const p of played.slice(before)) {
                if (!p.name.startsWith('df:groan:')) continue
                const t = f / 60
                groanAt.push(t)
                const key = `${p.pos?.x.toFixed(2)},${p.pos?.z.toFixed(2)}`
                const last = lastBy.get(key)
                if (last !== undefined) minGap = Math.min(minGap, t - last)
                lastBy.set(key, t)
            }
        }
        // A room of 24 groans now and then (never a drone), and nobody repeats within seconds.
        expect(groanAt.length).toBeGreaterThan(5)
        expect(groanAt.length).toBeLessThanOrEqual(30)
        for (let i = 1; i < groanAt.length; i++) expect(groanAt[i]! - groanAt[i - 1]!).toBeGreaterThanOrEqual(1)
        expect(minGap).toBeGreaterThanOrEqual(6)
        view.dispose()
    })

    it('masks gas-round zombies and drops crawlers onto their stumps', () => {
        const { ctx, sounds, bursts, scene } = mockCtx()
        const view = createDfZombieView(ctx)
        // the ghoul sits in slot 0 of whichever outfit batch it drew
        const drawn = (): DfZombieBatch => scene.children.map(c => dfZombieBatchOf.get(c)!).find(b => b && b.type === 'ghoul' && b.active > 0)!
        const m = new THREE.Matrix4()
        const shown = (part: number) => drawn().part(0, part, m).elements.some(x => x !== 0)
        const headY = () => drawn().part(0, P.head, m).elements[13]!
        const run = (z: DfZombieSnap, frames: number) => {
            for (let f = 0; f < frames; f++) view.update(1 / 60, [z])
        }

        let z = snap(1, 'ghoul', 0, 0, 'sprint', { masked: true })
        run(z, 5)
        expect(shown(P.mask)).toBe(true)
        expect(shown(P.eyes)).toBe(false)
        z = { ...z, masked: undefined }
        run(z, 2)
        expect(shown(P.mask)).toBe(false)
        expect(shown(P.eyes)).toBe(true)

        // standing: shins on, no stumps
        expect(shown(P.legLL)).toBe(true)
        expect(shown(P.stumpL)).toBe(false)
        const standing = headY()
        // the legs come off: gore, then it topples onto its front and drags itself along
        z = { ...z, crawl: true, anim: 'stagger' }
        run(z, 1)
        expect(bursts).toContain('blood-mist')
        expect(sounds).toContain(DF_WORLD_SOUNDS.gib)
        expect(shown(P.legLL)).toBe(false)
        expect(shown(P.stumpL)).toBe(true)
        run(z, 50)
        expect(sounds).toContain(DF_WORLD_SOUNDS.bodyFall)
        z = { ...z, anim: 'crawl' }
        run(z, 30)
        expect(headY()).toBeLessThan(standing * 0.5)
        // a crawler seen for the first time is simply down (no gore)
        const gibs = sounds.filter(s => s === DF_WORLD_SOUNDS.gib).length
        view.update(1 / 60, [z, snap(2, 'shambler', 3, 0, 'crawl', { crawl: true })])
        expect(sounds.filter(s => s === DF_WORLD_SOUNDS.gib).length).toBe(gibs)
        // killed while down, it stays down
        view.onEvent({ k: 'kill', z: 1, p: 0, zone: 'body', weapon: 'kar98k', pos: { x: 0, y: 0.3, z: 0.4 } })
        for (let f = 0; f < 60; f++) view.update(1 / 60, [])
        expect(shown(P.stumpL)).toBe(true)
        expect(headY()).toBeLessThan(standing * 0.5)
        view.dispose()
    })
})
