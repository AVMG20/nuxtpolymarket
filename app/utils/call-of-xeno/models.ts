// Call of Xeno — low-poly mesh builders.
//
// Boxes, cylinders and a couple of canvas-textured planes. The point is
// silhouette: each enemy type should be identifiable at a glance and each
// weapon should read as itself from across the room, with no imported assets.

import * as THREE from 'three'
import { makeSignTexture } from './textures'
import type {
    CallOfXenoEnemy,
    CallOfXenoPerk,
    CallOfXenoPowerUp,
    CallOfXenoWeapon,
    CallOfXenoWeaponId
} from '#shared/utils/gamelogic/call-of-xeno'

function part(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }))
    mesh.position.set(x, y, z)
    return mesh
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

export interface EnemyModel {
    group: THREE.Group
    head?: THREE.Object3D
    armL?: THREE.Object3D
    armR?: THREE.Object3D
    legL?: THREE.Object3D
    legR?: THREE.Object3D
    /** Drone rotor ring, spun every frame. */
    rotor?: THREE.Object3D
    /** Brute back plate — the glowing weak point. */
    weakPoint?: THREE.Mesh
    skin: THREE.MeshLambertMaterial
    clothes: THREE.MeshLambertMaterial
    glow: THREE.MeshBasicMaterial
    baseSkin: number
    baseCloth: number
    /** Height of the centre of mass, used to place damage numbers. */
    torsoY: number
}

function shadowDisc(radius: number) {
    const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 12),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false })
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.02
    return shadow
}

/** Humanoid shambler chassis, reused at different proportions by three types. */
function buildWalker(def: CallOfXenoEnemy, tint: number): EnemyModel {
    const skin = new THREE.MeshLambertMaterial({ color: tint })
    const clothes = new THREE.MeshLambertMaterial({ color: 0x343a44 })
    const glow = new THREE.MeshBasicMaterial({ color: 0xffdd55 })

    const group = new THREE.Group()
    const bulk = def.id === 'brute' ? 1.35 : def.id === 'husk' ? 0.85 : 1

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62 * bulk, 0.78, 0.34 * bulk), clothes)
    torso.position.y = 1.16
    group.add(torso)

    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.56 * bulk, 0.22, 0.32 * bulk), clothes)
    hips.position.y = 0.74
    group.add(hips)

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin)
    head.position.y = 1.72
    group.add(head)

    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.1), skin)
    jaw.position.set(0, 1.6, -0.16)
    group.add(jaw)

    for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.03), glow)
        eye.position.set(0.09 * side, 1.76, -0.17)
        group.add(eye)
    }

    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), skin)
    neck.position.y = 1.52
    group.add(neck)

    const makeArm = (side: number) => {
        const pivot = new THREE.Group()
        pivot.position.set(0.4 * bulk * side, 1.44, 0)
        const upper = new THREE.Mesh(new THREE.BoxGeometry(0.17 * bulk, 0.5, 0.17 * bulk), clothes)
        upper.position.y = -0.25
        const fore = new THREE.Mesh(new THREE.BoxGeometry(0.15 * bulk, 0.44, 0.15 * bulk), skin)
        fore.position.set(0, -0.5, -0.22)
        fore.rotation.x = -1.15
        pivot.add(upper, fore)
        pivot.rotation.x = -0.55
        group.add(pivot)
        return pivot
    }

    const makeLeg = (side: number) => {
        const pivot = new THREE.Group()
        pivot.position.set(0.16 * bulk * side, 0.72, 0)
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2 * bulk, 0.68, 0.2 * bulk), clothes)
        leg.position.y = -0.34
        const boot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.3), new THREE.MeshLambertMaterial({ color: 0x22262c }))
        boot.position.set(0, -0.72, -0.04)
        pivot.add(leg, boot)
        group.add(pivot)
        return pivot
    }

    const model: EnemyModel = {
        group,
        head,
        armL: makeArm(-1),
        armR: makeArm(1),
        legL: makeLeg(-1),
        legR: makeLeg(1),
        skin,
        clothes,
        glow,
        baseSkin: tint,
        baseCloth: 0x343a44,
        torsoY: 1.2
    }

    if (def.weakPoint) {
        // A glowing plate on the back: the shot that actually hurts a Brute.
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 0.1), new THREE.MeshBasicMaterial({ color: 0xffe066 }))
        plate.position.set(0, 1.24, 0.2 * bulk)
        group.add(plate)
        model.weakPoint = plate

        for (const side of [-1, 1]) {
            const horn = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), skin)
            horn.position.set(0.16 * side, 1.94, 0)
            horn.rotation.z = 0.4 * side
            group.add(horn)
        }
    }

    group.add(shadowDisc(0.42))
    return model
}

