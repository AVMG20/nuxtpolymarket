// Voxel Arena — voxel model builders. Every model is a list of axis-aligned
// boxes (center + size + colour) assembled into a THREE.Group. Named parts get
// a pivot group so limbs can swing from the hip or shoulder.

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { armorDetail, firearmDetail, bladeDetail, enemyDetail, deviceDetail, panel } from './model-detail'
import type { EnemyId, MeleeId, WeaponId } from './types'

export interface VoxPart {
    x: number
    y: number
    z: number
    w: number
    h: number
    d: number
    color: number
    emissive?: number
    glow?: number
    name?: string
    /** Cosmetic geometry is merged and excluded from combat debris. */
    detail?: boolean
    shape?: 'box' | 'cylinder'
    rotation?: [number, number, number]
    /** Pivot point for animated parts (defaults to the part centre). */
    pivot?: [number, number, number]
}

export interface VoxModel {
    group: THREE.Group
    parts: Map<string, THREE.Object3D>
    meshes: THREE.Mesh[]
}

export const BOX = new THREE.BoxGeometry(1, 1, 1)
const BARREL = new THREE.CylinderGeometry(0.5, 0.5, 1, 12).rotateX(Math.PI / 2)
const ARMOR_BOX = new RoundedBoxGeometry(1, 1, 1, 1, 0.045)

const detailGeometryCache = new Map<string, THREE.BufferGeometry>()

const materialCache = new Map<string, THREE.MeshStandardMaterial>()

export function voxMaterial(color: number, emissive = 0, glow = 1): THREE.MeshStandardMaterial {
    const key = `${color}:${emissive}:${glow}`
    let mat = materialCache.get(key)
    if (!mat) {
        mat = new THREE.MeshStandardMaterial({
            color,
            emissive,
            emissiveIntensity: emissive ? glow : 0,
            roughness: 0.85,
            metalness: 0.05,
            flatShading: true
        })
        materialCache.set(key, mat)
    }
    return mat
}

// Model-only finishes; particle, tracer and other effect materials keep voxMaterial.
const modelMaterialCache = new Map<string, THREE.MeshStandardMaterial>()
function modelMaterial(p: VoxPart): THREE.MeshStandardMaterial {
    const key = `${p.color}:${p.emissive ?? 0}:${p.glow ?? 1}`
    let material = modelMaterialCache.get(key)
    if (!material) {
        const color = new THREE.Color(p.color)
        const light = (color.r + color.g + color.b) / 3
        material = new THREE.MeshStandardMaterial({
            color,
            emissive: p.emissive ?? 0,
            emissiveIntensity: p.emissive ? p.glow ?? 1 : 0,
            roughness: light > 0.45 ? 0.38 : 0.5,
            metalness: light > 0.45 ? 0.25 : 0.48
        })
        modelMaterialCache.set(key, material)
    }
    return material
}

export const FLASH_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe6e6, emissiveIntensity: 0.9, roughness: 1 })
/** Big enemies fill the screen, so their hit flash is only a light tint. */
export const FLASH_MATERIAL_SOFT = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd0d0, emissiveIntensity: 0.3, roughness: 1 })

export function buildModel(parts: VoxPart[], scale = 1): VoxModel {
    const group = new THREE.Group()
    const named = new Map<string, THREE.Object3D>()
    const meshes: THREE.Mesh[] = []
    for (const p of parts.filter(p => !p.detail)) {
        const mesh = new THREE.Mesh(p.shape === 'cylinder' ? BARREL : p.emissive ? BOX : ARMOR_BOX, modelMaterial(p))
        mesh.scale.set(p.w, p.h, p.d)
        if (p.rotation) mesh.rotation.set(...p.rotation)
        mesh.castShadow = true
        mesh.receiveShadow = false
        mesh.userData.part = p
        mesh.userData.baseMaterial = mesh.material
        meshes.push(mesh)
        if (p.name && p.pivot) {
            let pivot = named.get(p.name) as THREE.Group | undefined
            if (!pivot) {
                pivot = new THREE.Group()
                pivot.position.set(p.pivot[0], p.pivot[1], p.pivot[2])
                pivot.name = p.name
                named.set(p.name, pivot)
                group.add(pivot)
            }
            mesh.position.set(p.x - p.pivot[0], p.y - p.pivot[1], p.z - p.pivot[2])
            pivot.add(mesh)
        } else {
            mesh.position.set(p.x, p.y, p.z)
            if (p.name) named.set(p.name, mesh)
            group.add(mesh)
        }
    }
    // Batch the fine surface work: no per-rivet draw calls or extra death particles.
    const batches = new Map<string, { parent: THREE.Object3D, material: THREE.MeshStandardMaterial, pieces: VoxPart[] }>()
    for (const p of parts.filter(p => p.detail)) {
        let parent: THREE.Object3D = group
        if (p.name && p.pivot) {
            let pivot = named.get(p.name)
            if (!pivot) {
                pivot = new THREE.Group()
                pivot.position.set(...p.pivot)
                pivot.name = p.name
                named.set(p.name, pivot)
                group.add(pivot)
            }
            parent = pivot
        }
        const material = modelMaterial(p)
        const key = `${parent.uuid}:${material.uuid}`
        let batch = batches.get(key)
        if (!batch) {
            batch = { parent, material, pieces: [] }
            batches.set(key, batch)
        }
        batch.pieces.push(p)
    }
    for (const batch of batches.values()) {
        const origin = batch.parent === group ? new THREE.Vector3() : batch.parent.position
        const key = JSON.stringify([origin.toArray(), batch.pieces])
        let geometry = detailGeometryCache.get(key)
        if (!geometry) {
            const pieces = batch.pieces.map(p => {
                const piece = (p.shape === 'cylinder' ? BARREL : BOX).clone()
                piece.scale(p.w, p.h, p.d)
                if (p.rotation) piece.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rotation)))
                piece.translate(p.x - origin.x, p.y - origin.y, p.z - origin.z)
                return piece
            })
            geometry = mergeGeometries(pieces) ?? undefined
            for (const piece of pieces) piece.dispose()
            if (geometry) detailGeometryCache.set(key, geometry)
        }
        if (geometry) batch.parent.add(new THREE.Mesh(geometry, batch.material))
    }
    group.scale.setScalar(scale)
    return { group, parts: named, meshes }
}

/** Colour of every voxel in a model, weighted by volume — used for death debris. */
export function modelDebrisColors(parts: VoxPart[]): { color: number, volume: number, x: number, y: number, z: number }[] {
    return parts.map(p => ({ color: p.emissive ?? p.color, volume: p.w * p.h * p.d, x: p.x, y: p.y, z: p.z }))
}

// ── Player ────────────────────────────────────────────────────────────────

const IVORY = 0xe9e4d6
const IVORY_DARK = 0xc9c2b1
const GOLD = 0xd9a63c
const CYAN = 0x3ff0ff
const DARK = 0x2b2f3a

export function playerParts(): VoxPart[] {
    return armorDetail(playerCore(), CYAN)
}

