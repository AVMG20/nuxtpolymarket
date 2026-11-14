import type * as THREE from 'three'
import { DF_VOX_ORIGIN } from '#shared/utils/dead-front/map-world'
import { DF_SURFS, dfLevelSurfaceData } from './level'

// Hand-drawn surfaces for the map's chunks. The level mesh is one big white
// greedy mesh; this patch looks up each fragment's surface family in a 3D
// texture of the voxel grid and paints it in world space, comic style: flat
// tones per brick / cobble / board / tile, inked mortar and outlines, grass
// strokes, plaster stains and cracks. Lines are anti-aliased with the pixel
// footprint and fade to a flat average before they could shimmer. Borders
// between soft families (mud, grass, cobbles; plaster and brick) melt into
// inked blobs instead of 0.5 m squares, outer edges get a worn bevel (bent
// normal) and inner corners a drawn contact line.

const VERT_HEAD = /* glsl */`#include <common>
varying vec3 vDfWPos;
varying vec3 vDfWNor;`

const VERT_BODY = /* glsl */`#include <worldpos_vertex>
vDfWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vDfWNor = normalize(mat3(modelMatrix) * objectNormal);`

const defines = (): string => {
    const d = dfLevelSurfaceData()
    const ids = DF_SURFS.map((s, i) => `#define DF_${s.toUpperCase()} ${i + 1}`).join('\n')
    const n = DF_SURFS.length + 1
    return `${ids}
#define DF_NT ${DF_SURFS.length * 4}
const int DF_BLEND[${n}] = int[${n}](0, ${d.blend.join(', ')});`
}