/** Hovering ranged drone: no legs, a spinning rotor ring and a lit core. */
function buildDrone(def: CallOfXenoEnemy): EnemyModel {
    const skin = new THREE.MeshLambertMaterial({ color: def.color })
    const clothes = new THREE.MeshLambertMaterial({ color: 0x1e3239 })
    const glow = new THREE.MeshBasicMaterial({ color: 0x7ff5ff })

    const group = new THREE.Group()

    const shell = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), skin)
    shell.position.y = 1.3
    group.add(shell)

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), glow)
    core.position.set(0, 1.3, -0.3)
    group.add(core)

    const rotor = new THREE.Group()
    rotor.position.y = 1.3
    for (let i = 0; i < 3; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.14), clothes)
        fin.rotation.y = (i / 3) * Math.PI * 2
        rotor.add(fin)
    }
    group.add(rotor)

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.44, 6), clothes)
    tail.position.set(0, 1.02, 0.1)
    tail.rotation.x = Math.PI
    group.add(tail)

    group.add(shadowDisc(0.34))

    return {
        group,
        rotor,
        skin,
        clothes,
        glow,
        baseSkin: def.color,
        baseCloth: 0x1e3239,
        torsoY: 1.3
    }
}

export function buildEnemy(def: CallOfXenoEnemy): EnemyModel {
    const model = def.flies ? buildDrone(def) : buildWalker(def, def.color)
    model.group.scale.setScalar(def.scale)
    model.torsoY *= def.scale
    return model
}

/** Tints every body part at once — the white-hot hit flash. */
export function flashEnemy(model: EnemyModel, on: boolean) {
    model.skin.color.setHex(on ? 0xff6655 : model.baseSkin)
    model.clothes.color.setHex(on ? 0xcc4433 : model.baseCloth)
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

const GUN_DARK = 0x24272e
const GUN_METAL = 0x585f6b
const GUN_WOOD = 0x6b4a2c

/** Accent colour climbs the Pack-a-Punch ladder so a tier reads at a glance. */
export function papAccent(tier: number) {
    if (tier >= 3) return 0xff5ea8
    if (tier === 2) return 0x00e5ff
    if (tier === 1) return 0x9a3fd0
    return GUN_METAL
}

/**
 * First-person weapon model, built pointing down -Z with the grip near the
 * origin so it can be parented straight to the camera.
 */
export function buildWeaponModel(id: CallOfXenoWeaponId, tier: number): THREE.Group {
    const group = new THREE.Group()
    const accent = papAccent(tier)

    switch (id) {
        case 'm1911':
            group.add(part(0.07, 0.1, 0.26, GUN_DARK, 0, 0.02, -0.1))
            group.add(part(0.05, 0.06, 0.3, accent, 0, 0.06, -0.16))
            group.add(part(0.06, 0.14, 0.07, 0x2f3238, 0, -0.08, 0.02))
            group.add(part(0.02, 0.03, 0.03, accent, 0, 0.1, -0.3))
            break
        case 'trench':
            group.add(part(0.08, 0.09, 0.62, GUN_WOOD, 0, 0, -0.2))
            group.add(part(0.05, 0.05, 0.66, accent, 0, 0.05, -0.24))
            group.add(part(0.06, 0.05, 0.2, 0x3a2a1a, 0, -0.02, -0.42))
            group.add(part(0.07, 0.12, 0.2, GUN_WOOD, 0, -0.05, 0.14))
            group.add(part(0.06, 0.13, 0.07, 0x2f3238, 0, -0.09, 0))
            break
        case 'mp40':
            group.add(part(0.06, 0.08, 0.44, GUN_DARK, 0, 0.01, -0.16))
            group.add(part(0.04, 0.04, 0.5, accent, 0, 0.05, -0.22))
            group.add(part(0.05, 0.26, 0.06, 0x2b2f36, 0, -0.16, -0.06))
            group.add(part(0.06, 0.12, 0.07, 0x2f3238, 0, -0.07, 0.06))
            group.add(part(0.03, 0.03, 0.24, 0x3a3f47, 0, -0.02, 0.22))
            break
        case 'ak74':
            group.add(part(0.07, 0.09, 0.5, GUN_DARK, 0, 0.01, -0.18))
            group.add(part(0.04, 0.04, 0.62, accent, 0, 0.05, -0.3))
            group.add(part(0.06, 0.2, 0.11, 0x4a3520, 0, -0.13, -0.08))
            group.add(part(0.07, 0.11, 0.22, GUN_WOOD, 0, -0.02, 0.16))
            group.add(part(0.06, 0.12, 0.07, 0x2f3238, 0, -0.07, 0.02))
            group.add(part(0.05, 0.05, 0.14, GUN_WOOD, 0, 0, -0.46))
            break
        case 'rpk':
            group.add(part(0.08, 0.1, 0.6, GUN_DARK, 0, 0.01, -0.22))
            group.add(part(0.05, 0.05, 0.8, accent, 0, 0.06, -0.42))
            group.add(part(0.12, 0.22, 0.14, 0x3a3f47, 0, -0.14, -0.1))
            group.add(part(0.08, 0.12, 0.26, GUN_WOOD, 0, -0.02, 0.18))
            group.add(part(0.06, 0.13, 0.07, 0x2f3238, 0, -0.08, 0.04))
            group.add(part(0.03, 0.16, 0.03, 0x2b2f36, 0, -0.12, -0.62))
            break
        case 'xenoray': {
            group.add(part(0.11, 0.13, 0.46, 0x2a3a3a, 0, 0.01, -0.18))
            const coilColor = tier > 0 ? accent : 0x44ffcc
            const coil = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8),
                new THREE.MeshBasicMaterial({ color: coilColor })
            )
            coil.rotation.x = Math.PI / 2
            coil.position.set(0, 0.06, -0.34)
            group.add(coil)
            const emitter = new THREE.Mesh(
                new THREE.ConeGeometry(0.09, 0.18, 8),
                new THREE.MeshBasicMaterial({ color: coilColor })
            )
            emitter.rotation.x = -Math.PI / 2
            emitter.position.set(0, 0.04, -0.52)
            group.add(emitter)
            group.add(part(0.07, 0.14, 0.08, 0x2f3238, 0, -0.09, 0.02))
            group.add(part(0.09, 0.09, 0.2, 0x1e2a2a, 0, -0.02, 0.16))
            break
        }
    }

    return group
}

