<script setup lang="ts">
import * as THREE from 'three'
import { BUILDINGS, RESOURCES, TICK, UNITS, WALL_RANGE_BONUS, BLOODMOON_AT, type BuildingKind, type UpgradeId } from '#shared/utils/holdfast/config'
import { HOLDFAST_WIN_MS, type HoldfastDifficulty, type HoldfastRunStats } from '#shared/utils/holdfast/meta'
import { HoldfastBot } from '#shared/utils/holdfast/bot'
import { ENEMY, HoldfastSim, PLAYER, WALL_HEIGHT, type SimEvent } from '#shared/utils/holdfast/sim'
import HoldfastEnd from '~/components/holdfast/HoldfastEnd.vue'
import HoldfastLobby from '~/components/holdfast/HoldfastLobby.vue'
import HoldfastSelection from '~/components/holdfast/HoldfastSelection.vue'
import HoldfastToolbar from '~/components/holdfast/HoldfastToolbar.vue'
import { HoldfastAudio, type HoldfastSound } from '~/utils/holdfast/audio'
import { randomInt } from '#shared/utils/random'
import { formatHoldfastTime } from '~/utils/holdfast/format'
import { HoldfastMinimap } from '~/utils/holdfast/minimap'
import { HoldfastRenderer, pickPlayerUnit, type Ghost, type Selection } from '~/utils/holdfast/renderer'
import { RESOURCE_META, shortAmount, TOOLBAR, type Tool, type ToolbarItem } from '~/utils/holdfast/ui'

interface FinishResult {
    survivedMs: number
    won: boolean
    clamped: boolean
    best: number | null
    rank: number | null
}

const toast = useToast()

const phase = ref<'lobby' | 'playing' | 'ended'>('lobby')
const starting = ref(false)
const viewport = ref<HTMLDivElement | null>(null)
const minimapCanvas = ref<HTMLCanvasElement | null>(null)
const lobby = ref<InstanceType<typeof HoldfastLobby> | null>(null)

let sim: HoldfastSim | null = null
let renderer: HoldfastRenderer | null = null
let minimap: HoldfastMinimap | null = null
const audio = new HoldfastAudio()
let raf = 0
let keeper: ReturnType<typeof setInterval> | null = null
let lastFrame = 0
let acc = 0
let runId: string | null = null
let difficulty: HoldfastDifficulty = 'easy'

const simRef = shallowRef<HoldfastSim | null>(null)
const version = ref(0)
const speed = ref(1)
const muted = ref(false)
const tool = ref<Tool>(null)
const selection = ref<Selection>(null)
const upgradesOpen = ref(false)
const surrenderOpen = ref(false)
const isFullscreen = ref(false)

const hud = reactive({
    time: 0,
    wave: 0,
    nextWaveIn: 0,
    pending: false,
    warband: false,
    keepHp: 1,
    keepMax: 1,
    keepLevel: 1,
    packs: 0,
    packCap: 3,
    bloodmoon: false,
    enemies: 0,
    res: { gold: 0, wood: 0, stone: 0, crystal: 0 } as Record<string, number>,
    rates: { gold: 0, wood: 0, stone: 0, crystal: 0 } as Record<string, number>
})

const banner = ref<{ id: number, title: string, sub?: string, tone: 'info' | 'danger' | 'gold' } | null>(null)
let bannerTimer: ReturnType<typeof setTimeout> | null = null
let bannerId = 0
const cursorLabel = ref<{ x: number, y: number, text: string, bad: boolean } | null>(null)
const indicators = shallowRef<{ key: string, x: number, y: number, angle: number, kind: 'enemy' | 'keep', count: number }[]>([])
const touchConfirm = ref<{ x: number, y: number } | null>(null)
const pops = ref<{ id: number, x: number, y: number, text: string, icon: string, color: string }[]>([])
let popId = 0
let incomeAt = 0

/** Little "+18" floaters over producing buildings, every few seconds. */
function incomePops() {
    const s = sim
    const r = renderer
    if (!s || !r || r.rig.dist > 48) return
    if (s.time - incomeAt < 5) return
    incomeAt = s.time
    const mult = 1 + 0.15 * s.upgrades.prosperity
    for (const b of s.buildings) {
        const prod = BUILDINGS[b.kind].produces
        if (!prod) continue
        const amount = Math.round((prod.rate[b.level - 1] ?? 0) * mult * 5)
        if (amount <= 0) continue
        const p = r.project(b.cx + b.size / 2, 2.2, b.cz + b.size / 2)
        if (!p.visible) continue
        const meta = RESOURCE_META[prod.resource]
        const id = ++popId
        pops.value.push({ id, x: p.x, y: p.y, text: `+${amount}`, icon: meta.icon, color: meta.color })
        setTimeout(() => {
            pops.value = pops.value.filter(o => o.id !== id)
        }, 1500)
    }
}

const end = reactive({
    outcome: 'defeat' as 'victory' | 'defeat',
    survivedMs: 0,
    stats: { kills: 0, packsDeployed: 0, buildingsBuilt: 0, wave: 0 } as HoldfastRunStats,
    result: null as { best: number | null, rank: number | null, clamped: boolean } | null,
    submitting: false
})

// ─── Attract mode: a live battle behind the menu ─────────────────────────

const demoView = ref<HTMLDivElement | null>(null)
let demo: { sim: HoldfastSim, bot: HoldfastBot, renderer: HoldfastRenderer, raf: number, last: number, acc: number, endedAt: number } | null = null

function startAttract() {
    stopAttract()
    const el = demoView.value
    if (!el) return
    const s = markRaw(new HoldfastSim('normal', randomInt(1, 2 ** 31 - 1)))
    const bot = new HoldfastBot(s, { greed: 1 })
    // Pre-warm a lived-in base a few waves in.
    for (let i = 0; i < 20 * 230 && !s.over; i++) {
        bot.tick()
        s.step()
        s.events.length = 0
    }
    const r = new HoldfastRenderer(el, s)
    const k = s.keepCenter
    r.rig.jumpTo(k.x, k.z - 6, true)
    r.rig.goalDist = r.rig.dist = 36
    const d = { sim: s, bot, renderer: r, raf: 0, last: performance.now(), acc: 0, endedAt: 0 }
    demo = d
    const loop = (now: number) => {
        if (demo !== d) return
        d.raf = requestAnimationFrame(loop)
        const dt = Math.min(0.1, (now - d.last) / 1000)
        d.last = now
        d.acc += dt
        while (d.acc >= TICK) {
            d.bot.tick()
            d.sim.step()
            d.renderer.handleEvents(d.sim.events)
            d.sim.events.length = 0
            d.acc -= TICK
        }
        // Slow cinematic orbit around the keep.
        d.renderer.rig.goalYaw += dt * 0.035
        d.renderer.render(d.acc / TICK, dt)
        if (d.sim.over) {
            if (!d.endedAt) d.endedAt = now
            else if (now - d.endedAt > 4000) startAttract()
        }
    }
    d.raf = requestAnimationFrame(loop)
    window.addEventListener('resize', d.renderer.resize)
}

function stopAttract() {
    if (!demo) return
    cancelAnimationFrame(demo.raf)
    window.removeEventListener('resize', demo.renderer.resize)
    demo.renderer.dispose()
    demo = null
}

onMounted(() => {
    nextTick(startAttract)
})

// ─── Run lifecycle ───────────────────────────────────────────────────────

async function start(d: HoldfastDifficulty) {
    if (starting.value) return
    starting.value = true
    audio.unlock()
    let seed = randomInt(1, 2 ** 31 - 1)
    runId = null
    try {
        const res = await apiFetch<{ runId: string, seed: number }>('/api/holdfast/start-run', { method: 'POST', body: { difficulty: d } })
        runId = res.runId
        seed = res.seed
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not start a ranked run — playing offline'), color: 'warning' })
    }
    difficulty = d
    stopAttract()
    phase.value = 'playing'
    starting.value = false
    await nextTick()
    boot(d, seed)
}

function boot(d: HoldfastDifficulty, seed: number) {
    teardown()
    sim = markRaw(new HoldfastSim(d, seed))
    simRef.value = sim
    const el = viewport.value
    if (!el) return
    renderer = new HoldfastRenderer(el, sim)
    tool.value = null
    selection.value = null
    upgradesOpen.value = false
    speed.value = 1
    acc = 0
    incomeAt = 0
    pops.value = []
    lastFrame = performance.now()
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('fullscreenchange', onFullscreen)
    audio.startMusic()
    showBanner('Hold the line', 'Build up before the first raiders arrive', 'gold')
    refreshHud()
    // Dev-only handle for poking at a live run from the console.
    if (import.meta.dev) Object.assign(window, { __holdfast: { sim, renderer, speed } })
    raf = requestAnimationFrame(frame)
    // Keeps the siege running while the tab is hidden: no free pauses.
    keeper = setInterval(() => {
        if (performance.now() - lastFrame > 300) advance((performance.now() - lastFrame) / 1000, false)
    }, 500)
}

