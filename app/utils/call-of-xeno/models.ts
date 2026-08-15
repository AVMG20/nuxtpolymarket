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
        // Front armour plate so the silhouette explains its own weak point.
        const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.09), new THREE.MeshLambertMaterial({ color: 0x22262e }))
        chest.position.set(0, 1.24, -0.2 * bulk)
        group.add(chest)
    }

    // Shoulder pads — reads as armour and widens the silhouette.
    for (const side of [-1, 1]) {
        group.add(part(0.24, 0.14, 0.3 * bulk, 0x2b3038, 0.38 * bulk * side, 1.56, 0))
    }

    // The husk runs hot: a lit crack down the chest.
    if (def.id === 'husk') {
        const crack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.04), glow)
        crack.position.set(0, 1.18, -0.18 * bulk)
        group.add(crack)
    }

    // Shamblers are hunched; crawlers tilt forward onto their knuckles.
    head.rotation.x = def.id === 'shambler' ? 0.18 : def.id === 'crawler' ? 0.5 : 0.05

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
        case 'skorpion':
            group.add(part(0.06, 0.09, 0.3, GUN_DARK, 0, 0.01, -0.1))
            group.add(part(0.035, 0.035, 0.16, accent, 0, 0.05, -0.2))
            group.add(part(0.05, 0.2, 0.05, 0x2b2f36, 0, -0.13, -0.05))
            group.add(part(0.05, 0.11, 0.06, 0x2f3238, 0, -0.06, 0.05))
            group.add(part(0.02, 0.02, 0.14, 0x3a3f47, 0, 0.02, 0.16))
            break
        case 'magnum':
            group.add(part(0.055, 0.075, 0.34, GUN_DARK, 0, 0.03, -0.16))
            group.add(part(0.045, 0.045, 0.34, accent, 0, 0.08, -0.18))
            group.add(part(0.07, 0.07, 0.12, 0x3a3f47, 0, 0.03, -0.02))
            group.add(part(0.055, 0.15, 0.07, 0x4a3520, 0, -0.07, 0.04))
            group.add(part(0.02, 0.025, 0.025, accent, 0, 0.11, -0.32))
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
        case 'bar':
            group.add(part(0.075, 0.1, 0.66, GUN_DARK, 0, 0.01, -0.24))
            group.add(part(0.045, 0.045, 0.78, accent, 0, 0.06, -0.34))
            group.add(part(0.08, 0.13, 0.24, GUN_WOOD, 0, -0.03, 0.18))
            group.add(part(0.065, 0.12, 0.07, 0x2f3238, 0, -0.07, 0.03))
            group.add(part(0.05, 0.05, 0.16, GUN_WOOD, 0, 0, -0.56))
            group.add(part(0.07, 0.18, 0.1, 0x3a3f47, 0, -0.1, -0.16))
            group.add(part(0.025, 0.2, 0.025, 0x2b2f36, 0.05, -0.14, -0.52))
            group.add(part(0.025, 0.2, 0.025, 0x2b2f36, -0.05, -0.14, -0.52))
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
    // A timber supply crate: boards, a batten frame and a plain lid.
    group.add(part(width, height, depth, 0x554634, 0, height / 2, 0))
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            group.add(part(0.12, height, 0.12, 0x3d3225, sx * (width / 2 - 0.06), height / 2, sz * (depth / 2 - 0.06)))
        }
    }
    // Horizontal battens, proud of the face so the box catches a shadow.
    for (const y of [height * 0.28, height * 0.72]) {
        group.add(part(width * 1.02, 0.09, depth * 1.02, 0x463a2b, 0, y, 0))
    }
    group.add(part(width * 1.04, 0.1, depth * 1.04, tint, 0, height + 0.04, 0))
    return group
}

