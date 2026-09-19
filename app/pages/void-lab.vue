<template>
    <div ref="viewport" style="position:fixed;inset:0;background:#000" />
</template>

<script setup lang="ts">
// TEMPORARY asset lab. Never commit this file.
//   /void-lab?model=ship:leviathan | turret:gatling | drone | hostile:raider | enemy:mite | warden:3
//             | station | beacon | wreck | crate            → the model in the hangar showroom (game lighting + bloom)
//   /void-lab?ship=kestrel&tier=2                           → a real flight in that hull
// The tab is usually hidden, so rAF is frozen: drive it from the console with
//   lab.step(60)                      advance n frames
//   lab.view(orbit, pitch, zoom)      hangar camera (radians, -0.3..0.7, 0.4..2), then steps
//   lab.engine                        the VoidEngine (flight: engine.keys.add('KeyW'), engine.player, engine.asteroids …)
import * as THREE from 'three'
import { VoidEngine } from '~/utils/void/engine'
import { VoidAudio } from '~/utils/void/audio'
import { buildShip } from '~/utils/void/ships'
import { buildDrone, buildTurret } from '~/utils/void/turrets'
import { buildHostile } from '~/utils/void/hostiles'
import { buildBeacon, buildStation, buildWreck } from '~/utils/void/structures'
import { buildCrate, buildEnemy, buildWarden } from '~/utils/void/enemy-models'
import { voidDerivedStats, voidNormalizeLevels, voidSector, type VoidTurretId } from '#shared/utils/gamelogic/void'

definePageMeta({ layout: false })
const viewport = ref<HTMLElement | null>(null)
const route = useRoute()

function build(spec: string): THREE.Object3D {
    const [kind, arg = ''] = spec.split(':')
    const group = (m: unknown) => ((m as { group?: THREE.Object3D }).group ?? (m as { root?: THREE.Object3D }).root ?? m) as THREE.Object3D
    switch (kind) {
        case 'ship': return buildShip(arg).group
        case 'turret': return group(buildTurret(arg as VoidTurretId, 0x5ec8ff))
        case 'drone': return buildDrone(0x5ec8ff)
        case 'hostile': return buildHostile(arg, 0xff5a3c, 1)!.group
        case 'enemy': return buildEnemy(arg, 0xff5a3c, 1).group
        case 'warden': return group(buildWarden(Number(arg || 1), 0xff8a2b))
        case 'station': return group(buildStation(0x5ec8ff))
        case 'beacon': return group(buildBeacon(0x5ec8ff))
        case 'wreck': return group(buildWreck(Number(arg || 1)))
        case 'crate': return group(buildCrate(0xffa640))
    }
    throw new Error(`unknown model ${spec}`)
}

onMounted(() => {
    const engine = new VoidEngine(viewport.value!, new VoidAudio(), {
        hud: () => {}, toast: () => {}, banner: () => {}, end: () => {}, pause: () => {}, gate: () => {}, guide: () => {}, trade: () => {}
    } as never)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = engine as any
    const step = (n = 30) => {
        let t = performance.now()
        for (let i = 0; i < n; i++) {
            t += 16.6
            e.loop(t)
        }
    }
    const model = route.query.model ? String(route.query.model) : null
    if (model) {
        engine.hangarSpin = false
        engine.showHangar('sparrow', [], 0, Number(route.query.tier ?? 1))
        const root = e.hangarShip as THREE.Group
        root.clear()
        const built = build(model)
        root.add(built)
        const box = new THREE.Box3().setFromObject(built)
        e.hangarSize = Math.max(box.getSize(new THREE.Vector3()).length() * 0.6, 1)
        e.hangarFlames = []
        e.hangarTurrets = []
        if (route.query.bare) e.hangarScene.getObjectByName('cradle')?.removeFromParent()
    } else {
        const shipId = String(route.query.ship ?? 'sparrow')
        const levels = voidNormalizeLevels({})
        const fit = { gun: null, turrets: [], armor: [], shields: [] } as never
        engine.startRun({
            sector: voidSector(Number(route.query.tier ?? 1)), shipId, stats: voidDerivedStats(shipId, levels, fit, []), turrets: [], levels, gun: null,
            supplies: {}, skill: { id: 'seeker', nodes: [] }, guideLearned: null
        })
    }
    step(30)
    ;(window as never as Record<string, unknown>).lab = {
        engine,
        step,
        view: (orbit = 2.3, pitch = 0.18, zoom = 1) => {
            e.hangarOrbit = orbit
            e.hangarPitch = pitch
            e.hangarZoom = zoom
            step(3)
        }
    }
})
</script>
