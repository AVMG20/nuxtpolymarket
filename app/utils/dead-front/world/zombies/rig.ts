import * as THREE from 'three'
import type { DfEnemyType } from '#shared/utils/dead-front/types'
import { dfVoxMaterial } from '../../voxel/material'
import type { DfVoxMaterial } from '../../voxel/material'
import { DF_ZOMBIE_PARTS, dfBuildZombie } from './models'
import type { DfZombieBuild } from './models'

// GPU rigid-part rig. All zombies of one type and outfit are a single
// instanced draw: the merged voxel geometry carries a part index per vertex,
// and the vertex shader fetches that part's world matrix for this instance
// from a float texture (4 texels per part, one row per instance). The shadow
// pass uses the same lookup, so a horde costs a handful of draw calls.

const VERT_RIG = /* glsl */`
uniform highp sampler2D uBones;
attribute float aPart;
mat4 dfBone() {
    int x = int(aPart + 0.5) * 4;
    int y = gl_InstanceID;
    return mat4(texelFetch(uBones, ivec2(x, y), 0), texelFetch(uBones, ivec2(x + 1, y), 0), texelFetch(uBones, ivec2(x + 2, y), 0), texelFetch(uBones, ivec2(x + 3, y), 0));
}
`

function patchRig(m: THREE.Material, bones: { value: THREE.Texture }, normals: boolean): void {
    const prev = m.onBeforeCompile
    m.onBeforeCompile = (shader, renderer) => {
        prev.call(m, shader, renderer)
        shader.uniforms.uBones = bones
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${VERT_RIG}`)
            .replace('#include <begin_vertex>', 'vec3 transformed = (dfBone() * vec4(position, 1.0)).xyz;\n#ifdef USE_ALPHAHASH\nvPosition = vec3(position);\n#endif')
        if (normals) shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = mat3(dfBone()) * vec3(normal);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif')
    }
    const prevKey = m.customProgramCacheKey.bind(m)
    m.customProgramCacheKey = () => `dfrig|${prevKey()}`
}

/** The batch behind each zombie mesh (tests and debugging read poses back through it). */
export const dfZombieBatchOf = new WeakMap<THREE.Object3D, DfZombieBatch>()

export class DfZombieBatch {
    readonly type: DfEnemyType
    readonly outfit: number
    readonly build: DfZombieBuild
    readonly mesh: THREE.InstancedMesh
    readonly material: DfVoxMaterial
    private readonly depth: THREE.MeshDepthMaterial
    private readonly tex: THREE.DataTexture
    private readonly data: Float32Array
    private readonly free: number[] = []
    private readonly geo: THREE.BufferGeometry
    readonly cap: number
    private used = 0
    private dirty = false

    constructor(type: DfEnemyType, outfit: number, cap: number, shadows: boolean) {
        this.type = type
        this.outfit = outfit
        this.cap = cap
        this.build = dfBuildZombie(type, outfit)
        const v = this.build.dims.v
        const pieces: THREE.BufferGeometry[] = []
        this.build.parts.forEach((p, i) => {
            if (!p) return
            const g = p.model.mesh(v * (p.cell ?? 1), p.pivot)
            if (!g) return
            const n = g.getAttribute('position').count
            g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(i), 1))
            pieces.push(g)
        })
        this.geo = mergeWithPart(pieces)
        for (const g of pieces) g.dispose()
        this.data = new Float32Array(DF_ZOMBIE_PARTS * 4 * 4 * cap)
        this.tex = new THREE.DataTexture(this.data, DF_ZOMBIE_PARTS * 4, cap, THREE.RGBAFormat, THREE.FloatType)
        this.tex.needsUpdate = true
        const bones = { value: this.tex as THREE.Texture }
        this.material = dfVoxMaterial()
        patchRig(this.material, bones, true)
        this.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
        patchRig(this.depth, bones, false)
        this.mesh = new THREE.InstancedMesh(this.geo, this.material, cap)
        this.mesh.name = `df-zombies-${type}-${outfit}`
        dfZombieBatchOf.set(this.mesh, this)
        this.mesh.customDepthMaterial = this.depth
        this.mesh.frustumCulled = false
        this.mesh.castShadow = shadows
        this.mesh.receiveShadow = shadows
        // Visible (with no instances) until first used, so the engine's shader warm-up compiles it.
        this.mesh.count = 0
        const white = new THREE.Color(1, 1, 1)
        for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, white)
        for (let i = cap - 1; i >= 0; i--) this.free.push(i)
    }

    get active(): number {
        return this.cap - this.free.length
    }

    acquire(): number {
        const slot = this.free.pop()
        if (slot === undefined) return -1
        this.used = Math.max(this.used, slot + 1)
        this.mesh.count = this.used
        this.mesh.visible = true
        this.clear(slot)
        return slot
    }

    release(slot: number): void {
        if (slot < 0) return
        this.clear(slot)
        this.free.push(slot)
        // Shrink the drawn range when the top slots are free.
        const free = new Set(this.free)
        while (this.used > 0 && free.has(this.used - 1)) this.used--
        this.mesh.count = this.used
        // Empty batches skip the draw (and the shadow pass) entirely.
        this.mesh.visible = this.used > 0
    }

    /** Writes one part's world matrix (column-major) for an instance. */
    setPart(slot: number, part: number, m: THREE.Matrix4): void {
        this.data.set(m.elements, (slot * DF_ZOMBIE_PARTS + part) * 16)
        this.dirty = true
    }

    /** Reads back one part's world matrix (all zeros when hidden). */
    part(slot: number, part: number, out: THREE.Matrix4): THREE.Matrix4 {
        return out.fromArray(this.data, (slot * DF_ZOMBIE_PARTS + part) * 16)
    }

    hidePart(slot: number, part: number): void {
        this.data.fill(0, (slot * DF_ZOMBIE_PARTS + part) * 16, (slot * DF_ZOMBIE_PARTS + part + 1) * 16)
        this.dirty = true
    }

    setColor(slot: number, c: THREE.Color): void {
        this.mesh.setColorAt(slot, c)
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    }

    private clear(slot: number): void {
        this.data.fill(0, slot * DF_ZOMBIE_PARTS * 16, (slot + 1) * DF_ZOMBIE_PARTS * 16)
        this.dirty = true
    }

    commit(): void {
        if (!this.dirty) return
        this.dirty = false
        this.tex.needsUpdate = true
    }

    dispose(): void {
        this.mesh.removeFromParent()
        this.mesh.dispose()
        this.geo.dispose()
        this.material.dispose()
        this.depth.dispose()
        this.tex.dispose()
    }
}

function mergeWithPart(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const names = ['position', 'normal', 'color', 'aGlow', 'aPart'] as const
    const sizes = [3, 3, 3, 1, 1]
    let nv = 0
    let ni = 0
    for (const g of parts) {
        nv += g.getAttribute('position').count
        ni += g.index!.count
    }
    const arrays = sizes.map(s => new Float32Array(nv * s))
    const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni)
    let vo = 0
    let io = 0
    for (const g of parts) {
        const n = g.getAttribute('position').count
        names.forEach((name, a) => arrays[a]!.set((g.getAttribute(name) as THREE.BufferAttribute).array as Float32Array, vo * sizes[a]!))
        const idx = g.index!
        for (let i = 0; i < idx.count; i++) index[io + i] = idx.getX(i) + vo
        io += idx.count
        vo += n
    }
    const geo = new THREE.BufferGeometry()
    names.forEach((name, a) => geo.setAttribute(name, new THREE.BufferAttribute(arrays[a]!, sizes[a]!)))
    geo.setIndex(new THREE.BufferAttribute(index, 1))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    return geo
}
