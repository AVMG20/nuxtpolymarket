import * as THREE from 'three'
import { ARCH_R, AXLE_U, BodySurface, buildSkin, buildTailFace, buildUnderbody, curve, surfacePatch, TAIL_U, TUB_X, WHEEL_R, type Edge, type PatchOptions } from './car-body'
import { assembleCar } from './car-assembly'
import { Kit, type Slot } from './car-kit'
import { atlasUv, DECALS, liveryTexture, mapToDecal } from './car-livery'
import type { PlayerCar } from './car-models'

/** The Kestrel, assembled from the lofted body and its parts. Everything faces -z, the direction of travel. */

const WHEEL_W = 0.3
const HALF_TRACK = 0.82
/** Where the tail lamps and rear face sit. */
const TAIL_Z = -TAIL_U
const TAIL_Y = 0.72
/** Half-width to the middle of each tail lamp, and where the exhausts come out; the flames and light trails start from these too. */
const LAMP_X = 0.36
const PIPE_XS = [0.38, 0.54]
const PIPE_Y = 0.29

const SIDES = [-1, 1] as const

/** A patch on the car's right between two edges, mirrored on its left so the faces there still point out. */
function mirroredPatch(kit: Kit, surface: BodySurface, slot: Slot, u0: number, u1: number, lo: Edge, hi: Edge, opts?: PatchOptions) {
    for (const side of SIDES) {
        const geo = side > 0
            ? surfacePatch(surface, u0, u1, lo, hi, opts)
            : surfacePatch(surface, u0, u1, u => -hi(u), u => -lo(u), opts)
        kit.add(slot, geo)
        geo.dispose()
    }
}

/** A patch on both flanks, given as heights. */
function flankPatch(kit: Kit, surface: BodySurface, slot: Slot, u0: number, u1: number, lower: (u: number) => number, upper: (u: number) => number, opts?: PatchOptions) {
    mirroredPatch(kit, surface, slot, u0, u1, u => surface.sAtY(u, upper(u)), u => surface.sAtY(u, lower(u)), opts)
}

/** A patch on both sides of the top, given as half-widths from `inner` to `outer`. */
function topPatch(kit: Kit, surface: BodySurface, slot: Slot, u0: number, u1: number, inner: (u: number) => number, outer: (u: number) => number, opts?: PatchOptions) {
    mirroredPatch(kit, surface, slot, u0, u1, u => surface.sAtX(u, inner(u)), u => surface.sAtX(u, outer(u)), opts)
}

/** Windscreen, side glass and the KESTREL banner. */
function addGlasshouse(kit: Kit, surface: BodySurface) {
    const screen = curve([[-0.02, 0.385], [0.2, 0.5], [0.5, 0.645], [0.72, 0.625], [0.88, 0.43], [0.985, 0.02]])
    const edge: Edge = u => surface.sAtX(u, screen(u))
    const glass = surfacePatch(surface, -0.02, 0.985, u => -edge(u), edge, { nu: 36, nv: 24, lift: 0.006 })
    kit.add('glass', glass)
    glass.dispose()

    const banner = surfacePatch(surface, 0.03, 0.12, () => -0.27, () => 0.27, {
        nu: 4, nv: 16, lift: 0.009,
        uv: (a, b) => atlasUv(DECALS.banner, 1 - b, 1 - a)
    })
    kit.add('decal', banner)
    banner.dispose()

    const windowLow = curve([[-1.02, 0.905], [-0.75, 0.875], [-0.4, 0.835], [0, 0.815], [0.3, 0.815], [0.56, 0.84]])
    const windowHigh = curve([[-1.02, 0.905], [-0.72, 0.965], [-0.4, 1.015], [-0.05, 1.015], [0.2, 0.945], [0.56, 0.84]])
    flankPatch(kit, surface, 'glass', -1.02, 0.56, windowLow, windowHigh, { nu: 40, nv: 10, lift: 0.006 })
}

