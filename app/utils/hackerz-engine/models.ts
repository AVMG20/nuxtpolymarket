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
    'titan', 'leviathan', 'phantom', 'zeroday', 'spiderling',
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

/** Matches `DARK_ZONES` in the scene: how many dark-zone slots the shroud reads. */
const SHROUD_ZONES = 3

/**
 * The darkness that hides hostiles: a cluster's dead lights, and a Blackout's
 * dark beyond the light line. Shared by every rig's materials; the engine
 * points `dark` at the scene's zone slots and keeps `blackout` up to date.
 */
export const shroud = {
    /** (x, z, radius, strength) in world units, one per dark-zone slot. */
    dark: { value: Array.from({ length: SHROUD_ZONES }, () => new THREE.Vector4()) },
    /** x: Blackout strength 0–1; y: the world z of its light line (further is dark). */
    blackout: { value: new THREE.Vector2(0, -1000) }
}

/**
 * How hidden a point is, 0 seen to 1 unseen. Fades in over a band rather than
 * at a line, so a unit stepping out of the dark comes into view a part at a
 * time — whatever is still inside stays hidden. A radar ping (`uReveal`)
 * lifts it for the unit it lit.
 */
const SHROUD_GLSL = /* glsl */ `
uniform vec4 uShroudDark[${SHROUD_ZONES}];
uniform vec2 uShroudBlackout;
uniform float uReveal;
float shroudAt(vec3 w) {
    float k = 0.0;
    for (int i = 0; i < ${SHROUD_ZONES}; i++) {
        vec4 z = uShroudDark[i];
        if (z.z <= 0.0 || z.w <= 0.0) continue;
        k = max(k, z.w * (1.0 - smoothstep(z.z * 0.6, z.z, length(w.xz - z.xy))));
    }
    k = max(k, uShroudBlackout.x * (1.0 - smoothstep(uShroudBlackout.y - 2.0, uShroudBlackout.y + 2.0, w.z)));
    return k * (1.0 - uReveal);
}
// A hidden fragment is not drawn at all — a black body would still blot out
// the glow behind it — and the fade in between dissolves through a fixed 4x4
// dither, so a unit leaving the dark resolves out of it grain by grain.
float shroudDither() {
    vec2 p = mod(floor(gl_FragCoord.xy), 4.0);
    float i = p.x + p.y * 4.0;
    float b = 0.0;
    if (i < 0.5) b = 0.0; else if (i < 1.5) b = 8.0; else if (i < 2.5) b = 2.0; else if (i < 3.5) b = 10.0;
    else if (i < 4.5) b = 12.0; else if (i < 5.5) b = 4.0; else if (i < 6.5) b = 14.0; else if (i < 7.5) b = 6.0;
    else if (i < 8.5) b = 3.0; else if (i < 9.5) b = 11.0; else if (i < 10.5) b = 1.0; else if (i < 11.5) b = 9.0;
    else if (i < 12.5) b = 15.0; else if (i < 13.5) b = 7.0; else if (i < 14.5) b = 13.0; else b = 5.0;
    return (b + 0.5) / 16.0;
}
`

function shroudUniforms(reveal: { value: number }) {
    return { uShroudDark: shroud.dark, uShroudBlackout: shroud.blackout, uReveal: reveal }
}

/** Puts a basic (mesh or line) material under the shroud. */
function shrouded<M extends THREE.MeshBasicMaterial | THREE.LineBasicMaterial>(material: M, reveal: { value: number }): M {
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, shroudUniforms(reveal))
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vShroudWorld;')
            .replace('#include <project_vertex>', '#include <project_vertex>\nvShroudWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\nvarying vec3 vShroudWorld;\n${SHROUD_GLSL}`)
            .replace('#include <fog_fragment>', `float shrouded = shroudAt(vShroudWorld);
if (shrouded > shroudDither()) discard;
gl_FragColor.rgb *= 1.0 - shrouded * 0.5;
#include <fog_fragment>`)
    }
    material.customProgramCacheKey = () => 'hackerz-shroud'
    return material
}

const BODY_VERTEX = /* glsl */ `
#include <fog_pars_vertex>
uniform float uTime;
/** Corrupted by a blast, 0 to 1: the body tears into horizontal bands that jump sideways. */
uniform float uGlitch;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorld;
void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    if (uGlitch > 0.001) {
        // A new tear every few frames: the body is cut into bands by height,
        // and a random few of them slip sideways, stretching the faces that
        // span the cut into torn slivers.
        float frame = floor(uTime * 22.0);
        float slice = floor(world.y * 2.6 + frame * 1.7);
        float r = fract(sin(slice * 12.9898 + frame * 78.233) * 43758.5453);
        if (r > 0.5) {
            world.x += (r - 0.75) * 3.2 * uGlitch;
            world.z += (fract(r * 7.13) - 0.5) * 0.8 * uGlitch;
        }
    }
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
${SHROUD_GLSL}
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
    float shrouded = shroudAt(vWorld);
    if (shrouded > shroudDither()) discard;
    col *= 1.0 - shrouded * 0.5;
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
}
`

