import * as THREE from 'three'
import type { DfAttachmentChoice, DfWeaponId } from '#shared/utils/dead-front/types'
import type { DfAudio, DfFx, DfRenderContext, DfViewmodelInput } from '../context'
import { buildDfWeaponModelImpl, disposeDfWeaponModel } from './models'
import { createDfViewmodelImpl } from './viewmodel'

// Development-only viewmodel bench: renders the first-person viewmodel over a
// neutral backdrop at a chosen resolution, with a 1 px centre dot, so the hip
// framing, ADS alignment and motions can be checked without a live match.
// Not imported by the game; load it from the dev console:
//   const m = await import('/_nuxt/utils/dead-front/weapons/preview.ts')
//   const b = m.dfViewmodelBench(1920, 1080); b.set('kar98k'); b.pose({ ads: true }); await b.settle()

export interface DfViewmodelBench {
    set(id: DfWeaponId, pap?: number, attachments?: DfAttachmentChoice): void
    pose(p: Partial<DfViewmodelInput>): void
    fire(): void
    reload(empty?: boolean): void
    /** Runs the simulation for `seconds` at 60 fps and renders. */
    settle(seconds?: number): Promise<void>
    /** Pixel offset of the rear and front sight from the screen centre (should be ~0 at full ADS). */
    sightError(): { rear: [number, number], front: [number, number] }
    /** Renders now and returns the frame as a PNG data URL (for contact sheets). */
    snapshot(): string
    /** Shows the world model (pedestal / box look) side-on instead of the viewmodel; null clears it. */
    showModel(id: DfWeaponId | null, pap?: number, yaw?: number): void
    dispose(): void
}

export function dfViewmodelBench(width = 1920, height = 1080): DfViewmodelBench {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const fit = Math.min(window.innerWidth / width, window.innerHeight / height)
    const cw = Math.floor(width * fit)
    const ch = Math.floor(height * fit)
    Object.assign(canvas.style, { position: 'fixed', left: '0', top: '0', width: `${cw}px`, height: `${ch}px`, zIndex: '99999', background: '#46505e' })
    document.body.appendChild(canvas)
    const dot = document.createElement('div')
    Object.assign(dot.style, { position: 'fixed', left: `${Math.floor(cw / 2) - 1}px`, top: `${Math.floor(ch / 2) - 1}px`, width: '2px', height: '2px', background: '#ff00ff', zIndex: '100000' })
    document.body.appendChild(dot)
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setSize(width, height, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.05, 100)
    const vmScene = new THREE.Scene()
    vmScene.background = new THREE.Color(0x3a4352)
    const vmCamera = new THREE.PerspectiveCamera(54, width / height, 0.01, 10)
    vmScene.add(vmCamera)
    // the engine's viewmodel light rig
    vmScene.add(new THREE.HemisphereLight(0x8d97b0, 0x2b2218, 0.85))
    const key = new THREE.DirectionalLight(0xffcf9a, 1.5)
    key.position.set(-1.2, 1.6, 0.8)
    vmScene.add(key)
    const rim = new THREE.DirectionalLight(0x9fb4ff, 0.7)
    rim.position.set(1.4, 0.4, -1.2)
    vmScene.add(rim)
    // A neutral studio rig for the world-model view (the viewmodel's own lights hide with it).
    const studio = new THREE.Group()
    const sKey = new THREE.DirectionalLight(0xfff1dc, 1.6)
    sKey.position.set(0.5, 1, 1)
    const sFill = new THREE.DirectionalLight(0xb8c8ff, 0.6)
    sFill.position.set(-1, 0.2, 0.6)
    studio.add(sKey, sFill, new THREE.AmbientLight(0xa0a8b8, 0.5))
    studio.visible = false
    vmScene.add(studio)
    const noop = () => {}
    const fx: DfFx = { burst: noop, tracer: noop, lightning: noop, decal: noop, flash: noop, shake: noop }
    const audio: DfAudio = { ctx: null, register: noop, play: noop, loop: noop, stopLoop: noop }
    const ctx: DfRenderContext = { renderer, scene, camera, vmScene, vmCamera, fx, audio, quality: 'high' }
    const vm = createDfViewmodelImpl(ctx)
    const input: DfViewmodelInput = { speed: 0, sprinting: false, crouching: false, grounded: true, look: { x: 0, y: 0 }, ads: false, adsMult: 1 }
    const sim = (seconds: number) => {
        const n = Math.max(1, Math.round(seconds * 60))
        for (let i = 0; i < n; i++) vm.update(1 / 60, input)
        renderer.render(vmScene, vmCamera)
    }
    const project = (o: THREE.Vector3): [number, number] => {
        const p = o.clone().project(vmCamera)
        return [+(p.x * width / 2).toFixed(2), +(p.y * height / 2).toFixed(2)]
    }
    let shown: THREE.Object3D | null = null
    let rigRef: { sight: THREE.Vector3, sightFront: THREE.Vector3, root: THREE.Object3D } | null = null
    return {
        set(id, pap = 0, attachments = {}) {
            vm.equip({ id, pap, attachments }, 100)
            sim(1.2)
            rigRef = null
            vm.root.traverse((o) => {
                if (o.name === `df-weapon-${id}` && !rigRef) rigRef = { sight: o.userData.dfSight, sightFront: o.userData.dfSightFront, root: o }
            })
        },
        pose(p) {
            Object.assign(input, p)
        },
        fire() {
            vm.fire()
        },
        reload(empty = false) {
            vm.reload(empty, 1.6)
        },
        async settle(seconds = 1) {
            sim(seconds)
            // A timeout rather than rAF: automation tabs are often hidden, where rAF never fires.
            await new Promise(r => setTimeout(r, 0))
        },
        sightError() {
            if (!rigRef || !rigRef.sight) return { rear: [NaN, NaN], front: [NaN, NaN] }
            vm.root.updateMatrixWorld(true)
            const rear = rigRef.sight.clone().applyMatrix4(rigRef.root.matrixWorld)
            const front = rigRef.sightFront.clone().applyMatrix4(rigRef.root.matrixWorld)
            vmCamera.updateMatrixWorld()
            return { rear: project(rear), front: project(front) }
        },
        showModel(id, pap = 0, yaw = Math.PI / 2) {
            if (shown) disposeDfWeaponModel(shown)
            shown = null
            vm.root.visible = !id
            studio.visible = !!id
            if (!id) return
            shown = buildDfWeaponModelImpl(id, pap)
            const box = new THREE.Box3().setFromObject(shown)
            const c = box.getCenter(new THREE.Vector3())
            const pivot = new THREE.Group()
            shown.position.sub(c)
            pivot.add(shown)
            pivot.rotation.y = yaw
            pivot.position.set(0, 0, -1.25)
            vmScene.add(pivot)
            shown = pivot
            renderer.render(vmScene, vmCamera)
        },
        snapshot() {
            renderer.render(vmScene, vmCamera)
            return canvas.toDataURL('image/png')
        },
        dispose() {
            vm.dispose()
            renderer.dispose()
            canvas.remove()
            dot.remove()
        }
    }
}