/** The big intake ahead of the rear wheel, split by a body-coloured blade, and the bonnet's two vents. */
function addVents(kit: Kit, surface: BodySurface) {
    const lowerBottom = curve([[-0.34, 0.33], [-0.96, 0.33]])
    const lowerTop = curve([[-0.34, 0.5], [-0.65, 0.525], [-0.96, 0.54]])
    flankPatch(kit, surface, 'mesh', -0.96, -0.34, lowerBottom, lowerTop, { nu: 12, nv: 8, lift: 0.006 })
    const upperBottom = curve([[-0.42, 0.565], [-0.65, 0.57], [-0.96, 0.585]])
    const upperTop = curve([[-0.42, 0.565], [-0.62, 0.68], [-0.8, 0.76], [-0.96, 0.74]])
    flankPatch(kit, surface, 'mesh', -0.96, -0.42, upperBottom, upperTop, { nu: 16, nv: 6, lift: 0.006 })

    // Beside the stripes, sharp at the back and cut off blunt at the front.
    const u0 = 1.52
    const u1 = 2.0
    const inner = curve([[u0, 0.56], [1.75, 0.42], [u1, 0.36]])
    const outer = curve([[u0, 0.57], [1.75, 0.56], [1.92, 0.54], [u1, 0.5]])
    topPatch(kit, surface, 'mesh', u0, u1, inner, outer, { nu: 24, nv: 6, lift: 0.006 })
    // A lip of black around each vent makes it read as cut in rather than painted on.
    topPatch(kit, surface, 'trim', u0 - 0.02, u1 + 0.02, u => inner(u) - 0.02, u => outer(u) + 0.02, { nu: 24, nv: 6, lift: 0.003 })
}

/** Slim blade headlamps on the fenders, ahead of the arches: dark glass, LED pods and a light strip along the outer edge. */
function addHeadlights(kit: Kit, surface: BodySurface) {
    const u0 = AXLE_U + ARCH_R + 0.03
    const u1 = 2.42
    const height = curve([[u0, 0.55], [2.05, 0.445], [2.25, 0.395], [u1, 0.36]])
    const half = curve([[u0, 0.006], [1.97, 0.05], [2.2, 0.058], [u1, 0.004]])
    const centre = (u: number) => surface.sAtY(u, height(u))
    const outer = (u: number) => centre(u) + half(u)
    mirroredPatch(kit, surface, 'glass', u0, u1, u => centre(u) - half(u), outer, { nu: 30, nv: 6, lift: 0.007 })
    mirroredPatch(kit, surface, 'head', u0 + 0.01, u1 - 0.01, u => outer(u) - 0.012, outer, { nu: 30, nv: 1, lift: 0.01 })
    const pod = new THREE.SphereGeometry(0.014, 12, 8)
    const p = new THREE.Vector3()
    const n = new THREE.Vector3()
    for (const side of SIDES) {
        for (const u of [2.02, 2.13, 2.24]) {
            const s = side * centre(u)
            surface.point(u, s, p)
            surface.normal(u, s, n)
            p.addScaledVector(n, 0.012)
            kit.add('head', pod, p.x, p.y, p.z)
        }
    }
    pod.dispose()
}

/** The swan-neck wing with its end plates, struts and the sail ahead of them. */
function addWing(kit: Kit) {
    const sailTop = 1.2
    // The wing rests on the sail.
    const y = sailTop + 0.016
    const z = 2.2
    const span = 1.92
    const chord = 0.52
    const foil = new THREE.Shape()
    foil.moveTo(chord / 2, -0.006)
    foil.bezierCurveTo(chord * 0.2, 0.045, -chord * 0.25, 0.055, -chord / 2, 0.012)
    foil.lineTo(-chord / 2, -0.006)
    foil.bezierCurveTo(-chord * 0.2, -0.02, chord * 0.2, -0.02, chord / 2, -0.006)
    const wing = new THREE.ExtrudeGeometry(foil, { depth: span, bevelEnabled: false, curveSegments: 10 })
    wing.translate(0, 0, -span / 2)
    wing.rotateY(Math.PI / 2)
    kit.add('trim', wing, 0, y, z)
    wing.dispose()
    // Reads from behind, for the chase camera.
    const name = new THREE.PlaneGeometry(1.25, 0.2)
    mapToDecal(name, DECALS.name)
    kit.add('decal', name, 0, y + 0.054, z, -Math.PI / 2)
    name.dispose()
    // A body-coloured strip along the trailing edge, and a white one along the front.
    kit.box('paint', span - 0.1, 0.016, 0.05, 0, y + 0.026, z + chord / 2 - 0.03, 0.006)
    kit.box('white', span - 0.5, 0.004, 0.05, 0, y + 0.05, z - chord / 2 + 0.08, 0.001)

    const plate = new THREE.Shape()
    plate.moveTo(-0.38, 0.09)
    plate.lineTo(0.34, 0.11)
    plate.lineTo(0.36, -0.16)
    plate.lineTo(-0.14, -0.2)
    plate.closePath()
    const plateGeo = new THREE.ExtrudeGeometry(plate, { depth: 0.018, bevelEnabled: false })
    plateGeo.translate(0, 0, -0.009)
    plateGeo.rotateY(Math.PI / 2)
    const decal = new THREE.PlaneGeometry(0.34, 0.17)
    mapToDecal(decal, DECALS.plate)
    for (const side of SIDES) {
        kit.add('trim', plateGeo, side * span / 2, y, z)
        kit.add('decal', decal, side * (span / 2 + 0.011), y - 0.02, z + 0.08, 0, side * Math.PI / 2)
        // Struts lean out from the deck as they rise.
        kit.beam('trim', [side * 0.28, 0.96, 1.45], [side * 0.56, y - 0.02, z - 0.03], 0.05, 0.13)
    }
    plateGeo.dispose()
    decal.dispose()

    const sail = new THREE.Shape()
    sail.moveTo(0.98, 1.04)
    sail.lineTo(1.86, sailTop)
    sail.lineTo(2.1, sailTop)
    sail.lineTo(2.12, 0.92)
    sail.lineTo(1.0, 1.0)
    sail.closePath()
    const sailGeo = new THREE.ExtrudeGeometry(sail, { depth: 0.024, bevelEnabled: false })
    sailGeo.translate(0, 0, -0.012)
    sailGeo.rotateY(-Math.PI / 2)
    kit.add('trim', sailGeo)
    sailGeo.dispose()
    const num = new THREE.PlaneGeometry(0.28, 0.14)
    mapToDecal(num, DECALS.number)
    for (const side of SIDES) kit.add('decal', num, side * 0.0135, 1.075, 1.62, 0, side * Math.PI / 2)
    num.dispose()
}