// ---------------------------------------------------------------------------
// Level dressing
// ---------------------------------------------------------------------------

export function buildCrate(width: number, height: number, depth: number, tint: number): THREE.Group {
    const group = new THREE.Group()
    group.add(part(width, height, depth, tint, 0, height / 2, 0))
    const band = new THREE.Mesh(
        new THREE.BoxGeometry(width * 1.02, height * 0.12, depth * 1.02),
        new THREE.MeshLambertMaterial({ color: 0x2b2f36 })
    )
    band.position.y = height * 0.16
    group.add(band)
    const band2 = band.clone()
    band2.position.y = height * 0.84
    group.add(band2)
    return group
}

export function buildCeilingLight(color: number, height: number): THREE.Group {
    const group = new THREE.Group()
    group.add(part(2.6, 0.14, 0.5, 0x1a1d23, 0, height - 0.07, 0))
    const tube = new THREE.Mesh(
        new THREE.BoxGeometry(2.3, 0.06, 0.32),
        new THREE.MeshBasicMaterial({ color, transparent: true })
    )
    tube.position.y = height - 0.16
    group.add(tube)
    return group
}

export function buildDoorFrame(width: number, height: number, color: number): THREE.Group {
    const group = new THREE.Group()
    group.add(part(0.28, height, 0.5, color, -width / 2, height / 2, 0))
    group.add(part(0.28, height, 0.5, color, width / 2, height / 2, 0))
    group.add(part(width + 0.28, 0.3, 0.5, color, 0, height - 0.15, 0))
    const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.3, 0.1, 0.52),
        new THREE.MeshBasicMaterial({ color: 0xffb020 })
    )
    stripe.position.y = height - 0.34
    group.add(stripe)
    return group
}