function playerCore(): VoxPart[] {
    const legPivotL: [number, number, number] = [-0.19, 0.92, 0]
    const legPivotR: [number, number, number] = [0.19, 0.92, 0]
    const armPivotL: [number, number, number] = [-0.56, 1.55, 0]
    const armPivotR: [number, number, number] = [0.56, 1.55, 0]
    return [
        // legs
        { x: -0.19, y: 0.5, z: 0, w: 0.3, h: 0.84, d: 0.32, color: IVORY_DARK, name: 'legL', pivot: legPivotL },
        { x: -0.19, y: 0.12, z: 0.04, w: 0.32, h: 0.22, d: 0.42, color: DARK, name: 'legL', pivot: legPivotL },
        { x: -0.19, y: 0.62, z: 0.17, w: 0.2, h: 0.36, d: 0.06, color: GOLD, name: 'legL', pivot: legPivotL },
        { x: 0.19, y: 0.5, z: 0, w: 0.3, h: 0.84, d: 0.32, color: IVORY_DARK, name: 'legR', pivot: legPivotR },
        { x: 0.19, y: 0.12, z: 0.04, w: 0.32, h: 0.22, d: 0.42, color: DARK, name: 'legR', pivot: legPivotR },
        { x: 0.19, y: 0.62, z: 0.17, w: 0.2, h: 0.36, d: 0.06, color: GOLD, name: 'legR', pivot: legPivotR },
        // hips + torso
        { x: 0, y: 0.98, z: 0, w: 0.62, h: 0.24, d: 0.36, color: DARK, name: 'body' },
        { x: 0, y: 1.32, z: 0, w: 0.72, h: 0.62, d: 0.44, color: IVORY, name: 'body' },
        { x: 0, y: 1.36, z: 0.24, w: 0.34, h: 0.1, d: 0.06, color: CYAN, emissive: CYAN, glow: 2.4, name: 'body' },
        { x: 0, y: 1.2, z: 0.24, w: 0.16, h: 0.18, d: 0.05, color: GOLD, name: 'body' },
        { x: 0, y: 1.3, z: -0.24, w: 0.4, h: 0.4, d: 0.08, color: IVORY_DARK, name: 'body' },
        // shoulders
        { x: -0.52, y: 1.66, z: 0, w: 0.34, h: 0.24, d: 0.42, color: GOLD },
        { x: 0.52, y: 1.66, z: 0, w: 0.34, h: 0.24, d: 0.42, color: GOLD },
        // arms
        { x: -0.56, y: 1.2, z: 0, w: 0.24, h: 0.68, d: 0.26, color: IVORY, name: 'armL', pivot: armPivotL },
        { x: -0.56, y: 0.84, z: 0, w: 0.26, h: 0.14, d: 0.28, color: DARK, name: 'armL', pivot: armPivotL },
        { x: 0.56, y: 1.2, z: 0, w: 0.24, h: 0.68, d: 0.26, color: IVORY, name: 'armR', pivot: armPivotR },
        { x: 0.56, y: 0.84, z: 0, w: 0.26, h: 0.14, d: 0.28, color: DARK, name: 'armR', pivot: armPivotR },
        // head
        { x: 0, y: 1.72, z: 0, w: 0.22, h: 0.14, d: 0.22, color: DARK, name: 'head', pivot: [0, 1.66, 0] },
        { x: 0, y: 2.0, z: 0, w: 0.46, h: 0.46, d: 0.46, color: IVORY, name: 'head', pivot: [0, 1.66, 0] },
        { x: 0, y: 2.02, z: 0.24, w: 0.36, h: 0.1, d: 0.06, color: CYAN, emissive: CYAN, glow: 3, name: 'head', pivot: [0, 1.66, 0] },
        { x: 0, y: 2.28, z: -0.04, w: 0.1, h: 0.16, d: 0.42, color: GOLD, name: 'head', pivot: [0, 1.66, 0] },
        { x: 0.27, y: 2.0, z: 0, w: 0.08, h: 0.28, d: 0.3, color: GOLD, name: 'head', pivot: [0, 1.66, 0] },
        { x: -0.27, y: 2.0, z: 0, w: 0.08, h: 0.28, d: 0.3, color: GOLD, name: 'head', pivot: [0, 1.66, 0] }
    ]
}

// ── Weapons (first-person viewmodel, grip at the origin, barrel along +Z) ──

const GUN = 0x353a47
const GUN_LIGHT = 0x5b6373
const GUN_DARK = 0x1f2330

/** Common grip, trigger and stock so every gun sits in the hand the same way. */
function grip(color = GUN_LIGHT): VoxPart[] {
    return [
        { x: 0, y: -0.2, z: -0.02, w: 0.12, h: 0.26, d: 0.14, color },
        { x: 0, y: -0.05, z: 0.18, w: 0.05, h: 0.1, d: 0.04, color: GUN_DARK },
        { x: 0, y: 0.02, z: -0.42, w: 0.14, h: 0.18, d: 0.26, color: GUN_DARK }
    ]
}

/** Sight housings sit at y ≈ 0.3 so ADS can line every dot up on the reticle. */
function sightHousing(kind: 'reddot' | 'holo' | 'scope' | 'iron' | 'ring', color: number): VoxPart[] {
    // Only the sniper carries optics on the model; every other reticle lives on the HUD so
    // nothing sits between you and the target while aiming.
    if (kind !== 'scope') return []
    return [
        { x: 0, y: 0.22, z: 0.0, w: 0.08, h: 0.08, d: 0.16, color: GUN_DARK },
        { x: 0, y: 0.34, z: 0.05, w: 0.14, h: 0.14, d: 0.62, color: GUN_DARK },
        { x: 0, y: 0.34, z: 0.38, w: 0.18, h: 0.18, d: 0.08, color: 0x14181f },
        { x: 0, y: 0.34, z: 0.43, w: 0.12, h: 0.12, d: 0.02, color, emissive: color, glow: 0.4 },
        { x: 0, y: 0.34, z: -0.28, w: 0.16, h: 0.16, d: 0.06, color: 0x14181f }
    ]
}

const WOOD = 0x6b4a2a
const WOOD_DARK = 0x4a3220
const STEEL = 0x8a8f9c

/** Straight box magazine hanging under the receiver. */
function boxMag(z: number, h = 0.3, color = GUN_DARK): VoxPart {
    return { x: 0, y: -0.14 - h / 2, z, w: 0.09, h, d: 0.16, color }
}

export function weaponParts(id: WeaponId): VoxPart[] {
    return firearmDetail(weaponCore(id), id)
}

