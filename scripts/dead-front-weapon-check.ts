// Headless check of the Dead Front weapon pack (public/dead-front/models/weapons.glb,
// built by scripts/dead-front-models/weapons.py): builds every gun plain, with each
// attachment and Pack-a-Punched, and checks what the viewmodel relies on.
//
//   bun --tsconfig-override scripts/tsconfig.shapezz-playtest.json scripts/dead-front-weapon-check.ts
//
// Per build: the model came from the pack, the iron sights' markers sit on top of the
// front post and the rear notch's ears, nothing on the centre line stands above the
// sight line between the eye and the front sight, an optic's window is clear, the
// muzzle marker is at the front of the gun and every moving part the gun's action
// needs is there. Prints one line per failure and exits 1 when there is any.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DF_WEAPONS } from '#shared/utils/dead-front/weapons'
import type { DfAttachmentChoice, DfWeaponId } from '#shared/utils/dead-front/types'
import { dfRegisterModelPack } from '../app/utils/dead-front/models'
import { dfBuildGunRig, type DfGunRig } from '../app/utils/dead-front/weapons/models'

const CELL = 0.011
const file = readFileSync(resolve(import.meta.dirname, '../public/dead-front/models/weapons.glb'))
const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, '')
dfRegisterModelPack('weapons', gltf.scene)

/** Every vertex of the rig in gun space, tagged with the part it belongs to. */
function vertices(r: DfGunRig): { p: THREE.Vector3, part: string }[] {
    r.root.updateMatrixWorld(true)
    const inv = new THREE.Matrix4().copy(r.root.matrixWorld).invert()
    const out: { p: THREE.Vector3, part: string }[] = []
    r.root.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh || m === r.lens) return
        let part = 'main'
        for (let q: THREE.Object3D | null = o; q && q !== r.root; q = q.parent) if (q.name) part = q.name
        const pos = m.geometry.getAttribute('position')
        const mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)
        for (let i = 0; i < pos.count; i++) out.push({ p: new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat), part })
    })
    return out
}

