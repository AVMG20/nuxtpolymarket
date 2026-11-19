import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { bannerTexture } from './signs'
import { LAMP_SPACING, lampSlot } from './trackside-spots'
import { LINE_COLORS, NEON_PINK } from './config'
import { radialTexture } from './textures'
import { CLEAR_HEIGHT, fieldClearance, roadAbove, roadLevelWith } from './road-geometry'
import type { WorldKit } from './world-kit'
import { GATE_SPAN } from '#shared/utils/nitro-rush/field'
import { MIN_CLEARANCE } from '#shared/utils/nitro-rush/layout'
import { headingOf, WALL_BASE_HALF, type LapLine } from '#shared/utils/nitro-rush/track'

/** The race venue round the road: floodlights and the arches over the lines. */

const START_LIGHTS = 5
/** Floodlight pole height; a pole with road above it inside this is left out. */
export const LAMP_HEIGHT = 11.5
const ARCH_TUBE = 0.35
/** The arch's crown, its tube's top kept within the road's clearance so any road can cross a line. */
const ARCH_HEIGHT = CLEAR_HEIGHT - ARCH_TUBE
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
    const heads: THREE.Vector3[] = []
    const lines = track.branches
    const elevated = track.anyElevated
    const n = lines.reduce((sum, line) => sum + Math.floor(line.length / LAMP_SPACING) * 2, 0)
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
    for (const line of lines) {
        const others = lines.filter(l => l !== line)
        for (let k = 0; k < Math.floor(line.length / LAMP_SPACING); k++) {
            for (const side of [-1, 1] as const) {
                const s = lampSlot(k, side)
                const p = line.pointAt(s)
                const lat = side * (line.wallAt(s) + WALL_BASE_HALF)
                // A lamp stands on a plain wall, not on a looping, a corkscrew, a bank, over a gap or where the side is open onto another road.
                if (!line.walledRoadAt(s) || line.openAt(s, side)) continue
                // Under another level the pole would run through its deck.
                if (elevated && roadAbove(lines, p.x, p.y, p.z, 6, MIN_CLEARANCE / 2, LAMP_HEIGHT + 2)) continue
                const px = p.x - p.tz * lat
                const pz = p.z + p.tx * lat
                // Where two walls run together past a nose, the pole would stand on the other road.
                if (roadLevelWith(others, px, p.y, pz, 0, MIN_CLEARANCE / 2)) continue
                // Beside a field's mouth the pole would stand in its wall.
                if (fieldClearance(track.fields, px, pz) < 1) continue
                // Local -x is the arm; turn it to point across the track.
                const inX = p.tz * side
                const inZ = -p.tx * side
                dummy.position.set(px, p.y + 0.86, pz)
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
    }
    for (const m of [...lamps, pool]) m.count = li
    return { lens, poolMat, heads }
}

/** An arch over each line with a banner under its crown, a field gate's on its posts; returns the start arch's five lights. */
export function buildGantries({ track, group, own }: WorldKit, steel: THREE.Material) {
    const startLights: THREE.MeshStandardMaterial[] = []
    // One arch per span a line needs; lines on the same road width, and every field gate, share one.
    const arches = new Map<number, { span: number, archGeo: THREE.TubeGeometry, neonGeo: THREE.TubeGeometry }>()
    const archFor = (wide: number) => {
        const span = Math.round(wide * 100) / 100
        let arch = arches.get(span)
        if (!arch) {
            const curve = new THREE.CatmullRomCurve3(Array.from({ length: 25 }, (_, i) => new THREE.Vector3(Math.cos(Math.PI * i / 24) * span, Math.sin(Math.PI * i / 24) * ARCH_HEIGHT, 0)))
            arch = { span, archGeo: own(new THREE.TubeGeometry(curve, 64, ARCH_TUBE, 10)), neonGeo: own(new THREE.TubeGeometry(curve, 64, 0.07, 6)) }
            arches.set(span, arch)
        }
        return arch
    }
    const legGeo = own(new THREE.CylinderGeometry(ARCH_TUBE, ARCH_TUBE, 1, 10))
    const neonMat = own(new THREE.MeshBasicMaterial({ color: NEON_PINK }))
    // A checkpoint's neon is its own colour, so it doesn't pass for the pink walls round it.
    const checkpointNeon = own(new THREE.MeshBasicMaterial({ color: LINE_COLORS.checkpoint }))
    const requiredNeon = own(new THREE.MeshBasicMaterial({ color: LINE_COLORS.required }))
    const boardGeo = own(new THREE.BoxGeometry(BANNER_WIDTH + 0.2, BOARD_HEIGHT, 0.6))
    const bannerGeo = own(new THREE.PlaneGeometry(BANNER_WIDTH, BANNER_WIDTH / 4))
    const lightGeo = own(new THREE.CylinderGeometry(0.3, 0.3, 0.15, 20).rotateX(Math.PI / 2))
    const panelGeo = own(new THREE.BoxGeometry(START_LIGHTS * LIGHT_SPACING + 0.3, 0.8, 0.2))
    const panelMat = own(new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.6, metalness: 0.4 }))
    const name = track.def.name.toUpperCase()
    const buildGantry = (l: LapLine, sub: string, lights: boolean) => {
        const { span, archGeo, neonGeo } = archFor(l.field === undefined ? track.branches[l.branch]!.wallAt(l.s) + 1.2 : GATE_SPAN)
        const g = new THREE.Group()
        g.position.set(l.x, l.y, l.z)
        g.rotation.y = headingOf(l.tx, l.tz)
        g.add(new THREE.Mesh(archGeo, steel))
        // The feet stand outside the walls, so on raised road they'd hang in the air; a field gate's stand on its floor.
        if (l.y > 0 && l.field === undefined) {
            for (const side of [1, -1]) {
                const leg = new THREE.Mesh(legGeo, steel)
                leg.scale.y = l.y
                leg.position.set(side * span, -l.y / 2, 0)
                g.add(leg)
            }
        }
        for (const face of [1, -1]) {
            const neon = new THREE.Mesh(neonGeo, l.required ? requiredNeon : l.kind === 'checkpoint' ? checkpointNeon : neonMat)
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
    const SUBS = { start: track.closed ? 'START / FINISH' : 'START', finish: 'FINISH', checkpoint: 'CHECKPOINT' }
    for (const l of track.lapLines) buildGantry(l, l.required ? 'REQUIRED' : SUBS[l.kind], l.kind === 'start')
    return startLights
}
