// Call of Xeno — pooled visual effects.
//
// Tracers, impact sparks, blood, decals and ejected casings. Everything is
// allocated once at construction and recycled: a firefight at round 30 with an
// RPK should not be creating and disposing hundreds of meshes a second.

import * as THREE from 'three'
import { makeDotTexture, makeSplatTexture } from './textures'

const PARTICLE_VERTEX = /* glsl */`
    attribute float size;
    attribute float alpha;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
        vColor = color;
        vAlpha = alpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (300.0 / max(0.001, -mv.z));
        gl_Position = projectionMatrix * mv;
    }
`

const PARTICLE_FRAGMENT = /* glsl */`
    uniform sampler2D map;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
        vec4 tex = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vColor, vAlpha) * tex;
        if (gl_FragColor.a < 0.01) discard;
    }
`

interface Particle {
    life: number
    maxLife: number
    vx: number
    vy: number
    vz: number
    drag: number
    gravity: number
    size: number
}

/**
 * A fixed-size GPU point cloud driven from the CPU. Dead particles are parked
 * at alpha 0 rather than removed, so the buffers never resize.
 */
class ParticlePool {
    readonly points: THREE.Points
    private geometry: THREE.BufferGeometry
    private material: THREE.ShaderMaterial
    private positions: Float32Array
    private colors: Float32Array
    private sizes: Float32Array
    private alphas: Float32Array
    private state: Particle[]
    private cursor = 0

    constructor(count: number, texture: THREE.Texture, blending: THREE.Blending) {
        this.positions = new Float32Array(count * 3)
        this.colors = new Float32Array(count * 3)
        this.sizes = new Float32Array(count)
        this.alphas = new Float32Array(count)
        this.state = Array.from({ length: count }, () => ({
            life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, drag: 0, gravity: 0, size: 1
        }))

        this.geometry = new THREE.BufferGeometry()
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
        this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
        this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1))
        this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1))

        this.material = new THREE.ShaderMaterial({
            uniforms: { map: { value: texture } },
            vertexShader: PARTICLE_VERTEX,
            fragmentShader: PARTICLE_FRAGMENT,
            transparent: true,
            depthWrite: false,
            blending,
            vertexColors: true
        })

        this.points = new THREE.Points(this.geometry, this.material)
        this.points.frustumCulled = false
    }

    spawn(opts: {
        x: number, y: number, z: number
        vx: number, vy: number, vz: number
        color: THREE.Color
        size: number
        life: number
        gravity?: number
        drag?: number
    }) {
        const i = this.cursor
        this.cursor = (this.cursor + 1) % this.state.length
        const particle = this.state[i]!
        particle.life = opts.life
        particle.maxLife = opts.life
        particle.vx = opts.vx
        particle.vy = opts.vy
        particle.vz = opts.vz
        particle.gravity = opts.gravity ?? 0
        particle.drag = opts.drag ?? 0
        particle.size = opts.size

        this.positions[i * 3] = opts.x
        this.positions[i * 3 + 1] = opts.y
        this.positions[i * 3 + 2] = opts.z
        this.colors[i * 3] = opts.color.r
        this.colors[i * 3 + 1] = opts.color.g
        this.colors[i * 3 + 2] = opts.color.b
        this.sizes[i] = opts.size
        this.alphas[i] = 1
    }

    update(dt: number) {
        let dirty = false
        for (let i = 0; i < this.state.length; i++) {
            const particle = this.state[i]!
            if (particle.life <= 0) continue
            dirty = true
            particle.life -= dt
            if (particle.life <= 0) {
                this.alphas[i] = 0
                continue
            }
            particle.vy -= particle.gravity * dt
            const damp = Math.max(0, 1 - particle.drag * dt)
            particle.vx *= damp
            particle.vy *= damp
            particle.vz *= damp
            const base = i * 3
            this.positions[base] = this.positions[base]! + particle.vx * dt
            this.positions[base + 1] = this.positions[base + 1]! + particle.vy * dt
            this.positions[base + 2] = this.positions[base + 2]! + particle.vz * dt
            const t = particle.life / particle.maxLife
            this.alphas[i] = t
            this.sizes[i] = particle.size * (0.35 + t * 0.65)
        }
        if (!dirty) return
        this.geometry.attributes.position!.needsUpdate = true
        this.geometry.attributes.alpha!.needsUpdate = true
        this.geometry.attributes.size!.needsUpdate = true
        this.geometry.attributes.color!.needsUpdate = true
    }

    dispose() {
        this.geometry.dispose()
        this.material.dispose()
    }
}

interface Tracer {
    mesh: THREE.Mesh
    material: THREE.MeshBasicMaterial
    life: number
    maxLife: number
}

interface Decal {
    mesh: THREE.Mesh
    material: THREE.MeshBasicMaterial
    life: number
    maxLife: number
}

interface Casing {
    mesh: THREE.Mesh
    vx: number
    vy: number
    vz: number
    spin: number
    life: number
}

const UP = new THREE.Vector3(0, 1, 0)
const scratchA = new THREE.Vector3()
const scratchB = new THREE.Vector3()
const scratchQuat = new THREE.Quaternion()

