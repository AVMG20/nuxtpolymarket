// Polytown — turns the part lists from kit.ts into meshes. A building's static
// parts are merged into ONE vertex-coloured mesh, so a whole building is a
// single draw call however detailed it is; lit parts become a mesh named
// 'glow', turning parts a mesh named 'spin', and chimney tops an empty named
// 'smoke' — the scene finds those again by name for animation. Prototypes are
// cached per type, stage and colour variant; instances are cheap clones.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { TownBuildingId } from '#shared/utils/gamelogic/town'
import { townVisualLevel, townVisualStage } from './appearance'
import { paintAs, shade, type ModelSpec, type Part } from './kit'
import { bakeryModel, emporiumModel, houseModel } from './homes'
import { INDUSTRY_MODELS } from './industry'
import { RESOURCE_MODELS } from './resources'
import { CIVIC_MODELS } from './civic'

export { shade }
export type { Part }

const unitCache = new Map<string, THREE.BufferGeometry>()

function unitGeometry(p: Part): THREE.BufferGeometry {
    const key = `${p.shape}:${p.seg ?? ''}`
    let g = unitCache.get(key)
    if (g) return g
    switch (p.shape) {
        case 'box': g = new THREE.BoxGeometry(1, 1, 1); break
        case 'cyl': g = new THREE.CylinderGeometry(0.5, 0.5, 1, p.seg ?? 10); break
        case 'cone': g = new THREE.ConeGeometry(0.5, 1, p.seg ?? 8); break
        case 'pyramid': g = new THREE.ConeGeometry(0.5 * Math.SQRT2, 1, 4).rotateY(Math.PI / 4); break
        case 'sphere': g = new THREE.SphereGeometry(0.5, p.seg ?? 8, Math.max(4, (p.seg ?? 8) - 2)); break
        case 'dome': g = new THREE.SphereGeometry(0.5, p.seg ?? 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1).translate(0, -0.5, 0); break
        case 'crystal': g = new THREE.LatheGeometry([new THREE.Vector2(0, -0.5), new THREE.Vector2(0.38, -0.5), new THREE.Vector2(0.5, -0.32), new THREE.Vector2(0.5, 0.18), new THREE.Vector2(0, 0.5)], p.seg ?? 6); break
        case 'prism': {
            // Triangular prism along z: the wall under a pitched roof.
            g = new THREE.BufferGeometry()
            g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0, 0.5, -0.5], 3))
            g.setIndex([0, 1, 2, 4, 3, 5, 0, 2, 5, 0, 5, 3, 1, 4, 5, 1, 5, 2, 0, 3, 4, 0, 4, 1])
            g.computeVertexNormals()
            break
        }
    }
    g.deleteAttribute('uv')
    unitCache.set(key, g)
    return g
}

const matrix = new THREE.Matrix4()
const turn = new THREE.Matrix4()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const quaternion = new THREE.Quaternion()
const euler = new THREE.Euler()
const tint = new THREE.Color()

/** One part as world-space geometry with its colour (and soft ground shading) baked into the vertices. */
function bake(p: Part, ox = 0, oy = 0, oz = 0): THREE.BufferGeometry {
    const unit = unitGeometry(p)
    const g = unit.clone()
    quaternion.setFromEuler(euler.set(p.rotX ?? 0, p.rotY ?? 0, p.rotZ ?? 0))
    matrix.compose(position.set(p.x - ox, p.y + p.h / 2 - oy, p.z - oz), quaternion, scale.set(p.w, p.h, p.d))
    if (p.faceY) {
        // The wall turn pivots on the part itself, after its own tilt.
        matrix.compose(position.set(0, 0, 0), quaternion, scale)
        matrix.premultiply(turn.makeRotationY(p.faceY))
        matrix.setPosition(p.x - ox, p.y + p.h / 2 - oy, p.z - oz)
    }
    g.applyMatrix4(matrix)
    tint.set(p.color)
    const source = unit.getAttribute('position')
    const colors = new Float32Array(source.count * 3)
    for (let i = 0; i < source.count; i++) {
        const light = p.flat ? 1 : 0.7 + 0.3 * (source.getY(i) + 0.5)
        colors[i * 3] = tint.r * light
        colors[i * 3 + 1] = tint.g * light
        colors[i * 3 + 2] = tint.b * light
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
}

const bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.86, metalness: 0.02 })
const glowMaterials = new Map<number, THREE.MeshStandardMaterial>()
function glowMaterial(emissive: number) {
    let m = glowMaterials.get(emissive)
    if (!m) {
        m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, emissive, emissiveIntensity: 1.1 })
        glowMaterials.set(emissive, m)
    }
    return m
}

