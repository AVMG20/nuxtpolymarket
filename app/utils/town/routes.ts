import * as THREE from 'three'

/** A point on the ground, in world units. */
export interface TownRoutePoint { x: number, z: number }

const EPS = 1e-4

/** Drop repeated points and the ones a straight run passes through, so only real corners remain. */
function townRouteCorners(points: TownRoutePoint[]): TownRoutePoint[] {
    const out: TownRoutePoint[] = []
    for (const p of points) {
        const b = out[out.length - 1]
        if (b && Math.hypot(p.x - b.x, p.z - b.z) < EPS) continue
        const a = out[out.length - 2]
        if (a && b) {
            const cross = (b.x - a.x) * (p.z - b.z) - (b.z - a.z) * (p.x - b.x)
            const dot = (b.x - a.x) * (p.x - b.x) + (b.z - a.z) * (p.z - b.z)
            if (Math.abs(cross) < EPS && dot > 0) {
                out[out.length - 1] = p
                continue
            }
        }
        out.push(p)
    }
    return out
}

/**
 * A road route as a smooth line: straight runs between corners, each corner
 * rounded off by a short curve. A corner may eat at most half of a segment it
 * shares with another corner, so two turns one tile apart never overlap.
 */
export function townRouteCurve(points: TownRoutePoint[], radius = 0.35, segments = 6): TownRoutePoint[] {
    const pts = townRouteCorners(points)
    if (pts.length < 3) return pts
    const out: TownRoutePoint[] = [pts[0]!]
    for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1]!
        const b = pts[i]!
        const c = pts[i + 1]!
        const lin = Math.hypot(b.x - a.x, b.z - a.z)
        const lout = Math.hypot(c.x - b.x, c.z - b.z)
        const r = Math.min(radius, i === 1 ? lin * 0.95 : lin / 2, i === pts.length - 2 ? lout * 0.95 : lout / 2)
        const p0 = { x: b.x - (b.x - a.x) / lin * r, z: b.z - (b.z - a.z) / lin * r }
        const p1 = { x: b.x + (c.x - b.x) / lout * r, z: b.z + (c.z - b.z) / lout * r }
        for (let s = 0; s <= segments; s++) {
            const t = s / segments
            const u = 1 - t
            out.push({
                x: u * u * p0.x + 2 * u * t * b.x + t * t * p1.x,
                z: u * u * p0.z + 2 * u * t * b.z + t * t * p1.z
            })
        }
    }
    out.push(pts[pts.length - 1]!)
    return townRouteCorners(out)
}

/**
 * A flat ribbon along a line, with round caps, lying at height y. Each vertex
 * carries how far along the line it sits (aDist, for the colour bands and the
 * flowing chevrons) and how far across it (aEdge, 0 on the centre line, ±1 on
 * the rim).
 */
export function townRouteRibbon(line: TownRoutePoint[], halfWidth: number, y: number, capSegments = 8): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry()
    if (line.length < 2) return geo
    const pos: number[] = []
    const dist: number[] = []
    const edge: number[] = []
    const index: number[] = []
    const vert = (x: number, z: number, d: number, e: number) => {
        pos.push(x, y, z)
        dist.push(d)
        edge.push(e)
        return pos.length / 3 - 1
    }
    const dir = (a: TownRoutePoint, b: TownRoutePoint) => {
        const l = Math.hypot(b.x - a.x, b.z - a.z)
        return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }
    }

    let d = 0
    let prev: [number, number] | null = null
    for (let i = 0; i < line.length; i++) {
        const p = line[i]!
        if (i > 0) d += Math.hypot(p.x - line[i - 1]!.x, p.z - line[i - 1]!.z)
        const tin = i > 0 ? dir(line[i - 1]!, p) : null
        const tout = i < line.length - 1 ? dir(p, line[i + 1]!) : null
        const t = tin && tout ? { x: tin.x + tout.x, z: tin.z + tout.z } : (tin ?? tout)!
        const tl = Math.hypot(t.x, t.z) || 1
        // Miter: widen at a bend so the ribbon keeps its width across it.
        const nx = -t.z / tl
        const nz = t.x / tl
        const seg = tin ?? tout!
        const miter = halfWidth / Math.max(0.5, nx * -seg.z + nz * seg.x)
        const l = vert(p.x + nx * miter, p.z + nz * miter, d, -1)
        const r = vert(p.x - nx * miter, p.z - nz * miter, d, 1)
        if (prev) index.push(prev[0], prev[1], l, prev[1], r, l)
        prev = [l, r]
    }

    // Round caps: a fan of half a disc beyond each end.
    const cap = (p: TownRoutePoint, back: { x: number, z: number }, along: { x: number, z: number }, d0: number) => {
        const centre = vert(p.x, p.z, d0, 0)
        const nx = -back.z
        const nz = back.x
        let last = -1
        for (let s = 0; s <= capSegments; s++) {
            const a = Math.PI * s / capSegments
            const ox = (nx * Math.cos(a) + back.x * Math.sin(a)) * halfWidth
            const oz = (nz * Math.cos(a) + back.z * Math.sin(a)) * halfWidth
            const v = vert(p.x + ox, p.z + oz, d0 + ox * along.x + oz * along.z, 1)
            if (last >= 0) index.push(centre, last, v)
            last = v
        }
    }
    const t0 = dir(line[0]!, line[1]!)
    const t1 = dir(line[line.length - 2]!, line[line.length - 1]!)
    cap(line[0]!, { x: -t0.x, z: -t0.z }, t0, 0)
    cap(line[line.length - 1]!, t1, t1, d)

    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1))
    geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1))
    geo.setIndex(index)
    geo.computeBoundingSphere()
    return geo
}

