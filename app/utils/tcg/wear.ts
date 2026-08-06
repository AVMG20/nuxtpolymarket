import * as THREE from 'three'
import type { TcgWearSpec } from '#shared/types/tcg'
import { ASPECT } from '~/utils/tcg/foil'

/* The wear overlay: condition rendered as marks on the card, not as a number.
 *
 * A second transparent plane sits 0.002 in front of the card mesh and draws
 * only what the server-derived lossy spec says survived — corner whitening,
 * edge wear, and surface flaws. It shares the foil's uPointer/uTime uniform
 * objects, so the existing tilt drives the wear lighting with no extra wiring.
 *
 * The one load-bearing rendering rule (design doc §8.3): surface flaws respond
 * to light on a DIFFERENT curve than the foil. The foil is a broad sweep in
 * uPointer.x; a scratch here glints through pow(…, 24) only when the light
 * crosses perpendicular to it, so it flashes when the foil doesn't — which is
 * exactly how you find damage on a real foil card.
 */

export const MAX_CORNERS = 4
export const MAX_EDGES = 4
export const MAX_SURFACE = 12

const CORNER_POS: Record<string, [number, number]> = {
    tl: [0, 1],
    tr: [1, 1],
    bl: [0, 0],
    br: [1, 0]
}

const EDGE_INDEX: Record<string, number> = { top: 0, right: 1, bottom: 2, left: 3 }

const SURFACE_TYPE: Record<string, number> = {
    scratch: 0,
    print_line: 1,
    dimple: 2,
    gloss_loss: 3
}

// The seed is a uint32 but a GLSL highp float only carries 24 bits exactly, so
// the hash-space offset is derived here in JS and shipped as a small float the
// shader can use directly.
function seedOffset(seed: number): number {
    return ((seed >>> 0) % 4096) / 4096 * 97.0 + 3.7
}

export const WEAR_VERTEX = /* glsl */`
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`

