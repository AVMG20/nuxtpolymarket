import * as THREE from 'three'
import { DF_SALVAGE } from '#shared/utils/dead-front/salvage'
import type { DfSalvageDropSnap } from '#shared/utils/dead-front/salvage'
import { DF_ARSENAL_SND, registerDfArsenalSounds } from '../engine/arsenal-sounds'
import { DfVoxModel } from '../voxel/model'
import type { DfWorldKit, DfWorldPart } from './kit'
import { dfRadialTexture, easeOutBack } from './util'

// Salvage on the ground (world.arsenal.drops): a little heap of rusty plates,
// nuts and a cog. They pop out of the body, bob and turn, glint, and blink before they
// rust away. At night they'd vanish into the mud, so each one carries a faked
// glow (no real light: a light per drop would recompile shaders and cost fill
// rate): the brass cog is faintly emissive, and one instanced mesh of additive
// quads (a single draw call for every drop) lays a warm halo on the ground and
// a soft camera-facing glow with a slow breath and a brief glint now and then. Walking over one takes it at once on this client (the pickup
// sound plays now); the server's `salvage` event settles it, and a teammate's
// pickup sparkles where it lay.

const C = 0.045
/** Drops that get a glow (the server keeps 30 on the ground, plus a few shrinking out). */
const GLOW_CAP = 48
/** Warm brass glow, linear RGB. */
const GLOW_COLOR = new THREE.Color().setRGB(1, 0.6, 0.24)
/** World size of the camera-facing glow and the ground halo (metres across). */
const GLOW_SIZE = 0.62
const HALO_SIZE = 1.25
/** The glow never shrinks below this many pixels on screen (dimmed by the area it gained). */
const GLOW_MIN_PX = 3

function scrapModel(): DfVoxModel {
    const m = new DfVoxModel(8, 4, 8)
    const rust = m.shade(0x7b4b2b, 0.14, 81)
    const iron = m.shade(0x55585e, 0.08, 82)
    // the cog catches the eye: faintly emissive brass
    const brass = m.c(0xb08a3c, 0.55)
    m.box(1, 0, 1, 7, 1, 6, rust)
    m.box(2, 1, 2, 6, 2, 7, iron)
    m.box(0, 0, 4, 3, 2, 8, iron)
    // a cog standing on its edge
    m.box(4, 1, 1, 5, 4, 4, brass)
    m.set(4, 4, 2, 0).set(4, 1, 1, 0)
    m.box(1, 1, 1, 2, 3, 2, rust)
    return m
}

interface Drop {
    id: number
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
    const drops = new Map<number, Drop>()
    /** Drops this client walked over (hidden and heard at once; the server settles them). */
    const taken = new Map<number, number>()
    const cam = new THREE.Vector3()
    let clock = 0

