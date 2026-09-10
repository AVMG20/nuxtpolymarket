import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createBuildingModel } from '../../app/utils/town/models'
import { createRoadParts } from '../../app/utils/town/roads'
import { animateTownWater } from '../../app/utils/town/surfaces'
import { artCatalog } from './catalog'

type Entry = typeof artCatalog[number]
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const building = element<HTMLSelectElement>('building')
const tier = element<HTMLSelectElement>('tier')
const levels = element<HTMLSelectElement>('levels')
const grid = element('grid')
const status = element('status')
const dialog = element<HTMLDialogElement>('inspector')
const stage = element('stage')
const levelSelect = element<HTMLSelectElement>('level')
const images = new Map<string, string>()
let shown: Entry[] = []
let generation = 0
let selected: Entry | null = null
let model: THREE.Group | null = null
let spin = false
let ready = false

for (const entry of artCatalog.filter(entry => entry.level === 1)) building.add(new Option(entry.name, entry.type))
for (const value of [...new Set(artCatalog.map(entry => entry.tier))].sort()) tier.add(new Option(`Tier ${value}`, String(value)))

function setupScene() {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x819177)
    scene.add(new THREE.HemisphereLight(0xe8f1ff, 0x756449, 1.7))
    const sun = new THREE.DirectionalLight(0xffe1b8, 2.8)
    sun.position.set(3, 6, 4)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.left = sun.shadow.camera.bottom = -2
    sun.shadow.camera.right = sun.shadow.camera.top = 2
    sun.shadow.normalBias = 0.025
    sun.shadow.bias = -0.0004
    scene.add(sun)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x819177, roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.015
    ground.receiveShadow = true
    scene.add(ground)
    return scene
}
function makeModel(entry: Entry) {
    return entry.type === 'road' ? createRoadParts([false, true, false, true]) : createBuildingModel(entry.type, entry.level)
}
function release(instance: THREE.Group) {
    instance.removeFromParent()
    instance.traverse(object => {
        if (object instanceof THREE.Mesh && object.name === 'glow') (object.material as THREE.Material).dispose()
    })
}
function frame(camera: THREE.PerspectiveCamera, instance: THREE.Group) {
    const bounds = new THREE.Box3().setFromObject(instance)
    const center = bounds.getCenter(new THREE.Vector3())
    const radius = Math.max(0.65, bounds.getBoundingSphere(new THREE.Sphere()).radius)
    camera.position.copy(center).add(new THREE.Vector3(1.25, 1.05, 1.65).normalize().multiplyScalar(radius * 3.5))
    camera.lookAt(center)
    return center
}

