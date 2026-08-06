<script setup lang="ts">
import * as THREE from 'three'
import type { OpenedPackCard, OpenedPackResult } from '#shared/types/tcg'
import { legacySetOf } from '#shared/utils/tcg/legacy'
import type { LightboxCard } from './TcgCardLightbox.client.vue'
import { ASPECT, resolve, resolveLegacy, makeLoader, makeMaterial, loadCard } from '~/utils/tcg/foil'
import type { FoilUniforms } from '~/utils/tcg/foil'
import { splitRect, roughen } from '~/utils/tcg/tear'
import type { TearPoint } from '~/utils/tcg/tear'

/* Opening a booster pack — a port of pokemonplaatjes/demo/pack.html.
 *
 * The tear is the point: you draw the line yourself, and the wrapper comes
 * apart along it. tear.js does the geometry; everything else exists to make
 * that moment land — the pack breathes before you touch it, the torn-off half
 * bursts into confetti of itself, and the cards come up out of the wreck
 * rather than cutting to a result screen.
 *
 * Two departures from the demo: the contents come from OUR engine (the
 * `result` prop) — the sidecar's /sets/{code}/pack roller is never called —
 * and the ceremony ends on a grid of every card pulled instead of the last
 * card flying off into nothing.
 */

const props = defineProps<{
    result: OpenedPackResult
    plaatjesSetCode: string | null
}>()
const emit = defineEmits<{ close: [] }>()

const stage = ref<HTMLDivElement | null>(null)

// Large single-card viewer over the finale grid. Layers above this overlay
// (z-60 vs z-50); closing it returns to the grid, never the page behind.
const lightboxCard = ref<LightboxCard | null>(null)
function openLightbox(card: OpenedPackCard, event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    lightboxCard.value = {
        origin: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        bundle: card.bundle || null,
        assetNumber: String(card.assetNumber),
        maskKind: card.maskKind,
        foilEffect: card.foilEffect,
        legacySet: card.bundle ? null : legacySetOf(card.plaatjesCardId),
        holo: card.finish === 'holo',
        name: card.name,
        rarity: card.rarity,
        pattern: card.pattern,
        serial: card.serial,
        // Fresh pulls are inspectable immediately: the lightbox fetches this
        // copy's wear spec once its zoom settles.
        copyId: card.copyId
    }
}

// Reactive mirrors of the scene's state machine, for the template.
const phase = ref<'idle' | 'torn' | 'showing' | 'done'>('idle')
const finale = ref(false)
const shownCard = ref<OpenedPackCard | null>(null)
const cardsLeft = ref(0)
const failed = ref(false)
const missed = ref(false)

// Closure hooks the template's buttons reach into the scene through.
let nextFn: () => void = () => {}
let skipFn: () => void = () => {}
let cleanup: (() => void) | null = null

function onNext(e: Event) {
    e.stopPropagation()
    nextFn()
}
function onSkip(e: Event) {
    e.stopPropagation()
    skipFn()
}

