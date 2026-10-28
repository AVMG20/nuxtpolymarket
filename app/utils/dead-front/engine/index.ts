import * as THREE from 'three'
import { DF_GRENADES, DF_INTERP_DELAY_MS, DF_TICK_HZ, DF_MELEE, DF_PLAYER, DF_BASE_EFFECTS, DF_POINTS } from '#shared/utils/dead-front/constants'
import { dfArcAim, dfArcBody, dfBulletDamage, dfFlameHitPays, dfKillPoints, dfScalePoints } from '#shared/utils/dead-front/combat'
import { DF_ENEMIES, dfZombieBaseHealth, dfZombieHitTest } from '#shared/utils/dead-front/enemies'
import { DF_BARRICADE_PLANKS, DF_MAP, dfInteractables, dfMaterialSurface } from '#shared/utils/dead-front/map'
import { DF_PERKS, dfComputeEffects } from '#shared/utils/dead-front/perks'
import { dfBuildCollision, dfGroundHeight, dfRaycast } from '#shared/utils/dead-front/physics'
import type { DfCollisionWorld } from '#shared/utils/dead-front/physics'
import { DF_FLAG } from '#shared/utils/dead-front/protocol'
import type {
    DfEvent, DfHeldWeapon, DfMatchStart, DfPlayerSnap, DfProjectileSnap, DfShotHit, DfSnapshot, DfZombieSnap
} from '#shared/utils/dead-front/protocol'
import type { DfHitZone, DfPlayerEffects, DfProfileView, Vec3 } from '#shared/utils/dead-front/types'
import { DF_WEAPONS, dfWeaponStats } from '#shared/utils/dead-front/weapons'
import type { DfWeaponStats } from '#shared/utils/dead-front/weapons'
import { randomFloat } from '#shared/utils/random'
import {
    buildDfWeaponModel, createDfProjectileView, createDfViewmodel, DF_WSND, dfMuzzleFlashColor, dfShotSoundName,
    registerDfWeaponSounds
} from '~/utils/dead-front/weapons'
import { createDfWorldView, createDfZombieView, registerDfWorldSounds } from '~/utils/dead-front/world'
import type { DfProjectileView, DfRenderContext, DfViewmodel, DfViewmodelInput, DfWorldView, DfZombieView } from '../context'
import type { DfNet } from '../net'
import { createDfAudio } from './audio'
import { createDfAvatars, dfPlayerColor } from './avatars'
import type { DfAvatarManager } from './avatars'
import { createDfEnvMap } from './envmap'
import { createDfFx } from './fx'
import { DfGunState, DfRecoil, dfAimDir, dfConeDir, dfSpread } from './gun'
import { DfHintTracker, dfAmmoHint, dfLoadHintsSeen, dfSaveHintsSeen } from './hints'
import type { DfHintFacts } from './hints'
import { DF_HUD_HIT_POPS, DF_HUD_MARKERS } from './hud'
import type { DfHudState } from './hud'
import { DfInput } from './input'
import { DF_MAX_ZOMBIE_EXTRAPOLATE, DfSnapBuffer, DfZombieSmoother, dfEaseDelay, dfInterpPlayer, dfPredictionSettled, dfInterpZombies, dfNewInterpPlayer, dfNewSample, dfWrapAngle } from './interp'
import type { DfInterpPlayer } from './interp'
import { dfClampToScreen, dfEggRodSpots, dfObjectiveTarget, dfObjectiveText } from './objective'
import type { DfScreenPoint } from './objective'
import { DF_STEP, DfPlayerController } from './player'
import type { DfMoveIntent, DfMoveSpeeds } from './player'
import { createDfPowerupView, DF_POWERUP_NAMES } from './powerups'
import type { DfPowerupView } from './powerups'
import { dfPickInteractable, dfPromptFor, dfRevivePrompt } from './prompt'
import type { DfPrompt } from './prompt'
import { createDfRenderer } from './renderer'
import { dfVerticalFov } from './settings'
import type { DfSettings } from './settings'
import { DF_SND, registerDfEngineSounds } from './sounds'
import { DF_SPECIAL_SND, registerDfSpecialSounds } from './specials-sounds'
import { createDfArsenalClient } from './arsenal'
import { dfMergeArsenalMine } from '#shared/utils/dead-front/salvage'
import { DF_STREAK_TITLES, dfGasDepth } from '#shared/utils/dead-front/specials'

// The Dead Front client engine: owns the renderer, the loop, input and the
// local player, interpolates the server's snapshots, routes events to the
// world / zombie / projectile views, runs client-side shooting with hit
// claims, and feeds the HUD.

export interface DfEngineOptions {
    container: HTMLElement
    net: DfNet
    start: DfMatchStart
    profile: DfProfileView
    hud: DfHudState
    /** HUD root element for per-frame CSS variables. */
    hudRoot: () => HTMLElement | null
    settings: DfSettings
}

export interface DfEngine {
    /** Request pointer lock (from a click). */
    lock(): void
    unlock(): void
    /** Chat box open: the keyboard types instead of playing (held keys are let go). */
    setTyping(on: boolean): void
    applySettings(s: DfSettings): void
    dispose(): void
}

const SEND_HZ = 20
const ROUND_LINES = [
    'They are coming through the wire',
    'Hold the line',
    'The dead do not rest',
    'No man\'s land stirs',
    'Steady, lads',
    'Mind the windows',
    'The bells toll again'
]

function noop(): void {}

function safe<T>(label: string, make: () => T, fallback: T): T {
    try {
        return make()
    } catch (e) {
        console.error(`[dead-front] ${label} failed to start`, e)
        return fallback
    }
}

function weaponKey(w: DfHeldWeapon | null | undefined): string {
    if (!w) return ''
    const a = w.attachments ?? {}
    return `${w.id}:${w.pap}:${w.rarity ?? 0}:${a.optic ?? ''}:${a.muzzle ?? ''}:${a.magazine ?? ''}:${a.stock ?? ''}`
}

