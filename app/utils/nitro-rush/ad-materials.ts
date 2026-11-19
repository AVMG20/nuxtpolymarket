import * as THREE from 'three'
import { TRACK_ADS } from './ads'
import { billboardTexture, flagTexture, posterTexture, stripTexture } from './signs'
import type { WorldKit } from './world-kit'

/** The ads' materials, shared by the signage round the road and the ads on the fields. */

export type AdFormat = 'board' | 'strip' | 'flag' | 'poster'
export type AdMaterial = (format: AdFormat, ad: number) => THREE.MeshStandardMaterial

const PAINTERS = { board: billboardTexture, strip: stripTexture, flag: flagTexture, poster: posterTexture } as const

/** A backlit print, so an ad still reads at night. */
export const glowing = (map: THREE.Texture, intensity: number) => new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: intensity, roughness: 0.5 })

/** Ad materials painted on first use, so a course pays only for the ads it shows. */
export function adMaterials(own: WorldKit['own']): AdMaterial {
    const cache = new Map<string, THREE.MeshStandardMaterial>()
    return (format, ad) => {
        const key = `${format}:${ad}`
        let m = cache.get(key)
        if (!m) {
            const t = own(PAINTERS[format](TRACK_ADS[ad]!))
            if (format === 'strip') t.wrapS = THREE.RepeatWrapping
            // Strips pass right by the camera, where a full glow blooms out.
            cache.set(key, m = own(glowing(t, format === 'strip' ? 1.1 : 1.5)))
        }
        return m
    }
}