function teardown() {
    cancelAnimationFrame(raf)
    if (keeper) clearInterval(keeper)
    keeper = null
    window.removeEventListener('resize', onResize)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('fullscreenchange', onFullscreen)
    renderer?.dispose()
    renderer = null
    minimap = null
    keys.clear()
}

async function finishRun() {
    if (!sim || phase.value === 'ended') return
    const s = sim
    phase.value = 'ended'
    tool.value = null
    upgradesOpen.value = false
    end.outcome = s.over === 'victory' ? 'victory' : 'defeat'
    end.survivedMs = s.survivedMs
    end.stats = { ...s.stats }
    end.result = null
    audio.setIntensity(0)
    if (!runId) return
    end.submitting = true
    try {
        const res = await apiFetch<FinishResult>('/api/holdfast/finish-run', {
            method: 'POST',
            body: { runId, survivedMs: s.survivedMs, won: s.over === 'victory', stats: s.stats }
        })
        end.result = { best: res.best, rank: res.rank, clamped: res.clamped }
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not record this run'), color: 'error' })
    } finally {
        end.submitting = false
        runId = null
    }
}

function playAgain() {
    start(difficulty)
}

function backToLobby() {
    teardown()
    audio.stopMusic()
    sim = null
    simRef.value = null
    phase.value = 'lobby'
    nextTick(() => {
        lobby.value?.refresh()
        startAttract()
    })
}

function surrender() {
    surrenderOpen.value = false
    sim?.surrender()
}

// ─── Main loop ───────────────────────────────────────────────────────────

let hudAt = 0
let mapAt = 0
let indAt = 0
let overAt = 0

/** Run the sim for `realDt` seconds of wall-clock time at the chosen speed. */
function advance(realDt: number, visible: boolean) {
    if (!sim || sim.over) return
    acc += Math.min(realDt, visible ? 0.25 : 120) * speed.value
    let steps = 0
    const maxSteps = visible ? 12 : 100000
    while (acc >= TICK && steps < maxSteps) {
        sim.step()
        steps++
        acc -= TICK
        drainEvents(visible)
        if (sim.over) break
    }
    if (steps >= maxSteps) acc = 0
    if (!visible) lastFrame = performance.now()
}

function frame(now: number) {
    raf = requestAnimationFrame(frame)
    if (!sim || !renderer) return
    const dt = Math.min(0.1, (now - lastFrame) / 1000)
    lastFrame = now
    if (phase.value === 'playing') advance(dt, true)
    panWithKeys(dt)
    updateGhost()
    if (phase.value === 'ended') {
        // Slow cinematic drift over the ruins.
        renderer.rig.goalYaw += dt * 0.04
    }
    renderer.render(phase.value === 'playing' ? acc / TICK : 1, dt)

    if (now - hudAt > 100) {
        hudAt = now
        refreshHud()
    }
    if (!minimap && minimapCanvas.value) minimap = new HoldfastMinimap(minimapCanvas.value, sim)
    if (minimap && now - mapAt > 150) {
        mapAt = now
        minimap.draw(renderer.viewCorners(), now / 1000)
    }
    if (now - indAt > 50) {
        indAt = now
        updateIndicators()
        if (phase.value === 'playing') incomePops()
    }
    if (sim.over && phase.value === 'playing') {
        if (!overAt) overAt = now
        if (now - overAt > 1800) {
            overAt = 0
            finishRun()
        }
    }
}

function refreshHud() {
    const s = sim
    if (!s) return
    hud.time = s.time
    hud.wave = s.wave
    hud.nextWaveIn = s.nextWaveIn
    hud.pending = !!s.pending
    hud.warband = s.pending?.warband ?? false
    hud.keepHp = s.keep.hp
    hud.keepMax = s.keep.maxHp
    hud.keepLevel = s.keepLevel
    hud.packs = s.playerPacks
    hud.packCap = s.packCap
    hud.bloodmoon = s.bloodmoon
    let enemies = 0
    for (const u of s.units) if (u.side === ENEMY) enemies++
    hud.enemies = enemies
    for (const r of RESOURCES) {
        hud.res[r] = s.resources[r]
        hud.rates[r] = s.rates[r]
    }
    version.value++
    audio.setIntensity(s.bloodmoon ? 1 : Math.min(1, enemies / 70))
    // Selection may have died.
    if (selection.value?.type === 'pack' && !s.packs.has(selection.value.id)) selection.value = null
    if (selection.value?.type === 'building' && !s.building(selection.value.id)) selection.value = null
    if (tool.value?.type === 'move' && !s.packs.has(tool.value.packId)) tool.value = null
    if (renderer) renderer.selection = selection.value
}

// ─── Events → sound + banners ────────────────────────────────────────────

const LANE_NAMES = (x: number, z: number): string => {
    const s = sim
    if (!s) return ''
    const k = s.keepCenter
    const dx = x - k.x
    const dz = z - k.z
    const a = Math.atan2(dx, -dz) * 180 / Math.PI
    const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
    return dirs[((Math.round(a / 45) % 8) + 8) % 8]!
}

let lastKeepAlarm = -99

function drainEvents(visible: boolean) {
    const s = sim
    if (!s) return
    const events = s.events
    if (events.length === 0) return
    if (visible && renderer) renderer.handleEvents(events)
    if (visible) {
        for (const ev of events) soundFor(ev)
        // Several bows at once read as a volley, not a dozen tiny twangs.
        let shots = 0
        let sx = 0
        let sz = 0
        for (const ev of events) {
            if (ev.type !== 'shoot') continue
            shots++
            sx += ev.x
            sz += ev.z
        }
        if (shots >= 3) soundAt('volley', sx / shots, sz / shots, Math.min(1, 0.4 + shots * 0.08))
    }
    for (const ev of events) {
        if (ev.type === 'wave-incoming') {
            const dirs = [...new Set(ev.lanes.map(l => LANE_NAMES(s.difficulty.lanes[l]!.x, s.difficulty.lanes[l]!.z)))]
            showBanner(ev.warband ? `War band ${ev.wave} incoming!` : `Wave ${ev.wave} incoming`, `From the ${dirs.join(', ')}`, ev.warband ? 'danger' : 'info')
        } else if (ev.type === 'lane-opened') {
            const l = s.difficulty.lanes[ev.lane]!
            showBanner('A new path opens', `Raiders will now also come from the ${LANE_NAMES(l.x, l.z)}`, 'danger')
        } else if (ev.type === 'bloodmoon') {
            showBanner('The Bloodmoon rises', 'Every raider grows stronger by the minute', 'danger')
        } else if (ev.type === 'building-hit' && ev.id === s.keep.id && s.time - lastKeepAlarm > 20) {
            lastKeepAlarm = s.time
            showBanner('The keep is under attack!', undefined, 'danger')
        } else if (ev.type === 'victory') {
            showBanner('Victory!', 'The Holdfast stands', 'gold')
        }
    }
    events.length = 0
}

function soundAt(sound: HoldfastSound, x: number, z: number, base = 1) {
    if (!renderer) return
    const p = renderer.project(x, 0, z)
    const w = viewport.value?.clientWidth ?? 1
    const zoom = Math.max(0.25, 1.25 - renderer.rig.dist / 70)
    const vol = (p.visible ? 1 : 0.3) * zoom * base
    audio.play(sound, { volume: vol, pan: Math.max(-0.7, Math.min(0.7, (p.x / w) * 2 - 1)) })
}

function soundFor(ev: SimEvent) {
    const s = sim
    if (!s) return
    switch (ev.type) {
        case 'shoot': soundAt('bow', ev.x, ev.z, 0.6); break
        case 'hit': soundAt(ev.melee ? 'sword' : 'arrow-hit', ev.x, ev.z, 0.7); break
        case 'death': soundAt(ev.side === PLAYER ? 'death-friendly' : 'death-enemy', ev.x, ev.z); break
        case 'building-hit': {
            const b = s.building(ev.id)
            if (b) soundAt('building-hit', b.cx + b.size / 2, b.cz + b.size / 2, 0.6)
            break
        }
        case 'building-destroyed':
            soundAt(ev.size > 1 ? 'collapse' : 'building-destroyed', ev.cx + ev.size / 2, ev.cz + ev.size / 2)
            if (ev.size > 1 && renderer) renderer.rig.shake = Math.min(1.2, renderer.rig.shake + 0.4)
            break
        case 'wave-spawned': audio.play('war-drums'); break
        case 'building-placed':
            if (s.time > 0.1) audio.play(BUILDINGS[ev.kind].segment ? 'place-wall' : 'place')
            break
        case 'building-upgraded': audio.play('upgrade'); break
        case 'deploy': audio.play('deploy'); break
        case 'wave-incoming': audio.play('wave-horn'); break
        case 'lane-opened': audio.play('unlock'); break
        case 'bloodmoon': audio.play('wave-horn'); break
        case 'upgrade': audio.play('upgrade'); break
        case 'victory': audio.play('victory'); break
        case 'defeat': audio.play('defeat'); break
    }
}