/** Waist-high hazard-striped barrier — the low cover. */
export function buildBarrier(width: number, height: number, depth: number, tint: number, hazard: THREE.Texture): THREE.Group {
    const group = new THREE.Group()
    const hazardMat = new THREE.MeshLambertMaterial({ map: hazard })
    const capMat = new THREE.MeshLambertMaterial({ color: 0x2e2f2a })
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        [hazardMat, hazardMat, capMat, capMat, hazardMat, hazardMat]
    )
    body.position.y = height / 2
    group.add(body)
    const cap = new THREE.Mesh(
        new THREE.BoxGeometry(width * 1.04, 0.08, depth * 1.04),
        new THREE.MeshLambertMaterial({ color: tint })
    )
    cap.position.y = height
    group.add(cap)
    return group
}

/** Decorative fuel drum, parked in the corner of a crate's footprint. */
export function buildBarrel(color: number): THREE.Group {
    const group = new THREE.Group()
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.33, 0.33, 1.02, 10),
        new THREE.MeshLambertMaterial({ color })
    )
    body.position.y = 0.51
    group.add(body)
    for (const y of [0.24, 0.78]) {
        const ring = new THREE.Mesh(
            new THREE.CylinderGeometry(0.35, 0.35, 0.07, 10),
            new THREE.MeshLambertMaterial({ color: 0x24251f })
        )
        ring.position.y = y
        group.add(ring)
    }
    const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.29, 0.29, 0.05, 10),
        new THREE.MeshLambertMaterial({ color: 0x43443e })
    )
    cap.position.y = 1.04
    group.add(cap)
    return group
}

/** Shootable explosive barrel: red shell, warning band, lit valve on top. */
export function buildExplosiveBarrel(): THREE.Group {
    const group = new THREE.Group()
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, 1.06, 10),
        new THREE.MeshLambertMaterial({ color: 0xb03a26 })
    )
    body.position.y = 0.53
    group.add(body)
    for (const y of [0.1, 0.96]) {
        const ring = new THREE.Mesh(
            new THREE.CylinderGeometry(0.36, 0.36, 0.08, 10),
            new THREE.MeshLambertMaterial({ color: 0x24251f })
        )
        ring.position.y = y
        group.add(ring)
    }
    const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.16, 10),
        new THREE.MeshLambertMaterial({ color: 0xe0a83c })
    )
    band.position.y = 0.53
    group.add(band)
    const valve = new THREE.Mesh(
        new THREE.TorusGeometry(0.1, 0.03, 6, 10),
        new THREE.MeshLambertMaterial({ color: 0xd8a02a })
    )
    valve.rotation.x = Math.PI / 2
    valve.position.y = 1.1
    group.add(valve)
    return group
}

/** Structural column: poured concrete on a steel base plate. */
export function buildPillar(height: number, accent: number): THREE.Group {
    const group = new THREE.Group()
    const column = new THREE.Mesh(
        new THREE.BoxGeometry(0.78, height - 0.44, 0.78),
        new THREE.MeshLambertMaterial({ color: 0x4b4c4b })
    )
    column.position.y = (height - 0.44) / 2 + 0.22
    group.add(column)
    // Base plate and capital, both a shade darker so the column reads as cast
    // into the floor rather than resting on it.
    group.add(part(1.05, 0.22, 1.05, 0x33342f, 0, 0.11, 0))
    group.add(part(0.98, 0.22, 0.98, 0x33342f, 0, height - 0.11, 0))
    // A bolted steel collar at chest height, in the room's own dull metal.
    const collar = new THREE.Mesh(
        new THREE.BoxGeometry(0.86, 0.16, 0.86),
        new THREE.MeshLambertMaterial({ color: accent })
    )
    collar.position.y = height * 0.42
    group.add(collar)
    return group
}

/** A generator or bench housing, sized to fill its collision footprint. */
export function buildMachine(width: number, height: number, depth: number, accent: number): THREE.Group {
    const group = new THREE.Group()
    group.add(part(width, height * 0.35, depth, 0x3a3a36, 0, height * 0.175, 0))
    group.add(part(width * 0.9, height * 0.65, depth * 0.9, 0x4a4b47, 0, height * 0.675, 0))
    // Louvre slats down the front face.
    for (let i = 0; i < 4; i++) {
        group.add(part(width * 0.6, 0.07, 0.05, 0x24241f, 0, height * 0.48 + i * 0.24, depth * 0.455))
    }
    // A painted maintenance band, kept flat so it does not glow.
    group.add(part(width * 0.92, 0.1, depth * 0.92, accent, 0, height * 0.36, 0))
    const stack = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.19, 0.7, 8),
        new THREE.MeshLambertMaterial({ color: 0x4e4f4b })
    )
    stack.position.set(width * 0.28, height - 0.35, 0)
    group.add(stack)
    return group
}

