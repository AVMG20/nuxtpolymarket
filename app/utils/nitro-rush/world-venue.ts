import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { BILLBOARD_ADS, bannerTexture, billboardTexture } from './signs'
import { NEON_PINK } from './config'
import { radialTexture } from './textures'
import { DECK_DEPTH, roadAbove, WALL_BASE_HALF } from './road-geometry'
import type { WorldKit } from './world-kit'
import { MIN_CLEARANCE } from '#shared/utils/nitro-rush/layout'
import { headingOf } from '#shared/utils/nitro-rush/track'

/** The race venue round the road: floodlights, the arches over the lines and billboards. */

const LAMP_SPACING = 34
const START_LIGHTS = 5
/** Floodlight pole height; a pole with road above it inside this is left out. */
export const LAMP_HEIGHT = 11.5
const ARCH_TUBE = 0.35
/** The arch's crown, kept under a bridge's deck at the closest a road may pass over, so any road can cross a line. */
const ARCH_HEIGHT = MIN_CLEARANCE - DECK_DEPTH - ARCH_TUBE - 0.15
const BANNER_WIDTH = 3.6
const BOARD_HEIGHT = BANNER_WIDTH / 4 + 0.2
/** The banner board hangs flush under the crown, its bottom still clear of the chase camera. */
const BANNER_Y = ARCH_HEIGHT - ARCH_TUBE - BOARD_HEIGHT / 2
const LIGHT_SPACING = 0.9
/** The start lights' panel, across the front of the crown just over the banner. */
const LIGHTS_Y = ARCH_HEIGHT - 0.05
const LIGHTS_Z = ARCH_TUBE + 0.1

/** Floodlights on the walls, arms out over the track; returns their lens and pool materials and head positions. */
export function buildLamps({ track, own, instanced }: WorldKit) {
    const wall = track.wallOffset
    const L = track.length
    const heads: THREE.Vector3[] = []
    const lampCount = Math.floor(L / LAMP_SPACING)
    const n = lampCount * 2
    const metal = own(new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.45, metalness: 0.8 }))
    const lens = own(new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd2a0, emissiveIntensity: 4 }))
    const poolMat = own(new THREE.MeshBasicMaterial({
        map: own(radialTexture()), color: 0xffd2a0, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false
    }))
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material) => instanced(geo, mat, n)
    const lamps = [
        inst(new THREE.CylinderGeometry(0.08, 0.14, 11, 10).translate(0, 5.5, 0), metal),
        inst(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8).rotateZ(Math.PI / 2).translate(-1.55, 10.8, 0), metal),
        inst(new RoundedBoxGeometry(1.3, 0.22, 0.5, 2, 0.08).translate(-3.0, 10.75, 0), metal),
        inst(new THREE.BoxGeometry(1.1, 0.04, 0.34).translate(-3.0, 10.62, 0), lens)
    ]
    const pool = inst(new THREE.PlaneGeometry(11, 16).rotateX(-Math.PI / 2).translate(-3.6, 0.03, 0), poolMat)
    pool.renderOrder = 1
    const dummy = new THREE.Object3D()
    let li = 0
    for (let k = 0; k < lampCount; k++) {
        for (const side of [-1, 1]) {
            const s = (k + (side > 0 ? 0.5 : 0)) * LAMP_SPACING
            const p = track.pointAt(s)
            const lat = side * (wall + WALL_BASE_HALF)
            // A lamp stands on a plain wall, not on a looping, a corkscrew, a bank or over a gap.
            if (!track.plainRoadAt(s)) continue
            // Under another level the pole would run through its deck.
            if (track.elevated && roadAbove(track, p.x, p.y, p.z, wall + 6, MIN_CLEARANCE / 2, LAMP_HEIGHT + 2)) continue
            // Local -x is the arm; turn it to point across the track.
            const inX = p.tz * side
            const inZ = -p.tx * side
            dummy.position.set(p.x - p.tz * lat, p.y + 0.86, p.z + p.tx * lat)
            dummy.rotation.set(0, Math.atan2(inZ, -inX), 0)
            dummy.updateMatrix()
            for (const m of lamps) m.setMatrixAt(li, dummy.matrix)
            heads.push(new THREE.Vector3(dummy.position.x + inX * 3, p.y + LAMP_HEIGHT, dummy.position.z + inZ * 3))
            // The light pool lies on the road, tipped to its slope.
            dummy.position.y = p.y
            dummy.rotation.set(Math.atan(side * p.grade), Math.atan2(inZ, -inX), 0, 'YXZ')
            dummy.updateMatrix()
            pool.setMatrixAt(li, dummy.matrix)
            li++
        }
    }
    for (const m of [...lamps, pool]) m.count = li
    return { lens, poolMat, heads }
}