export function createDfEngine(opts: DfEngineOptions): DfEngine {
    const { container, net, start, profile, hud } = opts
    let settings = { ...opts.settings }
    const me = start.you

    // ---------------------------------------------------------------- rendering setup
    const rr = createDfRenderer(container, { quality: settings.quality })
    const renderer = rr.renderer
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(dfVerticalFov(settings.fov), 16 / 9, 0.05, 260)
    camera.rotation.order = 'YXZ'
    scene.add(camera)
    const vmScene = new THREE.Scene()
    const vmCamera = new THREE.PerspectiveCamera(54, 16 / 9, 0.01, 10)
    vmScene.add(vmCamera)
    // the viewmodel's own light rig: moonlit fill, a warm lantern key and a pooled muzzle light
    vmScene.add(new THREE.HemisphereLight(0x8d97b0, 0x2b2218, 0.85))
    const vmKey = new THREE.DirectionalLight(0xffcf9a, 1.5)
    vmKey.position.set(-1.2, 1.6, 0.8)
    vmScene.add(vmKey)
    const vmRim = new THREE.DirectionalLight(0x9fb4ff, 0.7)
    vmRim.position.set(1.4, 0.4, -1.2)
    vmScene.add(vmRim)
    const vmMuzzle = new THREE.PointLight(0xffb060, 0, 3, 2)
    vmMuzzle.position.set(0.15, -0.05, -0.7)
    vmScene.add(vmMuzzle)
    rr.setScenes(scene, camera, vmScene, vmCamera)
    renderer.shadowMap.autoUpdate = false
    let shadowTick = 0
    // image-based fill: metals (steel, brass, iron) need something to reflect or they render black
    const envRt = createDfEnvMap(renderer)
    vmScene.environment = envRt.texture
    vmScene.environmentIntensity = 1
    scene.environment = envRt.texture
    scene.environmentIntensity = 0.45

    const fx = createDfFx(scene, camera, rr.quality)
    const audio = createDfAudio()
    audio.setVolume(settings.volume)
    audio.setSfxVolume(settings.sfxVolume)
    const ctx: DfRenderContext = { renderer, scene, camera, vmScene, vmCamera, fx, audio, quality: rr.quality }

    registerDfEngineSounds(audio)
    registerDfSpecialSounds(audio)
    safe('world sounds', () => registerDfWorldSounds(audio), undefined)
    safe('weapon sounds', () => registerDfWeaponSounds(audio), undefined)

    const noopView = { update: noop, onEvent: noop, dispose: noop }
    const worldView: DfWorldView = safe('world view', () => createDfWorldView(ctx, DF_MAP), noopView)
    const zombieView: DfZombieView = safe('zombie view', () => createDfZombieView(ctx), noopView)
    const projectileView: DfProjectileView = safe('projectile view', () => createDfProjectileView(ctx), noopView)
    const viewmodel: DfViewmodel = safe('viewmodel', () => createDfViewmodel(ctx), {
        root: new THREE.Group(), adsBlend: 0, equip: () => 0.4, fire: noop, reload: noop, cancelReload: noop,
        melee: noop, setDowned: noop, muzzleWorld: (c: THREE.Camera, out: THREE.Vector3) => out.copy(c.position), update: noop, dispose: noop
    })
    const avatars: DfAvatarManager = createDfAvatars(ctx)
    const powerupView: DfPowerupView = createDfPowerupView(ctx)

    // ---------------------------------------------------------------- world state
    let collision: DfCollisionWorld = dfBuildCollision(DF_MAP, new Set())
    let doorsKey = ''
    fx.setGround((x, z, y) => dfGroundHeight(collision, x, z, y))
    const interactables = dfInteractables(DF_MAP)

    const buffer = new DfSnapBuffer()
    let latest: DfSnapshot | null = null
    let mine: DfPlayerSnap | null = null
    const eventQueue: { time: number, events: DfEvent[] }[] = []

    // ---------------------------------------------------------------- local player
    const input = new DfInput(rr.canvas)
    const player = new DfPlayerController()
    // salvage, the workbench, crafted gear, upgrade kits, support (arsenal.ts)
    const arsenal = createDfArsenalClient({
        ctx,
        net,
        me,
        hud,
        input,
        collision: () => collision,
        feet: () => player.pos,
        aim: out => aimDirection(out),
        announce: (title, sub, tone) => announce(title, sub, tone)
    })
    const gun = new DfGunState()
    const recoil = new DfRecoil()
    let effects: DfPlayerEffects = { ...DF_BASE_EFFECTS }
    let perksKey = ''
    let solo = true
    let stats: DfWeaponStats | null = null
    let heldKey = ''
    let localSlot = 0
    let swapPendingUntil = 0
    let life: DfPlayerSnap['life'] = 'alive'
    let spawned = false
    let lastTp = -1
    let seq = 0
    let sendTimer = 0
    const HIST = 64
    const histSeq = new Int32Array(HIST).fill(-1)
    const histPos = new Float32Array(HIST * 3)

    // feel
    let lastShot = -10
    let landOff = 0
    let landVel = 0
    let sprintFov = 0
    let sprintLockUntil = 0
    let meleeReadyAt = 0
    let meleeQueuedUntil = 0
    let grenadeReadyAt = 0
    let useCooldown = 0
    let useRepeatAt = 0
    let reviveTarget: number | null = null
    let shotCount = 0
    let predictedHitAt = -10
    /** Zombies this client just hit (render clock): their flinch played locally, so the server's echo is skipped. */
    const predictedFlinch = new Map<number, number>()
    const localHits: { z: number, zone: DfHitZone, pos: Vec3 }[] = []
    // ---- client-side prediction (hits, kills, points, buys); the server reconciles.
    // Each prediction keeps `ack`, the input seq sent next: a snapshot acking it has the answer
    // (dfPredictionSettled), so a slow line never rolls back a prediction the server took.
    let shotSeq = 0
    /** Points this client predicted per shot id, until the server's points event for that shot. */
    const pendingPoints = new Map<number, { amount: number, at: number, ack: number }>()
    /** Damage dealt that the latest snapshot doesn't show yet, per zombie id. */
    const pendingDamage = new Map<number, { dmg: number, shot: number, at: number, ack: number }[]>()
    /** Zombies this client killed (predicted, render clock): hidden at once, the server's kill echo is skipped. */
    const predictedDead = new Map<number, { at: number, ack: number }>()
    /** Optimistic purchases: points shown spent at once, refunded on screen if the server never confirms. */
    const pendingBuys: { id: string, cost: number, at: number, ack: number, door?: string, perk?: DfPlayerSnap['perks'][number] }[] = []
    /** The last local ammo change (shot, reload, swap): snapshots older than its ack can't overwrite the magazine. */
    let ammoAck = 0
    let ammoAt = -10
    const smoother = new DfZombieSmoother()
    /** When each zombie last paid our flame hit points (`dfFlameHitPays`). */
    const flamePaid = new Map<number, number>()
    /** Kill punch 0..1: a quick FOV squeeze on kills (more on headshots). */
    let killPunch = 0
    let damagePulse = 0
    /** Gas rounds: the next fog puff in a pocket and the next cough while standing in one. */
    let gasPuffIn = 0
    let coughIn = 0
    let downBlend = 0
    let gradeFlash = 0
    let heartbeatAt = 0
    let breathAt = 0
    let spectatePid = -1
    let lastSnapAt = performance.now()
    let currentPrompt: DfPrompt | null = null
    let reloadEmptyPending = false
    let wasLocked = false
    /** We paused a solo match: the snapshot silence that follows isn't a lost connection. */
    let pausedByMe = false

    // scratch
    const tmpV = new THREE.Vector3()
    const tmpV2 = new THREE.Vector3()
    const aim = { x: 0, y: 0, z: -1 }
    const shotDir = { x: 0, y: 0, z: 0 }
    const eye = { x: 0, y: 0, z: 0 }
    const zPool: DfZombieSnap[] = []
    const zList: DfZombieSnap[] = []
    const pPool: DfInterpPlayer[] = []
    const pList: DfInterpPlayer[] = []
    const projPool: DfProjectileSnap[] = []
    const projList: DfProjectileSnap[] = []
    const intent: DfMoveIntent = { fwd: 0, right: 0, sprint: false, crouch: false, jump: false, ads: 0 }
    const speeds: DfMoveSpeeds = { walk: 0, sprint: 0, crouch: 0, ads: 0, sprintDuration: 4 }
    const vmInput: DfViewmodelInput = { speed: 0, sprinting: false, crouching: false, grounded: true, look: { x: 0, y: 0 }, ads: false, adsMult: 1 }
    const screenPt: DfScreenPoint = { x: 0, y: 0, onScreen: false, angle: 0 }
    const wpTarget = new THREE.Vector3()
    let wpHas = false
    const fwdFlat = { x: 0, z: -1 }

    // coaching, ammo line, last zombies and markers
    const hints = new DfHintTracker(dfLoadHintsSeen())
    hints.onSeen = () => dfSaveHintsSeen(hints.seen)
    const hintFacts: DfHintFacts = {
        time: 0, alive: false, round: 0, phase: 'intermission', points: 0, brokenWindowNear: false, zombieClose: false,
        wallbuyNear: false, cheapestDoor: Infinity, doorsOpen: 0, power: false, perkNear: false, downedMate: null, reviving: false
    }
    let highlightKey = ''
    const highlightIds: number[] = []
    /** What each HUD marker follows: a zombie id or a teammate pid. */
    const markerSubjects: { kind: 'zombie' | 'revive', id: number }[] = []
    const lastMarkKeys: number[] = []
    const markPos = new THREE.Vector3()

    let popupId = 0
    /** World anchor per hit-pop slot (the hit point the number rises from). */
    const hitPopAt = Array.from({ length: DF_HUD_HIT_POPS }, () => new THREE.Vector3())
    let hitPopSeq = 0
    let damageId = 0
    let chatId = 0
    let hudTimer = 0
    let time = 0
    let last = performance.now()
    let acc = 0
    let raf = 0
    let disposed = false

    // ---------------------------------------------------------------- helpers
    function computeEffects(perks: readonly DfPlayerSnap['perks'][number][]): void {
        try {
            effects = dfComputeEffects(perks, profile.perkMods ?? {}, solo)
        } catch {
            effects = { ...DF_BASE_EFFECTS }
        }
    }

    /** The weapon in a slot; a slot whose weapon sits in the Pack-a-Punch holds nothing. */
    function heldWeapon(p: DfPlayerSnap, slot: number): DfHeldWeapon | null {
        const w = p.weapons[slot]
        if (w) return w.away ? null : w
        return p.weapons.find(x => !x.away) ?? null
    }

    function equip(w: DfHeldWeapon, now: number): void {
        let s: DfWeaponStats
        try {
            s = dfWeaponStats(w.id, w.pap, w.attachments ?? {}, w.rarity ?? 0)
        } catch {
            return
        }
        stats = s
        heldKey = weaponKey(w)
        hud.swapKey++
        const raise = safe('equip', () => viewmodel.equip({ id: w.id, pap: w.pap, attachments: w.attachments ?? {} }, effects.swapMult), 0.4)
        gun.setWeapon(w, s, now, Math.max(0.05, raise))
        reloadEmptyPending = false
    }

    /** The screen centre's ray: the same angles the camera is rendered with (shake and landing dip included). */
    function aimDirection(out: Vec3): Vec3 {
        return dfAimDir(player.yaw + recoil.yaw + fx.shakeYaw, player.pitch + recoil.pitch + fx.shakePitch - landOff * 0.02, out)
    }

    function surfaceFx(point: Vec3, normal: Vec3, mat: string): void {
        const s = dfMaterialSurface(mat)
        if (s === 'wood') fx.burst('splinters', point, { normal })
        else if (s === 'metal') fx.burst('sparks', point, { normal })
        else if (s === 'cloth') fx.burst('dust', point, { normal, color: 0x6e6450, count: 3 })
        else if (s === 'dirt') fx.burst('dust', point, { normal, color: 0x4a3d2c })
        else fx.burst('dust', point, { normal })
        fx.decal(point, normal, 'bullet')
    }

    function addDamageIndicator(fromX: number, fromZ: number): void {
        const dx = fromX - player.pos.x
        const dz = fromZ - player.pos.z
        const angle = Math.atan2(-dx, -dz)
        hud.damage.push({ id: ++damageId, angle, born: time })
        if (hud.damage.length > 5) hud.damage.shift()
    }

    function announce(title: string, sub: string, tone: 'gold' | 'red' | 'pale'): void {
        hud.announce = { key: (hud.announce?.key ?? 0) + 1, title, sub, tone }
    }

    function playerName(pid: number): string {
        return latest?.players.find(p => p.pid === pid)?.name ?? 'A soldier'
    }

    // ---------------------------------------------------------------- shader warm-up
    /**
     * Compiles every shader the match can need before the first shot, so the
     * first muzzle flash, explosion, Pack-a-Punch camo or box weapon doesn't
     * hitch (a program link costs 10-200 ms, worst on Windows' D3D backend).
     * Everything is compiled the way it is drawn: into the composer's linear
     * render target (a compile against the canvas would build sRGB variants
     * nothing uses), with each scene's lights. Weapon models (every weapon,
     * plain and packed, plus a scope) are compiled against both the world and
     * the viewmodel lights, then thrown away; their materials are shared.
     */
    let warmed = false
    const warmMats = new Set<THREE.Material>()
    function warmUp(): void {
        if (warmed) return
        warmed = true
        const t0 = performance.now()
        const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
        const prevTarget = renderer.getRenderTarget()
        const models = new THREE.Group()
        try {
            for (const id of Object.keys(DF_WEAPONS) as (keyof typeof DF_WEAPONS)[]) {
                for (const pap of [0, 1]) {
                    try {
                        models.add(buildDfWeaponModel(id, pap, {}))
                    } catch {
                        // a weapon that fails to build fails later too; nothing to warm
                    }
                }
            }
            try {
                models.add(buildDfWeaponModel('kar98k', 0, { optic: 'kar98k-scope' }))
            } catch {
                // optional
            }
            // one of each projectile (made on first sight), parked below the map for the compile
            const kinds: DfProjectileSnap['kind'][] = ['grenade', 'pap-grenade', 'xray-bolt', 'spit']
            try {
                projectileView.update(0, kinds.map((kind, i) => ({ id: -1 - i, kind, tier: 1, pos: { x: 0, y: -60, z: 0 }, vel: { x: 0, y: 0, z: 0 } })))
            } catch {
                // optional
            }
            renderer.setRenderTarget(rt)
            const compile = (obj: THREE.Object3D, cam: THREE.Camera, target: THREE.Scene) => {
                const r = renderer as THREE.WebGLRenderer & { compileAsync?: (o: THREE.Object3D, c: THREE.Camera, t: THREE.Scene) => Promise<unknown> }
                // the async variant links in parallel (KHR_parallel_shader_compile) when the driver can
                if (r.compileAsync) r.compileAsync(obj, cam, target).catch(noop)
                else renderer.compile(obj, cam, target)
            }
            compile(scene, camera, scene)
            compile(vmScene, vmCamera, vmScene)
            compile(models, camera, scene)
            compile(models, vmCamera, vmScene)
        } catch (e) {
            console.error('[dead-front] shader warm-up', e)
        } finally {
            renderer.setRenderTarget(prevTarget)
            try {
                projectileView.update(0, [])
            } catch {
                // optional
            }
            rt.dispose()
            // geometries go now; owned materials (X-Ray tubes, coils) live as long as the
            // match, so the programs they warmed aren't released and rebuilt on first use
            models.traverse((o) => {
                const m = o as THREE.Mesh
                if (!m.isMesh) return
                m.geometry.dispose()
                const mats = Array.isArray(m.material) ? m.material : [m.material]
                for (const mat of mats) if (mat.userData.dfOwned) warmMats.add(mat)
            })
            models.clear()
        }
        if (import.meta.dev) console.info(`[dead-front] shaders warmed in ${(performance.now() - t0).toFixed(0)} ms (${renderer.info.programs?.length ?? 0} programs)`)
    }

    // ---------------------------------------------------------------- snapshots
    function onSnap(s: DfSnapshot): void {
        // the player's own salvage rides in its own slice: fold it into the world and events
        dfMergeArsenalMine(s)
        const nowMs = performance.now()
        // after a pause or a stall the server clock resumes where it stopped: re-sync the render clock
        if (nowMs - lastSnapAt > 1000) buffer.offset = null
        lastSnapAt = nowMs
        if (!buffer.push(s, nowMs)) return
        latest = s
        const now = time
        const p = s.players.find(x => x.pid === me) ?? null
        mine = p
        solo = s.players.length <= 1
        if (p) {
            // perks -> effects
            const pk = p.perks.join(',')
            if (pk !== perksKey || !spawned) {
                // going down strips the perks, but the Last Stand mod bought with Second Wind still counts while downed
                const lastStand = p.life === 'down' && life !== 'down' && perksKey.split(',').includes('secondwind') ? effects.lastStandDamageMult : 1
                perksKey = pk
                computeEffects(p.perks)
                effects.lastStandDamageMult = Math.max(effects.lastStandDamageMult, lastStand)
            }
            if (!spawned) {
                spawned = true
                // solo: the match waits for the first click into the game
                if (!input.locked) sendPause(true)
                player.teleport(p.pos)
                player.yaw = p.yaw
                player.pitch = 0
                localSlot = p.slot
                const w = heldWeapon(p, p.slot)
                if (w) equip(w, now)
                hud.started = true
                audio.play(DF_SND.gameStart)
                warmUp()
            }
            // life transitions
            if (p.life !== life) {
                const prev = life
                life = p.life
                if (life === 'down') {
                    player.downed = true
                    player.wantsCrouch = false
                    safe('setDowned', () => viewmodel.setDowned(true), undefined)
                    gun.cancelReload()
                } else if (life === 'alive') {
                    player.downed = false
                    safe('setDowned', () => viewmodel.setDowned(false), undefined)
                    if (prev === 'dead') player.teleport(p.pos)
                    spectatePid = -1
                    avatars.hidden = -1
                } else {
                    player.downed = false
                }
            }
            // the server moved us (spawn, respawn, reconnect, rejected move): snap there
            if (p.tp !== undefined && p.tp !== lastTp) {
                if (lastTp !== -1) player.teleport(p.pos)
                lastTp = p.tp
            }
            // reconcile position against the input the server acked
            if (life !== 'dead') {
                const i = s.ack % HIST
                if (histSeq[i] === s.ack) {
                    const dx = p.pos.x - histPos[i * 3]!
                    const dy = p.pos.y - histPos[i * 3 + 1]!
                    const dz = p.pos.z - histPos[i * 3 + 2]!
                    const d2 = dx * dx + dy * dy + dz * dz
                    // movement is client-authoritative: only a real divergence (the server
                    // slid us out of a wall it had closed) is eased back; never rubber-band
                    if (d2 > 36) player.teleport(p.pos)
                    else if (d2 > 2.25) player.correct(dx, dy, dz)
                }
            }
            // weapon changes from the server (buys, box, PaP, last stand)
            const pendingSwap = now < swapPendingUntil
            if (!pendingSwap) localSlot = p.slot
            const w = heldWeapon(p, localSlot)
            const k = weaponKey(w)
            if (w && k !== heldKey) {
                if (pendingSwap && p.slot !== localSlot && p.weapons[localSlot]?.id !== w.id) {
                    // the server hasn't applied our swap yet
                } else {
                    equip(w, now)
                }
            } else if (w) {
                // a snapshot from before our last shot / reload reached the server must not refill the magazine
                gun.reconcile(w, now, dfPredictionSettled(ammoAck, s.ack, now - ammoAt, net.rtt) ? 0.45 + net.rtt / 1000 : Infinity)
            } else if (heldKey !== '') {
                // weapon handed to Pack-a-Punch: nothing in hand
                heldKey = ''
                stats = null
                gun.stats = null
                gun.cancelReload()
            }
        }
        // HUD-side reactions happen on arrival; view events wait for the render clock
        for (const ev of s.events) handleImmediate(ev, s)
        // after this snapshot's events (their echoes settle predictions first)
        reconcilePredictions(s)
        // the collision world follows the bought doors (and the ones we just bought, predicted)
        updateCollision(s)
        if (s.events.length) eventQueue.push({ time: s.time, events: s.events })
        if (hud.round !== s.round && s.round > 0 && hud.round === 0) {
            hud.round = s.round
            hud.roundKey++
        }
    }

    /** Doors in the snapshot plus our pending door buys, for collision and the world view. */
    function doorsWithPredicted(world: DfSnapshot['world']): string[] {
        let doors = world.doors
        for (const b of pendingBuys) {
            if (b.door && !doors.includes(b.door)) doors = [...doors, b.door]
        }
        return doors
    }

    function updateCollision(s: DfSnapshot): void {
        const doors = doorsWithPredicted(s.world)
        const dk = doors.join(',')
        if (dk !== doorsKey) {
            doorsKey = dk
            collision = dfBuildCollision(DF_MAP, new Set(doors))
        }
    }

    /** Settles predictions against a fresh snapshot: rejected shots, kills the server didn't take, buys it never confirmed. */
    function reconcilePredictions(s: DfSnapshot): void {
        const settled = (ack: number, at: number) => dfPredictionSettled(ack, s.ack, time - at, net.rtt)
        for (const [shot, pp] of pendingPoints) if (settled(pp.ack, pp.at)) pendingPoints.delete(shot)
        for (const [id, list] of pendingDamage) {
            const keep = list.filter(d => !settled(d.ack, d.at))
            if (keep.length) pendingDamage.set(id, keep)
            else pendingDamage.delete(id)
        }
        if (predictedDead.size) {
            const alive = new Set(s.zombies.map(z => z.id))
            for (const [id, d] of predictedDead) {
                if (!alive.has(id)) {
                    if (time - d.at > 4) predictedDead.delete(id)
                } else if (settled(d.ack, d.at)) {
                    // the server kept it alive (a refused shot): bring it back
                    predictedDead.delete(id)
                    smoother.forget(id)
                    try {
                        zombieView.unkill?.(id)
                    } catch (e) {
                        console.error('[dead-front] zombie view unkill', e)
                    }
                }
            }
        }
        for (let i = pendingBuys.length - 1; i >= 0; i--) {
            const b = pendingBuys[i]!
            if (b.door && s.world.doors.includes(b.door)) {
                pendingBuys.splice(i, 1)
            } else if (settled(b.ack, b.at)) {
                // the server answered without a `buy`: the points come back on screen
                pendingBuys.splice(i, 1)
                audio.play(DF_SND.denied, { volume: 0.6 })
            }
        }
    }

    /** Settles the oldest pending buy matching a confirmed `buy` event. */
    function confirmBuy(what: string): boolean {
        const id = what.startsWith('door:') ? what.slice(5) : null
        const i = pendingBuys.findIndex(b => (id !== null ? b.door === id : !b.door))
        if (i < 0) return false
        pendingBuys.splice(i, 1)
        return true
    }

    function shownPerks(p: DfPlayerSnap): DfPlayerSnap['perks'] {
        let perks = p.perks
        for (const b of pendingBuys) {
            if (b.perk && !perks.includes(b.perk)) perks = [...perks, b.perk]
        }
        return perks
    }

    function pendingSpend(): number {
        let n = 0
        for (const b of pendingBuys) n += b.cost
        return n
    }

    function pendingGain(): number {
        let n = 0
        for (const pp of pendingPoints.values()) n += pp.amount
        return n
    }

    /** Points as this client shows them: the server's plus predicted earnings, minus optimistic spends. */
    function shownPoints(p: DfPlayerSnap): number {
        return Math.max(0, p.points + pendingGain() - pendingSpend())
    }

    /** Solo pause: the server freezes the match (and sends no snapshots meanwhile). */
    function sendPause(paused: boolean): void {
        pausedByMe = paused && solo
        net.send({ t: 'pause', paused })
    }

    function popup(amount: number, gold: boolean): void {
        hud.popups.push({ id: ++popupId, pid: me, amount, gold, dx: Math.random() * 2 - 1, born: time })
        if (hud.popups.length > 16) hud.popups.shift()
    }

    /** Floats a hit's points up off the zombie, at the point it was hit. */
    function hitPop(at: Vec3, amount: number, kind: 'hit' | 'kill' | 'head'): void {
        if (amount <= 0) return
        const slot = hitPopSeq++ % DF_HUD_HIT_POPS
        const i = hud.hitPops.findIndex(p => p.slot === slot)
        if (i >= 0) hud.hitPops.splice(i, 1)
        hitPopAt[slot]!.set(at.x, at.y, at.z)
        hud.hitPops.push({ id: ++popupId, slot, amount, kind, gold: (latest?.world.double ?? 0) > 0, dx: Math.random() * 2 - 1, born: time })
    }

    // ---------------------------------------------------------------- hit / kill prediction
    /** Server-side max health of a zombie of this type this round. */
    function zombieMaxHp(z: DfZombieSnap): number {
        return Math.round(dfZombieBaseHealth(Math.max(1, latest?.round ?? 1)) * DF_ENEMIES[z.type].healthMult)
    }

    /** Health left as far as this client knows: the newest snapshot minus our damage it doesn't show yet. */
    function zombieHpLeft(z: DfZombieSnap): number {
        const snap = buffer.latest?.zombies.get(z.id) ?? z
        let hp = snap.hp * zombieMaxHp(z)
        for (const d of pendingDamage.get(z.id) ?? []) hp -= d.dmg
        return hp
    }

    /**
     * Predicts one hit (bullet or knife). Returns the base points it pays and
     * whether it kills; a predicted kill hides the zombie and plays the death
     * right now. Brute helmets soak head hits like the server's.
     */
    function predictHit(z: DfZombieSnap, dmg: number, zone: DfHitZone, shot: number, melee: boolean): { points: number, kill: boolean } {
        if (predictedDead.has(z.id)) return { points: 0, kill: false }
        const insta = (latest?.world.insta ?? 0) > 0
        if (!insta && zone === 'head' && z.armored) return { points: DF_POINTS.hit, kill: false }
        const left = zombieHpLeft(z)
        let list = pendingDamage.get(z.id)
        if (!list) pendingDamage.set(z.id, list = [])
        list.push({ dmg, shot, at: time, ack: seq + 1 })
        if (!insta && left - dmg > 0) return { points: DF_POINTS.hit, kill: false }
        predictKill(z, zone, melee ? 'knife' : gun.id)
        return { points: dfKillPoints(zone, melee), kill: true }
    }

    function predictKill(z: DfZombieSnap, zone: DfHitZone, weapon: Extract<DfEvent, { k: 'kill' }>['weapon']): void {
        predictedDead.set(z.id, { at: time, ack: seq + 1 })
        try {
            zombieView.onEvent({ k: 'kill', z: z.id, p: me, zone, weapon, pos: { x: z.pos.x, y: z.pos.y, z: z.pos.z } })
        } catch (e) {
            console.error('[dead-front] zombie view predicted kill', e)
        }
        killFeedback(zone === 'head')
    }

    function killFeedback(head: boolean): void {
        hud.hitmarker = { key: hud.hitmarker.key + 1, kind: head ? 'head' : 'kill' }
        hud.killKey++
        killPunch = head ? 1 : 0.6
        fx.shake(head ? 0.07 : 0.045)
        audio.play(head ? DF_SND.killHead : DF_SND.kill, { volume: 0.75 })
    }

    /** One hit's points as the server pays them (perk multiplier and double points, rounded per hit). */
    function scalePoints(base: number): number {
        return base > 0 ? dfScalePoints(base, effects.pointsMult, (latest?.world.double ?? 0) > 0) : 0
    }

    /** Shows a shot's predicted points at once and remembers them for the server's echo. */
    function predictPoints(shot: number, amount: number): void {
        if (amount <= 0) return
        pendingPoints.set(shot, { amount, at: time, ack: seq + 1 })
        popup(amount, (latest?.world.double ?? 0) > 0)
        audio.play(DF_SND.points, { volume: 0.5, rate: amount >= 100 ? 1.12 : 1 })
    }

    function handleImmediate(ev: DfEvent, s: DfSnapshot): void {
        try {
            arsenal.onEvent(ev)
        } catch (e) {
            console.error('[dead-front] arsenal event', e)
        }
        switch (ev.k) {
            case 'points': {
                if (ev.p === me && ev.shot !== undefined) {
                    // our own shot's points: settle the prediction (shots resolve in order, so older
                    // unanswered ones were refused) and only show what the prediction got wrong
                    const pred = pendingPoints.get(ev.shot)
                    for (const k of pendingPoints.keys()) if (k <= ev.shot) pendingPoints.delete(k)
                    for (const [id, list] of pendingDamage) {
                        const keep = list.filter(d => d.shot > ev.shot!)
                        if (keep.length) pendingDamage.set(id, keep)
                        else pendingDamage.delete(id)
                    }
                    if (pred) {
                        const diff = ev.amount - pred.amount
                        if (diff > 0) popup(diff, s.world.double > 0)
                        break
                    }
                }
                hud.popups.push({ id: ++popupId, pid: ev.p, amount: ev.amount, gold: s.world.double > 0, dx: Math.random() * 2 - 1, born: time })
                if (hud.popups.length > 16) hud.popups.shift()
                if (ev.p === me && ev.amount > 0) audio.play(DF_SND.points, { volume: 0.5, rate: ev.amount >= 100 ? 1.12 : 1 })
                break
            }
            case 'hit': {
                if (ev.p !== me) break
                // our own hits already marked and sounded when we fired (the echo may come late on a slow line)
                if (time - predictedHitAt > 0.3 && time - (predictedFlinch.get(ev.z) ?? -10) > 1.5) {
                    hud.hitmarker = { key: hud.hitmarker.key + 1, kind: 'hit' }
                    audio.play(ev.zone === 'head' ? DF_SND.head : DF_SND.hit, { volume: 0.7 })
                } else if (ev.zone === 'head' && hud.hitmarker.kind === 'hit') {
                    audio.play(DF_SND.head, { volume: 0.5 })
                }
                break
            }
            case 'kill': {
                // a kill we predicted already played its feedback
                if (ev.p !== me || predictedDead.has(ev.z)) break
                killFeedback(ev.zone === 'head')
                break
            }
            case 'zhit': {
                if (ev.p !== me) break
                const z = s.zombies.find(x => x.id === ev.z)
                if (z) addDamageIndicator(z.pos.x, z.pos.z)
                damagePulse = Math.min(1, damagePulse + 0.45 + ev.dmg / 200)
                fx.shake(0.18 + Math.min(0.3, ev.dmg / 300))
                audio.play(DF_SND.hurt, { volume: 0.8, rate: 0.9 + Math.random() * 0.2 })
                break
            }
            case 'round': {
                hud.round = ev.round
                hud.roundKey++
                audio.play(DF_SND.roundStart, { volume: 0.9 })
                if (s.world.special?.kind === 'gas') {
                    // a gas round (specials.ts): the alarm, and masks on
                    audio.play(DF_SPECIAL_SND.gasAlarm, { volume: 1 })
                    announce('GAS! GAS! GAS!', `Round ${ev.round} · masks on, they come through the fog`, 'gold')
                } else {
                    announce(`Round ${ev.round}`, ROUND_LINES[Math.floor(Math.random() * ROUND_LINES.length)]!, 'red')
                }
                break
            }
            case 'streak': {
                if (ev.p !== me) break
                const tier = ev.kind === 'double' ? 1 : ev.kind === 'triple' ? 2 : ev.kind === 'multi' ? 3 : 4
                audio.play(ev.kind === 'head' ? DF_SPECIAL_SND.calloutHead : DF_SPECIAL_SND.callout(tier), { volume: 0.8 })
                // a double only rings; bigger streaks get the banner
                if (ev.kind !== 'double') announce(ev.kind === 'head' ? `${DF_STREAK_TITLES.head} ×${ev.n}` : DF_STREAK_TITLES[ev.kind], `+${ev.bonus}`, 'gold')
                break
            }
            case 'roundEnd': {
                audio.play(DF_SND.roundEnd, { volume: 0.85 })
                announce('Round survived', 'Regroup before the next wave', 'pale')
                break
            }
            case 'powerup': {
                audio.play(DF_SND.powerup(ev.kind), { volume: 0.9 })
                announce(DF_POWERUP_NAMES[ev.kind] ?? 'Power-up', ev.p === me ? 'You picked it up' : `${playerName(ev.p)} picked it up`, 'gold')
                if (ev.kind === 'nuke') gradeFlash = 1
                break
            }
            case 'buy': {
                // an optimistic buy already played its sound
                if (ev.p === me && !confirmBuy(ev.what)) audio.play(DF_SND.buy, { volume: 0.7 })
                break
            }
            case 'down': {
                if (ev.p === me) {
                    audio.play(DF_SND.down)
                    fx.shake(0.4)
                }
                // a teammate going down shows in the squad feed
                break
            }
            case 'revived': {
                if (ev.p === me || ev.by === me) audio.play(DF_SND.revive, { volume: 0.8 })
                if (ev.p === me) {
                    downBlend = Math.min(downBlend, 0.6)
                }
                break
            }
            case 'bleedout': {
                // teammates' bleed-outs show in the squad feed
                if (ev.p === me) announce('You bled out', 'You return next round', 'red')
                break
            }
            case 'respawn': {
                if (ev.p === me) {
                    const p = s.players.find(x => x.pid === me)
                    if (p) player.teleport(p.pos)
                    spectatePid = -1
                    avatars.hidden = -1
                }
                break
            }
            case 'chat': {
                hud.chat.push({ id: ++chatId, name: ev.name, text: ev.text, born: time })
                if (hud.chat.length > 6) hud.chat.shift()
                break
            }
            case 'egg': {
                if (ev.step !== 'done') announce('New objective', dfObjectiveText(ev.step), 'pale')
                else announce('The Arc Generator is spent', 'The wonder weapon is claimed', 'gold')
                break
            }
            case 'rod': {
                if (ev.on && ev.n !== undefined && ev.n < (dfEggRodSpots(DF_MAP).length || 3)) announce('Lightning rod thrown', `${ev.n}/${dfEggRodSpots(DF_MAP).length || 3} · keep moving`, 'pale')
                else if (!ev.on && (ev.n ?? 0) === 0) {
                    announce('The rods lost their charge', 'Throw all three before the clock runs out', 'red')
                    audio.play(DF_SND.denied, { volume: 0.8 })
                }
                break
            }
            case 'fuse': {
                const found = s.world.egg.fusesFound.length
                announce('Tesla fuse recovered', `${found}/${DF_MAP.egg.fuses.length || 3}`, 'pale')
                break
            }
            default:
                break
        }
    }

    /** View events, released when the render clock reaches their snapshot. */
    function dispatchView(ev: DfEvent): void {
        try {
            worldView.onEvent(ev)
        } catch (e) {
            console.error('[dead-front] world view event', e)
        }
        try {
            // our own hits already flinched locally when we fired
            const echo = (ev.k === 'hit' && ev.p === me && time - (predictedFlinch.get(ev.z) ?? -10) < 1.5)
                || ((ev.k === 'kill' || ev.k === 'hit') && predictedDead.has(ev.z))
            if (!echo) zombieView.onEvent(ev)
        } catch (e) {
            console.error('[dead-front] zombie view event', e)
        }
        try {
            projectileView.onEvent(ev)
        } catch (e) {
            console.error('[dead-front] projectile view event', e)
        }
        if (ev.k === 'shot' && ev.p !== me) remoteShot(ev)
    }

    function remoteShot(ev: Extract<DfEvent, { k: 'shot' }>): void {
        const from = avatars.muzzle(ev.p, tmpV) ?? tmpV.set(ev.from.x, ev.from.y, ev.from.z)
        let shot: DfWeaponStats['shot'] = 'hitscan'
        try {
            shot = dfWeaponStats(ev.weapon, ev.pap).shot
        } catch {
            // keep hitscan
        }
        try {
            audio.play(dfShotSoundName(ev.weapon, ev.pap), { pos: from })
        } catch {
            // ignore
        }
        avatars.fired(ev.p)
        // in the weapon's own colour: the X-Ray and Pack-a-Punched guns flash in their tier's
        fx.flash(from, ev.pap > 0 || ev.weapon === 'xray' || ev.weapon === 'wunder' ? dfMuzzleFlashColor(ev.weapon, ev.pap) : 0xffb060, 20, 0.06)
        if (shot !== 'hitscan') return
        if (DF_WEAPONS[ev.weapon]?.flame) {
            // a flamethrower: a jet of fire toward where it was aimed, no tracer or impact
            const fdx = ev.to.x - from.x
            const fdy = ev.to.y - from.y
            const fdz = ev.to.z - from.z
            const fl = Math.sqrt(fdx * fdx + fdy * fdy + fdz * fdz) || 1
            tmpV2.set(fdx / fl, fdy / fl, fdz / fl)
            fx.burst('flame', from, { normal: tmpV2, count: 3 })
            return
        }
        fx.tracer(from, ev.to)
        // impact on the world, if the shot ended on a surface
        const dx = ev.to.x - ev.from.x
        const dy = ev.to.y - ev.from.y
        const dz = ev.to.z - ev.from.z
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d < 0.5) return
        shotDir.x = dx / d
        shotDir.y = dy / d
        shotDir.z = dz / d
        const hit = dfRaycast(collision, ev.from, shotDir, d + 0.2)
        if (hit && Math.abs(hit.dist - d) < 0.35) surfaceFx(hit.point, hit.normal, hit.mat)
    }

    /** A gas round's pockets roll with mustard fog, and standing in one makes you cough. */
    function updateGas(dt: number): void {
        const sp = latest?.world.special
        const pockets = sp?.kind === 'gas' ? sp.pockets : null
        if (!pockets?.length) {
            coughIn = 0
            return
        }
        gasPuffIn -= dt
        while (gasPuffIn <= 0) {
            gasPuffIn += 0.12
            const g = pockets[Math.floor(Math.random() * pockets.length)]!
            const a = Math.random() * Math.PI * 2
            const r = Math.sqrt(Math.random()) * g.r * 0.85
            fx.burst('gas', { x: g.x + Math.cos(a) * r, y: g.y + 0.1, z: g.z + Math.sin(a) * r }, { count: 2, scale: 0.9 })
        }
        const depth = life === 'alive' ? dfGasDepth(pockets, player.pos) : 0
        if (depth < 0.2) {
            // the first cough comes soon after stepping in
            coughIn = Math.min(coughIn, 0.5)
            return
        }
        coughIn -= dt
        if (coughIn <= 0) {
            coughIn = 2.8 + Math.random() * 2.4
            audio.play(DF_SPECIAL_SND.cough, { volume: 0.45 + depth * 0.4 })
        }
    }

    // ---------------------------------------------------------------- shooting
    function fire(now: number): void {
        const s = stats
        if (!s || !mine) return
        aimDirection(aim)
        eye.x = camera.position.x
        eye.y = camera.position.y
        eye.z = camera.position.z
        const moveFrac = Math.min(1, player.speed / Math.max(0.1, DF_PLAYER.sprintSpeed))
        const spread = dfSpread({
            hipSpread: s.hipSpread,
            adsSpread: s.adsSpread,
            adsBlend: viewmodel.adsBlend,
            spreadMult: effects.spreadMult,
            move: moveFrac,
            airborne: !player.grounded,
            crouched: player.crouched,
            bloom: gun.bloom
        })
        const pellets = Math.max(1, Math.round(s.pellets))
        const dirs: Vec3[] = []
        const hits: DfShotHit[] = []
        const hitscan = s.shot === 'hitscan'
        const flame = !!DF_WEAPONS[gun.id]?.flame
        let tracerEnd: Vec3 | null = null
        let claimed = false
        for (let i = 0; i < pellets; i++) {
            dfConeDir(aim, spread, randomFloat(), randomFloat(), shotDir)
            const dir = { x: shotDir.x, y: shotDir.y, z: shotDir.z }
            dirs.push(dir)
            if (!hitscan) continue
            const maxRange = s.maxRange > 0 ? s.maxRange : 120
            const wh = dfRaycast(collision, eye, dir, maxRange)
            const limit = wh ? wh.dist : maxRange
            // every zombie along the ray before the wall, nearest first
            const cands: DfShotHit[] = []
            for (const z of zList) {
                if (predictedDead.has(z.id)) continue
                const h = dfZombieHitTest(z, eye, dir, limit)
                if (h) cands.push({ z: z.id, zone: h.zone, dist: h.dist })
            }
            cands.sort((a, b) => a.dist - b.dist)
            const through = 1 + Math.max(0, Math.floor(s.penetration))
            const n = Math.min(through, cands.length)
            for (let k = 0; k < n; k++) {
                const c: DfShotHit = cands[k]!
                hits.push(c)
                localHits.push({ z: c.z, zone: c.zone, pos: { x: eye.x + dir.x * c.dist, y: eye.y + dir.y * c.dist, z: eye.z + dir.z * c.dist } })
            }
            if (n > 0) claimed = true
            const stopped = n > 0 && n >= through
            if (wh && !stopped) {
                if (!flame) surfaceFx(wh.point, wh.normal, wh.mat)
                else if (i === 0 && wh.dist < 6 && shotCount % 4 === 0) fx.decal(wh.point, wh.normal, 'scorch', 0.35)
                if (i === 0) tracerEnd = wh.point
            } else if (i === 0) {
                const d = stopped ? cands[n - 1]!.dist : maxRange
                tracerEnd = { x: eye.x + dir.x * d, y: eye.y + dir.y * d, z: eye.z + dir.z * d }
            }
        }
        // predict every hit now: damage, kills (the zombie drops on this frame) and points
        const shot = ++shotSeq
        let base = 0
        let killed = false
        // one number per zombie per shot (a shotgun's pellets add up), at its first hit
        const pops = new Map<number, { at: Vec3, amount: number, kind: 'hit' | 'kill' | 'head' }>()
        for (let i = 0; i < hits.length; i++) {
            const h = hits[i]!
            const z = zList.find(q => q.id === h.z)
            if (!z) continue
            const r = predictHit(z, dfBulletDamage(s, effects, h.zone, h.dist, life === 'down'), h.zone, shot, false)
            // a flame jet pays its +10 per zombie every DF_FLAME_POINT_INTERVAL, like the server
            if (flame && !r.kill && !dfFlameHitPays(flamePaid, z.id, time)) r.points = 0
            const pts = scalePoints(r.points)
            base += pts
            if (r.kill) {
                h.kill = true
                killed = true
            }
            const pop = pops.get(h.z)
            const kind = r.kill ? (h.zone === 'head' ? 'head' : 'kill') : 'hit'
            if (pop) {
                pop.amount += pts
                if (r.kill) pop.kind = kind
            } else {
                pops.set(h.z, { at: localHits[i]!.pos, amount: pts, kind })
            }
        }
        predictPoints(shot, base)
        for (const pop of pops.values()) hitPop(pop.at, pop.amount, pop.kind)
        // the wunderweapon claims the zombie its arc takes on this screen (point blank included); the server chains from it
        const claims = s.shot === 'arc' ? arcClaim(eye, dirs[0]!, s.maxRange > 0 ? s.maxRange : 40) : hits
        net.send({ t: 'fire', origin: { x: eye.x, y: eye.y, z: eye.z }, dirs, hits: claims, shot, mag: Math.max(0, gun.mag - 1), weapon: gun.id })
        markAmmo()
        // the zombie flinches (and bleeds) on this frame, not a round trip later; the server's echo is skipped
        for (let i = 0; i < localHits.length; i++) {
            const h = localHits[i]!
            if (localHits.findIndex(o => o.z === h.z) !== i || predictedDead.has(h.z)) continue
            predictedFlinch.set(h.z, time)
            try {
                zombieView.onEvent({ k: 'hit', z: h.z, p: me, zone: h.zone, pos: h.pos, dmg: Math.round(s.damage) })
            } catch (e) {
                console.error('[dead-front] zombie view predicted hit', e)
            }
        }
        localHits.length = 0
        if (predictedFlinch.size > 64) {
            for (const [z, at] of predictedFlinch) if (time - at > 2) predictedFlinch.delete(z)
        }
        if (gun.reloading) safe('vm cancel', () => viewmodel.cancelReload(), undefined)
        gun.fired(now, effects.fireRateMult)
        lastShot = now
        shotCount++
        safe('vm fire', () => viewmodel.fire(), undefined)
        // recoil
        const ads = viewmodel.adsBlend
        const kick = Math.max(0, s.recoil) * effects.recoilMult * (1 - ads * 0.35) * (player.crouched ? 0.85 : 1)
        fx.shake(recoil.kick(now, gun.cls, gun.auto, kick, Math.random(), gun.id))
        // muzzle light in both scenes
        viewmodel.muzzleWorld(camera, tmpV2)
        // candela: has to beat the ~5-12 cd lantern pools to visibly light the surroundings
        // (one pooled light per shot; Pack-a-Punched guns flash in their tier colour)
        const flashColor = dfMuzzleFlashColor(gun.id, gun.pap)
        fx.flash(tmpV2, flashColor, flame ? 16 : 28, flame ? 0.12 : 0.06)
        vmMuzzle.color.set(flashColor)
        vmMuzzle.intensity = flame ? 2.2 : s.shot === 'hitscan' ? 3 : 1.5
        // burning: embers lick off whatever the jet touched
        if (flame) {
            let n = 0
            for (const pop of pops.values()) {
                if (n++ >= 3) break
                fx.burst('embers', pop.at, { count: 2, scale: 0.6 })
            }
        }
        // tracers on some rounds
        if (hitscan && tracerEnd && !flame) {
            const every = gun.auto ? 3 : pellets > 1 ? 1 : 2
            if (shotCount % every === 0) fx.tracer(tmpV2, tracerEnd)
        }
        if (claimed) {
            predictedHitAt = time
            const head = hits.some(h => h.zone === 'head')
            // a predicted kill already set the kill marker and sound
            if (!killed) {
                hud.hitmarker = { key: hud.hitmarker.key + 1, kind: 'hit' }
                audio.play(head ? DF_SND.head : DF_SND.hit, { volume: 0.7 })
            }
        }
        if (gun.mag <= 0) reloadEmptyPending = true
    }

    /** A local ammo change just went out: older snapshots must not overwrite the magazine. */
    function markAmmo(): void {
        ammoAck = seq + 1
        ammoAt = time
    }

    /** The zombie the wunderweapon's arc takes first, as drawn (the server takes the claim within sanity bounds). */
    function arcClaim(from: Vec3, dir: Vec3, range: number): DfShotHit[] {
        let best: DfShotHit | null = null
        let bestScore = Infinity
        for (const z of zList) {
            if (predictedDead.has(z.id)) continue
            const aim = dfArcAim(dfArcBody(z.type, z.pos, z.crawl), from, dir, range)
            if (!aim || aim.score >= bestScore) continue
            // a wall in between blocks it (the eye pressed against a body is always clear)
            const dx = aim.point.x - from.x
            const dy = aim.point.y - from.y
            const dz = aim.point.z - from.z
            const l = Math.sqrt(dx * dx + dy * dy + dz * dz)
            if (l > 0.05) {
                shotDir.x = dx / l
                shotDir.y = dy / l
                shotDir.z = dz / l
                if (dfRaycast(collision, from, shotDir, l - 0.05)) continue
            }
            best = { z: z.id, zone: 'body', dist: aim.dist }
            bestScore = aim.score
        }
        return best ? [best] : []
    }

    function tryReload(now: number): void {
        if (!gun.canReload() || !stats) return
        const empty = gun.mag === 0
        const t = gun.startReload(now, effects.reloadMult)
        if (t <= 0) return
        reloadHoldsSprint = true
        // the reload runs here; the server hears the start (remote animation, perks) and the result
        net.send({ t: 'reload' })
        safe('vm reload', () => viewmodel.reload(empty, t, gun.shellMode), undefined)
    }

    function melee(now: number): void {
        if (now < meleeReadyAt || !mine) return
        meleeReadyAt = now + DF_MELEE.cooldown
        hints.done('knife')
        aimDirection(aim)
        const reach = DF_MELEE.range + effects.meleeLunge
        let best: DfZombieSnap | null = null
        let bestD = Infinity
        const fl = Math.sqrt(aim.x * aim.x + aim.z * aim.z) || 1
        for (const z of zList) {
            const dx = z.pos.x - player.pos.x
            const dz = z.pos.z - player.pos.z
            const dy = z.pos.y - player.pos.y
            if (Math.abs(dy) > 1.4) continue
            const d = Math.sqrt(dx * dx + dz * dz) - DF_ENEMIES[z.type].radius
            if (d > reach) continue
            const facing = d < 0.3 ? 1 : (dx * aim.x / fl + dz * aim.z / fl) / Math.max(0.01, d + DF_ENEMIES[z.type].radius)
            if (facing < 0.6) continue
            if (d < bestD) {
                bestD = d
                best = z
            }
        }
        interruptReload(now)
        safe('vm melee', () => viewmodel.melee(), undefined)
        if (!best) {
            net.send({ t: 'melee' })
            return
        }
        // lunge toward a target that's a step away
        if (bestD > 0.7) {
            const dx = best.pos.x - player.pos.x
            const dz = best.pos.z - player.pos.z
            const l = Math.sqrt(dx * dx + dz * dz) || 1
            const v = Math.min(9, (bestD - 0.45) / 0.14)
            player.vel.x = (dx / l) * v
            player.vel.z = (dz / l) * v
            audio.play(DF_SND.lunge, { volume: 0.6 })
        }
        eye.x = camera.position.x
        eye.y = camera.position.y
        eye.z = camera.position.z
        const h = dfZombieHitTest(best, eye, aim, reach + 1)
        const zone: DfHitZone = h?.zone === 'head' ? 'head' : 'body'
        const shot = ++shotSeq
        const r = predictHit(best, DF_MELEE.damage * effects.meleeMult, zone, shot, true)
        predictPoints(shot, scalePoints(r.points))
        hitPop({ x: best.pos.x, y: best.pos.y + 1.3, z: best.pos.z }, scalePoints(r.points), r.kill ? 'kill' : 'hit')
        net.send({ t: 'melee', z: best.id, zone, shot, kill: r.kill || undefined })
        predictedHitAt = time
        if (!r.kill) {
            hud.hitmarker = { key: hud.hitmarker.key + 1, kind: 'hit' }
            predictedFlinch.set(best.id, time)
            try {
                zombieView.onEvent({ k: 'hit', z: best.id, p: me, zone, pos: { x: best.pos.x, y: best.pos.y + DF_ENEMIES[best.type].height * 0.6, z: best.pos.z }, dmg: Math.round(DF_MELEE.damage * effects.meleeMult) })
            } catch (e) {
                console.error('[dead-front] zombie view predicted melee hit', e)
            }
        }
    }

    function throwGrenade(now: number): void {
        if (!mine || mine.grenades <= 0 || now < grenadeReadyAt) return
        grenadeReadyAt = now + 1
        aimDirection(aim)
        const up = 0.18
        const dx = aim.x
        const dy = aim.y + up
        const dz = aim.z
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
        net.send({ t: 'grenade', origin: { x: camera.position.x, y: camera.position.y - 0.1, z: camera.position.z }, dir: { x: dx / l, y: dy / l, z: dz / l } })
        audio.play(DF_SND.throw, { volume: 0.7 })
        safe('vm melee', () => viewmodel.melee(), undefined)
    }

    function swapTo(slot: number, now: number, cycle = false): void {
        if (!mine || life === 'dead') return
        if (life === 'down') return
        const count = mine.weapons.length
        if (count < 2) return
        let s = ((slot % count) + count) % count
        // a slot waiting on the Pack-a-Punch is skipped by the wheel and ignored by its key
        if (mine.weapons[s]?.away) {
            if (!cycle) return
            const dir = slot > localSlot ? 1 : -1
            for (let k = 0; k < count && mine.weapons[s]?.away; k++) s = (((s + dir) % count) + count) % count
            if (mine.weapons[s]?.away) return
        }
        if (s === localSlot) return
        interruptReload(now)
        localSlot = s
        swapPendingUntil = now + 1.2
        net.send({ t: 'swap', slot: s })
        const w = mine.weapons[s]
        if (w) equip(w, now)
    }

    // ---------------------------------------------------------------- interaction
    function updatePrompt(): void {
        currentPrompt = null
        if (!mine || !latest || life !== 'alive') return
        // affordability and owned perks as this client shows them (predictions included)
        const shown = shownPoints(mine)
        const meShown = shown === mine.points && !pendingBuys.some(b => b.perk) ? mine : { ...mine, points: shown, perks: shownPerks(mine) }
        const world = pendingBuys.some(b => b.door) ? { ...latest.world, doors: doorsWithPredicted(latest.world) } : latest.world
        const pctx = { map: DF_MAP, world, me: meShown, solo, benchPick: arsenal.pick }
        // downed teammates first
        let bestRevive: DfPrompt | null = null
        let bestD = Infinity
        for (const p of latest.players) {
            if (p.pid === me || p.life !== 'down') continue
            const ip = pList.find(x => x.pid === p.pid)
            const pos = ip?.pos ?? p.pos
            const dx = pos.x - player.pos.x
            const dz = pos.z - player.pos.z
            const d = Math.sqrt(dx * dx + dz * dz)
            if (d < DF_PLAYER.useRange + 0.3 && d < bestD && Math.abs(pos.y - player.pos.y) < 1.5) {
                bestD = d
                bestRevive = dfRevivePrompt(p, mine)
            }
        }
        if (bestRevive) {
            currentPrompt = bestRevive
            return
        }
        aimDirection(aim)
        fwdFlat.x = aim.x
        fwdFlat.z = aim.z
        // an upgrade kit on the ground in front of us comes first
        const kitPrompt = arsenal.prompt(meShown, world)
        if (kitPrompt) {
            currentPrompt = kitPrompt
            return
        }
        const idx = dfPickInteractable(interactables, camera.position, fwdFlat.x, fwdFlat.z, DF_PLAYER.useRange, (i) => dfPromptFor(interactables[i]!, pctx) === null)
        if (idx < 0) return
        currentPrompt = dfPromptFor(interactables[idx]!, pctx)
    }

    /**
     * Instant feedback for a purchase the client already knows it can afford:
     * the points come off and the buy sounds now; a door opens (and stops
     * blocking) at once; a perk shows on the HUD. Settled by the server's
     * `buy` event, rolled back if it never comes.
     */
    function buyOptimistic(p: DfPrompt): void {
        if (pendingBuys.length >= 4) return
        const it = interactables.find(i => i.id === p.id)
        const door = p.kind === 'door' && it ? (it.ref ?? it.id) : undefined
        const perk = p.kind === 'perk' && it?.ref && DF_PERKS[it.ref as keyof typeof DF_PERKS] ? it.ref as DfPlayerSnap['perks'][number] : undefined
        pendingBuys.push({ id: p.id, cost: p.cost ?? 0, at: time, ack: seq + 1, door, perk })
        audio.play(DF_SND.buy, { volume: 0.7 })
        if (door && latest) {
            updateCollision(latest)
            try {
                worldView.onEvent({ k: 'door', id: door })
            } catch (e) {
                console.error('[dead-front] world view predicted door', e)
            }
        }
        currentPrompt = null
        hud.prompt = null
    }

    function handleUse(now: number): void {
        const p = currentPrompt
        const held = input.has('KeyF')
        // revive is hold-to-act
        if (p?.action === 'revive' && held) {
            if (reviveTarget !== p.pid) {
                reviveTarget = p.pid ?? null
                net.send({ t: 'revive', pid: reviveTarget })
            }
        } else if (reviveTarget !== null) {
            reviveTarget = null
            net.send({ t: 'revive', pid: null })
        }
        if (!p || p.action !== 'use') return
        if (input.pressed('KeyF') && now >= useCooldown) {
            if (p.cost !== null && !p.ok) {
                audio.play(DF_SND.denied, { volume: 0.7 })
                if (hud.prompt) hud.prompt.denyKey++
                useCooldown = now + 0.35
                return
            }
            net.send({ t: 'use', id: p.id })
            if (p.cost !== null && p.cost > 0) buyOptimistic(p)
            if (p.kind === 'wallbuy') hints.done('wallbuy')
            else if (p.kind === 'door') hints.done('doors')
            else if (p.kind === 'power') hints.done('power')
            else if (p.kind === 'barricade') hints.done('rebuild')
            useCooldown = now + 0.4
            useRepeatAt = now + 0.25
        } else if (p.repeat && held && now >= useRepeatAt) {
            net.send({ t: 'use', id: p.id })
            useRepeatAt = now + 0.25
        }
    }

    // ---------------------------------------------------------------- per-frame input
    const lookIn = { x: 0, y: 0 }
    /** Mouse movement applied this frame (pixels), for the viewmodel's sway. */
    const frameLook = { x: 0, y: 0 }
    /** The trigger press was already handled on the mousedown event itself. */
    let pressHandled = false
    /** ADS was pressed after sprint: holding both aims. A fresh sprint press flips it back. */
    let adsOverSprint = false
    /** A reload in progress keeps a held sprint key from cancelling it; a fresh press does cancel. */
    let reloadHoldsSprint = false
    let wasSprinting = false
    /** The right button that closed the workbench shop: it doesn't aim until it's let go. */
    let shopRmb = false

    /** Turns the mouse movement gathered so far into yaw / pitch (no smoothing, no acceleration). */
    function applyLook(): void {
        input.takeLook(lookIn)
        if (!input.locked || (lookIn.x === 0 && lookIn.y === 0)) return
        // the view holds still while the workbench shop is open
        if (arsenal.shopOpen) return
        frameLook.x += lookIn.x
        frameLook.y += lookIn.y
        const zoom = 1 + ((stats?.adsZoom ?? 1) - 1) * viewmodel.adsBlend
        const sens = 0.0022 * settings.sensitivity / (1 + (zoom - 1) * 0.85)
        player.yaw = dfWrapAngle(player.yaw - lookIn.x * sens)
        const dPitch = -lookIn.y * sens * (settings.invertY ? -1 : 1)
        player.pitch += dPitch
        // pulling down against the climb counts as recoil control
        if (dPitch < 0) player.pitch += recoil.compensate(-dPitch)
        player.pitch = Math.max(-1.52, Math.min(1.52, player.pitch))
    }

    /** The clock at this instant (between frames), never behind the frame clock. */
    function eventTime(): number {
        return time + Math.min(0.1, Math.max(0, (performance.now() - last) / 1000))
    }

    /**
     * A trigger pull. Called from the mousedown event, so a shot leaves (hit
     * test, prediction, the message to the server, the viewmodel kick) the
     * moment the button goes down rather than on the next frame; the frame then
     * only draws it. Look gathered since the last frame is applied first, so
     * the shot goes where the crosshair is now.
     */
    function pullTrigger(now: number): void {
        gun.press(now)
        if (player.sprinting) sprintLockUntil = now + 0.3
        if (gun.mag <= 0 && gun.canReload()) {
            tryReload(now)
            return
        }
        // out of everything: the hammer falls on nothing
        if (gun.mag <= 0 && !gun.reloading) audio.play(DF_WSND.dry, { volume: 0.6 })
        if (!player.sprinting && gun.canFire(now, true)) fire(now)
    }

    function onTriggerEvent(code: string): void {
        if (code !== 'Mouse0' || disposed || !spawned || !input.locked || life === 'dead' || !mine || arsenal.shopOpen) return
        applyLook()
        pressHandled = true
        pullTrigger(eventTime())
    }

    /** Drops a reload in progress (sprint, swap, knife); a seated magazine is kept and reported. */
    function interruptReload(now: number): void {
        if (!gun.reloading) return
        gun.cancelReload(now)
        safe('vm cancel', () => viewmodel.cancelReload(), undefined)
        // the server runs its own reload timer: settle it with what we have now
        net.send({ t: 'reload', mag: gun.mag, weapon: gun.id })
        markAmmo()
    }

    function handleInput(dt: number, now: number): void {
        const locked = input.locked
        if (locked !== wasLocked) {
            wasLocked = locked
            hud.locked = locked
        }
        // look: raw, unsmoothed, applied this frame
        applyLook()
        vmInput.look.x = locked ? frameLook.x : 0
        vmInput.look.y = locked ? frameLook.y : 0
        hud.scoreboard = locked && input.has('Tab')

        const alive = life !== 'dead'
        const canAct = locked && alive && spawned
        // the open workbench shop holds the player still (WASD browse it)
        const shop = arsenal.shopOpen
        const walk = canAct && !shop
        // movement intent
        intent.fwd = walk ? (input.has('KeyW') || input.has('ArrowUp') ? 1 : 0) - (input.has('KeyS') || input.has('ArrowDown') ? 1 : 0) : 0
        intent.right = walk ? (input.has('KeyD') || input.has('ArrowRight') ? 1 : 0) - (input.has('KeyA') || input.has('ArrowLeft') ? 1 : 0) : 0
        // ADS and sprint: whichever was pressed last wins while both are held (CoD style)
        if (input.pressed('Mouse2')) adsOverSprint = true
        if (input.pressed('ShiftLeft')) {
            adsOverSprint = false
            reloadHoldsSprint = false
        }
        if (shop) shopRmb = true
        else if (shopRmb && !input.has('Mouse2')) shopRmb = false
        const adsHeld = input.has('Mouse2') && !shopRmb
        intent.sprint = walk && input.has('ShiftLeft') && now >= sprintLockUntil && life === 'alive'
            && !(adsHeld && adsOverSprint) && !(gun.reloading && reloadHoldsSprint)
        intent.crouch = false
        if (walk && input.pressed('KeyC')) player.toggleCrouch()
        if (walk && input.pressed('Space')) player.queueJump(now)
        if (walk && input.pressed('Space') && player.crouched) player.wantsCrouch = false
        // a fresh sprint press over a held ADS lowers the sights so the sprint can start
        const sprintWins = input.has('ShiftLeft') && !adsOverSprint && !player.tired && now >= sprintLockUntil && intent.fwd > 0
        const wantsAds = walk && adsHeld && !player.sprinting && !sprintWins
        intent.ads = viewmodel.adsBlend

        if (life === 'dead') {
            if (locked && input.pressed('Mouse0')) cycleSpectate(1)
            return
        }
        if (!canAct) {
            vmInput.ads = false
            return
        }
        vmInput.ads = wantsAds

        // weapon actions (a press already handled on its event isn't pulled twice)
        // the shop's left button crafts, it doesn't fire
        const trigger = !shop && input.has('Mouse0')
        if (!shop && input.pressed('Mouse0') && !pressHandled) pullTrigger(now)
        if (trigger && player.sprinting) sprintLockUntil = now + 0.3
        // breaking into a sprint drops the reload (tap sprint to cancel one, as in CoD)
        if (player.sprinting && !wasSprinting && gun.reloading) interruptReload(now)
        wasSprinting = player.sprinting
        gun.setSprinting(player.sprinting, now, effects.adsMult)
        if (!player.sprinting) {
            let shots = 0
            while (shots < 2 && gun.canFire(now, trigger)) {
                fire(now)
                shots++
                if (!gun.auto) break
            }
        }
        if (reloadEmptyPending && now - lastShot > 0.22) {
            reloadEmptyPending = false
            if (gun.mag <= 0) tryReload(now)
        }
        if (input.pressed('KeyR')) {
            // reloading drops out of a sprint; the held sprint key waits for a fresh press
            if (player.sprinting && gun.canReload()) sprintLockUntil = now + 0.15
            tryReload(now)
        }
        if (life === 'alive') {
            if (input.pressed('Digit1')) swapTo(0, now)
            if (input.pressed('Digit2')) swapTo(1, now)
            if (input.pressed('Digit3')) swapTo(2, now)
            // in the workbench shop the wheel picks instead
            if (input.wheel !== 0 && !shop) swapTo(localSlot + (input.wheel > 0 ? 1 : -1), now, true)
            // a knife press a moment early (still recovering) is kept and swings when ready
            if (input.pressed('KeyV')) meleeQueuedUntil = now + 0.2
            if (meleeQueuedUntil >= now && now >= meleeReadyAt) {
                meleeQueuedUntil = 0
                melee(now)
            }
            if (input.pressed('KeyG')) throwGrenade(now)
            if (input.pressed('KeyI') && !gun.reloading) safe('vm inspect', () => viewmodel.inspect?.(), undefined)
            handleUse(now)
            // the workbench, upgrade kits, placing gear (Q) and calling in support (X)
            arsenal.input(now, currentPrompt, mine, latest?.world ?? null)
        }
        // reload / shell progress
        const ev = gun.update(now, dt, effects.reloadMult)
        if (ev === 'shell' && stats) safe('vm shell', () => viewmodel.reload(false, stats!.perRoundReload / Math.max(0.1, effects.reloadMult), true), undefined)
        // ammo is client-driven: report the magazine a finished reload left
        if (ev === 'done') {
            net.send({ t: 'reload', mag: gun.mag, weapon: gun.id })
            markAmmo()
        }
    }

    function cycleSpectate(dir: number): void {
        if (!latest) return
        const alive = latest.players.filter(p => p.pid !== me && p.life !== 'dead' && p.connected)
        if (!alive.length) {
            spectatePid = -1
            return
        }
        const i = alive.findIndex(p => p.pid === spectatePid)
        spectatePid = alive[((i + dir) % alive.length + alive.length) % alive.length]!.pid
    }

    /**
     * Zombies have bodies: one overlapping you eases you out of it (most of the
     * overlap per frame, never a hard stop), so the camera never ends up inside
     * a zombie and you can't walk through a horde. Dead ones don't count.
     */
    function keepOutOfZombies(dt: number): void {
        if (player.downed) return
        let sx = 0
        let sz = 0
        const k = Math.min(1, dt * 14)
        for (const z of zList) {
            const dy = z.pos.y - player.pos.y
            if (dy < -1.2 || dy > 1.6) continue
            const r = DF_ENEMIES[z.type].radius + DF_PLAYER.radius - 0.08
            const dx = player.pos.x - z.pos.x
            const dz = player.pos.z - z.pos.z
            const d2 = dx * dx + dz * dz
            if (d2 >= r * r) continue
            const d = Math.sqrt(d2)
            const push = (r - d) * k
            if (d > 1e-3) {
                sx += (dx / d) * push
                sz += (dz / d) * push
            } else {
                // dead centre: out the way you're facing away from it
                sx += Math.sin(player.yaw) * push
                sz += Math.cos(player.yaw) * push
            }
        }
        const l = Math.sqrt(sx * sx + sz * sz)
        if (l < 1e-4) return
        // never more than a brisk step per frame
        const max = 4 * dt
        if (l > max) {
            sx *= max / l
            sz *= max / l
        }
        player.shove(collision, sx, sz)
    }

    // ---------------------------------------------------------------- the loop
    /** Dev frame profiler: per-section milliseconds of `frame()` work (see `window.__df.prof`). */
    const PROF_SECTIONS = ['input', 'move', 'interp', 'camera', 'world', 'zombies', 'proj', 'avatars', 'vm', 'fx', 'hud', 'render'] as const
    const prof = { on: false, frames: 0, at: 0, sec: new Float64Array(PROF_SECTIONS.length), total: [] as number[], gap: [] as number[], gpu: [] as number[], cur: new Float64Array(12), worst: new Float64Array(12), worstMs: 0 }
    /** GPU time per frame through EXT_disjoint_timer_query_webgl2 (dev profiler only). */
    const gpuTimer = import.meta.dev ? createGpuTimer(renderer.getContext()) : null
    function mark(i: number): void {
        if (!prof.on) return
        const t = performance.now()
        prof.sec[i]! += t - prof.at
        prof.cur[i] = t - prof.at
        prof.at = t
    }
    let interpDelay: number = DF_INTERP_DELAY_MS
    let zombieDelay: number = DF_INTERP_DELAY_MS * 0.6
    const zSample = dfNewSample()
    function frame(ts?: number): void {
        if (disposed) return
        raf = requestAnimationFrame(frame)
        // the frame's own timestamp (vsync-aligned, the same for every callback this frame)
        // paces motion more evenly than reading the clock whenever this callback happens to run
        const nowMs = typeof ts === 'number' && ts > 0 && ts <= performance.now() + 1 ? ts : performance.now()
        const dt = Math.min(0.1, Math.max(0, (nowMs - last) / 1000))
        const workStart = prof.on ? performance.now() : 0
        if (prof.on) {
            prof.gap.push(nowMs - last)
            prof.at = workStart
        }
        last = nowMs
        time += dt
        const now = time

        handleInput(dt, now)
        mark(0)

        // movement: speeds from the player constants, effects and the held weapon
        const wMove = stats?.moveMult ?? 1
        speeds.walk = DF_PLAYER.walkSpeed * effects.moveMult * wMove
        speeds.sprint = DF_PLAYER.sprintSpeed * effects.moveMult * effects.sprintMult * wMove
        speeds.crouch = DF_PLAYER.crouchSpeed * effects.moveMult * wMove
        speeds.ads = DF_PLAYER.adsSpeed * effects.moveMult
        speeds.sprintDuration = effects.sprintDuration
        if (life !== 'dead' && spawned) {
            acc += dt
            let steps = 0
            while (acc >= DF_STEP && steps < 6) {
                player.step(DF_STEP, now, intent, collision, speeds)
                acc -= DF_STEP
                steps++
            }
            if (steps === 6) acc = 0
            keepOutOfZombies(dt)
        }
        const alpha = Math.min(1, acc / DF_STEP)
        mark(1)

        // send input at 20 Hz
        sendTimer += dt
        if (sendTimer >= 1 / SEND_HZ && spawned) {
            sendTimer = 0
            seq++
            let flags = 0
            if (player.crouched) flags |= DF_FLAG.crouch
            if (player.sprinting) flags |= DF_FLAG.sprint
            if (vmInput.ads) flags |= DF_FLAG.ads
            if (player.grounded) flags |= DF_FLAG.grounded
            if (gun.reloading) flags |= DF_FLAG.reloading
            if (now - lastShot < 0.15) flags |= DF_FLAG.firing
            if (reviveTarget !== null) flags |= DF_FLAG.reviving
            if (now < meleeReadyAt - DF_MELEE.cooldown + 0.3) flags |= DF_FLAG.meleeing
            const i = seq % HIST
            histSeq[i] = seq
            histPos[i * 3] = player.pos.x
            histPos[i * 3 + 1] = player.pos.y
            histPos[i * 3 + 2] = player.pos.z
            net.send({ t: 'in', seq, pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z }, yaw: player.yaw, pitch: player.pitch, flags, rtt: Math.round(net.rtt) })
        }

        // ---- interpolation
        // Ease toward the jitter-adapted delay so the render clock never jumps.
        const targetDelay = buffer.targetDelay(DF_INTERP_DELAY_MS, 1000 / DF_TICK_HZ)
        interpDelay = dfEaseDelay(interpDelay, targetDelay, dt)
        const renderT = buffer.renderTime(nowMs, interpDelay)
        const sample = buffer.at(renderT)
        // Zombies (and the events that hit them) run on their own, shorter delay:
        // about a tick, dead-reckoned past the newest snapshot and smoothed.
        const zTarget = buffer.zombieDelay(1000 / DF_TICK_HZ)
        zombieDelay = dfEaseDelay(zombieDelay, zTarget, dt)
        const zRenderT = buffer.renderTime(nowMs, zombieDelay)
        // zombies dead-reckon through a whole lag spike instead of freezing at the players' cap
        const zs = buffer.at(zRenderT, zSample, DF_MAX_ZOMBIE_EXTRAPOLATE)
        while (eventQueue.length && eventQueue[0]!.time <= zRenderT + 1e-4) {
            const q = eventQueue.shift()!
            for (const ev of q.events) dispatchView(ev)
        }
        // never hold events more than a second behind
        while (eventQueue.length && eventQueue[0]!.time < zRenderT - 1) {
            const q = eventQueue.shift()!
            for (const ev of q.events) dispatchView(ev)
        }
        buffer.trim(Math.min(renderT, zRenderT))
        if (zs) {
            dfInterpZombies(zs, zPool, zList)
            // our own kills are already down: never draw or hit them again
            if (predictedDead.size) {
                let w = 0
                for (let i = 0; i < zList.length; i++) {
                    const z = zList[i]!
                    if (!predictedDead.has(z.id)) zList[w++] = z
                }
                zList.length = w
            }
            smoother.apply(zList, dt)
        }
        let pCount = 0
        if (sample) {
            pList.length = 0
            for (const p of sample.b.s.players) {
                if (p.pid === me) continue
                let ip = pPool[pCount]
                if (!ip) pPool[pCount] = ip = dfNewInterpPlayer()
                if (dfInterpPlayer(sample, p.pid, ip)) {
                    pList.push(ip)
                    pCount++
                }
            }
            interpProjectiles(sample.a.s.projectiles, sample.b.s.projectiles, sample.alpha, sample.span)
        }

        mark(2)
        // ---- camera
        updateCamera(dt, now, alpha)
        mark(3)

        // ---- views
        const world = sample?.b.s.world ?? latest?.world
        try {
            if (world) worldView.update(dt, world, latest?.time ?? 0)
        } catch (e) {
            console.error('[dead-front] world view update', e)
        }
        mark(4)
        try {
            zombieView.update(dt, zList)
        } catch (e) {
            console.error('[dead-front] zombie view update', e)
        }
        mark(5)
        try {
            projectileView.update(dt, projList)
        } catch (e) {
            console.error('[dead-front] projectile view update', e)
        }
        mark(6)
        avatars.update(dt, now, pList, pCount)
        powerupView.update(dt, now, latest?.powerups ?? [])
        try {
            arsenal.frame(dt, life === 'alive' ? mine : null, latest?.world ?? null)
        } catch (e) {
            console.error('[dead-front] arsenal frame', e)
        }
        mark(7)

        // viewmodel
        vmInput.speed = Math.min(1, player.speed / Math.max(0.1, speeds.sprint))
        vmInput.sprinting = player.sprinting
        vmInput.crouching = player.crouched
        vmInput.grounded = player.grounded
        vmInput.adsMult = effects.adsMult
        vmInput.sliding = player.sliding
        // sideways velocity in camera space (+ right) and the vertical speed, for the gun's momentum
        vmInput.strafe = (player.vel.x * Math.cos(player.yaw) - player.vel.z * Math.sin(player.yaw)) / Math.max(0.1, speeds.sprint)
        vmInput.vy = player.vel.y
        viewmodel.root.visible = life !== 'dead'
        try {
            viewmodel.update(dt, vmInput)
        } catch (e) {
            console.error('[dead-front] viewmodel update', e)
        }
        vmMuzzle.intensity *= Math.exp(-dt * 40)
        mark(8)

        // feedback: low health, downed, damage
        updateFeedback(dt, now)
        updateGas(dt)

        fx.resize(rr.bufferHeight, rr.pixelRatio)
        fx.update(dt, now)
        audio.setTension(Math.min(1, zList.length / 18))
        audio.updateListener(camera)
        mark(9)

        // HUD
        hudTimer += dt
        if (hudTimer >= 1 / 20) {
            hudTimer = 0
            updatePrompt()
            updateHud(nowMs)
        }
        updateHudFast()
        mark(10)

        const health = mine && mine.maxHealth > 0 ? mine.health / mine.maxHealth : 1
        // The moon's shadow map is the most expensive pass (hundreds of casters, zombies
        // included): refresh it every other frame. 30 Hz shadows are indistinguishable here.
        shadowTick = (shadowTick + 1) % 2
        renderer.shadowMap.needsUpdate = shadowTick === 0
        if (import.meta.dev && !renderer.info.autoReset) renderer.info.reset()
        if (prof.on) gpuTimer?.begin()
        rr.render(dt, now, {
            lowHealth: life === 'alive' ? Math.max(0, Math.min(1, (0.5 - health) / 0.38)) : 0,
            damage: damagePulse,
            down: downBlend,
            flash: gradeFlash
        })
        input.endFrame()
        pressHandled = false
        frameLook.x = frameLook.y = 0
        if (prof.on) {
            gpuTimer?.end(prof.gpu)
            mark(11)
            prof.frames++
            const ms = performance.now() - workStart
            prof.total.push(ms)
            if (ms > prof.worstMs) {
                prof.worstMs = ms
                prof.worst.set(prof.cur)
            }
        }
    }

    function interpProjectiles(a: readonly DfProjectileSnap[], b: readonly DfProjectileSnap[], t: number, span: number): void {
        projList.length = 0
        let i = 0
        for (const pb of b) {
            let p = projPool[i]
            if (!p) projPool[i] = p = { id: 0, kind: 'grenade', pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, tier: 0 }
            i++
            p.id = pb.id
            p.kind = pb.kind
            p.tier = pb.tier
            p.vel.x = pb.vel.x
            p.vel.y = pb.vel.y
            p.vel.z = pb.vel.z
            let pa: DfProjectileSnap | undefined
            for (const x of a) {
                if (x.id === pb.id) {
                    pa = x
                    break
                }
            }
            if (pa && t <= 1) {
                p.pos.x = pa.pos.x + (pb.pos.x - pa.pos.x) * t
                p.pos.y = pa.pos.y + (pb.pos.y - pa.pos.y) * t
                p.pos.z = pa.pos.z + (pb.pos.z - pa.pos.z) * t
            } else {
                // newly spawned or extrapolating: ride the velocity
                const k = Math.max(0, t - 1) * span
                p.pos.x = pb.pos.x + pb.vel.x * k
                p.pos.y = pb.pos.y + pb.vel.y * k
                p.pos.z = pb.pos.z + pb.vel.z * k
            }
            projList.push(p)
        }
    }

    function updateCamera(dt: number, now: number, alpha: number): void {
        // spectating a teammate after bleeding out
        if (life === 'dead') {
            if (spectatePid < 0 || !pList.some(p => p.pid === spectatePid)) cycleSpectate(1)
            const t = pList.find(p => p.pid === spectatePid)
            avatars.hidden = t ? t.pid : -1
            hud.spectating = t ? t.snap.name : null
            if (t) {
                const crouch = (t.flags & DF_FLAG.crouch) !== 0
                const eyeH = t.snap.life === 'down' ? 0.5 : crouch ? DF_PLAYER.crouchEyeHeight : DF_PLAYER.eyeHeight
                camera.position.set(t.pos.x, t.pos.y + eyeH, t.pos.z)
                camera.rotation.set(t.pitch, t.yaw, 0, 'YXZ')
            } else {
                // nobody to watch: drift above the spawn
                const sp = DF_MAP.playerSpawns[0] ?? { x: 0, y: 0, z: 0 }
                camera.position.set(sp.x, sp.y + 6, sp.z + 6)
                camera.rotation.set(-0.6, now * 0.05, 0, 'YXZ')
            }
            setFov(dfVerticalFov(settings.fov, camera.aspect))
            return
        }
        hud.spectating = null
        const rx = player.prev.x + (player.pos.x - player.prev.x) * alpha
        const ry = player.prev.y + (player.pos.y - player.prev.y) * alpha
        const rz = player.prev.z + (player.pos.z - player.prev.z) * alpha

        // landing dip spring
        const k = 140
        const c = 2 * Math.sqrt(k) * 0.8
        landVel += (-k * landOff - c * landVel) * dt
        landOff += landVel * dt

        // head bob from stride
        const ads = viewmodel.adsBlend
        const sprint = player.sprinting
        const bob = player.headBob(dt, DF_PLAYER.walkSpeed, ads)
        const bobY = bob.y
        const bobX = bob.x

        // footsteps on the stride
        if (bob.step) {
            if (player.grounded && player.speed > 0.8 && !player.downed) {
                const hit = dfRaycast(collision, { x: player.pos.x, y: player.pos.y + 0.3, z: player.pos.z }, { x: 0, y: -1, z: 0 }, 1)
                audio.play(DF_SND.step(hit?.mat ?? 'mud'), { volume: (player.crouched ? 0.18 : sprint ? 0.5 : 0.33), rate: 0.9 + Math.random() * 0.2 })
            }
        }

        const eyeH = player.eyeHeight() - landOff * 0.12 + bobY
        // the camera rides a smoothed floor (stairs become a ramp), independent of the physics' steps
        const floorY = player.viewFloor(collision, rx, ry, rz, dt)
        // sideways bob in camera space
        const sy = Math.sin(player.yaw)
        const cy = Math.cos(player.yaw)
        camera.position.set(rx + cy * bobX, floorY + eyeH, rz - sy * bobX)

        // recoil lands, then recovers once the trigger rests
        recoil.update(dt, now)
        const downRoll = player.downed ? 0.16 + Math.sin(now * 0.9) * 0.03 : 0
        const strafeRoll = -(player.vel.x * cy - player.vel.z * sy) * 0.0035 * (1 - ads)
        // a slide leans the view a touch, like a body dropping onto one hip
        const slideRoll = player.slideBlend * 0.06 * (1 - ads)
        camera.rotation.set(
            player.pitch + recoil.pitch + fx.shakePitch - landOff * 0.02,
            player.yaw + recoil.yaw + fx.shakeYaw,
            fx.shakeRoll + downRoll + strafeRoll + slideRoll + bobX * 0.3,
            'YXZ'
        )

        // FOV: sprint kick, ADS zoom
        sprintFov += ((sprint || player.sliding ? 1 : 0) - sprintFov) * Math.min(1, dt * 6)
        killPunch *= Math.exp(-dt * 11)
        const base = dfVerticalFov(settings.fov, camera.aspect) + sprintFov * 5 - killPunch * 1.6
        const zoom = 1 + ((stats?.adsZoom ?? 1) - 1) * ads
        setFov(base / zoom)
    }

    let lastFov = 0
    function setFov(f: number): void {
        if (Math.abs(f - lastFov) < 0.01) return
        lastFov = f
        camera.fov = f
        camera.updateProjectionMatrix()
    }

    function updateFeedback(dt: number, now: number): void {
        damagePulse = Math.max(0, damagePulse - dt * 1.6)
        gradeFlash = Math.max(0, gradeFlash - dt * 1.2)
        const down = life === 'down' ? 1 : 0
        downBlend += (down - downBlend) * Math.min(1, dt * 2.5)
        audio.setMuffle(downBlend * 0.75)
        if (!mine) return
        if (life === 'down') {
            const left = mine.bleedout
            const max = Math.max(1, effects.bleedoutTime)
            const interval = 0.45 + Math.min(1, left / max) * 0.6
            if (now >= heartbeatAt) {
                heartbeatAt = now + interval
                audio.play(DF_SND.heartbeat, { volume: 0.85 })
            }
        }
        const health = mine.maxHealth > 0 ? mine.health / mine.maxHealth : 1
        if (life === 'alive' && health < 0.4 && now >= breathAt) {
            breathAt = now + 2.3
            audio.play(DF_SND.breath, { volume: 0.45 + (0.4 - health) })
        }
    }

    // ---------------------------------------------------------------- HUD
    function updateHud(nowMs: number): void {
        const s = latest
        hud.ping = Math.round(net.rtt)
        hud.connection = net.status !== 'open' ? 'reconnecting' : nowMs - lastSnapAt > 2500 && spawned && !pausedByMe ? 'lost' : 'ok'
        if (!s) return
        if (hud.round !== s.round && s.round > 0 && hud.round === 0) hud.round = s.round
        hud.phase = s.phase
        hud.phaseTimer = s.phaseTimer
        hud.zombiesLeft = s.zombiesLeft

        // squad
        const players = s.players
        if (hud.players.length !== players.length) hud.players.length = 0
        players.forEach((p, i) => {
            const row = hud.players[i]
            const ping = p.pid === me ? Math.round(net.rtt) : null
            const points = p.pid === me ? shownPoints(p) : p.points
            if (!row || row.pid !== p.pid) {
                hud.players[i] = { pid: p.pid, name: p.name, color: dfPlayerColor(p.pid), me: p.pid === me, points, kills: p.kills, headshots: p.headshots, downs: p.downs, revives: p.revives, life: p.life, connected: p.connected, ping }
                return
            }
            row.points = points
            row.kills = p.kills
            row.headshots = p.headshots
            row.downs = p.downs
            row.revives = p.revives
            row.life = p.life
            row.connected = p.connected
            row.ping = ping
            row.name = p.name
        })
        // popups expire
        while (hud.popups.length && time - hud.popups[0]!.born > 1.3) hud.popups.shift()
        while (hud.hitPops.length && time - hud.hitPops[0]!.born > 1.1) hud.hitPops.shift()
        while (hud.damage.length && time - hud.damage[0]!.born > 1.6) hud.damage.shift()
        while (hud.chat.length && time - hud.chat[0]!.born > 10) hud.chat.shift()

        const m = mine
        if (m) {
            hud.health = m.maxHealth > 0 ? Math.max(0, m.health / m.maxHealth) : 1
            hud.life = m.life
            hud.bleedout = m.bleedout
            hud.bleedoutMax = Math.max(1, effects.bleedoutTime)
            hud.beingRevived = m.reviveProgress
            hud.selfRevives = m.selfRevives
            hud.grenades = Math.min(DF_GRENADES.max, m.grenades)
            const pk = shownPerks(m)
            if (hud.perks.length !== pk.length || hud.perks.some((x, i) => x.id !== pk[i])) {
                const fresh = pk.find(id => !hud.perks.some(x => x.id === id))
                if (fresh) hud.perkPulse = { id: fresh, key: hud.perkPulse.key + 1 }
                hud.perks = pk.map(id => ({ id, name: DF_PERKS[id]?.name ?? id, color: DF_PERKS[id]?.color ?? '#ffffff' }))
            }
            const st = stats
            hud.ammo.weapon = st ? gun.id : null
            hud.ammo.name = st ? st.name : ''
            hud.ammo.mag = gun.mag
            hud.ammo.magSize = st?.magSize ?? 0
            hud.ammo.reserve = gun.reserve
            hud.ammo.pap = gun.pap
            const rar = st && mine ? mine.weapons[localSlot]?.rarity ?? 0 : 0
            if (hud.ammo.rarity !== rar) hud.ammo.rarity = rar
            hud.ammo.reloading = gun.reloading
            hud.lowAmmo = !!st && gun.mag <= Math.max(1, Math.floor(st.magSize * 0.25)) && !gun.reloading
            hud.stamina = player.stamina / Math.max(0.1, effects.sprintDuration)
            hud.sprinting = player.sprinting
            hud.ads = viewmodel.adsBlend > 0.6
            // revive progress on a teammate we're helping
            if (reviveTarget !== null) {
                const t = s.players.find(p => p.pid === reviveTarget)
                hud.reviving = t ? { name: t.name, progress: t.reviveProgress } : null
            } else hud.reviving = null
        }

        // power-up timers
        const w = s.world
        // rows are updated in place: the HUD re-renders only what changed
        const pu = hud.powerups
        let n = 0
        for (const kind of ['double', 'insta'] as const) {
            const left = w[kind]
            if (left <= 0) continue
            const row = pu[n]
            if (!row || row.kind !== kind) pu[n] = { kind, name: DF_POWERUP_NAMES[kind], seconds: left, ending: left < 5 }
            else {
                if (row.seconds !== left) row.seconds = left
                const ending = left < 5
                if (row.ending !== ending) row.ending = ending
            }
            n++
        }
        if (pu.length !== n) pu.length = n

        // prompt
        // the open shop is its own panel
        const p = currentPrompt?.kind === 'bench' && arsenal.shopOpen ? null : currentPrompt
        if (p) {
            // hold actions fill the prompt's bar: a revive's progress, the boards of a barrier being rebuilt
            let holdProgress = p.action === 'revive' && hud.reviving ? hud.reviving.progress : 0
            if (p.repeat && p.kind === 'barricade' && input.has('KeyF')) holdProgress = Math.min(1, (w.planks[p.id] ?? 0) / DF_BARRICADE_PLANKS)
            if (p.kind === 'bench') holdProgress = arsenal.holdProgress
            if (!hud.prompt) hud.prompt = { text: p.text, sub: p.sub ?? '', cost: p.cost, ok: p.ok, denyKey: 0, hold: holdProgress, tint: p.tint ?? null }
            else {
                hud.prompt.tint = p.tint ?? null
                hud.prompt.text = p.text
                hud.prompt.sub = p.sub ?? ''
                hud.prompt.cost = p.cost
                hud.prompt.ok = p.ok
                hud.prompt.hold = holdProgress
            }
        } else if (hud.prompt) hud.prompt = null

        updateCoaching(s)

        // objective
        const egg = w.egg
        const o = hud.objective
        o.visible = egg.step !== 'done'
        o.step = egg.step
        o.text = dfObjectiveText(egg.step)
        o.fuses = egg.step === 'fuses' ? `${egg.fusesFound.length}/${DF_MAP.egg.fuses.length || 3}` : null
        o.charge = egg.step === 'charge' ? Math.min(1, egg.charge / Math.max(1, egg.chargeNeeded)) : null
        o.rods = egg.step === 'rods' ? `${(egg.rodsOn ?? []).length}/${dfEggRodSpots(DF_MAP).length || 3}` : null
        o.rodTimer = egg.step === 'rods' && egg.rodTimer > 0 ? Math.ceil(egg.rodTimer) : null
        const target = o.visible ? dfObjectiveTarget(egg, w.power, DF_MAP, player.pos) : null
        wpHas = !!target
        o.hasTarget = wpHas
        if (target) {
            wpTarget.set(target.pos.x, target.pos.y + 1.3, target.pos.z)
            o.label = target.label
            const dx = target.pos.x - player.pos.x
            const dz = target.pos.z - player.pos.z
            o.distance = Math.round(Math.sqrt(dx * dx + dz * dz))
        }
    }

    /** Hints, the ammo line, the last-zombies stretch and the HUD markers (20 Hz). */
    function updateCoaching(s: DfSnapshot): void {
        const m = mine
        const alive = !!m && life === 'alive'
        const px = player.pos.x
        const py = player.pos.y
        const pz = player.pos.z
        // ---- facts for the coaching
        const f = hintFacts
        f.time = time
        f.alive = alive
        f.round = s.round
        f.phase = s.phase
        f.points = m ? shownPoints(m) : 0
        f.power = s.world.power
        f.reviving = reviveTarget !== null
        f.brokenWindowNear = false
        f.wallbuyNear = false
        f.perkNear = false
        f.zombieClose = false
        if (alive && m) {
            for (const b of DF_MAP.barricades) {
                if ((s.world.planks[b.id] ?? DF_BARRICADE_PLANKS) >= DF_BARRICADE_PLANKS) continue
                const dx = b.pos.x - px
                const dz = b.pos.z - pz
                if (dx * dx + dz * dz < 3.5 * 3.5 && Math.abs(b.pos.y - py) < 2) {
                    f.brokenWindowNear = true
                    break
                }
            }
            for (const it of interactables) {
                if (it.kind !== 'wallbuy' && it.kind !== 'perk') continue
                const dx = it.pos.x - px
                const dz = it.pos.z - pz
                const d2 = dx * dx + dz * dz
                if (Math.abs(it.pos.y - py) > 2.5) continue
                if (it.kind === 'perk' && d2 < 4 * 4) f.perkNear = true
                if (it.kind === 'wallbuy' && d2 < 6 * 6 && it.ref && !m.weapons.some(x => x.id === it.ref)) {
                    const cost = DF_WEAPONS[it.ref as keyof typeof DF_WEAPONS]?.wallCost ?? Infinity
                    if (cost <= f.points) f.wallbuyNear = true
                }
            }
            for (const z of zList) {
                const dx = z.pos.x - px
                const dz = z.pos.z - pz
                if (dx * dx + dz * dz < 2.4 * 2.4 && Math.abs(z.pos.y - py) < 1.5) {
                    f.zombieClose = true
                    break
                }
            }
        }
        const doors = doorsWithPredicted(s.world)
        f.doorsOpen = doors.length
        f.cheapestDoor = Infinity
        for (const d of DF_MAP.doors) if (!doors.includes(d.id)) f.cheapestDoor = Math.min(f.cheapestDoor, d.cost)
        f.downedMate = null
        for (const p of s.players) {
            if (p.pid !== me && p.life === 'down' && p.connected) {
                f.downedMate = p.name
                break
            }
        }
        const af = arsenal.facts(alive ? m : null, s.world)
        f.salvage = af.salvage
        f.benchNear = af.benchNear
        f.canCraft = af.canCraft
        f.gear = af.equip
        f.reward = af.reward
        const h = hints.update(f)
        if (!h) hud.hint = null
        else if (hud.hint?.key !== h.key) hud.hint = { key: h.key, text: h.text, sub: h.sub }

        // ---- the line under the crosshair
        hud.ammoHint = m && life !== 'dead' && stats && !hud.ammo.infinite ? dfAmmoHint(gun.mag, stats.magSize, gun.reserve, gun.reloading) : null

        // ---- the last few zombies: counted, highlighted and marked
        const lastStretch = s.phase === 'active' && s.zombiesLeft > 0 && s.zombiesLeft <= 3 && s.zombiesLeft <= s.zombies.length
        hud.lastZombies = lastStretch ? s.zombiesLeft : 0
        highlightIds.length = 0
        if (lastStretch) for (const z of s.zombies) if (!predictedDead.has(z.id)) highlightIds.push(z.id)
        const hk = highlightIds.join(',')
        if (hk !== highlightKey) {
            highlightKey = hk
            try {
                zombieView.highlight?.(highlightIds)
            } catch (e) {
                console.error('[dead-front] zombie view highlight', e)
            }
        }

        // ---- markers: downed teammates first, then the last zombies
        markerSubjects.length = 0
        if (life !== 'dead') {
            for (const p of s.players) {
                if (markerSubjects.length >= DF_HUD_MARKERS) break
                if (p.pid !== me && p.life === 'down' && p.connected) markerSubjects.push({ kind: 'revive', id: p.pid })
            }
            for (const id of highlightIds) {
                if (markerSubjects.length >= DF_HUD_MARKERS) break
                markerSubjects.push({ kind: 'zombie', id })
            }
        }
        const mk = hud.markers
        if (mk.length !== markerSubjects.length) mk.length = 0
        markerSubjects.forEach((sub, i) => {
            const key = sub.kind === 'zombie' ? `z${sub.id}` : `p${sub.id}`
            const pos = markerTarget(sub, markPos) ? markPos : null
            const distance = pos ? Math.round(Math.hypot(pos.x - px, pos.z - pz)) : 0
            const label = sub.kind === 'revive' ? playerName(sub.id) : ''
            const row = mk[i]
            if (!row || row.key !== key) mk[i] = { key, kind: sub.kind, label, distance }
            else if (row.distance !== distance) row.distance = distance
        })
    }

    /** Where a marker's subject is this frame (rendered positions), or false if it's gone. */
    function markerTarget(sub: { kind: 'zombie' | 'revive', id: number }, out: THREE.Vector3): boolean {
        if (sub.kind === 'zombie') {
            for (const z of zList) {
                if (z.id !== sub.id) continue
                out.set(z.pos.x, z.pos.y + DF_ENEMIES[z.type].height * 0.6, z.pos.z)
                return true
            }
            return false
        }
        for (const p of pList) {
            if (p.pid !== sub.id) continue
            out.set(p.pos.x, p.pos.y + 0.6, p.pos.z)
            return true
        }
        const sp = latest?.players.find(p => p.pid === sub.id)
        if (!sp) return false
        out.set(sp.pos.x, sp.pos.y + 0.6, sp.pos.z)
        return true
    }

    let lastSpread = -1
    let lastWp = -1
    /** One number per on-screen state (whole pixels, edge flag, angle in centiradians): no per-frame strings. */
    function screenKey(p: DfScreenPoint): number {
        return ((Math.round(p.x) * 8192 + Math.round(p.y)) * 2 + (p.onScreen ? 1 : 0)) * 1000 + Math.round(p.angle * 100) + 500
    }
    function updateHudFast(): void {
        const root = opts.hudRoot()
        if (!root) return
        const cssH = container.clientHeight || 1
        const cssW = container.clientWidth || 1
        // crosshair gap from the live spread
        if (stats) {
            const spread = dfSpread({
                hipSpread: stats.hipSpread,
                adsSpread: stats.adsSpread,
                adsBlend: viewmodel.adsBlend,
                spreadMult: effects.spreadMult,
                move: Math.min(1, player.speed / DF_PLAYER.sprintSpeed),
                airborne: !player.grounded,
                crouched: player.crouched,
                bloom: gun.bloom
            })
            const px = Math.round((Math.tan(spread) / Math.tan((camera.fov * Math.PI) / 360)) * (cssH / 2) * 10) / 10
            const vis = Math.max(0, 1 - viewmodel.adsBlend * 1.6) * (player.sprinting ? 0.25 : 1)
            const key = px * 1000 + Math.round(vis * 100)
            if (key !== lastSpread) {
                lastSpread = key
                root.style.setProperty('--df-spread', `${Math.max(3, px)}px`)
                root.style.setProperty('--df-xhair', vis.toFixed(2))
            }
        }
        // the damage arcs are the only reader of the camera yaw: skip the style write otherwise
        if (hud.damage.length) root.style.setProperty('--df-yaw', (camera.rotation.y).toFixed(4))
        // markers (last zombies, downed teammates), clamped to the screen edge like the waypoint
        const PM = camera.projectionMatrix.elements
        for (let i = 0; i < markerSubjects.length; i++) {
            if (!markerTarget(markerSubjects[i]!, tmpV)) continue
            tmpV.applyMatrix4(camera.matrixWorldInverse)
            dfClampToScreen(tmpV.x, tmpV.y, tmpV.z, PM[0]!, PM[5]!, cssW, cssH, 48, screenPt)
            const k = screenKey(screenPt)
            if (k === lastMarkKeys[i]) continue
            lastMarkKeys[i] = k
            root.style.setProperty(`--df-mk${i}-x`, `${screenPt.x.toFixed(1)}px`)
            root.style.setProperty(`--df-mk${i}-y`, `${screenPt.y.toFixed(1)}px`)
            root.style.setProperty(`--df-mk${i}-on`, screenPt.onScreen ? '1' : '0')
            root.style.setProperty(`--df-mk${i}-ang`, screenPt.angle.toFixed(3))
        }
        // hit points float over the zombie they came from
        for (const pop of hud.hitPops) {
            tmpV.copy(hitPopAt[pop.slot]!).applyMatrix4(camera.matrixWorldInverse)
            const front = tmpV.z < -0.05
            const iz = front ? 1 / -tmpV.z : 0
            root.style.setProperty(`--df-hp${pop.slot}-x`, `${((tmpV.x * PM[0]! * iz * 0.5 + 0.5) * cssW).toFixed(1)}px`)
            root.style.setProperty(`--df-hp${pop.slot}-y`, `${((-tmpV.y * PM[5]! * iz * 0.5 + 0.5) * cssH).toFixed(1)}px`)
            root.style.setProperty(`--df-hp${pop.slot}-on`, front ? '1' : '0')
        }
        // waypoint
        if (wpHas) {
            tmpV.copy(wpTarget).applyMatrix4(camera.matrixWorldInverse)
            const P = camera.projectionMatrix.elements
            dfClampToScreen(tmpV.x, tmpV.y, tmpV.z, P[0]!, P[5]!, cssW, cssH, 56, screenPt)
            const k = screenKey(screenPt)
            if (k !== lastWp) {
                lastWp = k
                root.style.setProperty('--df-wp-x', `${screenPt.x.toFixed(1)}px`)
                root.style.setProperty('--df-wp-y', `${screenPt.y.toFixed(1)}px`)
                root.style.setProperty('--df-wp-on', screenPt.onScreen ? '1' : '0')
                root.style.setProperty('--df-wp-ang', screenPt.angle.toFixed(3))
            }
        }
    }

    // ---------------------------------------------------------------- lifecycle
    const offSnap = net.on('snap', msg => onSnap(msg.s))
    const offStatus = net.onStatus((st) => {
        hud.connection = st === 'open' ? 'ok' : 'reconnecting'
    })

    input.onGesture = () => audio.unlock()
    input.onPress = onTriggerEvent
    input.onLockChange = (locked) => {
        hud.locked = locked
        wasLocked = locked
        // solo: the pause menu (Escape) or a lost pointer lock (alt-tab) pauses the match; co-op keeps running
        if (solo && spawned) sendPause(!locked)
        if (locked) audio.unlock()
        if (!locked && reviveTarget !== null) {
            reviveTarget = null
            net.send({ t: 'revive', pid: null })
        }
    }
    player.onLand = (impact) => {
        landVel += 2 + impact * 6
        audio.play(DF_SND.land, { volume: 0.35 + impact * 0.5, rate: 1 - impact * 0.15 })
        if (impact > 0.5) fx.shake(impact * 0.15)
    }
    player.onJump = () => audio.play(DF_SND.jump, { volume: 0.4 })
    player.onSlide = () => {
        audio.play(DF_SND.slide, { volume: 0.55 })
        fx.shake(0.04)
    }
    const down = { x: 0, y: -1, z: 0 }
    const stepFrom = { x: 0, y: 0, z: 0 }
    avatars.onStep = (_pid, pos, running) => {
        stepFrom.x = pos.x
        stepFrom.y = pos.y + 0.3
        stepFrom.z = pos.z
        const hit = dfRaycast(collision, stepFrom, down, 1)
        audio.play(DF_SND.step(hit?.mat ?? 'mud'), { pos, volume: running ? 0.85 : 0.6, rate: 0.9 + Math.random() * 0.2 })
    }

    const ro = new ResizeObserver(() => {
        rr.resize()
        camera.aspect = Math.max(0.2, container.clientWidth / Math.max(1, container.clientHeight))
        vmCamera.aspect = camera.aspect
        vmCamera.updateProjectionMatrix()
        lastFov = 0
    })
    ro.observe(container)
    camera.aspect = Math.max(0.2, container.clientWidth / Math.max(1, container.clientHeight))
    vmCamera.aspect = camera.aspect
    vmCamera.updateProjectionMatrix()

    raf = requestAnimationFrame(frame)

    // ---------------------------------------------------------------- dev hook
    // `window.__df` drives the game from automation (no real pointer lock needed).
    // Development builds only: the whole block is dropped from production bundles,
    // and the server ignores `dev` messages outside development.
    if (import.meta.dev) {
        const look = (x: number, y: number, z: number): void => {
            const dx = x - camera.position.x
            const dy = y - camera.position.y
            const dz = z - camera.position.z
            player.yaw = Math.atan2(-dx, -dz)
            player.pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz))
        }
        const nearest = (): DfZombieSnap | null => {
            let best: DfZombieSnap | null = null
            let bd = Infinity
            for (const z of zList) {
                const d = Math.hypot(z.pos.x - player.pos.x, z.pos.z - player.pos.z)
                if (d < bd) {
                    bd = d
                    best = z
                }
            }
            return best
        }
        const api = {
            three: { THREE, scene, camera, renderer, vmScene, vmCamera, viewmodel },
            /** Objects under a screen point (NDC -1..1), nearest first. */
            pick(x = 0, y = 0) {
                const rc = new THREE.Raycaster()
                rc.setFromCamera(new THREE.Vector2(x, y), camera)
                return rc.intersectObjects(scene.children, true).slice(0, 5).map((h) => {
                    const m = (h.object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
                    const mat = Array.isArray(m) ? m[0] : m
                    let path = ''
                    for (let o: THREE.Object3D | null = h.object; o && o !== scene; o = o.parent) path = `${o.name || o.type}/${path}`
                    return { dist: +h.distance.toFixed(2), path, mat: mat ? `${mat.type}:${mat.name}` : '' }
                })
            },
            lock(on = true) {
                input.devSetLocked(on)
            },
            key(code: string, ms = 90) {
                input.devInject(code, true)
                setTimeout(() => input.devInject(code, false), ms)
            },
            hold(code: string, down = true) {
                input.devInject(code, down)
            },
            /** Pretend the pointer is locked, so injected keys and clicks act. */
            fakeLock(on = true) {
                input.devLock(on)
            },
            turn(dx: number, dy = 0) {
                input.devLook(dx, dy)
            },
            look(yaw: number, pitch = 0) {
                player.yaw = yaw
                player.pitch = pitch
            },
            lookAt: look,
            aimZombie(head = true) {
                const z = nearest()
                if (!z) return null
                const d = DF_ENEMIES[z.type]
                look(z.pos.x, z.pos.y + (head ? d.headY : d.height * 0.55), z.pos.z)
                return z.id
            },
            tp(x: number, y: number, z: number, yaw?: number) {
                player.teleport({ x, y, z })
                if (yaw !== undefined) player.yaw = yaw
                net.send({ t: 'dev', op: { k: 'tp', pos: { x, y, z } } })
            },
            server(op: import('#shared/utils/dead-front/protocol').DfDevOp) {
                net.send({ t: 'dev', op })
            },
            use(id: string) {
                net.send({ t: 'use', id })
            },
            /** Artificial lag for testing the netcode: `ms` added to the round trip, up to `jitter` ms more per message. */
            lag(ms = 80, jitter = 30) {
                net.devLag = { ms: Math.max(0, ms), jitter: Math.max(0, jitter) }
                return net.devLag
            },
            /** Netcode state: render delays, jitter, ping, pending predictions. */
            netStats() {
                return {
                    rtt: Math.round(net.rtt),
                    jitter: +buffer.jitter.toFixed(1),
                    interpDelay: Math.round(interpDelay),
                    zombieDelay: Math.round(zombieDelay),
                    pendingPoints: pendingPoints.size,
                    predictedDead: predictedDead.size,
                    pendingBuys: pendingBuys.length,
                    shots: shotSeq,
                    mag: gun.mag,
                    lag: { ...net.devLag }
                }
            },
            interactables: () => interactables.map(i => ({ id: i.id, kind: i.kind, pos: i.pos })),
            state() {
                const info = renderer.info
                return {
                    pos: { ...player.pos },
                    sprinting: player.sprinting,
                    ads: +viewmodel.adsBlend.toFixed(2),
                    reloading: gun.reloading,
                    yaw: player.yaw,
                    pitch: player.pitch,
                    life,
                    me: mine && { health: mine.health, points: mine.points, weapons: mine.weapons, perks: mine.perks, grenades: mine.grenades },
                    round: latest?.round,
                    phase: latest?.phase,
                    world: latest?.world,
                    zombies: zList.map(z => ({ id: z.id, type: z.type, anim: z.anim, hp: z.hp, d: +Math.hypot(z.pos.x - player.pos.x, z.pos.z - player.pos.z).toFixed(1) })),
                    prompt: currentPrompt,
                    hud: { ammo: { ...hud.ammo }, objective: { ...hud.objective }, prompt: hud.prompt, locked: hud.locked, hint: hud.hint, ammoHint: hud.ammoHint, lastZombies: hud.lastZombies, markers: hud.markers.map(m => ({ ...m })), facts: { ...hintFacts }, seenHints: [...hints.seen] },
                    gl: { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length, pr: rr.pixelRatio, buffer: [rr.bufferWidth, rr.bufferHeight] }
                }
            },
            /**
             * Profiles `frame()` for `seconds`: CPU work per frame (avg / p95 / max), the
             * per-section split, the frame gaps the browser gave us (hitches), draw calls,
             * shader programs compiled meanwhile and JS heap growth (allocation pressure).
             */
            async prof(seconds = 3) {
                const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
                const heap0 = mem?.usedJSHeapSize ?? 0
                let grown = 0
                let gcs = 0
                let prevHeap = heap0
                const programs0 = renderer.info.programs?.length ?? 0
                prof.sec.fill(0)
                prof.total.length = 0
                prof.gap.length = 0
                prof.gpu.length = 0
                prof.worstMs = 0
                prof.frames = 0
                prof.on = true
                const t0 = performance.now()
                await new Promise<void>((resolve) => {
                    const iv = setInterval(() => {
                        const h = mem?.usedJSHeapSize ?? 0
                        if (h < prevHeap - 256 * 1024) gcs++
                        else if (h > prevHeap) grown += h - prevHeap
                        prevHeap = h
                        if (performance.now() - t0 >= seconds * 1000) {
                            clearInterval(iv)
                            resolve()
                        }
                    }, 50)
                })
                prof.on = false
                const n = Math.max(1, prof.frames)
                const sorted = [...prof.total].sort((a, b) => a - b)
                const gaps = [...prof.gap].sort((a, b) => a - b)
                const q = (arr: number[], f: number) => +(arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] ?? 0).toFixed(2)
                const split: Record<string, number> = {}
                const worst: Record<string, number> = {}
                PROF_SECTIONS.forEach((k, i) => {
                    split[k] = +(prof.sec[i]! / n).toFixed(3)
                    if (prof.worst[i]! > 0.3) worst[k] = +prof.worst[i]!.toFixed(2)
                })
                const secs = (performance.now() - t0) / 1000
                return {
                    frames: prof.frames,
                    fps: +(prof.frames / secs).toFixed(1),
                    workMs: { avg: +(sorted.reduce((a, b) => a + b, 0) / n).toFixed(2), p50: q(sorted, 0.5), p95: q(sorted, 0.95), max: q(sorted, 1) },
                    gpuMs: prof.gpu.length ? { p50: q([...prof.gpu].sort((a, b) => a - b), 0.5), p95: q([...prof.gpu].sort((a, b) => a - b), 0.95), max: q([...prof.gpu].sort((a, b) => a - b), 1) } : null,
                    gapMs: { p50: q(gaps, 0.5), p95: q(gaps, 0.95), max: q(gaps, 1), over25: gaps.filter(g => g > 25).length },
                    split,
                    worst,
                    calls: renderer.info.render.calls,
                    tris: renderer.info.render.triangles,
                    newPrograms: (renderer.info.programs?.length ?? 0) - programs0,
                    allocMBperSec: mem ? +((grown / 1048576) / secs).toFixed(2) : null,
                    gcs,
                    zombies: zList.length,
                    pr: rr.pixelRatio
                }
            },
            /** Count draw calls over the whole frame (all passes) instead of the last pass. */
            frameStats(on = true) {
                renderer.info.autoReset = !on
            },
            async fps(seconds = 2) {
                const t0 = performance.now()
                let n = 0
                let worst = 0
                let prev = t0
                await new Promise<void>((resolve) => {
                    const tick = () => {
                        const t = performance.now()
                        worst = Math.max(worst, t - prev)
                        prev = t
                        n++
                        if (t - t0 < seconds * 1000) requestAnimationFrame(tick)
                        else resolve()
                    }
                    requestAnimationFrame(tick)
                })
                const ms = (performance.now() - t0) / n
                return { fps: +(1000 / ms).toFixed(1), avgMs: +ms.toFixed(2), worstMs: +worst.toFixed(1) }
            }
        }
        ;(window as unknown as { __df?: unknown }).__df = api
    }

    return {
        lock() {
            audio.unlock()
            input.lock()
        },
        unlock() {
            input.unlock()
        },
        setTyping(on) {
            input.setTyping(on)
        },
        applySettings(s) {
            settings = { ...s }
            audio.setVolume(s.volume)
            audio.setSfxVolume(s.sfxVolume)
            lastFov = 0
        },
        dispose() {
            disposed = true
            if (import.meta.dev) delete (window as unknown as { __df?: unknown }).__df
            cancelAnimationFrame(raf)
            ro.disconnect()
            offSnap()
            offStatus()
            input.dispose()
            for (const v of [worldView, zombieView, projectileView, viewmodel]) {
                try {
                    v.dispose()
                } catch {
                    // ignore
                }
            }
            avatars.dispose()
            powerupView.dispose()
            arsenal.dispose()
            fx.dispose()
            audio.dispose()
            envRt.dispose()
            for (const m of warmMats) m.dispose()
            rr.dispose()
        }
    }
}

/** Dev-only GPU frame timer: one TIME_ELAPSED query per frame, results collected a few frames later. */
function createGpuTimer(gl: WebGLRenderingContext | WebGL2RenderingContext): { begin(): void, end(out: number[]): void } | null {
    if (!('createQuery' in gl)) return null
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number, GPU_DISJOINT_EXT: number } | null
    if (!ext) return null
    const g = gl as WebGL2RenderingContext
    const pending: WebGLQuery[] = []
    let active: WebGLQuery | null = null
    return {
        begin() {
            if (active) return
            active = g.createQuery()
            if (active) g.beginQuery(ext.TIME_ELAPSED_EXT, active)
        },
        end(out) {
            if (active) {
                g.endQuery(ext.TIME_ELAPSED_EXT)
                pending.push(active)
                active = null
            }
            while (pending.length && g.getQueryParameter(pending[0]!, g.QUERY_RESULT_AVAILABLE)) {
                const q = pending.shift()!
                if (!g.getParameter(ext.GPU_DISJOINT_EXT)) out.push(Number(g.getQueryParameter(q, g.QUERY_RESULT)) / 1e6)
                g.deleteQuery(q)
            }
        }
    }
}