let failures = 0
let builds = 0
function check(id: DfWeaponId, pap: number, att: DfAttachmentChoice): void {
    builds++
    const label = `${id}${pap ? ` pap${pap}` : ''}${Object.values(att).length ? ` [${Object.values(att).join(', ')}]` : ''}`
    const fail = (msg: string) => {
        failures++
        console.log(`FAIL ${label}: ${msg}`)
    }
    const r = dfBuildGunRig(id, pap, att)
    const vs = vertices(r)
    if (vs.length < 200) return fail(`only ${vs.length} vertices (the pack model is missing)`)
    const rear = r.sight
    const front = r.sightFront
    if (!(rear.z > front.z)) fail('rear sight is not behind the front sight')
    const lineY = (z: number) => rear.y + (front.y - rear.y) * (rear.z - z) / (rear.z - front.z)
    const optic = r.scoped || !!r.lens
    // the magazine and the pan are below or beside the line by design; hidden loaders do not count
    const solid = vs.filter(v => !(r.magHidden && v.part === 'mag'))
    if (!optic) {
        const topNear = (at: THREE.Vector3, halfX: number, halfZ: number) => Math.max(...solid.filter(v => Math.abs(v.p.z - at.z) < halfZ && Math.abs(v.p.x) < halfX).map(v => v.p.y))
        const fTop = topNear(front, CELL * 0.6, CELL * 0.9)
        // (a ring sight stands round the post, so it is taller than the marker)
        if (Math.abs(fTop - front.y) > 0.0012 && !(att.optic ?? '').includes('ring')) fail(`front marker is ${((front.y - fTop) * 1000).toFixed(1)} mm off the top of the post`)
        const rTop = topNear(rear, CELL * 3, CELL * 1.6)
        if (Math.abs(rTop - rear.y) > 0.0012) fail(`rear marker is ${((rear.y - rTop) * 1000).toFixed(1)} mm off the top of the notch`)
        // the notch itself must be open on the centre line
        const inNotch = solid.filter(v => Math.abs(v.p.z - rear.z) < CELL * 1.6 && Math.abs(v.p.x) < CELL * 0.4 && v.p.y > rear.y - CELL * 0.6)
        if (inNotch.length) fail('the rear notch is filled on the centre line')
        const eyeZ = rear.z + r.eyeRelief
        const over = solid.filter(v => Math.abs(v.p.x) < CELL * 0.45 && v.p.z < eyeZ && v.p.z > front.z + CELL * 1.2 && v.p.y > lineY(v.p.z) + 0.0004)
        if (over.length) {
            const worst = over.reduce((a, b) => (a.p.y - lineY(a.p.z) > b.p.y - lineY(b.p.z) ? a : b))
            fail(`${worst.part} stands ${((worst.p.y - lineY(worst.p.z)) * 1000).toFixed(1)} mm above the sight line at z ${(worst.p.z / CELL).toFixed(1)} cells`)
        }
    } else if (!r.scoped) {
        // a red dot: the window round the axis stays clear from the eye to the front glass
        const blocked = solid.filter(v => v.p.z < rear.z + r.eyeRelief && v.p.z > front.z - CELL && Math.abs(v.p.x) < CELL * 1.3 && Math.abs(v.p.y - lineY(v.p.z)) < CELL * 1.2)
        if (blocked.length) fail(`${blocked[0]!.part} is inside the red dot's window`)
    }
    const minZ = Math.min(...solid.filter(v => v.part === 'main' || v.part === 'barrel' || v.part === 'slide').map(v => v.p.z))
    // (the Pack-a-Punched pistol fires from its launcher barrel, whatever is on the muzzle)
    if (Math.abs(r.muzzle.position.z - minZ) > CELL * 2.6 && !(id === 'm1911' && pap > 0)) fail(`muzzle marker is ${((r.muzzle.position.z - minZ) / CELL).toFixed(1)} cells from the front of the gun`)
    if (Math.abs(r.muzzle.position.x) > 1e-4) fail('muzzle marker is off the centre line')
    // (the pump gun loads shell by shell: it has no magazine part)
    const need: [string, unknown][] = r.reload === 'shell' ? [] : [['mag', r.mag]]
    if (r.cycle) need.push(['bolt', r.bolt])
    if (r.cycle === 'lever') need.push(['lever', r.lever])
    if (r.reload === 'break') need.push(['barrel', r.barrel])
    if (r.reload === 'shell') need.push(['pump', r.pump])
    if (r.reload === 'top' || r.chambers) need.push(['pan', r.pan])
    if (id === 'm1911') need.push(['slide', r.slide])
    for (const [name, part] of need) if (!part) fail(`no ${name} part`)
    if (pap > 0 && id !== 'xray' && id !== 'wunder') {
        const main = r.root.children.find(o => (o as THREE.Mesh).isMesh) as THREE.Mesh
        if (!main.geometry.getAttribute('aPap')) fail('no camo attribute on the Pack-a-Punched model')
    }
}

const ids = [...Object.keys(DF_WEAPONS), 'granatwerfer'].filter((v, i, a) => a.indexOf(v) === i) as DfWeaponId[]
for (const id of ids) {
    check(id, 0, {})
    for (const pap of [1, 2, 3]) check(id, pap, {})
    const list = DF_WEAPONS[id]?.attachments ?? []
    for (const a of list) check(id, 0, { [a.slot]: a.id })
    // every attachment at once (one per slot, the last listed wins)
    const all: DfAttachmentChoice = {}
    for (const a of list) all[a.slot] = a.id
    if (list.length) check(id, 2, all)
}
console.log(`${builds} builds checked, ${failures} failure${failures === 1 ? '' : 's'}`)
process.exit(failures ? 1 : 0)
