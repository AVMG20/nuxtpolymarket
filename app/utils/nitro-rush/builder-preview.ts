import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildStage, CourseMaterials, endMarker, layCourse, type PreviewCourse } from './builder-course'
import { NEON_PINK } from './config'
import { AdaptiveResolution } from './resolution'
import { ribbon } from './road-geometry'
import { ROAD_TILE_LENGTH } from './textures'
import { worldKit } from './world-kit'
import { Track, type TrackDef } from '#shared/utils/nitro-rush/track'

const FOV = 50
/** Courses smaller than this still frame as if they were this wide, so one section isn't blown up. */
const MIN_RADIUS = 60
const GHOST_COLOR = 0x3df2ff
const GHOST_BLOCKED_COLOR = 0xff3b52
/** Above the road it may overlap when a piece goes in mid-course, and the selection's highlight. */
const GHOST_LIFT = 0.08

/** The track builder's 3D view: the road laid so far with its real walls, deck and pillars, orbited with the mouse or touch. */
export class BuilderPreview {
    private readonly host: HTMLElement
    private readonly renderer: THREE.WebGLRenderer
    private readonly scene = new THREE.Scene()
    private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 8000)
    private readonly controls: OrbitControls
    private readonly resolution = new AdaptiveResolution(window.devicePixelRatio || 1)
    private readonly resizeObserver: ResizeObserver
    private readonly stage: { dispose(): void }
    private readonly mats = new CourseMaterials()
    private readonly selectMat = new THREE.MeshBasicMaterial({ color: NEON_PINK, transparent: true, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false })
    private readonly ghostMat = new THREE.MeshBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: 0.45, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false })
    private readonly raycaster = new THREE.Raycaster()
    private course = new THREE.Group()
    private courseParts: { dispose(): void }[] = []
    private deck: THREE.Mesh | null = null
    private selection: THREE.Mesh | null = null
    private ghost: { track: Track, deck: THREE.Mesh, marker: THREE.Mesh } | null = null
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

        this.stage = buildStage(this.scene, this.renderer)
        this.scene.fog = new THREE.Fog(0x0b0221, 1500, 4000)
        this.scene.add(this.course)

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
        this.deck = layCourse(worldKit(track, this.course, this.courseParts), course, this.mats)
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

    /** Shows the piece about to be built, or nothing; it isn't part of the road, so it survives the road's rebuilds. */
    setGhost(ghost: { def: TrackDef, end: NonNullable<PreviewCourse['end']>, blocked: boolean } | null) {
        this.clearGhost()
        if (ghost) {
            this.ghostMat.color.setHex(ghost.blocked ? GHOST_BLOCKED_COLOR : GHOST_COLOR)
            const track = new Track(ghost.def)
            const deck = new THREE.Mesh(ribbon(track, 0, track.length, -track.wallOffset, track.wallOffset, GHOST_LIFT, ROAD_TILE_LENGTH), this.ghostMat)
            const marker = endMarker(ghost.end, this.mats.markerGeo, this.ghostMat)
            this.scene.add(deck, marker)
            this.ghost = { track, deck, marker }
        }
        if (!this.userMoved) this.frameCourse()
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
        this.clearGhost()
        this.stage.dispose()
        this.mats.dispose()
        this.selectMat.dispose()
        this.ghostMat.dispose()
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

    private clearGhost() {
        if (!this.ghost) return
        this.scene.remove(this.ghost.deck, this.ghost.marker)
        this.ghost.deck.geometry.dispose()
        this.ghost = null
    }

    private frameCourse() {
        const box = new THREE.Box3()
        const tracks = [this.track, this.ghost?.track].filter(t => !!t)
        for (const track of tracks) {
            for (let i = 0; i < track.n; i++) box.expandByPoint(new THREE.Vector3(track.xs[i], track.ys[i], track.zs[i]))
        }
        if (!tracks.length) box.expandByPoint(new THREE.Vector3())
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