/** Teardrop mirrors on thin stalks, the roof scoop, side blades and canards. */
function addAero(kit: Kit, surface: BodySurface) {
    const mirror = new THREE.SphereGeometry(1, 20, 14)
    const glass = new THREE.CircleGeometry(1, 20)
    for (const side of SIDES) {
        const root = surface.point(0.6, side * surface.sAtY(0.6, 0.76))
        const head: [number, number, number] = [side * 1.08, 0.9, -0.52]
        kit.add('paint', mirror, head[0], head[1], head[2], 0, 0, 0, 0.115, 0.055, 0.09)
        kit.add('glass', glass, head[0], head[1], head[2] + 0.086, 0, 0, 0, 0.092, 0.04, 1)
        kit.beam('trim', [root.x, root.y, root.z], [head[0] - side * 0.06, head[1] - 0.02, head[2]], 0.014, 0.014)
        // The black blade under the sill between the wheels.
        kit.box('trim', 0.09, 0.075, 2.04, side * 0.88, 0.19, 0, 0.015)
        kit.box('trim', 0.05, 0.14, 2.0, side * 0.82, 0.25, 0, 0.012)
    }
    mirror.dispose()
    glass.dispose()

    const scoop = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)
    kit.add('trim', scoop, 0, 1.115, 0.19, 0, 0, 0, 0.19, 0.075, 0.27)
    scoop.dispose()
    kit.box('mesh', 0.26, 0.05, 0.03, 0, 1.15, -0.045, 0.012)

    for (const side of SIDES) {
        // Canards, stacked off the front corner.
        kit.beam('trim', [side * 0.72, 0.21, -2.12], [side * 1.03, 0.27, -1.86], 0.016, 0.1)
        kit.beam('trim', [side * 0.42, 0.19, -2.42], [side * 0.74, 0.19, -2.14], 0.018, 0.09)
        kit.box('trim', 0.022, 0.1, 0.34, side * 0.34, 0.2, -2.32, 0.008)
    }
}

/** A flat piece lying at height `y`, with its outline walked from z0 to z1 along `a` and back along `b`. */
function addPlan(kit: Kit, slot: Slot, y: number, depth: number, z0: number, z1: number, a: (z: number) => number, b: (z: number) => number) {
    const steps = 16
    const zAt = (i: number) => z0 + (z1 - z0) * i / steps
    const outline = new THREE.Shape()
    for (let i = 0; i <= steps; i++) outline[i ? 'lineTo' : 'moveTo'](a(zAt(i)), zAt(i))
    for (let i = steps; i >= 0; i--) outline.lineTo(b(zAt(i)), zAt(i))
    outline.closePath()
    // Laid flat: shape y is the car's z.
    const geo = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false }).rotateX(Math.PI / 2)
    kit.add(slot, geo, 0, y, 0)
    geo.dispose()
}