/** Route colours: the whole load arrives, part of it is lost on the road, most of it is. */
export const TOWN_ROUTE_COLORS = [0x2ecc71, 0xf39c12, 0xe74c3c] as const

/**
 * Which band a delivery that has travelled this many road tiles falls in:
 * 0 while it still arrives in full, 1 for the first half of the falloff, 2 for
 * the rest. Banded rather than blended, so the tile where a route turns orange
 * says exactly how far past full range the supplier stands.
 */
export function townRouteBand(tiles: number, fullTiles: number, falloffTiles: number): 0 | 1 | 2 {
    if (tiles <= fullTiles) return 0
    return tiles <= townRouteRedFrom(fullTiles, falloffTiles) ? 1 : 2
}

/** The last tile still drawn orange. */
function townRouteRedFrom(fullTiles: number, falloffTiles: number) {
    return fullTiles + Math.max(1, Math.floor((falloffTiles - fullTiles) / 2))
}

/**
 * Where a ribbon's distance (aDist) sits in road tiles. The line runs past both
 * doors into the buildings and its corners are rounded, so its length is not
 * the tile count: `start` and `end` are the distances at the supplier's door
 * and the workshop's, and the stretch between them is spread over `tiles`.
 */
export interface TownRouteSpan { start: number, end: number, tiles: number, fullTiles: number, falloffTiles: number }

/** Total length of a line, as townRouteRibbon measures it. */
export function townRouteLength(line: TownRoutePoint[]): number {
    let d = 0
    for (let i = 1; i < line.length; i++) d += Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.z - line[i - 1]!.z)
    return d
}

/**
 * The route's paint: a solid line with a darker rim, so it reads on pale sand
 * as well as on asphalt, banded green, orange and red by how far the road reaches
 * back from the workshop, with soft chevrons drifting toward it.
 */
export function townRouteMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            uColors: { value: TOWN_ROUTE_COLORS.map(c => new THREE.Color(c)) },
            /** Distance at the workshop's door, and road tiles per unit of distance back from it. */
            uEnd: { value: 0 },
            uScale: { value: 1 },
            uTiles: { value: 0 },
            /** Band edges in road tiles: half a tile past the last green and the last orange tile. */
            uOrangeAt: { value: 0.5 },
            uRedAt: { value: 1.5 },
            uTime: { value: 0 },
            // Opaque, so routes stacked on a shared road read as one line.
            uOpacity: { value: 1 }
        },
        vertexShader: /* glsl */ `
            attribute float aDist;
            attribute float aEdge;
            varying float vDist;
            varying float vEdge;
            void main() {
                vDist = aDist;
                vEdge = aEdge;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */ `
            uniform vec3 uColors[3];
            uniform float uEnd;
            uniform float uScale;
            uniform float uTiles;
            uniform float uOrangeAt;
            uniform float uRedAt;
            uniform float uTime;
            uniform float uOpacity;
            varying float vDist;
            varying float vEdge;
            void main() {
                // MSAA can shade just outside the ribbon, so keep the edge in range.
                float e = clamp(abs(vEdge), 0.0, 1.0);
                float aa = max(fwidth(vEdge), 1e-3);
                float alpha = clamp((1.0 - e) / aa, 0.0, 1.0);
                // Road tiles back from the workshop: green where the mayor clicked,
                // reddening toward a far supplier. Routes sharing a road are the
                // same distance out on every shared tile, so they agree on colour
                // and merge into one line. The stubs take their door's colour.
                float back = uEnd - vDist;
                float tiles = clamp(back * uScale, 0.0, uTiles);
                // A short fade, about a third of a tile, so the band edge stays crisp.
                float soft = max(fwidth(tiles), 0.15);
                vec3 base = mix(uColors[0], uColors[1], smoothstep(uOrangeAt - soft, uOrangeAt + soft, tiles));
                base = mix(base, uColors[2], smoothstep(uRedAt - soft, uRedAt + soft, tiles));
                float rim = clamp((e - 0.6) / aa, 0.0, 1.0);
                vec3 col = mix(base, base * 0.5, rim);
                // Chevrons, centre ahead of the edges, flowing toward the workshop.
                // Counted back from it too, so stacked routes keep them in step.
                float phase = fract((back - e * 0.18) / 0.8 + uTime);
                float chev = smoothstep(0.0, 0.06, phase) * (1.0 - smoothstep(0.16, 0.3, phase));
                col = mix(col, vec3(1.0), chev * 0.5 * (1.0 - rim));
                gl_FragColor = vec4(col, alpha * uOpacity);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
    })
}

/** Point a route's material at its span of road. */
export function townRouteSetSpan(mat: THREE.ShaderMaterial, span: TownRouteSpan) {
    const u = mat.uniforms
    u.uEnd!.value = span.end
    u.uScale!.value = span.tiles / Math.max(1e-3, span.end - span.start)
    u.uTiles!.value = span.tiles
    u.uOrangeAt!.value = span.fullTiles + 0.5
    u.uRedAt!.value = townRouteRedFrom(span.fullTiles, span.falloffTiles) + 0.5
}
