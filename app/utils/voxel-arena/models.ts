// Voxel Arena — voxel model builders. Every model is a list of axis-aligned
// boxes (center + size + colour) assembled into a THREE.Group. Named parts get
// a pivot group so limbs can swing from the hip or shoulder.

import * as THREE from 'three'
import type { EnemyId, WeaponId } from './types'

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
    /** Pivot point for animated parts (defaults to the part centre). */
    pivot?: [number, number, number]
}

export interface VoxModel {
    group: THREE.Group
    parts: Map<string, THREE.Object3D>
    meshes: THREE.Mesh[]
}

export const BOX = new THREE.BoxGeometry(1, 1, 1)

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

export const FLASH_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.5, roughness: 1 })

export function buildModel(parts: VoxPart[], scale = 1): VoxModel {
    const group = new THREE.Group()
    const named = new Map<string, THREE.Object3D>()
    const meshes: THREE.Mesh[] = []
    for (const p of parts) {
        const mesh = new THREE.Mesh(BOX, voxMaterial(p.color, p.emissive ?? 0, p.glow ?? 1))
        mesh.scale.set(p.w, p.h, p.d)
        mesh.castShadow = true
        mesh.receiveShadow = false
        mesh.userData.part = p
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

// ── Weapons (held in the right hand, barrel along +Z) ─────────────────────

export function weaponParts(id: WeaponId): VoxPart[] {
    const gun = 0x3a3f4b
    const gunLight = 0x596170
    switch (id) {
        case 'pulse':
            return [
                { x: 0, y: 0, z: 0.1, w: 0.14, h: 0.2, d: 0.7, color: gun },
                { x: 0, y: 0.04, z: 0.62, w: 0.08, h: 0.08, d: 0.5, color: gunLight },
                { x: 0, y: 0.05, z: 0.3, w: 0.16, h: 0.06, d: 0.3, color: 0x4df2ff, emissive: 0x4df2ff, glow: 2 },
                { x: 0, y: -0.16, z: -0.02, w: 0.1, h: 0.18, d: 0.12, color: gunLight },
                { x: 0, y: 0.0, z: -0.34, w: 0.12, h: 0.14, d: 0.2, color: gunLight },
                { x: 0, y: 0.14, z: 0.05, w: 0.06, h: 0.08, d: 0.16, color: gunLight }
            ]
        case 'scatter':
            return [
                { x: 0, y: 0, z: 0.05, w: 0.2, h: 0.22, d: 0.6, color: gun },
                { x: 0.06, y: 0.06, z: 0.58, w: 0.1, h: 0.1, d: 0.5, color: gunLight },
                { x: -0.06, y: 0.06, z: 0.58, w: 0.1, h: 0.1, d: 0.5, color: gunLight },
                { x: 0, y: -0.02, z: 0.7, w: 0.24, h: 0.12, d: 0.12, color: 0xffa23a, emissive: 0xffa23a, glow: 1.6 },
                { x: 0, y: -0.16, z: -0.02, w: 0.1, h: 0.18, d: 0.12, color: gunLight },
                { x: 0, y: -0.02, z: -0.36, w: 0.14, h: 0.16, d: 0.22, color: 0x6b4a2a }
            ]
        case 'needler':
            return [
                { x: 0, y: 0, z: 0.05, w: 0.16, h: 0.16, d: 0.5, color: 0x5a2a60 },
                { x: 0, y: 0.02, z: 0.45, w: 0.06, h: 0.06, d: 0.4, color: gunLight },
                { x: 0.05, y: 0.08, z: 0.2, w: 0.04, h: 0.16, d: 0.2, color: 0xff4dd8, emissive: 0xff4dd8, glow: 2 },
                { x: -0.05, y: 0.08, z: 0.2, w: 0.04, h: 0.16, d: 0.2, color: 0xff4dd8, emissive: 0xff4dd8, glow: 2 },
                { x: 0, y: -0.16, z: -0.02, w: 0.1, h: 0.18, d: 0.12, color: gunLight },
                { x: 0, y: -0.14, z: 0.2, w: 0.12, h: 0.24, d: 0.1, color: 0x5a2a60 }
            ]
        case 'rail':
            return [
                { x: 0, y: 0, z: 0.1, w: 0.14, h: 0.24, d: 0.9, color: 0x1e2a3a },
                { x: 0, y: 0.02, z: 0.75, w: 0.1, h: 0.1, d: 0.7, color: gunLight },
                { x: 0, y: 0.16, z: 0.2, w: 0.06, h: 0.06, d: 0.9, color: 0xd8f4ff, emissive: 0xd8f4ff, glow: 2.4 },
                { x: 0, y: -0.14, z: 0.2, w: 0.06, h: 0.06, d: 0.9, color: 0xd8f4ff, emissive: 0xd8f4ff, glow: 2.4 },
                { x: 0, y: -0.18, z: -0.02, w: 0.1, h: 0.18, d: 0.12, color: gunLight },
                { x: 0, y: 0, z: -0.42, w: 0.14, h: 0.2, d: 0.22, color: gun }
            ]
        case 'plasma':
            return [
                { x: 0, y: 0, z: 0.0, w: 0.26, h: 0.26, d: 0.6, color: 0x2f4a30 },
                { x: 0, y: 0.02, z: 0.5, w: 0.3, h: 0.3, d: 0.4, color: 0x415f42 },
                { x: 0, y: 0.02, z: 0.72, w: 0.2, h: 0.2, d: 0.08, color: 0x7dff5a, emissive: 0x7dff5a, glow: 2.2 },
                { x: 0, y: 0.16, z: 0.1, w: 0.1, h: 0.08, d: 0.3, color: 0x7dff5a, emissive: 0x7dff5a, glow: 1.4 },
                { x: 0, y: -0.2, z: -0.02, w: 0.1, h: 0.18, d: 0.12, color: gunLight },
                { x: 0, y: 0, z: -0.4, w: 0.16, h: 0.18, d: 0.2, color: gun }
            ]
        case 'arc':
            return [
                { x: 0, y: 0, z: 0.05, w: 0.16, h: 0.2, d: 0.6, color: 0x2a1f40 },
                { x: 0.1, y: 0.04, z: 0.5, w: 0.06, h: 0.06, d: 0.44, color: 0xb56bff, emissive: 0xb56bff, glow: 2 },
                { x: -0.1, y: 0.04, z: 0.5, w: 0.06, h: 0.06, d: 0.44, color: 0xb56bff, emissive: 0xb56bff, glow: 2 },
                { x: 0, y: 0.14, z: 0.25, w: 0.1, h: 0.12, d: 0.14, color: 0xb56bff, emissive: 0xb56bff, glow: 3 },
                { x: 0, y: -0.16, z: -0.02, w: 0.1, h: 0.18, d: 0.12, color: gunLight },
                { x: 0, y: 0, z: -0.36, w: 0.14, h: 0.16, d: 0.2, color: gun }
            ]
        case 'shredder':
            return [
                { x: 0, y: 0, z: 0.05, w: 0.2, h: 0.22, d: 0.6, color: 0x4a3a1a },
                { x: 0, y: 0.06, z: 0.5, w: 0.34, h: 0.06, d: 0.34, color: 0xffe14d, emissive: 0xffe14d, glow: 1.6 },
                { x: 0, y: -0.02, z: 0.5, w: 0.1, h: 0.1, d: 0.34, color: gunLight },
                { x: 0, y: -0.16, z: -0.02, w: 0.1, h: 0.18, d: 0.12, color: gunLight },
                { x: 0, y: 0, z: -0.36, w: 0.14, h: 0.16, d: 0.2, color: gun }
            ]
    }
}

export function kataneParts(): VoxPart[] {
    return [
        { x: 0, y: 0, z: -0.1, w: 0.08, h: 0.08, d: 0.3, color: 0x2b2f3a },
        { x: 0, y: 0, z: 0.08, w: 0.2, h: 0.2, d: 0.05, color: GOLD },
        { x: 0, y: 0.02, z: 0.72, w: 0.05, h: 0.16, d: 1.2, color: 0xd6f7ff, emissive: 0x3ff0ff, glow: 1.8 }
    ]
}

// ── Enemies ───────────────────────────────────────────────────────────────

export function enemyParts(id: EnemyId): VoxPart[] {
    switch (id) {
        case 'grunt': return gruntParts()
        case 'runner': return runnerParts()
        case 'brute': return bruteParts(false)
        case 'titan': return bruteParts(true)
        case 'spitter': return spitterParts()
        case 'drone': return droneParts()
        case 'charger': return chargerParts()
        case 'warden': return wardenParts()
    }
}

function wardenParts(): VoxPart[] {
    const body = 0x4a5566
    const dark = 0x262c38
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
        { x: -0.3, y: 1.05, z: 0.63, w: 0.16, h: 1.1, d: 0.03, color: glow, emissive: glow, glow: 2, name: 'shield' },
        { x: -0.3, y: 1.05, z: 0.63, w: 0.7, h: 0.14, d: 0.03, color: glow, emissive: glow, glow: 2, name: 'shield' },
        { x: 0, y: 1.72, z: 0, w: 0.44, h: 0.4, d: 0.44, color: body, name: 'head', pivot: [0, 1.52, 0] },
        { x: 0, y: 1.74, z: 0.23, w: 0.32, h: 0.08, d: 0.04, color: glow, emissive: glow, glow: 3, name: 'head', pivot: [0, 1.52, 0] },
        { x: 0, y: 1.98, z: 0, w: 0.5, h: 0.1, d: 0.5, color: dark, name: 'head', pivot: [0, 1.52, 0] }
    ]
}

export function meteorParts(): VoxPart[] {
    const rock = 0x3a3040
    const crack = 0xff7a2a
    return [
        { x: 0, y: 0, z: 0, w: 1.4, h: 1.2, d: 1.3, color: rock },
        { x: 0.5, y: 0.3, z: -0.3, w: 0.8, h: 0.8, d: 0.8, color: 0x2c2434 },
        { x: -0.5, y: -0.2, z: 0.4, w: 0.7, h: 0.7, d: 0.7, color: 0x46394f },
        { x: 0, y: 0.1, z: 0.66, w: 0.5, h: 0.14, d: 0.06, color: crack, emissive: crack, glow: 2.4 },
        { x: 0.7, y: -0.1, z: 0, w: 0.06, h: 0.6, d: 0.16, color: crack, emissive: crack, glow: 2.4 },
        { x: -0.2, y: 0.62, z: 0, w: 0.16, h: 0.06, d: 0.5, color: crack, emissive: crack, glow: 2.4 }
    ]
}

export function boulderParts(): VoxPart[] {
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
    return [
        { x: 0, y: 1.6, z: 0, w: 0.3, h: 3.2, d: 0.3, color: 0x2b2540 },
        { x: 0, y: 3.4, z: 0, w: 0.7, h: 0.5, d: 0.7, color: 0x3a3350 },
        { x: 0, y: 3.4, z: 0, w: 0.5, h: 0.4, d: 0.5, color, emissive: color, glow: 2.2 },
        { x: 0, y: 3.75, z: 0, w: 0.8, h: 0.12, d: 0.8, color: 0x2b2540 }
    ]
}

function gruntParts(): VoxPart[] {
    const body = 0x3d4657
    const dark = 0x232833
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
    const body = titan ? 0x4a3d6b : 0x5c6b3a
    const dark = titan ? 0x261e3a : 0x2f3820
    const glow = titan ? 0xff6a2a : 0xffb347
    const parts: VoxPart[] = [
        { x: -0.28, y: 0.4, z: 0, w: 0.4, h: 0.76, d: 0.42, color: dark, name: 'legL', pivot: [-0.28, 0.78, 0] },
        { x: 0.28, y: 0.4, z: 0, w: 0.4, h: 0.76, d: 0.42, color: dark, name: 'legR', pivot: [0.28, 0.78, 0] },
        { x: 0, y: 1.25, z: 0, w: 1.1, h: 0.9, d: 0.7, color: body, name: 'body' },
        { x: 0, y: 1.3, z: 0.36, w: 0.4, h: 0.5, d: 0.06, color: glow, emissive: glow, glow: 2, name: 'body' },
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
            { x: -0.4, y: 1.9, z: -0.3, w: 0.16, h: 0.5, d: 0.16, color: glow, emissive: glow, glow: 1.5, name: 'body' },
            { x: 0.4, y: 1.9, z: -0.3, w: 0.16, h: 0.5, d: 0.16, color: glow, emissive: glow, glow: 1.5, name: 'body' }
        )
    }
    return parts
}