function showBanner(title: string, sub: string | undefined, tone: 'info' | 'danger' | 'gold') {
    banner.value = { id: ++bannerId, title, sub, tone }
    if (bannerTimer) clearTimeout(bannerTimer)
    bannerTimer = setTimeout(() => {
        banner.value = null
    }, 3400)
}

// ─── Off-screen indicators ───────────────────────────────────────────────

function updateIndicators() {
    const s = sim
    const r = renderer
    const el = viewport.value
    if (!s || !r || !el || phase.value !== 'playing') {
        if (indicators.value.length) indicators.value = []
        return
    }
    const w = el.clientWidth
    const h = el.clientHeight
    const out: typeof indicators.value = []
    const place = (key: string, x: number, z: number, kind: 'enemy' | 'keep', count: number) => {
        const p = r.project(x, 0, z)
        if (p.visible) return
        const cx = w / 2
        const cy = h / 2
        let dx = p.x - cx
        let dy = p.y - cy
        // Points behind the camera project mirrored; flip them back.
        v3.set(x, 0, z).applyMatrix4(r.rig.camera.matrixWorldInverse)
        if (v3.z > 0) {
            dx = -dx
            dy = -dy
        }
        const angle = Math.atan2(dy, dx)
        const m = 34
        const sx = (w / 2 - m) / Math.max(1e-3, Math.abs(Math.cos(angle)))
        const sy = (h / 2 - m - 70) / Math.max(1e-3, Math.abs(Math.sin(angle)))
        const d = Math.min(sx, sy)
        out.push({ key, x: cx + Math.cos(angle) * d, y: cy + Math.sin(angle) * d, angle, kind, count })
    }
    // Group enemies by pack.
    for (const p of s.packs.values()) {
        if (p.side !== ENEMY || p.unitIds.length === 0) continue
        let x = 0
        let z = 0
        let n = 0
        for (const id of p.unitIds) {
            const u = s.unit(id)
            if (!u) continue
            x += u.x
            z += u.z
            n++
        }
        if (n > 0) place(`p${p.id}`, x / n, z / n, 'enemy', n)
    }
    // Merge indicators that sit on top of each other.
    const merged: typeof out = []
    for (const i of out) {
        const near = merged.find(o => Math.hypot(o.x - i.x, o.y - i.y) < 44)
        if (near) near.count += i.count
        else merged.push(i)
    }
    if (s.time - s.keep.lastHitAt < 2) {
        const k = s.keepCenter
        place('keep', k.x, k.z, 'keep', 0)
        const keepInd = out.find(o => o.key === 'keep')
        if (keepInd) merged.push(keepInd)
    }
    indicators.value = merged
}

const v3 = new THREE.Vector3()

// ─── Input ───────────────────────────────────────────────────────────────

const keys = new Set<string>()
const pointer = { x: 0, y: 0, inside: false }
const ground = new THREE.Vector3()
let hasGround = false
let drag: { button: number, x: number, y: number, moved: boolean, pan: boolean, world: THREE.Vector3 | null, touch: boolean } | null = null
let wallStart: { cx: number, cz: number } | null = null
const touches = new Map<number, { x: number, y: number }>()
let pinch: { dist: number } | null = null

function onResize() {
    renderer?.resize()
}

function onFullscreen() {
    isFullscreen.value = !!document.fullscreenElement
    setTimeout(onResize, 50)
}

function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen?.()
}

function onBlur() {
    keys.clear()
}

function updatePointerGround(): boolean {
    if (!renderer) return false
    hasGround = !!renderer.groundAt(pointer.x, pointer.y, ground)
    return hasGround
}

function onPointerDown(e: PointerEvent) {
    audio.unlock()
    if (!renderer || !sim || phase.value !== 'playing') return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    pointer.x = e.clientX
    pointer.y = e.clientY
    updatePointerGround()
    if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (touches.size === 2) {
            const [a, b] = [...touches.values()]
            pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) }
            drag = null
            wallStart = null
            return
        }
    }
    const world = hasGround ? ground.clone() : null
    drag = { button: e.button, x: e.clientX, y: e.clientY, moved: false, pan: e.button === 1, world, touch: e.pointerType === 'touch' }
    if (e.button === 0 && tool.value?.type === 'build' && BUILDINGS[tool.value.kind].segment && hasGround) {
        wallStart = { cx: Math.floor(ground.x), cz: Math.floor(ground.z) }
        touchConfirm.value = null
    }
}

function onPointerMove(e: PointerEvent) {
    pointer.x = e.clientX
    pointer.y = e.clientY
    pointer.inside = true
    if (!renderer) return
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pinch && touches.size === 2) {
            const [a, b] = [...touches.values()]
            const d = Math.hypot(a!.x - b!.x, a!.y - b!.y)
            if (d > 0) renderer.rig.zoom(pinch.dist / d)
            pinch.dist = d
            return
        }
    }
    if (drag && !drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
        drag.moved = true
        // Left-drag pans when no tool is out; right/middle-drag always pans.
        const drawing = wallStart !== null
        if (!drawing && (drag.button !== 0 || !tool.value || (drag.touch && tool.value.type !== 'build'))) drag.pan = true
        if (drag.pan) touchConfirm.value = null
    }
    if (drag?.pan && drag.world) {
        const now = renderer.groundAt(e.clientX, e.clientY, v3)
        if (now) renderer.rig.dragPan(drag.world, now)
        return
    }
    updatePointerGround()
    if (!tool.value && !drag) {
        const u = hasGround ? pickAt(ground.x, ground.z) : null
        renderer.hoverUnitPack = u ? u.packId : -1
    }
}

function pickAt(x: number, z: number) {
    if (!sim || !renderer) return null
    // Soldiers on walls stand higher: test the wall-top plane first.
    const top = renderer.groundAt(pointer.x, pointer.y, v3, WALL_HEIGHT)
    if (top) {
        const cand = pickPlayerUnit(sim, top.x, top.z, 0.55)
        if (cand?.elevated) return cand
    }
    return pickPlayerUnit(sim, x, z, 0.55)
}

function onPointerUp(e: PointerEvent) {
    if (e.pointerType === 'touch') {
        touches.delete(e.pointerId)
        if (touches.size < 2) pinch = null
    }
    const d = drag
    drag = null
    if (!d || !renderer || !sim || phase.value !== 'playing') {
        wallStart = null
        return
    }
    pointer.x = e.clientX
    pointer.y = e.clientY
    updatePointerGround()
    if (wallStart) {
        placeWalls(e.shiftKey)
        wallStart = null
        return
    }
    if (d.pan && d.moved) return
    if (!hasGround) return
    if (d.button === 2) {
        // Right-click: cancel the tool, or move the selected pack.
        if (tool.value && tool.value.type !== 'move') {
            cancelTool()
        } else if (selection.value?.type === 'pack') {
            orderMove(selection.value.id, e.shiftKey)
        } else {
            cancelTool()
        }
        return
    }
    if (d.button !== 0) return
    const t = tool.value
    if (d.touch && t && (t.type === 'build' || t.type === 'deploy')) {
        // Touch: first tap previews, the ✓ button confirms.
        touchConfirm.value = { x: e.clientX, y: e.clientY }
        return
    }
    if (t) {
        applyTool(e.shiftKey)
        return
    }
    select()
}

function select() {
    if (!sim || !renderer) return
    audio.play('click', { volume: 0.5 })
    const u = pickAt(ground.x, ground.z)
    if (u) {
        selection.value = { type: 'pack', id: u.packId }
    } else {
        const b = sim.buildingAtCell(sim.grid.cellAt(ground.x, ground.z))
        selection.value = b ? { type: 'building', id: b.id } : null
    }
    upgradesOpen.value = false
    renderer.selection = selection.value
    version.value++
}

function onWheel(e: WheelEvent) {
    e.preventDefault()
    if (!renderer) return
    pointer.x = e.clientX
    pointer.y = e.clientY
    const anchor = updatePointerGround() ? ground : null
    renderer.rig.zoom(Math.exp(e.deltaY * 0.0012), anchor)
}

function onKeyDown(e: KeyboardEvent) {
    if (phase.value !== 'playing' || !sim || !renderer) return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    audio.unlock()
    const k = e.key.toLowerCase()
    keys.add(k)
    if (k === 'escape') {
        if (upgradesOpen.value) upgradesOpen.value = false
        else if (tool.value) cancelTool()
        else selection.value = null
        return
    }
    if (k === ' ') {
        e.preventDefault()
        const c = sim.keepCenter
        renderer.rig.jumpTo(c.x, c.z)
        return
    }
    if (k === 'q') renderer.rig.rotate(-1)
    if (k === 'e') renderer.rig.rotate(1)
    if (k === 'f') toggleSpeed()
    if (k === 'u') toggleUpgrades()
    if (k === 'm' && selection.value?.type === 'pack') tool.value = { type: 'move', packId: selection.value.id }
    const item = TOOLBAR.find(t => t.key === k)
    if (item) pickTool(item)
}

