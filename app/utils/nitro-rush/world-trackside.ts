import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { adDeck, TRACK_ADS, type AdDeck } from './ads'
import type { Roof } from './city'
import { CLEAR_HEIGHT } from './road-geometry'
import { billboardTexture, cornerSignTexture, flagTexture, stripTexture } from './signs'
import {
    BILLBOARD_BOTTOM, BILLBOARD_HEIGHT, BILLBOARD_WIDTH, CHEVRON_HEIGHT, CHEVRON_LIFT, CHEVRON_WIDTH, FLAG_HEIGHT, FLAG_POLE, FLAG_WIDTH,
    HOARDING_HEIGHT, HOARDING_LENGTH, OVERHEAD_BANNER, OVERHEAD_BEAM, tracksideLayout, type Billboard, type Chevron, type Fixture, type Overhead
} from './trackside-spots'
import type { WorldKit } from './world-kit'
import { newProjection, WALL_BASE_HALF, WALL_HEIGHT } from '#shared/utils/nitro-rush/track'

/** The signage round the road, built from the spots trackside-spots picks: ads in every format and the corner chevrons. */

type AdFormat = 'board' | 'strip' | 'flag'
type AdMaterial = (format: AdFormat, ad: number) => THREE.MeshStandardMaterial

const PAINTERS = { board: billboardTexture, strip: stripTexture, flag: flagTexture } as const
/** A strip is eight times as wide as it is tall. */
const STRIP_ASPECT = 8
const ROOF_BOARD_WIDTH = 12

const glowing = (map: THREE.Texture, intensity: number) => new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: intensity, roughness: 0.5 })

/** Ad materials painted on first use, so a course pays only for the ads it shows. */
function adMaterials(own: WorldKit['own']): AdMaterial {
    const cache = new Map<string, THREE.MeshStandardMaterial>()
    return (format, ad) => {
        const key = `${format}:${ad}`
        let m = cache.get(key)
        if (!m) {
            const t = own(PAINTERS[format](TRACK_ADS[ad]!))
            if (format === 'strip') t.wrapS = THREE.RepeatWrapping
            // Strips pass right by the camera, where a full glow blooms out.
            cache.set(key, m = own(glowing(t, format === 'strip' ? 1.1 : 1.5)))
        }
        return m
    }
}

const v3 = new THREE.Vector3()
const v3b = new THREE.Vector3()
const v3c = new THREE.Vector3()

/** The fixture's frame as a matrix: its x across the road, y up off it, z back toward the oncoming cars. */
function fixtureMatrix(f: Fixture, out = new THREE.Matrix4()) {
    return out.makeBasis(v3.set(...f.right), v3b.set(...f.up), v3c.set(...f.back)).setPosition(f.x, f.y, f.z)
}

/** Fills one instanced mesh per key from a list of matrices. */
function instancedByKey<K>({ instanced }: WorldKit, groups: Map<K, THREE.Matrix4[]>, make: (key: K) => [THREE.BufferGeometry, THREE.Material | THREE.Material[]]) {
    for (const [key, matrices] of groups) {
        const [geo, mat] = make(key)
        const mesh = instanced(geo, mat as THREE.Material, matrices.length)
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
    }
}

function push<K>(groups: Map<K, THREE.Matrix4[]>, key: K, m: THREE.Matrix4) {
    const list = groups.get(key)
    if (list) list.push(m)
    else groups.set(key, [m])
}

/** Boards on two legs beside the road, their feet on the ground even beside a raised road. */
function buildBillboards({ group, own }: WorldKit, boards: readonly Billboard[], steel: THREE.Material, ad: AdMaterial, deck: AdDeck) {
    const boardGeo = own(new THREE.PlaneGeometry(BILLBOARD_WIDTH, BILLBOARD_HEIGHT))
    const backGeo = own(new THREE.BoxGeometry(BILLBOARD_WIDTH + 0.2, BILLBOARD_HEIGHT + 0.2, 0.25))
    const legGeo = own(new THREE.BoxGeometry(0.3, 1, 0.3).translate(0, 0.5, 0))
    for (const b of boards) {
        const g = new THREE.Group()
        const ground = Math.min(0, b.base)
        g.position.set(b.x, ground, b.z)
        g.rotation.y = b.heading
        const mid = b.base - ground + BILLBOARD_BOTTOM + BILLBOARD_HEIGHT / 2
        const face = new THREE.Mesh(boardGeo, ad('board', deck()))
        face.position.set(0, mid, 0.14)
        const back = new THREE.Mesh(backGeo, steel)
        back.position.y = mid
        g.add(face, back)
        for (const x of [-BILLBOARD_WIDTH / 3, BILLBOARD_WIDTH / 3]) {
            const leg = new THREE.Mesh(legGeo, steel)
            leg.position.set(x, 0, -0.25)
            leg.scale.y = mid
            g.add(leg)
        }
        group.add(g)
    }
}

