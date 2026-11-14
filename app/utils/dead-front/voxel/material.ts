import * as THREE from 'three'

// The one material family every solid mesh uses: toon-lit Lambert with vertex
// colours (palette colour x baked AO) plus a per-vertex `aGlow` that turns
// palette voxels emissive. `uGlow` scales the glow per material (pulsing PaP camo,
// power-on surges) without a new shader program.

export interface DfVoxMaterialOpts {
    /** Glow multiplier for emissive voxels (default 1). */
    glow?: number
    side?: THREE.Side
    transparent?: boolean
    opacity?: number
    fog?: boolean
    /** Extra flat emissive added to every voxel (hit flashes). */
    emissive?: THREE.ColorRepresentation
}

export type DfVoxMaterial = THREE.MeshLambertMaterial & { userData: { uGlow: { value: number } } }

const VERT_HEAD = '#include <common>\nattribute float aGlow;\nvarying float vGlow;'
const FRAG_HEAD = '#include <common>\nuniform float uGlow;\nvarying float vGlow;'

// Toon lighting. Each light's energy (N.L x colour x attenuation x shadow) is
// quantised into hard bands with a narrow soft step, so the moon gives two flat
// tones, PCF shadow edges turn crisp and lamp pools fall off in rings. The sky
// fill is banded too (up / side / down faces) and stays blue-violet, which is
// what tints the shadows. A rim light picks out curved silhouettes only: flat
// faces have no normal derivative, so floors at grazing angles don't light up.
const TOON_LIGHTS = /* glsl */`
varying vec3 vViewPosition;
struct LambertMaterial {
    vec3 diffuseColor;
    float specularStrength;
};
vec3 dfToonLit = vec3(0.0);
vec3 dfToonAmb = vec3(0.0);
float dfToonStep(float t, float e, float fw) {
    float w = clamp(fw, t * 0.03, t * 0.3);
    return smoothstep(t - w, t + w, e);
}
float dfToonBand(float e) {
    float fw = fwidth(e) * 0.75;
    return 0.3 * dfToonStep(0.085, e, fw)
        + 0.5 * dfToonStep(0.4, e, fw)
        + 0.6 * dfToonStep(1.5, e, fw)
        + 0.7 * dfToonStep(3.6, e, fw);
}
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
    float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
    float mag = max( max( directLight.color.r, directLight.color.g ), max( directLight.color.b, 1e-5 ) );
    vec3 lit = ( directLight.color / mag ) * dfToonBand( dotNL * mag );
    dfToonLit += lit;
    reflectedLight.directDiffuse += lit * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
    dfToonAmb += irradiance;
    reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert
`

const TOON_HEMI = /* glsl */`float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		{
			float dfHw = clamp( fwidth( hemiDiffuseWeight ), 0.01, 0.1 );
			hemiDiffuseWeight = 0.16 + 0.42 * smoothstep( 0.3 - dfHw, 0.3 + dfHw, hemiDiffuseWeight ) + 0.42 * smoothstep( 0.72 - dfHw, 0.72 + dfHw, hemiDiffuseWeight );
		}`

const TOON_RIM = /* glsl */`#include <lights_fragment_end>
{
    vec3 dfV = normalize( vViewPosition );
    float dfRim = 1.0 - saturate( dot( normal, dfV ) );
    // curvature per metre: zero on flat faces, so only rounded shapes get a rim
    float dfCurv = length( fwidth( normal ) ) / max( length( fwidth( vViewPosition ) ), 1e-5 );
    float dfRw = clamp( fwidth( dfRim ) * 1.5, 0.02, 0.2 );
    float dfRimK = smoothstep( 0.7 - dfRw, 0.7 + dfRw, dfRim ) * smoothstep( 0.25, 1.2, dfCurv );
    reflectedLight.directDiffuse += ( diffuseColor.rgb * 0.6 + 0.4 ) * ( dfToonAmb * 0.3 + min( dfToonLit, vec3( 1.5 ) ) * 0.22 ) * dfRimK * RECIPROCAL_PI * 2.0;
}`

/** Patches a Lambert material in place for toon lighting and voxel glow. */
export function dfPatchVoxGlow<T extends THREE.Material>(m: T, uGlow: { value: number }, extraKey = ''): T {
    const prev = m.onBeforeCompile
    m.onBeforeCompile = (shader, renderer) => {
        prev?.call(m, shader, renderer)
        shader.uniforms.uGlow = uGlow
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', VERT_HEAD)
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;')
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', FRAG_HEAD)
            .replace('#include <lights_pars_begin>', THREE.ShaderChunk.lights_pars_begin.replace('float hemiDiffuseWeight = 0.5 * dotNL + 0.5;', TOON_HEMI))
            .replace('#include <lights_lambert_pars_fragment>', TOON_LIGHTS)
            .replace('#include <lights_fragment_end>', TOON_RIM)
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * uGlow;')
    }
    const prevKey = m.customProgramCacheKey.bind(m)
    m.customProgramCacheKey = () => `dfvox-toon${extraKey}|${prevKey()}`
    return m
}

/** A new voxel material (call `dispose()` when done). */
export function dfVoxMaterial(opts: DfVoxMaterialOpts = {}): DfVoxMaterial {
    const m = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: opts.side ?? THREE.FrontSide,
        transparent: opts.transparent ?? false,
        opacity: opts.opacity ?? 1,
        fog: opts.fog ?? true,
        emissive: opts.emissive ?? 0x000000
    }) as DfVoxMaterial
    m.userData.uGlow = { value: opts.glow ?? 1 }
    dfPatchVoxGlow(m, m.userData.uGlow)
    return m
}

let shared: DfVoxMaterial | null = null
let refs = 0

/** The shared default voxel material (ref-counted; release with `dfReleaseVoxMaterial`). */
export function dfSharedVoxMaterial(): DfVoxMaterial {
    if (!shared) shared = dfVoxMaterial()
    refs++
    return shared
}

export function dfReleaseVoxMaterial(): void {
    refs = Math.max(0, refs - 1)
    if (refs === 0 && shared) {
        shared.dispose()
        shared = null
    }
}
