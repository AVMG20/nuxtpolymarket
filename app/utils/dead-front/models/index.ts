import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// Authored models for Dead Front. Each pack is one GLB in
// `public/dead-front/models/<pack>.glb`, built by a headless Blender script in
// `scripts/dead-front-models/`. A pack holds many named top-level nodes; a
// node's origin is its pivot. Everything is preloaded before the engine starts
// (`dfPreloadModels`), so the builders read models synchronously. A pack that
// is missing or fails to load leaves its accessors returning null, and the
// caller falls back to its procedural model.
//
// `dfModelGeometry` flattens a node into one BufferGeometry in the format the
// shared toon material (`voxel/material.ts`) draws: position, normal, linear
// `color` (material base colour x vertex colour) and `aGlow` (emissive 0..1).
// Instancing, the zombie rig (`aPart`) and merging all work on it.

export const DF_MODEL_PACKS = ['zombies', 'weapons', 'props', 'machines', 'avatars', 'fx'] as const
export type DfModelPack = typeof DF_MODEL_PACKS[number]

const BASE = '/dead-front/models/'

const packs = new Map<DfModelPack, Map<string, THREE.Object3D>>()
const geoCache = new Map<string, THREE.BufferGeometry | null>()
let loading: Promise<void> | null = null

/** Loads every pack once (safe to call repeatedly). Never rejects. */
export function dfPreloadModels(): Promise<void> {
    if (loading) return loading
    const loader = new GLTFLoader()
    loading = Promise.all(DF_MODEL_PACKS.map(async (pack) => {
        try {
            const res = await fetch(`${BASE}${pack}.glb`, { method: 'HEAD' })
            // a missing file falls through to the SPA's HTML page with a 200
            if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return
            const gltf = await loader.loadAsync(`${BASE}${pack}.glb`)
            gltf.scene.updateMatrixWorld(true)
            const nodes = new Map<string, THREE.Object3D>()
            for (const child of gltf.scene.children) nodes.set(child.name, child)
            packs.set(pack, nodes)
        } catch (e) {
            console.warn(`[dead-front] model pack ${pack} failed to load`, e)
        }
    })).then(() => {})
    return loading
}

/** True once a pack has loaded. */
export function dfHasModelPack(pack: DfModelPack): boolean {
    return packs.has(pack)
}

/** Names of a pack's top-level nodes. */
export function dfModelNames(pack: DfModelPack): string[] {
    return [...(packs.get(pack)?.keys() ?? [])]
}

/** The template node (shared: clone it before adding it to a scene). */
export function dfModelObject(pack: DfModelPack, name: string): THREE.Object3D | null {
    return packs.get(pack)?.get(name) ?? null
}

/** A child of a template node by name, searched depth first. */
export function dfModelChild(pack: DfModelPack, name: string, child: string): THREE.Object3D | null {
    return dfModelObject(pack, name)?.getObjectByName(child) ?? null
}

export interface DfModelGeometryOpts {
    /** Uniform scale applied after flattening. */
    scale?: number
    /** Leave out descendants whose name starts with one of these (moving parts drawn separately). */
    skip?: string[]
}

/**
 * The node and its descendants flattened into one geometry in the node's local
 * space (its origin is the pivot). Cached per node and options: the result is
 * shared, so don't dispose or mutate it. Null when the node is missing.
 */
export function dfModelGeometry(pack: DfModelPack, name: string, opts: DfModelGeometryOpts = {}): THREE.BufferGeometry | null {
    const key = `${pack}/${name}/${opts.scale ?? 1}/${(opts.skip ?? []).join(',')}`
    if (geoCache.has(key)) return geoCache.get(key)!
    const node = dfModelObject(pack, name)
    const geo = node ? dfFlattenObject(node, opts) : null
    geoCache.set(key, geo)
    return geo
}

const tmpColor = new THREE.Color()
const tmpEm = new THREE.Color()

/** Flattens any object (and its descendants) into the toon format, relative to the object's own frame. */
export function dfFlattenObject(root: THREE.Object3D, opts: DfModelGeometryOpts = {}): THREE.BufferGeometry | null {
    root.updateMatrixWorld(true)
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
    const scale = opts.scale ?? 1
    const skip = opts.skip ?? []
    const pos: number[] = []
    const nor: number[] = []
    const col: number[] = []
    const glow: number[] = []
    const idx: number[] = []
    const m = new THREE.Matrix4()
    const nm = new THREE.Matrix3()
    const v = new THREE.Vector3()
    const walk = (o: THREE.Object3D) => {
        if (o !== root && skip.some(s => o.name.startsWith(s))) return
        const mesh = o as THREE.Mesh
        if (mesh.isMesh && mesh.geometry) {
            m.multiplyMatrices(inv, mesh.matrixWorld)
            nm.getNormalMatrix(m)
            const g = mesh.geometry
            const p = g.getAttribute('position')
            const n = g.getAttribute('normal')
            const c = g.getAttribute('color')
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : p.count, materialIndex: 0 }]
            const base = pos.length / 3
            // per-vertex material: the first group that references the vertex wins
            const vmat = new Int16Array(p.count).fill(-1)
            const index = g.index
            for (const gr of groups) {
                for (let i = gr.start; i < gr.start + gr.count; i++) {
                    const vi = index ? index.getX(i) : i
                    if (vmat[vi] === -1) vmat[vi] = gr.materialIndex ?? 0
                }
            }
            for (let i = 0; i < p.count; i++) {
                v.fromBufferAttribute(p, i).applyMatrix4(m).multiplyScalar(scale)
                pos.push(v.x, v.y, v.z)
                if (n) {
                    v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize()
                    nor.push(v.x, v.y, v.z)
                } else {
                    nor.push(0, 1, 0)
                }
                const mat = mats[Math.max(0, vmat[i]!)] as THREE.MeshStandardMaterial | undefined
                tmpColor.set(mat?.color ?? 0xffffff)
                if (c) tmpColor.multiply(new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)))
                col.push(tmpColor.r, tmpColor.g, tmpColor.b)
                let gl = 0
                if (mat?.emissive) {
                    tmpEm.copy(mat.emissive).multiplyScalar(mat.emissiveIntensity ?? 1)
                    gl = Math.min(1, Math.max(tmpEm.r, tmpEm.g, tmpEm.b))
                }
                glow.push(gl)
            }
            if (index) {
                for (const gr of groups) {
                    for (let i = gr.start; i < gr.start + gr.count; i++) idx.push(base + index.getX(i))
                }
            } else {
                for (let i = 0; i < p.count; i++) idx.push(base + i)
            }
        }
        for (const ch of o.children) walk(ch)
    }
    walk(root)
    if (!pos.length) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 1))
    geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1))
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
}
