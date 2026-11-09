import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { assembleCar } from './car-assembly'
import { Kit, modelShared, normalize, SIDES } from './car-kit'
import type { PlayerCar } from './car-models'
import { addBody, addStrip, AXLE_U, NOSE_U, sectionAt, TAIL_U, WHEEL_R } from './car-roadster-body'
import { canvas, finish } from './canvas'

/** The Roadster: a low, faceted wedge with a long glass canopy and a big wing. */

const TAIL_Z = -TAIL_U
const WHEEL_W = 0.32
const HALF_TRACK = 0.82
/** The rear lamps the flames come out of, and where the light trails start. */
const LAMP_XS = [0.13, 0.39]
const LAMP_Y = 0.39
const TRAIL_X = 0.62
const TRAIL_Y = 0.765

/** The nose's full-width light bar, slit headlamps on the bonnet's corners and the lip under it. */
function addNose(kit: Kit) {
    const z = -NOSE_U - 0.004
    const nose = sectionAt(NOSE_U)
    // Follows the leading edge: straight across the middle, then down each corner.
    kit.box('head', nose[3]![0] * 2, 0.024, 0.014, 0, nose[3]![1] - 0.016, z, 0.006)
    for (const side of SIDES) {
        kit.beam('head', [side * nose[3]![0], nose[3]![1] - 0.016, z], [side * nose[4]![0], nose[4]![1] - 0.018, z], 0.024, 0.014)
    }
    // Slim angular slits along the bonnet's outer crease.
    addStrip(kit, 'head', 3, 2.12, 2.47, 0.78, 0.93, 0.005, 4)
    addStrip(kit, 'trim', 3, 2.09, 2.5, 0.72, 0.97, 0.003, 4)
    // A thin black lip tucked in under the nose's lower edge.
    kit.box('rubber', 1.56, 0.022, 0.1, 0, 0.175, -2.45, 0.008)
}

/** Shut lines, the slim B-pillar, side markers and the black side blades. */
function addFlank(kit: Kit) {
    // The door's front and back shut lines.
    for (const u of [0.9, -0.84]) {
        for (const j of [3, 4, 5]) addStrip(kit, 'trim', j, u + 0.006, u - 0.006, 0, 1, 0.003, 1)
    }
    // A thin pillar splits the side glass.
    addStrip(kit, 'paint', 2, -0.28, -0.31, 0, 1, 0.004, 1)
    // An amber marker behind the front wheel, a red one ahead of the rear.
    addStrip(kit, 'caliper', 4, 0.86, 0.78, 0.05, 0.14, 0.004, 1)
    addStrip(kit, 'tail', 5, -0.7, -0.74, 0.55, 0.66, 0.004, 1)
    for (const side of SIDES) {
        // The black blade along the sill between the wheels.
        kit.box('trim', 0.08, 0.05, 1.84, side * 0.85, 0.15, -0.02, 0.012)
    }
}

/** A big body-coloured wing on two short stalks off the tail deck, with soft end plates. */
function addWing(kit: Kit) {
    const chord = 0.56
    const span = 1.84
    const y = 1.07
    // Barely past the tail, or the fit would shrink the car to make room for the wing.
    const z = 2.2
    const foil = new THREE.Shape()
    // Leading edge at +x (forward once turned), blunt; the trailing edge thins out to a lip.
    foil.moveTo(chord / 2, 0)
    foil.lineTo(chord / 2 - 0.05, 0.03)
    foil.lineTo(-chord / 2 + 0.04, 0.026)
    foil.lineTo(-chord / 2, 0.04)
    foil.lineTo(-chord / 2, 0.012)
    foil.lineTo(chord / 2 - 0.08, -0.02)
    foil.closePath()
    const wing = new THREE.ExtrudeGeometry(foil, { depth: span, bevelEnabled: false })
    wing.translate(0, 0, -span / 2)
    wing.rotateY(Math.PI / 2)
    // The trailing edge sits higher, as on a real wing.
    wing.rotateX(-0.06)
    kit.add('paint', wing, 0, y, z)
    wing.dispose()
    // A dark gurney along the trailing edge.
    kit.box('trim', span - 0.02, 0.026, 0.012, 0, y + 0.055, z + chord / 2 - 0.005, 0.004)

    const plate = new THREE.Shape()
    plate.moveTo(0.27, 0.05)
    plate.lineTo(-0.27, 0.08)
    plate.quadraticCurveTo(-0.3, 0.08, -0.3, 0.04)
    plate.lineTo(-0.28, -0.06)
    plate.quadraticCurveTo(-0.27, -0.09, -0.23, -0.09)
    plate.lineTo(0.18, -0.06)
    plate.closePath()
    const plateGeo = new THREE.ExtrudeGeometry(plate, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 4 })
    plateGeo.translate(0, 0, -0.01)
    plateGeo.rotateY(Math.PI / 2)
    for (const side of SIDES) {
        kit.add('paint', plateGeo, side * (span / 2 + 0.01), y, z)
        // Short, slim body-coloured stalks standing on the deck.
        kit.beam('paint', [side * 0.42, 0.84, z - 0.06], [side * 0.44, y - 0.005, z + 0.04], 0.026, 0.11)
    }
    plateGeo.dispose()
}