const FRAG_HEAD = /* glsl */`
varying vec3 vDfWPos;
varying vec3 vDfWNor;
uniform highp sampler3D uDfGrid;
uniform ivec3 uDfSize;
uniform vec3 uDfOrigin;
uniform float uDfCell;
uniform vec3 uDfTone[DF_NT];
vec3 dfNW = vec3(0.0, 1.0, 0.0);
float dfPx = 0.01;

int dfAt(ivec3 c) {
    if (any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, uDfSize))) return 0;
    return int(texelFetch(uDfGrid, c.xzy, 0).r * 255.0 + 0.5);
}
vec3 dfTone(int s, int k) { return uDfTone[(s - 1) * 4 + k]; }
float dfH(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
vec2 dfH2(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}
float dfN(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(dfH(i), dfH(i + vec2(1.0, 0.0)), u.x), mix(dfH(i + vec2(0.0, 1.0)), dfH(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec2 dfWarp(vec2 p, float f, float a) {
    return p + a * (vec2(dfN(p * f), dfN(p * f + 7.31)) - 0.5);
}
// Ink coverage of a stroke at distance d (metres) with half width w. Strokes
// thinner than a pixel get a pixel wide and fade by the area they gained.
float dfStroke(float d, float w, float px) {
    float we = max(w, px * 0.5);
    return (1.0 - smoothstep(we - px * 0.5, we + px * 0.5, d)) * (w / we);
}
// Coverage of a filled region from a signed distance (negative inside).
float dfFill(float sd, float px) {
    return 1.0 - smoothstep(-px * 0.5, px * 0.5, sd);
}
// 1 while features of size s (metres) span a few pixels, 0 before they alias.
float dfNear(float s, float px) {
    return 1.0 - smoothstep(s * 0.1, s * 0.3, px);
}
float dfBox(vec2 f, vec2 hs, float r) {
    vec2 q = abs(f) - hs + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec3 dfTone3(int s, float h) {
    return h < 0.3 ? dfTone(s, 1) : (h < 0.82 ? dfTone(s, 0) : dfTone(s, 2));
}
// Voronoi: distance to the nearest cell border and the cell's hash.
vec2 dfVor(vec2 x) {
    vec2 n = floor(x);
    vec2 f = fract(x);
    vec2 mg = vec2(0.0);
    vec2 mr = vec2(0.0);
    float md = 8.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 r = g + dfH2(n + g) * 0.8 + 0.1 - f;
            float d = dot(r, r);
            if (d < md) {
                md = d;
                mr = r;
                mg = g;
            }
        }
    }
    md = 8.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = mg + vec2(float(i), float(j));
            vec2 r = g + dfH2(n + g) * 0.8 + 0.1 - f;
            vec2 dr = r - mr;
            if (dot(dr, dr) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(dr)));
        }
    }
    return vec2(md, dfH(n + mg));
}

// Rounded stones in staggered rows (cobbles, rubble walls, flagstones).
vec3 dfStones(int s, vec2 uv, vec2 P, float r, float gap, float wob, float vary) {
    vec2 w = dfWarp(uv, 2.2, wob);
    float row = floor(w.y / P.y);
    float xs = w.x / P.x + 0.5 * mod(row, 2.0) + dfH(vec2(row, 9.0)) * 3.0;
    xs += vary * dfN(vec2(xs * 0.8, row * 1.7));
    float col = floor(xs);
    vec2 h2 = dfH2(vec2(col, row));
    vec2 f = (vec2(fract(xs), fract(w.y / P.y)) - 0.5) * P;
    vec2 hs = P * 0.5 - gap - h2 * gap * 0.8;
    float sd = dfBox(f - (h2 - 0.5) * gap, hs, r);
    float near = dfNear(P.y, dfPx);
    vec3 st = dfTone3(s, dfH(vec2(col, row) + 0.37));
    float inside = dfFill(sd, dfPx);
    vec3 c = mix(mix(dfTone(s, 3), dfTone(s, 1), 0.45), st, inside);
    // a lit rim along each stone's upper edge
    float rim = inside * (1.0 - dfFill(dfBox(f - (h2 - 0.5) * gap + vec2(0.012, 0.022), hs, r), dfPx));
    c = mix(c, dfTone(s, 2), rim * 0.55);
    c = mix(c, dfTone(s, 3), dfStroke(abs(sd), 0.006, dfPx) * 0.85);
    return mix(mix(dfTone(s, 0), dfTone(s, 3), 0.12), c, near);
}

vec3 dfBrick(vec2 uv) {
    int s = DF_BRICK;
    vec2 P = vec2(0.3, 0.125);
    vec2 w = dfWarp(uv, 3.1, 0.022);
    float row = floor(w.y / P.y);
    float x = w.x / P.x + 0.5 * mod(row, 2.0) + 0.2 * dfH(vec2(row, 4.0));
    float col = floor(x);
    vec2 f = vec2(fract(x) * P.x, fract(w.y / P.y) * P.y);
    float d = min(min(f.x, P.x - f.x), min(f.y, P.y - f.y));
    float near = dfNear(P.y, dfPx);
    vec3 c = mix(dfTone(s, 0), dfTone3(s, dfH(vec2(col, row))), near);
    c = mix(c, dfTone(s, 2), dfStroke(abs(P.y - f.y - 0.024), 0.006, dfPx) * near * 0.45);
    float ink = dfStroke(d, 0.01 * (0.55 + 0.9 * dfN(uv * 8.0)), dfPx);
    return mix(c, dfTone(s, 3), mix(0.16, ink, near));
}

vec3 dfAshlar(vec2 uv, int s) {
    vec2 P = vec2(0.75, 0.375);
    vec2 w = dfWarp(uv, 2.0, 0.012);
    float row = floor(w.y / P.y);
    float xs = w.x / P.x + 0.5 * mod(row, 2.0) + 0.25 * dfH(vec2(row, 2.0));
    xs += 0.3 * dfN(vec2(xs * 0.9, row));
    float col = floor(xs);
    vec2 f = vec2(fract(xs) * P.x, fract(w.y / P.y) * P.y);
    float d = min(min(f.x, P.x - f.x), min(f.y, P.y - f.y));
    float near = dfNear(P.y * 0.5, dfPx);
    float h = dfH(vec2(col, row));
    vec3 c = h < 0.35 ? dfTone(s, 1) : (h < 0.85 ? dfTone(s, 0) : dfTone(s, 2));
    c = mix(dfTone(s, 0), c, near);
    // chisel: a light lip under each top edge, a dark one above each bottom edge
    c = mix(c, dfTone(s, 2), dfStroke(abs(P.y - f.y - 0.03), 0.01, dfPx) * near * 0.6);
    c = mix(c, dfTone(s, 1), dfStroke(abs(f.y - 0.028), 0.01, dfPx) * near * 0.6);
    // weathering streaks running down
    float st = dfN(vec2(uv.x * 7.0, uv.y * 0.35)) * 0.75 + dfN(uv * vec2(14.0, 1.2)) * 0.25;
    float sw = fwidth(st) + 1e-4;
    c = mix(c, dfTone(s, 1), smoothstep(0.74 - sw, 0.74 + sw, st) * 0.5);
    return mix(c, dfTone(s, 3), mix(0.08, dfStroke(d, 0.007, dfPx), near));
}

vec3 dfPlaster(vec2 uv) {
    int s = DF_PLASTER;
    float st = dfN(uv * vec2(0.8, 0.55)) * 0.65 + dfN(uv * 2.1 + 3.0) * 0.35;
    float sw = fwidth(st) + 1e-4;
    vec3 c = dfTone(s, 0);
    c = mix(c, dfTone(s, 1), smoothstep(0.63 - sw, 0.63 + sw, st));
    c = mix(c, dfTone(s, 2), 1.0 - smoothstep(0.32 - sw, 0.32 + sw, st));
    // drips under the stains
    float dr = dfN(vec2(uv.x * 7.0, uv.y * 0.25 + 4.0));
    float dw = fwidth(dr) + 1e-4;
    c = mix(c, dfTone(s, 1), smoothstep(0.78 - dw, 0.78 + dw, dr) * 0.6);
    float near = dfNear(0.25, dfPx);
    float mask = dfN(uv * 0.45 + 3.7) * 0.75 + dfN(uv * 1.7) * 0.25;
    if (near > 0.0 && mask > 0.6) {
        vec2 v = dfVor(dfWarp(uv, 4.0, 0.08) * 1.8);
        float w = 0.005 * smoothstep(0.6, 0.75, mask) * step(0.45, v.y);
        c = mix(c, dfTone(s, 3), dfStroke(v.x / 1.8, w, dfPx) * near);
    }
    return c;
}

// Roof tiles (scalloped rows) and slates (square rows). uv.y climbs toward the ridge.
vec3 dfTiles(vec2 uv, int s, vec2 P, float bulge) {
    vec2 w = dfWarp(uv, 2.5, 0.015);
    float row = floor(w.y / P.y);
    float x = w.x / P.x + 0.5 * mod(row, 2.0);
    float col = floor(x);
    float fx = fract(x) - 0.5;
    float fy = fract(w.y / P.y) * P.y;
    float near = dfNear(P.y, dfPx);
    vec3 c = dfTone3(s, dfH(vec2(col, row)));
    // the tile's lower edge (a scallop, or a chipped straight edge), the row below in its shadow
    float de = fy - (bulge * 4.0 * fx * fx + 0.006 * (dfH(vec2(col, row) + 0.5) - 0.5));
    c = mix(c, dfTone(s, 1) * 0.75, dfFill(de - 0.02 * step(bulge, 0.0) - 0.004, dfPx) * 0.8);
    float jd = (0.5 - abs(fx)) * P.x;
    float ink = max(dfStroke(abs(de), 0.008, dfPx), dfStroke(jd, 0.006, dfPx) * step(0.0, de));
    c = mix(dfTone(s, 0), c, near);
    return mix(c, dfTone(s, 3), mix(0.18, ink, near));
}

// Boards along uv.x, gaps across uv.y.
vec3 dfBoards(vec2 b, int s, bool gaps) {
    float BW = 0.2;
    float bi = floor(b.y / BW);
    float fy = fract(b.y / BW) * BW;
    float h = dfH(vec2(bi, 1.7));
    float L = 1.4 + h * 1.4;
    float bx = b.x + h * 5.0;
    float seg = floor(bx / L);
    float fx = fract(bx / L) * L;
    float hb = dfH(vec2(bi, seg));
    vec3 c = dfTone3(s, hb);
    float near = dfNear(BW * 0.5, dfPx);
    // grain: broken wavy lines along the board
    float gy = fy + 0.01 * sin(bx * 2.7 + hb * 6.3) + 0.012 * dfN(vec2(bx * 1.5, bi * 3.0));
    float gl = floor(gy / 0.05);
    float gd = abs(fract(gy / 0.05) - 0.5) * 0.05;
    float gm = step(0.5, dfN(vec2(bx * 1.2 + gl * 3.1, bi * 5.0 + gl)));
    c = mix(c, dfTone(s, 1), dfStroke(gd, 0.0035, dfPx) * gm * dfNear(0.05, dfPx) * 0.85);
    // a knot now and then
    vec2 kc = vec2(L * (0.25 + 0.5 * dfH(vec2(bi, seg) + 3.1)), BW * (0.3 + 0.4 * dfH(vec2(seg, bi))));
    float kd = length((vec2(fx, fy) - kc) * vec2(0.55, 1.0));
    if (dfH(vec2(bi, seg) + 7.7) < 0.35) c = mix(c, dfTone(s, 3), dfStroke(abs(kd - 0.014), 0.004, dfPx) * near);
    float d = min(fy, BW - fy);
    if (gaps) d = min(d, min(fx, L - fx));
    c = mix(dfTone(s, 0), c, near);
    return mix(c, dfTone(s, 3), mix(0.15, dfStroke(d, 0.009, dfPx), near));
}

vec3 dfGrass(vec2 uv) {
    int s = DF_GRASS;
    float z = dfN(uv * 0.45) * 0.65 + dfN(uv * 1.3 + 2.0) * 0.35;
    float zw = fwidth(z) * 0.7 + 1e-4;
    vec3 c = dfTone(s, 0);
    c = mix(c, dfTone(s, 1), smoothstep(0.6 - zw, 0.6 + zw, z));
    c = mix(c, dfTone(s, 2), 1.0 - smoothstep(0.36 - zw, 0.36 + zw, z));
    float near = dfNear(0.1, dfPx);
    if (near > 0.0) {
        // tufts: one per 0.34 m cell, three blades fanning out
        vec2 id = floor(uv / 0.34);
        vec2 h2 = dfH2(id);
        vec2 root = (id + 0.35 + h2 * 0.3) * 0.34;
        float ink = 0.0;
        float hl = 0.0;
        for (int k = 0; k < 3; k++) {
            float a = (float(k) - 1.0) * 0.6 + (h2.x - 0.5) * 0.7;
            vec2 dir = vec2(sin(a), cos(a));
            float len = 0.07 + 0.05 * dfH(id + float(k) * 1.3);
            vec2 q = uv - root;
            float t = clamp(dot(q, dir) / len, 0.0, 1.0);
            float d = length(q - dir * t * len);
            ink = max(ink, dfStroke(d, 0.0085 * (1.0 - t * 0.75), dfPx));
            hl = max(hl, dfStroke(length(q - vec2(0.012, 0.0) - dir * t * len * 0.8), 0.004 * (1.0 - t), dfPx));
        }
        float on = step(0.22, h2.y);
        c = mix(c, dfTone(s, 3), ink * near * on * 0.9);
        c = mix(c, dfTone(s, 2), hl * near * on * 0.5);
    }
    return c;
}

vec3 dfMud(vec2 uv, int s, bool top) {
    float z = dfN(uv * 0.6 + 5.0) * 0.7 + dfN(uv * 1.9) * 0.3;
    float zw = fwidth(z) * 0.7 + 1e-4;
    vec3 c = mix(dfTone(s, 0), dfTone(s, 1), smoothstep(0.58 - zw, 0.58 + zw, z));
    c = mix(c, dfTone(s, 2), (1.0 - smoothstep(0.3 - zw, 0.3 + zw, z)) * 0.8);
    float near = dfNear(0.08, dfPx);
    if (near > 0.0) {
        // clods and boot prints: small dark dots
        vec2 id = floor(uv / 0.16);
        vec2 h2 = dfH2(id + 0.7);
        float d = length(uv - (id + 0.25 + h2 * 0.5) * 0.16);
        float r = 0.01 + 0.016 * dfH(id + 2.2);
        c = mix(c, dfTone(s, 3), dfFill(d - r, dfPx) * step(0.45, h2.x) * near * 0.7);
    }
    if (top) {
        // puddles: flat water, a dark inked rim and a stroke of reflected sky
        float thr = s == DF_CRATER ? 0.62 : 0.76;
        float p = dfN(uv * 0.55 + 11.0) * 0.7 + dfN(uv * 1.6 + 4.0) * 0.3;
        float pw = fwidth(p) + 1e-5;
        float sd = (thr - p) / pw * dfPx;
        float wet = dfFill(sd, dfPx);
        if (wet > 0.0 || sd < 0.05) {
            vec3 wc = mix(dfTone(DF_WATER, 1), dfTone(DF_WATER, 0), smoothstep(0.0, 0.25, -sd));
            float sh = dfStroke(abs(fract(uv.x * 1.3 + uv.y * 0.6 + dfN(uv * 2.0) * 0.4) - 0.5), 0.05, dfPx * 1.3);
            wc = mix(wc, dfTone(DF_WATER, 2), sh * step(0.12, -sd) * 0.6);
            c = mix(c, wc, wet);
            c = mix(c, dfTone(s, 3), dfStroke(abs(sd), 0.008, dfPx));
        }
    }
    return c;
}

vec3 dfDots(vec2 uv, int s, float P, float r0, float r1) {
    vec3 c = dfTone(s, 0);
    float near = dfNear(P, dfPx);
    if (near > 0.0) {
        vec2 id = floor(uv / P);
        vec2 h2 = dfH2(id);
        float d = length(uv - (id + 0.3 + h2 * 0.4) * P);
        float r = mix(r0, r1, dfH(id + 1.9));
        float k = dfH(id + 4.1);
        vec3 dc = k < 0.5 ? dfTone(s, 1) : (k < 0.85 ? dfTone(s, 2) : dfTone(s, 3));
        c = mix(c, dc, dfFill(d - r, dfPx) * near);
    }
    return c;
}

vec3 dfStraw(vec2 uv, int s) {
    vec3 c = dfTone(s, 0);
    float near = dfNear(0.06, dfPx);
    if (near > 0.0) {
        vec2 id = floor(uv / 0.11);
        for (int k = 0; k < 2; k++) {
            vec2 h2 = dfH2(id + float(k) * 3.7);
            float a = h2.x * 3.1416;
            vec2 dir = vec2(cos(a), sin(a));
            vec2 q = uv - (id + 0.5) * 0.11 - (h2 - 0.5) * 0.03;
            float t = clamp(dot(q, dir), -0.045, 0.045);
            float d = length(q - dir * t);
            c = mix(c, k == 0 ? dfTone(s, 1) : dfTone(s, 2), dfStroke(d, 0.004, dfPx) * near);
        }
    }
    return c;
}

vec3 dfRubble(vec2 uv, int s) {
    vec2 v = dfVor(dfWarp(uv, 3.0, 0.05) * 4.5);
    float d = v.x / 4.5;
    float near = dfNear(0.15, dfPx);
    vec3 c = dfTone3(s, v.y);
    c = mix(c, mix(dfTone(DF_MUD, 1), dfTone(s, 3), 0.3), 1.0 - smoothstep(0.012 - dfPx * 0.5, 0.012 + dfPx * 0.5, d));
    c = mix(c, dfTone(s, 3), dfStroke(abs(d - 0.012), 0.004, dfPx));
    return mix(dfTone(s, 0), c, near);
}

vec3 dfMarble(vec2 uv, int s) {
    vec3 c = dfAshlar(uv * vec2(0.75, 1.0) * 0.666, s);
    float v = dfN(uv * 1.2 + dfN(uv * 3.0) * 1.5);
    c = mix(c, dfTone(s, 1), dfStroke(abs(v - 0.5) * 0.4, 0.003, dfPx) * dfNear(0.08, dfPx));
    return c;
}

vec3 dfFlat(vec2 uv, int s) {
    float st = dfN(vec2(uv.x * 3.0, uv.y * 0.5)) * 0.7 + dfN(uv * 5.0) * 0.3;
    float sw = fwidth(st) + 1e-4;
    vec3 c = mix(dfTone(s, 0), dfTone(s, 1), smoothstep(0.62 - sw, 0.62 + sw, st));
    return mix(c, dfTone(s, 2), (1.0 - smoothstep(0.3 - sw, 0.3 + sw, st)) * 0.6);
}

vec3 dfWater(vec2 uv) {
    int s = DF_WATER;
    vec3 c = dfTone(s, 0);
    vec2 w = dfWarp(uv, 1.5, 0.2);
    float row = floor(w.y / 0.18);
    float x = w.x / 0.5 + dfH(vec2(row, 1.0)) * 4.0;
    float on = step(0.55, dfH(vec2(floor(x), row)));
    float dy = abs(fract(w.y / 0.18) - 0.5) * 0.18;
    float fx = abs(fract(x) - 0.5);
    return mix(c, dfTone(s, 2), dfStroke(dy, 0.006 * smoothstep(0.45, 0.2, fx), dfPx) * on * dfNear(0.1, dfPx) * 0.8);
}

// Window glass in a frame with muntins (dark panes, lit windows), from the run of cells it spans.
vec3 dfWindow(int s, ivec3 c, ivec3 iu, ivec3 iv, float fu, float fv) {
    float l = 0.0;
    float r = 0.0;
    float b = 0.0;
    float t = 0.0;
    for (int k = 1; k <= 6; k++) { if (dfAt(c - iu * k) != s) break; l += 1.0; }
    for (int k = 1; k <= 6; k++) { if (dfAt(c + iu * k) != s) break; r += 1.0; }
    for (int k = 1; k <= 8; k++) { if (dfAt(c - iv * k) != s) break; b += 1.0; }
    for (int k = 1; k <= 8; k++) { if (dfAt(c + iv * k) != s) break; t += 1.0; }
    vec2 sz = vec2(l + r + 1.0, b + t + 1.0) * uDfCell;
    vec2 q = vec2(l + fu, b + fv) * uDfCell;
    float dEdge = min(min(q.x, sz.x - q.x), min(q.y, sz.y - q.y));
    vec3 g;
    if (s == DF_LIT) {
        g = mix(dfTone(s, 0), dfTone(s, 2), smoothstep(0.1, sz.y * 0.9, q.y) * 0.6);
        // a drawn curtain on one side
        float cx = sz.x * (0.28 + 0.06 * sin(q.y * 9.0));
        g = mix(g, dfTone(s, 1), dfFill(q.x - cx, dfPx) * 0.8);
    } else {
        g = dfTone(s, 0);
        float gl = abs(q.x - q.y * 0.55 - sz.x * 0.25);
        g = mix(g, dfTone(s, 2), dfStroke(gl, 0.04, dfPx) * 0.55);
        g = mix(g, dfTone(s, 2), dfStroke(abs(gl - 0.09), 0.012, dfPx) * 0.45);
    }
    float frame = max(dfFill(dEdge - 0.06, dfPx), max(dfStroke(abs(q.x - sz.x * 0.5), 0.022, dfPx), dfStroke(abs(q.y - sz.y * 0.62), 0.022, dfPx)));
    return mix(g, dfTone(s, 3), frame);
}

// Stained glass: a pointed lancet of leaded diamonds.
vec3 dfGlass(ivec3 c, ivec3 iu, ivec3 iv, float fu, float fv) {
    int s = DF_GLASS;
    float l = 0.0;
    float r = 0.0;
    float b = 0.0;
    float t = 0.0;
    for (int k = 1; k <= 6; k++) { if (dfAt(c - iu * k) != s) break; l += 1.0; }
    for (int k = 1; k <= 6; k++) { if (dfAt(c + iu * k) != s) break; r += 1.0; }
    for (int k = 1; k <= 10; k++) { if (dfAt(c - iv * k) != s) break; b += 1.0; }
    for (int k = 1; k <= 10; k++) { if (dfAt(c + iv * k) != s) break; t += 1.0; }
    vec2 sz = vec2(l + r + 1.0, b + t + 1.0) * uDfCell;
    vec2 q = vec2(l + fu, b + fv) * uDfCell;
    float hw = sz.x * 0.5;
    float ax = abs(q.x - hw);
    float ys = sz.y - 1.6 * hw - 0.04;
    float arch = q.y > ys ? length(vec2(ax + hw * 0.9, q.y - ys)) - hw * 1.9 : -1.0;
    float dEdge = min(min(q.x, sz.x - q.x), q.y);
    vec2 dg = vec2(q.x + q.y, q.x - q.y) / 0.2;
    vec2 cid = floor(dg);
    float h = dfH(cid);
    vec3 g = h < 0.4 ? dfTone(s, 0) : (h < 0.72 ? dfTone(s, 1) : dfTone(s, 2));
    float dl = min(abs(fract(dg.x) - 0.5), abs(fract(dg.y) - 0.5));
    float lead = dfStroke((0.5 - dl) * 0.2 * 0.7071, 0.009, dfPx);
    float frame = max(dfFill(dEdge - 0.05, dfPx), 1.0 - dfFill(arch + 0.04, dfPx));
    return mix(g, dfTone(s, 3), max(lead, frame));
}

float dfBev(float d, float R) {
    float k = clamp(1.0 - d / R, 0.0, 1.0);
    return k * k * 1.4;
}

vec3 dfPaint(int s, vec2 uv, bool vert, bool alongV) {
    vec2 ruv = alongV ? uv.yx : uv;
    if (s == DF_BRICK) return dfBrick(uv);
    if (s == DF_PLASTER) return dfPlaster(uv);
    if (s == DF_COBBLE || s == DF_GUTTER) return dfStones(s, uv, vec2(0.22, 0.18), 0.06, 0.014, 0.04, 0.0);
    if (s == DF_STONE) return dfStones(s, uv, vec2(0.46, 0.26), 0.07, 0.016, 0.035, 0.45);
    if (s == DF_FLAG) return dfStones(s, uv, vec2(0.9, 0.7), 0.03, 0.01, 0.03, 0.3);
    if (s == DF_ASHLAR) return dfAshlar(uv, s);
    if (s == DF_MARBLE) return dfMarble(uv, s);
    if (s == DF_GRASS) return dfGrass(uv);
    if (s == DF_MUD || s == DF_CRATER) return dfMud(uv, s, !vert);
    if (s == DF_GRAVEL) return dfDots(uv, s, 0.075, 0.016, 0.028);
    if (s == DF_MOSS) return dfDots(uv, s, 0.09, 0.02, 0.035);
    if (s == DF_HAY) return dfStraw(uv, s);
    if (s == DF_RUBBLE) return dfRubble(uv, s);
    if (s == DF_ROOF) return dfTiles(ruv, s, vec2(0.2, 0.22), 0.06);
    if (s == DF_SLATE) return dfTiles(ruv, s, vec2(0.26, 0.17), 0.0);
    if (s == DF_PLANKS) return dfBoards(vert ? uv.yx : uv, s, true);
    if (s == DF_BEAM) return dfBoards(alongV ? uv.yx : uv, s, false);
    if (s == DF_WATER) return dfWater(uv);
    return dfFlat(uv, s);
}

vec3 dfSurface() {
    vec3 p = vDfWPos;
    vec3 n0 = normalize(vDfWNor);
    vec3 an = abs(n0);
    vec3 n;
    vec3 tu;
    vec3 tv;
    if (an.y > 0.5) {
        n = vec3(0.0, sign(n0.y), 0.0);
        tu = vec3(1.0, 0.0, 0.0);
        tv = vec3(0.0, 0.0, -1.0);
    } else if (an.x > 0.5) {
        n = vec3(sign(n0.x), 0.0, 0.0);
        tu = vec3(0.0, 0.0, -n.x);
        tv = vec3(0.0, 1.0, 0.0);
    } else {
        n = vec3(0.0, 0.0, sign(n0.z));
        tu = vec3(n.z, 0.0, 0.0);
        tv = vec3(0.0, 1.0, 0.0);
    }
    dfNW = n;
    float pxA = length(dFdx(p));
    float pxB = length(dFdy(p));
    dfPx = mix(min(pxA, pxB), max(pxA, pxB), 0.4);
    bool vert = an.y <= 0.5;
    float cell = uDfCell;
    vec3 g = (p - uDfOrigin) / cell;
    ivec3 c = ivec3(floor(g - n * 0.5));
    ivec3 iu = ivec3(tu);
    ivec3 iv = ivec3(tv);
    ivec3 inn = ivec3(n);
    float gu = dot(g, tu);
    float gv = dot(g, tv);
    float fu = gu - floor(gu);
    float fv = gv - floor(gv);
    vec2 uv = vec2(dot(p, tu), dot(p, tv));
    int s0 = dfAt(c);
    if (s0 == 0) return vec3(1.0);
    if (s0 == DF_LIT || s0 == DF_PANE) return dfWindow(s0, c, iu, iv, fu, fv);
    if (s0 == DF_GLASS) return dfGlass(c, iu, iv, fu, fv);

    int sPu = dfAt(c + iu);
    int sMu = dfAt(c - iu);
    int sPv = dfAt(c + iv);
    int sMv = dfAt(c - iv);

    // Soft borders: the family field from the 2 x 2 nearest cell centres, warped by noise.
    int s = s0;
    float bInk = 0.0;
    int bl = DF_BLEND[s0];
    if (bl != 0) {
        vec2 wq = vec2(fu, fv) - 0.5 + 0.42 * (vec2(dfN(uv * 2.4), dfN(uv * 2.4 + 9.1)) - 0.5) + 0.12 * (vec2(dfN(uv * 7.0 + 3.0), dfN(uv * 7.0 + 1.0)) - 0.5);
        ivec3 ou = wq.x < 0.0 ? -iu : iu;
        ivec3 ov = wq.y < 0.0 ? -iv : iv;
        vec2 t = clamp(abs(wq), 0.0, 1.0);
        int a = s0;
        int b2 = wq.x < 0.0 ? sMu : sPu;
        int c2 = wq.y < 0.0 ? sMv : sPv;
        int d2 = dfAt(c + ou + ov);
        if (b2 == 0 || (DF_BLEND[b2] & bl) == 0) b2 = s0;
        if (c2 == 0 || (DF_BLEND[c2] & bl) == 0) c2 = s0;
        if (d2 == 0 || (DF_BLEND[d2] & bl) == 0) d2 = s0;
        if (b2 != s0 || c2 != s0 || d2 != s0) {
            float wa = (1.0 - t.x) * (1.0 - t.y);
            float wb = t.x * (1.0 - t.y);
            float wc = (1.0 - t.x) * t.y;
            float wd = t.x * t.y;
            float Wa = wa + (b2 == a ? wb : 0.0) + (c2 == a ? wc : 0.0) + (d2 == a ? wd : 0.0);
            float Wb = wb + (c2 == b2 ? wc : 0.0) + (d2 == b2 ? wd : 0.0);
            float Wc = wc + (d2 == c2 ? wd : 0.0);
            float Wd = wd;
            if (b2 == a) Wb = 0.0;
            if (c2 == a || c2 == b2) Wc = 0.0;
            if (d2 == a || d2 == b2 || d2 == c2) Wd = 0.0;
            float best = Wa;
            float second = 0.0;
            s = a;
            if (Wb > best) { second = best; best = Wb; s = b2; } else second = max(second, Wb);
            if (Wc > best) { second = best; best = Wc; s = c2; } else second = max(second, Wc);
            if (Wd > best) { second = best; best = Wd; s = d2; } else second = max(second, Wd);
            float m = best - second;
            float bd = m * dfPx / max(fwidth(m), 1e-5);
            bInk = dfStroke(bd, 0.009, dfPx);
        }
    }

    // Boards, beams and tiles follow the longer run of their family.
    float runU = float(sPu == s0) + float(sMu == s0);
    float runV = float(sPv == s0) + float(sMv == s0);
    bool alongV = runV > runU;
    if (s == DF_BEAM && vert) alongV = runV >= runU;
    if ((s == DF_ROOF || s == DF_SLATE) && !vert) {
        // rows run along the step's edge; flip so uv.y climbs toward the ridge
        ivec3 e = alongV ? iu : iv;
        int fwd = dfAt(c + ivec3(0, 1, 0) + e);
        int back = dfAt(c + ivec3(0, 1, 0) - e);
        if ((back == DF_ROOF || back == DF_SLATE) && fwd != DF_ROOF && fwd != DF_SLATE) uv = alongV ? vec2(-uv.x, uv.y) : vec2(uv.x, -uv.y);
    }
    vec3 col = dfPaint(s, uv, vert, alongV);
    col = mix(col, dfTone(s, 3), bInk * 0.8);

    // Grime along the foot of walls: a flat darker band with a ragged top.
    if (vert && s != DF_ROOF && s != DF_SLATE && s != DF_WATER) {
        float gh = 0.28 + 0.22 * dfN(vec2(uv.x * 1.4, 2.0)) + 0.06 * dfN(vec2(uv.x * 6.0, 5.0));
        float band = dfFill(p.y - gh, dfPx);
        col *= 1.0 - 0.22 * band;
    }

    // Worn bevel on outer edges: bend the normal so the toon bands catch a rim.
    bool soft = s0 == DF_MUD || s0 == DF_GRASS || s0 == DF_CRATER || s0 == DF_RUBBLE || s0 == DF_HAY || s0 == DF_GRAVEL || s0 == DF_MOSS;
    float R = (soft ? 0.14 : 0.05) * (0.55 + 0.9 * dfN(uv * 3.3 + 1.7));
    vec3 bend = vec3(0.0);
    if (sPu == 0) bend += tu * dfBev((1.0 - fu) * cell, R);
    if (sMu == 0) bend -= tu * dfBev(fu * cell, R);
    if (sPv == 0) bend += tv * dfBev((1.0 - fv) * cell, R);
    if (sMv == 0) bend -= tv * dfBev(fv * cell, R);
    dfNW = normalize(n + bend);

    // Inner corners (a wall meeting the ground): a drawn contact line and a flat shadow band.
    float cav = 1e3;
    if (sPu != 0 && dfAt(c + iu + inn) != 0) cav = min(cav, (1.0 - fu) * cell);
    if (sMu != 0 && dfAt(c - iu + inn) != 0) cav = min(cav, fu * cell);
    if (sPv != 0 && dfAt(c + iv + inn) != 0) cav = min(cav, (1.0 - fv) * cell);
    if (sMv != 0 && dfAt(c - iv + inn) != 0) cav = min(cav, fv * cell);
    if (cav < 0.2) {
        float bw = 0.05 + 0.05 * dfN(uv * 3.0);
        col *= 1.0 - 0.2 * dfFill(cav - bw, dfPx);
        col = mix(col, dfTone(s, 3), dfStroke(cav, 0.008, dfPx) * 0.7);
    }
    return col;
}
`

