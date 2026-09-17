// Hand-written types for the vendored foil.js renderer (which stays
// byte-identical to upstream apart from its three import). Only the surface
// TcgCard.client.vue uses is typed.
import type * as THREE from 'three'

export declare const ASPECT: number
export declare const CROP: number

export interface FoilUniforms {
    [name: string]: { value: unknown }
    uPointer: { value: THREE.Vector2 }
    uLocal: { value: THREE.Vector2 }
    uTime: { value: number }
}

export interface ArtWindow {
    x0: number
    y0: number
    x1: number
    y1: number
}

export interface ResolvedCard {
    preset: Record<string, unknown>
    patternName: string
    noPattern: boolean
    mode: number
    uniforms: FoilUniforms
    useEtch: boolean
    face: string
    maskName: string
    etchName: string
    /** Present on cards resolved via resolveLegacy — loadCard branches on it. */
    legacy?: { set: string, num: string, holo: boolean, win: ArtWindow }
}

export declare function resolve(opts: {
    card: string
    num: string
    mask: string
    effect?: string
    alt?: boolean
    face?: string
    pattern?: string
    etch?: boolean
}): ResolvedCard

export declare const ART_WINDOW: ArtWindow

export declare function resolveLegacy(opts: {
    set: string
    num: string
    effect?: string
    holo?: boolean
    win?: ArtWindow
}): ResolvedCard

export declare function makeLoader(renderer: THREE.WebGLRenderer): (url: string, crisp?: boolean) => Promise<THREE.Texture>

export declare function makeMaterial(uniforms: FoilUniforms): THREE.ShaderMaterial

export declare function loadCard(
    load: (url: string, crisp?: boolean) => Promise<THREE.Texture>,
    r: ResolvedCard,
    base?: string
): Promise<ResolvedCard>