/** Boards on low roofs near the course, turned to face the nearest road. */
function buildRoofBoards({ track, group, own }: WorldKit, roofs: readonly Roof[], steel: THREE.Material, ad: AdMaterial, deck: AdDeck) {
    const h = ROOF_BOARD_WIDTH / 2
    const boardGeo = own(new THREE.PlaneGeometry(ROOF_BOARD_WIDTH, h))
    const backGeo = own(new THREE.BoxGeometry(ROOF_BOARD_WIDTH + 0.3, h + 0.3, 0.3))
    const legGeo = own(new THREE.BoxGeometry(0.35, 1.6, 0.35).translate(0, 0.8, 0))
    const p = newProjection()
    // Every other roof, so the skyline isn't all ads.
    roofs.forEach((roof, i) => {
        if (i % 2) return
        let best = Infinity
        let to: [number, number] = [0, 0]
        for (const line of track.branches) {
            line.projectAll(roof.x, roof.z, p)
            const q = line.pointAt(line.wrapS(p.s))
            const d = Math.hypot(q.x - roof.x, q.z - roof.z)
            if (d < best) {
                best = d
                to = [q.x - roof.x, q.z - roof.z]
            }
        }
        const g = new THREE.Group()
        g.position.set(roof.x, roof.h, roof.z)
        g.rotation.y = Math.atan2(to[0], to[1])
        const face = new THREE.Mesh(boardGeo, ad('board', deck()))
        face.position.set(0, 1.6 + h / 2, 0.16)
        const back = new THREE.Mesh(backGeo, steel)
        back.position.y = 1.6 + h / 2
        g.add(face, back)
        for (const x of [-ROOF_BOARD_WIDTH / 3, ROOF_BOARD_WIDTH / 3]) {
            const leg = new THREE.Mesh(legGeo, steel)
            leg.position.x = x
            g.add(leg)
        }
        group.add(g)
    })
}

/** Ad panels standing on the walls, one ad to a bay; printed on both faces. */
function buildHoardings(kit: WorldKit, bays: readonly Fixture[][], steel: THREE.Material, ad: AdMaterial, deck: AdDeck) {
    const groups = new Map<number, THREE.Matrix4[]>()
    for (const bay of bays) {
        const pick = deck()
        for (const f of bay) push(groups, pick, fixtureMatrix(f))
    }
    const geo = new THREE.BoxGeometry(0.08, HOARDING_HEIGHT, HOARDING_LENGTH).translate(0, HOARDING_HEIGHT / 2, 0)
    // Faces: across the road both ways carry the ad, the edges are steel.
    instancedByKey(kit, groups, pick => [geo.clone(), [ad('strip', pick), ad('strip', pick), steel, steel, steel, steel]])
    geo.dispose()
}

/** A post on each wall and a beam across, with a banner hung under it on both faces. */
function buildOverheads({ group, own }: WorldKit, overheads: readonly Overhead[], steel: THREE.Material, ad: AdMaterial, deck: AdDeck) {
    const top = CLEAR_HEIGHT - OVERHEAD_BEAM
    const postGeo = own(new THREE.BoxGeometry(0.3, top - WALL_HEIGHT, 0.3).translate(0, (top + WALL_HEIGHT) / 2, 0))
    for (const o of overheads) {
        const g = new THREE.Group()
        g.matrixAutoUpdate = false
        fixtureMatrix(o, g.matrix)
        const reach = o.wall + WALL_BASE_HALF
        for (const side of [-1, 1]) {
            const post = new THREE.Mesh(postGeo, steel)
            post.position.x = side * reach
            g.add(post)
        }
        const beam = new THREE.Mesh(own(new THREE.BoxGeometry(reach * 2 + 0.3, OVERHEAD_BEAM, 0.3)), steel)
        beam.position.y = CLEAR_HEIGHT - OVERHEAD_BEAM / 2
        g.add(beam)
        const width = o.wall * 2 - 0.2
        const bannerGeo = own(new THREE.PlaneGeometry(width, OVERHEAD_BANNER))
        const uv = bannerGeo.getAttribute('uv')
        const copies = Math.max(1, Math.round(width / (OVERHEAD_BANNER * STRIP_ASPECT)))
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * copies)
        const mat = ad('strip', deck())
        for (const face of [1, -1]) {
            const b = new THREE.Mesh(bannerGeo, mat)
            b.position.set(0, top - OVERHEAD_BANNER / 2, face * 0.02)
            if (face < 0) b.rotation.y = Math.PI
            g.add(b)
        }
        group.add(g)
    }
}

