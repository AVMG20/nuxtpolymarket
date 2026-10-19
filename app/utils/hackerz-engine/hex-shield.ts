import * as THREE from 'three'
import { hdr, type ModelRig } from './models'

/**
 * A carried shield taking a hit (the Warden's): a white hex-rastered bubble
 * flashes round the unit, the flash running from the shield at its front to its
 * back and fading as it goes. The board and the database turntable share it.
 */

/** How long one pulse takes, and how far the bubble stands off a model with no shield to fit. */
const PULSE_S = 0.45
const MARGIN = 1.25
/**
 * Where the shield's face cuts the bubble, as a fraction of its depth from
 * the middle, and the cross-section there relative to the full bubble
 * (sqrt(1 - RIM²)): the shield's outline is that cross-section.
 */
const RIM = 0.8
const RIM_SHRINK = Math.sqrt(1 - RIM * RIM)

const geometry = new THREE.SphereGeometry(1, 40, 24)

const vertexShader = /* glsl */`
    varying vec3 vLocal;
    varying float vWorldY;
    void main() {
        vLocal = position;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldY = world.y;
        gl_Position = projectionMatrix * viewMatrix * world;
    }`

const fragmentShader = /* glsl */`
    uniform float uT;
    uniform vec3 uColor;
    uniform float uRim;
    uniform float uGround;
    varying vec3 vLocal;
    varying float vWorldY;

    // Distance from a hex cell's centre, in the hex metric (0 at the centre, 0.5 at its edge).
    float hexDistance(vec2 p) {
        vec2 r = vec2(1.0, 1.7320508);
        vec2 h = r * 0.5;
        vec2 a = mod(p, r) - h;
        vec2 b = mod(p - h, r) - h;
        vec2 g = dot(a, a) < dot(b, b) ? a : b;
        g = abs(g);
        return max(dot(g, vec2(0.5, 0.8660254)), g.x);
    }

    void main() {
        // The bubble springs from the shield's rim and wraps back round the
        // unit: nothing in front of the shield, nothing below the ground.
        if (vLocal.z > uRim || vWorldY < uGround) discard;
        // Cylindrical raster round the unit, so the cells stay even across the sides.
        vec2 p = vec2(atan(vLocal.x, vLocal.z) * 2.6, vLocal.y * 4.2);
        float edge = smoothstep(0.43, 0.48, hexDistance(p));
        // 0 at the shield's rim, 1 at the back: the flash sweeps along it.
        float along = (uRim - vLocal.z) / (uRim + 1.0);
        float wave = exp(-pow((along - uT * 1.15) * 5.0, 2.0));
        float fade = 1.0 - uT;
        float glow = edge * (wave * 0.8 + 0.08 * fade) + wave * 0.025;
        gl_FragColor = vec4(uColor * glow * fade, 1.0);
    }`

export class HexShield {
    readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
    private t = 1

    /** `ground` is the floor's world height, where the bubble is cut off. */
    constructor(rig: ModelRig, ground = 0) {
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uT: { value: 1 },
                uColor: { value: hdr(0xffffff, 1.4) },
                uRim: { value: RIM },
                uGround: { value: ground + 0.01 }
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            toneMapped: false
        })
        this.mesh = new THREE.Mesh(geometry, material)
        this.fit(rig)
        this.mesh.visible = false
        rig.root.add(this.mesh)
    }

    /**
     * Sizes the bubble so its cut at the shield's face is the shield's own
     * outline: centred on the shield's middle, wide and tall enough that the
     * ellipsoid passes through the shield's edges, reaching on round the back.
     * Without a shield, it wraps the whole model.
     */
    private fit(rig: ModelRig) {
        const root = rig.root
        root.updateWorldMatrix(true, true)
        const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert()
        const shield = new THREE.Box3()
        for (const part of rig.guardParts) {
            part.geometry.computeBoundingBox()
            shield.union(part.geometry.boundingBox!.clone().applyMatrix4(part.matrixWorld).applyMatrix4(toRoot))
        }
        if (shield.isEmpty()) {
            const size = rig.box.getSize(new THREE.Vector3())
            this.mesh.scale.set(size.x * 0.5 * MARGIN, size.y * 0.5 * MARGIN, size.z * 0.5 * MARGIN)
            this.mesh.position.set(0, size.y * 0.5, 0)
            this.mesh.material.uniforms.uRim!.value = 1
            return
        }
        const centre = shield.getCenter(new THREE.Vector3())
        const half = shield.getSize(new THREE.Vector3()).multiplyScalar(0.5)
        // The shield's face, ahead of the body's middle.
        const face = Math.max(0.05, shield.max.z)
        // At the face the ellipsoid's cross-section is RIM_SHRINK of its full size:
        // make that match the shield, and the face sit at `RIM` of the depth.
        const body = rig.box.getSize(new THREE.Vector3()).multiplyScalar(0.5)
        this.mesh.scale.set(
            Math.max(half.x, body.x * 0.9) / RIM_SHRINK,
            half.y / RIM_SHRINK,
            face / RIM
        )
        this.mesh.position.set(centre.x, centre.y, 0)
    }

    /** A hit on the shield: the flash starts again from the front. */
    pulse() {
        this.t = 0
    }

    update(dt: number) {
        if (this.t >= 1) return
        this.t = Math.min(1, this.t + dt / PULSE_S)
        this.mesh.material.uniforms.uT!.value = this.t
        this.mesh.visible = this.t < 1
    }

    dispose() {
        this.mesh.removeFromParent()
        this.mesh.material.dispose()
    }
}