function onKeyUp(e: KeyboardEvent) {
    keys.delete(e.key.toLowerCase())
}

function panWithKeys(dt: number) {
    if (!renderer || phase.value !== 'playing') return
    const rig = renderer.rig
    const sp = rig.dist * 1.1 * dt
    let dx = 0
    let dy = 0
    if (keys.has('w') || keys.has('arrowup')) dy += 1
    if (keys.has('s') || keys.has('arrowdown')) dy -= 1
    if (keys.has('a') || keys.has('arrowleft')) dx -= 1
    if (keys.has('d') || keys.has('arrowright')) dx += 1
    // Edge scroll only in fullscreen, where the window edge is the game edge.
    if (isFullscreen.value && pointer.inside && !drag) {
        const el = viewport.value
        if (el) {
            const m = 10
            if (pointer.x < m) dx -= 1
            if (pointer.x > el.clientWidth - m) dx += 1
            if (pointer.y < m) dy += 1
            if (pointer.y > el.clientHeight - m) dy -= 1
        }
    }
    if (dx || dy) rig.pan(dx * sp, dy * sp)
}

// ─── Tools ───────────────────────────────────────────────────────────────

function pickTool(item: ToolbarItem) {
    if (!sim) return
    audio.play('click', { volume: 0.6 })
    upgradesOpen.value = false
    touchConfirm.value = null
    const same = tool.value && tool.value.type === item.type && 'kind' in tool.value && tool.value.kind === item.kind
    if (same) {
        tool.value = null
        return
    }
    tool.value = item.type === 'deploy' ? { type: 'deploy', kind: item.kind } : { type: 'build', kind: item.kind }
    selection.value = null
}

function cancelTool() {
    tool.value = null
    wallStart = null
    touchConfirm.value = null
    renderer?.setGhost({ mode: 'none', ok: false })
}

function toggleUpgrades() {
    audio.play('click', { volume: 0.6 })
    upgradesOpen.value = !upgradesOpen.value
    if (upgradesOpen.value) tool.value = null
}

function toggleSpeed() {
    speed.value = speed.value === 1 ? 2 : 1
    audio.play('click', { volume: 0.6 })
}

function toggleMute() {
    muted.value = !muted.value
    audio.setMuted(muted.value)
}

function fail(reason: string | undefined) {
    audio.play('invalid')
    if (reason && hasGround) cursorFlash(reason)
}

let flashTimer: ReturnType<typeof setTimeout> | null = null
const flashText = ref<string | null>(null)
function cursorFlash(text: string) {
    flashText.value = text
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
        flashText.value = null
    }, 1400)
}

function applyTool(keep: boolean) {
    const s = sim
    const t = tool.value
    if (!s || !t || !hasGround) return
    if (t.type === 'deploy') {
        const r = s.deployPack(t.kind, ground.x, ground.z)
        if (!r.ok) return fail(r.reason)
        if (!keep) tool.value = null
    } else if (t.type === 'build') {
        const def = BUILDINGS[t.kind]
        const a = s.anchorFor(def.size, ground.x, ground.z)
        const r = s.placeBuilding(t.kind, a.cx, a.cz)
        if (!r.ok) return fail(r.reason)
        if (!keep) tool.value = null
    } else if (t.type === 'move') {
        orderMove(t.packId, keep)
    }
    touchConfirm.value = null
    version.value++
}

function placeWalls(keep: boolean) {
    const s = sim
    const t = tool.value
    if (!s || !t || t.type !== 'build' || !wallStart || !hasGround) return
    const cells = s.lineCells(wallStart.cx, wallStart.cz, Math.floor(ground.x), Math.floor(ground.z))
    const r = s.placeSegments(t.kind, cells)
    if (r.placed === 0) return fail(r.reason ?? 'Cannot build there')
    if (r.reason) cursorFlash(r.reason)
    version.value++
    void keep
}

function orderMove(packId: number, keep: boolean) {
    const s = sim
    if (!s || !hasGround) return
    const r = s.movePack(packId, ground.x, ground.z)
    if (!r.ok) return fail(r.reason)
    audio.play('click', { volume: 0.7 })
    renderer?.rings.spawn(ground.x, ground.z, 0.2, 1.2, 0.35, 0x7dd3fc)
    if (!keep && tool.value?.type === 'move') tool.value = null
}

function confirmTouch() {
    applyTool(false)
}

function updateGhost() {
    const s = sim
    const r = renderer
    if (!s || !r) return
    const t = tool.value
    const g: Ghost = { mode: 'none', ok: false }
    let label: { text: string, bad: boolean } | null = null
    const holdingRight = drag?.button === 2 && !drag.moved && selection.value?.type === 'pack'
    if (hasGround && phase.value === 'playing' && (t || holdingRight)) {
        if (t?.type === 'deploy') {
            const p = s.previewDeploy(t.kind, ground.x, ground.z)
            g.mode = 'deploy'
            g.ok = p.ok
            g.unitKind = t.kind
            g.slots = p.slots
            if (t.kind === 'archer') g.range = s.unitStats('archer', PLAYER).range + (p.wallBound ? WALL_RANGE_BONUS : 0)
            label = p.ok ? { text: p.wallBound ? 'On the wall: +range' : `${s.packSize(t.kind)} ${UNITS[t.kind].name.toLowerCase()}`, bad: false } : { text: p.reason ?? '', bad: true }
        } else if (t?.type === 'build') {
            const def = BUILDINGS[t.kind]
            if (def.segment) {
                const start = wallStart ?? { cx: Math.floor(ground.x), cz: Math.floor(ground.z) }
                const cells = s.lineCells(start.cx, start.cz, Math.floor(ground.x), Math.floor(ground.z))
                const p = s.previewSegments(t.kind, cells)
                let okCount = 0
                const valid = p.valid.map((ok) => {
                    if (!ok) return false
                    okCount++
                    return okCount <= p.affordable ? true : 'poor' as const
                })
                g.mode = 'walls'
                g.ok = okCount > 0
                g.buildingKind = t.kind
                g.cells = cells
                g.valid = valid
                const n = Math.min(okCount, p.affordable)
                label = okCount === 0
                    ? { text: p.reason ?? 'Cannot build there', bad: true }
                    : { text: `${n} × ${def.name.toLowerCase()}${okCount > p.affordable ? ` (${okCount - p.affordable} unaffordable)` : ''}`, bad: n === 0 }
            } else {
                const a = s.anchorFor(def.size, ground.x, ground.z)
                const p = s.previewBuilding(t.kind, a.cx, a.cz)
                g.mode = 'building'
                g.ok = p.ok
                g.buildingKind = t.kind
                g.cx = a.cx
                g.cz = a.cz
                if (def.attack) g.range = (def.attack.range[0] ?? 0) + def.size / 2
                label = p.ok ? null : { text: p.reason ?? '', bad: true }
            }
        } else if (t?.type === 'move' || holdingRight) {
            const packId = t?.type === 'move' ? t.packId : selection.value?.type === 'pack' ? selection.value.id : -1
            const p = s.previewMove(packId, ground.x, ground.z)
            g.mode = 'move'
            g.ok = p.ok
            g.slots = p.slots
            g.unitKind = s.packs.get(packId)?.kind
            label = p.ok ? null : { text: p.reason ?? '', bad: true }
        }
    }
    r.setGhost(g)
    const text = flashText.value ?? label?.text
    if (text && pointer.inside && (t || holdingRight || flashText.value)) {
        cursorLabel.value = { x: pointer.x, y: pointer.y, text, bad: !!flashText.value || !!label?.bad }
    } else if (cursorLabel.value) {
        cursorLabel.value = null
    }
}

// ─── Panel actions ───────────────────────────────────────────────────────

function act(ok: boolean, reason?: string) {
    if (!ok) fail(reason)
    version.value++
}

function onUpgrade(id: number) {
    const r = sim?.upgradeBuilding(id)
    if (r) act(r.ok, r.ok ? undefined : r.reason)
}

function onUpgradeLine(id: number) {
    const r = sim?.upgradeConnected(id)
    if (r) act(r.upgraded > 0, 'Not enough resources')
}

function onRepair(id: number) {
    const r = sim?.repairBuilding(id)
    if (r) {
        act(r.ok, r.ok ? undefined : r.reason)
        if (r.ok) audio.play('upgrade', { volume: 0.6 })
    }
}

function onSell(id: number) {
    const r = sim?.sellBuilding(id)
    if (r) {
        act(r.ok, r.ok ? undefined : r.reason)
        if (r.ok) {
            audio.play('sell')
            selection.value = null
        }
    }
}

