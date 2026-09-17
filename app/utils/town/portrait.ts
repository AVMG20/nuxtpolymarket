import * as THREE from 'three'
import { createBuildingModel } from './models'
import { townVisualLevel } from './appearance'
import type { TownBuildingId } from '#shared/utils/gamelogic/town'

// Portraits for buildings the asset pass has not drawn yet.
//
// Every other building has a hand-made PNG under public/town/buildings. A
// building without one used to fall back to an emoji, which reads as a
// different kind of thing entirely next to twenty rendered buildings. Instead
// we render its own 3D model once, off screen, and cache the image — so a new
// building looks like itself the moment its model exists, and swapping in real
// artwork later needs no code change.

const SIZE = 128
const cache = new Map<string, string>()

let renderer: THREE.WebGLRenderer | null = null

/** One small renderer shared by every portrait, made on first use. */
function sharedRenderer(): THREE.WebGLRenderer | null {
    if (renderer) return renderer
    try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
        renderer.setSize(SIZE, SIZE, false)
        renderer.setPixelRatio(1)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        return renderer
    } catch {
        // No WebGL (a locked-down browser, a headless render): callers fall
        // back to whatever they showed before.
        return null
    }
}

/**
 * A data URL of `type` at `level`, drawn from the same model the map uses.
 * Returns null when the browser cannot give us a context.
 */
export function townRenderedPortrait(type: TownBuildingId, level = 1): string | null {
    const visual = townVisualLevel(level)
    const key = `${type}:${visual}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit

    const gl = sharedRenderer()
    if (!gl) return null

    const scene = new THREE.Scene()
    const model = createBuildingModel(type, visual)
    scene.add(model)

    // Light it the way the town is lit, so a portrait and the building on the
    // map do not look like two different colour schemes.
    scene.add(new THREE.AmbientLight(0xffffff, 1.5))
    const key1 = new THREE.DirectionalLight(0xffffff, 2.2)
    key1.position.set(2, 3, 2)
    scene.add(key1)
    const fill = new THREE.DirectionalLight(0xbfd8ff, 0.7)
    fill.position.set(-2, 1.5, -1)
    scene.add(fill)

    // Frame whatever the model turns out to be, rather than assuming a size.
    const bounds = new THREE.Box3().setFromObject(model)
    const centre = bounds.getCenter(new THREE.Vector3())
    const radius = Math.max(0.35, bounds.getBoundingSphere(new THREE.Sphere()).radius)
    const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.1, 100)
    camera.position.set(centre.x + radius * 1.6, centre.y + radius * 1.5, centre.z + radius * 1.6)
    camera.lookAt(centre)

    gl.render(scene, camera)
    const url = gl.domElement.toDataURL('image/png')

    scene.remove(model)
    cache.set(key, url)
    return url
}
