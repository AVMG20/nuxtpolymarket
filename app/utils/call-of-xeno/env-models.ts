// Call of Xeno — level dressing meshes.

import * as THREE from 'three'
import { makeSignTexture } from './textures'
import { part } from './model-kit'

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
