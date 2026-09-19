// Browser entry built by `bun scripts/preview-polytown-models.ts`.
import * as THREE from 'three'
import { createBuildingModel } from '../../app/utils/town/models'
import { createRoadParts } from '../../app/utils/town/roads'
import { TOWN_VISUAL_LEVELS } from '../../app/utils/town/appearance'
import { TOWN_BUILDINGS, townBuildingMaxLevel } from '../../shared/utils/gamelogic/town'

const query = new URLSearchParams(location.search)
const num = (key: string, fallback: number) => Number(query.get(key) ?? fallback)

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(2, devicePixelRatio))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1
document.body.append(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xcfe3ea)
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x8a7550, 1.25))
const sun = new THREE.DirectionalLight(0xffdca8, 3.3)
sun.position.set(30, 32, 18)
sun.castShadow = true
sun.shadow.mapSize.set(4096, 4096)
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 })
sun.shadow.normalBias = 0.02
scene.add(sun, sun.target)

const lawn = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x7fae4e, roughness: 1 }))
lawn.rotation.x = -Math.PI / 2
lawn.receiveShadow = true
scene.add(lawn)

function place(model: THREE.Object3D, x: number, z: number) {
    model.position.set(x + 0.5, 0, z + 0.5)
    scene.add(model)
}

// One row per building, one column per stage, a road along the front of each.
const buildings = TOWN_BUILDINGS.filter(b => b.kind !== 'road')
buildings.forEach((def, row) => {
    const z = row * 2
    TOWN_VISUAL_LEVELS.forEach((level, col) => {
        if (level > townBuildingMaxLevel(def)) return
        place(createBuildingModel(def.id, level, row + col), col * 1, z)
    })
    for (let col = 0; col < 5; col++) place(createRoadParts([false, true, false, true]), col, z + 1)
})
// A terrace of every house variant, and a block of farms, to judge them en masse.
for (let v = 0; v < 12; v++) {
    place(createBuildingModel('house', [1, 5, 10, 15, 20][v % 5]!, v), 7 + v, 0)
    place(createRoadParts([false, true, false, true]), 7 + v, 1)
    const back = createBuildingModel('house', [5, 10, 1, 20, 15][v % 5]!, v + 5)
    back.rotation.y = Math.PI
    place(back, 7 + v, 2)
}
for (let x = 0; x < 4; x++) for (let z = 0; z < 3; z++) place(createBuildingModel('farm', [1, 5, 10, 15, 20][(x + z) % 5]!, x + z), 7 + x, 4 + z)
for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) place(createBuildingModel('lumber', [1, 5, 10, 15, 20][(x * 2 + z) % 5]!, x + z), 12 + x, 4 + z)

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 400)
const target = new THREE.Vector3(num('tx', 3), 0, num('tz', 6))
const dist = num('dist', 16)
const yaw = num('yaw', 0.7)
const pitch = num('pitch', 0.95)
camera.position.set(target.x + dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), target.z + dist * Math.cos(pitch) * Math.cos(yaw))
camera.lookAt(target)
renderer.render(scene, camera)
document.title = `ready ${renderer.info.render.triangles}`