function spitterParts(): VoxPart[] {
    const body = 0x6a3d8f
    const dark = 0x3a1f52
    const acid = 0x7dff5a
    return [
        { x: -0.18, y: 0.42, z: 0, w: 0.22, h: 0.8, d: 0.24, color: dark, name: 'legL', pivot: [-0.18, 0.82, 0] },
        { x: 0.18, y: 0.42, z: 0, w: 0.22, h: 0.8, d: 0.24, color: dark, name: 'legR', pivot: [0.18, 0.82, 0] },
        { x: 0, y: 1.15, z: 0, w: 0.6, h: 0.66, d: 0.44, color: body, name: 'body' },
        { x: 0, y: 1.1, z: -0.3, w: 0.36, h: 0.5, d: 0.2, color: acid, emissive: acid, glow: 1.2, name: 'body' },
        { x: -0.42, y: 0.92, z: 0.05, w: 0.18, h: 0.6, d: 0.2, color: body, name: 'armL', pivot: [-0.42, 1.2, 0] },
        { x: 0.42, y: 0.92, z: 0.05, w: 0.18, h: 0.6, d: 0.2, color: body, name: 'armR', pivot: [0.42, 1.2, 0] },
        { x: 0, y: 1.7, z: 0.05, w: 0.5, h: 0.44, d: 0.5, color: body, name: 'head', pivot: [0, 1.48, 0] },
        { x: 0, y: 1.64, z: 0.38, w: 0.3, h: 0.24, d: 0.3, color: dark, name: 'head', pivot: [0, 1.48, 0] },
        { x: 0, y: 1.64, z: 0.52, w: 0.18, h: 0.14, d: 0.06, color: acid, emissive: acid, glow: 3, name: 'head', pivot: [0, 1.48, 0] },
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
        { x: 0, y: 0.18, z: 0, w: 0.1, h: 0.22, d: 0.1, color: eye, emissive: eye, glow: 1.6, name: 'body' }
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
        { x: 0, y: 1.1, z: -0.68, w: 0.3, h: 0.34, d: 0.08, color: glow, emissive: glow, glow: 2, name: 'body' },
        { x: 0, y: 1.1, z: 0.8, w: 0.7, h: 0.6, d: 0.5, color: body, name: 'head', pivot: [0, 1.1, 0.6] },
        { x: 0, y: 1.06, z: 1.07, w: 0.34, h: 0.1, d: 0.06, color: glow, emissive: glow, glow: 3, name: 'head', pivot: [0, 1.1, 0.6] },
        { x: -0.4, y: 1.35, z: 0.85, w: 0.14, h: 0.14, d: 0.5, color: horn, name: 'head', pivot: [0, 1.1, 0.6] },
        { x: 0.4, y: 1.35, z: 0.85, w: 0.14, h: 0.14, d: 0.5, color: horn, name: 'head', pivot: [0, 1.1, 0.6] },
        { x: -0.4, y: 1.35, z: 1.16, w: 0.12, h: 0.12, d: 0.16, color: horn, name: 'head', pivot: [0, 1.1, 0.6] },
        { x: 0.4, y: 1.35, z: 1.16, w: 0.12, h: 0.12, d: 0.16, color: horn, name: 'head', pivot: [0, 1.1, 0.6] }
    ]
}

