import * as THREE from 'three'
import { DF_MACHINE_TIMES } from '#shared/utils/dead-front/constants'
import { dfRaycast } from '#shared/utils/dead-front/physics'
import { dfBoxPool } from '#shared/utils/dead-front/weapons'
import type { DfWeaponId } from '#shared/utils/dead-front/types'
import { dfVoxMaterial } from '../../voxel/material'
import { DfVoxModel } from '../../voxel/model'
import type { DfWorldKit, DfWorldPart } from '../kit'
import { DF_WORLD_SOUNDS } from '../sound-names'
import { DfSpring, clamp01, damp, dfShowModel, easeOutBack, easeOutCubic } from '../util'
import type { DfWeaponCache } from './weapon-cache'
import { dfRarity } from '#shared/utils/dead-front/rarity'
import { dfBuildKitModel } from '../kits'

// The mystery box: a brass-bound crate on a trestle under a column of golden
// light that stands over the rooftops, so the squad can find it from across
// the map. Motes drift up the beam. Opening it throws the lid back on a
// spring, spills light out of the crate, and spins weapons up out of it,
// each swap popping in; the one you get lands with a flash and a sparkle.

const BEAM_VERT = /* glsl */`
    uniform float uGrow;
    varying vec2 vUv;
    varying float vY;
    varying float vDist;
    varying float vGrow;
    void main() {
        vUv = uv;
        vY = position.y + 0.5;
        // Widen with distance so the beam still reads from across the map.
        vec3 axis = (modelMatrix * vec4(0.0, position.y, 0.0, 1.0)).xyz;
        float grow = 1.0 + max(0.0, distance(axis, cameraPosition) - 8.0) * uGrow;
        vGrow = grow;
        vec4 wp = modelMatrix * vec4(position.x * grow, position.y, position.z * grow, 1.0);
        vDist = distance(wp.xyz, cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * wp;
    }
`
const BEAM_FRAG = /* glsl */`
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uTime;
    uniform float uFalloff;
    varying vec2 vUv;
    varying float vY;
    varying float vDist;
    varying float vGrow;
    void main() {
        float y = clamp(vY, 0.0, 1.0);
        // Soft square column: each face fades toward its edges.
        float e = 1.0 - abs(clamp(vUv.x, 0.0, 1.0) * 2.0 - 1.0);
        float edge = e * e;
        float fall = 1.0 - y;
        float vert = mix(fall * fall, fall, uFalloff);
        // Slow bands rising up the beam.
        float bands = 0.82 + 0.18 * sin(vY * 60.0 - uTime * 2.6);
        // Never fog the camera when you stand right in it.
        float near = smoothstep(0.6, 3.5, vDist);
        // Stays bright at range (it is the landmark), a little calmer up close.
        float range = (0.6 + 0.4 / max(vGrow, 1.0)) * (1.0 + smoothstep(15.0, 60.0, vDist) * 0.9);
        float a = edge * vert * bands * near * uOpacity * range;
        gl_FragColor = vec4(uColor * a, a);
    }
`

const C = 0.0625
const BRASS = 0xa58236
const MOTES = 28