function weaponCore(id: WeaponId): VoxPart[] {
    switch (id) {
        case 'pistol': {
            const c = 0xffd9a0
            return [
                ...grip(GUN_DARK),
                { x: 0, y: 0.04, z: 0.14, w: 0.13, h: 0.16, d: 0.66, color: GUN },
                { x: 0, y: 0.1, z: 0.14, w: 0.11, h: 0.06, d: 0.62, color: GUN_LIGHT },
                { x: 0, y: 0.0, z: 0.5, w: 0.06, h: 0.06, d: 0.12, color: STEEL },
                { x: 0, y: -0.02, z: 0.22, w: 0.14, h: 0.05, d: 0.2, color: GUN_DARK },
                ...sightHousing('iron', c)
            ]
        }
        case 'magnum': {
            const c = 0xffe0b0
            return [
                ...grip(WOOD),
                { x: 0, y: 0.04, z: 0.02, w: 0.16, h: 0.2, d: 0.3, color: STEEL },
                { x: 0, y: 0.06, z: 0.55, w: 0.1, h: 0.12, d: 0.8, color: STEEL },
                { x: 0, y: -0.04, z: 0.55, w: 0.08, h: 0.06, d: 0.74, color: 0x6f747f },
                { x: 0, y: 0.02, z: 0.06, w: 0.2, h: 0.2, d: 0.22, color: 0x6f747f },
                { x: 0, y: 0.06, z: 0.97, w: 0.12, h: 0.14, d: 0.04, color: GUN_DARK },
                ...sightHousing('iron', c)
            ]
        }
        case 'smg': {
            const c = 0xffe6a8
            return [
                ...grip(GUN_DARK),
                { x: 0, y: 0.04, z: 0.1, w: 0.16, h: 0.2, d: 0.62, color: GUN },
                { x: 0, y: 0.06, z: 0.56, w: 0.08, h: 0.08, d: 0.34, color: GUN_LIGHT },
                { x: 0, y: 0.06, z: 0.75, w: 0.11, h: 0.11, d: 0.1, color: GUN_DARK },
                boxMag(0.16, 0.34),
                { x: 0, y: 0.02, z: -0.5, w: 0.06, h: 0.06, d: 0.24, color: STEEL },
                { x: 0, y: 0.02, z: -0.62, w: 0.12, h: 0.16, d: 0.06, color: GUN_DARK },
                { x: 0, y: -0.08, z: 0.4, w: 0.12, h: 0.06, d: 0.24, color: GUN_LIGHT },
                ...sightHousing('reddot', c)
            ]
        }
        case 'rifle': {
            const c = 0xffd08a
            return [
                ...grip(WOOD),
                { x: 0, y: 0.04, z: 0.12, w: 0.15, h: 0.2, d: 0.7, color: GUN },
                { x: 0, y: 0.06, z: 0.72, w: 0.14, h: 0.16, d: 0.44, color: WOOD },
                { x: 0, y: 0.08, z: 1.1, w: 0.07, h: 0.07, d: 0.42, color: GUN_LIGHT },
                { x: 0, y: 0.13, z: 1.0, w: 0.05, h: 0.05, d: 0.5, color: STEEL },
                { x: 0, y: 0.08, z: 1.33, w: 0.1, h: 0.1, d: 0.08, color: GUN_DARK },
                { x: 0, y: -0.24, z: 0.16, w: 0.09, h: 0.28, d: 0.16, color: 0x7a5a2a },
                { x: 0, y: -0.36, z: 0.22, w: 0.09, h: 0.14, d: 0.16, color: 0x7a5a2a },
                { x: 0, y: 0.02, z: -0.56, w: 0.12, h: 0.18, d: 0.36, color: WOOD_DARK },
                ...sightHousing('reddot', c)
            ]
        }
        case 'dmr': {
            const c = 0xfff0c8
            return [
                ...grip(GUN_DARK),
                { x: 0, y: 0.04, z: 0.2, w: 0.14, h: 0.2, d: 0.9, color: GUN },
                { x: 0, y: 0.08, z: 1.0, w: 0.07, h: 0.07, d: 0.7, color: GUN_LIGHT },
                { x: 0, y: 0.08, z: 1.38, w: 0.11, h: 0.11, d: 0.1, color: GUN_DARK },
                { x: 0, y: -0.04, z: 0.75, w: 0.12, h: 0.08, d: 0.5, color: GUN_DARK },
                boxMag(0.18, 0.3),
                { x: 0, y: 0.02, z: -0.58, w: 0.13, h: 0.2, d: 0.4, color: GUN },
                { x: 0, y: 0.14, z: -0.54, w: 0.1, h: 0.05, d: 0.28, color: GUN_LIGHT },
                ...sightHousing('holo', c)
            ]
        }
        case 'shotgun': {
            const c = 0xffb060
            return [
                ...grip(WOOD),
                { x: 0, y: 0.04, z: 0.1, w: 0.14, h: 0.18, d: 0.5, color: STEEL },
                { x: 0, y: 0.1, z: 0.8, w: 0.1, h: 0.1, d: 0.9, color: GUN },
                { x: 0, y: -0.02, z: 0.8, w: 0.09, h: 0.09, d: 0.84, color: GUN_LIGHT },
                { x: 0, y: -0.02, z: 0.72, w: 0.16, h: 0.14, d: 0.36, color: WOOD },
                { x: 0, y: 0.02, z: -0.58, w: 0.14, h: 0.22, d: 0.44, color: WOOD_DARK },
                ...sightHousing('iron', c)
            ]
        }
        case 'lmg': {
            const c = 0xffc880
            return [
                ...grip(GUN_DARK),
                { x: 0, y: 0.04, z: 0.2, w: 0.18, h: 0.24, d: 0.9, color: GUN },
                { x: 0, y: 0.08, z: 1.02, w: 0.1, h: 0.1, d: 0.8, color: GUN_LIGHT },
                { x: 0, y: 0.08, z: 1.42, w: 0.15, h: 0.15, d: 0.1, color: GUN_DARK },
                { x: 0, y: -0.06, z: 0.9, w: 0.14, h: 0.08, d: 0.6, color: GUN_DARK },
                { x: 0, y: -0.3, z: 0.2, w: 0.24, h: 0.26, d: 0.34, color: 0x2f3a2a },
                { x: 0, y: -0.3, z: 0.2, w: 0.26, h: 0.06, d: 0.36, color: 0x3f4a3a },
                { x: 0.06, y: -0.3, z: 1.2, w: 0.03, h: 0.4, d: 0.03, color: STEEL },
                { x: -0.06, y: -0.3, z: 1.2, w: 0.03, h: 0.4, d: 0.03, color: STEEL },
                { x: 0, y: 0.02, z: -0.6, w: 0.14, h: 0.24, d: 0.4, color: GUN },
                ...sightHousing('holo', c)
            ]
        }
        case 'saw': {
            const c = 0xffd090
            return [
                ...grip(WOOD),
                { x: 0, y: 0.04, z: 0.14, w: 0.16, h: 0.22, d: 0.76, color: GUN },
                { x: 0, y: 0.06, z: 0.76, w: 0.15, h: 0.16, d: 0.5, color: WOOD },
                { x: 0, y: 0.08, z: 1.2, w: 0.08, h: 0.08, d: 0.5, color: GUN_LIGHT },
                { x: 0, y: 0.08, z: 1.46, w: 0.11, h: 0.11, d: 0.08, color: GUN_DARK },
                { x: 0, y: -0.26, z: 0.2, w: 0.3, h: 0.3, d: 0.16, color: GUN_DARK },
                { x: 0, y: -0.26, z: 0.2, w: 0.24, h: 0.24, d: 0.18, color: 0x3a3f4b },
                { x: 0.06, y: -0.2, z: 1.1, w: 0.03, h: 0.32, d: 0.03, color: STEEL },
                { x: -0.06, y: -0.2, z: 1.1, w: 0.03, h: 0.32, d: 0.03, color: STEEL },
                { x: 0, y: 0.02, z: -0.58, w: 0.13, h: 0.2, d: 0.4, color: WOOD_DARK },
                ...sightHousing('reddot', c)
            ]
        }
        case 'sniper': {
            const c = 0xf0f6ff
            return [
                ...grip(GUN_DARK),
                { x: 0, y: 0.04, z: 0.2, w: 0.14, h: 0.2, d: 1.0, color: 0x2a3140 },
                { x: 0, y: 0.08, z: 1.2, w: 0.07, h: 0.07, d: 1.0, color: GUN_LIGHT },
                { x: 0, y: 0.08, z: 1.72, w: 0.12, h: 0.12, d: 0.14, color: GUN_DARK },
                { x: 0.1, y: 0.1, z: -0.02, w: 0.05, h: 0.05, d: 0.18, color: STEEL },
                { x: 0.16, y: 0.1, z: 0.04, w: 0.06, h: 0.06, d: 0.06, color: STEEL },
                { x: 0, y: -0.06, z: 0.7, w: 0.12, h: 0.1, d: 0.6, color: 0x2a3140 },
                boxMag(0.14, 0.2),
                { x: 0, y: 0.02, z: -0.62, w: 0.13, h: 0.24, d: 0.5, color: 0x2a3140 },
                { x: 0, y: 0.16, z: -0.5, w: 0.1, h: 0.06, d: 0.3, color: GUN_LIGHT },
                { x: 0.06, y: -0.3, z: 1.2, w: 0.03, h: 0.36, d: 0.03, color: STEEL },
                { x: -0.06, y: -0.3, z: 1.2, w: 0.03, h: 0.36, d: 0.03, color: STEEL },
                ...sightHousing('scope', c)
            ]
        }
        case 'raygun': {
            const c = 0x7dff5a
            return [
                ...grip(0x8a1a1a),
                { x: 0, y: 0.04, z: 0.06, w: 0.2, h: 0.24, d: 0.5, color: 0xb02a2a },
                { x: 0, y: 0.06, z: 0.5, w: 0.26, h: 0.26, d: 0.3, color: 0x8a1a1a },
                { x: 0, y: 0.06, z: 0.5, w: 0.3, h: 0.06, d: 0.32, color: STEEL },
                { x: 0, y: 0.06, z: 0.5, w: 0.06, h: 0.3, d: 0.32, color: STEEL },
                { x: 0, y: 0.06, z: 0.76, w: 0.12, h: 0.12, d: 0.3, color: STEEL },
                { x: 0, y: 0.06, z: 0.92, w: 0.16, h: 0.16, d: 0.06, color: c, emissive: c, glow: 1 },
                { x: 0.12, y: 0.12, z: 0.2, w: 0.04, h: 0.04, d: 0.28, color: c, emissive: c, glow: 0.8 },
                { x: -0.12, y: 0.12, z: 0.2, w: 0.04, h: 0.04, d: 0.28, color: c, emissive: c, glow: 0.8 },
                { x: 0, y: 0.2, z: 0.02, w: 0.1, h: 0.1, d: 0.1, color: c, emissive: c, glow: 0.8 },
                ...sightHousing('ring', c)
            ]
        }
        case 'burst': {
            const c = 0xa8e6ff
            return [
                ...grip(GUN_DARK),
                { x: 0, y: 0.04, z: 0.14, w: 0.15, h: 0.2, d: 0.66, color: GUN },
                { x: 0, y: 0.15, z: 0.1, w: 0.11, h: 0.05, d: 0.52, color: GUN_LIGHT },
                { x: 0.08, y: 0.06, z: 0.22, w: 0.02, h: 0.06, d: 0.32, color: c, emissive: c, glow: 1 },
                { x: -0.08, y: 0.06, z: 0.22, w: 0.02, h: 0.06, d: 0.32, color: c, emissive: c, glow: 1 },
                { x: 0, y: 0.06, z: 0.6, w: 0.09, h: 0.09, d: 0.3, color: GUN_LIGHT },
                { x: 0, y: 0.06, z: 0.9, w: 0.15, h: 0.15, d: 0.34, color: GUN_DARK },
                { x: 0, y: 0.06, z: 1.09, w: 0.1, h: 0.1, d: 0.04, color: 0x14181f },
                { x: 0, y: -0.16, z: 0.58, w: 0.09, h: 0.22, d: 0.12, color: GUN_DARK },
                { x: 0, y: -0.3, z: 0.65, w: 0.09, h: 0.14, d: 0.12, color: GUN_DARK },
                boxMag(0.14, 0.32),
                { x: 0.05, y: 0.04, z: -0.62, w: 0.03, h: 0.03, d: 0.2, color: STEEL },
                { x: -0.05, y: 0.04, z: -0.62, w: 0.03, h: 0.03, d: 0.2, color: STEEL },
                { x: 0, y: 0.02, z: -0.76, w: 0.13, h: 0.2, d: 0.08, color: GUN_DARK },
                ...sightHousing('holo', c)
            ]
        }
        case 'flamer': {
            const c = 0xff7a2a
            const tank = 0x8a3a1a
            const band = 0xffa23a
            return [
                ...grip(GUN_DARK),
                { x: 0, y: 0.04, z: 0.1, w: 0.2, h: 0.24, d: 0.6, color: GUN },
                // twin fuel canisters slung under the receiver
                { x: 0, y: -0.3, z: 0.14, w: 0.3, h: 0.26, d: 0.5, color: tank },
                { x: 0, y: -0.3, z: 0.14, w: 0.32, h: 0.08, d: 0.52, color: band },
                { x: 0, y: -0.54, z: 0.14, w: 0.26, h: 0.22, d: 0.44, color: tank },
                { x: 0, y: -0.54, z: 0.14, w: 0.28, h: 0.07, d: 0.46, color: band },
                { x: 0, y: -0.34, z: -0.16, w: 0.07, h: 0.4, d: 0.07, color: STEEL },
                // nozzle with a pilot flame burning at the tip
                { x: 0, y: 0.06, z: 0.62, w: 0.12, h: 0.12, d: 0.5, color: STEEL },
                { x: 0, y: 0.06, z: 0.94, w: 0.17, h: 0.17, d: 0.14, color: GUN_DARK },
                { x: 0, y: 0.06, z: 1.08, w: 0.1, h: 0.1, d: 0.16, color: GUN_LIGHT },
                { x: 0, y: 0.06, z: 1.2, w: 0.07, h: 0.07, d: 0.07, color: c, emissive: c, glow: 1.2 },
                // top carry handle
                { x: 0, y: 0.26, z: 0.1, w: 0.06, h: 0.06, d: 0.46, color: GUN_DARK },
                { x: 0, y: 0.19, z: -0.1, w: 0.06, h: 0.1, d: 0.06, color: GUN_DARK },
                { x: 0, y: 0.19, z: 0.3, w: 0.06, h: 0.1, d: 0.06, color: GUN_DARK },
                ...sightHousing('ring', c)
            ]
        }
        case 'launcher': {
            const c = 0xd9a63c
            const drum = 0x2f3a2a
            return [
                ...grip(GUN_DARK),
                { x: 0, y: 0.04, z: -0.02, w: 0.16, h: 0.2, d: 0.42, color: GUN },
                // six-round revolving drum
                { x: 0, y: 0.04, z: 0.32, w: 0.36, h: 0.36, d: 0.28, color: drum },
                { x: 0, y: 0.04, z: 0.32, w: 0.38, h: 0.1, d: 0.3, color: 0x3f4a3a },
                { x: 0.11, y: 0.04, z: 0.47, w: 0.06, h: 0.06, d: 0.04, color: 0x14181f },
                { x: 0.055, y: 0.135, z: 0.47, w: 0.06, h: 0.06, d: 0.04, color: 0x14181f },
                { x: -0.055, y: 0.135, z: 0.47, w: 0.06, h: 0.06, d: 0.04, color: 0x14181f },
                { x: -0.11, y: 0.04, z: 0.47, w: 0.06, h: 0.06, d: 0.04, color: 0x14181f },
                { x: -0.055, y: -0.055, z: 0.47, w: 0.06, h: 0.06, d: 0.04, color: 0x14181f },
                { x: 0.055, y: -0.055, z: 0.47, w: 0.06, h: 0.06, d: 0.04, color: 0x14181f },
                { x: 0.19, y: 0.04, z: 0.32, w: 0.04, h: 0.08, d: 0.08, color: c, emissive: c, glow: 1 },
                // fat, wide-bore barrel
                { x: 0, y: 0.04, z: 0.68, w: 0.2, h: 0.2, d: 0.44, color: GUN_LIGHT },
                { x: 0, y: 0.04, z: 0.92, w: 0.24, h: 0.24, d: 0.08, color: GUN_DARK },
                { x: 0, y: 0.04, z: 0.97, w: 0.14, h: 0.14, d: 0.03, color: 0x14181f },
                // leaf sight
                { x: 0, y: 0.2, z: -0.16, w: 0.1, h: 0.14, d: 0.03, color: GUN_DARK },
                { x: 0, y: 0.18, z: 0.86, w: 0.03, h: 0.1, d: 0.03, color: STEEL },
                // stubby stock
                { x: 0, y: 0.02, z: -0.62, w: 0.15, h: 0.22, d: 0.24, color: GUN },
                ...sightHousing('iron', c)
            ]
        }
        case 'arc': {
            const c = 0xb56bff
            return [
                ...grip(WOOD_DARK),
                { x: 0, y: 0.04, z: 0.12, w: 0.18, h: 0.22, d: 0.7, color: 0x2a1f40 },
                { x: 0, y: 0.06, z: 0.62, w: 0.24, h: 0.24, d: 0.36, color: 0x3a2a55 },
                { x: 0.11, y: 0.06, z: 0.62, w: 0.05, h: 0.28, d: 0.4, color: STEEL },
                { x: -0.11, y: 0.06, z: 0.62, w: 0.05, h: 0.28, d: 0.4, color: STEEL },
                { x: 0, y: 0.06, z: 0.62, w: 0.14, h: 0.14, d: 0.42, color: c, emissive: c, glow: 1.2 },
                { x: 0, y: 0.06, z: 0.9, w: 0.08, h: 0.08, d: 0.2, color: STEEL },
                { x: 0, y: 0.06, z: 1.02, w: 0.16, h: 0.16, d: 0.05, color: c, emissive: c, glow: 0.8 },
                { x: 0, y: 0.02, z: -0.56, w: 0.14, h: 0.22, d: 0.36, color: WOOD_DARK },
                ...sightHousing('holo', c)
            ]
        }
    }
}