// ── Pickups ───────────────────────────────────────────────────────────────

export type PickupKind = 'health' | 'energy' | 'weapon' | 'overdrive'

export function pickupParts(kind: PickupKind): VoxPart[] {
    switch (kind) {
        case 'health': {
            const c = 0x3dff7a
            return [
                { x: 0, y: 0, z: 0, w: 0.22, h: 0.66, d: 0.22, color: c, emissive: c, glow: 1.6 },
                { x: 0, y: 0, z: 0, w: 0.66, h: 0.22, d: 0.22, color: c, emissive: c, glow: 1.6 },
                { x: 0, y: 0, z: 0, w: 0.34, h: 0.34, d: 0.16, color: 0xeafff0 }
            ]
        }
        case 'energy': {
            const c = 0x4da6ff
            return [
                { x: 0, y: 0, z: 0, w: 0.3, h: 0.7, d: 0.3, color: c, emissive: c, glow: 1.8 },
                { x: 0, y: 0.32, z: 0, w: 0.16, h: 0.2, d: 0.16, color: 0xd6ecff, emissive: c, glow: 2.2 },
                { x: 0, y: -0.32, z: 0, w: 0.16, h: 0.2, d: 0.16, color: 0xd6ecff, emissive: c, glow: 2.2 }
            ]
        }
        case 'weapon': {
            const c = 0xffa23a
            return [
                { x: 0, y: 0, z: 0, w: 0.7, h: 0.5, d: 0.5, color: 0x4a4f5b },
                { x: 0, y: 0, z: 0, w: 0.74, h: 0.12, d: 0.54, color: c, emissive: c, glow: 1.6 },
                { x: 0, y: 0, z: 0, w: 0.16, h: 0.54, d: 0.54, color: c, emissive: c, glow: 1.6 },
                { x: 0, y: 0.3, z: 0, w: 0.2, h: 0.1, d: 0.2, color: 0x8a8f9c }
            ]
        }
        case 'overdrive': {
            const c = 0xff3a3a
            return [
                { x: 0, y: 0, z: 0, w: 0.5, h: 0.5, d: 0.5, color: c, emissive: c, glow: 2 },
                { x: 0, y: 0, z: 0, w: 0.8, h: 0.16, d: 0.16, color: 0xffe14d, emissive: 0xffe14d, glow: 2 },
                { x: 0, y: 0, z: 0, w: 0.16, h: 0.8, d: 0.16, color: 0xffe14d, emissive: 0xffe14d, glow: 2 },
                { x: 0, y: 0, z: 0, w: 0.16, h: 0.16, d: 0.8, color: 0xffe14d, emissive: 0xffe14d, glow: 2 }
            ]
        }
    }
}