export class CallOfXenoEffects {
    private scene: THREE.Scene
    private sparks: ParticlePool
    private debris: ParticlePool
    private dot: THREE.Texture
    private bloodSplat: THREE.Texture
    private scorch: THREE.Texture
    private tracers: Tracer[] = []
    private decals: Decal[] = []
    private casings: Casing[] = []
    private casingGeo: THREE.BoxGeometry
    private casingMat: THREE.MeshLambertMaterial
    private tracerGeo: THREE.CylinderGeometry
    private decalGeo: THREE.PlaneGeometry
    private color = new THREE.Color()

    constructor(scene: THREE.Scene) {
        this.scene = scene
        this.dot = makeDotTexture()
        this.bloodSplat = makeSplatTexture('#7a0f14')
        this.scorch = makeSplatTexture('#12151a')

        this.sparks = new ParticlePool(500, this.dot, THREE.AdditiveBlending)
        this.debris = new ParticlePool(400, this.dot, THREE.NormalBlending)
        scene.add(this.sparks.points, this.debris.points)

        this.casingGeo = new THREE.BoxGeometry(0.035, 0.035, 0.09)
        this.casingMat = new THREE.MeshLambertMaterial({ color: 0xc9a227 })
        this.tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true)
        this.decalGeo = new THREE.PlaneGeometry(1, 1)
    }

    /** Bright beam from muzzle to impact. Fades over its short life. */
    tracer(from: THREE.Vector3, to: THREE.Vector3, color: number, radius: number, life = 0.07) {
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        })
        const mesh = new THREE.Mesh(this.tracerGeo, material)

        scratchA.copy(to).sub(from)
        const length = scratchA.length()
        if (length < 0.001) { material.dispose(); return }
        mesh.scale.set(radius, length, radius)
        mesh.position.copy(from).addScaledVector(scratchA, 0.5)
        scratchB.copy(scratchA).normalize()
        scratchQuat.setFromUnitVectors(UP, scratchB)
        mesh.quaternion.copy(scratchQuat)

        this.scene.add(mesh)
        this.tracers.push({ mesh, material, life, maxLife: life })
    }

    /** Sparks plus a scorch decal where a round bites into geometry. */
    wallImpact(point: THREE.Vector3, normal: THREE.Vector3) {
        for (let i = 0; i < 7; i++) {
            this.color.setHSL(0.09 + Math.random() * 0.05, 1, 0.6)
            this.sparks.spawn({
                x: point.x, y: point.y, z: point.z,
                vx: normal.x * 2 + (Math.random() - 0.5) * 3.5,
                vy: normal.y * 2 + Math.random() * 3,
                vz: normal.z * 2 + (Math.random() - 0.5) * 3.5,
                color: this.color.clone(),
                size: 0.6 + Math.random() * 0.5,
                life: 0.18 + Math.random() * 0.22,
                gravity: 7,
                drag: 2
            })
        }
        for (let i = 0; i < 4; i++) {
            this.color.setRGB(0.35, 0.35, 0.38)
            this.debris.spawn({
                x: point.x, y: point.y, z: point.z,
                vx: normal.x * 1.2 + (Math.random() - 0.5) * 1.6,
                vy: 0.6 + Math.random() * 1.4,
                vz: normal.z * 1.2 + (Math.random() - 0.5) * 1.6,
                color: this.color.clone(),
                size: 1.4 + Math.random(),
                life: 0.5 + Math.random() * 0.4,
                gravity: 2.4,
                drag: 1.6
            })
        }
        this.decal(point, normal, this.scorch, 0.28 + Math.random() * 0.14, 0.55, 9)
    }

    /** Red mist behind a zombie hit, scaled by how hard the hit was. */
    bloodBurst(point: THREE.Vector3, direction: THREE.Vector3, amount = 1) {
        const count = Math.min(18, Math.round(6 * amount))
        for (let i = 0; i < count; i++) {
            this.color.setRGB(0.45 + Math.random() * 0.25, 0.03, 0.05)
            this.debris.spawn({
                x: point.x, y: point.y, z: point.z,
                vx: direction.x * 2.5 + (Math.random() - 0.5) * 2.6,
                vy: 1 + Math.random() * 2.2,
                vz: direction.z * 2.5 + (Math.random() - 0.5) * 2.6,
                color: this.color.clone(),
                size: 1.6 + Math.random() * 1.6,
                life: 0.4 + Math.random() * 0.45,
                gravity: 6,
                drag: 1.2
            })
        }
    }

    /** A bigger burst plus a floor pool when a zombie goes down. */
    deathBurst(point: THREE.Vector3) {
        for (let i = 0; i < 22; i++) {
            this.color.setRGB(0.4 + Math.random() * 0.3, 0.02, 0.04)
            this.debris.spawn({
                x: point.x, y: point.y + 0.4, z: point.z,
                vx: (Math.random() - 0.5) * 4.5,
                vy: 1.5 + Math.random() * 3,
                vz: (Math.random() - 0.5) * 4.5,
                color: this.color.clone(),
                size: 2 + Math.random() * 2,
                life: 0.6 + Math.random() * 0.5,
                gravity: 7,
                drag: 1
            })
        }
        scratchA.set(point.x, 0.02, point.z)
        this.decal(scratchA, UP, this.bloodSplat, 1 + Math.random() * 0.6, 0.7, 14)
    }

    /** Energy discharge for the wonder weapon. */
    energyBurst(point: THREE.Vector3, color: number) {
        this.color.setHex(color)
        for (let i = 0; i < 16; i++) {
            this.sparks.spawn({
                x: point.x, y: point.y, z: point.z,
                vx: (Math.random() - 0.5) * 5,
                vy: (Math.random() - 0.5) * 5,
                vz: (Math.random() - 0.5) * 5,
                color: this.color.clone(),
                size: 1.4 + Math.random() * 1.4,
                life: 0.28 + Math.random() * 0.3,
                drag: 3
            })
        }
    }

    /** Brass out of the ejection port. Purely decorative, dies after a few seconds. */
    ejectCasing(origin: THREE.Vector3, right: THREE.Vector3) {
        if (this.casings.length > 26) {
            const oldest = this.casings.shift()!
            this.scene.remove(oldest.mesh)
        }
        const mesh = new THREE.Mesh(this.casingGeo, this.casingMat)
        mesh.position.copy(origin)
        this.scene.add(mesh)
        this.casings.push({
            mesh,
            vx: right.x * (1.6 + Math.random()) + (Math.random() - 0.5),
            vy: 1.6 + Math.random(),
            vz: right.z * (1.6 + Math.random()) + (Math.random() - 0.5),
            spin: (Math.random() - 0.5) * 22,
            life: 2.6
        })
    }

    private decal(point: THREE.Vector3, normal: THREE.Vector3, texture: THREE.Texture, size: number, opacity: number, life: number) {
        if (this.decals.length > 46) {
            const oldest = this.decals.shift()!
            this.scene.remove(oldest.mesh)
            oldest.material.dispose()
        }
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4
        })
        const mesh = new THREE.Mesh(this.decalGeo, material)
        mesh.scale.setScalar(size)
        mesh.position.copy(point).addScaledVector(normal, 0.02)
        scratchQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
        mesh.quaternion.copy(scratchQuat)
        mesh.rotateZ(Math.random() * Math.PI * 2)
        this.scene.add(mesh)
        this.decals.push({ mesh, material, life, maxLife: life })
    }

    update(dt: number) {
        this.sparks.update(dt)
        this.debris.update(dt)

        for (let i = this.tracers.length - 1; i >= 0; i--) {
            const tracer = this.tracers[i]!
            tracer.life -= dt
            if (tracer.life <= 0) {
                this.scene.remove(tracer.mesh)
                tracer.material.dispose()
                this.tracers.splice(i, 1)
                continue
            }
            tracer.material.opacity = (tracer.life / tracer.maxLife) * 0.9
        }

        for (let i = this.decals.length - 1; i >= 0; i--) {
            const decal = this.decals[i]!
            decal.life -= dt
            if (decal.life <= 0) {
                this.scene.remove(decal.mesh)
                decal.material.dispose()
                this.decals.splice(i, 1)
                continue
            }
            // Only fade over the last second of life so the floor keeps its mess.
            decal.material.opacity = Math.min(1, decal.life) * (decal.maxLife > 10 ? 0.7 : 0.55)
        }

        for (let i = this.casings.length - 1; i >= 0; i--) {
            const casing = this.casings[i]!
            casing.life -= dt
            if (casing.life <= 0) {
                this.scene.remove(casing.mesh)
                this.casings.splice(i, 1)
                continue
            }
            casing.vy -= 11 * dt
            casing.mesh.position.x += casing.vx * dt
            casing.mesh.position.y += casing.vy * dt
            casing.mesh.position.z += casing.vz * dt
            casing.mesh.rotation.x += casing.spin * dt
            casing.mesh.rotation.z += casing.spin * 0.6 * dt
            if (casing.mesh.position.y < 0.03) {
                casing.mesh.position.y = 0.03
                casing.vy *= -0.32
                casing.vx *= 0.6
                casing.vz *= 0.6
                casing.spin *= 0.5
            }
        }
    }

    /** Drops every live effect — called when a run restarts. */
    clear() {
        for (const tracer of this.tracers) { this.scene.remove(tracer.mesh); tracer.material.dispose() }
        for (const decal of this.decals) { this.scene.remove(decal.mesh); decal.material.dispose() }
        for (const casing of this.casings) this.scene.remove(casing.mesh)
        this.tracers = []
        this.decals = []
        this.casings = []
    }

    dispose() {
        this.clear()
        this.scene.remove(this.sparks.points, this.debris.points)
        this.sparks.dispose()
        this.debris.dispose()
        this.casingGeo.dispose()
        this.casingMat.dispose()
        this.tracerGeo.dispose()
        this.decalGeo.dispose()
        this.dot.dispose()
        this.bloodSplat.dispose()
        this.scorch.dispose()
    }
}