/** Handrail along a catwalk edge. Decorative — you can still walk off. */
export function buildRailing(length: number, color: number): THREE.Group {
    const group = new THREE.Group()
    const top = new THREE.Mesh(new THREE.BoxGeometry(length, 0.06, 0.06), new THREE.MeshLambertMaterial({ color }))
    top.position.y = 1
    group.add(top)
    const mid = top.clone()
    mid.position.y = 0.55
    group.add(mid)
    const posts = Math.max(2, Math.round(length / 1.6))
    for (let i = 0; i <= posts; i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1, 0.07), new THREE.MeshLambertMaterial({ color }))
        post.position.set(-length / 2 + (length / posts) * i, 0.5, 0)
        group.add(post)
    }
    return group
}

export function buildSign(width: number, height: number, opts: Parameters<typeof makeSignTexture>[0]): THREE.Mesh {
    return new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: makeSignTexture(opts), transparent: true })
    )
}

export interface PropModel {
    group: THREE.Group
    glow: (THREE.MeshBasicMaterial | THREE.MeshLambertMaterial)[]
    light?: THREE.PointLight
}

export function buildWallBuy(weapon: CallOfXenoWeapon): PropModel {
    const group = new THREE.Group()
    group.add(part(1.7, 1.15, 0.09, 0x2a2d34, 0, 0, 0.05))
    const trim = new THREE.Mesh(
        new THREE.BoxGeometry(1.78, 1.23, 0.05),
        new THREE.MeshLambertMaterial({ color: 0x8a6a2a })
    )
    trim.position.z = 0.02
    group.add(trim)

    const gun = buildWeaponModel(weapon.id, 0)
    gun.scale.setScalar(1.15)
    gun.rotation.y = Math.PI / 2
    gun.rotation.z = 0.1
    gun.position.set(0, 0.16, 0.16)
    group.add(gun)

    const sign = buildSign(1.5, 0.42, {
        title: weapon.name,
        subtitle: String(weapon.cost),
        color: '#f4e7c8',
        accent: '#e0a83c'
    })
    sign.position.set(0, -0.4, 0.11)
    group.add(sign)

    return { group, glow: [] }
}

export function buildPerkMachine(perk: CallOfXenoPerk): PropModel {
    const group = new THREE.Group()
    const hex = '#' + perk.color.toString(16).padStart(6, '0')

    group.add(part(1.1, 2, 0.9, 0x2c3038, 0, 1, 0))

    const panelMat = new THREE.MeshBasicMaterial({ color: perk.color })
    panelMat.color.multiplyScalar(0.14)
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.2, 0.06), panelMat)
    panel.position.set(0, 1.12, 0.47)
    group.add(panel)

    const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.16, 0.46, 8),
        new THREE.MeshLambertMaterial({ color: perk.color })
    )
    bottle.position.y = 2.25
    group.add(bottle)
    const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8),
        new THREE.MeshLambertMaterial({ color: 0xd8d8d8 })
    )
    cap.position.y = 2.54
    group.add(cap)

    const sign = buildSign(1.3, 0.42, {
        title: perk.name,
        subtitle: String(perk.cost),
        color: hex,
        background: 'rgba(8,10,14,0.92)',
        accent: hex
    })
    sign.position.set(0, 1.86, 0.47)
    group.add(sign)

    const light = new THREE.PointLight(perk.color, 0, 5, 2)
    light.position.set(0, 1.4, 0.9)
    group.add(light)

    return { group, glow: [panelMat], light }
}

export function buildPackAPunch(): PropModel {
    const group = new THREE.Group()
    group.add(part(2.4, 1.7, 1.2, 0x33263f, 0, 0.85, 0))
    group.add(part(2.6, 0.24, 1.3, 0x241a2c, 0, 1.82, 0))

    const slotMat = new THREE.MeshBasicMaterial({ color: 0x2a0f3a })
    const slot = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.1), slotMat)
    slot.position.set(0, 1.05, 0.62)
    group.add(slot)

    const archMat = new THREE.MeshBasicMaterial({ color: 0x2a0f3a })
    for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.7, 0.12), archMat)
        post.position.set(1.05 * side, 0.85, 0.66)
        group.add(post)
    }

    const sign = buildSign(2.1, 0.6, {
        title: 'Pack-a-Punch',
        color: '#e8b3ff',
        background: 'rgba(14,6,20,0.92)',
        accent: '#a855f7'
    })
    sign.position.set(0, 2.2, 0.62)
    group.add(sign)

    const light = new THREE.PointLight(0xa855f7, 0, 8, 2)
    light.position.set(0, 1.4, 1.2)
    group.add(light)

    return { group, glow: [slotMat, archMat], light }
}

export interface PowerLeverModel extends PropModel {
    handle: THREE.Mesh
}