/** A steel shipping container, parked as cover in the Garage. */
export function buildContainer(width: number, height: number, depth: number, tint: number): THREE.Group {
    const group = new THREE.Group()
    group.add(part(width, height, depth, tint, 0, height / 2, 0))
    // Corrugation, cut as thin ribs down the long faces.
    const ribs = Math.max(4, Math.round(width / 0.55))
    for (let i = 0; i < ribs; i++) {
        const x = -width / 2 + (width / ribs) * (i + 0.5)
        group.add(part(0.12, height * 0.86, depth + 0.06, 0x3f4340, x, height / 2, 0))
    }
    // Corner castings and a rail top and bottom.
    for (const y of [0.12, height - 0.12]) {
        group.add(part(width + 0.06, 0.22, depth + 0.06, 0x33362f, 0, y, 0))
    }
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            group.add(part(0.26, height, 0.26, 0x2c2f29, sx * (width / 2), height / 2, sz * (depth / 2)))
        }
    }
    return group
}

/** A dead flatbed truck, filling the Garage's collision footprint. */
export function buildTruck(width: number, height: number, depth: number, tint: number): THREE.Group {
    const group = new THREE.Group()
    const bodyColor = 0x4a4f47
    // Bed runs the back two thirds, cab the front third.
    const bedDepth = depth * 0.62
    const cabDepth = depth - bedDepth
    group.add(part(width * 0.9, 0.5, bedDepth, bodyColor, 0, 1.05, depth / 2 - bedDepth / 2))
    // Bed sides.
    for (const sx of [-1, 1]) {
        group.add(part(0.12, 0.55, bedDepth, tint, sx * (width * 0.45), 1.55, depth / 2 - bedDepth / 2))
    }
    group.add(part(width * 0.9, 0.55, 0.12, tint, 0, 1.55, depth / 2 - 0.06))
    // Cab and its glass.
    group.add(part(width * 0.86, 1.25, cabDepth * 0.9, bodyColor, 0, 1.42, -depth / 2 + cabDepth / 2))
    group.add(part(width * 0.7, 0.5, cabDepth * 0.92, 0x23282a, 0, 2.1, -depth / 2 + cabDepth / 2))
    // Chassis rails and four wheels.
    group.add(part(width * 0.7, 0.24, depth * 0.94, 0x30332e, 0, 0.72, 0))
    for (const sx of [-1, 1]) {
        for (const sz of [-0.32, 0.28]) {
            const wheel = new THREE.Mesh(
                new THREE.CylinderGeometry(0.55, 0.55, 0.3, 10),
                new THREE.MeshLambertMaterial({ color: 0x1f2120 })
            )
            wheel.rotation.z = Math.PI / 2
            wheel.position.set(sx * (width * 0.44), 0.55, sz * depth)
            group.add(wheel)
        }
    }
    return group
}

/** Wall-hugging pipe run with brackets and one lit valve. */
export function buildPipesRun(length: number, accent: number): THREE.Group {
    const group = new THREE.Group()
    const mat = new THREE.MeshLambertMaterial({ color: 0x53554f })
    for (const [y, r] of [[0, 0.09], [0.34, 0.07]] as const) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, length, 8), mat)
        pipe.rotation.z = Math.PI / 2
        pipe.position.y = y
        group.add(pipe)
    }
    const brackets = Math.max(2, Math.round(length / 3))
    for (let i = 0; i <= brackets; i++) {
        group.add(part(0.1, 0.5, 0.12, 0x2b2f36, -length / 2 + (length / brackets) * i, 0.18, 0))
    }
    const valve = new THREE.Mesh(
        new THREE.TorusGeometry(0.13, 0.035, 6, 10),
        new THREE.MeshLambertMaterial({ color: accent })
    )
    valve.rotation.y = Math.PI / 2
    valve.position.set(-length * 0.3, 0.34, 0.1)
    group.add(valve)
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
        new THREE.MeshLambertMaterial({ color: 0x8f7434 })
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