function onReinforce(id: number) {
    const r = sim?.reinforcePack(id)
    if (r) act(r.ok, r.ok ? undefined : r.reason)
}

function onDisband(id: number) {
    const r = sim?.disbandPack(id)
    if (r?.ok) {
        audio.play('sell', { volume: 0.6 })
        selection.value = null
    }
    version.value++
}

function onMoveTool(id: number) {
    tool.value = { type: 'move', packId: id }
}

function onBuy(id: UpgradeId) {
    const r = sim?.buyUpgrade(id)
    if (r) act(r.ok, r.ok ? undefined : r.reason)
}

function onMinimap(e: PointerEvent) {
    const c = minimapCanvas.value
    if (!c || !renderer || !sim) return
    if (e.type === 'pointermove' && e.buttons === 0) return
    const rect = c.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * sim.grid.size
    const z = ((e.clientY - rect.top) / rect.height) * sim.grid.size
    renderer.rig.jumpTo(x, z)
}

function jumpToIndicator(i: { x: number, y: number, key: string }) {
    const s = sim
    const r = renderer
    if (!s || !r) return
    if (i.key === 'keep') {
        r.rig.jumpTo(s.keepCenter.x, s.keepCenter.z)
        return
    }
    const p = s.packs.get(Number(i.key.slice(1)))
    const u = p ? s.unit(p.unitIds[0] ?? -1) : undefined
    if (u) r.rig.jumpTo(u.x, u.z)
}

// ─── Derived HUD ─────────────────────────────────────────────────────────

const timeText = computed(() => formatHoldfastTime(hud.time * 1000))
const progress = computed(() => Math.min(1, (hud.time * 1000) / HOLDFAST_WIN_MS))
const bloodMark = (BLOODMOON_AT * 60 * 1000) / HOLDFAST_WIN_MS
const keepFrac = computed(() => Math.max(0, hud.keepHp / hud.keepMax))
const resourceList = computed(() => RESOURCES.map(r => ({
    r,
    meta: RESOURCE_META[r],
    amount: hud.res[r] ?? 0,
    rate: hud.rates[r] ?? 0,
    locked: (r === 'stone' || r === 'crystal') && hud.keepLevel < 2 && (hud.res[r] ?? 0) < 1
})))

const toolHint = computed(() => {
    const t = tool.value
    if (!t) return null
    if (t.type === 'move') return 'Click where the pack should go · right-click to cancel'
    if (t.type === 'deploy') return 'Click to drop the pack · on a wall for archers · Shift to keep placing'
    if (BUILDINGS[t.kind as BuildingKind].segment) return 'Drag to draw a line · Esc to cancel'
    return 'Click to build · Shift to keep building · right-click to cancel'
})

onBeforeUnmount(() => {
    stopAttract()
    teardown()
    audio.dispose()
    if (bannerTimer) clearTimeout(bannerTimer)
    if (flashTimer) clearTimeout(flashTimer)
    if (runId && sim && !sim.over) {
        // Leaving mid-run counts as a loss at the current time.
        const body = JSON.stringify({ runId, survivedMs: sim.survivedMs, won: false, stats: sim.stats })
        navigator.sendBeacon?.('/api/holdfast/finish-run', new Blob([body], { type: 'application/json' }))
    }
})

// ─── HUD layout (template-only helper, owned by the HUD restyle) ─────────

/** Keeps off-screen markers clear of the wave clock, system buttons and command panel. */
function indicatorStyle(i: { x: number, y: number }): { left: string, top: string } {
    const el = viewport.value
    let y = i.y
    if (el) {
        const w = el.clientWidth
        const h = el.clientHeight
        const dx = Math.abs(i.x - w / 2)
        if (w >= 640 && dx < 180) y = Math.max(y, 175)
        if (i.x > w - 200) y = Math.max(y, 70)
        if (dx < 420) y = Math.min(y, h - 195)
    }
    return { left: `${i.x}px`, top: `${y}px` }
}
</script>