    // ---------------------------------------------------------------- glow
    // Instances [0, n) are the camera-facing glows, [GLOW_CAP, GLOW_CAP + n) the
    // ground halos; unused slots sit at zero scale. Built up front (with its
    // instance colour) so the shader warm-up compiles it before the first drop.
    const glowTex = dfRadialTexture(64, 0, 2.4)
    const glowGeo = new THREE.PlaneGeometry(1, 1)
    const glowMat = new THREE.MeshBasicMaterial({
        map: glowTex,
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        // the halo lies just above the floor: pull it forward so it never fights the ground
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
    })
    glowMat.name = 'df-scrap-glow'
    const glow = glowTex ? new THREE.InstancedMesh(glowGeo, glowMat, GLOW_CAP * 2) : null
    const m4 = new THREE.Matrix4()
    const zero = new THREE.Matrix4().makeScale(0, 0, 0)
    const gq = new THREE.Quaternion()
    const flatQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
    const gp = new THREE.Vector3()
    const gs = new THREE.Vector3()
    const gc = new THREE.Color()
    let glowUsed = 0
    if (glow) {
        glow.name = 'df-scrap-glow'
        glow.frustumCulled = false
        glow.castShadow = false
        glow.receiveShadow = false
        glow.renderOrder = 3
        glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GLOW_CAP * 2 * 3), 3)
        glow.instanceColor.setUsage(THREE.DynamicDrawUsage)
        for (let i = 0; i < GLOW_CAP * 2; i++) glow.setMatrixAt(i, zero)
        // always drawn (unused slots are zero-sized): the shader warm-up only compiles what is visible
        kit.root.add(glow)
    }
    const hideGlow = (i: number) => {
        glow?.setMatrixAt(i, zero)
        glow?.setMatrixAt(GLOW_CAP + i, zero)
    }
    /** Writes drop `i`'s glow and halo (k: 0..1 strength, 0 hides them). */
    const setGlow = (i: number, d: Drop, k: number, time: number, fogDensity: number, pxPerM: number) => {
        if (!glow || i >= GLOW_CAP) return
        if (k <= 0) return hideGlow(i)
        const dx = d.obj.position.x - cam.x
        const dy = d.obj.position.y - cam.y
        const dz = d.obj.position.z - cam.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        // fade a little slower than the fog itself, so scrap reads a touch further than the mud around it
        const fd = dist * fogDensity * 0.7
        const fogK = Math.exp(-fd * fd)
        const breath = 0.85 + 0.15 * Math.sin(time * 2.1 + d.id * 1.3)
        // a short glint every couple of seconds, out of step between drops
        const gl = Math.max(0, Math.sin(time * 2.3 + d.id * 2.17))
        const gl4 = gl * gl * gl * gl
        const glint = gl4 * gl4 * gl4
        // a minimum size on screen, dimmed by the area it gained
        let size = GLOW_SIZE * (1 + glint * 0.35)
        let dim = 1
        const px = dist > 0.01 ? size * pxPerM / dist : GLOW_MIN_PX
        if (px < GLOW_MIN_PX) {
            const grow = GLOW_MIN_PX / Math.max(0.01, px)
            size *= grow
            dim = 1 / (grow * grow)
        }
        // the glow sits just in front of the heap (toward the camera), so neither it nor the floor cuts it
        const inv = dist > 0.01 ? 0.22 / dist : 0
        gp.set(d.obj.position.x - dx * inv, d.obj.position.y + 0.12 - dy * inv, d.obj.position.z - dz * inv)
        const s = size * Math.max(0.01, d.obj.scale.x)
        glow.setMatrixAt(i, m4.compose(gp, gq, gs.set(s, s, 1)))
        // both soften up close, where they would only wash over the heap and the floor
        const near = Math.min(1, Math.max(0, (dist - 1.2) / 2.5))
        glow.setColorAt(i, gc.copy(GLOW_COLOR).multiplyScalar(k * fogK * dim * (0.45 + 0.55 * near) * (0.34 * breath + glint * 0.55)))
        const hs = HALO_SIZE * Math.max(0.01, d.obj.scale.x) * (0.95 + 0.05 * breath)
        gp.set(d.pos.x, d.pos.y + 0.03, d.pos.z)
        glow.setMatrixAt(GLOW_CAP + i, m4.compose(gp, flatQ, gs.set(hs, hs, 1)))
        glow.setColorAt(GLOW_CAP + i, gc.copy(GLOW_COLOR).multiplyScalar(k * fogK * near * 0.2 * breath))
    }

    const make = (d: DfSalvageDropSnap): Drop => {
        const obj = new THREE.Mesh(scrapGeo, kit.mat)
        obj.castShadow = false
        obj.receiveShadow = kit.shadows
        obj.position.set(d.pos.x, d.pos.y, d.pos.z)
        obj.scale.setScalar(0.01)
        kit.root.add(obj)
        return { id: d.id, obj, pos: new THREE.Vector3(d.pos.x, d.pos.y, d.pos.z), age: 0, leaving: 0, seen: true, spin: Math.random() * Math.PI * 2 }
    }

    const sparkle = (pos: THREE.Vector3) => ctx.fx.burst('powerup', pos, { count: 6, color: 0xd9a75a, scale: 0.35 })

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
            ctx.camera.getWorldQuaternion(gq)
            const fog = ctx.scene.fog as THREE.FogExp2 | null
            const fogDensity = fog && 'density' in fog ? fog.density : 0
            const pxPerM = ctx.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2))
            let gi = 0
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
                        kit.play(DF_ARSENAL_SND.scrap, undefined, 0.9)
                        sparkle(d.pos)
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
                    } else {
                        setGlow(gi++, d, k, time, fogDensity, pxPerM)
                    }
                    continue
                }
                // pop out, then bob and turn
                const pop = Math.min(1, d.age / 0.45)
                const s = easeOutBack(pop)
                d.obj.scale.setScalar(Math.max(0.01, s))
                const arc = pop < 1 ? Math.sin(pop * Math.PI) * 0.45 : 0
                d.obj.position.set(d.pos.x, d.pos.y + 0.08 + arc + Math.sin(time * 2.6 + d.id) * 0.05, d.pos.z)
                d.spin += dt * 1.1
                d.obj.rotation.y = d.spin
                setGlow(gi++, d, d.obj.visible ? 1 : 0, time, fogDensity, pxPerM)
            }
            if (glow) {
                const used = Math.min(GLOW_CAP, gi)
                for (let i = used; i < glowUsed; i++) hideGlow(i)
                glowUsed = used
                glow.instanceMatrix.needsUpdate = true
                glow.instanceColor!.needsUpdate = true
            }
            for (const [id, at] of taken) if (clock - at > 5) taken.delete(id)
        },
        onEvent(ev) {
            if (ev.k !== 'salvage') return
            // ours was already heard when we walked over it
            if (taken.has(ev.id)) return
            const pos = new THREE.Vector3(ev.pos.x, ev.pos.y + 0.2, ev.pos.z)
            kit.play(DF_ARSENAL_SND.scrap, pos, 0.7)
            sparkle(pos)
            const d = drops.get(ev.id)
            if (d && d.leaving === 0) d.leaving = 0.001
        },
        dispose() {
            for (const d of drops.values()) d.obj.removeFromParent()
            drops.clear()
            scrapGeo.dispose()
            glow?.removeFromParent()
            glow?.dispose()
            glowGeo.dispose()
            glowMat.dispose()
            glowTex?.dispose()
        }
    }
}
