import * as THREE from 'three'
import { DF_RECIPES } from '#shared/utils/dead-front/salvage'
import type { DfCrateSnap } from '#shared/utils/dead-front/salvage'
import { DF_ARSENAL_SND, registerDfArsenalSounds } from '../engine/arsenal-sounds'
import type { DfWorldKit, DfWorldPart } from './kit'
import { dfBuildChestModel } from './kits'
import { easeOutBack } from './util'

// Supply crates (world.arsenal.crates): the rare find, one of the bench's
// items in a chest banded in its colour. While it is still its killer's alone
// it sits low and pulses quickly; when it opens to the whole squad it flares,
// lifts a little and glows steadily. It blinks out through its last seconds.
// The killer's private ones come in their own snapshot slice, merged in.

/** Seconds of blinking before it's gone. */
const WARN = 8

interface CrateView {
    id: number
    model: ReturnType<typeof dfBuildChestModel>
    pos: THREE.Vector3
    color: string
    age: number
    open: boolean
    seen: boolean
}

export function createDfCrates(kit: DfWorldKit): DfWorldPart {
    const { ctx } = kit
    registerDfArsenalSounds(ctx.audio)
    const views = new Map<number, CrateView>()
    const tmp = new THREE.Vector3()

    const make = (c: DfCrateSnap): CrateView => {
        const color = DF_RECIPES[c.item]?.color ?? '#ffd978'
        const model = dfBuildChestModel(color, kit.mat)
        model.obj.position.set(c.pos.x, c.pos.y, c.pos.z)
        model.obj.rotation.y = (c.id * 1.7) % (Math.PI * 2)
        kit.root.add(model.obj)
        return { id: c.id, model, pos: new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z), color, age: 0, open: c.open, seen: true }
    }

    return {
        update(dt, world, time) {
            for (const v of views.values()) v.seen = false
            for (const c of world.arsenal?.crates ?? []) {
                let v = views.get(c.id)
                if (!v) views.set(c.id, v = make(c))
                v.seen = true
                v.age += dt
                if (c.open && !v.open) {
                    // it's anyone's now: a flare in its colour
                    v.open = true
                    tmp.copy(v.pos).setY(v.pos.y + 0.5)
                    ctx.fx.burst('powerup', tmp, { count: 14, color: v.color, scale: 0.8 })
                    ctx.fx.flash(tmp, v.color, 4, 0.3)
                }
                const pop = Math.min(1, v.age / 0.4)
                v.model.obj.scale.setScalar(Math.max(0.01, easeOutBack(pop)) * 1.35)
                v.model.obj.position.y = v.pos.y + (v.open ? 0.18 : 0.04) + Math.sin(time * 2.4 + c.id) * 0.04
                v.model.obj.rotation.y += dt * (v.open ? 0.5 : 0.2)
                // private: a quick, dimmer pulse; open: a steady bright glow
                v.model.material.userData.uGlow.value = v.open ? 2 + 0.3 * Math.sin(time * 3) : 1 + 0.8 * Math.max(0, Math.sin(time * 9))
                const blink = c.ttl < WARN ? Math.sin(time * (8 + (WARN - c.ttl) * 1.5)) > -0.2 : true
                v.model.obj.visible = blink
                if (Math.random() < dt * (v.open ? 5 : 2)) ctx.fx.burst('powerup', tmp.copy(v.pos).setY(v.pos.y + 0.6), { count: 1, color: v.color, scale: 0.45 })
            }
            for (const v of views.values()) {
                if (v.seen) continue
                v.model.dispose()
                views.delete(v.id)
            }
        },
        onEvent(ev) {
            if (ev.k !== 'crate') return
            tmp.set(ev.pos.x, ev.pos.y + 0.4, ev.pos.z)
            const color = DF_RECIPES[ev.item]?.color ?? '#ffd978'
            ctx.fx.burst('powerup', tmp, { count: 18, color, scale: 0.9 })
            ctx.fx.burst('splinters', tmp, { count: 8, scale: 0.5 })
            kit.play(DF_ARSENAL_SND.crate, tmp, 0.8)
            const v = views.get(ev.id)
            if (v) {
                v.model.dispose()
                views.delete(ev.id)
            }
        },
        dispose() {
            for (const v of views.values()) v.model.dispose()
            views.clear()
        }
    }
}