<template>
    <div class="holdfast fixed inset-0 select-none overflow-hidden bg-[#bfe4f7] font-sans text-white">
        <div v-if="phase === 'lobby'" class="absolute inset-0">
            <div ref="demoView" class="pointer-events-none absolute inset-0" />
            <HoldfastLobby ref="lobby" class="absolute inset-0" :busy="starting" @start="start" />
        </div>

        <template v-else>
            <div
                ref="viewport"
                class="absolute inset-0"
                :class="tool ? 'cursor-crosshair' : 'cursor-default'"
                @pointerdown="onPointerDown"
                @pointermove="onPointerMove"
                @pointerup="onPointerUp"
                @pointercancel="onPointerUp"
                @pointerleave="pointer.inside = false"
                @wheel="onWheel"
                @contextmenu.prevent
            />

            <!-- Bloodmoon vignette -->
            <div v-if="hud.bloodmoon" class="pointer-events-none absolute inset-0 transition-opacity duration-1000" style="box-shadow: inset 0 0 220px 60px rgba(120, 10, 20, 0.45)" />
            <div v-if="phase === 'playing' && keepFrac < 0.3" class="pointer-events-none absolute inset-0 animate-pulse" style="box-shadow: inset 0 0 180px 40px rgba(220, 38, 38, 0.35)" />

            <!-- Top bar -->
            <template v-if="phase === 'playing'">
                <!-- Wave clock -->
                <div
                    class="hf-panel hf-clock pointer-events-auto absolute top-2 w-[300px] px-3.5 pb-2.5 pt-2 max-sm:left-2 max-sm:w-[calc(100vw-10.5rem)] sm:left-1/2 sm:top-3 sm:-translate-x-1/2"
                    :class="{ 'is-blood': hud.bloodmoon }"
                >
                    <div class="hf-kicker">
                        <span class="hf-kicker-line" />
                        <span>{{ hud.bloodmoon ? 'Bloodmoon · ' : '' }}{{ hud.wave > 0 ? `Wave ${hud.wave}` : 'Preparation' }}</span>
                        <span class="hf-kicker-line is-flipped" />
                    </div>
                    <div class="mt-0.5 flex items-baseline justify-center gap-1.5">
                        <span class="hf-clock-time">{{ timeText }}</span>
                        <span class="text-[11px] font-semibold tabular-nums text-(--hf-faint)">/ 25:00</span>
                    </div>
                    <div class="hf-run-track mt-1.5" title="Survive 25 minutes. The Bloodmoon rises at 20.">
                        <div class="hf-run-blood" :style="{ left: `${bloodMark * 100}%` }" />
                        <div class="hf-run-fill" :style="{ width: `${progress * 100}%` }" />
                        <span v-for="m in 4" :key="m" class="hf-run-tick" :style="{ left: `${m * 20}%` }" />
                        <span class="hf-run-head" :style="{ left: `${progress * 100}%` }" />
                    </div>
                    <div class="mt-1.5 flex items-center gap-2 text-[11px]">
                        <span
                            class="flex min-w-0 items-center gap-1.5 font-semibold"
                            :class="hud.pending ? (hud.warband ? 'hf-alarm text-red-300' : 'text-amber-200') : 'text-(--hf-text)/75'"
                        >
                            <UIcon :name="hud.pending ? 'i-lucide-swords' : 'i-lucide-hourglass'" class="size-3.5 shrink-0" />
                            <span v-if="hud.pending" class="truncate">{{ hud.warband ? 'War band' : 'Raiders' }} arrive in <b class="tabular-nums">{{ Math.ceil(hud.nextWaveIn) }}s</b></span>
                            <span v-else class="truncate">Next wave in <b class="tabular-nums text-(--hf-text)">{{ Math.ceil(hud.nextWaveIn) }}s</b></span>
                        </span>
                        <span class="ml-auto flex shrink-0 items-center gap-1 font-semibold tabular-nums" :class="hud.enemies ? 'text-red-300' : 'text-(--hf-faint)'" title="Raiders on the field">
                            <UIcon name="i-lucide-skull" class="size-3.5" />{{ hud.enemies }}
                        </span>
                    </div>
                    <div class="hf-rule my-2" />
                    <div class="flex items-center gap-2" :title="`Keep level ${hud.keepLevel}`">
                        <span class="flex shrink-0 items-center gap-1 text-(--hf-gild)">
                            <UIcon name="i-lucide-castle" class="size-3.5" />
                            <span class="hf-caps">Keep {{ ['I', 'II', 'III'][hud.keepLevel - 1] }}</span>
                        </span>
                        <div class="hf-keep-bar flex-1" :class="keepFrac > 0.5 ? 'is-good' : keepFrac > 0.25 ? 'is-warn' : 'is-bad'">
                            <div class="hf-keep-fill" :style="{ width: `${keepFrac * 100}%` }" />
                        </div>
                        <span class="shrink-0 text-[10.5px] font-semibold tabular-nums text-(--hf-text)/80">{{ Math.ceil(hud.keepHp) }}<span class="text-(--hf-faint)">/{{ hud.keepMax }}</span></span>
                    </div>
                </div>

                <!-- System buttons -->
                <div class="hf-panel pointer-events-auto absolute right-2 top-2 flex items-center gap-0.5 p-1 sm:right-3 sm:top-3">
                    <button class="hf-sys w-12 gap-1" :class="{ 'is-on': speed === 2 }" :title="`Game speed: ${speed}× (F)`" @click="toggleSpeed">
                        <UIcon :name="speed === 2 ? 'i-lucide-fast-forward' : 'i-lucide-play'" class="size-3.5" />
                        <span class="text-xs font-bold tabular-nums">{{ speed }}×</span>
                    </button>
                    <button class="hf-sys" :title="muted ? 'Unmute' : 'Mute'" @click="toggleMute">
                        <UIcon :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" class="size-4" />
                    </button>
                    <button class="hf-sys" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="toggleFullscreen">
                        <UIcon :name="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'" class="size-4" />
                    </button>
                    <span class="mx-0.5 h-5 w-px bg-(--hf-gild)/25" />
                    <button class="hf-sys is-danger" title="Surrender" @click="surrenderOpen = true">
                        <UIcon name="i-lucide-flag" class="size-4" />
                    </button>
                </div>
            </template>

            <!-- Banner -->
            <Transition name="hf-banner">
                <div v-if="banner && phase === 'playing'" :key="banner.id" class="pointer-events-none absolute inset-x-0 top-[10.5rem] z-10 flex justify-center px-4">
                    <div class="hf-banner" :class="`is-${banner.tone}`">
                        <div class="hf-kicker">
                            <span class="hf-kicker-line" />
                            <UIcon :name="banner.tone === 'danger' ? 'i-lucide-swords' : banner.tone === 'gold' ? 'i-lucide-crown' : 'i-lucide-megaphone'" class="size-3.5" />
                            <span class="hf-kicker-line is-flipped" />
                        </div>
                        <div class="hf-banner-title">{{ banner.title }}</div>
                        <div v-if="banner.sub" class="hf-banner-sub">{{ banner.sub }}</div>
                    </div>
                </div>
            </Transition>

            <!-- Off-screen raiders -->
            <button
                v-for="i in indicators"
                :key="i.key"
                class="hf-ind absolute z-10 -translate-x-1/2 -translate-y-1/2"
                :class="i.kind === 'keep' ? 'is-keep' : 'is-enemy'"
                :style="indicatorStyle(i)"
                :title="i.kind === 'keep' ? 'The keep is under attack' : `${i.count} raiders`"
                @click="jumpToIndicator(i)"
            >
                <span class="hf-ind-arrow" :style="{ transform: `rotate(${i.angle}rad) translateX(21px)` }" />
                <UIcon v-if="i.kind === 'keep'" name="i-lucide-castle" class="size-4" />
                <span v-else class="text-[11px] font-black tabular-nums">{{ i.count }}</span>
            </button>

            <!-- Income floaters -->
            <div
                v-for="pop in pops"
                :key="pop.id"
                class="hf-income pointer-events-none absolute z-10 flex items-center gap-0.5 text-sm font-black"
                :class="pop.color"
                :style="{ left: `${pop.x}px`, top: `${pop.y}px` }"
            >
                <UIcon :name="pop.icon" class="size-3.5" />{{ pop.text }}
            </div>

            <!-- Cursor label -->
            <div
                v-if="cursorLabel"
                class="hf-cursor pointer-events-none absolute z-20 -translate-x-1/2"
                :class="{ 'is-bad': cursorLabel.bad }"
                :style="{ left: `${cursorLabel.x}px`, top: `${cursorLabel.y + 22}px` }"
            >
                <UIcon v-if="cursorLabel.bad" name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
                {{ cursorLabel.text }}
            </div>

            <!-- Touch placement confirm -->
            <div v-if="touchConfirm && tool" class="absolute z-20 flex -translate-x-1/2 gap-2" :style="{ left: `${touchConfirm.x}px`, top: `${touchConfirm.y - 70}px` }">
                <button class="hf-touch is-ok" @click="confirmTouch">
                    <UIcon name="i-lucide-check" class="size-6" />
                </button>
                <button class="hf-touch" @click="cancelTool">
                    <UIcon name="i-lucide-x" class="size-6" />
                </button>
            </div>

            <!-- Bottom HUD -->
            <div v-if="phase === 'playing' && simRef" class="pointer-events-none absolute inset-x-0 bottom-0 p-2 sm:p-3">
                <div class="relative flex items-end justify-center">
                    <!-- Minimap -->
                    <div class="hf-panel pointer-events-auto absolute bottom-0 left-0 hidden p-1.5 md:block">
                        <div class="hf-map">
                            <canvas
                                ref="minimapCanvas"
                                width="192"
                                height="192"
                                class="block size-44 cursor-pointer"
                                @pointerdown="onMinimap"
                                @pointermove="onMinimap"
                            />
                        </div>
                        <div class="mt-1.5 flex items-center justify-between gap-2 px-0.5 text-[10.5px]">
                            <span class="flex items-center gap-1 text-(--hf-text)/85" title="Army packs in the field">
                                <UIcon name="i-lucide-users" class="size-3.5 text-sky-300" />
                                <b class="tabular-nums" :class="hud.packs >= hud.packCap ? 'text-amber-200' : ''">{{ hud.packs }}</b><span class="text-(--hf-faint)">/{{ hud.packCap }}</span>
                                <span class="text-(--hf-muted)">packs</span>
                            </span>
                            <span class="flex items-center gap-1 text-(--hf-muted)"><kbd class="hf-kbd">Space</kbd> Keep</span>
                        </div>
                    </div>

                    <!-- Command panel with the resource ribbon -->
                    <HoldfastToolbar
                        :sim="simRef"
                        :version="version"
                        :tool="tool"
                        :upgrades-open="upgradesOpen"
                        :hint="toolHint"
                        @pick="pickTool"
                        @upgrades="toggleUpgrades"
                        @buy="onBuy"
                    >
                        <template #resources="{ flash }">
                            <div
                                v-for="res in resourceList"
                                :key="res.r"
                                class="hf-res"
                                :class="{ 'is-locked': res.locked }"
                                :title="res.locked ? `${res.meta.name}: unlocks with keep level II` : `${res.meta.name}: ${Math.floor(res.amount).toLocaleString('en-US')} (${res.rate >= 0 ? '+' : ''}${res.rate.toFixed(1)}/s)`"
                            >
                                <span v-if="flash[res.r].n" :key="flash[res.r].n" class="hf-res-flash" :class="flash[res.r].dir === 'up' ? 'is-up' : 'is-down'" />
                                <UIcon :name="res.locked ? 'i-lucide-lock' : res.meta.icon" class="size-4 shrink-0" :class="res.locked ? 'text-(--hf-faint)' : res.meta.color" />
                                <span class="hf-res-amount">{{ res.amount < 100000 ? Math.floor(res.amount).toLocaleString('en-US') : shortAmount(res.amount) }}</span>
                                <span v-if="!res.locked" class="hf-res-rate" :class="res.rate < 0 ? 'text-red-300' : res.rate > 0 ? 'text-emerald-300/80' : 'text-(--hf-faint)'">{{ res.rate >= 0 ? '+' : '' }}{{ res.rate.toFixed(1) }}/s</span>
                                <span v-else class="hf-res-rate text-(--hf-faint)">Keep II</span>
                            </div>
                        </template>
                    </HoldfastToolbar>

                    <!-- Selection -->
                    <div v-show="!upgradesOpen" class="pointer-events-none absolute right-0 w-[280px] max-w-[calc(100vw-1rem)] max-[1439px]:bottom-[calc(100%+10px)] min-[1440px]:bottom-0">
                        <HoldfastSelection
                            :sim="simRef"
                            :version="version"
                            :selection="selection"
                            @upgrade="onUpgrade"
                            @upgrade-line="onUpgradeLine"
                            @repair="onRepair"
                            @sell="onSell"
                            @reinforce="onReinforce"
                            @disband="onDisband"
                            @move="onMoveTool"
                            @buy="onBuy"
                            @close="selection = null"
                        />
                    </div>
                </div>
            </div>

            <!-- End of run -->
            <Transition name="hf-pop">
                <div v-if="phase === 'ended'" class="absolute inset-0 z-30 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]">
                    <HoldfastEnd
                        :outcome="end.outcome"
                        :difficulty="difficulty"
                        :survived-ms="end.survivedMs"
                        :stats="end.stats"
                        :result="end.result"
                        :submitting="end.submitting"
                        @again="playAgain"
                        @lobby="backToLobby"
                    />
                </div>
            </Transition>

            <UModal v-model:open="surrenderOpen" title="Surrender?" description="The keep falls and the run ends at the current time.">
                <template #footer>
                    <div class="flex w-full justify-end gap-2">
                        <UButton color="neutral" variant="outline" @click="surrenderOpen = false">Keep fighting</UButton>
                        <UButton color="error" icon="i-lucide-flag" @click="surrender">Surrender</UButton>
                    </div>
                </template>
            </UModal>
        </template>
    </div>
