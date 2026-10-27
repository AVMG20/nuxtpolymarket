import * as THREE from 'three'
import { DF_KIT, dfRarity } from '#shared/utils/dead-front/rarity'
import type { DfKitDropSnap } from '#shared/utils/dead-front/salvage'
import { DF_ARSENAL_SND, registerDfArsenalSounds } from '../engine/arsenal-sounds'
import { dfVoxMaterial } from '../voxel/material'
import type { DfVoxMaterial } from '../voxel/material'
import { DfVoxModel } from '../voxel/model'
import type { DfWorldKit, DfWorldPart } from './kit'
import { easeOutBack } from './util'

// Upgrade kits: an armourer's tool chest with brass corners and a glowing
// band in its rarity colour, offered by the mystery box and, when its claimer
// didn't need it, set down on the ground for anyone (world.arsenal.kits). It
// bobs and glows on the ground and blinks out through its last seconds.

const C = 0.045

function chestModel(): { body: DfVoxModel, band: DfVoxModel } {
    const body = new DfVoxModel(12, 7, 8)
    const wood = body.shade(0x5a3a22, 0.08, 111)
    const brass = body.c(0xb08a3c)
    body.box(0, 0, 0, 12, 6, 8, wood)
    for (const [i, k] of [[0, 0], [11, 0], [0, 7], [11, 7]] as const) body.box(i, 0, k, i + 1, 6, k + 1, brass)
    body.box(5, 6, 3, 7, 7, 5, brass) // the handle
    body.box(5, 2, 7, 7, 4, 8, brass) // the clasp
    // the band: a glowing strip round the lid, drawn in its own material
    const band = new DfVoxModel(12, 1, 8)
    band.box(0, 0, 0, 12, 1, 8, (i, _j, k) => (i === 0 || i === 11 || k === 0 || k === 7 ? band.c(0xffffff, 1) : 0))
    return { body, band }
}

let shared: { body: THREE.BufferGeometry, band: THREE.BufferGeometry, users: number } | null = null

/** The kit chest in a tier's colour (a group; `material` glows in the tier colour), its body in `bodyMat`. Release with `dispose`. */
export function dfBuildKitModel(tier: number, bodyMat: THREE.Material): { obj: THREE.Group, material: DfVoxMaterial, dispose(): void } {
    if (!shared) {
        const m = chestModel()
        shared = { body: m.body.mesh(C, [6, 0, 4])!, band: m.band.mesh(C, [6, 0, 4])!, users: 0 }
    }
    shared.users++
    const material = dfVoxMaterial({ glow: 1.6 })
    material.color.set(dfRarity(tier).color)
    const obj = new THREE.Group()
    const body = new THREE.Mesh(shared.body, bodyMat)
    obj.add(body)
    const band = new THREE.Mesh(shared.band, material)
    band.position.y = 4 * C
    band.scale.set(1.02, 1, 1.04)
    obj.add(band)
    let disposed = false
    return {
        obj,
        material,
        dispose() {
            if (disposed) return
            disposed = true
            obj.removeFromParent()
            material.dispose()
            if (shared && --shared.users <= 0) {
                shared.body.dispose()
                shared.band.dispose()
                shared = null
            }
        }
    }
}

interface KitView {
    id: number
    model: ReturnType<typeof dfBuildKitModel>
    pos: THREE.Vector3
    age: number
    seen: boolean
}

export function createDfKitDrops(kit: DfWorldKit): DfWorldPart {
    const { ctx } = kit
    registerDfArsenalSounds(ctx.audio)
    const views = new Map<number, KitView>()
    const tmp = new THREE.Vector3()

    const make = (k: DfKitDropSnap): KitView => {
        const model = dfBuildKitModel(k.tier, kit.mat)
        model.obj.position.set(k.pos.x, k.pos.y, k.pos.z)
        model.obj.rotation.y = k.yaw
        kit.root.add(model.obj)
        return { id: k.id, model, pos: new THREE.Vector3(k.pos.x, k.pos.y, k.pos.z), age: 0, seen: true }
    }

    return {
        update(dt, world, time) {
            for (const v of views.values()) v.seen = false
            for (const k of world.arsenal?.kits ?? []) {
                let v = views.get(k.id)
                if (!v) views.set(k.id, v = make(k))
                v.seen = true
                v.age += dt
                const pop = Math.min(1, v.age / 0.4)
                v.model.obj.scale.setScalar(Math.max(0.01, easeOutBack(pop)) * 1.2)
                v.model.obj.position.y = v.pos.y + 0.06 + Math.sin(time * 2.2 + k.id) * 0.04
                // fading out: blinks faster through its last seconds
                const warn = k.ttl < DF_KIT.warn
                const blink = warn ? Math.sin(time * (6 + (DF_KIT.warn - k.ttl) * 0.8)) > -0.2 : true
                v.model.obj.visible = blink
                v.model.material.userData.uGlow.value = 1.3 + 0.6 * Math.sin(time * 3.5)
                if (Math.random() < dt * 3) ctx.fx.burst('powerup', tmp.set(k.pos.x, k.pos.y + 0.45, k.pos.z), { count: 1, color: dfRarity(k.tier).color, scale: 0.4 })
            }
            for (const v of [...views.values()]) {
                if (v.seen) continue
                v.model.dispose()
                views.delete(v.id)
            }
        },
        onEvent(ev) {
            if (ev.k === 'kitDrop') {
                tmp.set(ev.pos.x, ev.pos.y + 0.3, ev.pos.z)
                ctx.fx.burst('powerup', tmp, { count: 12, color: dfRarity(ev.tier).color })
                kit.play(DF_ARSENAL_SND.deploy, tmp, 0.6)
            }
        },
        dispose() {
            for (const v of views.values()) v.model.dispose()
            views.clear()
        }
    }
}