/** Feather flags on the walls, a cluster to an ad, the cloth flying out over the wall's back. */
function buildFlags(kit: WorldKit, clusters: readonly Fixture[][], steel: THREE.Material, ad: AdMaterial, deck: AdDeck) {
    const count = clusters.reduce((n, c) => n + c.length, 0)
    if (!count) return
    const poles = kit.instanced(new THREE.CylinderGeometry(0.035, 0.05, FLAG_POLE, 6).translate(0, FLAG_POLE / 2, 0), steel, count)
    // A shallow bow, printed both faces; the back face is the front turned round, so it reads the right way too.
    const cloth = new THREE.PlaneGeometry(FLAG_WIDTH, FLAG_HEIGHT, 4, 1)
    const pos = cloth.getAttribute('position')
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) / FLAG_WIDTH + 0.5) * Math.PI) * 0.08)
    cloth.translate(FLAG_WIDTH / 2 + 0.05, FLAG_POLE - FLAG_HEIGHT / 2 - 0.1, 0)
    const back = cloth.clone().rotateY(Math.PI).translate(FLAG_WIDTH + 0.1, 0, 0)
    const geo = mergeGeometries([cloth, back])!
    cloth.dispose()
    back.dispose()
    const turn = new THREE.Matrix4().makeRotationY(Math.PI)
    const groups = new Map<number, THREE.Matrix4[]>()
    let i = 0
    for (const cluster of clusters) {
        const pick = deck()
        for (const f of cluster) {
            const m = fixtureMatrix(f)
            poles.setMatrixAt(i++, m)
            // Out over the wall's back: the right wall's back is +x, the left wall's is behind the turned-round cloth.
            push(groups, pick, f.side > 0 ? m : m.clone().multiply(turn))
        }
    }
    instancedByKey(kit, groups, pick => [geo.clone(), ad('flag', pick)])
    geo.dispose()
}

/** The corner boards, on posts on the outside wall, each grade in its colour and pointing the way the bend turns. */
function buildChevrons(kit: WorldKit, chevrons: readonly Chevron[], steel: THREE.Material) {
    if (!chevrons.length) return
    const { own } = kit
    const faceY = CHEVRON_LIFT + CHEVRON_HEIGHT / 2
    const face = new THREE.PlaneGeometry(CHEVRON_WIDTH, CHEVRON_HEIGHT).translate(0, faceY, 0.031)
    // A bend to the left (its outside wall on the right) reads the board the other way round.
    const flipped = face.clone()
    const uv = flipped.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i))
    const back = own(new THREE.MeshStandardMaterial({ color: 0x121216, roughness: 0.7 }))
    const backs = kit.instanced(new THREE.BoxGeometry(CHEVRON_WIDTH + 0.08, CHEVRON_HEIGHT + 0.08, 0.06).translate(0, faceY, 0), back, chevrons.length)
    const posts = kit.instanced(new THREE.BoxGeometry(0.08, CHEVRON_LIFT, 0.08).translate(0, CHEVRON_LIFT / 2, 0), steel, chevrons.length)
    const mats = ([1, 2, 3] as const).map(n => own(glowing(own(cornerSignTexture(n)), 1.4)))
    const groups = new Map<string, THREE.Matrix4[]>()
    chevrons.forEach((c, i) => {
        const m = fixtureMatrix(c)
        backs.setMatrixAt(i, m)
        posts.setMatrixAt(i, m)
        push(groups, `${c.grade}:${c.side > 0 ? 1 : 0}`, m)
    })
    instancedByKey(kit, groups, (key) => {
        const [grade, flip] = key.split(':').map(Number) as [number, number]
        return [(flip ? flipped : face).clone(), mats[grade - 1]!]
    })
    face.dispose()
    flipped.dispose()
}

/** Every ad and sign round the course; `roofs` are the city's low roofs near it. */
export function buildSignage(kit: WorldKit, steel: THREE.Material, roofs: readonly Roof[]) {
    const layout = tracksideLayout(kit.track)
    const ad = adMaterials(kit.own)
    const deck = adDeck()
    buildBillboards(kit, layout.billboards, steel, ad, deck)
    buildHoardings(kit, layout.hoardings, steel, ad, deck)
    buildOverheads(kit, layout.overheads, steel, ad, deck)
    buildFlags(kit, layout.flags, steel, ad, deck)
    buildRoofBoards(kit, roofs, steel, ad, deck)
    buildChevrons(kit, layout.chevrons, steel)
}
