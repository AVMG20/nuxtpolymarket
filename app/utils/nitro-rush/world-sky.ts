import * as THREE from 'three'
import { skylineTexture } from './textures'
import type { WorldKit } from './world-kit'

const SkyShader = {
    vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */`
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uGlow;
        uniform vec3 uCloud;
        uniform vec3 uCloudLight;
        uniform float uCover;
        uniform float uMoon;
        uniform vec3 uMoonDir;
        uniform float uTime;
        varying vec3 vDir;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
            float v = 0.0;
            float a = 0.5;
            for (int i = 0; i < 5; i++) {
                v += a * noise(p);
                p *= 2.03;
                a *= 0.5;
            }
            return v;
        }

        void main() {
            vec3 d = normalize(vDir);
            float h = clamp(d.y, 0.0, 1.0);
            float k = clamp(1.0 - h * 2.4, 0.0, 1.0);
            vec3 col = mix(uTop, uHorizon, k * k);
            // City light pollution hugging the horizon.
            float glow = clamp(1.0 - h * 7.0, 0.0, 1.0);
            col += uGlow * glow * glow * 0.6;

            // Moon and its halo. Powers by repeated squaring: no pow() on a value that could go negative.
            float md = clamp(dot(d, normalize(uMoonDir)), 0.0, 1.0);
            float disc = smoothstep(0.99955, 0.9997, md);
            float halo = md * md;
            halo = halo * halo;
            halo = halo * halo;
            halo = halo * halo * halo;
            col += vec3(0.95, 0.96, 1.0) * disc * 1.6 * uMoon + vec3(0.5, 0.55, 0.7) * halo * 0.25 * uMoon;

            // Clouds: projected onto a flat layer, lit from below by the city.
            vec2 cp = d.xz / max(d.y + 0.08, 0.02) * 0.6 + vec2(uTime * 0.01, uTime * 0.004);
            float n = fbm(cp);
            float cover = smoothstep(1.0 - uCover, 1.0 - uCover + 0.35, n);
            float under = clamp(1.0 - h * 3.0, 0.0, 1.0);
            vec3 cloud = mix(uCloud, uCloudLight, under * 0.8 + n * 0.3);
            float fade = smoothstep(0.0, 0.08, d.y);
            col = mix(col, cloud, cover * fade * 0.92);
            gl_FragColor = vec4(col, 1.0);
        }`
}

/** Sky dome, far skyline and stars, in a group that rides with the camera. */
export function buildSky({ own }: WorldKit) {
    const group = new THREE.Group()
    const sky = own(new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
            uTop: { value: new THREE.Color() },
            uHorizon: { value: new THREE.Color() },
            uGlow: { value: new THREE.Color() },
            uCloud: { value: new THREE.Color() },
            uCloudLight: { value: new THREE.Color() },
            uCover: { value: 0.5 },
            uMoon: { value: 1 },
            uMoonDir: { value: new THREE.Vector3(0.35, 0.32, -1) },
            uTime: { value: 0 }
        },
        vertexShader: SkyShader.vertexShader,
        fragmentShader: SkyShader.fragmentShader
    }))
    const skyMesh = new THREE.Mesh(own(new THREE.SphereGeometry(950, 48, 24)), sky)
    skyMesh.renderOrder = -10
    const skylineTex = own(skylineTexture())
    skylineTex.wrapS = THREE.RepeatWrapping
    skylineTex.repeat.set(5, 1)
    const skyline = new THREE.Mesh(
        own(new THREE.CylinderGeometry(880, 880, 300, 64, 1, true)),
        own(new THREE.MeshBasicMaterial({ map: skylineTex, transparent: true, fog: false, depthWrite: false, side: THREE.BackSide }))
    )
    skyline.position.y = 130
    skyline.renderOrder = -8
    const starPos: number[] = []
    for (let i = 0; i < 900; i++) {
        const theta = Math.random() * Math.PI * 2
        const y = 0.25 + Math.random() * 0.75
        const r = Math.sqrt(1 - y * y)
        starPos.push(Math.cos(theta) * r * 900, y * 900, Math.sin(theta) * r * 900)
    }
    const starGeo = own(new THREE.BufferGeometry())
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
    const starMat = own(new THREE.PointsMaterial({ color: 0xdfe6ff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.6, depthWrite: false }))
    const stars = new THREE.Points(starGeo, starMat)
    stars.renderOrder = -9
    group.add(skyMesh, skyline, stars)
    return { sky, starMat, group }
}
