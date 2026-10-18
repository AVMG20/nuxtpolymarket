import * as THREE from 'three'
import { DF_GRENADES, DF_INTERP_DELAY_MS, DF_TICK_HZ, DF_MELEE, DF_PLAYER, DF_BASE_EFFECTS } from '#shared/utils/dead-front/constants'
import { DF_ENEMIES, dfZombieHitTest } from '#shared/utils/dead-front/enemies'
import { DF_BARRICADE_PLANKS, DF_MAP, dfInteractables, dfMaterialSurface } from '#shared/utils/dead-front/map'
import { DF_PERKS, dfComputeEffects } from '#shared/utils/dead-front/perks'
import { dfBuildCollision, dfGroundHeight, dfRaycast } from '#shared/utils/dead-front/physics'
import type { DfCollisionWorld } from '#shared/utils/dead-front/physics'
import { DF_FLAG } from '#shared/utils/dead-front/protocol'
import type {
    DfEvent, DfHeldWeapon, DfMatchStart, DfPlayerSnap, DfProjectileSnap, DfShotHit, DfSnapshot, DfZombieSnap
} from '#shared/utils/dead-front/protocol'
import type { DfHitZone, DfPlayerEffects, DfProfileView, Vec3 } from '#shared/utils/dead-front/types'
import { DF_PAP_COLORS, dfWeaponStats } from '#shared/utils/dead-front/weapons'
import type { DfWeaponStats } from '#shared/utils/dead-front/weapons'
import { randomFloat } from '#shared/utils/random'
import { createDfProjectileView, createDfViewmodel, dfShotSoundName, registerDfWeaponSounds } from '~/utils/dead-front/weapons'
import { createDfWorldView, createDfZombieView, registerDfWorldSounds } from '~/utils/dead-front/world'
import type { DfProjectileView, DfRenderContext, DfViewmodel, DfViewmodelInput, DfWorldView, DfZombieView } from '../context'
import type { DfNet } from '../net'
import { createDfAudio } from './audio'
import { createDfAvatars, dfPlayerColor } from './avatars'
import type { DfAvatarManager } from './avatars'
import { createDfEnvMap } from './envmap'
import { createDfFx } from './fx'
import { DfGunState, DfRecoil, dfAimDir, dfConeDir, dfSpread } from './gun'
import type { DfHudState } from './hud'
import { DfInput } from './input'
import { DfSnapBuffer, dfInterpPlayer, dfInterpZombies, dfNewInterpPlayer, dfWrapAngle } from './interp'
import type { DfInterpPlayer } from './interp'
import { dfClampToScreen, dfObjectiveTarget, dfObjectiveText } from './objective'
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
    return `${w.id}:${w.pap}:${a.optic ?? ''}:${a.muzzle ?? ''}:${a.magazine ?? ''}:${a.stock ?? ''}`
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
    let grenadeReadyAt = 0
    let useCooldown = 0
    let useRepeatAt = 0
    let reviveTarget: number | null = null
    let shotCount = 0
    let predictedHitAt = -10
    /** Zombies this client just hit (render clock): their flinch played locally, so the server's echo is skipped. */
    const predictedFlinch = new Map<number, number>()
    const localHits: { z: number, zone: DfHitZone, pos: Vec3 }[] = []
    /** Kill punch 0..1: a quick FOV squeeze on kills (more on headshots). */
    let killPunch = 0
    let damagePulse = 0
    let downBlend = 0
    let gradeFlash = 0
    let heartbeatAt = 0
    let breathAt = 0
    let spectatePid = -1
    let lastSnapAt = performance.now()
    let currentPrompt: DfPrompt | null = null
    let reloadEmptyPending = false
    let wasLocked = false

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

    let popupId = 0
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

    function heldWeapon(p: DfPlayerSnap, slot: number): DfHeldWeapon | null {
        return p.weapons[slot] ?? p.weapons[0] ?? null
    }

    function equip(w: DfHeldWeapon, now: number): void {
        let s: DfWeaponStats
        try {
            s = dfWeaponStats(w.id, w.pap, w.attachments ?? {})
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

    // ---------------------------------------------------------------- snapshots
    function onSnap(s: DfSnapshot): void {
        const nowMs = performance.now()
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
                perksKey = pk
                computeEffects(p.perks)
            }
            if (!spawned) {
                spawned = true
                player.teleport(p.pos)
                player.yaw = p.yaw
                player.pitch = 0
                localSlot = p.slot
                const w = heldWeapon(p, p.slot)
                if (w) equip(w, now)
                hud.started = true
                audio.play(DF_SND.gameStart)
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
                    if (d2 > 16) player.teleport(p.pos)
                    else if (d2 > 0.5) player.correct(dx, dy, dz)
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
                gun.reconcile(w, now, 0.45 + net.rtt / 1000)
            } else if (heldKey !== '') {
                // weapon handed to Pack-a-Punch: nothing in hand
                heldKey = ''
                stats = null
                gun.stats = null
                gun.cancelReload()
            }
        }
        // the collision world follows the bought doors
        const dk = s.world.doors.join(',')
        if (dk !== doorsKey) {
            doorsKey = dk
            collision = dfBuildCollision(DF_MAP, new Set(s.world.doors))
        }
        // HUD-side reactions happen on arrival; view events wait for the render clock
        for (const ev of s.events) handleImmediate(ev, s)
        if (s.events.length) eventQueue.push({ time: s.time, events: s.events })
        if (hud.round !== s.round && s.round > 0 && hud.round === 0) {
            hud.round = s.round
            hud.roundKey++
        }
    }

    function handleImmediate(ev: DfEvent, s: DfSnapshot): void {
        switch (ev.k) {
            case 'points': {
                hud.popups.push({ id: ++popupId, pid: ev.p, amount: ev.amount, gold: s.world.double > 0, dx: Math.random() * 2 - 1, born: time })
                if (hud.popups.length > 16) hud.popups.shift()
                if (ev.p === me && ev.amount > 0) audio.play(DF_SND.points, { volume: 0.5, rate: ev.amount >= 100 ? 1.12 : 1 })
                break
            }
            case 'hit': {
                if (ev.p !== me) break
                if (time - predictedHitAt > 0.3) {
                    hud.hitmarker = { key: hud.hitmarker.key + 1, kind: 'hit' }
                    audio.play(ev.zone === 'head' ? DF_SND.head : DF_SND.hit, { volume: 0.7 })
                } else if (ev.zone === 'head' && hud.hitmarker.kind === 'hit') {
                    audio.play(DF_SND.head, { volume: 0.5 })
                }
                break
            }
            case 'kill': {
                if (ev.p !== me) break
                const head = ev.zone === 'head'
                hud.hitmarker = { key: hud.hitmarker.key + 1, kind: head ? 'head' : 'kill' }
                hud.killKey++
                killPunch = head ? 1 : 0.6
                fx.shake(head ? 0.07 : 0.045)
                audio.play(head ? DF_SND.killHead : DF_SND.kill, { volume: 0.75 })
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
                announce(`Round ${ev.round}`, ROUND_LINES[Math.floor(Math.random() * ROUND_LINES.length)]!, 'red')
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
                if (ev.p === me) audio.play(DF_SND.buy, { volume: 0.7 })
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
            const echo = ev.k === 'hit' && ev.p === me && time - (predictedFlinch.get(ev.z) ?? -10) < 0.7
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
        fx.flash(from, 0xffb060, 20, 0.06)
        if (shot !== 'hitscan') return
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
            const cands: { z: number, zone: DfHitZone, dist: number }[] = []
            for (const z of zList) {
                const h = dfZombieHitTest(z, eye, dir, limit)
                if (h) cands.push({ z: z.id, zone: h.zone, dist: h.dist })
            }
            cands.sort((a, b) => a.dist - b.dist)
            const through = 1 + Math.max(0, Math.floor(s.penetration))
            const n = Math.min(through, cands.length)
            for (let k = 0; k < n; k++) {
                const c = cands[k]!
                hits.push(c)
                localHits.push({ z: c.z, zone: c.zone, pos: { x: eye.x + dir.x * c.dist, y: eye.y + dir.y * c.dist, z: eye.z + dir.z * c.dist } })
            }
            if (n > 0) claimed = true
            const stopped = n > 0 && n >= through
            if (wh && !stopped) {
                surfaceFx(wh.point, wh.normal, wh.mat)
                if (i === 0) tracerEnd = wh.point
            } else if (i === 0) {
                const d = stopped ? cands[n - 1]!.dist : maxRange
                tracerEnd = { x: eye.x + dir.x * d, y: eye.y + dir.y * d, z: eye.z + dir.z * d }
            }
        }
        net.send({ t: 'fire', origin: { x: eye.x, y: eye.y, z: eye.z }, dirs, hits })
        // the zombie flinches (and bleeds) on this frame, not a round trip later; the server's echo is skipped
        for (let i = 0; i < localHits.length; i++) {
            const h = localHits[i]!
            if (localHits.findIndex(o => o.z === h.z) !== i) continue
            predictedFlinch.set(h.z, time)
            try {
                zombieView.onEvent({ k: 'hit', z: h.z, p: me, zone: h.zone, pos: h.pos, dmg: Math.round(s.damage) })
            } catch (e) {
                console.error('[dead-front] zombie view predicted hit', e)
            }
        }
        localHits.length = 0
        if (predictedFlinch.size > 64) {
            for (const [z, at] of predictedFlinch) if (time - at > 1) predictedFlinch.delete(z)
        }
        if (gun.reloading) safe('vm cancel', () => viewmodel.cancelReload(), undefined)
        gun.fired(now, effects.fireRateMult)
        lastShot = now
        shotCount++
        safe('vm fire', () => viewmodel.fire(), undefined)
        // recoil
        const ads = viewmodel.adsBlend
        const kick = Math.max(0, s.recoil) * effects.recoilMult * (1 - ads * 0.35) * (player.crouched ? 0.85 : 1)
        fx.shake(recoil.kick(now, gun.cls, gun.auto, kick, Math.random()))
        // muzzle light in both scenes
        viewmodel.muzzleWorld(camera, tmpV2)
        // candela: has to beat the ~5-12 cd lantern pools to visibly light the surroundings
        // (one pooled light per shot; Pack-a-Punched guns flash in their tier colour)
        const flashColor = s.shot === 'xray-bolt' ? 0x60ff80 : s.shot === 'arc' ? 0x8ab8ff : gun.pap > 0 ? (DF_PAP_COLORS[gun.pap - 1] ?? 0xffa850) : 0xffa850
        fx.flash(tmpV2, flashColor, 28, 0.06)
        vmMuzzle.intensity = s.shot === 'hitscan' ? 3 : 1.5
        // tracers on some rounds
        if (hitscan && tracerEnd) {
            const every = gun.auto ? 3 : pellets > 1 ? 1 : 2
            if (shotCount % every === 0) fx.tracer(tmpV2, tracerEnd)
        }
        if (claimed) {
            predictedHitAt = time
            const head = hits.some(h => h.zone === 'head')
            hud.hitmarker = { key: hud.hitmarker.key + 1, kind: 'hit' }
            audio.play(head ? DF_SND.head : DF_SND.hit, { volume: 0.7 })
        }
        if (gun.mag <= 0) reloadEmptyPending = true
    }

    function tryReload(now: number): void {
        if (!gun.canReload() || !stats) return
        const empty = gun.mag === 0
        const t = gun.startReload(now, effects.reloadMult)
        if (t <= 0) return
        net.send({ t: 'reload' })
        safe('vm reload', () => viewmodel.reload(empty, t, gun.shellMode), undefined)
    }

    function melee(now: number): void {
        if (now < meleeReadyAt || !mine) return
        meleeReadyAt = now + DF_MELEE.cooldown
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
        if (gun.reloading) {
            gun.cancelReload()
            safe('vm cancel', () => viewmodel.cancelReload(), undefined)
        }
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
        net.send({ t: 'melee', z: best.id, zone: h?.zone === 'head' ? 'head' : 'body' })
        predictedHitAt = time
        hud.hitmarker = { key: hud.hitmarker.key + 1, kind: 'hit' }
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

    function swapTo(slot: number, now: number): void {
        if (!mine || life === 'dead') return
        if (life === 'down') return
        const count = mine.weapons.length
        if (count < 2) return
        const s = ((slot % count) + count) % count
        if (s === localSlot) return
        localSlot = s
        swapPendingUntil = now + 1.2
        net.send({ t: 'swap', slot: s })
        gun.cancelReload()
        const w = mine.weapons[s]
        if (w) equip(w, now)
    }

    // ---------------------------------------------------------------- interaction
    function updatePrompt(): void {
        currentPrompt = null
        if (!mine || !latest || life !== 'alive') return
        const pctx = { map: DF_MAP, world: latest.world, me: mine, solo }
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
        const idx = dfPickInteractable(interactables, camera.position, fwdFlat.x, fwdFlat.z, DF_PLAYER.useRange, (i) => dfPromptFor(interactables[i]!, pctx) === null)
        if (idx < 0) return
        currentPrompt = dfPromptFor(interactables[idx]!, pctx)
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
            useCooldown = now + 0.4
            useRepeatAt = now + 0.25
        } else if (p.repeat && held && now >= useRepeatAt) {
            net.send({ t: 'use', id: p.id })
            useRepeatAt = now + 0.25
        }
    }

    // ---------------------------------------------------------------- per-frame input
    function handleInput(dt: number, now: number): void {
        const locked = input.locked
        if (locked !== wasLocked) {
            wasLocked = locked
            hud.locked = locked
        }
        // look
        const zoom = 1 + ((stats?.adsZoom ?? 1) - 1) * viewmodel.adsBlend
        const sens = 0.0022 * settings.sensitivity / (1 + (zoom - 1) * 0.85)
        if (locked) {
            player.yaw = dfWrapAngle(player.yaw - input.mouseX * sens)
            const dPitch = -input.mouseY * sens * (settings.invertY ? -1 : 1)
            player.pitch += dPitch
            // pulling down against the climb counts as recoil control
            if (dPitch < 0) player.pitch += recoil.compensate(-dPitch)
            player.pitch = Math.max(-1.52, Math.min(1.52, player.pitch))
        }
        vmInput.look.x = locked ? input.mouseX : 0
        vmInput.look.y = locked ? input.mouseY : 0
        hud.scoreboard = locked && input.has('Tab')

        const alive = life !== 'dead'
        const canAct = locked && alive && spawned
        // movement intent
        intent.fwd = canAct ? (input.has('KeyW') || input.has('ArrowUp') ? 1 : 0) - (input.has('KeyS') || input.has('ArrowDown') ? 1 : 0) : 0
        intent.right = canAct ? (input.has('KeyD') || input.has('ArrowRight') ? 1 : 0) - (input.has('KeyA') || input.has('ArrowLeft') ? 1 : 0) : 0
        intent.sprint = canAct && input.has('ShiftLeft') && now >= sprintLockUntil && life === 'alive'
        intent.crouch = false
        if (canAct && input.pressed('KeyC')) player.toggleCrouch()
        if (canAct && input.pressed('Space')) player.queueJump(now)
        if (canAct && input.pressed('Space') && player.crouched) player.wantsCrouch = false
        const wantsAds = canAct && input.has('Mouse2') && !player.sprinting
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

        // weapon actions
        const trigger = input.has('Mouse0')
        if (input.pressed('Mouse0')) {
            gun.press(now)
            if (player.sprinting) sprintLockUntil = now + 0.3
            if (gun.mag <= 0 && gun.canReload()) tryReload(now)
        }
        if (trigger && player.sprinting) sprintLockUntil = now + 0.3
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
        if (input.pressed('KeyR')) tryReload(now)
        if (life === 'alive') {
            if (input.pressed('Digit1')) swapTo(0, now)
            if (input.pressed('Digit2')) swapTo(1, now)
            if (input.pressed('Digit3')) swapTo(2, now)
            if (input.wheel !== 0) swapTo(localSlot + (input.wheel > 0 ? 1 : -1), now)
            if (input.pressed('KeyV')) melee(now)
            if (input.pressed('KeyG')) throwGrenade(now)
            handleUse(now)
        }
        // reload / shell progress
        const ev = gun.update(now, dt, effects.reloadMult)
        if (ev === 'shell' && stats) safe('vm shell', () => viewmodel.reload(false, stats!.perRoundReload / Math.max(0.1, effects.reloadMult), true), undefined)
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

    // ---------------------------------------------------------------- the loop
    let interpDelay: number = DF_INTERP_DELAY_MS
    function frame(): void {
        if (disposed) return
        raf = requestAnimationFrame(frame)
        const nowMs = performance.now()
        const dt = Math.min(0.1, Math.max(0, (nowMs - last) / 1000))
        last = nowMs
        time += dt
        const now = time

        handleInput(dt, now)

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
        }
        const alpha = Math.min(1, acc / DF_STEP)

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
            net.send({ t: 'in', seq, pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z }, yaw: player.yaw, pitch: player.pitch, flags })
        }

        // ---- interpolation
        // Ease toward the jitter-adapted delay so the render clock never jumps.
        const targetDelay = buffer.targetDelay(DF_INTERP_DELAY_MS, 1000 / DF_TICK_HZ)
        interpDelay += (targetDelay - interpDelay) * Math.min(1, dt * (targetDelay > interpDelay ? 2 : 0.3))
        const renderT = buffer.renderTime(nowMs, interpDelay)
        const sample = buffer.at(renderT)
        while (eventQueue.length && eventQueue[0]!.time <= renderT + 1e-4) {
            const q = eventQueue.shift()!
            for (const ev of q.events) dispatchView(ev)
        }
        // never hold events more than a second behind
        while (eventQueue.length && eventQueue[0]!.time < renderT - 1) {
            const q = eventQueue.shift()!
            for (const ev of q.events) dispatchView(ev)
        }
        buffer.trim(renderT)
        let pCount = 0
        if (sample) {
            dfInterpZombies(sample, zPool, zList)
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

        // ---- camera
        updateCamera(dt, now, alpha)

        // ---- views
        const world = sample?.b.s.world ?? latest?.world
        try {
            if (world) worldView.update(dt, world, latest?.time ?? 0)
        } catch (e) {
            console.error('[dead-front] world view update', e)
        }
        try {
            zombieView.update(dt, zList)
        } catch (e) {
            console.error('[dead-front] zombie view update', e)
        }
        try {
            projectileView.update(dt, projList)
        } catch (e) {
            console.error('[dead-front] projectile view update', e)
        }
        avatars.update(dt, now, pList, pCount)
        powerupView.update(dt, now, latest?.powerups ?? [])

        // viewmodel
        vmInput.speed = Math.min(1, player.speed / Math.max(0.1, speeds.sprint))
        vmInput.sprinting = player.sprinting
        vmInput.crouching = player.crouched
        vmInput.grounded = player.grounded
        vmInput.adsMult = effects.adsMult
        viewmodel.root.visible = life !== 'dead'
        try {
            viewmodel.update(dt, vmInput)
        } catch (e) {
            console.error('[dead-front] viewmodel update', e)
        }
        vmMuzzle.intensity *= Math.exp(-dt * 40)

        // feedback: low health, downed, damage
        updateFeedback(dt, now)

        fx.resize(rr.bufferHeight, rr.pixelRatio)
        fx.update(dt, now)
        audio.setTension(Math.min(1, zList.length / 18))
        audio.updateListener(camera)

        // HUD
        hudTimer += dt
        if (hudTimer >= 1 / 20) {
            hudTimer = 0
            updatePrompt()
            updateHud(nowMs)
        }
        updateHudFast()

        const health = mine && mine.maxHealth > 0 ? mine.health / mine.maxHealth : 1
        // The moon's shadow map is the most expensive pass (hundreds of casters, zombies
        // included): refresh it every other frame. 30 Hz shadows are indistinguishable here.
        shadowTick = (shadowTick + 1) % 2
        renderer.shadowMap.needsUpdate = shadowTick === 0
        if (import.meta.dev && !renderer.info.autoReset) renderer.info.reset()
        rr.render(dt, now, {
            lowHealth: life === 'alive' ? Math.max(0, Math.min(1, (0.5 - health) / 0.38)) : 0,
            damage: damagePulse,
            down: downBlend,
            flash: gradeFlash
        })
        input.endFrame()
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

        const eyeH = player.eyeHeight() + player.stepOffset - landOff * 0.12 + bobY
        // sideways bob in camera space
        const sy = Math.sin(player.yaw)
        const cy = Math.cos(player.yaw)
        camera.position.set(rx + cy * bobX, ry + eyeH, rz - sy * bobX)

        // recoil lands, then recovers once the trigger rests
        recoil.update(dt, now)
        const downRoll = player.downed ? 0.16 + Math.sin(now * 0.9) * 0.03 : 0
        const strafeRoll = -(player.vel.x * cy - player.vel.z * sy) * 0.0035 * (1 - ads)
        camera.rotation.set(
            player.pitch + recoil.pitch + fx.shakePitch - landOff * 0.02,
            player.yaw + recoil.yaw + fx.shakeYaw,
            fx.shakeRoll + downRoll + strafeRoll + bobX * 0.3,
            'YXZ'
        )

        // FOV: sprint kick, ADS zoom
        sprintFov += ((sprint ? 1 : 0) - sprintFov) * Math.min(1, dt * 6)
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
        hud.connection = net.status !== 'open' ? 'reconnecting' : nowMs - lastSnapAt > 2500 && spawned ? 'lost' : 'ok'
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
            if (!row || row.pid !== p.pid) {
                hud.players[i] = { pid: p.pid, name: p.name, color: dfPlayerColor(p.pid), me: p.pid === me, points: p.points, kills: p.kills, headshots: p.headshots, downs: p.downs, revives: p.revives, life: p.life, connected: p.connected, ping }
                return
            }
            row.points = p.points
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
            const pk = m.perks
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
        const pu = hud.powerups
        pu.length = 0
        if (w.double > 0) pu.push({ kind: 'double', name: DF_POWERUP_NAMES.double, seconds: w.double, ending: w.double < 5 })
        if (w.insta > 0) pu.push({ kind: 'insta', name: DF_POWERUP_NAMES.insta, seconds: w.insta, ending: w.insta < 5 })

        // prompt
        const p = currentPrompt
        if (p) {
            // hold actions fill the prompt's bar: a revive's progress, the boards of a barrier being rebuilt
            let holdProgress = p.action === 'revive' && hud.reviving ? hud.reviving.progress : 0
            if (p.repeat && p.kind === 'barricade' && input.has('KeyF')) holdProgress = Math.min(1, (w.planks[p.id] ?? 0) / DF_BARRICADE_PLANKS)
            if (!hud.prompt) hud.prompt = { text: p.text, sub: p.sub ?? '', cost: p.cost, ok: p.ok, denyKey: 0, hold: holdProgress }
            else {
                hud.prompt.text = p.text
                hud.prompt.sub = p.sub ?? ''
                hud.prompt.cost = p.cost
                hud.prompt.ok = p.ok
                hud.prompt.hold = holdProgress
            }
        } else if (hud.prompt) hud.prompt = null

        // objective
        const egg = w.egg
        const o = hud.objective
        o.visible = egg.step !== 'done'
        o.step = egg.step
        o.text = dfObjectiveText(egg.step)
        o.fuses = egg.step === 'fuses' ? `${egg.fusesFound.length}/${DF_MAP.egg.fuses.length || 3}` : null
        o.charge = egg.step === 'charge' ? Math.min(1, egg.charge / Math.max(1, egg.chargeNeeded)) : null
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

    let lastSpread = -1
    let lastWp = ''
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
        root.style.setProperty('--df-yaw', (camera.rotation.y).toFixed(4))
        // waypoint
        if (wpHas) {
            tmpV.copy(wpTarget).applyMatrix4(camera.matrixWorldInverse)
            const P = camera.projectionMatrix.elements
            dfClampToScreen(tmpV.x, tmpV.y, tmpV.z, P[0]!, P[5]!, cssW, cssH, 56, screenPt)
            const k = `${screenPt.x | 0},${screenPt.y | 0},${screenPt.onScreen ? 1 : 0},${screenPt.angle.toFixed(2)}`
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
    input.onLockChange = (locked) => {
        hud.locked = locked
        wasLocked = locked
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
            interactables: () => interactables.map(i => ({ id: i.id, kind: i.kind, pos: i.pos })),
            state() {
                const info = renderer.info
                return {
                    pos: { ...player.pos },
                    yaw: player.yaw,
                    pitch: player.pitch,
                    life,
                    me: mine && { health: mine.health, points: mine.points, weapons: mine.weapons, perks: mine.perks, grenades: mine.grenades },
                    round: latest?.round,
                    phase: latest?.phase,
                    world: latest?.world,
                    zombies: zList.map(z => ({ id: z.id, type: z.type, anim: z.anim, hp: z.hp, d: +Math.hypot(z.pos.x - player.pos.x, z.pos.z - player.pos.z).toFixed(1) })),
                    prompt: currentPrompt,
                    hud: { ammo: { ...hud.ammo }, objective: { ...hud.objective }, prompt: hud.prompt, locked: hud.locked },
                    gl: { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length, pr: rr.pixelRatio, buffer: [rr.bufferWidth, rr.bufferHeight] }
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
            fx.dispose()
            audio.dispose()
            envRt.dispose()
            rr.dispose()
        }
    }
}