</template>

<style>
/* ─── Holdfast HUD: dark lacquered panels with a thin gilded trim ────── */

.holdfast {
    --hf-text: #efe6d2;
    --hf-muted: #a89a80;
    --hf-faint: #74695a;
    --hf-gild: #d4b06a;
    --hf-gild-hi: #f0d18a;
    --hf-trim: rgba(201, 163, 90, 0.5);
}

.holdfast .hf-panel {
    border-radius: 4px;
    border: 1px solid var(--hf-trim);
    background:
        linear-gradient(180deg, rgba(255, 232, 190, 0.055), transparent 38%),
        linear-gradient(180deg, rgba(31, 26, 21, 0.9), rgba(15, 13, 11, 0.93));
    box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.65),
        inset 0 1px 0 rgba(255, 236, 200, 0.1),
        inset 0 0 0 1px rgba(0, 0, 0, 0.4),
        0 14px 34px -10px rgba(0, 0, 0, 0.65);
    color: var(--hf-text);
    backdrop-filter: blur(10px) saturate(1.15);
    -webkit-backdrop-filter: blur(10px) saturate(1.15);
}

/* Gilded corner brackets. Every panel is positioned, so the brackets hug it. */
.holdfast .hf-panel::before {
    --c: rgba(240, 209, 138, 0.85);
    content: '';
    position: absolute;
    inset: -2px;
    z-index: 5;
    pointer-events: none;
    background:
        linear-gradient(var(--c), var(--c)) left top / 9px 1px,
        linear-gradient(var(--c), var(--c)) left top / 1px 9px,
        linear-gradient(var(--c), var(--c)) right top / 9px 1px,
        linear-gradient(var(--c), var(--c)) right top / 1px 9px,
        linear-gradient(var(--c), var(--c)) left bottom / 9px 1px,
        linear-gradient(var(--c), var(--c)) left bottom / 1px 9px,
        linear-gradient(var(--c), var(--c)) right bottom / 9px 1px,
        linear-gradient(var(--c), var(--c)) right bottom / 1px 9px;
    background-repeat: no-repeat;
}

.holdfast .hf-title {
    font-family: Georgia, 'Times New Roman', serif;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.15;
    color: #f7e7c0;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.6);
}

.holdfast .hf-caps {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    line-height: 1.2;
    text-transform: uppercase;
}

.holdfast .hf-kbd {
    display: inline-flex;
    min-width: 18px;
    height: 17px;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    border-radius: 3px;
    font-family: inherit;
    font-size: 9.5px;
    font-weight: 700;
    color: var(--hf-text);
    background: linear-gradient(180deg, #3a3128, #221c16);
    border: 1px solid rgba(201, 163, 90, 0.35);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.7);
}

.holdfast .hf-rule {
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(201, 163, 90, 0.4) 20%, rgba(201, 163, 90, 0.4) 80%, transparent);
}

.holdfast .hf-close {
    display: flex;
    width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    color: var(--hf-muted);
    transition: color 0.15s, background-color 0.15s;
}

.holdfast .hf-close:hover {
    color: var(--hf-text);
    background: rgba(255, 255, 255, 0.08);
}

/* Framed icon well: portraits, tooltip headers, tech icons. */
.holdfast .hf-socket {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--hf-gild-hi);
    border: 1px solid rgba(201, 163, 90, 0.55);
    background: radial-gradient(100% 100% at 50% 20%, rgba(240, 190, 90, 0.22), transparent 70%), linear-gradient(180deg, #2c241b, #14110d);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 236, 200, 0.12), inset 0 -6px 12px rgba(0, 0, 0, 0.35);
}

.holdfast .hf-socket.is-army {
    color: #a5d8f5;
    background: radial-gradient(100% 100% at 50% 20%, rgba(90, 170, 240, 0.22), transparent 70%), linear-gradient(180deg, #1f2730, #11151a);
}

.holdfast .hf-socket.is-tech {
    color: #d4c3ff;
    border-color: rgba(167, 139, 250, 0.5);
    background: radial-gradient(100% 100% at 50% 20%, rgba(167, 139, 250, 0.25), transparent 70%), linear-gradient(180deg, #251f33, #13101a);
}

/* Diamond level pips. */
.holdfast .hf-pip {
    width: 7px;
    height: 7px;
    transform: rotate(45deg) scale(0.8);
    border: 1px solid rgba(201, 163, 90, 0.45);
    background: rgba(0, 0, 0, 0.4);
}

.holdfast .hf-pip.is-sm {
    width: 6px;
    height: 6px;
}

.holdfast .hf-pip.is-on {
    border-color: #f5dc9c;
    background: linear-gradient(135deg, #fbe7b2, #c9a35a);
    box-shadow: 0 0 5px rgba(240, 200, 110, 0.5);
}

.holdfast .hf-pip.is-on.is-tech {
    border-color: #ddd0ff;
    background: linear-gradient(135deg, #ede7ff, #a78bfa);
    box-shadow: 0 0 5px rgba(167, 139, 250, 0.55);
}

/* Shared "cooldown" veil: shrinks as the cost gets closer to affordable. */
.holdfast .hf-dim {
    position: absolute;
    inset: 0 0 auto;
    z-index: 2;
    background: rgba(8, 6, 4, 0.58);
    border-bottom: 1px solid rgba(240, 209, 138, 0.35);
    pointer-events: none;
    transition: height 0.3s linear;
}

.holdfast .hf-kicker {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--hf-gild);
}

.holdfast .hf-kicker-line {
    width: 1.75rem;
    height: 1px;
    background: linear-gradient(90deg, transparent, currentColor);
    opacity: 0.7;
}

.holdfast .hf-kicker-line.is-flipped {
    transform: scaleX(-1);
}

/* ─── Wave clock ────────────────────────────────────────── */

.holdfast .hf-clock-time {
    font-size: 26px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
    color: #fbf1d8;
    text-shadow: 0 2px 0 rgba(0, 0, 0, 0.55), 0 0 18px rgba(240, 190, 90, 0.18);
}

.holdfast .hf-clock.is-blood {
    --hf-trim: rgba(220, 60, 60, 0.6);
    background:
        radial-gradient(120% 80% at 50% 0%, rgba(160, 20, 30, 0.35), transparent 70%),
        linear-gradient(180deg, rgba(34, 18, 17, 0.92), rgba(16, 10, 10, 0.94));
}

.holdfast .hf-clock.is-blood::before {
    --c: rgba(252, 140, 140, 0.85);
}

.holdfast .hf-clock.is-blood .hf-kicker {
    color: #fca5a5;
}

.holdfast .hf-clock.is-blood .hf-clock-time {
    color: #fecaca;
    text-shadow: 0 2px 0 rgba(0, 0, 0, 0.55), 0 0 18px rgba(248, 60, 60, 0.4);
}

.holdfast .hf-run-track {
    position: relative;
    height: 6px;
    border-radius: 1px;
    background: rgba(0, 0, 0, 0.55);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(201, 163, 90, 0.22);
}

.holdfast .hf-run-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(180deg, #fbe29a, #d49a2c);
    box-shadow: 0 0 8px rgba(240, 180, 60, 0.35);
    transition: width 0.3s linear;
}

.holdfast .hf-clock.is-blood .hf-run-fill {
    background: linear-gradient(90deg, #d49a2c 0%, #d49a2c 76%, #ef4444 82%, #b91c1c);
}

.holdfast .hf-run-blood {
    position: absolute;
    inset: 0 0 0 auto;
    right: 0;
    background: repeating-linear-gradient(-45deg, rgba(220, 38, 38, 0.45) 0 3px, rgba(220, 38, 38, 0.15) 3px 6px);
}

.holdfast .hf-run-tick {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 1px;
    background: rgba(240, 209, 138, 0.35);
}

.holdfast .hf-run-head {
    position: absolute;
    top: 50%;
    width: 8px;
    height: 8px;
    transform: translate(-50%, -50%) rotate(45deg);
    border: 1px solid #1b150d;
    background: #fff4d6;
    box-shadow: 0 0 6px rgba(255, 220, 140, 0.8);
    transition: left 0.3s linear;
}

.holdfast .hf-keep-bar {
    --fill: #4ade80;
    --fill-dark: #15803d;
    position: relative;
    height: 8px;
    overflow: hidden;
    border-radius: 1px;
    background: rgba(0, 0, 0, 0.55);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(201, 163, 90, 0.22);
}

.holdfast .hf-keep-bar.is-warn {
    --fill: #fbbf24;
    --fill-dark: #b45309;
}

.holdfast .hf-keep-bar.is-bad {
    --fill: #f87171;
    --fill-dark: #991b1b;
    animation: hf-keep-alarm 0.9s ease-in-out infinite;
}

.holdfast .hf-keep-bar::after {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(0, 0, 0, 0.45) calc(10% - 1px) 10%);
}

.holdfast .hf-keep-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(180deg, var(--fill), var(--fill-dark));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
    transition: width 0.3s ease;
}

@keyframes hf-keep-alarm {
    50% { box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(248, 113, 113, 0.8), 0 0 10px rgba(248, 113, 113, 0.5); }
}

.holdfast .hf-alarm {
    animation: hf-alarm-text 1s ease-in-out infinite;
}

@keyframes hf-alarm-text {
    50% { opacity: 0.55; }
}

/* ─── System buttons ────────────────────────────────────── */

.holdfast .hf-sys {
    display: flex;
    height: 30px;
    min-width: 30px;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    border: 1px solid transparent;
    color: rgba(239, 230, 210, 0.8);
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
}

.holdfast .hf-sys:hover {
    color: var(--hf-text);
    border-color: rgba(201, 163, 90, 0.4);
    background: rgba(255, 236, 200, 0.06);
}

.holdfast .hf-sys.is-on {
    color: var(--hf-gild-hi);
    border-color: rgba(240, 209, 138, 0.55);
    background: linear-gradient(180deg, rgba(240, 190, 90, 0.2), rgba(240, 190, 90, 0.06));
}

.holdfast .hf-sys.is-danger {
    color: #fca5a5;
}

.holdfast .hf-sys.is-danger:hover {
    border-color: rgba(248, 113, 113, 0.5);
    background: rgba(248, 113, 113, 0.1);
}

/* ─── Resource ribbon ───────────────────────────────────── */

.holdfast .hf-res {
    position: relative;
    display: flex;
    flex: 1 1 0;
    min-width: 0;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.65rem;
    overflow: hidden;
}

.holdfast .hf-res + .hf-res {
    border-left: 1px solid rgba(201, 163, 90, 0.16);
}

.holdfast .hf-res-amount {
    font-size: 13.5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #fbf1d8;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.6);
}

.holdfast .hf-res-rate {
    margin-left: auto;
    font-size: 10px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.holdfast .hf-res.is-locked .hf-res-amount {
    color: var(--hf-faint);
}

.holdfast .hf-res-flash {
    position: absolute;
    inset: 0;
    pointer-events: none;
    animation: hf-res-flash 0.9s ease-out forwards;
}

.holdfast .hf-res-flash.is-up {
    background: radial-gradient(80% 120% at 30% 50%, rgba(250, 210, 110, 0.4), transparent 70%);
}

.holdfast .hf-res-flash.is-down {
    background: radial-gradient(80% 120% at 30% 50%, rgba(248, 90, 90, 0.35), transparent 70%);
}

@keyframes hf-res-flash {
    from { opacity: 1; }
    to { opacity: 0; }
}

/* ─── Minimap ───────────────────────────────────────────── */

.holdfast .hf-map {
    position: relative;
    overflow: hidden;
    border-radius: 2px;
    border: 1px solid rgba(201, 163, 90, 0.4);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7);
}

.holdfast .hf-map::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 18px rgba(0, 0, 0, 0.55);
}

/* ─── Banner ────────────────────────────────────────────── */

.holdfast .hf-banner {
    --tone: #f0d18a;
    --band: rgba(20, 16, 12, 0.88);
    position: relative;
    width: min(620px, 100%);
    padding: 0.55rem 3rem 0.7rem;
    text-align: center;
    background: linear-gradient(90deg, transparent, var(--band) 18%, var(--band) 82%, transparent);
}

.holdfast .hf-banner::before,
.holdfast .hf-banner::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--tone) 25%, var(--tone) 75%, transparent);
    opacity: 0.75;
}

