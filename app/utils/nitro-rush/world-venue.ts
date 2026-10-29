import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { BILLBOARD_ADS, bannerTexture, billboardTexture } from './signs'
import { radialTexture } from './textures'
import { roadAbove, WALL_BASE_HALF } from './road-geometry'
import type { WorldKit } from './world-kit'
import { MIN_CLEARANCE } from '#shared/utils/nitro-rush/layout'
import { headingOf } from '#shared/utils/nitro-rush/track'

/** The race venue round the road: floodlights, gantries, the grandstand and billboards. */

const LAMP_SPACING = 34
const START_LIGHTS = 5
/** Floodlight pole height; a pole with road above it inside this is left out. */
export const LAMP_HEIGHT = 11.5

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

/** Gantries over the line: posts, beam, banners, and on the start one the five lights. */
export function buildGantries({ track, group, own }: WorldKit, steel: THREE.Material) {
    const wall = track.wallOffset
    const startLights: THREE.MeshStandardMaterial[] = []
    const postGeo = own(new THREE.BoxGeometry(0.6, 9, 0.6).translate(0, 4.5, 0))
    const beamGeo = own(new THREE.BoxGeometry((wall + 1.2) * 2 + 0.6, 2.6, 0.8))
    const bannerGeo = own(new THREE.PlaneGeometry(10, 2.5))
    const lightGeo = own(new THREE.CylinderGeometry(0.32, 0.32, 0.15, 20).rotateX(Math.PI / 2))
    const name = track.def.name.toUpperCase()
    const buildGantry = (at: number, sub: string, lights: boolean) => {
        const p = track.pointAt(at)
        const g = new THREE.Group()
        g.position.set(p.x, p.y, p.z)
        g.rotation.y = headingOf(p.tx, p.tz)
        for (const side of [-1, 1]) {
            const post = new THREE.Mesh(postGeo, steel)
            post.position.x = side * (wall + 1.2)
            g.add(post)
        }
        const beam = new THREE.Mesh(beamGeo, steel)
        beam.position.y = 8.2
        g.add(beam)
        const banner = own(bannerTexture('NITRO RUSH', `${name} · ${sub}`))
        const bannerMat = own(new THREE.MeshStandardMaterial({ map: banner, emissiveMap: banner, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.5 }))
        for (const face of [1, -1]) {
            const b = new THREE.Mesh(bannerGeo, bannerMat)
            b.position.set(face * (lights ? -3.5 : 0), 8.2, face * 0.41)
            if (face < 0) b.rotation.y = Math.PI
            g.add(b)
        }
        if (lights) {
            for (let i = 0; i < START_LIGHTS; i++) {
                const mat = own(new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff1a1a, emissiveIntensity: 0 }))
                startLights.push(mat)
                const l = new THREE.Mesh(lightGeo, mat)
                l.position.set(3 + i * 0.95, 8.2, 0.45)
                g.add(l)
            }
        }
        group.add(g)
        return g
    }
    const gantry = buildGantry(track.startS, track.closed ? 'START / FINISH' : 'START', true)
    if (!track.closed) buildGantry(track.finishS, 'FINISH', false)
    for (const at of track.checkpoints) buildGantry(at, 'CHECKPOINT', false)
    return { start: gantry, startLights }
}

/** A grandstand with a crowd beside `start`; returns a test for ground it covers, to keep the city off it. */
export function buildGrandstand({ track, group, own }: WorldKit, start: THREE.Object3D, concrete: THREE.Texture, steel: THREE.Material) {
    const wall = track.wallOffset
    const stand = new THREE.Group()
    stand.position.copy(start.position)
    stand.rotation.y = start.rotation.y
    const standLen = 220
    // On a sprint it runs from just behind the start line forward, never out past the start barrier.
    if (!track.closed) stand.translateZ(-(standLen / 2 - track.startS + 6))
    const rows = 10
    const standMat = own(new THREE.MeshStandardMaterial({ map: concrete, color: 0x7a7874, roughness: 0.9 }))
    const stepGeos: THREE.BufferGeometry[] = []
    for (let r = 0; r < rows; r++) {
        const h = 1.2 + r * 0.6
        stepGeos.push(new THREE.BoxGeometry(1.2, h, standLen).translate(wall + 5 + r * 1.2, h / 2, 0))
    }
    stand.add(new THREE.Mesh(own(mergeGeometries(stepGeos)!), standMat))
    for (const g of stepGeos) g.dispose()
    const crowd = new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.42, 0.75, 0.32)), own(new THREE.MeshStandardMaterial({ roughness: 0.8 })), rows * Math.floor(standLen / 0.75))
    own(crowd)
    const shirts = [0xff2bd6, 0x3df2ff, 0xffd23d, 0xffffff, 0x2a2a30, 0xff5a3a, 0x5b8cff, 0xa6ff4d]
    const c = new THREE.Color()
    const dummy = new THREE.Object3D()
    let ci = 0
    for (let r = 0; r < rows; r++) {
        for (let z = -standLen / 2 + 0.5; z < standLen / 2 - 0.5 && ci < crowd.count; z += 0.75) {
            if (Math.random() < 0.18) continue
            dummy.position.set(wall + 5 + r * 1.2 + (Math.random() - 0.5) * 0.3, 1.2 + r * 0.6 + 0.37, z + (Math.random() - 0.5) * 0.2)
            dummy.rotation.set(0, (Math.random() - 0.5) * 0.4, 0)
            dummy.updateMatrix()
            crowd.setMatrixAt(ci, dummy.matrix)
            crowd.setColorAt(ci, c.setHex(shirts[Math.floor(Math.random() * shirts.length)]!).multiplyScalar(0.6 + Math.random() * 0.4))
            ci++
        }
    }
    crowd.count = ci
    stand.add(crowd)
    const roof = new THREE.Mesh(own(new THREE.BoxGeometry(rows * 1.2 + 6, 0.4, standLen)), steel)
    roof.position.set(wall + 4 + rows * 0.6, 14, 0)
    roof.rotation.z = -0.08
    const roofLight = new THREE.Mesh(own(new THREE.BoxGeometry(0.2, 0.08, standLen - 4)), own(new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2dc, emissiveIntensity: 3 })))
    roofLight.position.set(wall + 4, 13.4, 0)
    stand.add(roof, roofLight)
    const colGeo = own(new THREE.CylinderGeometry(0.25, 0.25, 14, 8).translate(0, 7, 0))
    for (let z = -standLen / 2 + 10; z <= standLen / 2 - 10; z += 25) {
        const col = new THREE.Mesh(colGeo, steel)
        col.position.set(wall + 5 + rows * 1.2, 0, z)
        stand.add(col)
    }
    group.add(stand)
    const standBox = { x: wall + 3, len: standLen / 2 + 6 }
    const toStand = new THREE.Matrix4().makeRotationY(stand.rotation.y).setPosition(stand.position).invert()
    const local = new THREE.Vector3()
    return (x: number, z: number) => {
        local.set(x, 0, z).applyMatrix4(toStand)
        return local.x > 0 && local.x < standBox.x + 40 && Math.abs(local.z) < standBox.len + 20
    }
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
