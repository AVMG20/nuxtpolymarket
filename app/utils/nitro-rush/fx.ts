import * as THREE from 'three'

/** Particle field: one draw call for every spark, or every puff of tyre smoke. */
export class Particles {
    readonly points: THREE.Points
    private readonly max: number
    private readonly pos: Float32Array
    private readonly vel: Float32Array
    private readonly col: Float32Array
    private readonly size: Float32Array
    private readonly alpha: Float32Array
    private readonly life: Float32Array
    private readonly maxLife: Float32Array
    private readonly baseSize: Float32Array
    private readonly gravity: Float32Array
    private readonly drag: Float32Array
    private readonly grow: Float32Array
    private cursor = 0
    private readonly material: THREE.ShaderMaterial

    /** `smoke` draws with normal blending, so dark particles can darken what is behind them. */
    constructor(max = 4000, mode: 'add' | 'smoke' = 'add') {
        this.max = max
        this.pos = new Float32Array(max * 3)
        this.vel = new Float32Array(max * 3)
        this.col = new Float32Array(max * 3)
        this.size = new Float32Array(max)
        this.alpha = new Float32Array(max)
        this.life = new Float32Array(max)
        this.maxLife = new Float32Array(max)
        this.baseSize = new Float32Array(max)
        this.gravity = new Float32Array(max)
        this.drag = new Float32Array(max)
        this.grow = new Float32Array(max)
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
        geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage))
        geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
        geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
        this.material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: mode === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending,
            uniforms: { uScale: { value: 400 }, uPixelRatio: { value: 1 } },
            vertexShader: /* glsl */`
                attribute float aSize;
                attribute float aAlpha;
                attribute vec3 color;
                uniform float uScale;
                uniform float uPixelRatio;
                varying vec3 vColor;
                varying float vAlpha;
                void main() {
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    float px = aSize * uScale / max(0.1, -mv.z);
                    // Never let a spark go sub-pixel: grow it to a floor and dim it by the area it gained.
                    float floorPx = 2.0 * uPixelRatio;
                    float grown = max(px, floorPx);
                    float keep = px / grown;
                    vAlpha = aAlpha * keep * keep;
                    vColor = color;
                    gl_PointSize = grown;
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: /* glsl */`
                varying vec3 vColor;
                varying float vAlpha;
                void main() {
                    vec2 d = gl_PointCoord - 0.5;
                    float r = clamp(1.0 - dot(d, d) * 4.0, 0.0, 1.0);
                    ${mode === 'smoke' ? 'gl_FragColor = vec4(vColor, vAlpha * r * r * 0.6);' : 'gl_FragColor = vec4(vColor * vAlpha * r * r, 1.0);'}
                }`
        })
        this.points = new THREE.Points(geo, this.material)
        this.points.frustumCulled = false
        this.points.renderOrder = 5
    }

    setScale(viewportHeight: number, pixelRatio: number, fovDeg: number) {
        this.material.uniforms.uScale!.value = viewportHeight * pixelRatio / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2))
        this.material.uniforms.uPixelRatio!.value = pixelRatio
    }

    emit(
        x: number, y: number, z: number, count: number,
        o: { color: THREE.Color, speed: number, up?: number, spread?: number, life?: number, size?: number, gravity?: number, drag?: number, vz?: number, jitter?: number, grow?: number, vx?: number }
    ) {
        const spread = o.spread ?? 0.2
        for (let n = 0; n < count; n++) {
            const i = this.cursor
            this.cursor = (this.cursor + 1) % this.max
            const theta = Math.random() * Math.PI * 2
            const phi = Math.acos(2 * Math.random() - 1)
            const sp = o.speed * (0.35 + Math.random() * 0.65)
            this.pos[i * 3] = x + (Math.random() - 0.5) * spread
            this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * spread
            this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread
            this.vel[i * 3] = Math.sin(phi) * Math.cos(theta) * sp + (o.vx ?? 0)
            this.vel[i * 3 + 1] = Math.abs(Math.cos(phi)) * sp * 0.6 + (o.up ?? 0)
            this.vel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * sp + (o.vz ?? 0)
            const j = o.jitter ?? 0.15
            this.col[i * 3] = o.color.r * (1 - j + Math.random() * j * 2)
            this.col[i * 3 + 1] = o.color.g * (1 - j + Math.random() * j * 2)
            this.col[i * 3 + 2] = o.color.b * (1 - j + Math.random() * j * 2)
            const life = (o.life ?? 0.7) * (0.6 + Math.random() * 0.4)
            this.life[i] = life
            this.maxLife[i] = life
            this.baseSize[i] = (o.size ?? 0.25) * (0.6 + Math.random() * 0.8)
            this.gravity[i] = o.gravity ?? 14
            this.drag[i] = o.drag ?? 1.5
            this.grow[i] = o.grow ?? 0
            this.alpha[i] = 1
        }
    }

    update(dt: number) {
        for (let i = 0; i < this.max; i++) {
            if (this.life[i]! <= 0) {
                if (this.alpha[i]! !== 0) {
                    this.alpha[i] = 0
                    this.size[i] = 0
                }
                continue
            }
            this.life[i]! -= dt
            const k = Math.max(0, this.life[i]! / this.maxLife[i]!)
            const damp = Math.exp(-this.drag[i]! * dt)
            this.vel[i * 3]! *= damp
            this.vel[i * 3 + 1]! = this.vel[i * 3 + 1]! * damp - this.gravity[i]! * dt
            this.vel[i * 3 + 2]! *= damp
            this.pos[i * 3]! += this.vel[i * 3]! * dt
            this.pos[i * 3 + 1] = Math.max(0.05, this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt)
            this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt
            this.alpha[i] = k
            // Sparks shrink as they die; smoke and fire billow outward.
            this.size[i] = this.grow[i]! > 0 ? this.baseSize[i]! * (1 + (1 - k) * this.grow[i]!) : this.baseSize[i]! * (0.4 + k * 0.6)
        }
        const g = this.points.geometry
        g.attributes.position!.needsUpdate = true
        g.attributes.color!.needsUpdate = true
        g.attributes.aSize!.needsUpdate = true
        g.attributes.aAlpha!.needsUpdate = true
    }

    clear() {
        this.life.fill(0)
    }

    dispose() {
        this.points.geometry.dispose()
        this.material.dispose()
    }
}

/**
 * Warp streaks: thin camera-facing quads in a tube around the road that rush
 * past faster than the world. They are what sells nitro.
 */
export class SpeedLines {
    readonly mesh: THREE.InstancedMesh
    private readonly count: number
    private readonly data: { angle: number, radius: number, z: number, speed: number }[] = []
    private readonly material: THREE.ShaderMaterial
    private readonly dummy = new THREE.Object3D()

    constructor(count = 140) {
        this.count = count
        const geo = new THREE.PlaneGeometry(1, 1)
        geo.rotateX(-Math.PI / 2)
        this.material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xffffff) } },
            vertexShader: /* glsl */`
                varying float vT;
                void main() {
                    vT = uv.y;
                    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
                }`,
            fragmentShader: /* glsl */`
                uniform float uOpacity;
                uniform vec3 uColor;
                varying float vT;
                void main() {
                    // Bright head toward the camera, tail fading into the distance.
                    float a = clamp(1.0 - vT, 0.0, 1.0);
                    gl_FragColor = vec4(uColor * a * a * uOpacity, 1.0);
                }`
        })
        this.mesh = new THREE.InstancedMesh(geo, this.material, count)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 6
        for (let i = 0; i < count; i++) {
            this.data.push({ angle: Math.random() * Math.PI * 2, radius: 3.5 + Math.random() * 9, z: -Math.random() * 160, speed: 0.8 + Math.random() * 0.6 })
        }
    }

    update(dt: number, speed: number, intensity: number, color: THREE.Color, minWidth: number) {
        this.material.uniforms.uOpacity!.value = intensity
        this.material.uniforms.uColor!.value.copy(color)
        this.mesh.visible = intensity > 0.01
        if (!this.mesh.visible) return
        const len = 2 + speed * 0.12 * (0.5 + intensity)
        for (let i = 0; i < this.count; i++) {
            const d = this.data[i]!
            d.z += speed * 1.7 * d.speed * dt
            if (d.z > 12) {
                d.z = -150 - Math.random() * 40
                d.angle = Math.random() * Math.PI * 2
                d.radius = 3.5 + Math.random() * 9
            }
            const x = Math.cos(d.angle) * d.radius
            const y = 2 + Math.sin(d.angle) * d.radius * 0.7
            this.dummy.position.set(x, Math.max(0.3, y), d.z)
            // Face the streak's broad side toward the road's axis.
            this.dummy.rotation.set(0, 0, Math.atan2(y - 2, x) + Math.PI / 2)
            this.dummy.scale.set(Math.max(minWidth, 0.03), 1, len)
            this.dummy.updateMatrix()
            this.mesh.setMatrixAt(i, this.dummy.matrix)
        }
        this.mesh.instanceMatrix.needsUpdate = true
    }

    dispose() {
        this.mesh.geometry.dispose()
        this.material.dispose()
    }
}

/**
 * A neon ribbon streaming off a tail light. It keeps the light's recent path
 * in world space, one point per short step travelled, and fades along it.
 */
export class LightTrail {
    readonly mesh: THREE.Mesh
    private readonly n: number
    private readonly pts: THREE.Vector3[] = []
    private readonly positions: Float32Array
    private readonly material: THREE.ShaderMaterial

    constructor(color: THREE.Color, n = 48) {
        this.n = n
        for (let i = 0; i < n; i++) this.pts.push(new THREE.Vector3())
        this.positions = new Float32Array(n * 2 * 3)
        const fade = new Float32Array(n * 2)
        const index: number[] = []
        for (let i = 0; i < n; i++) {
            fade[i * 2] = 1 - i / (n - 1)
            fade[i * 2 + 1] = 1 - i / (n - 1)
            if (i < n - 1) {
                const a = i * 2
                index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
            }
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
        geo.setAttribute('aFade', new THREE.BufferAttribute(fade, 1))
        geo.setIndex(index)
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4)
        this.material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            uniforms: { uColor: { value: color.clone() }, uOpacity: { value: 1 } },
            vertexShader: /* glsl */`
                attribute float aFade;
                varying float vFade;
                void main() {
                    vFade = aFade;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
            fragmentShader: /* glsl */`
                uniform vec3 uColor;
                uniform float uOpacity;
                varying float vFade;
                void main() {
                    float f = clamp(vFade, 0.0, 1.0);
                    gl_FragColor = vec4(uColor * f * f * uOpacity, 1.0);
                }`
        })
        this.mesh = new THREE.Mesh(geo, this.material)
        this.mesh.frustumCulled = false
    }

    reset(at: THREE.Vector3) {
        for (const p of this.pts) p.copy(at)
    }

    setColor(c: THREE.Color) {
        this.material.uniforms.uColor!.value.copy(c)
    }

    update(head: THREE.Vector3, opacity: number, width: number, step = 0.8) {
        this.material.uniforms.uOpacity!.value = opacity
        // The head point is live; it's committed to the history once it's a step clear of the last one.
        if (this.pts[1]!.distanceToSquared(head) > step * step) {
            for (let i = this.n - 1; i > 0; i--) this.pts[i]!.copy(this.pts[i - 1]!)
        }
        this.pts[0]!.copy(head)
        for (let i = 0; i < this.n; i++) {
            const p = this.pts[i]!
            const a = this.pts[Math.max(0, i - 1)]!
            const b = this.pts[Math.min(this.n - 1, i + 1)]!
            let dx = a.x - b.x
            let dz = a.z - b.z
            const len = Math.hypot(dx, dz)
            if (len > 1e-4) {
                dx /= len
                dz /= len
            } else {
                dx = 0
                dz = 1
            }
            // Flat on the road plane, across the path.
            const w = width * (1 - i / this.n * 0.6)
            this.positions[i * 6] = p.x - dz * w
            this.positions[i * 6 + 1] = p.y
            this.positions[i * 6 + 2] = p.z + dx * w
            this.positions[i * 6 + 3] = p.x + dz * w
            this.positions[i * 6 + 4] = p.y
            this.positions[i * 6 + 5] = p.z - dx * w
        }
        this.mesh.geometry.attributes.position!.needsUpdate = true
    }

    dispose() {
        this.mesh.geometry.dispose()
        this.material.dispose()
    }
}

