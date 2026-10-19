import * as THREE from 'three'
import type { Vec3 } from '#shared/utils/dead-front/types'

// Small helpers shared by the world view modules: deterministic RNG for prop
// placement (so every client sees the same village), easing curves, damped
// springs and disposal tracking.

/** Deterministic PRNG (mulberry32). Cosmetic layout only. */
export function dfRng(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export function clamp01(x: number): number {
    return x < 0 ? 0 : x > 1 ? 1 : x
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}

export function smoothstep(a: number, b: number, x: number): number {
    const t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)
}

export function easeOutCubic(t: number): number {
    const u = 1 - clamp01(t)
    return 1 - u * u * u
}

export function easeInCubic(t: number): number {
    const u = clamp01(t)
    return u * u * u
}

export function easeInOutCubic(t: number): number {
    const u = clamp01(t)
    return u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2
}

/** Overshoots then settles (doors swinging, boards slamming). */
export function easeOutBack(t: number, s = 1.70158): number {
    const u = clamp01(t) - 1
    return 1 + (s + 1) * u * u * u + s * u * u
}

export function easeOutElastic(t: number): number {
    const u = clamp01(t)
    if (u === 0 || u === 1) return u
    return 2 ** (-10 * u) * Math.sin((u * 10 - 0.75) * (2 * Math.PI) / 3) + 1
}

/** Frame-rate independent exponential approach. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
    return lerp(current, target, 1 - Math.exp(-lambda * dt))
}

/** Critically-damped-ish spring on one value. */
export class DfSpring {
    x = 0
    v = 0
    constructor(public k = 120, public c = 14) {}
    update(dt: number, target = 0): number {
        const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
        const h = dt / steps
        for (let i = 0; i < steps; i++) {
            const a = -this.k * (this.x - target) - this.c * this.v
            this.v += a * h
            this.x += this.v * h
        }
        return this.x
    }

    kick(v: number): void {
        this.v += v
    }
}

/** Smooth 1D flicker in roughly 0.6..1.1 (lanterns, candles). */
export function dfFlicker(t: number, seed: number): number {
    const a = Math.sin(t * 7.3 + seed * 13.1) * 0.5 + Math.sin(t * 13.7 + seed * 5.3) * 0.3 + Math.sin(t * 23.1 + seed * 2.7) * 0.2
    const b = Math.sin(t * 1.3 + seed) * 0.5 + 0.5
    return 0.86 + a * 0.12 * (0.6 + b * 0.4)
}

export function toV3(p: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(p.x, p.y, p.z)
}

/** Collects GPU resources so a module can free them all in dispose(). */
export class DfTrash {
    private items: { dispose(): void }[] = []
    add<T extends { dispose(): void }>(item: T): T {
        this.items.push(item)
        return item
    }

    dispose(): void {
        for (const i of this.items) i.dispose()
        this.items.length = 0
    }
}

/** Removes an object from its parent and disposes the geometries it owns (materials are shared and tracked elsewhere). */
export function dfDropObject(obj: THREE.Object3D, disposeGeometry = true): void {
    obj.removeFromParent()
    if (!disposeGeometry) return
    obj.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) m.geometry?.dispose()
    })
}

/** Sets shadow flags on every mesh below `obj`. */
export function dfShadows(obj: THREE.Object3D, cast: boolean, receive: boolean): THREE.Object3D {
    obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
            o.castShadow = cast
            o.receiveShadow = receive
        }
    })
    return obj
}

/** Soft round sprite texture (glows, mist, beams). */
export function dfRadialTexture(size = 64, inner = 0, falloff = 2): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')!
    const img = g.createImageData(size, size)
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (x + 0.5) / size * 2 - 1
            const dy = (y + 0.5) / size * 2 - 1
            const r = Math.sqrt(dx * dx + dy * dy)
            const t = clamp01((r - inner) / (1 - inner))
            const a = (1 - t) ** falloff
            const i = (y * size + x) * 4
            img.data[i] = 255
            img.data[i + 1] = 255
            img.data[i + 2] = 255
            img.data[i + 3] = Math.round(a * 255)
        }
    }
    g.putImageData(img, 0, 0)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
}

/**
 * Power level 0..1 of something the surge reached `age` seconds ago (negative:
 * not yet): it stutters on with a few hard flickers, then holds with a faint hum.
 */
export function dfPowerLevel(age: number, time: number, seed: number): number {
    if (age < 0) return 0
    if (age < 0.85) {
        // Two or three hard cuts while the filament catches.
        const on = Math.sin(time * 41 + seed * 7.1) > -0.15 && Math.sin(time * 17 + seed * 3.3) > -0.6
        return (on ? 1 : 0.08) * (0.55 + 0.45 * clamp01(age / 0.5))
    }
    return 0.97 + 0.03 * Math.sin(time * 50 + seed)
}

/** Shows one model at a time under `holder`. */
export function dfShowModel(holder: THREE.Object3D, model: THREE.Object3D | null): void {
    for (const c of [...holder.children]) if (c !== model) holder.remove(c)
    if (model && model.parent !== holder) holder.add(model)
}