export interface DfBoltBench {
    /** Fires an X-Ray bolt of a PaP tier across the view; `at` 0..1 is where it is when the frame is taken. */
    bolt(tier: number, at?: number): string
    /** The bolt's impact on a wall facing the camera, `after` seconds in. */
    impact(tier: number, after?: number): string
    readonly scene: THREE.Scene
    dispose(): void
}

/** Development-only bench for the X-Ray bolt, its trail and its impact (renders without the game). */
export async function dfBoltBench(width = 1280, height = 720): Promise<DfBoltBench> {
    const { createDfFx } = await import('../engine/fx')
    const { createDfProjectileViewImpl } = await import('./projectiles')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    Object.assign(canvas.style, { position: 'fixed', left: '0', top: '0', width: `${Math.floor(width / 2)}px`, height: `${Math.floor(height / 2)}px`, zIndex: '99999' })
    document.body.appendChild(canvas)
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
    renderer.setSize(width, height, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d1016)
    scene.add(new THREE.HemisphereLight(0x5a6478, 0x1a1410, 0.6))
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x6a6258 })
    const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 12), wallMat)
    floor.position.y = -0.1
    const wall = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 0.3), wallMat)
    wall.position.set(0, 2, -3)
    scene.add(floor, wall)
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.05, 100)
    camera.position.set(0, 1.5, 2.5)
    camera.lookAt(0, 1.3, -2)
    scene.add(camera)
    const fx = createDfFx(scene, camera, 'high')
    fx.resize(height, 1)
    const noop = () => {}
    const audio: DfAudio = { ctx: null, register: noop, play: noop, loop: noop, stopLoop: noop }
    const vmScene = new THREE.Scene()
    const ctx: DfRenderContext = { renderer, scene, camera, vmScene, vmCamera: camera, fx, audio, quality: 'high' }
    const pv = createDfProjectileViewImpl(ctx)
    let t = 0
    let id = 1
    const step = (list: { id: number, kind: 'xray-bolt', pos: { x: number, y: number, z: number }, vel: { x: number, y: number, z: number }, tier: number }[]) => {
        t += 1 / 60
        pv.update(1 / 60, list)
        fx.update(1 / 60, t)
    }
    return {
        scene,
        bolt(tier, at = 0.6) {
            const n = id++
            const from = new THREE.Vector3(-4, 1.2, -1.5)
            const vel = new THREE.Vector3(14, 0.4, -1)
            const frames = Math.round(at * 40)
            for (let f = 0; f <= frames; f++) {
                const p = from.clone().addScaledVector(vel, f / 60)
                step([{ id: n, kind: 'xray-bolt', pos: p, vel, tier }])
            }
            renderer.render(scene, camera)
            const url = canvas.toDataURL('image/png')
            for (let f = 0; f < 90; f++) step([])
            return url
        },
        impact(tier, after = 0.06) {
            const n = id++
            const end = new THREE.Vector3(0.3, 1.3, -2.77)
            const vel = new THREE.Vector3(0, 0, -50)
            step([{ id: n, kind: 'xray-bolt', pos: end.clone().addScaledVector(vel, -1 / 60), vel, tier }])
            step([])
            pv.onEvent({ k: 'explode', pos: end, radius: 2.2 + tier * 0.5, kind: 'xray', tier })
            for (let f = 0; f < Math.round(after * 60); f++) step([])
            renderer.render(scene, camera)
            const url = canvas.toDataURL('image/png')
            for (let f = 0; f < 90; f++) step([])
            return url
        },
        dispose() {
            pv.dispose()
            fx.dispose()
            renderer.dispose()
            canvas.remove()
        }
    }
}