export const WEAR_FRAGMENT = /* glsl */`
    precision highp float;

    #define MAX_CORNERS 4
    #define MAX_EDGES 4
    #define MAX_SURFACE 12

    varying vec2 vUv;

    uniform vec2 uPointer;
    uniform float uTime;
    uniform float uAspect;
    uniform vec2 uCentering;
    uniform sampler2D uCard;
    uniform float uCrop;
    // (corner x, corner y, severity, noise offset)
    uniform vec4 uCornerFlaw[MAX_CORNERS];
    // (edge index 0..3 top/right/bottom/left, severity, noise offset, unused)
    uniform vec4 uEdgeFlaw[MAX_EDGES];
    // (x, y, angle, severity)
    uniform vec4 uSurfA[MAX_SURFACE];
    // (type 0..3 scratch/print_line/dimple/gloss_loss, noise offset, 0, 0)
    uniform vec4 uSurfB[MAX_SURFACE];

    float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    // 3 octaves of value noise — enough structure for whitening to read as
    // fibre damage rather than as an airbrushed blob.
    float fbm(vec2 p) {
        float v = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 3; i++) {
            v += amp * vnoise(p);
            p = p * 2.13 + 17.7;
            amp *= 0.5;
        }
        return v;
    }

    // "la over what's accumulated so far", unpremultiplied.
    void over(inout vec3 c, inout float a, vec3 lc, float la) {
        la = clamp(la, 0.0, 1.0);
        float na = a + la * (1.0 - a);
        c = (c * a * (1.0 - la) + lc * la) / max(na, 1e-4);
        a = na;
    }

    void main() {
        // Physical card space: height 1, width uAspect. Distances here are
        // isotropic, so circles stay circular.
        vec2 p = vec2(vUv.x * uAspect, vUv.y);
        // Min-dimension unit — the card is portrait, so the width.
        float mn = uAspect;

        // The same light mapping the foil uses: uPointer is 0.5-centred and
        // moves with the card's tilt (the foil reads (uPointer.x - 0.5) as its
        // light position). Here the full 2D offset is the light direction.
        vec2 lightVec = uPointer - vec2(0.5);
        float lightMag = length(lightVec);
        vec2 lightDir2 = lightMag > 1e-4 ? lightVec / lightMag : vec2(0.0, 1.0);
        // Square-on there is no raking light, so glints fade out near centre.
        float raking = smoothstep(0.02, 0.25, lightMag);

        vec3 col = vec3(0.0);
        float alpha = 0.0;

        // --- Miscut sliver -------------------------------------------------
        // The card mesh's UVs are shifted by uCentering, and the foil shader
        // clips its rounded-rect silhouette in that shifted space — so the
        // print's whole outline (straight edges AND rounded corners) moves
        // with the miscut, exposing a gap against the die-cut card outline.
        // Cover exactly that gap: everywhere outside the SHIFTED silhouette
        // (this mesh's own unshifted clip below bounds it to the die-cut),
        // filled with border ink sampled from the card texture. The sample
        // point is clamped well inside the straight edges, past both the
        // texture's rounded-corner padding and the crop margin, so corners
        // continue the border colour instead of picking up scan white.
        vec2 suv = vUv - uCentering;
        vec2 spos = (suv - 0.5) * vec2(1.0, 1.0 / uAspect);
        float cornerR = 0.055;
        vec2 sextent = vec2(0.5, 0.5 / uAspect) - vec2(cornerR);
        vec2 sd2 = abs(spos) - sextent;
        float ssdf = length(max(sd2, 0.0)) + min(max(sd2.x, sd2.y), 0.0) - cornerR;
        // Starts a hair INSIDE the print outline, so the fill is already
        // opaque where the foil's own edge feather (±0.0025) begins — meeting
        // it exactly at the boundary leaves a half-covered seam line.
        float sliver = smoothstep(-0.006, -0.002, ssdf);
        // Sample the border ink just inside the print's nearest STRAIGHT
        // edge, with the along-edge coordinate clamped clear of the corner
        // curves — the scan's corners carry dark rounded-rim shading (and
        // white padding beyond it), so any sample near the corner arc smears
        // a wrong colour around the die-cut corner. The sleeve colour is
        // continuous along an edge, so borrowing it for the corner gap reads
        // seamlessly.
        float ink = 0.02;
        vec2 q = clamp(spos, -sextent, sextent);
        vec2 away = abs(spos - q);
        float cornerSafe = 0.10;
        vec2 inkUv;
        if (away.x > away.y) {
            inkUv = vec2(spos.x > 0.0 ? 1.0 - ink : ink,
                clamp(suv.y, cornerSafe, 1.0 - cornerSafe));
        } else {
            float inkY = ink * uAspect;
            inkUv = vec2(clamp(suv.x, cornerSafe, 1.0 - cornerSafe),
                spos.y > 0.0 ? 1.0 - inkY : inkY);
        }
        vec3 stock = texture2D(uCard, vec2(mix(uCrop, 1.0 - uCrop, inkUv.x), inkUv.y)).rgb;
        over(col, alpha, stock, sliver);

        // --- Corner wear ---------------------------------------------------
        // White-on-white is invisible: modern borders are silver, so the
        // whitening alone never reads. A worn corner is drawn as three layers
        // that carry their own contrast: a darker abraded fringe (ink loss +
        // grime shadow), a bright paper-fibre core with streaks running
        // diagonally into the corner, and dark chip specks on the very tip.
        vec3 white = vec3(0.97, 0.96, 0.92);
        vec3 fringe = vec3(0.52, 0.48, 0.43);
        for (int i = 0; i < MAX_CORNERS; i++) {
            float sev = uCornerFlaw[i].z;
            if (sev <= 0.0) continue;
            vec2 cpos = vec2(uCornerFlaw[i].x * uAspect, uCornerFlaw[i].y);
            vec2 noff = vec2(uCornerFlaw[i].w, uCornerFlaw[i].w * 1.618 + 3.1);
            float radius = (0.06 + 0.10 * sev) * mn;
            vec2 rel = p - cpos;
            float d = length(rel);
            // Diagonal pointing from the corner into the card.
            vec2 inward = normalize(sign(vec2(0.5 * uAspect, 0.5) - cpos));
            // Fibre streaks: noise stretched along the inward diagonal.
            float across = dot(rel, vec2(-inward.y, inward.x));
            float alongIn = dot(rel, inward);
            float streak = fbm(vec2(across * 220.0, alongIn * 26.0) + noff);
            float fall = 1.0 - smoothstep(0.0, radius, d);
            // Abraded fringe ring first: darker, reads on light borders.
            float ring = smoothstep(0.15, 0.65, fall) * (1.0 - smoothstep(0.75, 1.0, fall));
            over(col, alpha, fringe, ring * (0.30 + 0.55 * streak) * 0.75 * sev);
            // Paper-fibre core over it: near-opaque at the tip, so the dark
            // rim and frame ink visibly disappear into raw paper — that
            // silhouette bite, not the white itself, is what reads as wear.
            float coreFall = 1.0 - smoothstep(0.0, radius * 0.8, d);
            over(col, alpha, white, pow(coreFall, 1.3) * (0.55 + 0.6 * streak) * min(1.5 * sev, 1.0));
            // Chip specks at the very tip: small dark bites out of the tip.
            float speck = smoothstep(0.62, 0.92, vnoise(rel * 700.0 + noff));
            float tip = 1.0 - smoothstep(0.0, radius * 0.4, d);
            over(col, alpha, vec3(0.30, 0.28, 0.26), tip * speck * 0.8 * sev);
            // A severe corner has a crushed core — darker, compacted stock.
            if (sev > 0.6) {
                float core = 1.0 - smoothstep(0.0, radius * 0.30, d);
                over(col, alpha, vec3(0.55, 0.52, 0.47), core * (sev - 0.6) * 1.1 * (0.5 + 0.5 * streak));
            }
        }

        // --- Edge whitening / nicks ---------------------------------------
        for (int i = 0; i < MAX_EDGES; i++) {
            float sev = uEdgeFlaw[i].y;
            if (sev <= 0.0) continue;
            float idx = uEdgeFlaw[i].x;
            vec2 noff = vec2(uEdgeFlaw[i].z, uEdgeFlaw[i].z * 1.618 + 3.1);
            // Distance in from the edge, and the coordinate running along it.
            float dEdge;
            float along;
            if (idx < 0.5) { dEdge = 1.0 - p.y; along = p.x; }         // top
            else if (idx < 1.5) { dEdge = uAspect - p.x; along = p.y; } // right
            else if (idx < 2.5) { dEdge = p.y; along = p.x; }           // bottom
            else { dEdge = p.x; along = p.y; }                          // left
            // 1D noise along the edge makes the band ragged rather than ruled.
            float n1 = fbm(vec2(along * 70.0, 0.0) + noff);
            float w = (0.009 + 0.018 * sev) * mn * (0.5 + 1.0 * n1);
            // Occasional deeper nick where the noise peaks.
            float nick = smoothstep(0.70, 0.90, n1);
            w += nick * 0.032 * sev * mn;
            float band = 1.0 - smoothstep(0.0, max(w, 1e-4), dEdge);
            // Dark abrasion line hugging the very edge gives the white band
            // something to contrast against on a silver border.
            float rim = 1.0 - smoothstep(0.0, max(w * 0.35, 5e-4), dEdge);
            float fibre = fbm(vec2(along * 240.0, dEdge * 40.0) + noff);
            over(col, alpha, fringe, band * (0.25 + 0.5 * fibre) * 0.6 * sev);
            // Near-opaque against the very edge, fading inward — the rim ink
            // must actually vanish or the band reads as haze, not wear.
            over(col, alpha, white, band * (0.55 + 0.45 * fibre) * min(1.4 * sev, 1.0));
            over(col, alpha, vec3(0.32, 0.30, 0.28), rim * nick * (0.5 + 0.5 * fibre) * 0.9 * sev);
        }

        // --- Surface flaws -------------------------------------------------
        for (int i = 0; i < MAX_SURFACE; i++) {
            float sev = uSurfA[i].w;
            if (sev <= 0.0) continue;
            vec2 q = vec2(uSurfA[i].x * uAspect, uSurfA[i].y);
            float ang = uSurfA[i].z;
            float kind = uSurfB[i].x;
            vec2 noff = vec2(uSurfB[i].y, uSurfB[i].y * 1.618 + 3.1);
            vec2 dir = vec2(cos(ang), sin(ang));
            vec2 rel = p - q;

            if (kind < 0.5) {
                // Scratch: a thin line SDF, nearly invisible flat-on, with a
                // sharp specular glint when the light crosses perpendicular —
                // pow 24 against the foil's broad sweep, deliberately a much
                // narrower curve so it flashes where the foil merely glows.
                float halfLen = (0.15 + 0.25 * sev) * 0.5;
                float t = clamp(dot(rel, dir), -halfLen, halfLen);
                float d = length(rel - dir * t);
                float taper = 1.0 - smoothstep(halfLen * 0.6, halfLen, abs(t));
                float ragged = 0.7 + 0.6 * vnoise(vec2(t * 160.0, 0.0) + noff);
                float core = (1.0 - smoothstep(0.0, 0.0024 * ragged, d)) * taper;
                float base = core * (0.18 + 0.30 * sev);
                vec2 perp = vec2(-dir.y, dir.x);
                float glint = pow(clamp(abs(dot(lightDir2, perp)), 0.0, 1.0), 24.0) * raking;
                over(col, alpha, vec3(0.9, 0.9, 0.88), base);
                over(col, alpha, vec3(0.98, 0.98, 0.96), core * glint * (0.35 + 0.65 * sev));
            } else if (kind < 1.5) {
                // Print line: a full-width, horizontal-ish faint line at y.
                // Constant visibility — it's in the ink, so no glint.
                vec2 ldir = normalize(vec2(cos(ang), sin(ang) * 0.15));
                float d = abs(dot(rel, vec2(-ldir.y, ldir.x)));
                float line = 1.0 - smoothstep(0.0, 0.0026, d);
                over(col, alpha, vec3(0.86, 0.86, 0.84), line * (0.15 + 0.35 * sev));
            } else if (kind < 2.5) {
                // Dimple: a small radial darkening plus a crescent highlight
                // on the light side that swings with the tilt — the rim of a
                // depression catching the lamp.
                float r = (0.010 + 0.016 * sev) * mn;
                float d = length(rel);
                float pit = 1.0 - smoothstep(0.0, r, d);
                over(col, alpha, vec3(0.22, 0.21, 0.20), pit * (0.12 + 0.30 * sev));
                float rim = 1.0 - smoothstep(0.0, r * 0.45, abs(d - r * 0.65));
                float side = clamp(dot(normalize(rel + vec2(1e-5)), lightDir2), 0.0, 1.0);
                over(col, alpha, vec3(0.97, 0.97, 0.95), rim * side * side * raking * (0.30 + 0.50 * sev));
            } else {
                // Gloss loss: an irregular matte patch. Neutral grey at low
                // alpha, with a SLIGHT negative glint — where the foil would
                // brighten as the light rakes, the dead patch goes darker
                // instead, which is what makes it findable under the tilt.
                float r = (0.08 + 0.1 * sev) * mn;
                float shape = fbm(rel * (8.0 / max(r, 1e-4)) + noff);
                float d = length(rel) * (0.72 + 0.56 * shape);
                float matte = 1.0 - smoothstep(r * 0.35, r, d);
                over(col, alpha, vec3(0.55, 0.55, 0.54), matte * (0.10 + 0.28 * sev));
                over(col, alpha, vec3(0.28, 0.28, 0.28), matte * raking * (0.10 + 0.25 * sev));
            }
        }

        // Clip to the card's rounded rectangle — same construction and
        // constants as the foil shader, so the overlay never paints outside
        // the corner radius the card itself draws.
        vec2 pos = (vUv - 0.5) * vec2(1.0, 1.0 / uAspect);
        float corner = 0.055;
        vec2 extent = vec2(0.5, 0.5 / uAspect) - vec2(corner);
        vec2 d2 = abs(pos) - extent;
        float sdf = length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0) - corner;
        float edge = 1.0 - smoothstep(-0.0025, 0.0025, sdf);

        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * edge);
    }
`

