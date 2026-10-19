import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import {
    FIELD_DEPTH, FIELD_HALF_WIDTH, FIELD_SCALE, MOUNT_BACK_RISE, MOUNT_U, SPAWN_SPREAD, SPIKE_BAND, mountPosition,
    DECK_FRONT, FENCE_HEIGHT, GUN_Z, SHIELD_D, WALL_HALF_LENGTH, WALL_HEIGHT, WALL_THICKNESS
} from './constants'
import { hdr, modelClock } from './models'
import { randRange } from './math'
import { SpawnPortal } from './spawn-portal'
import type { DataNetwork } from './data-lines'

export const CYAN = 0x22d3ee
export const AMBER = 0xfbbf24
export const RED = 0xf87171
export const LIME = 0x4ade80

/** Field (u, d) to world space. The wall face is z = 0 and the field runs to -z. */
export function fieldToWorld(u: number, d: number, y = 0, out = new THREE.Vector3()) {
    return out.set(u * FIELD_SCALE, y, -d * FIELD_SCALE)
}

const SCRUB_SHADER = {
    uniforms: { tDiffuse: { value: null }, uCeiling: { value: 14 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // One NaN pixel turns into a black rectangle once bloom blurs it across its
    // mip chain, so scrub the HDR buffer before bloom sees it.
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uCeiling; varying vec2 vUv;
        void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            if (!(c.r == c.r && c.g == c.g && c.b == c.b) || max(c.r, max(c.g, c.b)) > 60000.0) c = vec4(0.0, 0.0, 0.0, 1.0);
            gl_FragColor = vec4(min(c.rgb, vec3(uCeiling)), 1.0);
        }`
}

/** Vignette and a faint scanline, applied after bloom so the glow is not dimmed twice. */
const FINAL_SHADER = {
    uniforms: { tDiffuse: { value: null }, uFlash: { value: new THREE.Vector3() }, uFlashAmount: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 uFlash; uniform float uFlashAmount; varying vec2 vUv;
        void main() {
            vec3 c = texture2D(tDiffuse, vUv).rgb;
            vec2 p = vUv - 0.5;
            float vignette = smoothstep(0.85, 0.25, length(p * vec2(1.1, 1.0)));
            c *= mix(0.55, 1.0, vignette);
            c += uFlash * uFlashAmount;
            gl_FragColor = vec4(c, 1.0);
        }`
}

// ─── The floor ──────────────────────────────────────────────────────────────

const GRID_VERTEX = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
}
`

/**
 * The grid is drawn analytically rather than as line geometry: a line mesh this
 * dense aliases into moire at the horizon, where a screen-space derivative
 * keeps every line about one pixel wide however far away it is.
 */
export const FRONT_COLUMNS = 32
/** Most islands of each colour at once: one per path node (`PATH_NODE_COUNT`). */
export const ISLANDS = 8
/** Most dark zones at once: a cluster takes three nodes, and there are eight. */
export const DARK_ZONES = 3

/**
 * Territory, shared by the floor, the circuit traces and their pads so every
 * glowing line on the ground takes the colour of the ground it runs across.
 * Two lines cross the lane, each a depth per column fed by the engine from the
 * path nodes: past the red line the intrusion owns the ground, between it and
 * the orange line the ground is disputed, and short of the orange line it is
 * held. There is no drawn border — the colours blend over a wide band that
 * drifts slowly, so the edge reads as a swarm rather than a ruled line.
 */
const TERRITORY_GLSL = /* glsl */ `
uniform float uHalfWidth;
uniform float uScale;
uniform float uRed[${FRONT_COLUMNS}];
uniform float uOrange[${FRONT_COLUMNS}];
/** Islands cut off from the lines: (x, z, radius) in world units; radius 0 is unused. */
uniform vec4 uRedIsland[${ISLANDS}];
uniform vec4 uOrangeIsland[${ISLANDS}];
/** 0–1: the ground behind the fence turning disputed once every node is theirs. */
uniform float uGate;
/** Dark zones over clusters of hacked nodes: (x, z, radius, strength) in world units. */
uniform vec4 uDark[${DARK_ZONES}];

/** How dark the ground is here: 0 lit, 1 a cluster's lights fully out. */
float darkness(vec2 p) {
    float k = 0.0;
    for (int i = 0; i < ${DARK_ZONES}; i++) {
        vec4 z = uDark[i];
        if (z.z <= 0.0 || z.w <= 0.0) continue;
        k = max(k, z.w * smoothstep(z.z, z.z * 0.6, length(p - z.xy)));
    }
    return k;
}

const vec3 HELD = vec3(0.10, 0.42, 1.0);
const vec3 CONTESTED = vec3(1.0, 0.45, 0.08);
const vec3 THEIRS = vec3(1.0, 0.08, 0.07);

/** The red and orange line depths under a point, in field units from the fence. */
vec2 zoneLines(vec2 p) {
    float t = clamp((p.x / uHalfWidth) * 0.5 + 0.5, 0.0, 1.0) * float(${FRONT_COLUMNS - 1});
    int i = int(floor(t));
    int j = min(i + 1, ${FRONT_COLUMNS - 1});
    float f = fract(t);
    return vec2(mix(uRed[i], uRed[j], f), mix(uOrange[i], uOrange[j], f));
}