/**
 * Tyre marks: a ring buffer of dark quads laid on the track behind each
 * sliding wheel. The oldest marks are recycled once the buffer is full.
 */
export class SkidMarks {
    readonly mesh: THREE.Mesh
    private readonly max: number
    private readonly positions: Float32Array
    private readonly alpha: Float32Array
    private readonly last: (THREE.Vector3 | null)[] = []
    private cursor = 0

    constructor(wheels: number, max = 2400) {
        this.max = max
        this.positions = new Float32Array(max * 4 * 3)
        this.alpha = new Float32Array(max * 4)
        const index = new Uint32Array(max * 6)
        for (let i = 0; i < max; i++) {
            const a = i * 4
            index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6)
        }
        for (let w = 0; w < wheels; w++) this.last.push(null)
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
        geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
        geo.setIndex(new THREE.BufferAttribute(index, 1))
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            vertexShader: /* glsl */`
                attribute float aAlpha;
                varying float vAlpha;
                void main() {
                    vAlpha = aAlpha;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
            fragmentShader: /* glsl */`
                varying float vAlpha;
                void main() {
                    gl_FragColor = vec4(0.02, 0.02, 0.025, vAlpha * 0.6);
                }`
        })
        this.mesh = new THREE.Mesh(geo, material)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 2
    }

    /** Extends wheel `w`'s mark to `at`; `strength` 0 to 1 sets how dark this stretch is. */
    add(w: number, at: THREE.Vector3, strength: number, width = 0.26) {
        const last = this.last[w]
        if (!last) {
            this.last[w] = at.clone()
            return
        }
        const dx = at.x - last.x
        const dz = at.z - last.z
        const len = Math.hypot(dx, dz)
        if (len < 0.35) return
        // A wheel that jumped (a reset) starts a fresh mark rather than a long smear.
        if (len > 6) {
            last.copy(at)
            return
        }
        const nx = -dz / len * width
        const nz = dx / len * width
        const i = this.cursor
        this.cursor = (this.cursor + 1) % this.max
        const y0 = last.y + 0.03
        const y1 = at.y + 0.03
        this.positions.set([
            last.x + nx, y0, last.z + nz, last.x - nx, y0, last.z - nz,
            at.x + nx, y1, at.z + nz, at.x - nx, y1, at.z - nz
        ], i * 12)
        const a = Math.min(1, Math.max(0, strength))
        this.alpha.set([a, a, a, a], i * 4)
        last.copy(at)
        const g = this.mesh.geometry
        g.attributes.position!.needsUpdate = true
        g.attributes.aAlpha!.needsUpdate = true
    }

    /** The wheel stopped sliding: its next mark starts fresh. */
    lift(w: number) {
        this.last[w] = null
    }

    clear() {
        this.alpha.fill(0)
        this.mesh.geometry.attributes.aAlpha!.needsUpdate = true
        for (let w = 0; w < this.last.length; w++) this.last[w] = null
    }

    dispose() {
        this.mesh.geometry.dispose()
        ;(this.mesh.material as THREE.Material).dispose()
    }
}

/** Expanding neon ring on the road: nitro ignition and wall hits. */
export class Shockwaves {
    readonly group = new THREE.Group()
    private readonly rings: { mesh: THREE.Mesh, mat: THREE.MeshBasicMaterial, t: number, dur: number, size: number }[] = []

    constructor(count = 8) {
        const geo = new THREE.RingGeometry(0.82, 1, 48)
        geo.rotateX(-Math.PI / 2)
        for (let i = 0; i < count; i++) {
            const mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
            const mesh = new THREE.Mesh(geo, mat)
            mesh.visible = false
            this.group.add(mesh)
            this.rings.push({ mesh, mat, t: 1, dur: 1, size: 1 })
        }
    }

    fire(x: number, y: number, z: number, color: THREE.Color, size: number, dur = 0.5) {
        const r = this.rings.find(r => r.t >= r.dur) ?? this.rings[0]!
        r.mesh.position.set(x, y, z)
        r.mat.color.copy(color)
        r.t = 0
        r.dur = dur
        r.size = size
        r.mesh.visible = true
    }

    update(dt: number) {
        for (const r of this.rings) {
            if (r.t >= r.dur) {
                r.mesh.visible = false
                continue
            }
            r.t += dt
            const k = Math.min(1, r.t / r.dur)
            const s = r.size * (0.15 + (1 - (1 - k) * (1 - k)) * 0.85)
            r.mesh.scale.setScalar(s)
            r.mat.opacity = (1 - k) * 1.5
        }
    }

    dispose() {
        this.rings[0]?.mesh.geometry.dispose()
        for (const r of this.rings) r.mat.dispose()
    }
}
