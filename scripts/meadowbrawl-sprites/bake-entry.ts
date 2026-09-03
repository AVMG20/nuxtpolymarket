// Runs inside headless Chromium. Loads a KayKit character, attaches weapons,
// retargets the shared Rig_Medium clips onto it, and renders sprite frames
// from the game's 45° camera into a sheet.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { SheetSpec, AtlasSheet } from './spec'

const loader = new GLTFLoader()
const cache = new Map<string, Promise<any>>()
const load = (url: string) => {
    if (!cache.has(url)) cache.set(url, loader.loadAsync(url))
    return cache.get(url)!
}

const CLIP_FILES = [
    '/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/Rig_Medium_General.glb',
    '/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/Rig_Medium_MovementBasic.glb',
    '/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/Rig_Medium_MovementAdvanced.glb',
    '/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/Rig_Medium_CombatMelee.glb',
    '/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/Rig_Medium_CombatRanged.glb',
    '/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/Rig_Medium_Special.glb'
]

async function clips(): Promise<Map<string, THREE.AnimationClip>> {
    const map = new Map<string, THREE.AnimationClip>()
    for (const f of CLIP_FILES) {
        const g = await load(f)
        for (const c of g.animations as THREE.AnimationClip[]) map.set(c.name, c)
    }
    return map
}

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.setClearColor(0x000000, 0)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const hemi = new THREE.HemisphereLight(0xfff2d8, 0x5f8f3a, 1.6)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xfff0d0, 2.2)
sun.position.set(-2.5, 4, 3)
scene.add(sun)
const fill = new THREE.DirectionalLight(0xbfd8ff, 0.5)
fill.position.set(2, 1, -2)
scene.add(fill)

const w = window as any

w.bake = async (spec: SheetSpec): Promise<{ png: string, atlas: AtlasSheet }> => {
    const all = await clips()
    const char = await load(spec.model)
    const root: THREE.Object3D = char.scene.clone(true)
    // Skinned meshes must be re-bound to the cloned skeleton.
    const skinned: THREE.SkinnedMesh[] = []
    root.traverse((o: any) => { if (o.isSkinnedMesh) skinned.push(o) })
    const bones = new Map<string, THREE.Bone>()
    root.traverse((o: any) => { if (o.isBone) bones.set(o.name, o) })
    for (const m of skinned) {
        const newBones = m.skeleton.bones.map(b => bones.get(b.name) ?? b)
        m.bind(new THREE.Skeleton(newBones, m.skeleton.boneInverses), m.matrixWorld)
    }
    root.traverse((o: any) => {
        if (o.isMesh || o.isSkinnedMesh) {
            o.frustumCulled = false
            if (spec.hide?.some(h => o.name.includes(h))) o.visible = false
            const mats: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material]
            o.material = mats.map(m => {
                const c = m.clone() as THREE.MeshStandardMaterial
                if (spec.tint && c.color) c.color.multiply(new THREE.Color(spec.tint))
                if (c.emissive && m.name === 'Glow') {
                    c.emissive.set(spec.eyes ?? '#ff4020')
                    c.emissiveIntensity = 2
                }
                return c
            })
            if (o.material.length === 1) o.material = o.material[0]
        }
    })
    // Weapons hang off the hand slots; KayKit authors them to sit right at identity.
    for (const wp of spec.weapons ?? []) {
        const g = await load(wp.model)
        const mesh = g.scene.clone(true)
        mesh.traverse((o: any) => { if (o.isMesh) o.frustumCulled = false })
        if (wp.scale) mesh.scale.setScalar(wp.scale)
        if (wp.rotate) mesh.rotation.set(wp.rotate[0], wp.rotate[1], wp.rotate[2])
        if (wp.offset) mesh.position.set(wp.offset[0], wp.offset[1], wp.offset[2])
        const slot = bones.get(wp.slot)
        if (!slot) throw new Error(`no slot ${wp.slot}`)
        slot.add(mesh)
    }
    const group = new THREE.Group()
    group.add(root)
    group.scale.setScalar(spec.scale ?? 1)
    scene.add(group)

    const mixer = new THREE.AnimationMixer(root)
    const cell = spec.cell
    const viewH = spec.viewH
    renderer.setSize(cell, cell, false)
    const cam = new THREE.OrthographicCamera(-viewH / 2, viewH / 2, viewH / 2, -viewH / 2, 0.1, 100)
    const pitch = 38 * Math.PI / 180
    const dist = 20
    cam.position.set(0, Math.sin(pitch) * dist + spec.lookY, Math.cos(pitch) * dist)
    cam.lookAt(0, spec.lookY, 0)
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    // Where the feet (world origin) land in the cell.
    const origin = new THREE.Vector3(0, 0, 0).project(cam)
    const anchorX = (origin.x + 1) / 2 * cell
    const anchorY = (1 - origin.y) / 2 * cell

    const DIRS = 5 // E, NE, N, NW-mirrored... we bake E, NE, N, SE, S and mirror the rest at runtime.
    const dirAngles = [0, -45, -90, 45, 90] // game angles in degrees: 0 = east, 90 = south (toward camera)
    const rows = spec.anims.length
    const maxFrames = Math.max(...spec.anims.map(a => a.frames))
    const sheet = document.createElement('canvas')
    sheet.width = maxFrames * DIRS * cell
    sheet.height = rows * cell
    const sctx = sheet.getContext('2d')!
    const atlas: AtlasSheet = { cell, anchorX: +anchorX.toFixed(1), anchorY: +anchorY.toFixed(1), cols: maxFrames * DIRS, dirs: DIRS, anims: {} }

    for (const [row, anim] of spec.anims.entries()) {
        const clip = all.get(anim.clip)
        if (!clip) throw new Error(`missing clip ${anim.clip}`)
        mixer.stopAllAction()
        const action = mixer.clipAction(clip)
        action.play()
        action.setLoop(THREE.LoopRepeat, Infinity)
        const start = anim.start ?? 0
        const end = anim.end ?? 1
        atlas.anims[anim.name] = { row, frames: anim.frames, loop: !!anim.loop }
        for (let d = 0; d < DIRS; d++) {
            const a = dirAngles[d]! * Math.PI / 180
            // Models face -Z at rest; rotate so the facing matches the game angle
            // where +x is east and +y (south) points at the camera (+Z).
            group.rotation.y = Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI
            for (let f = 0; f < anim.frames; f++) {
                const k = anim.loop ? f / anim.frames : f / Math.max(1, anim.frames - 1)
                const t = (start + (end - start) * k) * clip.duration
                mixer.setTime(0)
                mixer.update(t)
                renderer.render(scene, cam)
                sctx.drawImage(renderer.domElement, (f * DIRS + d) * cell, row * cell)
            }
        }
    }
    scene.remove(group)

    // Dark outline: dilate the alpha and paint it under the sprite.
    const out = document.createElement('canvas')
    out.width = sheet.width
    out.height = sheet.height
    const octx = out.getContext('2d')!
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) octx.drawImage(sheet, dx * 1.2, dy * 1.2)
    octx.globalCompositeOperation = 'source-in'
    octx.fillStyle = 'rgba(28,20,34,0.95)'
    octx.fillRect(0, 0, out.width, out.height)
    octx.globalCompositeOperation = 'source-over'
    octx.drawImage(sheet, 0, 0)
    const blob: Blob = await new Promise(res => out.toBlob(b => res(b!), 'image/webp', 0.9))
    const buf = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)))
    return { png: btoa(bin), atlas }
}
w.ready = true
