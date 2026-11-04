import * as THREE from 'three'
import type { Reflector } from 'three/addons/objects/Reflector.js'
import type { Theme } from './config'
import { concreteTexture } from './textures'
import { buildCity } from './city'
import { buildBarriers, buildRoad, buildTrackside, type WetUniforms } from './world-road'
import { buildSky } from './world-sky'
import { buildBillboards, buildGantries, buildLamps, LAMP_HEIGHT } from './world-venue'
import { worldKit } from './world-kit'
import type { Track } from '#shared/utils/nitro-rush/track'

/**
 * The circuit and everything around it, built once from the track's centreline by the part builders.
 * Randomness here is cosmetic (building sizes and spots), so it uses Math.random.
 */
export class World {
    readonly group = new THREE.Group()
    readonly fog: THREE.FogExp2
    readonly reflector: Reflector
    private readonly disposables: { dispose(): void }[] = []
    private readonly sky: THREE.ShaderMaterial
    private readonly skyGroup: THREE.Group
    private readonly hemi: THREE.HemisphereLight
    private readonly sun: THREE.DirectionalLight
    private readonly lampLens: THREE.MeshStandardMaterial
    private readonly lampPoolMat: THREE.MeshBasicMaterial
    private readonly lampHeads: THREE.Vector3[]
    private readonly beacons: THREE.MeshStandardMaterial
    private readonly starMat: THREE.PointsMaterial
    private readonly startLights: THREE.MeshStandardMaterial[]
    private readonly wetUniforms: WetUniforms
    private readonly hidden: THREE.Object3D[] = []
    private time = 0

    constructor(scene: THREE.Scene, track: Track, reflectionSize: { w: number, h: number }) {
        const kit = worldKit(track, this.group, this.disposables)
        const { own } = kit

        this.fog = new THREE.FogExp2(0x0d0e16, 0.0022)
        scene.fog = this.fog
        this.hemi = new THREE.HemisphereLight(0x4a5070, 0x0c0a0a, 0.4)
        this.sun = new THREE.DirectionalLight(0x9fb4ff, 0.35)
        this.sun.position.set(-30, 60, -80)
        this.group.add(this.hemi, this.sun)

        const road = buildRoad(kit, reflectionSize, this.hidden)
        this.reflector = road.reflector
        this.wetUniforms = road.wetUniforms
        buildTrackside(kit)
        const concrete = own(concreteTexture(150))
        concrete.repeat.set(0.5, 0.5)
        buildBarriers(kit, concrete)
        // Shared by every structure.
        const steel = own(new THREE.MeshStandardMaterial({ color: 0x80848c, roughness: 0.4, metalness: 0.85 }))

        const lamps = buildLamps(kit)
        this.lampLens = lamps.lens
        this.lampPoolMat = lamps.poolMat
        this.lampHeads = lamps.heads
        this.startLights = buildGantries(kit, steel)
        buildBillboards(kit, steel)
        this.beacons = buildCity(kit)

        const sky = buildSky(kit)
        this.sky = sky.sky
        this.starMat = sky.starMat
        this.skyGroup = sky.group
        this.group.add(this.skyGroup)

        scene.add(this.group)
    }

    /** The floodlight head nearest a spot on the road, so a real light can ride along with it; returns how far its pole stands. */
    nearestLamp(x: number, y: number, z: number, out: THREE.Vector3) {
        let best = Infinity
        for (const p of this.lampHeads) {
            const dy = p.y - LAMP_HEIGHT - y
            const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) + dy * dy
            if (d < best) {
                best = d
                out.copy(p)
            }
        }
        return Math.sqrt(best)
    }

    get lampColor() {
        return this.lampLens.emissive
    }

    /** Objects the wet-track mirror should not see (camera-attached effects). */
    hideFromReflection(...objects: THREE.Object3D[]) {
        this.hidden.push(...objects)
    }

    setReflectionSize(w: number, h: number) {
        this.reflector.getRenderTarget().setSize(Math.max(64, Math.round(w)), Math.max(64, Math.round(h)))
    }

    /** Point sprites are sized in drawing-buffer pixels; keep stars at 2 CSS px. */
    setPixelRatio(pr: number) {
        this.starMat.size = 2 * pr
    }

    /** `lit` red lights, or all of them green once the race is on. */
    setStartLights(lit: number, green: boolean) {
        this.startLights.forEach((m, i) => {
            m.emissive.setHex(green ? 0x2bff5a : 0xff1a1a)
            m.emissiveIntensity = green || i < lit ? 6 : 0
        })
    }

    applyTheme(t: Theme, renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
        const u = this.sky.uniforms
        u.uTop!.value.setHex(t.skyTop)
        u.uHorizon!.value.setHex(t.skyHorizon)
        u.uGlow!.value.setHex(t.glow)
        u.uCloud!.value.setHex(t.cloud)
        u.uCloudLight!.value.setHex(t.cloudLight)
        u.uCover!.value = t.cloudCover
        u.uMoon!.value = t.moon
        this.starMat.opacity = t.moon > 0 ? 0.6 * (1 - t.cloudCover * 0.6) : 0
        this.fog.color.setHex(t.fog)
        this.fog.density = t.fogDensity
        this.lampLens.emissive.setHex(t.lamp)
        this.lampPoolMat.color.setHex(t.lamp)
        this.hemi.color.setHex(t.hemiSky)
        this.hemi.groundColor.setHex(t.hemiGround)
        this.hemi.intensity = t.hemi
        this.sun.color.setHex(t.sun)
        this.sun.intensity = t.sunIntensity
        this.sun.position.set(0, t.sunHeight, -100)
        this.wetUniforms.uStrength.value = t.wet
        scene.environmentIntensity = t.env
        renderer.setClearColor(this.fog.color)
    }

    update(dt: number, camera: THREE.Camera) {
        this.time += dt
        this.sky.uniforms.uTime!.value = this.time
        this.skyGroup.position.set(camera.position.x, 0, camera.position.z)
        this.beacons.emissiveIntensity = Math.sin(this.time * 3) > 0.6 ? 5 : 0.3
    }

    dispose() {
        for (const d of this.disposables) d.dispose()
        this.reflector.dispose()
    }
}
