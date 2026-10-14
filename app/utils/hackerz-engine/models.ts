import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { HackerzEnemyId, HackerzTurretId } from '#shared/utils/gamelogic/hackerz'

/**
 * The model kit. Every enemy and turret is a GLB built by
 * `scripts/hackerz-models/build.py` (headless Blender), and every one of them
 * is dressed here in the same three materials, which is what makes twelve
 * different silhouettes read as one world:
 *
 * - **Body**: near-black plating with a fresnel rim and a scan line in the
 *   unit's colour. Lit by nothing — the grid is the only light source.
 * - **Glow / Hot**: unlit and pushed past 1.0, so the bloom pass picks them up.
 * - Every hard crease gets a glowing edge line, the Tron signature.
 *
 * A model that fails to load falls back to a plain block, so a missing asset is
 * an ugly enemy rather than a game that cannot start.
 */

export type ModelId = HackerzEnemyId | `turret-${HackerzTurretId}` | 'turret-rail'

const MODEL_IDS: readonly ModelId[] = [
    'crawler', 'grunt', 'sapper', 'drone', 'brute', 'spitter', 'warden', 'tank', 'artillery', 'gunship',
    'titan', 'leviathan', 'phantom', 'zeroday',
    'turret-gun', 'turret-needler', 'turret-warhead', 'turret-lance', 'turret-rail'
]

/** Creases sharper than this get an edge line. */
const EDGE_ANGLE = 28

interface Template {
    scene: THREE.Object3D
    /** Bounding box of the authored model, for normalising to a gameplay height. */
    box: THREE.Box3
}

const templates = new Map<ModelId, Template>()
let loading: Promise<void> | null = null

/** Loads every model once. Safe to call repeatedly; failures are logged and skipped. */
export function loadModels(base = '/hackerz/models/') {
    if (loading) return loading
    const loader = new GLTFLoader()
    loading = Promise.all(MODEL_IDS.map(async (id) => {
        try {
            const gltf = await loader.loadAsync(`${base}${id}.glb`)
            prepareTemplate(gltf.scene)
            gltf.scene.updateMatrixWorld(true)
            templates.set(id, { scene: gltf.scene, box: new THREE.Box3().setFromObject(gltf.scene) })
        } catch (error) {
            console.warn(`[hackerz] model ${id} failed to load`, error)
        }
    })).then(() => {})
    return loading
}

/** Tags each mesh with its role and precomputes the edge lines it will carry. */
function prepareTemplate(scene: THREE.Object3D) {
    scene.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        const name = (mesh.material as THREE.Material).name || 'Body'
        mesh.userData.role = name.startsWith('Hot') ? 'hot' : name.startsWith('Glow') ? 'glow' : 'body'
        if (mesh.userData.role === 'body') {
            mesh.geometry.userData.edges = new THREE.EdgesGeometry(mesh.geometry, EDGE_ANGLE)
        }
    })
}

// ─── Materials ──────────────────────────────────────────────────────────────

