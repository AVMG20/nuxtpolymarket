import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LINE_COLORS, NEON_PINK } from './config'
import { AdaptiveResolution } from './resolution'
import { ribbon } from './road-geometry'
import { concreteTexture, gridTexture, ROAD_TILE_LENGTH } from './textures'
import { buildBarriers } from './world-road'
import { worldKit } from './world-kit'
import type { LineBlock } from '#shared/utils/nitro-rush/layout'
import { Track, type TrackDef } from '#shared/utils/nitro-rush/track'

/** The road as the builder has it, to draw in the preview. */
export interface PreviewCourse {
    def: TrackDef
    /** Each line block and the point its line crosses. */
    lines: readonly { type: LineBlock, at: number }[]
    /** Where the next section attaches, unless the loop is closed; heading as layouts give it. */
    end: { x: number, y: number, z: number, heading: number } | null
    /** A loop still open shows where it has to come back to. */
    showOrigin: boolean
}

const GROUND_SIZE = 6000
const GRID_CELL = 10
const FOV = 50
/** Courses smaller than this still frame as if they were this wide, so one section isn't blown up. */
const MIN_RADIUS = 60

/** The track builder's 3D view: the road laid so far with its real walls, deck and pillars, orbited with the mouse or touch. */
export class BuilderPreview {
    private readonly host: HTMLElement
    private readonly renderer: THREE.WebGLRenderer
    private readonly scene = new THREE.Scene()
    private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 8000)
    private readonly controls: OrbitControls
    private readonly resolution = new AdaptiveResolution(window.devicePixelRatio || 1)
    private readonly resizeObserver: ResizeObserver
    private readonly ground: THREE.Mesh
    private readonly concrete = concreteTexture(150)
    private readonly deckMat = new THREE.MeshStandardMaterial({ color: 0x2a2d3c, roughness: 0.85 })
    private readonly selectMat = new THREE.MeshBasicMaterial({ color: NEON_PINK, transparent: true, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false })
    private readonly markerMat = new THREE.MeshBasicMaterial({ color: NEON_PINK })
    private readonly originMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
    private readonly lineMats = Object.fromEntries(Object.entries(LINE_COLORS).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c, polygonOffset: true, polygonOffsetFactor: -1 })])) as Record<LineBlock, THREE.MeshBasicMaterial>
    private readonly markerGeo = new THREE.ConeGeometry(3, 8, 4).rotateX(-Math.PI / 2)
    private readonly raycaster = new THREE.Raycaster()
    private course = new THREE.Group()
    private courseParts: { dispose(): void }[] = []
    private deck: THREE.Mesh | null = null
    private selection: THREE.Mesh | null = null
    private track: Track | null = null
    /** Until the player turns the view themselves, it reframes as the course grows. */
    private userMoved = false
    private raf = 0
    private lastTime = 0

    constructor(host: HTMLElement) {
        this.host = host
        this.renderer = new THREE.WebGLRenderer({ antialias: true })
        this.renderer.outputColorSpace = THREE.SRGBColorSpace
        this.renderer.domElement.style.display = 'block'
        this.renderer.domElement.style.width = '100%'
        this.renderer.domElement.style.height = '100%'
        host.appendChild(this.renderer.domElement)

        this.scene.background = new THREE.Color(0x0b0221)
        this.scene.fog = new THREE.Fog(0x0b0221, 1500, 4000)
        const sun = new THREE.DirectionalLight(0xffffff, 1.6)
        sun.position.set(120, 260, 80)
        this.scene.add(new THREE.HemisphereLight(0x9aa6ff, 0x1a1030, 1.4), sun)

        const grid = gridTexture()
        grid.repeat.set(GROUND_SIZE / GRID_CELL, GROUND_SIZE / GRID_CELL)
        grid.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
        this.ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: grid }))
        this.ground.position.y = -0.05
        this.scene.add(this.ground, this.course)
        this.concrete.repeat.set(0.5, 0.5)

        this.controls = new OrbitControls(this.camera, this.renderer.domElement)
        this.controls.enableDamping = true
        // Never under the ground, where the course would be seen from below the grid.
        this.controls.maxPolarAngle = Math.PI * 0.48
        this.controls.addEventListener('start', () => {
            this.userMoved = true
        })

        this.resizeObserver = new ResizeObserver(() => this.resize())
        this.resizeObserver.observe(host)
        this.resize()
        this.lastTime = performance.now()
        this.raf = requestAnimationFrame(this.frame)
    }

    /** Rebuilds the road; null clears it. */
    setCourse(course: PreviewCourse | null, selected: readonly [number, number] | null) {
        this.clearCourse()
        if (!course) return
        const track = new Track(course.def)
        this.track = track
        const kit = worldKit(track, this.course, this.courseParts)
        // Wall to wall: the game fills the run-off between road and walls with aprons.
        this.deck = kit.add(ribbon(track, 0, track.length, -track.wallOffset, track.wallOffset, 0, ROAD_TILE_LENGTH), this.deckMat)
        buildBarriers(kit, this.concrete)
        for (const line of course.lines) {
            const s = track.cum[Math.min(line.at, track.n - 1)]!
            kit.add(ribbon(track, s - 1.2, s + 1.2, -track.halfWidth, track.halfWidth, 0.02, 2.4), this.lineMats[line.type])
        }
        if (course.end) {
            const marker = new THREE.Mesh(this.markerGeo, this.markerMat)
            marker.position.set(course.end.x, course.end.y + 4, course.end.z)
            // Layout headings turn right with +; three's y rotation turns left.
            marker.rotation.y = -course.end.heading
            this.course.add(marker)
        }
        if (course.showOrigin) {
            const origin = new THREE.Mesh(this.markerGeo, this.originMat)
            origin.position.set(0, 4, 0)
            this.course.add(origin)
        }
        this.setSelected(selected)
        if (!this.userMoved) this.frameCourse()
    }

    /** Highlights the road between two walk points, or nothing. */
    setSelected(range: readonly [number, number] | null) {
        if (this.selection) {
            this.course.remove(this.selection)
            this.selection.geometry.dispose()
            this.selection = null
        }
        const track = this.track
        if (!track || !range) return
        const from = track.cum[Math.min(range[0], track.n)]!
        const to = track.cum[Math.min(range[1], track.n)]!
        if (to - from < 0.5) return
        this.selection = new THREE.Mesh(ribbon(track, from, to, -track.halfWidth, track.halfWidth, 0.04, ROAD_TILE_LENGTH), this.selectMat)
        this.course.add(this.selection)
    }

    /** The walk point under a spot on screen, if it's on the road. */
    pick(clientX: number, clientY: number): number | null {
        const track = this.track
        if (!track || !this.deck) return null
        const rect = this.renderer.domElement.getBoundingClientRect()
        const ndc = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1)
        this.raycaster.setFromCamera(ndc, this.camera)
        const hit = this.raycaster.intersectObject(this.deck)[0]
        if (!hit) return null
        return track.project(hit.point.x, hit.point.z, -1, undefined, hit.point.y).seg
    }

    /** Frames the whole course again and lets it follow the course's growth. */
    resetView() {
        this.userMoved = false
        this.frameCourse()
    }

    dispose() {
        cancelAnimationFrame(this.raf)
        this.resizeObserver.disconnect()
        this.controls.dispose()
        this.clearCourse()
        this.ground.geometry.dispose()
        const groundMat = this.ground.material as THREE.MeshBasicMaterial
        groundMat.map?.dispose()
        groundMat.dispose()
        for (const m of [this.concrete, this.deckMat, this.selectMat, this.markerMat, this.originMat, this.markerGeo, ...Object.values(this.lineMats)]) m.dispose()
        // Each switch to 3D makes a context; browsers cap them, so free this one now rather than at GC.
        this.renderer.forceContextLoss()
        this.renderer.dispose()
        this.renderer.domElement.remove()
    }

    private clearCourse() {
        this.setSelected(null)
        this.scene.remove(this.course)
        for (const d of this.courseParts) d.dispose()
        this.courseParts = []
        this.course = new THREE.Group()
        this.scene.add(this.course)
        this.deck = null
        this.track = null
    }

    private frameCourse() {
        const box = new THREE.Box3()
        const track = this.track
        if (track) {
            for (let i = 0; i < track.n; i++) box.expandByPoint(new THREE.Vector3(track.xs[i], track.ys[i], track.zs[i]))
        } else {
            box.expandByPoint(new THREE.Vector3())
        }
        const centre = box.getCenter(new THREE.Vector3())
        const radius = Math.max(MIN_RADIUS, box.getSize(new THREE.Vector3()).length() / 2)
        const distance = radius / Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * 1.05
        // From the south-east, a little over half way up: plan and heights both read.
        const dir = new THREE.Vector3().setFromSphericalCoords(1, 0.95, 0.6)
        this.controls.target.copy(centre)
        this.camera.position.copy(centre).addScaledVector(dir, distance)
        this.controls.maxDistance = distance * 4
        this.controls.update()
    }

    private resize() {
        const w = Math.max(1, this.host.clientWidth)
        const h = Math.max(1, this.host.clientHeight)
        this.renderer.setPixelRatio(this.resolution.ratio)
        this.renderer.setSize(w, h, false)
        this.camera.aspect = w / h
        this.camera.updateProjectionMatrix()
    }

    private readonly frame = (now: number) => {
        this.raf = requestAnimationFrame(this.frame)
        const dt = Math.min(0.1, (now - this.lastTime) / 1000)
        this.lastTime = now
        if (this.resolution.sample(dt, now / 1000)) this.resize()
        this.controls.update(dt)
        this.renderer.render(this.scene, this.camera)
    }
}
