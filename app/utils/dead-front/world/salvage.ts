import * as THREE from 'three'
import { DF_SALVAGE } from '#shared/utils/dead-front/salvage'
import type { DfSalvageDropSnap } from '#shared/utils/dead-front/salvage'
import { DF_ARSENAL_SND, registerDfArsenalSounds } from '../engine/arsenal-sounds'
import { dfVoxMaterial } from '../voxel/material'
import { DfVoxModel } from '../voxel/model'
import type { DfWorldKit, DfWorldPart } from './kit'
import { easeOutBack } from './util'

// Salvage on the ground (world.arsenal.drops): a little heap of rusty plates,
// nuts and a cog for scrap; a brass valve with a blue-glowing tube for a rare
// part. They pop out of the body, bob and turn, glint, and blink before they
// rust away. Walking over one takes it at once on this client (the pickup
// sound plays now); the server's `salvage` event settles it, and a teammate's
// pickup sparkles where it lay.

const C = 0.045
const PART_BLUE = 0x7fc8ff

function scrapModel(): DfVoxModel {
    const m = new DfVoxModel(8, 4, 8)
    const rust = m.shade(0x7b4b2b, 0.14, 81)
    const iron = m.shade(0x55585e, 0.08, 82)
    const brass = m.c(0xb08a3c)
    m.box(1, 0, 1, 7, 1, 6, rust)
    m.box(2, 1, 2, 6, 2, 7, iron)
    m.box(0, 0, 4, 3, 2, 8, iron)
    // a cog standing on its edge
    m.box(4, 1, 1, 5, 4, 4, brass)
    m.set(4, 4, 2, 0).set(4, 1, 1, 0)
    m.box(1, 1, 1, 2, 3, 2, rust)
    return m
}

function partModel(): DfVoxModel {
    // a brass valve body with a glass tube glowing on top
    const m = new DfVoxModel(5, 8, 5)
    const brass = m.shade(0xc49a42, 0.08, 83)
    m.box(0, 0, 0, 5, 2, 5, brass)
    m.box(1, 2, 1, 4, 3, 4, m.c(0x6a4d22))
    m.box(1, 3, 1, 4, 7, 4, m.c(PART_BLUE, 1.2))
    m.box(2, 7, 2, 3, 8, 3, brass)
    m.box(0, 1, 2, 5, 2, 3, m.c(0x2b2c2f))
    return m
}

interface Drop {
    id: number
    kind: DfSalvageDropSnap['kind']
    obj: THREE.Object3D
    pos: THREE.Vector3
    age: number
    /** Gone from the snapshot or taken: shrinking out. */
    leaving: number
    seen: boolean
    spin: number
}

export function createDfSalvageDrops(kit: DfWorldKit): DfWorldPart {
    const { ctx } = kit
    registerDfArsenalSounds(ctx.audio)
    const scrapGeo = scrapModel().mesh(C, [4, 0, 4])!
    const partGeo = partModel().mesh(C, [2.5, 0, 2.5])!
    const glowMat = dfVoxMaterial({ glow: 1 })
    const drops = new Map<number, Drop>()
    /** Drops this client walked over (hidden and heard at once; the server settles them). */
    const taken = new Map<number, number>()
    const cam = new THREE.Vector3()
    let clock = 0

    const make = (d: DfSalvageDropSnap): Drop => {
        const obj = new THREE.Mesh(d.kind === 'part' ? partGeo : scrapGeo, d.kind === 'part' ? glowMat : kit.mat)
        obj.castShadow = false
        obj.receiveShadow = kit.shadows
        obj.position.set(d.pos.x, d.pos.y, d.pos.z)
        obj.scale.setScalar(0.01)
        kit.root.add(obj)
        return { id: d.id, kind: d.kind, obj, pos: new THREE.Vector3(d.pos.x, d.pos.y, d.pos.z), age: 0, leaving: 0, seen: true, spin: Math.random() * Math.PI * 2 }
    }

    const sparkle = (pos: THREE.Vector3, part: boolean) => {
        ctx.fx.burst('powerup', pos, { count: part ? 14 : 6, color: part ? PART_BLUE : 0xd9a75a, scale: part ? 0.6 : 0.35 })
        if (part) ctx.fx.flash(pos, PART_BLUE, 3, 0.25)
    }

    return {
        update(dt, world, time) {
            clock += dt
            const list = world.arsenal?.drops ?? []
            for (const d of drops.values()) d.seen = false
            for (const s of list) {
                let d = drops.get(s.id)
                if (!d) {
                    if (taken.has(s.id)) continue
                    d = make(s)
                    drops.set(s.id, d)
                }
                d.seen = true
                const blink = s.ttl < 5 ? (Math.sin(time * 14) > 0 ? 1 : 0.15) : 1
                d.obj.visible = d.leaving === 0 && blink > 0.5
            }
            ctx.camera.getWorldPosition(cam)
            for (const d of drops.values()) {
                d.age += dt
                if (!d.seen && d.leaving === 0) d.leaving = 0.001
                // walking over it: ours now (the server agrees, or a teammate had it a moment sooner: same pool)
                if (d.leaving === 0 && d.age > 0.25) {
                    const dx = cam.x - d.pos.x
                    const dz = cam.z - d.pos.z
                    const dy = cam.y - d.pos.y
                    if (dx * dx + dz * dz < (DF_SALVAGE.pickupRadius * 0.85) ** 2 && dy > 0.4 && dy < 2.4) {
                        taken.set(d.id, clock)
                        d.leaving = 0.001
                        kit.play(d.kind === 'part' ? DF_ARSENAL_SND.part : DF_ARSENAL_SND.scrap, undefined, 0.9)
                        sparkle(d.pos, d.kind === 'part')
                    }
                }
                if (d.leaving > 0) {
                    d.leaving += dt
                    const k = Math.max(0, 1 - d.leaving / 0.18)
                    d.obj.scale.setScalar(k)
                    d.obj.position.y += dt * 2
                    if (k <= 0) {
                        d.obj.removeFromParent()
                        drops.delete(d.id)
                    }
                    continue
                }
                // pop out, then bob and turn
                const pop = Math.min(1, d.age / 0.45)
                const s = easeOutBack(pop) * (d.kind === 'part' ? 1.15 : 1)
                d.obj.scale.setScalar(Math.max(0.01, s))
                const arc = pop < 1 ? Math.sin(pop * Math.PI) * 0.45 : 0
                d.obj.position.set(d.pos.x, d.pos.y + 0.08 + arc + Math.sin(time * 2.6 + d.id) * 0.05, d.pos.z)
                d.spin += dt * (d.kind === 'part' ? 1.8 : 1.1)
                d.obj.rotation.y = d.spin
            }
            glowMat.userData.uGlow.value = 1.3 + 0.5 * Math.sin(time * 4)
            for (const [id, at] of taken) if (clock - at > 5) taken.delete(id)
        },
        onEvent(ev) {
            if (ev.k !== 'salvage') return
            // ours was already heard when we walked over it
            if (taken.has(ev.id)) return
            const pos = new THREE.Vector3(ev.pos.x, ev.pos.y + 0.2, ev.pos.z)
            kit.play(ev.kind === 'part' ? DF_ARSENAL_SND.part : DF_ARSENAL_SND.scrap, pos, 0.7)
            sparkle(pos, ev.kind === 'part')
            const d = drops.get(ev.id)
            if (d && d.leaving === 0) d.leaving = 0.001
        },
        dispose() {
            for (const d of drops.values()) d.obj.removeFromParent()
            drops.clear()
            scrapGeo.dispose()
            partGeo.dispose()
            glowMat.dispose()
        }
    }
}
