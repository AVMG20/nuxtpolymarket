// Browser entry built by `bun scripts/render-polytown-assets.ts`.
import * as THREE from 'three'
import { createBuildingModel } from '../../app/utils/town/models'
import { townBuildingPortrait } from '../../app/utils/town/appearance'
import { TOWN_BUILDINGS } from '../../shared/utils/gamelogic/town'

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.setSize(320, 320)
renderer.setPixelRatio(1)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.15
const scene = new THREE.Scene()
scene.add(new THREE.HemisphereLight(0xd6efff, 0x718555, 1.3))
const sun = new THREE.DirectionalLight(0xffe6bf, 3)
sun.position.set(-3, 6, 4)
sun.castShadow = true
sun.shadow.mapSize.set(1024, 1024)
Object.assign(sun.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5 })
sun.shadow.normalBias = 0.012
scene.add(sun)
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30)
const gallery = document.querySelector('main')!
const status = document.querySelector('#status')!
const button = document.querySelector('button')!
const milestones = new Set([1, 5, 9, 13, 17, 20])

button.addEventListener('click', async () => {
    button.disabled = true
    gallery.replaceChildren()
    let count = 0
    try {
        for (const def of TOWN_BUILDINGS.filter(b => b.kind !== 'road')) {
            const row = document.createElement('section')
            row.innerHTML = `<h2>${def.name}</h2><div class="variants"></div>`
            gallery.append(row)
            // Constant framing within a family makes its growth directly comparable.
            const final = createBuildingModel(def.id, 20)
            const height = final.userData.height as number
            const extent = Math.max(0.85, height * 0.6)
            Object.assign(camera, { left: -extent, right: extent, top: extent, bottom: -extent })
            camera.position.set(2.6, height * 0.5 + 2.1, 3.2)
            camera.lookAt(0, height * 0.45, 0)
            camera.updateProjectionMatrix()
            final.traverse(o => { if (o instanceof THREE.Mesh && o.name === 'glow') (o.material as THREE.Material).dispose() })
            for (let level = 1; level <= 20; level++) {
                const model = createBuildingModel(def.id, level)
                scene.add(model)
                renderer.render(scene, camera)
                const png = await new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png'))
                const path = townBuildingPortrait(def.id, level)
                const response = await fetch(`/save/${path.split('/').pop()}`, { method: 'POST', body: png })
                if (!response.ok) throw new Error(`Could not save ${path}: ${response.status}`)
                const card = document.createElement('figure')
                card.classList.toggle('intermediate', !milestones.has(level))
                card.innerHTML = `<img src="${URL.createObjectURL(png)}" alt="${def.name} level ${level}"><figcaption>Level ${level}</figcaption><small>${renderer.info.render.triangles.toLocaleString()} triangles</small>`
                row.querySelector('.variants')!.append(card)
                scene.remove(model)
                model.traverse(o => { if (o instanceof THREE.Mesh && o.name === 'glow') (o.material as THREE.Material).dispose() })
                count++
                status.textContent = `${count} / 300 portraits saved · ${def.name}, level ${level}`
                await new Promise(resolve => requestAnimationFrame(resolve))
            }
        }
        status.textContent = 'Complete · 300 portraits saved · 15 building families × 20 levels'
    } catch (error) {
        status.textContent = `Stopped: ${error instanceof Error ? error.message : String(error)}`
    } finally {
        button.disabled = false
    }
})
document.querySelector('input')!.addEventListener('change', e => {
    document.body.classList.toggle('all-levels', (e.target as HTMLInputElement).checked)
})