export interface DfSurfaceOpts {
    /** Metres per map cell. */
    cell: number
}

/** Patches a voxel material (already toon/glow patched) with the hand-drawn world surfaces. */
export function dfPatchWorldSurface<T extends THREE.Material>(m: T, opts: DfSurfaceOpts): T {
    const prev = m.onBeforeCompile
    m.onBeforeCompile = (shader, renderer) => {
        prev.call(m, shader, renderer)
        const d = dfLevelSurfaceData()
        shader.uniforms.uDfCell = { value: opts.cell }
        shader.uniforms.uDfGrid = { value: d.grid }
        shader.uniforms.uDfSize = { value: d.size }
        shader.uniforms.uDfOrigin = { value: [DF_VOX_ORIGIN.x, DF_VOX_ORIGIN.y, DF_VOX_ORIGIN.z] }
        shader.uniforms.uDfTone = { value: d.tones }
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', VERT_HEAD)
            .replace('#include <worldpos_vertex>', VERT_BODY)
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${defines()}\n${FRAG_HEAD}`)
            .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= dfSurface();')
            .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(dfNW, 0.0)).xyz);')
    }
    const prevKey = m.customProgramCacheKey.bind(m)
    m.customProgramCacheKey = () => `dfsurf2|${prevKey()}`
    return m
}
