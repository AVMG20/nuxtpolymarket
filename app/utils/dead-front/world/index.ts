import * as THREE from 'three'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import { DF_VOX_CELL, dfMapWorld } from '#shared/utils/dead-front/map-world'
import { dfBuildCollision } from '#shared/utils/dead-front/physics'
import type { DfRenderContext, DfWorldView } from '../context'
import { dfVoxMaterial } from '../voxel/material'
import { createDfAtmosphere } from './atmosphere'
import { createDfEnvironment } from './environment'
import { createDfBarricades } from './interact/barricades'
import { createDfDecor } from './decor'
import { createDfDoors } from './interact/doors'
import { createDfMachines } from './interact/machines'
import { createDfPerkMachines } from './interact/perks'
import { createDfRods } from './interact/rods'
import { createDfTraps } from './interact/traps'
import type { DfWorldKit, DfWorldPart } from './kit'
import { buildDfLevel } from './level'
import { createDfLights } from './lights'
import { createDfProps } from './props'
import { dfPatchWorldSurface } from './surface'
import { DF_WORLD_SOUNDS } from './sound-names'
import { dfAmbienceLoop } from './sounds'
import { clamp01 } from './util'

// Map agent's client modules. Factory names and signatures are a contract with
// the engine (see app/utils/dead-front/engine/index.ts). Everything is voxels:
// the level chunks, instanced props, machines and fixtures share one material.

export { createDfZombieView } from './zombies'
export { registerDfWorldSounds } from './sounds'

/** Metres per second the power surge travels out from the switch. */
const POWER_WAVE_SPEED = 26

/** Seconds after the switch is thrown before the surge reaches (x, z). */
export function dfPowerDelay(map: DfMapDef, x: number, z: number): number {
    return Math.hypot(x - map.power.pos.x, z - map.power.pos.z) / POWER_WAVE_SPEED
}

/** Static map + live interactables (doors, boards, box, PaP, perks, power, egg, traps). */
export function createDfWorldView(ctx: DfRenderContext, map: DfMapDef): DfWorldView {
    const quality = ctx.quality
    const mat = dfVoxMaterial()
    mat.name = 'df-vox-world'
    const root = new THREE.Group()
    root.name = 'df-world'
    ctx.scene.add(root)
    const kit: DfWorldKit = {
        ctx,
        map,
        world: dfMapWorld(),
        root,
        mat,
        collision: dfBuildCollision(map, new Set()),
        quality,
        shadows: quality === 'high',
        state: { powerOn: false, power: 0, powerAge: 0, time: 0 },
        powerDelay(x, z) {
            return dfPowerDelay(map, x, z)
        },
        play(name, pos, volume = 1, rate = 1) {
            ctx.audio.play(name, { pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : undefined, volume, rate })
        }
    }

    // The level chunks get the world-space block detail; props keep the plain voxel look.
    const levelMat = dfPatchWorldSurface(dfVoxMaterial(), { cell: DF_VOX_CELL })
    levelMat.name = 'df-vox-level'
    const level = buildDfLevel(levelMat, true)
    root.add(level.group)
    const env = createDfEnvironment(kit)
    const parts: DfWorldPart[] = [env]
    const tryPart = (name: string, make: () => DfWorldPart) => {
        try {
            parts.push(make())
        } catch (e) {
            console.error(`[dead-front] world ${name} failed`, e)
        }
    }
    tryPart('lights', () => createDfLights(kit))
    tryPart('atmosphere', () => createDfAtmosphere(kit))
    tryPart('props', () => createDfProps(kit))
    tryPart('decor', () => createDfDecor(kit))
    tryPart('doors', () => createDfDoors(kit))
    tryPart('barricades', () => createDfBarricades(kit))
    tryPart('machines', () => createDfMachines(kit))
    tryPart('perks', () => createDfPerkMachines(kit))
    tryPart('rods', () => createDfRods(kit))
    tryPart('traps', () => createDfTraps(kit))
    ctx.audio.loop(DF_WORLD_SOUNDS.ambience, dfAmbienceLoop)

    return {
        update(dt, world, time) {
            const st = kit.state
            st.time = time
            if (world.power && !st.powerOn) {
                st.powerOn = true
                st.powerAge = 0
            }
            if (st.powerOn) {
                st.powerAge += dt
                st.power = clamp01(st.powerAge / 1.4)
            }
            // Lit windows and the stained glass brighten a touch with the power.
            mat.userData.uGlow.value = 1 + st.power * 0.25
            levelMat.userData.uGlow.value = mat.userData.uGlow.value
            for (const p of parts) p.update(dt, world, time)
        },
        onEvent(ev) {
            if (ev.k === 'power') env.flash(0.6)
            for (const p of parts) p.onEvent?.(ev)
        },
        dispose() {
            ctx.audio.stopLoop(DF_WORLD_SOUNDS.ambience)
            for (const p of parts) p.dispose()
            level.dispose()
            root.removeFromParent()
            mat.dispose()
            levelMat.dispose()
        }
    }
}