export function createDfMysteryBox(kit: DfWorldKit, weapons: DfWeaponCache): DfWorldPart {
    const { map, ctx } = kit
    const geos: THREE.BufferGeometry[] = []
    const mats: THREE.Material[] = []
    const shadow = kit.shadows
    // Its own material so the crate can glow gold as it leaves and lands.
    const boxMat = dfVoxMaterial()
    mats.push(boxMat)
    const mesh = (m: DfVoxModel, pivot: [number, number, number], parent: THREE.Object3D): THREE.Mesh => {
        const geo = m.mesh(C, pivot) ?? new THREE.BufferGeometry()
        geos.push(geo)
        const me = new THREE.Mesh(geo, boxMat)
        me.castShadow = shadow
        me.receiveShadow = shadow
        parent.add(me)
        return me
    }

    const g = new THREE.Group()
    g.name = 'df-mystery-box'
    kit.root.add(g)
    const body = new THREE.Group()
    g.add(body)
    // Trestle stand (the 0.55 m 'boxstand' proxy), box on top. Local +z is the front.
    const stand = new DfVoxModel(27, 9, 13)
    const sw = stand.shade(0x5e4329, 0.07, 3)
    stand.box(0, 7, 0, 27, 9, 13, sw)
    for (const x of [1, 24]) for (const z of [1, 10]) stand.box(x, 0, z, x + 2, 7, z + 2, sw)
    stand.box(2, 3, 2, 25, 4, 3, sw).box(2, 3, 10, 25, 4, 11, sw)
    mesh(stand, [13.5, 0, 6.5], body)
    const box = new DfVoxModel(24, 8, 10)
    const wood = box.shade(0x7a5532, 0.06, 4)
    const brass = box.c(BRASS)
    box.box(0, 0, 0, 24, 8, 10, wood)
    box.vox.map((_v, i, j, k) => ((i === 0 || i === 23 ? 1 : 0) + (k === 0 || k === 9 ? 1 : 0) >= 2 || ((i === 0 || i === 23) && (j === 0 || j === 7)) ? brass : -1))
    // Painted eye sigil on the front and the back, faintly luminous.
    const paint = box.c(0xe2d6ae, 0.35)
    const pupil = box.c(0x111111)
    for (const k of [0, 9]) {
        box.box(8, 3, k, 16, 5, k + 1, paint).box(10, 2, k, 14, 6, k + 1, paint).box(11, 3, k, 13, 5, k + 1, pupil)
    }
    box.box(10, 0, 0, 14, 8, 10, (i, j, k) => (j === 7 ? box.c(0x5c3f25) : wood(i, j, k)))
    box.box(1, 7, 1, 23, 8, 9, 0)
    box.box(1, 6, 1, 23, 7, 9, box.c(0xffd890, 1))
    const top = 0.55
    const boxMesh = mesh(box, [12, 0, 5], body)
    boxMesh.position.y = top
    const lidM = new DfVoxModel(24, 2, 10)
    lidM.box(0, 0, 0, 24, 2, 10, lidM.shade(0x7f5934, 0.06, 6))
    lidM.box(0, 0, 0, 24, 2, 1, lidM.c(BRASS)).box(0, 0, 9, 24, 2, 10, lidM.c(BRASS)).box(8, 1, 3, 16, 2, 7, lidM.c(BRASS))
    // Glowing glyph on the lid's top.
    lidM.box(10, 1, 4, 14, 2, 6, lidM.c(0xffd890, 0.8))
    const lid = new THREE.Group()
    lid.position.set(0, top + 0.5, -0.3125)
    body.add(lid)
    mesh(lidM, [12, 0, 0], lid)
    const holder = new THREE.Group()
    body.add(holder)

    // ---------------------------------------------------------------- the beam
    // Camera-facing planes (turned about the vertical each frame), so the column
    // reads as one soft shaft from every side.
    const beamGeo = new THREE.PlaneGeometry(1, 1, 1, 1)
    geos.push(beamGeo)
    const beamMat = (opacity: number, falloff: number, grow: number) => {
        const m = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color().setRGB(1.0, 0.78, 0.42) },
                uOpacity: { value: opacity },
                uTime: { value: 0 },
                uFalloff: { value: falloff },
                uGrow: { value: grow }
            },
            vertexShader: BEAM_VERT,
            fragmentShader: BEAM_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        })
        mats.push(m)
        return m
    }
    const coreMat = beamMat(0.9, 1, 0.035)
    const haloMat = beamMat(0.3, 0.6, 0.03)
    const spillMat = beamMat(0, 0, 0)
    const beam = new THREE.Group()
    beam.name = 'df-box-beam'
    kit.root.add(beam)
    const core = new THREE.Mesh(beamGeo, coreMat)
    const halo = new THREE.Mesh(beamGeo, haloMat)
    for (const b of [core, halo]) {
        b.renderOrder = 3
        b.frustumCulled = false
        beam.add(b)
    }
    // A short wide shaft of light spilling out of the open crate.
    const spill = new THREE.Mesh(beamGeo, spillMat)
    spill.renderOrder = 3
    spill.scale.set(1.5, 1.4, 1)
    spill.position.set(0, top + 0.5 + 0.7, 0)
    beam.add(spill)

    // Motes drifting up the beam (additive cubes; dark when spent).
    const moteM = new DfVoxModel(1, 1, 1)
    moteM.box(0, 0, 0, 1, 1, 1, moteM.c(0xffffff))
    const moteGeo = moteM.mesh(1, [0.5, 0.5, 0.5])!
    geos.push(moteGeo)
    const moteMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    mats.push(moteMat)
    const motes = new THREE.InstancedMesh(moteGeo, moteMat, MOTES)
    motes.frustumCulled = false
    motes.renderOrder = 4
    motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    kit.root.add(motes)
    const moteSeed = Array.from({ length: MOTES }, () => Math.random())
    const moteCol = new THREE.Color()

    const heights = map.boxSpots.map((s) => {
        const hit = dfRaycast(kit.collision, { x: s.pos.x, y: s.pos.y + 1.2, z: s.pos.z }, { x: 0, y: 1, z: 0 }, 60)
        return hit ? hit.dist + 1.1 : 46
    })
    const pool = dfBoxPool()
    const lidSpring = new DfSpring(70, 7)
    let spot = -1
    let shownState = ''
    let cycle = 0
    let cycleIdx = 0
    let rollT = 0
    let moveT = -1
    let landT = -1
    let shownId: DfWeaponId | null = null
    let popT = 1
    let reveal = 0
    let revealed = false
    let beamK = 1
    let strike = 0
    let glow = 0
    let landed = true
    let height = 30
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const v3 = new THREE.Vector3()
    const s3 = new THREE.Vector3()
    const camPos = new THREE.Vector3()
    const place = (i: number) => {
        const s = map.boxSpots[i]!
        g.position.set(s.pos.x, s.pos.y, s.pos.z)
        g.rotation.y = s.yaw
        height = heights[i]!
        beam.position.set(s.pos.x, s.pos.y + top + 0.45, s.pos.z)
        core.scale.set(0.55, height, 1)
        core.position.y = height / 2
        halo.scale.set(2.2, height * 0.8, 1)
        halo.position.y = height * 0.4
        spill.position.y = 0.7
    }
    // an upgrade kit on offer (rarity.ts) instead of a weapon, and the offer's rarity glow
    let kitModel: ReturnType<typeof dfBuildKitModel> | null = null
    let kitTier = 0
    let glintIn = 0
    const showKit = (tier: number) => {
        if (tier !== kitTier) {
            kitModel?.dispose()
            kitModel = null
            kitTier = tier
            if (tier > 0) {
                kitModel = dfBuildKitModel(tier, kit.mat)
                kitModel.obj.scale.setScalar(1.6)
                holder.add(kitModel.obj)
                popT = 0
            }
        }
    }
    const show = (id: DfWeaponId | null) => {
        if (id !== shownId) {
            shownId = id
            if (id) popT = 0
        }
        dfShowModel(holder, id ? weapons.get(id) : null)
    }

    return {
        update(dt, world, time) {
            const b = world.box
            if (b.spot !== spot && b.state !== 'moving') {
                const firstPlace = spot < 0
                spot = b.spot
                place(spot)
                if (!firstPlace) {
                    // Arrives: the beam strikes down first, then the crate drops into it.
                    landT = 0
                    landed = false
                    strike = 1
                    beamK = 0
                    v3.set(g.position.x, g.position.y + 2, g.position.z)
                    ctx.fx.flash(v3, 0xffd27a, 6, 0.5)
                }
            }
            if (b.state !== shownState) {
                if (b.state === 'rolling') {
                    rollT = 0
                    cycle = 0
                    revealed = false
                    lidSpring.kick(14)
                }
                if (b.state === 'moving') moveT = 0
                shownState = b.state
            }
            const open = b.state === 'rolling' || b.state === 'ready'
            lid.rotation.x = -Math.max(-0.05, lidSpring.update(dt, open ? 1.9 : 0))
            popT += dt
            reveal = Math.max(0, reveal - dt * 2.5)
            if (b.state === 'rolling') {
                rollT += dt
                cycle -= dt
                const prog = clamp01(rollT / DF_MACHINE_TIMES.boxRoll)
                if (cycle <= 0 && pool.length) {
                    cycleIdx = (cycleIdx + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length
                    cycle = 0.06 + prog * prog * 0.35
                }
                const final = b.timer < 0.35 && b.weapon
                show(final ? b.weapon! : pool[cycleIdx] ?? null)
                if (final && !revealed) {
                    revealed = true
                    reveal = 1
                    v3.set(0, top + 1.05, 0)
                    g.localToWorld(v3)
                    ctx.fx.flash(v3, 0xffd27a, 4, 0.35)
                    ctx.fx.burst('powerup', v3, { scale: 1.4, count: 18 })
                }
                holder.position.set(0, top + 0.3 + easeOutCubic(prog) * 0.75, 0)
                // Spins fast while it shuffles, slowing into the reveal.
                holder.rotation.set(0, Math.PI / 2 + (final ? Math.sin(time * 0.8) * 0.15 : rollT * (10 - prog * 8)), 0)
            } else if (b.state === 'ready' && b.kit) {
                show(null)
                showKit(b.kit)
                const sink = 1 - clamp01(b.timer / DF_MACHINE_TIMES.boxOffer)
                holder.position.set(0, top + 1.0 - sink * 0.7 + Math.sin(time * 2) * 0.03, 0)
                holder.rotation.set(0, time * 1.2, 0)
            } else if (b.state === 'ready' && b.weapon) {
                show(b.weapon)
                const sink = 1 - clamp01(b.timer / DF_MACHINE_TIMES.boxOffer)
                holder.position.set(0, top + 1.05 - sink * 0.7 + Math.sin(time * 2) * 0.03, 0)
                holder.rotation.set(Math.sin(time * 1.3) * 0.05, Math.PI / 2 + Math.sin(time * 0.8) * 0.2, 0)
            } else {
                holder.position.y = damp(holder.position.y, top, 10, dt)
                if (holder.position.y < top + 0.1) show(null)
            }
            if (!(b.state === 'ready' && b.kit)) showKit(0)
            if (kitModel) kitModel.material.userData.uGlow.value = 1.4 + 0.6 * Math.sin(time * 4)
            // a rare (or better) offer glints in its colour
            const tier = b.state === 'ready' ? (b.kit ?? b.rarity ?? 0) : 0
            if (tier > 0) {
                glintIn -= dt
                if (glintIn <= 0) {
                    glintIn = 0.18
                    v3.set(0, 0, 0)
                    holder.localToWorld(v3)
                    const c = dfRarity(tier).color
                    ctx.fx.burst('powerup', v3, { count: 2 + tier, color: c, scale: 0.5 + tier * 0.15 })
                    ctx.fx.flash(v3, c, 1.5 + tier, 0.2)
                }
            }
            // Each swap pops in with a little overshoot; the reveal swells once.
            holder.scale.setScalar((0.55 + 0.45 * easeOutBack(clamp01(popT / 0.14), 2.2)) * (1 + 0.3 * Math.sin(reveal * Math.PI)))
            strike = Math.max(0, strike - dt * 1.2)
            if (b.state === 'moving' && moveT >= 0) {
                // Leaves: it rattles, lifts off glowing and spinning, then bursts into bits of crate.
                const prev = moveT
                moveT += dt
                const rattle = clamp01(moveT / 1.1)
                const shake = moveT < 1.3 ? Math.sin(moveT * 46) * 0.05 * rattle : 0
                const lift = clamp01((moveT - 1.1) / 1.5)
                body.position.set(shake, lift * lift * lift * 5.5 + (moveT < 1.1 ? Math.abs(Math.sin(moveT * 23)) * 0.03 * rattle : 0), 0)
                body.rotation.set(shake * 1.5, lift * lift * 9, shake * 2)
                lid.rotation.x = -Math.abs(Math.sin(moveT * 31)) * 0.25 * rattle * (1 - lift)
                glow = 0.25 * rattle + lift * 1.4
                beamK = damp(beamK, moveT < 1.4 ? 1 : 0, 5, dt)
                const pop = 2.6
                body.visible = moveT < pop
                if (prev < pop && moveT >= pop) {
                    v3.set(0, 0.8, 0)
                    body.localToWorld(v3)
                    ctx.fx.flash(v3, 0xffd27a, 7, 0.6)
                    ctx.fx.burst('splinters', v3, { count: 46, scale: 1.8 })
                    ctx.fx.burst('powerup', v3, { count: 40, scale: 3 })
                    ctx.fx.burst('sparks', v3, { count: 24, color: 0xffd27a })
                    ctx.fx.burst('smoke', v3, { scale: 1.4, count: 6 })
                    ctx.fx.shake(0.04)
                }
                if (prev < 1.1 && moveT >= 1.1) ctx.fx.burst('dust', g.position, { count: 18, scale: 1.4 })
            } else {
                body.visible = true
                body.rotation.set(0, 0, 0)
                beamK = damp(beamK, 1, landT >= 0 ? 6 : 1.5, dt)
                if (landT >= 0) {
                    landT += dt
                    // Hangs in the struck beam a beat, then drops with a slam and a bounce.
                    const t = clamp01((landT - 0.35) / 0.4)
                    const bounce = landed ? Math.abs(Math.sin((landT - 0.75) * 9)) * 0.12 * Math.exp(-(landT - 0.75) * 6) : 0
                    body.position.set(0, (1 - t * t) * 4 + bounce, 0)
                    body.scale.setScalar(landT < 0.35 ? Math.max(0.001, easeOutBack(landT / 0.35)) : 1)
                    glow = Math.max(0, 1.4 - landT * 1.1)
                    if (!landed && t >= 1) {
                        landed = true
                        kit.play(DF_WORLD_SOUNDS.boxLand, g.position, 1)
                        ctx.fx.burst('dust', g.position, { count: 26, scale: 1.8 })
                        ctx.fx.burst('powerup', v3.set(g.position.x, g.position.y + 0.8, g.position.z), { count: 20, scale: 1.6 })
                        ctx.fx.shake(0.06)
                    }
                    if (landT > 1.6) landT = -1
                } else {
                    body.position.set(0, 0, 0)
                    body.scale.setScalar(1)
                    glow = damp(glow, 0, 4, dt)
                }
            }
            boxMat.emissive.setRGB(glow * 0.9, glow * 0.62, glow * 0.25)
            boxMat.userData.uGlow.value = 1 + glow * 1.5
            const lidOpen = clamp01(-lid.rotation.x / 1.9)
            const flick = 0.92 + Math.sin(time * 1.7) * 0.05 + Math.sin(time * 13.1) * 0.03
            coreMat.uniforms.uOpacity!.value = (0.75 + lidOpen * 0.5 + strike * 1.6) * flick * beamK
            haloMat.uniforms.uOpacity!.value = (0.22 + lidOpen * 0.12) * flick * beamK
            spillMat.uniforms.uOpacity!.value = lidOpen * 0.4 * flick
            spill.visible = lidOpen > 0.01
            for (const m of [coreMat, haloMat, spillMat]) m.uniforms.uTime!.value = time
            beam.visible = beamK > 0.01

            // Motes: rise, sway, fade; a minimum on-screen size at range.
            ctx.camera.getWorldPosition(camPos)
            const base = beam.position
            beam.rotation.y = Math.atan2(camPos.x - base.x, camPos.z - base.z)
            for (let i = 0; i < MOTES; i++) {
                const sd = moteSeed[i]!
                const u = (time * (0.05 + sd * 0.04) + sd) % 1
                const h = u * Math.min(height, 24)
                const r = 0.15 + sd * 0.35
                const a = sd * 40 + time * (0.4 + sd * 0.5)
                v3.set(base.x + Math.cos(a) * r, base.y + h, base.z + Math.sin(a) * r)
                const d = v3.distanceTo(camPos)
                const sz = Math.max(0.035 + sd * 0.03, d * 0.0024)
                q.setFromAxisAngle(s3.set(0.3, 1, 0.2).normalize(), a)
                motes.setMatrixAt(i, m4.compose(v3, q, s3.setScalar(sz)))
                const fade = Math.min(1, u * 6) * (1 - u) * beamK * (0.035 + sd * 0.03) / sz
                motes.setColorAt(i, moteCol.setRGB(1.6 * fade, 1.15 * fade, 0.55 * fade))
            }
            motes.instanceMatrix.needsUpdate = true
            if (motes.instanceColor) motes.instanceColor.needsUpdate = true
        },
        onEvent(ev) {
            if (ev.k !== 'box') return
            if (ev.what === 'open') {
                kit.play(DF_WORLD_SOUNDS.boxOpen, g.position, 1)
                kit.play(DF_WORLD_SOUNDS.boxJingle, g.position, 0.9)
                kit.play(DF_WORLD_SOUNDS.boxRoll, g.position, 0.7)
                v3.set(0, top + 0.6, 0)
                g.localToWorld(v3)
                ctx.fx.flash(v3, 0xffc865, 3, 0.5)
            } else if (ev.what === 'take') {
                kit.play(DF_WORLD_SOUNDS.boxClose, g.position, 0.9)
            } else if (ev.what === 'move') {
                kit.play(DF_WORLD_SOUNDS.boxMove, g.position, 1)
            }
        },
        dispose() {
            kitModel?.dispose()
            g.removeFromParent()
            beam.removeFromParent()
            motes.removeFromParent()
            motes.dispose()
            for (const geo of geos) geo.dispose()
            for (const m of mats) m.dispose()
        }
    }
}