/** Melee weapons: grip at the origin, blade along +Z. */
export function meleeParts(id: MeleeId): VoxPart[] {
    return bladeDetail(meleeCore(id), id)
}

function meleeCore(id: MeleeId): VoxPart[] {
    const grip = 0x2b2f3a
    switch (id) {
        case 'sword':
            return [
                { x: 0, y: 0, z: -0.16, w: 0.08, h: 0.08, d: 0.34, color: 0x3a2a1a },
                { x: 0, y: 0, z: -0.34, w: 0.12, h: 0.12, d: 0.06, color: STEEL },
                { x: 0, y: 0, z: 0.04, w: 0.38, h: 0.08, d: 0.08, color: 0x9c7a34 },
                { x: 0, y: 0, z: 0.72, w: 0.06, h: 0.16, d: 1.3, color: 0xd8dde6 },
                { x: 0, y: 0, z: 0.72, w: 0.02, h: 0.06, d: 1.2, color: 0xf4f6f8 },
                { x: 0, y: 0, z: 1.42, w: 0.05, h: 0.1, d: 0.16, color: 0xf4f6f8 }
            ]
        case 'dagger':
            return [
                { x: 0, y: 0, z: -0.1, w: 0.07, h: 0.07, d: 0.24, color: grip },
                { x: 0, y: 0, z: 0.04, w: 0.2, h: 0.05, d: 0.05, color: STEEL },
                { x: 0, y: 0, z: 0.36, w: 0.05, h: 0.1, d: 0.6, color: 0xb8c4d6 },
                { x: 0, y: 0, z: 0.7, w: 0.04, h: 0.06, d: 0.14, color: 0xe6ecf4 }
            ]
        case 'spear':
            return [
                { x: 0, y: 0, z: 0.3, w: 0.07, h: 0.07, d: 2.2, color: 0x6b4a2a },
                { x: 0, y: 0, z: -0.7, w: 0.09, h: 0.09, d: 0.3, color: grip },
                { x: 0, y: 0, z: 1.44, w: 0.18, h: 0.07, d: 0.1, color: 0x9c7a34 },
                { x: 0, y: 0, z: 1.78, w: 0.07, h: 0.14, d: 0.6, color: 0xc9a86a },
                { x: 0, y: 0, z: 2.12, w: 0.05, h: 0.08, d: 0.14, color: 0xf0e0b0 }
            ]
        case 'katana':
            return [
                { x: 0, y: 0, z: -0.18, w: 0.08, h: 0.08, d: 0.4, color: grip },
                { x: 0, y: 0, z: 0.04, w: 0.22, h: 0.22, d: 0.05, color: 0x9c7a34 },
                { x: 0, y: 0.02, z: 0.86, w: 0.04, h: 0.16, d: 1.56, color: 0xd6f7ff, emissive: 0x3ff0ff, glow: 0.5 },
                { x: 0, y: 0.09, z: 0.86, w: 0.02, h: 0.05, d: 1.46, color: 0xffffff, emissive: 0xffffff, glow: 0.4 }
            ]
        case 'axe':
            return [
                { x: 0, y: 0, z: 0.3, w: 0.1, h: 0.1, d: 1.7, color: 0x4a3220 },
                { x: 0, y: 0, z: -0.5, w: 0.12, h: 0.12, d: 0.3, color: grip },
                { x: 0, y: 0, z: 1.05, w: 0.16, h: 0.2, d: 0.3, color: STEEL },
                { x: 0, y: 0.22, z: 1.05, w: 0.08, h: 0.7, d: 0.5, color: 0x8a8f9c },
                { x: 0, y: 0.5, z: 1.05, w: 0.05, h: 0.14, d: 0.7, color: 0xe6ecf4 },
                { x: 0, y: -0.14, z: 1.05, w: 0.08, h: 0.2, d: 0.26, color: 0x8a8f9c },
                { x: 0, y: 0.22, z: 1.05, w: 0.1, h: 0.08, d: 0.08, color: 0xff8a3a, emissive: 0xff8a3a, glow: 0.6 }
            ]
        case 'scythe':
            return [
                { x: 0, y: 0, z: 0.4, w: 0.08, h: 0.08, d: 2.2, color: 0x1f1830 },
                { x: 0, y: 0, z: -0.6, w: 0.1, h: 0.1, d: 0.3, color: grip },
                { x: 0, y: 0, z: 1.5, w: 0.14, h: 0.14, d: 0.16, color: 0x3a2a55 },
                { x: 0.3, y: 0, z: 1.55, w: 0.6, h: 0.05, d: 0.16, color: 0x2a2140 },
                { x: 0.62, y: 0, z: 1.4, w: 0.16, h: 0.05, d: 0.5, color: 0x2a2140 },
                { x: 0.74, y: 0, z: 1.02, w: 0.1, h: 0.05, d: 0.5, color: 0x2a2140 },
                { x: 0.4, y: 0, z: 1.62, w: 0.7, h: 0.02, d: 0.05, color: 0xb56bff, emissive: 0xb56bff, glow: 0.7 },
                { x: 0.7, y: 0, z: 1.25, w: 0.06, h: 0.02, d: 0.8, color: 0xb56bff, emissive: 0xb56bff, glow: 0.7 }
            ]
    }
}