/** A boarded window: the reveal, the sill and the planks nailed across it.
 *
 *  Local space has +X along the opening and +Z pointing outside, so the caller
 *  only has to drop the group on the wall plane and yaw it to face out.
 */
export interface WindowModel {
    group: THREE.Group
    /** One node per board, ordered bottom to top. Hidden as they are torn off. */
    boards: THREE.Object3D[]
}

export function buildWindow(width: number, sill: number, head: number, planks: number, plank: THREE.Texture): WindowModel {
    const group = new THREE.Group()
    const opening = head - sill
    const reveal = 0x3c3d38
    const plankMat = new THREE.MeshLambertMaterial({ map: plank })

    // Reveal: a lining round the four sides of the hole so the shell reads as
    // a wall with a window punched through it, not a gap in a box.
    group.add(part(0.16, opening, 0.62, reveal, -width / 2 - 0.08, sill + opening / 2, 0))
    group.add(part(0.16, opening, 0.62, reveal, width / 2 + 0.08, sill + opening / 2, 0))
    group.add(part(width + 0.32, 0.18, 0.62, reveal, 0, head + 0.09, 0))
    // A stone sill, sloped out a little by sitting proud on the outside face.
    group.add(part(width + 0.42, 0.2, 0.78, 0x4d4e48, 0, sill - 0.1, 0.06))

    const boards: THREE.Object3D[] = []
    for (let i = 0; i < planks; i++) {
        const pivot = new THREE.Group()
        // Spread the planks over the opening and let each sit at its own
        // slight angle, the way someone in a hurry would have nailed them.
        const t = (i + 0.5) / planks
        pivot.position.set(0, sill + opening * t, 0.12)
        pivot.rotation.z = (i % 2 === 0 ? 1 : -1) * (0.04 + (i % 3) * 0.03)

        const board = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.5, opening / planks * 0.72, 0.09),
            plankMat
        )
        pivot.add(board)
        // Two nail heads, one at each end.
        for (const sx of [-1, 1]) {
            const nail = new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.06, 0.04),
                new THREE.MeshLambertMaterial({ color: 0x6b6b63 })
            )
            nail.position.set(sx * (width / 2 + 0.14), 0, 0.07)
            pivot.add(nail)
        }
        group.add(pivot)
        boards.push(pivot)
    }

    return { group, boards }
}

/** A flight of steps. Local origin sits at the bottom, climbing along +Z. */
export function buildStairs(width: number, run: number, rise: number, steps: number, metal: THREE.Texture): THREE.Group {
    const group = new THREE.Group()
    const treadMat = new THREE.MeshLambertMaterial({ map: metal })
    const riserMat = new THREE.MeshLambertMaterial({ color: 0x35362f })
    const stepRun = run / steps
    const stepRise = rise / steps

    for (let i = 0; i < steps; i++) {
        const tread = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, stepRun + 0.04), treadMat)
        tread.position.set(0, stepRise * (i + 1) - 0.05, stepRun * (i + 0.5))
        group.add(tread)
        const riser = new THREE.Mesh(new THREE.BoxGeometry(width, stepRise, 0.08), riserMat)
        riser.position.set(0, stepRise * (i + 0.5), stepRun * i)
        group.add(riser)
    }

    // Stringers down both sides, following the pitch.
    const length = Math.hypot(run, rise)
    for (const sx of [-1, 1]) {
        const stringer = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, 0.34, length),
            new THREE.MeshLambertMaterial({ color: 0x2e2f2a })
        )
        stringer.position.set(sx * (width / 2 + 0.07), rise / 2 - 0.16, run / 2)
        stringer.rotation.x = -Math.atan2(rise, run)
        group.add(stringer)
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