vec3 zoneColour(vec2 p) {
    // Behind the fence face is held — until every node falls and the gate
    // itself is disputed, when it fades to orange with the rest.
    if (p.y > 0.0) return mix(HELD, CONTESTED, uGate);
    float d = -p.y / uScale;
    vec2 lines = zoneLines(p);
    // A slow, layered drift so the boundary breathes instead of sitting still.
    float drift = sin(p.x * 0.31 + uTime * 0.55) * 9.0
        + sin(p.x * 0.13 - p.y * 0.19 + uTime * 0.37) * 14.0
        + sin(p.y * 0.27 + p.x * 0.07 - uTime * 0.71) * 7.0;
    float contested = smoothstep(-55.0, 35.0, d - lines.y + drift);
    float theirs = smoothstep(-35.0, 55.0, d - lines.x + drift);
    // Islands: a pool of colour around a node, its rim drifting like the lines.
    for (int i = 0; i < ${ISLANDS}; i++) {
        vec4 r = uRedIsland[i];
        if (r.z > 0.0) theirs = max(theirs, smoothstep(r.z + 2.0, r.z - 2.0, length(p - r.xy) + drift * uScale));
        vec4 o = uOrangeIsland[i];
        if (o.z > 0.0) contested = max(contested, smoothstep(o.z + 2.5, o.z - 2.5, length(p - o.xy) + drift * uScale));
    }
    return mix(mix(HELD, CONTESTED, contested), THEIRS, theirs);
}
`

/** How many deaths can be grounding into the traces at once, and for how long. */
export const SURGES = 8
const SURGE_LIFE = 1.4

/**
 * A death grounds into the floor: a ring of the unit's colour races outward
 * from where it fell, lighting whatever lines it crosses, with a bright core
 * at the point of discharge.
 */
const SURGE_GLSL = /* glsl */ `
uniform vec4 uSurge[${SURGES}];
uniform vec3 uSurgeColor[${SURGES}];
uniform float uSurgeReach[${SURGES}];

vec3 surge(vec2 p) {
    vec3 glow = vec3(0.0);
    for (int i = 0; i < ${SURGES}; i++) {
        vec4 s = uSurge[i];
        if (s.z < 0.0 || s.z > ${SURGE_LIFE.toFixed(2)}) continue;
        float d = length(p - s.xy);
        // A blast's ripple races out to its reach and holds there as it fades;
        // a death's runs on until it dies away.
        float reach = uSurgeReach[i];
        float radius = reach > 0.0
            ? reach * min(1.0, s.z / ${(SURGE_LIFE * 0.35).toFixed(2)})
            : s.z * 16.0 * (0.7 + 0.3 * s.w);
        // The wavefront, the charge left behind it, and the point of discharge.
        float ring = exp(-abs(d - radius) * 0.9);
        float charged = smoothstep(radius + 1.0, radius - 2.0, d);
        float core = exp(-d * 0.35) * max(0.0, 1.0 - s.z * 1.5);
        float fade = 1.0 - s.z / ${SURGE_LIFE.toFixed(2)};
        glow += uSurgeColor[i] * (ring * 2.4 + charged * 1.1 + core * 3.0) * fade * fade * s.w;
    }
    return glow;
}
`

const GRID_FRAGMENT = /* glsl */ `
#include <fog_pars_fragment>
uniform float uTime;
uniform float uSpawnZ;
uniform float uZones;
/** 1 on the deck you fight from: heavier tile lines and a blue sheen. */
uniform float uDeck;
varying vec3 vWorld;
${TERRITORY_GLSL}
${SURGE_GLSL}

float gridLine(vec2 p, float spacing, float width) {
    vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
    vec2 w = fwidth(p) * width;
    vec2 l = 1.0 - smoothstep(vec2(0.0), w, g);
    return max(l.x, l.y);
}