.holdfast .hf-banner::before {
    top: 0;
}

.holdfast .hf-banner::after {
    bottom: 0;
}

.holdfast .hf-banner .hf-kicker {
    color: var(--tone);
}

.holdfast .hf-banner.is-danger {
    --tone: #f87171;
    --band: rgba(40, 10, 12, 0.88);
}

.holdfast .hf-banner.is-info {
    --tone: #a8c4dc;
    --band: rgba(14, 18, 24, 0.86);
}

.holdfast .hf-banner-title {
    margin-top: 0.15rem;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: 0.06em;
    line-height: 1.15;
    color: transparent;
    background: linear-gradient(180deg, #fffbeb 0%, #fde68a 45%, #d49a2c 100%);
    -webkit-background-clip: text;
    background-clip: text;
    filter: drop-shadow(0 2px 0 rgba(0, 0, 0, 0.7));
}

.holdfast .hf-banner.is-danger .hf-banner-title {
    background-image: linear-gradient(180deg, #fff1f2 0%, #fecaca 40%, #ef4444 100%);
}

.holdfast .hf-banner.is-info .hf-banner-title {
    background-image: linear-gradient(180deg, #ffffff 0%, #e2e8f0 50%, #a8b8c8 100%);
}

.holdfast .hf-banner-sub {
    margin-top: 0.2rem;
    font-size: 12.5px;
    color: rgba(239, 230, 210, 0.8);
}

/* ─── Off-screen indicators ─────────────────────────────── */

.holdfast .hf-ind {
    --tone: #ef4444;
    display: flex;
    width: 34px;
    height: 34px;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    color: #fee2e2;
    border: 1.5px solid var(--tone);
    background: radial-gradient(circle at 50% 35%, rgba(127, 29, 29, 0.95), rgba(40, 8, 8, 0.95));
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7), 0 0 12px rgba(239, 68, 68, 0.45), 0 4px 10px rgba(0, 0, 0, 0.5);
    transition: scale 0.15s;
}

.holdfast .hf-ind:hover {
    scale: 1.12;
}

.holdfast .hf-ind.is-keep {
    --tone: #f0d18a;
    color: #fff3d0;
    background: radial-gradient(circle at 50% 35%, rgba(146, 96, 20, 0.95), rgba(44, 28, 6, 0.95));
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7), 0 0 14px rgba(240, 190, 90, 0.6);
    animation: hf-ind-pulse 1s ease-in-out infinite;
}

.holdfast .hf-ind-arrow {
    position: absolute;
    width: 0;
    height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 8px solid var(--tone);
    filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.8));
}

@keyframes hf-ind-pulse {
    50% { box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7), 0 0 24px rgba(240, 190, 90, 0.9); }
}

/* ─── Cursor label / touch ──────────────────────────────── */

.holdfast .hf-cursor {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.5rem;
    border-radius: 3px;
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
    color: var(--hf-text);
    border: 1px solid rgba(201, 163, 90, 0.4);
    background: rgba(18, 15, 12, 0.88);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
}

.holdfast .hf-cursor.is-bad {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.6);
    background: rgba(50, 12, 12, 0.9);
}

.holdfast .hf-touch {
    display: flex;
    width: 44px;
    height: 44px;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    color: var(--hf-text);
    border: 1px solid rgba(201, 163, 90, 0.5);
    background: linear-gradient(180deg, #2c241b, #14110d);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 6px 14px rgba(0, 0, 0, 0.5);
}

.holdfast .hf-touch.is-ok {
    color: #052e16;
    border-color: #86efac;
    background: linear-gradient(180deg, #86efac, #22c55e);
}

/* ─── Income floaters ───────────────────────────────────── */

.holdfast .hf-income {
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85), 0 0 6px rgba(0, 0, 0, 0.4);
    animation: hf-income 1.5s ease-out forwards;
}

@keyframes hf-income {
    0% { opacity: 0; transform: translate(-50%, 6px) scale(0.6); }
    15% { opacity: 1; transform: translate(-50%, -4px) scale(1.1); }
    30% { transform: translate(-50%, -10px) scale(1); }
    100% { opacity: 0; transform: translate(-50%, -42px) scale(0.95); }
}

/* ─── Transitions ───────────────────────────────────────── */

.hf-pop-enter-active,
.hf-pop-leave-active {
    transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.hf-pop-enter-from,
.hf-pop-leave-to {
    opacity: 0;
    transform: translateY(8px) scale(0.97);
}

.hf-tip-enter-active {
    transition: opacity 0.14s ease, transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.hf-tip-leave-active {
    transition: opacity 0.1s ease, transform 0.1s ease;
}

.hf-tip-enter-from,
.hf-tip-leave-to {
    opacity: 0;
    transform: translateY(6px);
}

.hf-banner-enter-active {
    transition: opacity 0.3s ease, transform 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.1);
}

.hf-banner-leave-active {
    transition: opacity 0.45s ease, transform 0.45s ease;
}

.hf-banner-enter-from {
    opacity: 0;
    transform: scaleX(0.6);
}

.hf-banner-leave-to {
    opacity: 0;
    transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
    .holdfast .hf-ind.is-keep,
    .holdfast .hf-keep-bar.is-bad,
    .holdfast .hf-alarm {
        animation: none;
    }
}
</style>