/** The splitter follows the nose's plan, matte so its flat top doesn't mirror the sky, with a white pinstripe along each leading edge. */
function addSplitter(kit: Kit) {
    const plan = curve([[-2.66, 0.14], [-2.55, 0.34], [-2.4, 0.56], [-2.1, 0.84], [-1.86, 0.97]])
    addPlan(kit, 'rubber', 0.15, 0.035, -2.66, -1.86, plan, z => -plan(z))
    for (const side of SIDES) {
        addPlan(kit, 'white', 0.156, 0.006, -2.6, -2.2, z => side * (plan(z) - 0.015), z => side * (plan(z) - 0.06))
    }
}

/** The rear face: light bar and lamps, plate, diffuser and pipes. */
function addTail(kit: Kit) {
    const z = TAIL_Z
    kit.box('tail', 0.9, 0.018, 0.02, 0, TAIL_Y + 0.04, z + 0.012, 0.008)
    // Open at the back, with a rolled lip and a wall running in, so each tip reads as a hollow pipe.
    const pipe = new THREE.LatheGeometry([
        new THREE.Vector2(0.06, -0.11), new THREE.Vector2(0.06, 0.1), new THREE.Vector2(0.056, 0.11),
        new THREE.Vector2(0.048, 0.11), new THREE.Vector2(0.048, -0.05)
    ], 20).rotateX(Math.PI / 2)
    for (const side of SIDES) {
        // The lamp sits proud of its lens, so the glow isn't dimmed through it.
        kit.box('lens', 0.36, 0.09, 0.03, side * LAMP_X, TAIL_Y - 0.02, z, 0.012)
        kit.box('tail', 0.3, 0.045, 0.02, side * LAMP_X, TAIL_Y - 0.02, z + 0.02, 0.008)
        kit.box('trim', 0.03, 0.14, 0.36, side * 0.24, 0.27, z - 0.12, 0.01)
        kit.box('trim', 0.03, 0.14, 0.36, side * 0.1, 0.27, z - 0.12, 0.01)
        for (const x of PIPE_XS) kit.add('chrome', pipe, side * x, PIPE_Y, z - 0.06)
    }
    pipe.dispose()
    kit.box('trim', 1.28, 0.21, 0.5, 0, 0.275, z - 0.26, 0.03)
    const plate = new THREE.PlaneGeometry(0.52, 0.12)
    kit.add('plate', plate, 0, 0.5, z + 0.012)
    plate.dispose()
    kit.box('trim', 0.58, 0.16, 0.04, 0, 0.5, z - 0.01, 0.015)
}

/** Paint that lays the livery over the car's colour; the map is premultiplied sRGB, so alpha comes off before linearising or edges go dark. */
function liveryPaint(color: number, livery: THREE.Texture) {
    const paint = new THREE.MeshPhysicalMaterial({ color, map: livery, roughness: 0.26, metalness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03 })
    paint.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
            vec4 livery = texture2D( map, vMapUv );
            vec3 ink = livery.a > 0.0 ? sRGBTransferEOTF( vec4( clamp( livery.rgb / livery.a, 0.0, 1.0 ), 1.0 ) ).rgb : vec3( 0.0 );
            diffuseColor.rgb = mix( diffuseColor.rgb, ink, livery.a );
        `)
    }
    return paint
}

export function buildKestrel(color: number): PlayerCar {
    const surface = new BodySurface()
    const livery = liveryTexture(surface)
    const kit = new Kit()
    const skin = buildSkin(surface)
    kit.add('skin', skin)
    skin.dispose()
    const under = buildUnderbody(surface)
    kit.add('trim', under)
    under.dispose()
    const face = buildTailFace(surface)
    kit.add('trim', face)
    face.dispose()
    // The block between the wheel tubs.
    kit.box('trim', TUB_X * 2, 0.3, AXLE_U * 2 + 0.9, 0, 0.3, 0, 0.04)

    addGlasshouse(kit, surface)
    addVents(kit, surface)
    addHeadlights(kit, surface)
    addWing(kit)
    addAero(kit, surface)
    addSplitter(kit)
    addTail(kit)
    return assembleCar({
        kit,
        paint: liveryPaint(color, livery),
        wheel: { r: WHEEL_R, w: WHEEL_W, halfTrack: HALF_TRACK, axles: [-AXLE_U, AXLE_U] },
        flames: SIDES.flatMap(side => PIPE_XS.map(x => new THREE.Vector3(side * x, PIPE_Y, TAIL_Z + 0.06))),
        tailPoints: SIDES.map(side => new THREE.Vector3(side * LAMP_X, TAIL_Y, TAIL_Z + 0.05)),
        owned: [livery]
    })
}