/** The rear: the red light bar along the tail's top edge, the plate, four round bronze lamps and the recessed diffuser. */
function addTail(kit: Kit) {
    const z = TAIL_Z + 0.004
    // Tall enough to hold a few pixels from the chase camera, in the Kestrel's lamp slot so it blooms like its lamps.
    kit.box('lens', 1.52, 0.056, 0.014, 0, TRAIL_Y, z, 0.006)
    kit.box('tail', 1.48, 0.036, 0.016, 0, TRAIL_Y, z + 0.006, 0.006)
    // The dark lower face, recessed under the painted band and following the tail's taper.
    const panel = new THREE.Shape()
    panel.moveTo(-0.84, 0.6)
    panel.lineTo(0.84, 0.6)
    panel.lineTo(0.73, 0.29)
    panel.lineTo(-0.73, 0.29)
    panel.closePath()
    const panelGeo = new THREE.ExtrudeGeometry(panel, { depth: 0.012, bevelEnabled: false })
    kit.add('trim', panelGeo, 0, 0, z - 0.004)
    panelGeo.dispose()
    const plate = new THREE.PlaneGeometry(0.4, 0.1)
    kit.add('plate', plate, 0, 0.52, z + 0.018)
    plate.dispose()
    // Open at the back, with a rolled lip and a wall running in, so each reads as a hollow pipe.
    const pipe = new THREE.LatheGeometry([
        new THREE.Vector2(0.05, -0.1), new THREE.Vector2(0.05, 0.05), new THREE.Vector2(0.046, 0.06),
        new THREE.Vector2(0.038, 0.06), new THREE.Vector2(0.038, -0.03)
    ], 20).rotateX(Math.PI / 2)
    const glow = new THREE.CircleGeometry(0.038, 20)
    for (const side of SIDES) {
        for (const x of LAMP_XS) {
            kit.add('chrome', pipe, side * x, LAMP_Y, z)
            kit.add('caliper', glow, side * x, LAMP_Y, z + 0.02)
        }
    }
    pipe.dispose()
    glow.dispose()
    // Short diffuser strakes along the panel's foot, tucked in under the car.
    for (const x of [-0.52, -0.26, 0, 0.26, 0.52]) kit.box('trim', 0.022, 0.06, 0.26, x, 0.31, z - 0.11, 0.006)
}