/* Shifting the card's UVs for centering also shifts the foil shader's own
 * rounded-rect clip — so on the side the print moves toward, the face renders
 * past where the die-cut corner should end (a squared-off overhang at the
 * trailing corners). Nothing drawn on top can remove it, so this material
 * ERASES it: rendered between the card and the wear overlay, it multiplies
 * the destination (colour and alpha) toward zero everywhere outside the
 * die-cut outline, restoring the physical card silhouette.
 */
export const ERASER_FRAGMENT = /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform float uAspect;
    void main() {
        vec2 pos = (vUv - 0.5) * vec2(1.0, 1.0 / uAspect);
        float corner = 0.055;
        vec2 extent = vec2(0.5, 0.5 / uAspect) - vec2(corner);
        vec2 d2 = abs(pos) - extent;
        float sdf = length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0) - corner;
        float outside = smoothstep(-0.0025, 0.0025, sdf);
        gl_FragColor = vec4(0.0, 0.0, 0.0, outside);
    }
`

export function makeEraserMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: { uAspect: { value: ASPECT } },
        vertexShader: WEAR_VERTEX,
        fragmentShader: ERASER_FRAGMENT,
        transparent: true,
        depthWrite: false,
        // dst' = dst * (1 - outside): keeps the die-cut interior untouched,
        // fades the overhang to fully transparent.
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.ZeroFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor
    })
}

export function makeWearMaterial(
    spec: TcgWearSpec,
    shared: {
        uPointer: { value: THREE.Vector2 }
        uTime: { value: number }
        uCard: { value: THREE.Texture | null }
        uCrop: { value: number }
    }
): THREE.ShaderMaterial {
    const corners = Array.from({ length: MAX_CORNERS }, () => new THREE.Vector4(0, 0, 0, 0))
    spec.corners.slice(0, MAX_CORNERS).forEach((c, i) => {
        const [x, y] = CORNER_POS[c.corner] ?? [0, 0]
        corners[i]!.set(x, y, c.severity, seedOffset(c.seed))
    })

    const edges = Array.from({ length: MAX_EDGES }, () => new THREE.Vector4(0, 0, 0, 0))
    spec.edges.slice(0, MAX_EDGES).forEach((e, i) => {
        edges[i]!.set(EDGE_INDEX[e.edge] ?? 0, e.severity, seedOffset(e.seed), 0)
    })

    const surfA = Array.from({ length: MAX_SURFACE }, () => new THREE.Vector4(0, 0, 0, 0))
    const surfB = Array.from({ length: MAX_SURFACE }, () => new THREE.Vector4(0, 0, 0, 0))
    spec.surface.slice(0, MAX_SURFACE).forEach((s, i) => {
        surfA[i]!.set(s.x, s.y, s.angle, s.severity)
        surfB[i]!.set(SURFACE_TYPE[s.type] ?? 0, seedOffset(s.seed), 0, 0)
    })

    return new THREE.ShaderMaterial({
        uniforms: {
            // Shared by reference with the foil material: the tilt loop
            // writes these once and both shaders see it.
            uPointer: shared.uPointer,
            uTime: shared.uTime,
            // Shared by reference too: the texture arrives async and the foil
            // loader fills this same uniform object in when it does.
            uCard: shared.uCard,
            uCrop: shared.uCrop,
            uAspect: { value: ASPECT },
            uCentering: { value: new THREE.Vector2(spec.centering.dx, spec.centering.dy) },
            uCornerFlaw: { value: corners },
            uEdgeFlaw: { value: edges },
            uSurfA: { value: surfA },
            uSurfB: { value: surfB }
        },
        vertexShader: WEAR_VERTEX,
        fragmentShader: WEAR_FRAGMENT,
        transparent: true,
        depthWrite: false
    })
}
