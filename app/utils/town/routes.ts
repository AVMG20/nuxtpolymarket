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
 * carries how far along the line it sits (aDist, for the flowing chevrons) and
 * how far across it (aEdge, 0 on the centre line, ±1 on the rim).
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

/**
 * The route's paint: a solid line with a darker rim, so it reads on pale sand
 * as well as on asphalt, and soft chevrons drifting toward the workshop.
 */
export function townRouteMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color() },
            uTime: { value: 0 },
            uOpacity: { value: 0.95 }
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
            uniform vec3 uColor;
            uniform float uTime;
            uniform float uOpacity;
            varying float vDist;
            varying float vEdge;
            void main() {
                // MSAA can shade just outside the ribbon, so keep the edge in range.
                float e = clamp(abs(vEdge), 0.0, 1.0);
                float aa = max(fwidth(vEdge), 1e-3);
                float alpha = clamp((1.0 - e) / aa, 0.0, 1.0);
                float rim = clamp((e - 0.6) / aa, 0.0, 1.0);
                vec3 col = mix(uColor, uColor * 0.5, rim);
                // Chevrons, centre ahead of the edges, flowing from supplier to workshop.
                float phase = fract((vDist + e * 0.18) / 0.8 - uTime);
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