export function meteorParts(): VoxPart[] {
    return deviceDetail(meteorCore(), 0xff7a2a)
}

function meteorCore(): VoxPart[] {
    const rock = 0x3a3040
    const crack = 0xff7a2a
    return [
        { x: 0, y: 0, z: 0, w: 1.4, h: 1.2, d: 1.3, color: rock },
        { x: 0.5, y: 0.3, z: -0.3, w: 0.8, h: 0.8, d: 0.8, color: 0x2c2434 },
        { x: -0.5, y: -0.2, z: 0.4, w: 0.7, h: 0.7, d: 0.7, color: 0x46394f },
        { x: 0, y: 0.1, z: 0.66, w: 0.5, h: 0.14, d: 0.06, color: crack, emissive: crack, glow: 0.9 },
        { x: 0.7, y: -0.1, z: 0, w: 0.06, h: 0.6, d: 0.16, color: crack, emissive: crack, glow: 0.9 },
        { x: -0.2, y: 0.62, z: 0, w: 0.16, h: 0.06, d: 0.5, color: crack, emissive: crack, glow: 0.9 }
    ]
}

export function boulderParts(): VoxPart[] {
    return deviceDetail(boulderCore(), 0xff7a2a)
}

function boulderCore(): VoxPart[] {
    const rock = 0x4a3d6b
    const glow = 0xff6a2a
    return [
        { x: 0, y: 0, z: 0, w: 1, h: 0.9, d: 1, color: rock },
        { x: 0.3, y: 0.3, z: 0.2, w: 0.5, h: 0.5, d: 0.5, color: 0x3a2e55 },
        { x: -0.3, y: -0.2, z: -0.2, w: 0.5, h: 0.5, d: 0.5, color: 0x5a4c80 },
        { x: 0, y: 0, z: 0, w: 1.1, h: 0.12, d: 0.12, color: glow, emissive: glow, glow: 2 },
        { x: 0, y: 0, z: 0, w: 0.12, h: 0.12, d: 1.1, color: glow, emissive: glow, glow: 2 }
    ]
}

export function lanternParts(color: number): VoxPart[] {
    const parts: VoxPart[] = [
        panel(0, 1.6, 0, 0.26, 3.2, 0.26, 0x172332),
        panel(0, 0.16, 0, 0.38, 0.32, 0.38, 0x71899b),
        panel(0, 3.7, 0, 0.85, 0.12, 0.85, 0x71899b),
        panel(0, 3.1, 0, 0.7, 0.12, 0.7, 0x172332),
        panel(0, 3.4, 0, 0.44, 0.48, 0.44, color, color)
    ]
    for (const side of [-1, 1]) {
        parts.push(panel(side * 0.31, 3.4, 0, 0.07, 0.54, 0.62, 0x172332))
        parts.push(panel(0, 3.4, side * 0.31, 0.62, 0.54, 0.07, 0x172332))
        parts.push(panel(side * 0.31, 3.4, 0, 0.085, 0.32, 0.3, color, color))
        parts.push(panel(0, 3.4, side * 0.31, 0.3, 0.32, 0.085, color, color))
        parts.push(panel(side * 0.145, 1.8, 0, 0.025, 2.2, 0.07, color, color))
    }
    for (const y of [0.4, 1, 2.6, 2.95]) parts.push(panel(0, y, 0, 0.35, 0.08, 0.35, 0x71899b))
    return parts
}

// ── Enemies ───────────────────────────────────────────────────────────────

export function enemyParts(id: EnemyId): VoxPart[] {
    return enemyDetail(enemyCore(id), id)
}

function enemyCore(id: EnemyId): VoxPart[] {
    switch (id) {
        case 'grunt': return gruntParts()
        case 'runner': return runnerParts()
        case 'brute': return bruteParts(false)
        case 'titan': return bruteParts(true)
        case 'spitter': return spitterParts()
        case 'drone': return droneParts()
        case 'charger': return chargerParts()
        case 'warden': return wardenParts()
        case 'bomber': return bomberParts()
        case 'mender': return menderParts()
    }
}

function wardenParts(): VoxPart[] {
    const body = 0x9aa4b8
    const dark = 0x2e3442
    const shield = 0x8fa3b8
    const glow = 0x3ff0ff
    return [
        { x: -0.2, y: 0.42, z: 0, w: 0.3, h: 0.8, d: 0.3, color: dark, name: 'legL', pivot: [-0.2, 0.82, 0] },
        { x: 0.2, y: 0.42, z: 0, w: 0.3, h: 0.8, d: 0.3, color: dark, name: 'legR', pivot: [0.2, 0.82, 0] },
        { x: 0, y: 1.18, z: 0, w: 0.72, h: 0.72, d: 0.44, color: body, name: 'body' },
        { x: 0, y: 1.2, z: -0.25, w: 0.4, h: 0.4, d: 0.08, color: dark, name: 'body' },
        { x: -0.5, y: 1.4, z: 0, w: 0.26, h: 0.24, d: 0.4, color: dark },
        { x: 0.5, y: 1.4, z: 0, w: 0.26, h: 0.24, d: 0.4, color: dark },
        { x: 0.5, y: 0.95, z: 0, w: 0.22, h: 0.66, d: 0.24, color: body, name: 'armR', pivot: [0.5, 1.26, 0] },
        { x: 0.5, y: 0.58, z: 0.1, w: 0.2, h: 0.14, d: 0.42, color: 0x8a8f9c, name: 'armR', pivot: [0.5, 1.26, 0] },
        { x: -0.5, y: 0.95, z: 0.1, w: 0.22, h: 0.66, d: 0.24, color: body, name: 'armL', pivot: [-0.5, 1.26, 0] },
        // tower shield held out front on the left arm
        { x: -0.3, y: 1.05, z: 0.52, w: 1.1, h: 1.7, d: 0.14, color: shield, name: 'shield' },
        { x: -0.3, y: 1.05, z: 0.6, w: 0.9, h: 1.5, d: 0.04, color: dark, name: 'shield' },
        { x: -0.3, y: 1.05, z: 0.63, w: 0.16, h: 1.1, d: 0.03, color: glow, emissive: glow, glow: 0.45, name: 'shield' },
        { x: -0.3, y: 1.05, z: 0.63, w: 0.7, h: 0.14, d: 0.03, color: glow, emissive: glow, glow: 0.45, name: 'shield' },
        { x: 0, y: 1.72, z: 0, w: 0.44, h: 0.4, d: 0.44, color: body, name: 'head', pivot: [0, 1.52, 0] },
        { x: 0, y: 1.74, z: 0.23, w: 0.32, h: 0.08, d: 0.04, color: glow, emissive: glow, glow: 3, name: 'head', pivot: [0, 1.52, 0] },
        { x: 0, y: 1.98, z: 0, w: 0.5, h: 0.1, d: 0.5, color: dark, name: 'head', pivot: [0, 1.52, 0] }
    ]
}

function bomberParts(): VoxPart[] {
    const shell = 0x5a3a2a
    const glow = 0xff7a2a
    return [
        { x: -0.16, y: 0.3, z: 0, w: 0.22, h: 0.56, d: 0.24, color: 0x2b2018, name: 'legL', pivot: [-0.16, 0.58, 0] },
        { x: 0.16, y: 0.3, z: 0, w: 0.22, h: 0.56, d: 0.24, color: 0x2b2018, name: 'legR', pivot: [0.16, 0.58, 0] },
        { x: 0, y: 0.95, z: 0, w: 0.8, h: 0.8, d: 0.8, color: shell, name: 'body' },
        { x: 0, y: 0.95, z: 0, w: 0.86, h: 0.2, d: 0.86, color: glow, emissive: glow, glow: 0.6, name: 'core' },
        { x: 0, y: 0.95, z: 0, w: 0.2, h: 0.86, d: 0.2, color: glow, emissive: glow, glow: 0.6, name: 'core' },
        { x: 0, y: 1.1, z: 0.42, w: 0.26, h: 0.12, d: 0.06, color: 0xffe14d, emissive: 0xffe14d, glow: 3, name: 'head' },
        { x: 0, y: 1.45, z: 0, w: 0.14, h: 0.2, d: 0.14, color: 0x8a8f9c },
        { x: 0, y: 1.6, z: 0, w: 0.2, h: 0.1, d: 0.2, color: 0xff3a3a, emissive: 0xff3a3a, glow: 1.4, name: 'core' }
    ]
}