const BODY_VERTEX = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorld;
void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = cameraPosition - world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
}
`

const BODY_FRAGMENT = /* glsl */ `
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uFlash;
uniform float uTime;
uniform float uBase;
/** Red ground's shield: 0 off, 1 fully on. A sheen laid over the plating. */
uniform float uShield;
/** The flare as the shield soaks a hit and breaks, decaying to 0. */
uniform float uShieldHit;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorld;
void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    float facing = clamp(1.0 - abs(dot(n, v)), 0.0, 1.0);
    float fresnel = facing * facing;
    fresnel *= fresnel;
    // Top faces catch a little of the grid's light; everything else stays black.
    float top = clamp(n.y, 0.0, 1.0);
    vec3 col = vec3(0.006, 0.009, 0.016) + vec3(0.012, 0.02, 0.032) * top;
    // The colour lives in the edges; the plating only takes a thin rim of it.
    col += uColor * (fresnel * 0.4 + uBase * 0.02);
    // A thin scan line climbs every unit, so even a stationary body is alive.
    float band = abs(fract(vWorld.y * 0.35 - uTime * 0.45) - 0.5);
    col += uColor * smoothstep(0.03, 0.0, band) * 0.45;
    // The shield: a thin red sheen hugging the plating, brightest where the
    // surface turns away, with a slow shimmer drifting over it. When it soaks
    // a hit it flares across the whole body and fades.
    if (uShield > 0.001 || uShieldHit > 0.001) {
        float shimmer = 0.75 + 0.25 * sin(vWorld.y * 3.0 + vWorld.x * 1.7 - uTime * 2.2);
        vec3 sheen = vec3(1.0, 0.1, 0.08);
        col += sheen * (fresnel * 1.8 + 0.12) * shimmer * uShield;
        col += sheen * (0.6 + fresnel * 2.0) * uShieldHit;
    }
    col += vec3(uFlash);
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
}
`

/** Shared clock for every body material's scan line. */
export const modelClock = { value: 0 }

export function makeBodyMaterial(hex: number) {
    return new THREE.ShaderMaterial({
        uniforms: {
            ...THREE.UniformsLib.fog,
            uColor: { value: new THREE.Color(hex) },
            uFlash: { value: 0 },
            uTime: modelClock,
            uBase: { value: 1 },
            uShield: { value: 0 },
            uShieldHit: { value: 0 }
        },
        vertexShader: BODY_VERTEX,
        fragmentShader: BODY_FRAGMENT,
        fog: true
    })
}

/** HDR colour: past 1.0 so bloom catches it, which is the whole look. */
export function hdr(hex: number, intensity: number) {
    return new THREE.Color(hex).multiplyScalar(intensity)
}

interface Palette {
    glow: THREE.MeshBasicMaterial
    hot: THREE.MeshBasicMaterial
    edge: THREE.LineBasicMaterial
}

const palettes = new Map<number, Palette>()

/** Glow and edge materials are shared per colour; only the body is per instance. */
function palette(hex: number): Palette {
    let p = palettes.get(hex)
    if (!p) {
        p = {
            glow: new THREE.MeshBasicMaterial({ color: hdr(hex, 1.5), toneMapped: false, fog: true }),
            hot: new THREE.MeshBasicMaterial({ color: hdr(0xffffff, 1.9), toneMapped: false, fog: true }),
            edge: new THREE.LineBasicMaterial({ color: hdr(hex, 1.3), toneMapped: false, fog: true })
        }
        palettes.set(hex, p)
    }
    return p
}

// ─── Rigs ───────────────────────────────────────────────────────────────────

/** An instanced model plus the named parts the engine animates. */
export interface ModelRig {
    root: THREE.Group
    /** The per-instance body material: flashed on hit. */
    body: THREE.ShaderMaterial
    legsA: THREE.Object3D[]
    legsB: THREE.Object3D[]
    rolls: THREE.Object3D[]
    spins: THREE.Object3D[]
    yaw: THREE.Object3D | null
    barrel: THREE.Object3D | null
    barrelRestZ: number
    /** World-space height after normalising. */
    height: number
    /** The model's bounds in its root's local space: x across, y up from the ground, z along. */
    box: THREE.Box3
}

/**
 * Instances a model at `height` world units tall, standing on y = 0 and
 * centred on its footprint. Geometry is shared with the template.
 */
export function buildRig(id: ModelId, hex: number, height: number): ModelRig {
    const root = new THREE.Group()
    const body = makeBodyMaterial(hex)
    const colours = palette(hex)
    const template = templates.get(id)

    const rig: ModelRig = {
        root,
        body,
        legsA: [],
        legsB: [],
        rolls: [],
        spins: [],
        yaw: null,
        barrel: null,
        barrelRestZ: 0,
        height,
        box: new THREE.Box3()
    }

    if (!template) {
        root.add(fallbackModel(body, colours, height))
        rig.box.set(new THREE.Vector3(-height * 0.3, 0, -height * 0.3), new THREE.Vector3(height * 0.3, height, height * 0.3))
        return rig
    }

    const model = template.scene.clone(true)
    const size = template.box.getSize(new THREE.Vector3())
    const scale = height / Math.max(0.001, size.y)
    const centre = template.box.getCenter(new THREE.Vector3())
    model.scale.setScalar(scale)
    model.position.set(-centre.x * scale, -template.box.min.y * scale, -centre.z * scale)

    model.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (mesh.isMesh) {
            const role = mesh.userData.role as string
            mesh.material = role === 'hot' ? colours.hot : role === 'glow' ? colours.glow : body
            const edges = mesh.geometry.userData.edges as THREE.BufferGeometry | undefined
            if (edges) mesh.add(new THREE.LineSegments(edges, colours.edge))
            return
        }
        const name = node.name
        if (name.startsWith('legA')) rig.legsA.push(node)
        else if (name.startsWith('legB')) rig.legsB.push(node)
        else if (name.startsWith('roll')) rig.rolls.push(node)
        else if (name.startsWith('spin')) rig.spins.push(node)
        else if (name === 'yaw') rig.yaw = node
        else if (name === 'barrel') {
            rig.barrel = node
            rig.barrelRestZ = node.position.z
        }
    })

    root.add(model)
    // The whole model, root-local, with a little margin: what a click and a
    // round are tested against, so every visible part of a unit is part of it.
    rig.box.min.set(-size.x * scale / 2, 0, -size.z * scale / 2).multiplyScalar(1.05)
    rig.box.max.set(size.x * scale / 2, height, size.z * scale / 2).multiplyScalar(1.05)
    return rig
}

function fallbackModel(body: THREE.Material, colours: Palette, height: number) {
    const group = new THREE.Group()
    const geometry = new THREE.BoxGeometry(height * 0.6, height, height * 0.6)
    const block = new THREE.Mesh(geometry, body)
    block.position.y = height / 2
    block.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), colours.edge))
    group.add(block)
    return group
}

/** Releases the per-instance material; geometry and palettes are shared and stay. */
export function disposeRig(rig: ModelRig) {
    rig.body.dispose()
    rig.root.removeFromParent()
}

/**
 * Walk cycle, wheel roll and halo spin. `stride` is radians of leg swing,
 * advanced by distance walked, so a knocked-back unit never moon-walks.
 */
export function poseRig(rig: ModelRig, stride: number, dt: number, rollSpeed: number) {
    const swing = Math.sin(stride) * 0.55
    for (const leg of rig.legsA) leg.rotation.x = swing
    for (const leg of rig.legsB) leg.rotation.x = -swing
    for (const wheel of rig.rolls) wheel.rotation.x += rollSpeed * dt
    for (const spinner of rig.spins) spinner.rotation.y += dt * 2.2
}
