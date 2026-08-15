// Call of Xeno — low-poly mesh builders.
//
// Everything is boxes, cylinders and a couple of canvas-textured planes. The
// point is silhouette: a zombie should read as a zombie and an RPK should read
// as a machine gun from across the room, without a single imported asset.

import * as THREE from 'three'
import { makeSignTexture } from './textures'
import type { CallOfXenoPerk, CallOfXenoWeapon, CallOfXenoWeaponId } from '#shared/utils/gamelogic/call-of-xeno'

export interface ZombieModel {
    group: THREE.Group
    head: THREE.Mesh
    armL: THREE.Object3D
    armR: THREE.Object3D
    legL: THREE.Object3D
    legR: THREE.Object3D
    /** Shared by every body part so a hit flash only needs one colour write. */
    skin: THREE.MeshLambertMaterial
    clothes: THREE.MeshLambertMaterial
    eyes: THREE.MeshBasicMaterial
    baseSkin: number
    baseCloth: number
}

const ZOMBIE_SKINS = [0x6f8a52, 0x7d8a63, 0x5c7a44, 0x8a8a5c]
const ZOMBIE_CLOTHES = [0x3a3f4a, 0x4a3b32, 0x2f3742, 0x4a3f52]

/**
 * A shambler: boxy torso, forward-hanging arms, split legs so the walk cycle
 * has something to swing. Pivots are placed at the shoulder and hip rather
 * than the mesh centre so rotation looks like a joint, not a spin.
 */
export function buildZombie(): ZombieModel {
    const skinColor = ZOMBIE_SKINS[Math.floor(Math.random() * ZOMBIE_SKINS.length)]!
    const clothColor = ZOMBIE_CLOTHES[Math.floor(Math.random() * ZOMBIE_CLOTHES.length)]!
    const skin = new THREE.MeshLambertMaterial({ color: skinColor })
    const clothes = new THREE.MeshLambertMaterial({ color: clothColor })
    const eyes = new THREE.MeshBasicMaterial({ color: 0xffdd55 })

    const group = new THREE.Group()

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.34), clothes)
    torso.position.y = 1.16
    group.add(torso)

    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.22, 0.32), clothes)
    hips.position.y = 0.74
    group.add(hips)

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin)
    head.position.y = 1.72
    group.add(head)

    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.1), skin)
    jaw.position.set(0, 1.6, -0.16)
    group.add(jaw)

    for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.03), eyes)
        eye.position.set(0.09 * side, 1.76, -0.17)
        group.add(eye)
    }

    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), skin)
    neck.position.y = 1.52
    group.add(neck)

    // Arms hang from a shoulder pivot and are tipped forward, zombie-style.
    const makeArm = (side: number) => {
        const pivot = new THREE.Group()
        pivot.position.set(0.4 * side, 1.44, 0)
        const upper = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.5, 0.17), clothes)
        upper.position.y = -0.25
        const fore = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.44, 0.15), skin)
        fore.position.set(0, -0.5, -0.22)
        fore.rotation.x = -1.15
        pivot.add(upper, fore)
        pivot.rotation.x = -0.55
        group.add(pivot)
        return pivot
    }

    const makeLeg = (side: number) => {
        const pivot = new THREE.Group()
        pivot.position.set(0.16 * side, 0.72, 0)
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.68, 0.2), clothes)
        leg.position.y = -0.34
        const boot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.3), new THREE.MeshLambertMaterial({ color: 0x22262c }))
        boot.position.set(0, -0.72, -0.04)
        pivot.add(leg, boot)
        group.add(pivot)
        return pivot
    }

    const armL = makeArm(-1)
    const armR = makeArm(1)
    const legL = makeLeg(-1)
    const legR = makeLeg(1)

    // Flat blob shadow. Cheaper than a shadow map and enough to plant the
    // model on the floor instead of letting it hover.
    const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.42, 12),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false })
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.02
    group.add(shadow)

    return { group, head, armL, armR, legL, legR, skin, clothes, eyes, baseSkin: skinColor, baseCloth: clothColor }
}