function menderParts(): VoxPart[] {
    const robe = 0x4fbf86
    const dark = 0xe6f4ec
    const glow = 0x7dff5a
    return [
        { x: 0, y: 0.5, z: 0, w: 0.7, h: 1, d: 0.5, color: robe, name: 'body' },
        { x: 0, y: 0.15, z: 0, w: 0.8, h: 0.3, d: 0.6, color: dark, name: 'body' },
        { x: 0, y: 1.2, z: 0, w: 0.6, h: 0.5, d: 0.44, color: robe, name: 'body' },
        { x: 0, y: 1.25, z: 0.24, w: 0.2, h: 0.36, d: 0.06, color: glow, emissive: glow, glow: 0.5, name: 'body' },
        { x: -0.42, y: 1.0, z: 0.1, w: 0.18, h: 0.6, d: 0.2, color: robe, name: 'armL', pivot: [-0.42, 1.28, 0] },
        { x: 0.42, y: 1.0, z: 0.1, w: 0.18, h: 0.6, d: 0.2, color: robe, name: 'armR', pivot: [0.42, 1.28, 0] },
        { x: 0.42, y: 0.66, z: 0.3, w: 0.12, h: 0.12, d: 0.5, color: 0x8a8f9c, name: 'armR', pivot: [0.42, 1.28, 0] },
        { x: 0.42, y: 0.66, z: 0.62, w: 0.24, h: 0.24, d: 0.24, color: glow, emissive: glow, glow: 1.1, name: 'armR', pivot: [0.42, 1.28, 0] },
        { x: 0, y: 1.72, z: 0, w: 0.46, h: 0.46, d: 0.46, color: dark, name: 'head', pivot: [0, 1.5, 0] },
        { x: 0, y: 1.74, z: 0.24, w: 0.3, h: 0.08, d: 0.04, color: glow, emissive: glow, glow: 3, name: 'head', pivot: [0, 1.5, 0] },
        { x: 0, y: 2.05, z: 0, w: 0.2, h: 0.24, d: 0.2, color: glow, emissive: glow, glow: 0.5, name: 'head', pivot: [0, 1.5, 0] }
    ]
}

export function turretParts(): VoxPart[] {
    return deviceDetail(turretCore().map(p => p.name === 'head' ? { ...p, pivot: [0, 0.5, 0] } : p), CYAN)
}

function turretCore(): VoxPart[] {
    const base = 0x3a3f4b
    const gold = 0xd9a63c
    const cyan = 0x3ff0ff
    return [
        { x: 0, y: 0.12, z: 0, w: 0.9, h: 0.24, d: 0.9, color: base },
        { x: 0, y: 0.36, z: 0, w: 0.3, h: 0.3, d: 0.3, color: gold },
        { x: 0, y: 0.7, z: 0, w: 0.5, h: 0.4, d: 0.6, color: 0xe9e4d6, name: 'head' },
        { x: 0.12, y: 0.7, z: 0.45, w: 0.08, h: 0.08, d: 0.5, color: base, name: 'head' },
        { x: -0.12, y: 0.7, z: 0.45, w: 0.08, h: 0.08, d: 0.5, color: base, name: 'head' },
        { x: 0, y: 0.72, z: 0.31, w: 0.24, h: 0.1, d: 0.04, color: cyan, emissive: cyan, glow: 1.2, name: 'head' },
        { x: 0, y: 0.98, z: -0.1, w: 0.12, h: 0.16, d: 0.12, color: cyan, emissive: cyan, glow: 0.5, name: 'head' }
    ]
}

function gruntParts(): VoxPart[] {
    const body = 0x8c93a6
    const dark = 0x2a2f3a
    const eye = 0xff3a3a
    return [
        { x: -0.17, y: 0.42, z: 0, w: 0.26, h: 0.8, d: 0.28, color: dark, name: 'legL', pivot: [-0.17, 0.82, 0] },
        { x: 0.17, y: 0.42, z: 0, w: 0.26, h: 0.8, d: 0.28, color: dark, name: 'legR', pivot: [0.17, 0.82, 0] },
        { x: 0, y: 1.15, z: 0, w: 0.64, h: 0.68, d: 0.4, color: body, name: 'body' },
        { x: 0, y: 1.2, z: 0.22, w: 0.3, h: 0.3, d: 0.06, color: dark, name: 'body' },
        { x: -0.45, y: 1.32, z: 0, w: 0.24, h: 0.22, d: 0.36, color: dark },
        { x: 0.45, y: 1.32, z: 0, w: 0.24, h: 0.22, d: 0.36, color: dark },
        { x: -0.46, y: 0.9, z: 0, w: 0.2, h: 0.62, d: 0.22, color: body, name: 'armL', pivot: [-0.46, 1.2, 0] },
        { x: 0.46, y: 0.9, z: 0, w: 0.2, h: 0.62, d: 0.22, color: body, name: 'armR', pivot: [0.46, 1.2, 0] },
        { x: 0.46, y: 0.56, z: 0.08, w: 0.22, h: 0.12, d: 0.34, color: 0x8a8f9c, name: 'armR', pivot: [0.46, 1.2, 0] },
        { x: 0, y: 1.7, z: 0, w: 0.42, h: 0.4, d: 0.42, color: body, name: 'head', pivot: [0, 1.5, 0] },
        { x: 0, y: 1.72, z: 0.22, w: 0.3, h: 0.08, d: 0.04, color: eye, emissive: eye, glow: 3, name: 'head', pivot: [0, 1.5, 0] },
        { x: 0, y: 1.96, z: 0, w: 0.12, h: 0.14, d: 0.3, color: dark, name: 'head', pivot: [0, 1.5, 0] }
    ]
}

function runnerParts(): VoxPart[] {
    const body = 0xb8322f
    const dark = 0x5a1a18
    const eye = 0xffe14d
    return [
        { x: -0.14, y: 0.45, z: -0.05, w: 0.18, h: 0.9, d: 0.2, color: dark, name: 'legL', pivot: [-0.14, 0.9, -0.05] },
        { x: 0.14, y: 0.45, z: -0.05, w: 0.18, h: 0.9, d: 0.2, color: dark, name: 'legR', pivot: [0.14, 0.9, -0.05] },
        { x: 0, y: 1.1, z: 0.05, w: 0.46, h: 0.5, d: 0.5, color: body, name: 'body' },
        { x: 0, y: 1.1, z: -0.3, w: 0.16, h: 0.16, d: 0.3, color: dark, name: 'body' },
        { x: -0.32, y: 0.95, z: 0.15, w: 0.14, h: 0.5, d: 0.14, color: body, name: 'armL', pivot: [-0.32, 1.2, 0.15] },
        { x: 0.32, y: 0.95, z: 0.15, w: 0.14, h: 0.5, d: 0.14, color: body, name: 'armR', pivot: [0.32, 1.2, 0.15] },
        { x: -0.32, y: 0.66, z: 0.22, w: 0.1, h: 0.14, d: 0.24, color: 0xffd0d0, name: 'armL', pivot: [-0.32, 1.2, 0.15] },
        { x: 0.32, y: 0.66, z: 0.22, w: 0.1, h: 0.14, d: 0.24, color: 0xffd0d0, name: 'armR', pivot: [0.32, 1.2, 0.15] },
        { x: 0, y: 1.42, z: 0.32, w: 0.34, h: 0.3, d: 0.42, color: body, name: 'head', pivot: [0, 1.3, 0.2] },
        { x: 0, y: 1.46, z: 0.54, w: 0.22, h: 0.08, d: 0.04, color: eye, emissive: eye, glow: 3, name: 'head', pivot: [0, 1.3, 0.2] },
        { x: 0, y: 1.3, z: 0.5, w: 0.26, h: 0.06, d: 0.1, color: 0xffd0d0, name: 'head', pivot: [0, 1.3, 0.2] }
    ]
}