onMounted(() => {
    const el = stage.value
    if (!el) return

    // The page behind must not scroll or select while the ceremony is up.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const apiBase = (useRuntimeConfig().public as { pokemonApiBase?: string }).pokemonApiBase
        ?? 'http://127.0.0.1:8080'

    // Set by the artwork once it loads: a real wrapper is 280x512, and
    // guessing its proportions would show as a stretched print.
    const PACK_W = 1.0
    let PACK_H = 1.55
    const CARD_W = 0.82
    const CARD_H = CARD_W / ASPECT

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    // setSize(..., false) leaves the canvas CSS size alone, so it must be
    // pinned to the stage or the DPR-scaled buffer renders at 2x and pushes
    // the scene's center off-screen.
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
    camera.position.z = 3.4

    const ambient = new THREE.AmbientLight(0xffffff, 0.35)
    scene.add(ambient)
    const key = new THREE.DirectionalLight(0xffffff, 2.0)
    key.position.set(-3, 4, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xbcd0ff, 1.0)
    rim.position.set(3, -1, 2)
    scene.add(rim)

    // A near light, for the metal: a point light close to the pack throws a
    // hotspot that slides across the foil as the pack turns. It follows the
    // pointer, so the foil answers to you before you have torn anything.
    const glint = new THREE.PointLight(0xfff6e8, 14, 0, 2)
    glint.position.set(-0.8, 0.9, 1.5)
    scene.add(glint)
    const glintTarget = glint.position.clone()
    let pointerSeen = false

    /* Something for the foil to reflect. Without this the wrapper renders
     * dark: metalness hands part of the albedo to the specular term, and with
     * no environment that term reflects nothing at all. A small room rather
     * than a uniform sky, so the foil has edges to slide across.
     */
    let pmremTarget: THREE.WebGLRenderTarget | null = null
    function buildEnvironment() {
        const env = new THREE.Scene()
        env.background = new THREE.Color(0x0a0a10)
        const panel = (
            color: number, w: number, h: number,
            pos: [number, number, number], rot: [number, number, number] | null,
            gain = 1
        ) => {
            const m = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h),
                new THREE.MeshBasicMaterial({
                    color: new THREE.Color(color).multiplyScalar(gain),
                    side: THREE.DoubleSide
                }))
            m.position.set(...pos)
            if (rot) m.rotation.set(...rot)
            env.add(m)
        }
        panel(0xffffff, 2.4, 1.6, [-4, 4, 4], [Math.PI / 3.4, Math.PI / 4.5, 0], 2.6)
        // Narrow and bright rather than broad and even: a narrow source draws
        // a hard streak that travels as the pack turns, which reads as glimmer.
        panel(0xffffff, 0.22, 9.0, [-1.6, 1.0, 5.0], [0, 0.22, 0.20], 4.5)
        panel(0xdfe8ff, 0.16, 7.0, [1.9, 0.4, 5.0], [0, -0.28, -0.14], 3.8)
        panel(0xfff0d0, 0.14, 6.0, [0.4, 2.2, 5.2], [0, -0.08, 0.62], 3.4)
        panel(0x9fb4e8, 6.0, 0.30, [0, -2.4, 4.0], [0.2, 0, 0], 1.6)
        panel(0x14161f, 12, 12, [0, 0, -8], null, 1)
        const pmrem = new THREE.PMREMGenerator(renderer)
        pmrem.compileEquirectangularShader()
        pmremTarget = pmrem.fromScene(env, 0.01)
        pmrem.dispose()
        env.traverse((o) => {
            if (o instanceof THREE.Mesh) {
                o.geometry.dispose()
                o.material.dispose()
            }
        })
        return pmremTarget.texture
    }
    scene.environment = buildEnvironment()

    /* ---- the wrapper ---------------------------------------------------- */

    // A stand-in wrapper, for sets whose art we do not have: gradient, foil
    // banding, crimped seams and the Poké Ball motif when the CDN has it.
    function wrapperTexture(ball: HTMLImageElement | null) {
        const W = 768
        const H = Math.round(W * PACK_H / PACK_W)
        const cv = document.createElement('canvas')
        cv.width = W
        cv.height = H
        const c = cv.getContext('2d')!

        const g = c.createLinearGradient(0, 0, W, H)
        g.addColorStop(0.00, '#1b2a6b')
        g.addColorStop(0.35, '#3457c8')
        g.addColorStop(0.55, '#7ea6ff')
        g.addColorStop(0.75, '#2f49a8')
        g.addColorStop(1.00, '#16205a')
        c.fillStyle = g
        c.fillRect(0, 0, W, H)

        c.globalAlpha = 0.10
        for (let i = -H; i < W + H; i += 26) {
            c.strokeStyle = i % 52 === 0 ? '#ffffff' : '#8fb2ff'
            c.lineWidth = 10
            c.beginPath()
            c.moveTo(i, 0)
            c.lineTo(i - H, H)
            c.stroke()
        }
        c.globalAlpha = 1

        for (const y of [0, H - 46]) {
            c.fillStyle = 'rgba(255,255,255,0.10)'
            c.fillRect(0, y, W, 46)
            c.strokeStyle = 'rgba(0,0,0,0.35)'
            c.lineWidth = 2
            for (let x = 0; x < W; x += 14) {
                c.beginPath()
                c.moveTo(x, y + 4)
                c.lineTo(x, y + 42)
                c.stroke()
            }
        }

        if (ball) {
            c.globalAlpha = 0.9
            const s = W * 0.42
            c.drawImage(ball, (W - s) / 2, H * 0.30, s, s)
            c.globalAlpha = 1
        }

        c.fillStyle = '#fff'
        c.textAlign = 'center'
        c.font = `700 ${Math.round(W * 0.085)}px system-ui, sans-serif`
        c.letterSpacing = '2px'
        c.fillText('BOOSTER PACK', W / 2, H * 0.18)
        c.font = `600 ${Math.round(W * 0.042)}px system-ui, sans-serif`
        c.globalAlpha = 0.85
        c.fillText((props.plaatjesSetCode ?? 'polynux').toUpperCase(), W / 2, H * 0.235)
        c.globalAlpha = 1
        c.font = `500 ${Math.round(W * 0.030)}px system-ui, sans-serif`
        c.fillText(`${props.result.cards.length} CARDS`, W / 2, H * 0.86)

        const tex = new THREE.CanvasTexture(cv)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
        return tex
    }

    /* The inside of the wrapper: the pack's own silhouette, in matte
     * foil-liner grey. The shape comes from the artwork's alpha; the colour
     * is thrown away, or the print would show through mirrored inside.
     */
    function insideTexture(image: HTMLImageElement | HTMLCanvasElement) {
        const cv = document.createElement('canvas')
        cv.width = (image as HTMLImageElement).naturalWidth || image.width
        cv.height = (image as HTMLImageElement).naturalHeight || image.height
        const c = cv.getContext('2d')!
        c.drawImage(image, 0, 0, cv.width, cv.height)
        c.globalCompositeOperation = 'source-in'
        const g = c.createLinearGradient(0, 0, 0, cv.height)
        g.addColorStop(0, '#c9c9c2')
        g.addColorStop(1, '#9c9c96')
        c.fillStyle = g
        c.fillRect(0, 0, cv.width, cv.height)
        const tex = new THREE.CanvasTexture(cv)
        tex.colorSpace = THREE.SRGBColorSpace
        return tex
    }

    /* "Cut along here." Drawn as its own strip so it sits slightly proud of
     * the foil, catches none of the pack's gloss, and leaves with the wrapper.
     */
    const GUIDE_Y = 0.14 // down from the top, in pack heights

    function tearGuideTexture() {
        const W = 1024
        const H = 96
        const cv = document.createElement('canvas')
        cv.width = W
        cv.height = H
        const c = cv.getContext('2d')!
        const g = c.createLinearGradient(0, 0, 0, H)
        g.addColorStop(0.0, 'rgba(0,0,0,0)')
        g.addColorStop(0.5, 'rgba(0,0,0,0.55)')
        g.addColorStop(1.0, 'rgba(0,0,0,0)')
        c.fillStyle = g
        c.fillRect(0, 0, W, H)
        c.strokeStyle = '#fffdf2'
        c.lineWidth = 15 // thick: this is an instruction
        c.lineCap = 'butt'
        c.setLineDash([46, 30])
        c.beginPath()
        c.moveTo(-10, H / 2)
        c.lineTo(W + 10, H / 2)
        c.stroke()
        const tex = new THREE.CanvasTexture(cv)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
        return tex
    }

    function tearGuide() {
        const h = PACK_H * 0.055
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(PACK_W, h),
            new THREE.MeshBasicMaterial({
                map: tearGuideTexture(), transparent: true, depthWrite: false,
                // Unlit on purpose: a printed line should not glint like foil.
                toneMapped: false
            }))
        mesh.position.set(0, PACK_H * (0.5 - GUIDE_Y), 0.004)
        return mesh
    }

    /** A polygon in pack space as a mesh, with UVs carried over from the wrapper. */
    function wrapperPiece(poly: TearPoint[], face: THREE.Material, back: THREE.Material) {
        const shape = new THREE.Shape()
        shape.moveTo(poly[0]![0], poly[0]![1])
        for (const [x, y] of poly.slice(1)) shape.lineTo(x, y)
        shape.closePath()

        const geo = new THREE.ShapeGeometry(shape)
        // ShapeGeometry lays UVs out in world units; remap so the artwork
        // keeps its place on the pack no matter which piece a point ended up
        // in — this is what makes the print line up across the tear.
        const pos = geo.attributes.position!
        const uv = new Float32Array(pos.count * 2)
        for (let i = 0; i < pos.count; i++) {
            uv[i * 2] = (pos.getX(i) + PACK_W / 2) / PACK_W
            uv[i * 2 + 1] = (pos.getY(i) + PACK_H / 2) / PACK_H
        }
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))

        const group = new THREE.Group()
        group.add(new THREE.Mesh(geo, face))
        const backMesh = new THREE.Mesh(geo, back)
        backMesh.position.z = -0.004
        group.add(backMesh)
        return group
    }

    /* ---- confetti -------------------------------------------------------- */

    /* The torn-off half bursts into shards of itself: every shard is a small
     * quad cut from the wrapper, its UVs taken from where it sat, all moved by
     * one vertex shader so a few hundred pieces stay one draw call.
     */
    const CONFETTI_VERT = /* glsl */`
        attribute vec3 aCentre;
        attribute vec3 aVel;
        attribute vec3 aAxis;
        attribute float aSpin;
        attribute vec2 aCorner;
        uniform float uTime;
        uniform float uGravity;
        uniform vec3 uLight;
        varying vec2 vUv;
        varying float vShade;
        varying float vSpec;

        vec3 spin(vec3 v, vec3 axis, float angle) {
            float c = cos(angle), s = sin(angle);
            return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
        }

        void main() {
            vUv = uv;
            float t = uTime;
            vec3 centre = aCentre + aVel * t - vec3(0.0, 0.5 * uGravity * t * t, 0.0);
            vec3 corner = spin(vec3(aCorner, 0.0), normalize(aAxis), aSpin * t);
            vec3 pos = centre + corner;

            vec3 n = spin(vec3(0.0, 0.0, 1.0), normalize(aAxis), aSpin * t);
            vec3 world = (modelMatrix * vec4(pos, 1.0)).xyz;
            vec3 L = normalize(uLight - world);
            vec3 V = normalize(cameraPosition - world);
            float diff = abs(dot(n, L));
            float spec = pow(abs(dot(n, normalize(L + V))), 48.0);
            vShade = 0.35 + 0.75 * diff;
            vSpec = spec * 2.2;

            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `

    const CONFETTI_FRAG = /* glsl */`
        uniform sampler2D uMap;
        uniform float uFade;
        varying vec2 vUv;
        varying float vShade;
        varying float vSpec;
        void main() {
            vec4 c = texture2D(uMap, vUv);
            if (c.a < 0.5) discard;
            gl_FragColor = vec4(c.rgb * vShade + vec3(vSpec), uFade);
        }
    `

    function pointInPoly(x: number, y: number, poly: TearPoint[]) {
        let inside = false
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const [xi, yi] = poly[i]!
            const [xj, yj] = poly[j]!
            if ((yi > y) !== (yj > y)
                && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
        }
        return inside
    }

    function confettiFromPolygon(poly: TearPoint[], tex: THREE.Texture, count = 220) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (const [x, y] of poly) {
            minX = Math.min(minX, x)
            maxX = Math.max(maxX, x)
            minY = Math.min(minY, y)
            maxY = Math.max(maxY, y)
        }

        // A jittered grid rather than random sampling: pure random clumps,
        // and clumps leave holes that read as gaps before the burst.
        const cols = Math.max(4, Math.round(Math.sqrt(count * (maxX - minX) / (maxY - minY))))
        const rows = Math.max(4, Math.round(count / cols))
        const cw = (maxX - minX) / cols
        const ch = (maxY - minY) / rows
        const size = Math.max(cw, ch) * 0.78

        const centres: TearPoint[] = []
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = minX + (c + 0.5 + (Math.random() - 0.5) * 0.5) * cw
                const y = minY + (r + 0.5 + (Math.random() - 0.5) * 0.5) * ch
                if (pointInPoly(x, y, poly)) centres.push([x, y])
            }
        }
        if (!centres.length) return null

        const n = centres.length
        const pos = new Float32Array(n * 4 * 3)
        const uvs = new Float32Array(n * 4 * 2)
        const corner = new Float32Array(n * 4 * 2)
        const centre = new Float32Array(n * 4 * 3)
        const vel = new Float32Array(n * 4 * 3)
        const axis = new Float32Array(n * 4 * 3)
        const spinA = new Float32Array(n * 4)
        const index: number[] = []
        const h = size / 2
        const offsets: TearPoint[] = [[-h, -h], [h, -h], [h, h], [-h, h]]

        centres.forEach(([cx, cy], i) => {
            const dx = cx
            const dy = cy - minY
            const speed = 0.9 + Math.random() * 0.9
            const v = [dx * 1.6 + (Math.random() - 0.5) * 0.8,
                0.7 + dy * 0.9 + Math.random() * 0.7,
                0.5 + Math.random() * 1.2]
            const a = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]
            for (let k = 0; k < 4; k++) {
                const vi = i * 4 + k
                pos[vi * 3] = cx
                pos[vi * 3 + 1] = cy
                pos[vi * 3 + 2] = 0
                corner[vi * 2] = offsets[k]![0]
                corner[vi * 2 + 1] = offsets[k]![1]
                uvs[vi * 2] = (cx + offsets[k]![0] + PACK_W / 2) / PACK_W
                uvs[vi * 2 + 1] = (cy + offsets[k]![1] + PACK_H / 2) / PACK_H
                centre[vi * 3] = cx
                centre[vi * 3 + 1] = cy
                centre[vi * 3 + 2] = 0
                vel[vi * 3] = v[0]! * speed
                vel[vi * 3 + 1] = v[1]! * speed
                vel[vi * 3 + 2] = v[2]! * speed
                axis[vi * 3] = a[0]!
                axis[vi * 3 + 1] = a[1]!
                axis[vi * 3 + 2] = a[2]!
                spinA[vi] = (Math.random() - 0.5) * 14
            }
            const b = i * 4
            index.push(b, b + 1, b + 2, b, b + 2, b + 3)
        })

        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
        geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2))
        geo.setAttribute('aCentre', new THREE.BufferAttribute(centre, 3))
        geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 3))
        geo.setAttribute('aAxis', new THREE.BufferAttribute(axis, 3))
        geo.setAttribute('aSpin', new THREE.BufferAttribute(spinA, 1))
        geo.setIndex(index)
        // The shards travel far past where they started; a bounding sphere
        // from their resting positions would have them culled mid-flight.
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40)

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uMap: { value: tex }, uTime: { value: 0 },
                uGravity: { value: 2.4 }, uFade: { value: 1 },
                uLight: { value: glint.position }
            },
            vertexShader: CONFETTI_VERT, fragmentShader: CONFETTI_FRAG,
            side: THREE.DoubleSide, transparent: true
        })
        return new THREE.Mesh(geo, mat)
    }

    const load = makeLoader(renderer)
    const packGroup = new THREE.Group()
    scene.add(packGroup)

    let faceMat: THREE.MeshStandardMaterial | null = null
    let backMat: THREE.MeshStandardMaterial | null = null
    let pack: THREE.Group | null = null
    const pieces: THREE.Group[] = [] // the half that keeps the cards
    let confetti: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null
    let bottomSettled = false

    /* ---- the cards ------------------------------------------------------- */

    /* The pack's real contents come from the `result` prop — minted by our
     * engine against its finite print run. The order is the point: the last
     * card out is the one worth waiting for.
     */
    interface CardMeshData {
        uniforms: FoilUniforms
        card: OpenedPackCard
        index: number
        state: 'waiting' | 'up' | 'leaving'
        vel?: THREE.Vector3
        spin?: THREE.Vector3
    }
    type CardMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> & { userData: CardMeshData }
    const cards: CardMesh[] = []

    function buildCards() {
        props.result.cards.forEach((c, i) => {
            const r = c.bundle
                ? resolve({
                    card: c.bundle.split('_en_')[0] ?? c.bundle,
                    num: c.assetNumber,
                    mask: c.maskKind ?? 'wp',
                    effect: ((c.pattern || c.foilEffect) ?? '').toLowerCase(),
                    alt: c.bundle.endsWith('_alt')
                })
                : resolveLegacy({
                    set: legacySetOf(c.plaatjesCardId) ?? '',
                    num: c.assetNumber,
                    holo: c.finish === 'holo'
                })
            const mat = makeMaterial(r.uniforms)
            mat.toneMapped = false
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), mat) as CardMesh
            // Already in place, stacked behind the pack. Nothing moves them
            // into view: the wrapper slides off them, and each swipe takes
            // the top one away — which is what a stack of cards in a wrapper
            // actually does.
            mesh.position.set(0, 0, -0.05 - i * 0.004)
            mesh.visible = false
            mesh.userData = { uniforms: r.uniforms, card: c, index: i, state: 'waiting' }
            scene.add(mesh)
            cards.push(mesh)
            loadCard(load, r, apiBase).catch(() => {})
        })
    }

    /* ---- showing them one at a time -------------------------------------- */

    let shown = -1 // index of the card currently up
    let lastThrow = 1 // which way the last card went, +1 or -1
    const flying: CardMesh[] = []

    // Scale at which the up card fills ~70% of the view height. Depends on
    // the camera fov, which is framed from the pack art's proportions, so it
    // is computed rather than constant.
    function showScale() {
        const viewHeight = 2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.z
        return 0.70 * viewHeight / CARD_H
    }

    function showNext() {
        if (shown >= 0 && cards[shown]) {
            // Thrown the way it was flicked, at the speed it was flicked:
            // the card leaving in the direction your hand went is most of
            // what ties the gesture to the thing on screen.
            const m = cards[shown]!
            m.userData.state = 'leaving'

            // Screen pixels per second into world units per second.
            const perPx = (2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.z)
                / Math.max(1, renderer.domElement.clientHeight)
            // A pointer that stopped before release was a drop, not a throw.
            const stale = performance.now() - flick.t > 140
            let vx = stale ? 0 : flick.vx * perPx
            let vy = stale ? 0 : -flick.vy * perPx // screen y counts downward

            const speed = Math.hypot(vx, vy)
            if (speed < 0.8) {
                // A click, keypress or gentle swipe: send it off the way the
                // last one went so the reveal still has a direction.
                const dir = lastThrow || 1
                vx = dir * 2.2
                vy = 0.5
            } else {
                const scale = Math.min(9, Math.max(1.6, speed)) / speed
                vx *= scale
                vy *= scale
            }
            lastThrow = Math.sign(vx) || 1

            m.userData.vel = new THREE.Vector3(vx, vy + 0.35, 0.5 + Math.random() * 0.3)
            const rate = Math.min(4, Math.hypot(vx, vy) * 0.45)
            m.userData.spin = new THREE.Vector3(
                (Math.random() - 0.5) * rate * 0.6,
                (Math.random() - 0.5) * rate,
                -lastThrow * (0.8 + rate * 0.5))
            flying.push(m)
        }
        shown++
        if (shown >= cards.length) {
            state = 'done'
            phase.value = 'done'
            finale.value = true
            shownCard.value = null
            return
        }
        const m = cards[shown]!
        m.visible = true
        m.userData.state = 'up'
        shownCard.value = m.userData.card
        cardsLeft.value = cards.length - 1 - shown

        // The last card is the one the pack was for, so the room dims for it.
        if (shown === cards.length - 1) dimming = true
    }

    /* ---- drawing the tear ------------------------------------------------ */

    const raycaster = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
    const hit = new THREE.Vector3()
    const ndc = new THREE.Vector2()

    /** Pointer position in pack space, or null if the ray misses the plane. */
    function packPoint(e: PointerEvent): TearPoint | null {
        const box = renderer.domElement.getBoundingClientRect()
        ndc.set(((e.clientX - box.left) / box.width) * 2 - 1,
            -((e.clientY - box.top) / box.height) * 2 + 1)
        raycaster.setFromCamera(ndc, camera)
        return raycaster.ray.intersectPlane(plane, hit) ? [hit.x, hit.y] : null
    }

    let stroke: TearPoint[] = []
    let drawing = false
    let guide: THREE.Line | null = null
    /* The flick: where the pointer was going, and how fast, when let go.
     * Sampled in screen pixels and smoothed — one jittery reading should not
     * decide how hard a card is thrown.
     */
    const flick = { x: 0, y: 0, t: 0, vx: 0, vy: 0 }
    function flickStart(e: PointerEvent) {
        flick.x = e.clientX
        flick.y = e.clientY
        flick.t = performance.now()
        flick.vx = 0
        flick.vy = 0
    }
    function flickMove(e: PointerEvent) {
        const now = performance.now()
        const dt = Math.max(1, now - flick.t)
        flick.vx = flick.vx * 0.35 + ((e.clientX - flick.x) / dt) * 1000 * 0.65
        flick.vy = flick.vy * 0.35 + ((e.clientY - flick.y) / dt) * 1000 * 0.65
        flick.x = e.clientX
        flick.y = e.clientY
        flick.t = now
    }
    // Where the pointer is over the card, for the foil. Card space, not pack space.
    const pointerUv = new THREE.Vector2(0.5, 0.5)

    function removeGuide() {
        if (!guide) return
        scene.remove(guide)
        guide.geometry.dispose()
        const mat = guide.material as THREE.Material
        mat.dispose()
        guide = null
    }

    function showGuide() {
        removeGuide()
        if (stroke.length < 2) return
        const geo = new THREE.BufferGeometry().setFromPoints(
            stroke.map(([x, y]) => new THREE.Vector3(x, y, 0.02)))
        guide = new THREE.Line(geo, new THREE.LineDashedMaterial({
            color: 0xfff2a8, dashSize: 0.035, gapSize: 0.025, transparent: true, opacity: 0.9
        }))
        guide.computeLineDistances()
        scene.add(guide)
    }

    function onPointerDown(e: PointerEvent) {
        flickStart(e)
        if (state !== 'idle') return // only the tear tracks a stroke
        const p = packPoint(e)
        if (!p) return
        drawing = true
        stroke = [p]
        try {
            el!.setPointerCapture(e.pointerId)
        } catch {
            // capture is a nicety, not a requirement
        }
        invalidate()
    }

    function onPointerMove(e: PointerEvent) {
        flickMove(e)
        // The light tracks the pointer whether or not a tear is under way,
        // which is what lets you sweep the highlight across the pack.
        const at = packPoint(e)
        if (at) {
            glintTarget.set(at[0] * 1.6, at[1] * 1.6, 1.5)
            // The up card may be scaled past its natural size (showScale), so
            // the foil-tracking UV divides by its current world extents.
            const cardScale = (shown >= 0 && cards[shown]?.scale.x) || 1
            pointerUv.set(0.5 + at[0] / (CARD_W * cardScale), 0.5 + at[1] / (CARD_H * cardScale))
            pointerSeen = true
            invalidate()
        }
        if (!drawing) return
        const p = packPoint(e)
        if (!p) return
        const last = stroke[stroke.length - 1]!
        // Thin the samples: the roughening wants room to work.
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.02) {
            stroke.push(p)
            if (state === 'idle') showGuide()
            invalidate()
        }
    }

    /* Ending the gesture. Bound to the window rather than the stage, and to
     * pointercancel as well as pointerup: a drag that leaves the window, or
     * that the browser takes over, never delivers pointerup to the element,
     * and the reveal would sit there stranded with `drawing` stuck true.
     */
    function endGesture(cancelled: boolean) {
        const wasDrawing = drawing
        drawing = false
        removeGuide()
        if (cancelled) {
            invalidate()
            return
        }
        // Tearing needs the stroke, so it only runs if we saw the gesture start.
        if (state === 'idle') {
            if (wasDrawing) tear()
            return
        }
        // Advancing does not: any release over the page moves to the next
        // card, whether or not pointerdown reached us.
        if (state === 'showing') showNext()
        invalidate()
    }
    let lastAdvance = 0
    function advance(cancelled: boolean) {
        // One release must not skip two cards: a pointerup and the click that
        // follows it are two events for the same gesture.
        const now = performance.now()
        if (now - lastAdvance < 150) return
        lastAdvance = now
        endGesture(cancelled)
    }
    const onWinPointerUp = () => advance(false)
    const onWinPointerCancel = () => advance(true)
    // And a plain click: whatever swallows the pointer sequence, this survives it.
    const onWinClick = () => {
        if (state === 'showing') advance(false)
    }
    const onWinKeydown = (e: KeyboardEvent) => {
        // The lightbox owns the keyboard while it is up (it also stops the
        // capture-phase Escape itself — this is the belt to that suspender).
        if (lightboxCard.value) return
        if (e.key === 'Escape') {
            e.preventDefault()
            if (finale.value) emit('close')
            else skipFn()
            return
        }
        if (state !== 'showing') return
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
            e.preventDefault()
            showNext()
            invalidate()
        }
    }

    nextFn = () => {
        lastAdvance = 0 // the button is never a duplicate
        endGesture(false)
    }
    skipFn = () => {
        // Straight to the grid: the ceremony is skippable, the cards are not.
        state = 'done'
        phase.value = 'done'
        finale.value = true
        shownCard.value = null
        invalidate()
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onWinPointerUp)
    window.addEventListener('pointercancel', onWinPointerCancel)
    window.addEventListener('click', onWinClick)
    window.addEventListener('keydown', onWinKeydown)

    /* ---- the tear itself ------------------------------------------------- */

    let state: 'idle' | 'torn' | 'showing' | 'done' = 'idle'
    let dimming = false

    function tear() {
        if (!faceMat || !backMat) return
        const rough = roughen(stroke, 0.018, 0.011)
        const split = splitRect(rough, PACK_W, PACK_H)
        removeGuide()
        if (!split) {
            // That stroke missed the pack — the caption asks for another.
            missed.value = true
            invalidate()
            return
        }

        packGroup.visible = false
        const centreOf = (poly: TearPoint[]): TearPoint => {
            let x = 0, y = 0
            for (const p of poly) {
                x += p[0]
                y += p[1]
            }
            return [x / poly.length, y / poly.length]
        }

        // The halves come apart along the tear the player drew, not in random
        // directions. The lower half is the pack the cards still sit in — it
        // slides off the bottom; the upper half bursts into confetti.
        const polys = [split.a, split.b]
        const centres = polys.map(centreOf)
        const bottom = centres[0]![1] <= centres[1]![1] ? 0 : 1

        polys.forEach((poly, i) => {
            const [cx, cy] = centres[i]!
            if (i === bottom) {
                const piece = wrapperPiece(poly, faceMat!, backMat!)
                // Spin about the piece's own centre rather than the pack's.
                piece.children.forEach((m) => {
                    m.position.x -= cx
                    m.position.y -= cy
                })
                piece.position.set(cx, cy, 0)
                // Straight off the bottom of the screen in one move: it
                // uncovers the stack on the way past and keeps going. Tweened
                // rather than thrown — it must arrive at a known place at a
                // known time for the reveal to follow it.
                const topLocal = Math.max(...poly.map(([, py]) => py)) - cy
                const visibleHalf = Math.tan(camera.fov * Math.PI / 360) * camera.position.z
                const total = cy + topLocal + visibleHalf + PACK_H
                piece.userData = {
                    holds: true, t: 0, dur: 1.0, from: cy, drop: total,
                    // How far it must travel before the cards are clear of it,
                    // so the reveal can start then rather than when it leaves.
                    clearAt: (cy + topLocal + CARD_H * 0.5) / total,
                    tilt: (Math.random() - 0.5) * 0.06
                }
                scene.add(piece)
                pieces.push(piece)
            } else {
                // The torn-off half does not fly away as a half — it bursts.
                // The shards start exactly where the piece was, so the first
                // frame still looks like an intact wrapper coming apart.
                confetti = confettiFromPolygon(poly, faceMat!.map!)
                if (confetti) scene.add(confetti)
            }
        })

        state = 'torn'
        phase.value = 'torn'
        cards.forEach((c) => {
            c.visible = true
        })
        invalidate()
    }

    /* ---- the loop -------------------------------------------------------- */

    const clock = new THREE.Clock()
    let pending = 0
    let breathe = 0

    function frame() {
        const dt = Math.min(clock.getDelta(), 0.05)
        let moving = false

        // Eased, so a flick of the mouse sweeps the highlight rather than
        // snapping it, and drifting on its own before anyone has touched it.
        if (!pointerSeen) {
            glintTarget.set(Math.sin(breathe * 0.7) * 1.3,
                0.7 + Math.cos(breathe * 0.5) * 0.5, 1.5)
        }
        glint.position.lerp(glintTarget, 1 - Math.pow(0.001, dt))

        breathe += dt
        if (state === 'idle' && pack) {
            // A slow breath, so the pack reads as an object waiting to be
            // handled rather than a picture of one.
            packGroup.rotation.y = Math.sin(breathe * 0.6) * 0.26
            packGroup.rotation.x = Math.sin(breathe * 0.43) * 0.10
            packGroup.position.y = Math.sin(breathe * 0.5) * 0.012
        }
        if (state === 'idle') moving = true

        for (const piece of pieces) {
            const u = piece.userData
            u.t = Math.min(1, u.t + dt / u.dur)
            // Heavy off the mark, then away: a wrapper pulled down off a
            // stack of cards starts slow against the friction.
            const ease = u.t * u.t
            piece.position.y = u.from - u.drop * ease
            piece.rotation.z = u.tilt * ease
            // The cards are clear of it well before it leaves the frame, and
            // the reveal starts then — waiting for the slide left a dead beat.
            if (ease >= u.clearAt) bottomSettled = true
            if (u.t < 1) moving = true
        }

        if (confetti) {
            const u = confetti.material.uniforms as { uTime: { value: number }, uFade: { value: number } }
            u.uTime.value += dt
            // Thinning out over the last second rather than blinking off.
            u.uFade.value = Math.max(0, 1 - Math.max(0, u.uTime.value - 2.0) / 1.0)
            if (u.uFade.value <= 0) {
                scene.remove(confetti)
                confetti.geometry.dispose()
                confetti.material.dispose()
                confetti = null
            } else {
                moving = true
            }
        }

        // Nothing comes out until the wrapper is down: the first card comes
        // up once the pack has slid clear, each one after waits for a swipe.
        if (state === 'torn' && bottomSettled) {
            state = 'showing'
            phase.value = 'showing'
            showNext()
        }

        if (state === 'showing' || state === 'done') {
            const m = shown >= 0 ? cards[shown] : undefined
            // The card that is up answers to the pointer, so its foil moves
            // while you look at it.
            if (m && m.userData.uniforms) {
                m.userData.uniforms.uPointer.value.lerp(pointerUv, 1 - Math.pow(0.02, dt))
                if (m.userData.uniforms.uTime) m.userData.uniforms.uTime.value += dt
                moving = true
            }
            // With the wrapper out of the way the card no longer has to fit
            // inside a pack silhouette — grow the whole stack until the up
            // card takes ~70% of the view height. Thrown cards keep whatever
            // scale they left at.
            const target = showScale()
            for (const card of cards) {
                if (card.userData.state === 'leaving') continue
                if (Math.abs(card.scale.x - target) > 0.001) {
                    const next = card.scale.x + (target - card.scale.x) * (1 - Math.pow(0.02, dt))
                    card.scale.setScalar(next)
                    moving = true
                }
            }
        }

        for (let i = flying.length - 1; i >= 0; i--) {
            const m = flying[i]!
            const u = m.userData
            u.vel!.y -= 1.6 * dt
            m.position.addScaledVector(u.vel!, dt)
            m.rotation.x += u.spin!.x * dt
            m.rotation.y += u.spin!.y * dt
            m.rotation.z += u.spin!.z * dt
            if (Math.abs(m.position.x) > 6 || m.position.y < -6) {
                scene.remove(m)
                flying.splice(i, 1)
            } else {
                moving = true
            }
        }

        // Before the last card, the room backs off. The card is simply the
        // only thing left lit, which is enough to say it matters.
        const wantKey = dimming ? 0.55 : 2.0
        const wantAmbient = dimming ? 0.10 : 0.35
        if (Math.abs(key.intensity - wantKey) > 0.005) {
            key.intensity += (wantKey - key.intensity) * (1 - Math.pow(0.05, dt))
            ambient.intensity += (wantAmbient - ambient.intensity) * (1 - Math.pow(0.05, dt))
            moving = true
        }

        renderer.render(scene, camera)
        pending = moving && !document.hidden && !finale.value ? requestAnimationFrame(frame) : 0
    }

    function invalidate() {
        if (pending || document.hidden || finale.value) return
        clock.getDelta()
        pending = requestAnimationFrame(frame)
    }
    const onVisibility = () => invalidate()
    document.addEventListener('visibilitychange', onVisibility)

    function size() {
        const w = el!.clientWidth
        const h = el!.clientHeight
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        // Framed by height, so a wide window shows more room around the pack
        // rather than a smaller pack; the confetti gets the space to cross.
        camera.fov = 2 * Math.atan((PACK_H * 0.78) / camera.position.z) * 180 / Math.PI
        camera.updateProjectionMatrix()
    }
    const onResize = () => {
        size()
        invalidate()
    }
    window.addEventListener('resize', onResize)
    size()

    ;(async function start() {
        // The set's own wrapper art if the sidecar has it, drawn otherwise.
        // The artwork carries its silhouette in the alpha channel — crimped
        // top, tapered corners — so the pack can stay a plain rectangle and
        // the torn pieces get the right outline for free.
        let tex: THREE.Texture | null = null
        let real = false
        const code = (props.plaatjesSetCode ?? '').trim()
        for (const candidate of code ? [...new Set([code, code.toLowerCase()])] : []) {
            try {
                const art = await load(`${apiBase}/images/boosters/${candidate}.png`)
                const img = art.image as HTMLImageElement
                PACK_H = PACK_W * (img.naturalHeight / img.naturalWidth)
                art.colorSpace = THREE.SRGBColorSpace
                tex = art
                real = true
                break
            } catch {
                // try the next casing, or fall through to the stand-in
            }
        }
        if (!tex) {
            let ball: HTMLImageElement | null = null
            try {
                ball = (await load(`${apiBase}/images/shared/CN_PokeBall_TCGL-default.png`)).image as HTMLImageElement
            } catch {
                // the wrapper just goes without its motif
            }
            tex = wrapperTexture(ball)
        }
        size() // PACK_H may have changed with the art's proportions

        faceMat = new THREE.MeshStandardMaterial({
            map: tex, roughness: 0.17, metalness: real ? 0.42 : 0.55,
            envMapIntensity: 2.4,
            side: THREE.FrontSide,
            // The alpha is the pack's outline, not a soft edge: tested, not
            // blended — blending would sort the torn halves against each
            // other and flicker where they cross.
            transparent: false, alphaTest: 0.5
        })
        // The inside of a wrapper is matte and pale — seeing it is half the
        // reason the halves read as pieces of a real thing once they tumble.
        backMat = new THREE.MeshStandardMaterial({
            map: insideTexture(tex.image as HTMLImageElement | HTMLCanvasElement),
            roughness: 0.9, metalness: 0.0,
            side: THREE.BackSide, alphaTest: 0.5
        })

        pack = wrapperPiece(
            [[-PACK_W / 2, PACK_H / 2], [-PACK_W / 2, -PACK_H / 2],
                [PACK_W / 2, -PACK_H / 2], [PACK_W / 2, PACK_H / 2]], faceMat, backMat)
        packGroup.add(pack)
        packGroup.add(tearGuide())

        buildCards()
        invalidate()
    })().catch(() => {
        failed.value = true
        finale.value = true
        phase.value = 'done'
    })

    cleanup = () => {
        document.body.style.overflow = prevOverflow
        if (pending) {
            cancelAnimationFrame(pending)
            pending = 0
        }
        el.removeEventListener('pointerdown', onPointerDown)
        el.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onWinPointerUp)
        window.removeEventListener('pointercancel', onWinPointerCancel)
        window.removeEventListener('click', onWinClick)
        window.removeEventListener('keydown', onWinKeydown)
        window.removeEventListener('resize', onResize)
        document.removeEventListener('visibilitychange', onVisibility)

        removeGuide()
        // Everything the scene holds: card planes and their foil textures,
        // wrapper pieces, guide strip, confetti if it is still mid-burst.
        for (const mesh of cards) {
            for (const u of Object.values(mesh.userData.uniforms)) {
                if (u.value instanceof THREE.Texture) u.value.dispose()
            }
            mesh.geometry.dispose()
            mesh.material.dispose()
        }
        scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
                obj.geometry?.dispose()
                const mats: THREE.Material[] = Array.isArray(obj.material) ? obj.material : [obj.material]
                for (const m of mats) {
                    const map = (m as THREE.MeshBasicMaterial).map
                    map?.dispose()
                    m.dispose()
                }
            }
        })
        pmremTarget?.dispose()
        renderer.domElement.remove()
        renderer.dispose()
    }
})