try {
    // One WebGL context for both the contact sheet and inspector, even with hundreds of cards.
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.shadowMap.enabled = true
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    renderer.setPixelRatio(1)
    const scene = setupScene()
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 300)
    stage.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.minDistance = 0.8
    controls.maxDistance = 12
    controls.maxPolarAngle = Math.PI / 2 - 0.03
    controls.autoRotateSpeed = 1.2
    let thumbnailBusy = false
    let inspectDirty = true
    controls.addEventListener('change', () => { inspectDirty = true })
    new ResizeObserver(() => { inspectDirty = true }).observe(stage)

    async function renderCards() {
        const token = ++generation
        shown = artCatalog.filter(entry => {
            const typeMatch = building.value === 'all' || entry.type === building.value
            const tierMatch = tier.value === 'all' || String(entry.tier) === tier.value
            const max = artCatalog.filter(other => other.type === entry.type).at(-1)!.level
            return typeMatch && tierMatch && (levels.value === 'all' || (levels.value === 'first' && entry.level === 1) || (levels.value === 'max' && entry.level === max) || (levels.value === 'stages' && ((entry.level - 1) % 4 === 0 || entry.level === max)))
        })
        element('count').textContent = `${shown.length} models / ${artCatalog.length} total`
        grid.replaceChildren()
        for (const [index, entry] of shown.entries()) {
            if (token !== generation) return
            // Yield while a close-up owns the renderer. Closing it resumes the gallery.
            while (dialog.open && token === generation) await new Promise(requestAnimationFrame)
            if (token !== generation) return
            if (!images.has(entry.id)) {
                thumbnailBusy = true
                const instance = makeModel(entry)
                scene.add(instance)
                camera.aspect = 1
                camera.updateProjectionMatrix()
                frame(camera, instance)
                renderer.setSize(320, 320, false)
                renderer.render(scene, camera)
                images.set(entry.id, renderer.domElement.toDataURL('image/png'))
                release(instance)
                thumbnailBusy = false
            }
            const card = document.createElement('button')
            card.className = 'card'
            card.setAttribute('aria-label', `${entry.name}, level ${entry.level}, tier ${entry.tier}`)
            const image = document.createElement('img')
            image.src = images.get(entry.id)!
            image.alt = `${entry.name} at level ${entry.level}`
            const info = document.createElement('div')
            const name = document.createElement('strong')
            name.textContent = entry.name
            const caption = document.createElement('span')
            caption.textContent = `Level ${entry.level} · Tier ${entry.tier}`
            info.append(name, caption)
            card.append(image, info)
            card.onclick = () => inspect(entry)
            grid.appendChild(card)
            status.textContent = `Rendering ${index + 1} of ${shown.length}…`
            await new Promise(requestAnimationFrame)
        }
        ready = true
        status.textContent = 'Ready. Select a model to inspect its silhouette, materials and upgrade details.'
    }
    function inspect(entry: Entry) {
        selected = entry
        if (model) release(model)
        model = makeModel(entry)
        scene.add(model)
        element('title').textContent = `${entry.name} · Level ${entry.level} · Tier ${entry.tier}`
        levelSelect.replaceChildren()
        for (const item of artCatalog.filter(other => other.type === entry.type)) levelSelect.add(new Option(String(item.level), item.id))
        levelSelect.value = entry.id
        element<HTMLButtonElement>('previous').disabled = entry.level === 1
        element<HTMLButtonElement>('next').disabled = !artCatalog.some(other => other.type === entry.type && other.level === entry.level + 1)
        controls.target.copy(frame(camera, model))
        controls.update()
        if (!dialog.open) dialog.showModal()
        inspectDirty = true
    }
    function close() {
        dialog.close()
        if (model) { release(model); model = null }
    }
    dialog.addEventListener('close', () => { if (model) { release(model); model = null } })
    element('close').onclick = close
    levelSelect.onchange = () => inspect(artCatalog.find(entry => entry.id === levelSelect.value)!)
    for (const [id, delta] of [['previous', -1], ['next', 1]] as const) element(id).onclick = () => {
        const target = artCatalog.find(entry => entry.type === selected?.type && entry.level === selected.level + delta)
        if (target) inspect(target)
    }
    element('reset').onclick = () => { if (selected) inspect(selected) }
    element('rotate').onclick = () => { spin = !spin; controls.autoRotate = spin; element('rotate').classList.toggle('active', spin); inspectDirty = true }
    element('save').onclick = () => download(renderer.domElement.toDataURL('image/png'), `polytown-${selected!.type}-level-${selected!.level}.png`)
    for (const control of [building, tier, levels]) control.onchange = () => { ready = false; void renderCards().catch(reportError) }
    element('sheet').onclick = () => document.body.classList.toggle('sheet')
    element('export').onclick = async () => {
        if (!ready || shown.some(entry => !images.has(entry.id))) { status.textContent = 'Please wait for the visible models to finish rendering before exporting.'; return }
        const entries = [...shown]
        const columns = 8
        const size = 200
        const height = 238
        const sheet = document.createElement('canvas')
        sheet.width = columns * size
        sheet.height = Math.ceil(entries.length / columns) * height + 60
        const ctx = sheet.getContext('2d')!
        ctx.fillStyle = '#202c30'; ctx.fillRect(0, 0, sheet.width, sheet.height)
        ctx.fillStyle = '#e9efe7'; ctx.font = 'bold 23px system-ui'; ctx.fillText(`Polytown · ${entries.length} building variants`, 20, 38)
        for (const [index, entry] of entries.entries()) {
            const img = new Image(); img.src = images.get(entry.id)!; await img.decode()
            const x = index % columns * size; const y = Math.floor(index / columns) * height + 60
            ctx.drawImage(img, x, y, size, size)
            ctx.fillStyle = '#e9efe7'; ctx.font = '13px system-ui'; ctx.fillText(`${entry.name} · L${entry.level} · T${entry.tier}`, x + 8, y + size + 23)
        }
        download(sheet.toDataURL('image/png'), 'polytown-building-contact-sheet.png')
    }
    function draw(ms: number) {
        requestAnimationFrame(draw)
        if (!dialog.open || !model || thumbnailBusy || document.hidden) return
        controls.update()
        if (!inspectDirty && !spin) return
        inspectDirty = false
        const width = Math.max(1, stage.clientWidth); const height = Math.max(1, stage.clientHeight)
        renderer.setSize(width, height, false)
        camera.aspect = width / height; camera.updateProjectionMatrix()
        animateTownWater(ms / 1000)
        renderer.render(scene, camera)
    }
    requestAnimationFrame(draw)
    void renderCards().catch(reportError)
} catch (error) {
    element('error').textContent = `Unable to start the 3D gallery: ${error instanceof Error ? error.message : String(error)}`
    status.textContent = 'This gallery needs a browser with WebGL enabled.'
}
function reportError(error: unknown) {
    element('error').textContent = `Unable to render models: ${error instanceof Error ? error.message : String(error)}`
}
function download(url: string, filename: string) {
    const link = element<HTMLAnchorElement>('export-link')
    link.href = url
    link.download = filename
    element<HTMLImageElement>('export-image').src = url
    element<HTMLDialogElement>('export-preview').showModal()
}