function bruteParts(titan: boolean): VoxPart[] {
    const body = titan ? 0x5a4a80 : 0x8a9a4a
    const dark = titan ? 0x2e2448 : 0x3a4428
    const glow = titan ? 0xff6a2a : 0xffb347
    const parts: VoxPart[] = [
        { x: -0.28, y: 0.4, z: 0, w: 0.4, h: 0.76, d: 0.42, color: dark, name: 'legL', pivot: [-0.28, 0.78, 0] },
        { x: 0.28, y: 0.4, z: 0, w: 0.4, h: 0.76, d: 0.42, color: dark, name: 'legR', pivot: [0.28, 0.78, 0] },
        { x: 0, y: 1.25, z: 0, w: 1.1, h: 0.9, d: 0.7, color: body, name: 'body' },
        { x: 0, y: 1.3, z: 0.36, w: 0.4, h: 0.5, d: 0.06, color: glow, emissive: glow, glow: 0.5, name: 'body' },
        { x: 0, y: 1.25, z: -0.38, w: 0.7, h: 0.6, d: 0.1, color: dark, name: 'body' },
        { x: -0.72, y: 1.62, z: 0, w: 0.46, h: 0.34, d: 0.56, color: dark },
        { x: 0.72, y: 1.62, z: 0, w: 0.46, h: 0.34, d: 0.56, color: dark },
        { x: -0.76, y: 1.02, z: 0, w: 0.36, h: 0.9, d: 0.38, color: body, name: 'armL', pivot: [-0.76, 1.46, 0] },
        { x: 0.76, y: 1.02, z: 0, w: 0.36, h: 0.9, d: 0.38, color: body, name: 'armR', pivot: [0.76, 1.46, 0] },
        { x: -0.76, y: 0.5, z: 0, w: 0.44, h: 0.32, d: 0.44, color: dark, name: 'armL', pivot: [-0.76, 1.46, 0] },
        { x: 0.76, y: 0.5, z: 0, w: 0.44, h: 0.32, d: 0.44, color: dark, name: 'armR', pivot: [0.76, 1.46, 0] },
        { x: 0, y: 1.9, z: 0.1, w: 0.44, h: 0.4, d: 0.44, color: body, name: 'head', pivot: [0, 1.7, 0] },
        { x: 0, y: 1.92, z: 0.33, w: 0.3, h: 0.1, d: 0.04, color: glow, emissive: glow, glow: 3, name: 'head', pivot: [0, 1.7, 0] }
    ]
    if (titan) {
        parts.push(
            { x: 0, y: 2.18, z: 0.1, w: 0.5, h: 0.14, d: 0.5, color: 0xd9a63c, name: 'head', pivot: [0, 1.7, 0] },
            { x: -0.2, y: 2.32, z: 0.1, w: 0.1, h: 0.2, d: 0.1, color: 0xd9a63c, name: 'head', pivot: [0, 1.7, 0] },
            { x: 0.2, y: 2.32, z: 0.1, w: 0.1, h: 0.2, d: 0.1, color: 0xd9a63c, name: 'head', pivot: [0, 1.7, 0] },
            { x: 0, y: 2.36, z: 0.1, w: 0.1, h: 0.28, d: 0.1, color: 0xd9a63c, name: 'head', pivot: [0, 1.7, 0] },
            { x: -0.4, y: 1.9, z: -0.3, w: 0.16, h: 0.5, d: 0.16, color: glow, emissive: glow, glow: 0.5, name: 'body' },
            { x: 0.4, y: 1.9, z: -0.3, w: 0.16, h: 0.5, d: 0.16, color: glow, emissive: glow, glow: 0.5, name: 'body' }
        )
    }
    return parts
}

function spitterParts(): VoxPart[] {
    const body = 0xb8a06a
    const dark = 0x5a4a2a
    const acid = 0xff4dd8
    return [
        { x: -0.18, y: 0.42, z: 0, w: 0.22, h: 0.8, d: 0.24, color: dark, name: 'legL', pivot: [-0.18, 0.82, 0] },
        { x: 0.18, y: 0.42, z: 0, w: 0.22, h: 0.8, d: 0.24, color: dark, name: 'legR', pivot: [0.18, 0.82, 0] },
        { x: 0, y: 1.15, z: 0, w: 0.6, h: 0.66, d: 0.44, color: body, name: 'body' },
        { x: 0, y: 1.1, z: -0.3, w: 0.36, h: 0.5, d: 0.2, color: acid, emissive: acid, glow: 0.35, name: 'body' },
        { x: -0.42, y: 0.92, z: 0.05, w: 0.18, h: 0.6, d: 0.2, color: body, name: 'armL', pivot: [-0.42, 1.2, 0] },
        { x: 0.42, y: 0.92, z: 0.05, w: 0.18, h: 0.6, d: 0.2, color: body, name: 'armR', pivot: [0.42, 1.2, 0] },
        { x: 0, y: 1.7, z: 0.05, w: 0.5, h: 0.44, d: 0.5, color: body, name: 'head', pivot: [0, 1.48, 0] },
        { x: 0, y: 1.64, z: 0.38, w: 0.3, h: 0.24, d: 0.3, color: dark, name: 'head', pivot: [0, 1.48, 0] },
        { x: 0, y: 1.64, z: 0.52, w: 0.18, h: 0.14, d: 0.06, color: acid, emissive: acid, glow: 1.2, name: 'head', pivot: [0, 1.48, 0] },
        { x: -0.14, y: 1.84, z: 0.26, w: 0.08, h: 0.08, d: 0.04, color: acid, emissive: acid, glow: 3, name: 'head', pivot: [0, 1.48, 0] },
        { x: 0.14, y: 1.84, z: 0.26, w: 0.08, h: 0.08, d: 0.04, color: acid, emissive: acid, glow: 3, name: 'head', pivot: [0, 1.48, 0] }
    ]
}

function droneParts(): VoxPart[] {
    const body = 0x8a8f9c
    const dark = 0x3a3f4b
    const eye = 0xffe14d
    return [
        { x: 0, y: 0.5, z: 0, w: 0.6, h: 0.3, d: 0.6, color: body, name: 'body' },
        { x: 0, y: 0.5, z: 0.32, w: 0.26, h: 0.14, d: 0.06, color: eye, emissive: eye, glow: 3, name: 'body' },
        { x: 0, y: 0.3, z: 0, w: 0.3, h: 0.14, d: 0.3, color: dark, name: 'body' },
        { x: -0.45, y: 0.62, z: -0.45, w: 0.36, h: 0.06, d: 0.36, color: dark, name: 'rotor' },
        { x: 0.45, y: 0.62, z: -0.45, w: 0.36, h: 0.06, d: 0.36, color: dark, name: 'rotor' },
        { x: -0.45, y: 0.62, z: 0.45, w: 0.36, h: 0.06, d: 0.36, color: dark, name: 'rotor' },
        { x: 0.45, y: 0.62, z: 0.45, w: 0.36, h: 0.06, d: 0.36, color: dark, name: 'rotor' },
        { x: -0.45, y: 0.5, z: -0.45, w: 0.12, h: 0.2, d: 0.12, color: body },
        { x: 0.45, y: 0.5, z: -0.45, w: 0.12, h: 0.2, d: 0.12, color: body },
        { x: -0.45, y: 0.5, z: 0.45, w: 0.12, h: 0.2, d: 0.12, color: body },
        { x: 0.45, y: 0.5, z: 0.45, w: 0.12, h: 0.2, d: 0.12, color: body },
        { x: 0, y: 0.18, z: 0, w: 0.1, h: 0.22, d: 0.1, color: eye, emissive: eye, glow: 0.5, name: 'body' }
    ]
}

function chargerParts(): VoxPart[] {
    const body = 0x8f2a2a
    const dark = 0x3a1414
    const horn = 0xe8e0c8
    const glow = 0xff6a2a
    return [
        { x: -0.28, y: 0.35, z: 0.35, w: 0.26, h: 0.7, d: 0.26, color: dark, name: 'legL', pivot: [-0.28, 0.7, 0.35] },
        { x: 0.28, y: 0.35, z: 0.35, w: 0.26, h: 0.7, d: 0.26, color: dark, name: 'legR', pivot: [0.28, 0.7, 0.35] },
        { x: -0.28, y: 0.35, z: -0.4, w: 0.26, h: 0.7, d: 0.26, color: dark, name: 'legR', pivot: [-0.28, 0.7, -0.4] },
        { x: 0.28, y: 0.35, z: -0.4, w: 0.26, h: 0.7, d: 0.26, color: dark, name: 'legL', pivot: [0.28, 0.7, -0.4] },
        { x: 0, y: 1.0, z: 0, w: 0.9, h: 0.7, d: 1.3, color: body, name: 'body' },
        { x: 0, y: 1.4, z: -0.1, w: 0.5, h: 0.14, d: 0.9, color: dark, name: 'body' },
        { x: 0, y: 1.1, z: -0.68, w: 0.3, h: 0.34, d: 0.08, color: glow, emissive: glow, glow: 0.5, name: 'body' },
        { x: 0, y: 1.1, z: 0.8, w: 0.7, h: 0.6, d: 0.5, color: body, name: 'head', pivot: [0, 1.1, 0.6] },
        { x: 0, y: 1.06, z: 1.07, w: 0.34, h: 0.1, d: 0.06, color: glow, emissive: glow, glow: 3, name: 'head', pivot: [0, 1.1, 0.6] },
        { x: -0.4, y: 1.35, z: 0.85, w: 0.14, h: 0.14, d: 0.5, color: horn, name: 'head', pivot: [0, 1.1, 0.6] },
        { x: 0.4, y: 1.35, z: 0.85, w: 0.14, h: 0.14, d: 0.5, color: horn, name: 'head', pivot: [0, 1.1, 0.6] },
        { x: -0.4, y: 1.35, z: 1.16, w: 0.12, h: 0.12, d: 0.16, color: horn, name: 'head', pivot: [0, 1.1, 0.6] },
        { x: 0.4, y: 1.35, z: 1.16, w: 0.12, h: 0.12, d: 0.16, color: horn, name: 'head', pivot: [0, 1.1, 0.6] }
    ]
}