/** A low arch over each line, from foot to foot outside the walls, with a banner under its crown; the start one carries the five lights, which it returns. */
export function buildGantries({ track, group, own }: WorldKit, steel: THREE.Material) {
    const span = track.wallOffset + 1.2
    const startLights: THREE.MeshStandardMaterial[] = []
    const archAt = (t: number) => new THREE.Vector3(Math.cos(t) * span, Math.sin(t) * ARCH_HEIGHT, 0)
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 25 }, (_, i) => archAt(Math.PI * i / 24)))
    const archGeo = own(new THREE.TubeGeometry(curve, 64, ARCH_TUBE, 10))
    const neonGeo = own(new THREE.TubeGeometry(curve, 64, 0.07, 6))
    const neonMat = own(new THREE.MeshBasicMaterial({ color: NEON_PINK }))
    const boardGeo = own(new THREE.BoxGeometry(BANNER_WIDTH + 0.2, BOARD_HEIGHT, 0.6))
    const bannerGeo = own(new THREE.PlaneGeometry(BANNER_WIDTH, BANNER_WIDTH / 4))
    const lightGeo = own(new THREE.CylinderGeometry(0.3, 0.3, 0.15, 20).rotateX(Math.PI / 2))
    const panelGeo = own(new THREE.BoxGeometry(START_LIGHTS * LIGHT_SPACING + 0.3, 0.8, 0.2))
    const panelMat = own(new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.6, metalness: 0.4 }))
    const name = track.def.name.toUpperCase()
    const buildGantry = (at: number, sub: string, lights: boolean) => {
        const p = track.pointAt(at)
        const g = new THREE.Group()
        g.position.set(p.x, p.y, p.z)
        g.rotation.y = headingOf(p.tx, p.tz)
        g.add(new THREE.Mesh(archGeo, steel))
        for (const face of [1, -1]) {
            const neon = new THREE.Mesh(neonGeo, neonMat)
            neon.position.z = face * ARCH_TUBE
            g.add(neon)
        }
        const board = new THREE.Mesh(boardGeo, steel)
        board.position.y = BANNER_Y
        g.add(board)
        const banner = own(bannerTexture('NITRO RUSH', `${name} · ${sub}`))
        const bannerMat = own(new THREE.MeshStandardMaterial({ map: banner, emissiveMap: banner, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.5 }))
        for (const face of [1, -1]) {
            const b = new THREE.Mesh(bannerGeo, bannerMat)
            b.position.set(0, BANNER_Y, face * 0.31)
            if (face < 0) b.rotation.y = Math.PI
            g.add(b)
        }
        if (lights) {
            // Centred over the banner, facing the grid, as on a race gantry.
            const panel = new THREE.Mesh(panelGeo, panelMat)
            panel.position.set(0, LIGHTS_Y, LIGHTS_Z)
            g.add(panel)
            for (let i = 0; i < START_LIGHTS; i++) {
                const mat = own(new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff1a1a, emissiveIntensity: 0 }))
                startLights.push(mat)
                const l = new THREE.Mesh(lightGeo, mat)
                l.position.set((i - (START_LIGHTS - 1) / 2) * LIGHT_SPACING, LIGHTS_Y, LIGHTS_Z + 0.12)
                g.add(l)
            }
        }
        group.add(g)
    }
    buildGantry(track.startS, track.closed ? 'START / FINISH' : 'START', true)
    if (!track.closed) buildGantry(track.finishS, 'FINISH', false)
    for (const at of track.checkpoints) buildGantry(at, 'CHECKPOINT', false)
    return startLights
}

/** Billboards round the infield, facing the track. */
export function buildBillboards({ track, group, own }: WorldKit, steel: THREE.Material) {
    const wall = track.wallOffset
    const L = track.length
    const boardMats = BILLBOARD_ADS.map((_, i) => {
        const t = own(billboardTexture(i))
        return own(new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.5 }))
    })
    const boardGeo = own(new THREE.PlaneGeometry(16, 8))
    const legGeo = own(new THREE.BoxGeometry(0.3, 6, 0.3).translate(0, 3, 0))
    for (let i = 0; i < 8; i++) {
        const s = (i + 0.25) / 8 * L
        const p = track.pointAt(s)
        if (!track.plainRoadAt(s)) continue
        const lat = -(wall + 14)
        const bx = p.x - p.tz * lat
        const bz = p.z + p.tx * lat
        // Not where another stretch of road runs close by, or over it.
        if (track.elevated && Math.abs(track.project(bx, bz).lateral) < wall + 9) continue
        const g = new THREE.Group()
        g.position.set(bx, 0, bz)
        // Face the oncoming cars, angled a little toward the track.
        g.rotation.y = headingOf(p.tx, p.tz) + 0.5
        const b = new THREE.Mesh(boardGeo, boardMats[i % boardMats.length]!)
        b.position.y = 9
        g.add(b)
        for (const x of [-5, 5]) {
            const leg = new THREE.Mesh(legGeo, steel)
            leg.position.x = x
            g.add(leg)
        }
        group.add(g)
    }
}