/** Tints every body part at once — used for the white-hot hit flash. */
export function flashZombie(model: ZombieModel, on: boolean) {
    model.skin.color.setHex(on ? 0xff6655 : model.baseSkin)
    model.clothes.color.setHex(on ? 0xcc4433 : model.baseCloth)
}

const GUN_DARK = 0x24272e
const GUN_METAL = 0x585f6b
const GUN_WOOD = 0x6b4a2c

function part(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }))
    mesh.position.set(x, y, z)
    return mesh
}

/**
 * First-person weapon model. Built pointing down -Z with the grip near the
 * origin so the view model can be parented straight to the camera.
 */
export function buildWeaponModel(id: CallOfXenoWeaponId, upgraded: boolean): THREE.Group {
    const group = new THREE.Group()
    const accent = upgraded ? 0x9a3fd0 : GUN_METAL

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
            group.add(part(0.06, 0.13, 0.07, 0x2f3238, 0, -0.09, 0.0))
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
            group.add(part(0.05, 0.05, 0.14, GUN_WOOD, 0, 0.0, -0.46))
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
            const coil = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8),
                new THREE.MeshBasicMaterial({ color: upgraded ? 0xff66dd : 0x44ffcc })
            )
            coil.rotation.x = Math.PI / 2
            coil.position.set(0, 0.06, -0.34)
            group.add(coil)
            const emitter = new THREE.Mesh(
                new THREE.ConeGeometry(0.09, 0.18, 8),
                new THREE.MeshBasicMaterial({ color: upgraded ? 0xffaaee : 0x88ffee })
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

/** A crate, barrel or console prop. Kind picks the silhouette. */
export function buildCrate(width: number, height: number, depth: number, tint: number): THREE.Group {
    const group = new THREE.Group()
    const body = part(width, height, depth, tint, 0, height / 2, 0)
    group.add(body)

    // Edge banding so a plain box picks up a highlight from any angle.
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
    const housing = part(2.6, 0.14, 0.5, 0x1a1d23, 0, height - 0.07, 0)
    group.add(housing)
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

/** Sign plane with a canvas texture. Returns the mesh so callers can place it. */
export function buildSign(width: number, height: number, opts: Parameters<typeof makeSignTexture>[0]): THREE.Mesh {
    const texture = makeSignTexture(opts)
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true })
    )
    return mesh
}

export interface PropModel {
    group: THREE.Group
    /** Materials switched on when the power comes up. */
    glow: (THREE.MeshBasicMaterial | THREE.MeshLambertMaterial)[]
    light?: THREE.PointLight
}

/** Wall-mounted weapon purchase: backing board, the gun itself, a price sign. */
export function buildWallBuy(weapon: CallOfXenoWeapon, locked: boolean): PropModel {
    const group = new THREE.Group()

    const board = part(1.7, 1.15, 0.09, 0x2a2d34, 0, 0, 0.05)
    group.add(board)
    const trim = new THREE.Mesh(
        new THREE.BoxGeometry(1.78, 1.23, 0.05),
        new THREE.MeshLambertMaterial({ color: locked ? 0x3a3f47 : 0x8a6a2a })
    )
    trim.position.z = 0.02
    group.add(trim)

    const gun = buildWeaponModel(weapon.id, false)
    gun.scale.setScalar(1.15)
    gun.rotation.y = Math.PI / 2
    gun.rotation.z = 0.1
    gun.position.set(0, 0.16, 0.16)
    group.add(gun)

    const sign = buildSign(1.5, 0.42, {
        title: weapon.name,
        subtitle: String(weapon.cost),
        color: '#f4e7c8',
        accent: locked ? '#556' : '#e0a83c'
    })
    sign.position.set(0, -0.4, 0.11)
    group.add(sign)

    return { group, glow: [] }
}

/** Perk vending machine: cabinet, lit front panel, bottle on top, name board. */
export function buildPerkMachine(perk: CallOfXenoPerk): PropModel {
    const group = new THREE.Group()
    const hex = '#' + perk.color.toString(16).padStart(6, '0')

    const cabinet = part(1.1, 2, 0.9, 0x2c3038, 0, 1, 0)
    group.add(cabinet)

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
        subtitle: '5000',
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