/** Low-profile tyre and a pale aero disc carrying six straight dark spokes in a star; axis along x, outer face at +x. */
function roadsterWheel(r: number, w: number) {
    const hw = w / 2
    const R = r * 0.84
    const tire = new THREE.LatheGeometry([
        new THREE.Vector2(R * 0.98, -hw + 0.01), new THREE.Vector2(r * 0.93, -hw), new THREE.Vector2(r * 0.99, -hw + w * 0.1),
        new THREE.Vector2(r, -hw + w * 0.24), new THREE.Vector2(r, hw - w * 0.24), new THREE.Vector2(r * 0.99, hw - w * 0.1),
        new THREE.Vector2(r * 0.93, hw), new THREE.Vector2(R * 0.98, hw - 0.01)
    ], 48).rotateZ(-Math.PI / 2)
    // A shallow pale dish set in behind the dark rim lip, walked from the rim in so it faces out of the wheel.
    const face = new THREE.LatheGeometry([
        new THREE.Vector2(R * 0.97, hw - 0.012), new THREE.Vector2(R * 0.3, hw - 0.03), new THREE.Vector2(0.001, hw - 0.035)
    ], 48).rotateZ(-Math.PI / 2)
    const dark: THREE.BufferGeometry[] = []
    const lip = new THREE.LatheGeometry([
        new THREE.Vector2(R * 0.94, hw - 0.03), new THREE.Vector2(R * 1.01, hw - 0.02), new THREE.Vector2(R * 1.0, hw),
        new THREE.Vector2(R * 0.95, hw - 0.002), new THREE.Vector2(R * 0.94, hw - 0.03)
    ], 48).rotateZ(-Math.PI / 2)
    dark.push(normalize(lip))
    lip.dispose()
    const hub = new THREE.CylinderGeometry(R * 0.16, R * 0.19, 0.045, 6).rotateZ(Math.PI / 2).translate(hw - 0.02, 0, 0)
    dark.push(normalize(hub))
    hub.dispose()
    // Six straight spokes, tapering a little from the hub out to the rim's edge.
    const blade = new THREE.Shape()
    blade.moveTo(-0.028, R * 0.12)
    blade.lineTo(-0.019, R * 0.98)
    blade.lineTo(0.019, R * 0.98)
    blade.lineTo(0.028, R * 0.12)
    blade.closePath()
    for (let i = 0; i < 6; i++) {
        const spoke = new THREE.ExtrudeGeometry(blade, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 1 })
        spoke.rotateY(Math.PI / 2)
        spoke.rotateX(i / 6 * Math.PI * 2)
        spoke.translate(hw - 0.05, 0, 0)
        dark.push(normalize(spoke))
        spoke.dispose()
    }
    const spokes = mergeGeometries(dark, false)!
    for (const g of dark) g.dispose()
    return { tire: normalize(tire), face: normalize(face), spokes }
}

/** The plate: dark letters on white, backlit at night. */
function roadsterPlate() {
    const [c, ctx] = canvas(440, 110)
    ctx.fillStyle = '#e9e9e4'
    ctx.beginPath()
    ctx.roundRect(4, 4, 432, 102, 10)
    ctx.fill()
    ctx.strokeStyle = '#1a1a1c'
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.fillStyle = '#16161a'
    ctx.font = '600 70px "DIN Alternate", "Bahnschrift", "Arial Narrow", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('RDSTR', 220, 58)
    return finish(c)
}

export function buildRoadster(color: number): PlayerCar {
    const s = modelShared()
    // Satin pearl that takes the player's colour.
    const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1, sheen: 0.4, sheenRoughness: 0.5, sheenColor: 0xffffff })
    // Dark, warm smoked-bronze canopy glass: it reflects weakly and tints what it does reflect, so it stays dark at a glancing angle.
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x140b05, roughness: 0.1, metalness: 0.3, envMapIntensity: 0.6, specularColor: 0xc8864a, specularIntensity: 0.6 })
    // The wheels' pale aero discs.
    const face = new THREE.MeshStandardMaterial({ color: 0xc4c6ca, roughness: 0.32, metalness: 0.45 })
    const bronze = new THREE.MeshStandardMaterial({ color: 0xb07a3a, roughness: 0.3, metalness: 1 })
    const amber = new THREE.MeshStandardMaterial({ color: 0x4a2a08, emissive: 0xffa040, emissiveIntensity: 2.6, roughness: 0.3 })
    const plateMap = roadsterPlate()
    const plate = new THREE.MeshStandardMaterial({ map: plateMap, emissiveMap: plateMap, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.45 })

    const kit = new Kit()
    addBody(kit)
    addNose(kit)
    addFlank(kit)
    addWing(kit)
    addTail(kit)

    const wheel = roadsterWheel(WHEEL_R, WHEEL_W)
    return assembleCar({
        kit,
        paint,
        // The kit's slots are buckets here: the pipes go in `chrome` and the amber lamps in `caliper`.
        materials: { glass, chrome: bronze, caliper: amber, plate },
        wheel: {
            r: WHEEL_R,
            w: WHEEL_W,
            halfTrack: HALF_TRACK,
            axles: [-AXLE_U, AXLE_U],
            parts: () => [new THREE.Mesh(wheel.tire, s.slots.rubber), new THREE.Mesh(wheel.face, face), new THREE.Mesh(wheel.spokes, s.slots.rim)]
        },
        flames: SIDES.flatMap(side => LAMP_XS.map(x => new THREE.Vector3(side * x, LAMP_Y, TAIL_Z + 0.06))),
        flame: { r: 0.065, length: 1 },
        tailPoints: SIDES.map(side => new THREE.Vector3(side * TRAIL_X, TRAIL_Y, TAIL_Z + 0.03)),
        owned: [glass, face, bronze, amber, plateMap, plate, wheel.tire, wheel.face, wheel.spokes]
    })
}