onBeforeUnmount(() => {
    cleanup?.()
    cleanup = null
})

const caption = computed(() => {
    if (failed.value) return null
    if (phase.value === 'idle') {
        return missed.value
            ? 'that stroke missed the pack — drag right across it'
            : 'drag along the dotted line to tear the pack open'
    }
    if (phase.value === 'torn') return 'opened'
    return null
})
</script>

<template>
    <Teleport to="body">
        <div
            class="fixed inset-0 z-50 select-none"
            style="touch-action: none; background: radial-gradient(70% 60% at 50% 35%, #16161f, #08080c 70%)"
        >
            <!-- The stage is the whole window: confetti thrown from the middle
                 of a small canvas hits its edge at once and reads as the
                 pieces evaporating rather than flying off. -->
            <div
                ref="stage"
                class="absolute inset-0 cursor-crosshair transition-opacity duration-700"
                :class="finale ? 'pointer-events-none opacity-0' : 'opacity-100'"
            />

            <!-- Caption -->
            <div
                v-if="!finale"
                class="pointer-events-none fixed inset-x-0 bottom-9 min-h-[1.4em] text-center text-xs text-neutral-400"
            >
                <template v-if="shownCard">
                    <b class="text-neutral-100">{{ shownCard.name }}</b>
                    · {{ shownCard.rarity || '—' }}
                    <template v-if="cardsLeft > 0"> · swipe or click · {{ cardsLeft }} left</template>
                    <template v-else> · that is the pack</template>
                </template>
                <template v-else-if="caption">{{ caption }}</template>
            </div>

            <!-- Next -->
            <button
                v-if="phase === 'showing' && !finale"
                class="fixed bottom-[4.6rem] left-1/2 -translate-x-1/2 cursor-pointer rounded-full border border-neutral-700 bg-neutral-900 px-4 py-2 text-xs font-semibold text-neutral-100 hover:bg-neutral-800"
                @pointerup.stop
                @click.stop="onNext"
            >
                next card
            </button>

            <!-- Skip straight to the grid -->
            <button
                v-if="phase === 'showing' && !finale"
                class="fixed top-4 right-4 cursor-pointer rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-100"
                @pointerup.stop
                @click.stop="onSkip"
            >
                Skip
            </button>

            <!-- Grid finale: every card pulled, all at once. -->
            <div
                v-if="finale"
                class="absolute inset-0 overflow-y-auto"
                style="touch-action: pan-y"
            >
                <div class="mx-auto max-w-5xl px-4 py-8">
                    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 class="text-lg font-semibold text-neutral-100">
                                {{ failed ? 'Pack contents' : 'Pack opened' }}
                            </h2>
                            <p class="text-sm text-neutral-400">
                                {{ result.cards.length }} cards
                            </p>
                        </div>
                        <UBadge
                            v-if="result.isGod"
                            color="warning"
                            variant="subtle"
                            size="lg"
                            icon="i-lucide-sparkles"
                        >
                            god pack — every card a hit
                        </UBadge>
                        <UButton color="neutral" variant="outline" @click.stop="emit('close')">
                            Close
                        </UButton>
                    </div>

                    <div class="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-4">
                        <div
                            v-for="card in result.cards"
                            :key="card.copyId"
                            class="flex cursor-pointer flex-col items-center gap-1.5"
                            @click.stop="openLightbox(card, $event)"
                        >
                            <TcgCard
                                :bundle="card.bundle"
                                :asset-number="String(card.assetNumber)"
                                :mask-kind="card.maskKind ?? 'wp'"
                                :foil-effect="card.foilEffect"
                                :pattern="card.pattern"
                                :legacy-set="card.bundle ? null : legacySetOf(card.plaatjesCardId)"
                                :holo="card.finish === 'holo'"
                                :height="260"
                            />
                            <div class="max-w-[11.5rem] truncate text-sm font-medium text-neutral-100">
                                {{ card.name }}
                            </div>
                            <div class="flex items-center gap-1.5">
                                <UBadge color="neutral" variant="subtle" size="sm">{{ card.rarity || '—' }}</UBadge>
                                <UBadge v-if="card.pattern" color="warning" variant="subtle" size="sm">{{ card.pattern }}</UBadge>
                            </div>
                            <div class="font-mono text-xs tabular-nums text-neutral-400">{{ card.serial }}</div>
                        </div>
                    </div>
                </div>
            </div>

            <TcgCardLightbox
                :card="lightboxCard"
                @close="lightboxCard = null"
            />
        </div>
    </Teleport>
</template>