function mergedMesh(parts: Part[], material: THREE.Material, origin: [number, number, number] = [0, 0, 0]): THREE.Mesh {
    const pieces = parts.map(p => bake(p, ...origin))
    const mesh = new THREE.Mesh(pieces.length === 1 ? pieces[0]! : mergeGeometries(pieces)!, material)
    if (pieces.length > 1) pieces.forEach(piece => piece.dispose())
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
}

/** Build a model from its spec. Exported for road tiles and other scenery. */
export function buildTownModel(spec: ModelSpec): THREE.Group {
    const group = new THREE.Group()
    const solid = spec.parts.filter(p => !p.emissive)
    if (solid.length) group.add(mergedMesh(solid, bodyMaterial))
    const lit = new Map<number, Part[]>()
    for (const p of spec.parts) if (p.emissive) lit.set(p.emissive, [...lit.get(p.emissive) ?? [], p])
    for (const [emissive, parts] of lit) {
        const mesh = mergedMesh(parts, glowMaterial(emissive))
        mesh.name = 'glow'
        mesh.castShadow = false
        group.add(mesh)
    }
    for (const spinner of spec.spinners ?? []) {
        const mesh = mergedMesh(spinner.parts, bodyMaterial, spinner.pivot)
        mesh.position.set(...spinner.pivot)
        mesh.name = 'spin'
        mesh.userData.spinAxis = spinner.axis
        mesh.userData.spinRate = spinner.rate ?? 4
        group.add(mesh)
    }
    for (const [x, y, z] of spec.smoke ?? []) {
        const vent = new THREE.Object3D()
        vent.position.set(x, y, z)
        vent.name = 'smoke'
        group.add(vent)
    }
    return group
}

// Vehicles are built from plain coloured meshes rather than part lists.
const materialCache = new Map<string, THREE.MeshStandardMaterial>()
export function townMaterial(color: number, emissive = 0): THREE.MeshStandardMaterial {
    const key = `${color}:${emissive}`
    let m = materialCache.get(key)
    if (!m) {
        m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: emissive ? 1.4 : 0, roughness: 0.85, metalness: 0.02, flatShading: true })
        materialCache.set(key, m)
    }
    return m
}

/** (stage 0–4, colour variant) → parts. Stage is the only thing a level changes. */
export type TownModelFactory = (stage: number, variant: number) => ModelSpec

const MODELS: Partial<Record<TownBuildingId, TownModelFactory>> = {
    house: houseModel,
    bakery: bakeryModel,
    emporium: emporiumModel,
    ...RESOURCE_MODELS,
    ...INDUSTRY_MODELS,
    ...CIVIC_MODELS
}

/** How many colour variants a building has; the scene picks one per tile. */
export const TOWN_MODEL_VARIANTS = 12

const prototypes = new Map<string, THREE.Group>()

/** The raw part list behind a building's look, for previews and checks. */
export function townModelSpec(type: TownBuildingId, stage: number, variant = 0): ModelSpec {
    return paintAs(type, () => (MODELS[type] ?? MODELS.park!)(stage, variant))
}

/** A fresh instance of a building model; geometry and static materials are shared. */
export function createBuildingModel(type: TownBuildingId, requestedLevel = 1, variant = 0): THREE.Group {
    const level = type === 'road' ? 1 : townVisualLevel(requestedLevel)
    const look = ((Math.floor(variant) % TOWN_MODEL_VARIANTS) + TOWN_MODEL_VARIANTS) % TOWN_MODEL_VARIANTS
    const key = `${type}:${level}:${look}`
    let proto = prototypes.get(key)
    if (!proto) {
        // A building nobody has modelled yet borrows the park rather than crashing.
        proto = buildTownModel(townModelSpec(type, townVisualStage(level), look))
        proto.userData.visualLevel = level
        proto.userData.visualStage = townVisualStage(level)
        proto.userData.height = new THREE.Box3().setFromObject(proto).max.y
        prototypes.set(key, proto)
    }
    const instance = proto.clone(true)
    // Window animation is per building; geometry and static materials stay shared.
    instance.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name === 'glow') o.material = (o.material as THREE.MeshStandardMaterial).clone()
    })
    return instance
}