void main() {
    vec2 p = vWorld.xz;
    float weight = mix(1.0, 2.4, uDeck);
    float minor = gridLine(p, 2.0, weight);
    float major = gridLine(p, 10.0, 1.6 * weight);
    float inLane = step(abs(p.x), uHalfWidth);
    vec3 zone = vec3(0.25, 0.85, 1.0);
    if (uZones > 0.5) zone = zoneColour(p);
    vec3 col = vec3(0.004, 0.008, 0.016) + zone * 0.018 * inLane;
    if (uDeck > 0.5) {
        // Deck tiles: a faint blue fill, brighter toward each tile's centre, and a
        // slow glossy sheen sweeping across the panels.
        vec2 cell = abs(fract(p / 2.0) - 0.5) * 2.0;
        float centre = 1.0 - max(cell.x, cell.y);
        float sheen = smoothstep(0.82, 1.0, sin((p.x * 0.6 + p.y) * 0.18 - uTime * 0.5));
        col += vec3(0.012, 0.04, 0.11) * (0.6 + 0.4 * centre) + vec3(0.02, 0.07, 0.16) * sheen;
    }
    col += zone * vec3(0.12, 0.17, 0.22) * minor * mix(0.3, 0.6, inLane);
    col += zone * vec3(0.32, 0.45, 0.55) * major * mix(0.45, 0.9, inLane);
    // A slow pulse rolls in from the spawn line toward the wall.
    float wave = fract((p.y - uSpawnZ) * 0.02 + uTime * 0.12);
    col += zone * 0.25 * smoothstep(0.96, 1.0, wave) * major * 3.0;
    // Lane edges: two hard rails the enemies walk between.
    float edge = 1.0 - smoothstep(0.0, fwidth(p.x) * 2.5, abs(abs(p.x) - uHalfWidth));
    col += zone * vec3(0.8, 1.0, 1.3) * edge;
    // A death's surge washes over the grid lines too, fainter than the traces.
    col += surge(p) * (minor * 0.6 + major * 1.0);
    // A cluster of hacked nodes has put the lights out here.
    if (uZones > 0.5) col *= 1.0 - 0.88 * darkness(p);
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
}
`

/** The trap band in front of the wall: dark until Grid Trap is bought, then live. */
const TRAP_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uLevel;
varying vec2 vUv;
void main() {
    vec2 cell = vUv * vec2(56.0, 8.0);
    vec2 g = abs(fract(cell) - 0.5);
    float line = smoothstep(0.47, 0.5, max(g.x, g.y));
    float flicker = 0.65 + 0.35 * sin(uTime * 23.0 + floor(cell.x) * 1.7 + floor(cell.y) * 3.1);
    float fade = 1.0 - vUv.y * 0.5;
    vec3 col = vec3(2.2, 0.75, 0.2) * line * flicker * fade * uLevel;
    gl_FragColor = vec4(col, line * uLevel * 0.9);
}
`