export function portalParts(): VoxPart[] {
    const c = 0xb56bff
    const parts: VoxPart[] = []
    const n = 10
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        parts.push({ x: Math.cos(a) * 1.5, y: 1.6 + Math.sin(a) * 1.5, z: 0, w: 0.4, h: 0.4, d: 0.3, color: c, emissive: c, glow: 1.8, name: 'ring' })
    }
    parts.push(
        { x: -1.2, y: 0.25, z: 0, w: 0.8, h: 0.5, d: 0.8, color: 0x3a2a52 },
        { x: 1.2, y: 0.25, z: 0, w: 0.8, h: 0.5, d: 0.8, color: 0x3a2a52 },
        { x: 0, y: 0.15, z: 0, w: 3.2, h: 0.3, d: 1, color: 0x2a1f3a }
    )
    return parts
}

export function orbitBladeParts(): VoxPart[] {
    return [
        { x: 0, y: 0, z: 0, w: 0.16, h: 0.16, d: 0.16, color: 0xd9a63c },
        { x: 0, y: 0, z: 0.35, w: 0.08, h: 0.24, d: 0.6, color: 0xd6f7ff, emissive: 0x3ff0ff, glow: 2 },
        { x: 0, y: 0, z: -0.35, w: 0.08, h: 0.24, d: 0.6, color: 0xd6f7ff, emissive: 0x3ff0ff, glow: 2 }
    ]
}