export function buildPowerLever(): PowerLeverModel {
    const group = new THREE.Group()
    group.add(part(0.5, 1.3, 1, 0x33383f, 0, 0.65, 0))
    group.add(part(0.6, 0.16, 1.1, 0x22262c, 0, 1.36, 0))

    const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.8, 0.12),
        new THREE.MeshLambertMaterial({ color: 0xcc3322 })
    )
    handle.geometry.translate(0, 0.4, 0)
    handle.position.set(0, 1.4, 0)
    handle.rotation.x = 0.9
    group.add(handle)

    const lampMat = new THREE.MeshBasicMaterial({ color: 0x441111 })
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), lampMat)
    lamp.position.set(0, 1.05, 0.52)
    group.add(lamp)

    const sign = buildSign(0.9, 0.3, {
        title: 'Power',
        color: '#ffd27a',
        background: 'rgba(10,8,6,0.9)',
        accent: '#a86a1c'
    })
    sign.position.set(0, 0.7, 0.52)
    group.add(sign)

    return { group, glow: [lampMat], handle }
}

export interface MysteryBoxModel extends PropModel {
    lid: THREE.Object3D
    /** Where the prize weapon floats while the box is spinning. */
    mount: THREE.Object3D
}

export function buildMysteryBox(cost: number): MysteryBoxModel {
    const group = new THREE.Group()
    group.add(part(1.5, 0.9, 1.1, 0x4a3a22, 0, 0.45, 0))
    for (const y of [0.18, 0.72]) {
        const band = new THREE.Mesh(
            new THREE.BoxGeometry(1.54, 0.1, 1.14),
            new THREE.MeshLambertMaterial({ color: 0x2b2f36 })
        )
        band.position.y = y
        group.add(band)
    }

    const lid = new THREE.Group()
    lid.position.set(0, 0.9, -0.55)
    const lidMesh = part(1.5, 0.12, 1.1, 0x5c4728, 0, 0.06, 0.55)
    lid.add(lidMesh)
    group.add(lid)

    const glowMat = new THREE.MeshBasicMaterial({ color: 0x1a1206 })
    const glowPanel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.06), glowMat)
    glowPanel.position.set(0, 0.5, 0.57)
    group.add(glowPanel)

    const sign = buildSign(1.4, 0.4, {
        title: 'Mystery Box',
        subtitle: String(cost),
        color: '#ffd98a',
        background: 'rgba(16,10,4,0.9)',
        accent: '#c98a2a'
    })
    sign.position.set(0, 1.35, 0.56)
    group.add(sign)

    const mount = new THREE.Group()
    mount.position.set(0, 1.35, 0)
    group.add(mount)

    const light = new THREE.PointLight(0xffc457, 0, 7, 2)
    light.position.set(0, 1.4, 0)
    group.add(light)

    return { group, glow: [glowMat], light, lid, mount }
}

export interface PowerUpModel {
    group: THREE.Group
    light: THREE.PointLight
}

/** The floor drop: a lit cube with the power-up's initial on every face. */
export function buildPowerUp(powerUp: CallOfXenoPowerUp): PowerUpModel {
    const group = new THREE.Group()

    const shell = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.42, 0.42),
        new THREE.MeshBasicMaterial({ color: powerUp.color })
    )
    group.add(shell)

    const cage = new THREE.Mesh(
        new THREE.BoxGeometry(0.52, 0.52, 0.52),
        new THREE.MeshBasicMaterial({ color: powerUp.color, wireframe: true, transparent: true, opacity: 0.7 })
    )
    group.add(cage)

    const hex = '#' + powerUp.color.toString(16).padStart(6, '0')
    for (let i = 0; i < 4; i++) {
        const face = buildSign(0.4, 0.4, { title: powerUp.name.slice(0, 1), color: '#100c04', background: hex })
        face.position.set(Math.sin((i / 4) * Math.PI * 2) * 0.22, 0, Math.cos((i / 4) * Math.PI * 2) * 0.22)
        face.rotation.y = (i / 4) * Math.PI * 2
        group.add(face)
    }

    const light = new THREE.PointLight(powerUp.color, 4, 7, 2)
    group.add(light)

    return { group, light }
}

/** Glowing bolt fired by a drone. */
export function buildProjectile(color: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 8, 6),
        new THREE.MeshBasicMaterial({ color })
    )
    const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
    )
    mesh.add(halo)
    return mesh
}