/** The barrier: a sheet of light in front of the wall, as strong as the shield. */
const SHIELD_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform float uHit;
/** 0–1: the lattice turns disputed orange with the ground once every node is theirs. */
uniform float uGate;
varying vec2 vUv;
void main() {
    float scan = 0.5 + 0.5 * sin(vUv.y * 90.0 - uTime * 6.0);
    vec2 cell = vec2(vUv.x * 80.0, vUv.y * 6.0);
    vec2 g = abs(fract(cell) - 0.5);
    float lattice = smoothstep(0.44, 0.5, max(g.x, g.y));
    float fade = smoothstep(1.0, 0.2, vUv.y);
    float a = (0.05 + lattice * 0.5 + scan * 0.05) * fade * uStrength + uHit * fade * 0.6;
    gl_FragColor = vec4(mix(vec3(0.4, 1.6, 2.2), vec3(2.8, 0.75, 0.05), uGate) * a, a);
}
`

const UV_VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

/**
 * Circuit traces carry little packets of light toward the wall, and glow in the
 * colour of whichever side holds the ground under them. The pads at their ends
 * share the shader, with no packet distance.
 */
const TRACE_VERTEX = /* glsl */ `
attribute float aDist;
varying float vDist;
varying vec3 vWorld;
void main() {
    vDist = aDist;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`

const TRACE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uPackets;
varying float vDist;
varying vec3 vWorld;
${TERRITORY_GLSL}
${SURGE_GLSL}
void main() {
    float packet = smoothstep(0.92, 1.0, fract(vDist * 0.04 - uTime * 0.35)) * uPackets;
    vec3 col = zoneColour(vWorld.xz) * uIntensity * (0.3 + packet * 3.5);
    col += surge(vWorld.xz) * 2.2;
    col *= 1.0 - 0.88 * darkness(vWorld.xz);
    gl_FragColor = vec4(col, 1.0);
}
`

export interface WallVisual {
    group: THREE.Group
    /** The glowing band along the wall face — recoloured by integrity. */
    band: THREE.MeshBasicMaterial
    edge: THREE.LineBasicMaterial
    /** The faint field between the rails, tinted with the wall. */
    field: THREE.ShaderMaterial
}

export class HackerzScene {
    readonly renderer: THREE.WebGLRenderer
    readonly scene = new THREE.Scene()
    readonly camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.5, 400)
    readonly composer: EffectComposer
    readonly overlay: HTMLCanvasElement
    readonly overlayCtx: CanvasRenderingContext2D

    private bloom: UnrealBloomPass
    private finalPass: ShaderPass
    private gridMaterial: THREE.ShaderMaterial
    private traceMaterial: THREE.ShaderMaterial
    private networkMaterial: THREE.ShaderMaterial
    private networkPadMaterial: THREE.ShaderMaterial
    private padGeometry = new THREE.BoxGeometry(0.55, 0.06, 0.55)
    readonly trapMaterial: THREE.ShaderMaterial
    readonly shieldMaterial: THREE.ShaderMaterial
    readonly wall: WallVisual
    readonly mountPads: THREE.Mesh[] = []
    private portal: SpawnPortal | null = null

    /** Camera rest position; shake is applied on top of it. */
    readonly cameraHome = new THREE.Vector3(0, 30, 34)
    readonly cameraTarget = new THREE.Vector3(0, 0, -17)

    /** Per lane column, in field units from the fence: where their ground ends. Fed by the engine. */
    readonly redLine: number[] = Array.from({ length: FRONT_COLUMNS }, () => FIELD_DEPTH)
    /** Per lane column: where disputed ground ends and held ground begins. */
    readonly orangeLine: number[] = Array.from({ length: FRONT_COLUMNS }, () => FIELD_DEPTH)
    /** Island pools in world units, (x, z, radius, unused): fed by the engine; radius 0 is off. */
    readonly redIslands = Array.from({ length: ISLANDS }, () => new THREE.Vector4())
    readonly orangeIslands = Array.from({ length: ISLANDS }, () => new THREE.Vector4())
    /** Shared uniform: how far the ground behind the fence has turned disputed (0–1). */
    readonly gate = { value: 0 }
    /** Dark zones in world units, (x, z, radius, strength): fed by the engine; strength 0 is off. */
    readonly darkZones = Array.from({ length: DARK_ZONES }, () => new THREE.Vector4())
    /** Death surges in flight: (x, z, age seconds, strength); age < 0 is a free slot. */
    readonly surges = Array.from({ length: SURGES }, () => new THREE.Vector4(0, 0, -1, 0))
    readonly surgeColours = Array.from({ length: SURGES }, () => new THREE.Color())
    /** How far each surge's ripple runs, in world units; 0 lets it run on (a death). */
    readonly surgeReach: number[] = Array.from({ length: SURGES }, () => 0)
    private surgeCursor = 0

    width = 1
    height = 1
    private resScale = 1
    private frameAcc = 0
    private frameCount = 0
    private fastWindows = 0
    private flashAmount = 0

    constructor(private host: HTMLElement) {
        const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false })
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.05
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.domElement.classList.add('block', 'touch-none')
        Object.assign(renderer.domElement.style, { width: '100%', height: '100%' })
        host.appendChild(renderer.domElement)
        this.renderer = renderer

        this.overlay = document.createElement('canvas')
        Object.assign(this.overlay.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' })
        host.appendChild(this.overlay)
        this.overlayCtx = this.overlay.getContext('2d')!

        this.scene.background = new THREE.Color(0x010207)
        this.scene.fog = new THREE.Fog(0x010207, 45, 120)

        const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
        this.composer = new EffectComposer(renderer, target)
        this.composer.addPass(new RenderPass(this.scene, this.camera))
        this.composer.addPass(new ShaderPass(SCRUB_SHADER))
        this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 0.82)
        this.composer.addPass(this.bloom)
        this.finalPass = new ShaderPass(FINAL_SHADER)
        this.composer.addPass(this.finalPass)
        this.composer.addPass(new OutputPass())

        this.camera.position.copy(this.cameraHome)
        this.camera.lookAt(this.cameraTarget)

        this.gridMaterial = new THREE.ShaderMaterial({
            uniforms: {
                ...THREE.UniformsLib.fog,
                uTime: modelClock,
                uHalfWidth: { value: FIELD_HALF_WIDTH * FIELD_SCALE },
                uSpawnZ: { value: -FIELD_DEPTH * FIELD_SCALE },
                uZones: { value: 1 },
                uDeck: { value: 0 },
                uScale: { value: FIELD_SCALE },
                uRed: { value: this.redLine },
                uOrange: { value: this.orangeLine },
                uRedIsland: { value: this.redIslands },
                uOrangeIsland: { value: this.orangeIslands },
                uGate: this.gate,
                uDark: { value: this.darkZones },
                uSurge: { value: this.surges },
                uSurgeColor: { value: this.surgeColours },
            uSurgeReach: { value: this.surgeReach }
            },
            vertexShader: GRID_VERTEX,
            fragmentShader: GRID_FRAGMENT,
            fog: true
        })
        this.traceMaterial = this.territoryMaterial(0.9, 1)
        // The roads are brighter than the board around them, and busier.
        this.networkMaterial = this.territoryMaterial(1.5, 1.4)
        this.networkPadMaterial = this.territoryMaterial(2.2, 0)
        this.trapMaterial = new THREE.ShaderMaterial({
            uniforms: { uTime: modelClock, uLevel: { value: 0 } },
            vertexShader: UV_VERTEX,
            fragmentShader: TRAP_FRAGMENT,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        })
        this.shieldMaterial = new THREE.ShaderMaterial({
            uniforms: { uTime: modelClock, uStrength: { value: 0 }, uHit: { value: 0 }, uGate: this.gate },
            vertexShader: UV_VERTEX,
            fragmentShader: SHIELD_FRAGMENT,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        })

        this.buildFloor()
        this.buildTraces()
        this.buildSkyline()
        this.buildSpawnGate()
        this.wall = this.buildWall()
        this.buildTrapAndShield()

        this.resize()
    }

    // ─── World ───────────────────────────────────────────────────────────────

    /** A glow that takes the colour of the territory it sits on. */
    territoryMaterial(intensity: number, packets: number) {
        return new THREE.ShaderMaterial({
            uniforms: {
                uTime: modelClock,
                uIntensity: { value: intensity },
                uPackets: { value: packets },
                uHalfWidth: { value: FIELD_HALF_WIDTH * FIELD_SCALE },
                uScale: { value: FIELD_SCALE },
                uRed: { value: this.redLine },
                uOrange: { value: this.orangeLine },
                uRedIsland: { value: this.redIslands },
                uOrangeIsland: { value: this.orangeIslands },
                uGate: this.gate,
                uDark: { value: this.darkZones },
                uSurge: { value: this.surges },
                uSurgeColor: { value: this.surgeColours },
            uSurgeReach: { value: this.surgeReach }
            },
            vertexShader: TRACE_VERTEX,
            fragmentShader: TRACE_FRAGMENT,
            toneMapped: false
        })
    }

    private buildFloor() {
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(260, 220), this.gridMaterial)
        floor.rotation.x = -Math.PI / 2
        floor.position.set(0, 0, -90)
        this.scene.add(floor)
    }

    /**
     * Manhattan-routed traces either side of the lane and under it: straight
     * runs and right angles only, ending in a pad. Each vertex carries its
     * distance along the trace so packets of light can run down it.
     */
    private buildTraces() {
        const positions: number[] = []
        const distances: number[] = []
        const pads = new THREE.Group()
        const padMaterial = this.territoryMaterial(1.8, 0)
        const padGeometry = new THREE.BoxGeometry(0.5, 0.06, 0.5)
        const y = 0.02

        // These fill the board either side of the lane; the lane's own lines
        // are the data network the hostiles ride (see `setNetwork`).
        const laneEdge = FIELD_HALF_WIDTH * FIELD_SCALE + 1.5
        for (let i = 0; i < 64; i++) {
            const side = i % 2 === 0 ? -1 : 1
            let x = side * randRange(laneEdge + 0.5, 60)
            let z = -randRange(FIELD_DEPTH * FIELD_SCALE + 4, 110)
            // Each trace starts its packets at a different point, so they run out of step.
            let travelled = randRange(0, 200)
            const segments = 3 + Math.floor(randRange(0, 4))
            for (let s = 0; s < segments; s++) {
                const alongZ = s % 2 === 0
                let length = alongZ ? randRange(6, 26) : randRange(2, 9) * (randRange(0, 1) < 0.5 ? -1 : 1)
                // Never into the lane: those lines are the hostiles' roads.
                if (!alongZ && Math.abs(x + length) < laneEdge) length = -length
                const nx = alongZ ? x : x + length
                const nz = alongZ ? Math.min(-0.5, z + length) : z
                positions.push(x, y, z, nx, y, nz)
                distances.push(travelled)
                travelled += Math.abs(nx - x) + Math.abs(nz - z)
                distances.push(travelled)
                x = nx
                z = nz
            }
            const pad = new THREE.Mesh(padGeometry, padMaterial)
            pad.position.set(x, y, z)
            pads.add(pad)
        }

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.setAttribute('aDist', new THREE.Float32BufferAttribute(distances, 1))
        this.scene.add(new THREE.LineSegments(geometry, this.traceMaterial), pads)
    }

    private networkLines: THREE.Object3D[] = []

    /**
     * Draws the lane's data network: every trace with packets running down it
     * toward the fence, and a pad at each end. These are the roads the hostiles
     * ride. Each trace gets its own packet phase and spacing, so the light
     * runs out of step — a board, not a metronome.
     */
    setNetwork(network: DataNetwork) {
        for (const object of this.networkLines) {
            object.removeFromParent()
            object.traverse((node) => {
                const mesh = node as THREE.Mesh
                if (mesh.geometry && mesh.geometry !== this.padGeometry) mesh.geometry.dispose()
            })
        }
        const y = 0.03
        const positions: number[] = []
        const distances: number[] = []
        const pads = new THREE.Group()
        const pad = (u: number, d: number) => {
            const mesh = new THREE.Mesh(this.padGeometry, this.networkPadMaterial)
            mesh.position.set(u * FIELD_SCALE, y, -d * FIELD_SCALE)
            pads.add(mesh)
        }
        for (const trace of network.traces) {
            // Cosmetic only, so `Math.random` is fine for the packet rhythm.
            let travelled = Math.random() * 200
            const spacing = 0.7 + Math.random() * 0.7
            for (let s = 0; s < trace.points.length - 1; s++) {
                const a = trace.points[s]!
                const b = trace.points[s + 1]!
                positions.push(a.u * FIELD_SCALE, y, -a.d * FIELD_SCALE, b.u * FIELD_SCALE, y, -b.d * FIELD_SCALE)
                const length = (Math.abs(b.u - a.u) + Math.abs(b.d - a.d)) * FIELD_SCALE * spacing
                distances.push(travelled, travelled + length)
                travelled += length
            }
            pad(trace.points[0]!.u, trace.points[0]!.d)
            pad(trace.points[trace.points.length - 1]!.u, trace.points[trace.points.length - 1]!.d)
        }
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.setAttribute('aDist', new THREE.Float32BufferAttribute(distances, 1))
        const lines = new THREE.LineSegments(geometry, this.networkMaterial)
        this.scene.add(lines, pads)
        this.networkLines = [lines, pads]
    }

    /** Data towers on the horizon: dark slabs outlined in light. */
    private buildSkyline() {
        const towers = new THREE.Group()
        const body = new THREE.MeshBasicMaterial({ color: 0x02040a, fog: false })
        const colours = [CYAN, CYAN, 0x818cf8, AMBER]
        for (let i = 0; i < 70; i++) {
            const w = randRange(2, 7)
            const h = randRange(4, 26) * (i % 9 === 0 ? 1.8 : 1)
            const d = randRange(2, 7)
            const geometry = new THREE.BoxGeometry(w, h, d)
            const mesh = new THREE.Mesh(geometry, body)
            mesh.position.set(randRange(-130, 130), h / 2, -randRange(125, 175))
            const edge = new THREE.LineBasicMaterial({
                color: hdr(colours[i % colours.length]!, randRange(0.25, 0.8)),
                toneMapped: false,
                fog: false
            })
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edge))
            towers.add(mesh)
        }
        // The horizon glow the towers stand against.
        const glow = new THREE.Mesh(
            new THREE.PlaneGeometry(420, 40),
            new THREE.ShaderMaterial({
                vertexShader: UV_VERTEX,
                fragmentShader: `varying vec2 vUv; void main() {
                    float a = pow(1.0 - vUv.y, 3.0);
                    gl_FragColor = vec4(vec3(0.05, 0.35, 0.5) * a, 1.0);
                }`,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                transparent: true,
                toneMapped: false
            })
        )
        glow.position.set(0, 20, -180)
        this.scene.add(towers, glow)
    }

    /** A unit came through the gate at lane position `u`: power lines run out across the gate from there. */
    portalArrival(u: number) {
        this.portal?.arrival(u * FIELD_SCALE)
    }

    /** Where enemies rez in: the intrusion's gate, angry and crackling. */
    private buildSpawnGate() {
        const z = -(FIELD_DEPTH + SPAWN_SPREAD * 0.4) * FIELD_SCALE
        const half = FIELD_HALF_WIDTH * FIELD_SCALE + 1.5
        this.portal = new SpawnPortal(z, half, 11)
        this.scene.add(this.portal.group)
    }

    private buildWall(): WallVisual {
        const group = new THREE.Group()
        const length = WALL_HALF_LENGTH * 2 * FIELD_SCALE
        const plating = new THREE.MeshBasicMaterial({ color: 0x03060d })
        const edge = new THREE.LineBasicMaterial({ color: hdr(CYAN, 1.8), toneMapped: false })
        const band = new THREE.MeshBasicMaterial({ color: hdr(CYAN, 2.4), toneMapped: false })

        // ── The fence: what enemies walk up to and hit. Posts, three rails of
        // light, and a faint field between them — a hackerz you can see through.
        const postGeometry = new THREE.BoxGeometry(0.22, FENCE_HEIGHT, 0.22)
        const posts = new THREE.InstancedMesh(postGeometry, plating, Math.ceil(length / 2.4) + 1)
        let postCount = 0
        for (let x = -length / 2; x <= length / 2 + 0.01; x += 2.4) {
            posts.setMatrixAt(postCount++, new THREE.Matrix4().makeTranslation(x, FENCE_HEIGHT / 2, 0))
        }
        posts.count = postCount
        group.add(posts)
        const postEdges = new THREE.EdgesGeometry(postGeometry)
        for (let x = -length / 2; x <= length / 2 + 0.01; x += 2.4) {
            const lines = new THREE.LineSegments(postEdges, edge)
            lines.position.set(x, FENCE_HEIGHT / 2, 0)
            group.add(lines)
        }
        for (const y of [0.35, FENCE_HEIGHT * 0.55, FENCE_HEIGHT]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.07, 0.07), band)
            rail.position.set(0, y, 0)
            group.add(rail)
        }
        const field = new THREE.Mesh(
            new THREE.PlaneGeometry(length, FENCE_HEIGHT),
            new THREE.ShaderMaterial({
                vertexShader: UV_VERTEX,
                fragmentShader: `uniform float uTime; uniform vec3 uTint; varying vec2 vUv; void main() {
                    float scan = smoothstep(0.96, 1.0, fract(vUv.y * 3.0 - uTime * 0.6));
                    float a = 0.035 + scan * 0.12;
                    gl_FragColor = vec4(uTint * a, a);
                }`,
                uniforms: { uTime: modelClock, uTint: { value: new THREE.Vector3(0.3, 1.4, 1.9) } },
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                toneMapped: false
            })
        )
        field.position.set(0, FENCE_HEIGHT / 2, 0)
        group.add(field)
        const fieldMaterial = field.material

        // ── The deck: the platform you fight from, set back behind the fence.
        const bodyGeometry = new THREE.BoxGeometry(length, WALL_HEIGHT, WALL_THICKNESS)
        const body = new THREE.Mesh(bodyGeometry, plating)
        body.position.set(0, WALL_HEIGHT / 2, DECK_FRONT + WALL_THICKNESS / 2)
        body.add(new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeometry), edge))
        group.add(body)

        // The deck you stand on: the same grid as the field, dimmer and with no lane rails.
        const deckMaterial = new THREE.ShaderMaterial({
            uniforms: {
                ...THREE.UniformsLib.fog,
                uTime: modelClock,
                uHalfWidth: { value: 10_000 },
                uSpawnZ: { value: 0 },
                uZones: { value: 0 },
                uDeck: { value: 1 },
                uScale: { value: FIELD_SCALE },
                uRed: { value: this.redLine },
                uOrange: { value: this.orangeLine },
                uRedIsland: { value: this.redIslands },
                uOrangeIsland: { value: this.orangeIslands },
                uGate: this.gate,
                uDark: { value: this.darkZones },
                uSurge: { value: this.surges },
                uSurgeColor: { value: this.surgeColours },
            uSurgeReach: { value: this.surgeReach }
            },
            vertexShader: GRID_VERTEX,
            fragmentShader: GRID_FRAGMENT,
            fog: true
        })
        const deck = new THREE.Mesh(new THREE.PlaneGeometry(length, WALL_THICKNESS - 0.4), deckMaterial)
        deck.rotation.x = -Math.PI / 2
        deck.position.set(0, WALL_HEIGHT + 0.01, DECK_FRONT + WALL_THICKNESS / 2 + 0.2)
        group.add(deck)

        // A lit lip along the deck's front edge.
        const lip = new THREE.Mesh(new THREE.BoxGeometry(length, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: hdr(CYAN, 1.2), toneMapped: false }))
        lip.position.set(0, WALL_HEIGHT, DECK_FRONT)
        group.add(lip)

        // Mount pads: one per possible turret, lit when a turret occupies it. The
        // back row's pads sit on pedestals, which come and go with their pad.
        const padGeometry = new THREE.RingGeometry(0.8, 0.92, 8).rotateX(-Math.PI / 2)
        const pedestalGeometry = new THREE.BoxGeometry(1.9, MOUNT_BACK_RISE, 1.9)
        const pedestalEdges = new THREE.EdgesGeometry(pedestalGeometry)
        const pedestalBody = new THREE.MeshBasicMaterial({ color: 0x03060c })
        const pedestalEdge = new THREE.LineBasicMaterial({ color: hdr(CYAN, 0.5), toneMapped: false })
        MOUNT_U.forEach((_, slot) => {
            const at = mountPosition(slot)
            const pad = new THREE.Mesh(padGeometry, new THREE.MeshBasicMaterial({ color: hdr(CYAN, 0.25), toneMapped: false }))
            pad.position.set(at.u * FIELD_SCALE, WALL_HEIGHT + 0.03 + at.rise, GUN_Z + at.z)
            if (at.back) {
                const pedestal = new THREE.Mesh(pedestalGeometry, pedestalBody)
                pedestal.position.y = -0.03 - at.rise / 2
                pedestal.add(new THREE.LineSegments(pedestalEdges, pedestalEdge))
                pad.add(pedestal)
            }
            group.add(pad)
            this.mountPads.push(pad)
        })

        this.scene.add(group)
        return { group, band, edge, field: fieldMaterial }
    }

    private buildTrapAndShield() {
        const length = WALL_HALF_LENGTH * 2 * FIELD_SCALE
        const trap = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_HALF_WIDTH * 2 * FIELD_SCALE, SPIKE_BAND * FIELD_SCALE), this.trapMaterial)
        trap.rotation.x = -Math.PI / 2
        trap.position.set(0, 0.03, -SPIKE_BAND * FIELD_SCALE / 2)
        trap.renderOrder = 2
        this.scene.add(trap)

        const shield = new THREE.Mesh(new THREE.PlaneGeometry(length, 7), this.shieldMaterial)
        shield.position.set(0, 3.5, -SHIELD_D * FIELD_SCALE)
        shield.renderOrder = 3
        this.scene.add(shield)
    }

    // ─── Frame ───────────────────────────────────────────────────────────────

    /** Wall stripe colour from integrity, and a red flash on a hit. */
    /**
     * Colours the fence by integrity. `overrun` (0–1) dims a healthy fence's
     * glow as the barrier lattice turns orange: the board is theirs and the
     * fence is all that is left. A failing fence's warnings stay bright.
     */
    setWallState(integrity: number, hitFlash: number, overrun = 0) {
        const healthy = integrity > 0.55
        const base = healthy ? CYAN : integrity > 0.25 ? AMBER : RED
        const dim = healthy ? 1 - 0.6 * overrun : 1
        this.wall.band.color.copy(hdr(base, 2.4 * dim)).lerp(hdr(RED, 4), Math.min(1, hitFlash))
        this.wall.edge.color.copy(hdr(base, 1.6 * dim + hitFlash * 2))
        const tint = this.wall.field.uniforms.uTint!.value as THREE.Vector3
        tint.set(0.3, 1.4, 1.9).multiplyScalar(dim)
    }

    setMountsUsed(slots: number, installed: boolean[]) {
        this.mountPads.forEach((pad, index) => {
            pad.visible = index < slots
            const material = pad.material as THREE.MeshBasicMaterial
            material.color.copy(hdr(CYAN, installed[index] ? 1.2 : 0.3))
        })
    }

    flash(hex: number, amount: number) {
        const colour = new THREE.Color(hex)
        ;(this.finalPass.uniforms.uFlash!.value as THREE.Vector3).set(colour.r, colour.g, colour.b)
        this.flashAmount = Math.max(this.flashAmount, amount)
    }

    /**
     * Grounds a discharge into the floor at a world point. The oldest surge is
     * recycled when all slots are busy — on a crowded kill the newest deaths
     * are the ones worth seeing.
     */
    addSurge(x: number, z: number, hex: number, strength = 1, reach = 0) {
        const index = this.surgeCursor
        this.surgeCursor = (this.surgeCursor + 1) % SURGES
        this.surges[index]!.set(x, z, 0, strength)
        this.surgeColours[index]!.set(hex).multiplyScalar(1.4)
        this.surgeReach[index] = reach
    }

    /** Advanced by the engine with game time, so a paused game freezes its surges. */
    ageSurges(dt: number) {
        for (const surge of this.surges) {
            if (surge.z < 0) continue
            surge.z += dt
            if (surge.z > SURGE_LIFE) surge.z = -1
        }
    }

    clearSurges() {
        for (const surge of this.surges) surge.z = -1
    }

    render(dt: number, shake: number) {
        this.adaptResolution(dt)
        this.portal?.update(dt)
        this.flashAmount = Math.max(0, this.flashAmount - dt * 2.4)
        this.finalPass.uniforms.uFlashAmount!.value = this.flashAmount
        this.camera.position.copy(this.cameraHome)
        if (shake > 0.01) {
            this.camera.position.x += randRange(-shake, shake)
            this.camera.position.y += randRange(-shake, shake) * 0.6
        }
        this.camera.lookAt(this.cameraTarget)
        this.composer.render(dt)
    }

    // ─── Resolution ──────────────────────────────────────────────────────────

    /**
     * Never below native density — a 1:1 monitor shows the upscale as blur — and
     * supersampled on standard-density screens, where the grid's thin lines and
     * the bloom halos otherwise break into dots. Long frames trim it back.
     */
    private targetPixelRatio() {
        const area = Math.max(1, this.width * this.height)
        const dpr = window.devicePixelRatio || 1
        const native = Math.min(dpr, 1)
        let pr = Math.max(Math.min(dpr, 1.5, Math.sqrt(2.8e6 / area)), native)
        if (dpr < 1.5) pr = Math.max(pr, Math.min(1.5, Math.sqrt(9e6 / area)))
        return Math.max(native * 0.75, pr * this.resScale)
    }

    private adaptResolution(dt: number) {
        this.frameAcc += dt
        this.frameCount++
        if (this.frameAcc < 1.5) return
        const avg = this.frameAcc / this.frameCount
        this.frameAcc = 0
        this.frameCount = 0
        if (avg > 0.021 && this.resScale > 0.7) {
            this.resScale = Math.max(0.7, this.resScale - 0.1)
            this.fastWindows = 0
            this.resize()
        } else if (avg < 0.0175 && this.resScale < 1) {
            if (++this.fastWindows >= 3) {
                this.fastWindows = 0
                this.resScale = Math.min(1, this.resScale + 0.05)
                this.resize()
            }
        } else {
            this.fastWindows = 0
        }
    }

    resize = () => {
        const w = this.host.clientWidth || 1280
        const h = this.host.clientHeight || 720
        this.width = w
        this.height = h
        const ratio = this.targetPixelRatio()
        this.renderer.setPixelRatio(ratio)
        this.composer.setPixelRatio(ratio)
        this.renderer.setSize(w, h, false)
        this.composer.setSize(w, h)
        this.bloom.resolution.set(w / 2, h / 2)
        this.camera.aspect = w / h
        this.camera.updateProjectionMatrix()
        const overlayRatio = Math.min(window.devicePixelRatio || 1, 2)
        this.overlay.width = Math.round(w * overlayRatio)
        this.overlay.height = Math.round(h * overlayRatio)
        this.overlayCtx.setTransform(overlayRatio, 0, 0, overlayRatio, 0, 0)
    }

    /** World point to CSS pixels on the canvas; `null` when behind the camera. */
    project(point: THREE.Vector3, out: { x: number, y: number }) {
        const v = _project.copy(point).project(this.camera)
        if (v.z > 1) return null
        out.x = (v.x * 0.5 + 0.5) * this.width
        out.y = (-v.y * 0.5 + 0.5) * this.height
        return out
    }

    dispose() {
        this.composer.dispose()
        this.renderer.dispose()
        this.renderer.domElement.remove()
        this.overlay.remove()
        this.scene.traverse((node) => {
            const mesh = node as THREE.Mesh
            if (mesh.geometry) mesh.geometry.dispose()
        })
    }
}

const _project = new THREE.Vector3()