/** Shared clock for every body material's scan line. */
export const modelClock = { value: 0 }

export function makeBodyMaterial(hex: number, reveal: { value: number } = { value: 1 }) {
    return new THREE.ShaderMaterial({
        uniforms: {
            ...THREE.UniformsLib.fog,
            uColor: { value: new THREE.Color(hex) },
            uFlash: { value: 0 },
            uTime: modelClock,
            uBase: { value: 1 },
            uShield: { value: 0 },
            uShieldHit: { value: 0 },
            uGlitch: { value: 0 },
            ...shroudUniforms(reveal)
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
    /** Where the barrel rests, in its parent's space; `kickBarrel` recoils it from here. */
    barrelRest: THREE.Vector3
    /** A melee weapon on its own pivot (the Warden's prod), and how it rests; null for anything without one. */
    weapon: THREE.Object3D | null
    weaponRest: { position: THREE.Vector3, rotationX: number }
    /** How the weapon is driven: a jab (a prod, thrust and lifted) or a ram (a plate slammed straight out on pistons). */
    weaponKind: 'jab' | 'ram'
    /** Arms on shoulder pivots, swung by a heave (the Daemon lifting a leaked block over its head). */
    lifts: THREE.Object3D[]
    /**
     * Legs of a multi-beat gait (the Lancer's tripod), in stepping order; empty
     * for a two-legged walker. With them, `sway` is the node the body rocks on.
     */
    gaitLegs: THREE.Object3D[]
    sway: THREE.Object3D | null
    /** Gait cycles per stride cycle: how quickly the legs step for the ground covered; and how many beats a cycle has. */
    gaitRate: number
    gaitBeats: number
    /**
     * A unit built round a gem (ZERO DAY's heart): the gem, and every other
     * mesh it is made of, which can come apart and regrow from it.
     */
    core: THREE.Mesh | null
    blocks: THREE.Mesh[]
    /** ROOTKIT's injecting forelegs, on their own pivots (their rest tilt in `userData.restX`). */
    fangs: THREE.Object3D[]
    /** Fixed gun tips a unit without a swinging barrel fires from (the Gunship's pair), in order. */
    muzzles: THREE.Object3D[]
    /** Spike meshes on a Sapper's cage, blown off when it goes up (see `Shrapnel`). */
    spikes: THREE.Mesh[]
    /** The pieces of a carried shield (the Warden's tower shield), shattered off when it breaks. */
    guardParts: THREE.Mesh[]
    /** The stride last posed, and how much the legs swing (0 standing, 1 walking), eased between. */
    gait: { stride: number, amount: number }
    /** World-space height after normalising. */
    height: number
    /** The model's bounds in its root's local space: x across, y up from the ground, z along. */
    box: THREE.Box3
    /** 0–1: how far a radar ping has lifted the shroud off this unit. 1 for anything never shrouded. */
    reveal: { value: number }
    /** Materials this rig owns outright (its shrouded copies), released with it. */
    owned: THREE.Material[]
}

/**
 * Instances a model at `height` world units tall, standing on y = 0 and
 * centred on its footprint. Geometry is shared with the template.
 */
export function buildRig(id: ModelId, hex: number, height: number, options: { shrouded?: boolean } = {}): ModelRig {
    const root = new THREE.Group()
    // A hostile can be hidden by the dark, so it gets its own copies of the
    // shared glow and edge materials with the shroud worked in; the player's
    // hardware is never in the dark and keeps the shared ones.
    const reveal = { value: options.shrouded ? 0 : 1 }
    const body = makeBodyMaterial(hex, reveal)
    const shared = palette(hex)
    const colours: Palette = options.shrouded
        ? { glow: shrouded(shared.glow.clone(), reveal), hot: shrouded(shared.hot.clone(), reveal), edge: shrouded(shared.edge.clone(), reveal) }
        : shared
    const template = templates.get(id)

    const rig: ModelRig = {
        reveal,
        owned: options.shrouded ? [colours.glow, colours.hot, colours.edge] : [],
        root,
        body,
        legsA: [],
        legsB: [],
        rolls: [],
        spins: [],
        yaw: null,
        barrel: null,
        barrelRestZ: 0,
        barrelRest: new THREE.Vector3(),
        weapon: null,
        weaponRest: { position: new THREE.Vector3(), rotationX: 0 },
        weaponKind: 'jab',
        lifts: [],
        gaitLegs: [],
        sway: null,
        gaitRate: GAIT_STEPS_PER_CYCLE,
        gaitBeats: 0,
        muzzles: [],
        core: null,
        blocks: [],
        fangs: [],
        spikes: [],
        guardParts: [],
        gait: { stride: 0, amount: 0 },
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
            if (mesh.name === 'heart') rig.core = mesh
            else rig.blocks.push(mesh)
            if (mesh.name.startsWith('spike')) rig.spikes.push(mesh)
            else if (mesh.name === 'towerShield' || mesh.name.startsWith('shieldTrim') || mesh.name === 'shieldCrest') rig.guardParts.push(mesh)
            return
        }
        const name = node.name
        if (name.startsWith('legA')) rig.legsA.push(node)
        else if (name.startsWith('legB')) rig.legsB.push(node)
        else if (name.startsWith('roll')) rig.rolls.push(node)
        else if (name.startsWith('spin')) rig.spins.push(node)
        else if (name.startsWith('lift')) rig.lifts.push(node)
        else if (name.startsWith('muzzle')) rig.muzzles.push(node)
        else if (name.startsWith('fang')) {
            node.userData.restX = node.rotation.x
            rig.fangs.push(node)
        }
        else if (name.startsWith('gait')) {
            node.userData.restY = node.position.y
            // 'gaitS…': a leg out to the side, stepped round its hip rather than swung under it.
            node.userData.sideways = name.startsWith('gaitS')
            // The digit after it is the beat it steps on: legs sharing one step
            // together (an insect's tripod).
            node.userData.beat = Number(/^gaitS?(\d)/.exec(name)?.[1] ?? 0)
            rig.gaitLegs.push(node)
        }
        else if (name === 'yaw') rig.yaw = node
        else if (name === 'barrel') {
            rig.barrel = node
            rig.barrelRestZ = node.position.z
            rig.barrelRest.copy(node.position)
        } else if (name === 'weapon' || name === 'ram') {
            rig.weapon = node
            rig.weaponKind = name === 'ram' ? 'ram' : 'jab'
            rig.weaponRest.position.copy(node.position)
            rig.weaponRest.rotationX = node.rotation.x
        }
    })

    root.add(model)
    rig.muzzles.sort((a, b) => a.name.localeCompare(b.name))
    // Blocks only matter to a unit with a gem to rebuild from.
    if (!rig.core) rig.blocks = []
    if (rig.gaitLegs.length) {
        rig.gaitLegs.sort((a, b) => a.name.localeCompare(b.name))
        rig.sway = model
        for (const leg of rig.gaitLegs) leg.userData.knee = leg.children.find(c => c.name.startsWith('knee')) ?? null
        rig.gaitBeats = Math.max(...rig.gaitLegs.map(leg => leg.userData.beat as number)) + 1
        rig.gaitRate = GAIT_RATE[id] ?? GAIT_STEPS_PER_CYCLE
    }
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
    for (const material of rig.owned) material.dispose()
    rig.root.removeFromParent()
}

const _axis = new THREE.Vector3()

/**
 * Recoil: slides the barrel back along its own axis by `kick` (model units) —
 * along the tube, so a barrel cranked skyward recoils down and back rather
 * than sideways. 0 puts it back at rest.
 */
export function kickBarrel(rig: ModelRig, kick: number) {
    const barrel = rig.barrel
    if (!barrel) return
    // Tubes are authored pointing forward, which is +z once exported.
    _axis.set(0, 0, 1).applyQuaternion(barrel.quaternion)
    barrel.position.copy(rig.barrelRest).addScaledVector(_axis, -kick)
}

/**
 * A multi-beat gait (the Lancer's tripod): steps per stride cycle, how far a
 * leg swings fore and aft (radians), how high a stepping leg lifts (model
 * units) and how far the body rocks off a lifted side leg (radians).
 */
const GAIT_STEPS_PER_CYCLE = 1.5
const GAIT_REACH = 0.32
const GAIT_LIFT = 0.16
const GAIT_SWAY = 0.12
/**
 * Sideways legs: their pivot fore and aft (as a multiple of GAIT_REACH), and
 * how far the hip raises a stepping leg (radians).
 */
const GAIT_SIDE_REACH = 1.6
const GAIT_SIDE_LIFT = 0.55
/**
 * Gait cycles per stride cycle, where a model's differs from the default: a
 * spiderling covers many times its own size a second, so its cycle is slowed
 * until each step reads instead of blurring.
 */
const GAIT_RATE: Partial<Record<ModelId, number>> = { spiderling: 0.28, titan: 1.2 }

/**
 * A leg out to the side (a spiderling's, ROOTKIT's) steps on its joints: the
 * hip is fixed to the body and raises, lowers and pivots the upper leg; the
 * knee sets the lower leg. `swing` is how far through its step it is (0–1),
 * or null while it is planted, `stance` how far through its push (0–1).
 *
 *  1. rest: planted;
 *  2. the upper leg rises at the hip, the knee and lower leg carried up with
 *     it, the lower leg turning to hang straight down;
 *  3. raised, the upper leg pivots forward at the hip;
 *  4. the lower leg swings back out to its resting angle;
 *  5. the upper leg comes down, planting the foot;
 *  6. planted, the upper leg pivots back to rest, pushing the body on — and
 *     from there it is step 2 again.
 *
 * Stopping eases every joint back to rest (`amount`). Returns how far the
 * foot is lifted (0–1), for the body's rock.
 */
function poseSideLeg(leg: THREE.Object3D, swing: number | null, stance: number, side: number, amount: number) {
    const knee = leg.userData.knee as THREE.Object3D | null
    // How far forward of rest the hip has the leg (0 rest, 1 fully forward), how
    // far it is raised, and how much of the raise the knee takes back so the
    // lower leg hangs plumb.
    let forward: number
    let raise = 0
    let plumb = 0
    if (swing !== null) {
        const t = swing
        if (t < 0.25) {
            raise = easeStep(t / 0.25)
            plumb = raise
            forward = 0
        } else if (t < 0.55) {
            raise = 1
            plumb = 1
            forward = easeStep((t - 0.25) / 0.3)
        } else if (t < 0.75) {
            raise = 1
            plumb = 1 - easeStep((t - 0.55) / 0.2)
            forward = 1
        } else {
            raise = 1 - easeStep((t - 0.75) / 0.25)
            forward = 1
        }
    } else {
        forward = 1 - stance
    }
    // Forward is a negative turn about the upright for a leg on either side.
    leg.rotation.y = -side * forward * GAIT_REACH * GAIT_SIDE_REACH * amount
    leg.rotation.z = side * raise * GAIT_SIDE_LIFT * amount
    if (knee) knee.rotation.z = -side * plumb * GAIT_SIDE_LIFT * amount
    return raise
}

function easeStep(t: number) {
    const c = Math.min(1, Math.max(0, t))
    return c * c * (3 - 2 * c)
}

/**
 * One leg at a time: each in turn lifts and swings forward, then plants and
 * pushes back while the others take their step. With a side leg in the air
 * the body rocks over onto the side still standing.
 */
function poseGait(rig: ModelRig, stride: number, amount: number) {
    const legs = rig.gaitLegs
    const n = rig.gaitBeats
    const cycle = ((stride * rig.gaitRate / (Math.PI * 2)) % 1 + 1) % 1
    const swingShare = 1 / n
    let sway = 0
    legs.forEach((leg) => {
        const phase = ((cycle - (leg.userData.beat as number) / n) % 1 + 1) % 1
        const side = Math.sign(Math.round(leg.position.x * 100))
        if (leg.userData.sideways) {
            sway += poseSideLeg(leg, phase < swingShare ? phase / swingShare : null,
                phase < swingShare ? 0 : (phase - swingShare) / (1 - swingShare), side, amount)
            return
        }
        let angle: number
        let lift = 0
        if (phase < swingShare) {
            // Up and forward (forward is a negative swing about x).
            const t = phase / swingShare
            angle = GAIT_REACH * (1 - 2 * t * t * (3 - 2 * t))
            lift = Math.sin(t * Math.PI)
        } else {
            // Planted, pushing back as the body passes over it.
            angle = -GAIT_REACH + 2 * GAIT_REACH * (phase - swingShare) / (1 - swingShare)
        }
        leg.rotation.x = angle * amount
        leg.position.y = (leg.userData.restY as number) + lift * GAIT_LIFT * amount
        sway += lift * side
    })
    // A tripod keeps its balance: three down at all times, so no rocking.
    if (rig.sway) rig.sway.rotation.z = sway * GAIT_SWAY * amount * (legs.length > n ? 0 : 1)
}

/**
 * Walk cycle, wheel roll and halo spin. `stride` is radians of leg swing,
 * advanced by distance walked, so a knocked-back unit never moon-walks.
 */
export function poseRig(rig: ModelRig, stride: number, dt: number, rollSpeed: number) {
    // Legs only move when the unit does: standing still (holding, hacking,
    // striking the fence) they settle back together rather than tread air.
    const gait = rig.gait
    const walking = stride !== gait.stride
    gait.stride = stride
    gait.amount += ((walking ? 1 : 0) - gait.amount) * Math.min(1, dt * (walking ? 10 : 6))
    const swing = Math.sin(stride) * 0.55 * gait.amount
    for (const leg of rig.legsA) leg.rotation.x = swing
    for (const leg of rig.legsB) leg.rotation.x = -swing
    if (rig.gaitLegs.length) poseGait(rig, stride, gait.amount)
    for (const wheel of rig.rolls) wheel.rotation.x += rollSpeed * dt
    for (const spinner of rig.spins) spinner.rotation.y += dt * 2.2
}