// ── Pickups ───────────────────────────────────────────────────────────────

export type PickupKind = 'health' | 'energy' | 'ammo' | 'overdrive' | 'shield' | 'haste'

export function pickupParts(kind: PickupKind): VoxPart[] {
    const color = { health: 0x52ef9b, energy: 0x5db9ff, ammo: 0xf4b85b, shield: 0x8ad8ff, haste: 0xffdb65, overdrive: 0xff626c }[kind]
    const parts = deviceDetail(pickupCore(kind), color)
    if (kind === 'health' || kind === 'shield' || kind === 'haste') {
        parts.push(panel(0, 0, -0.17, 0.78, 0.84, 0.13, 0x172332))
        for (const side of [-1, 1]) {
            parts.push(panel(side * 0.35, 0, -0.07, 0.055, 0.75, 0.1, 0xd5e4e8))
            parts.push(panel(0, side * 0.37, -0.07, 0.66, 0.055, 0.1, 0xd5e4e8))
            parts.push(panel(side * 0.31, -0.28, -0.005, 0.06, 0.06, 0.025, color, color))
        }
    } else if (kind === 'energy' || kind === 'overdrive') {
        for (const side of [-1, 1]) {
            parts.push(panel(0, side * 0.36, 0, 0.46, 0.09, 0.46, 0xd5e4e8))
            parts.push(panel(side * 0.2, 0, -0.18, 0.055, 0.72, 0.055, 0x71899b))
            parts.push(panel(side * 0.2, 0, 0.18, 0.055, 0.72, 0.055, 0x71899b))
        }
    } else {
        parts.push(panel(0, 0.26, -0.17, 0.4, 0.035, 0.06, 0x71899b))
        for (const side of [-1, 1]) parts.push(panel(side * 0.19, 0.19, -0.17, 0.035, 0.15, 0.06, 0x71899b))
    }
    return parts
}

function pickupCore(kind: PickupKind): VoxPart[] {
    switch (kind) {
        case 'health': {
            const c = 0x3dff7a
            return [
                { x: 0, y: 0, z: 0, w: 0.22, h: 0.66, d: 0.22, color: c, emissive: c, glow: 0.7 },
                { x: 0, y: 0, z: 0, w: 0.66, h: 0.22, d: 0.22, color: c, emissive: c, glow: 0.7 },
                { x: 0, y: 0, z: 0, w: 0.34, h: 0.34, d: 0.16, color: 0xeafff0 }
            ]
        }
        case 'energy': {
            const c = 0x4da6ff
            return [
                { x: 0, y: 0, z: 0, w: 0.3, h: 0.7, d: 0.3, color: c, emissive: c, glow: 0.7 },
                { x: 0, y: 0.32, z: 0, w: 0.16, h: 0.2, d: 0.16, color: 0xd6ecff, emissive: c, glow: 0.7 },
                { x: 0, y: -0.32, z: 0, w: 0.16, h: 0.2, d: 0.16, color: 0xd6ecff, emissive: c, glow: 0.7 }
            ]
        }
        case 'ammo': {
            const c = 0xffc14d
            const brass = 0xd9a63c
            return [
                { x: 0, y: -0.08, z: 0, w: 0.7, h: 0.38, d: 0.5, color: 0x4a5a3a },
                { x: 0, y: -0.08, z: 0, w: 0.74, h: 0.1, d: 0.54, color: c, emissive: c, glow: 0.7 },
                { x: 0, y: 0.13, z: 0, w: 0.72, h: 0.06, d: 0.52, color: 0x5c6e48 },
                { x: -0.18, y: 0.27, z: 0.02, w: 0.1, h: 0.22, d: 0.1, color: brass },
                { x: 0, y: 0.29, z: -0.08, w: 0.1, h: 0.26, d: 0.1, color: brass },
                { x: 0.18, y: 0.26, z: 0.08, w: 0.1, h: 0.2, d: 0.1, color: brass }
            ]
        }
        case 'shield': {
            const c = 0x8ad8ff
            return [
                { x: 0, y: 0, z: 0, w: 0.6, h: 0.7, d: 0.2, color: c, emissive: c, glow: 0.7 },
                { x: 0, y: -0.1, z: 0, w: 0.4, h: 0.5, d: 0.26, color: 0x1e2a3a },
                { x: 0, y: 0.05, z: 0.14, w: 0.14, h: 0.3, d: 0.04, color: 0xffffff, emissive: c, glow: 0.7 }
            ]
        }
        case 'haste': {
            const c = 0xffe14d
            return [
                { x: 0, y: 0.1, z: 0, w: 0.5, h: 0.24, d: 0.16, color: c, emissive: c, glow: 0.7 },
                { x: -0.1, y: -0.12, z: 0, w: 0.5, h: 0.24, d: 0.16, color: c, emissive: c, glow: 0.7 },
                { x: 0.1, y: 0.32, z: 0, w: 0.5, h: 0.24, d: 0.16, color: c, emissive: c, glow: 0.7 },
                { x: 0, y: 0.1, z: 0, w: 0.2, h: 0.7, d: 0.1, color: 0xfff6c8 }
            ]
        }
        case 'overdrive': {
            const c = 0xff3a3a
            return [
                { x: 0, y: 0, z: 0, w: 0.5, h: 0.5, d: 0.5, color: c, emissive: c, glow: 0.7 },
                { x: 0, y: 0, z: 0, w: 0.8, h: 0.16, d: 0.16, color: 0xffe14d, emissive: 0xffe14d, glow: 0.7 },
                { x: 0, y: 0, z: 0, w: 0.16, h: 0.8, d: 0.16, color: 0xffe14d, emissive: 0xffe14d, glow: 0.7 },
                { x: 0, y: 0, z: 0, w: 0.16, h: 0.16, d: 0.8, color: 0xffe14d, emissive: 0xffe14d, glow: 0.7 }
            ]
        }
    }
}

export function portalParts(): VoxPart[] {
    const parts: VoxPart[] = []
    const color = 0xb58aff
    // Segmented accelerator gate: dark outer structure, illuminated inner teeth,
    // rear reinforcement and paired power cabinets. The aperture stays clear.
    for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2
        const x = Math.cos(a)
        const y = Math.sin(a)
        parts.push(panel(x * 1.62, 1.7 + y * 1.62, 0, 0.38, 0.38, 0.48, 0x172332))
        parts.push(panel(x * 1.68, 1.7 + y * 1.68, -0.27, 0.28, 0.28, 0.08, 0x71899b))
        parts.push({ ...panel(x * 1.44, 1.7 + y * 1.44, 0.21, 0.18, 0.18, 0.06, color, color), name: 'ring', pivot: [0, 1.7, 0] })
        if (i % 3 === 0) parts.push(panel(x * 1.77, 1.7 + y * 1.77, 0.26, 0.15, 0.15, 0.08, 0xd5e4e8))
    }
    for (const side of [-1, 1]) {
        parts.push(panel(side * 1.58, 0.32, 0, 0.62, 0.64, 0.86, 0x34495a))
        parts.push(panel(side * 1.58, 0.68, 0, 0.68, 0.08, 0.92, 0x71899b))
        for (let i = 0; i < 3; i++) parts.push(panel(side * 1.58, 0.2 + i * 0.13, 0.44, 0.36, 0.045, 0.025, color, color))
    }
    parts.push(panel(0, 0.1, 0, 3.8, 0.2, 1.1, 0x172332))
    parts.push(panel(0, 0.21, 0.45, 2.2, 0.025, 0.07, color, color))
    return parts
}

export function orbitBladeParts(): VoxPart[] {
    return bladeDetail(orbitBladeCore(), 'katana')
}

function orbitBladeCore(): VoxPart[] {
    return [
        { x: 0, y: 0, z: 0, w: 0.16, h: 0.16, d: 0.16, color: 0xd9a63c },
        { x: 0, y: 0, z: 0.35, w: 0.08, h: 0.24, d: 0.6, color: 0xd6f7ff, emissive: 0x3ff0ff, glow: 0.7 },
        { x: 0, y: 0, z: -0.35, w: 0.08, h: 0.24, d: 0.6, color: 0xd6f7ff, emissive: 0x3ff0ff, glow: 0.7 }
    ]
}
