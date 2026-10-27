import * as THREE from 'three'
import { DF_KILLSTREAK, DF_REWARDS, DF_STRIKE, dfNextReward } from '#shared/utils/dead-front/killstreaks'
import type { DfRewardId } from '#shared/utils/dead-front/killstreaks'
import { DF_MAP } from '#shared/utils/dead-front/map'
import { dfBenchUsePoint } from '#shared/utils/dead-front/map-benches'
import { dfGroundHeight, dfRaycast } from '#shared/utils/dead-front/physics'
import type { DfCollisionWorld } from '#shared/utils/dead-front/physics'
import type { DfEvent, DfPlayerSnap, DfWorldSnap } from '#shared/utils/dead-front/protocol'
import { DF_KIT, dfClampRarity, dfRarity } from '#shared/utils/dead-front/rarity'
import { DF_ARMOR, DF_DECOY, DF_RECIPES, DF_SENTRY } from '#shared/utils/dead-front/salvage'
import type { DfKitDropSnap } from '#shared/utils/dead-front/salvage'
import type { Vec3 } from '#shared/utils/dead-front/types'
import type { DfRenderContext } from '../context'
import type { DfNet } from '../net'
import { DF_ARSENAL_SND, registerDfArsenalSounds } from './arsenal-sounds'
import { DF_BENCH_PICKS, dfBenchItem, dfBenchList, dfHeldOf, dfKitPrompt, dfWeaponDisplayName } from './arsenal-prompt'
import type { DfBenchPick } from './arsenal-prompt'
import type { DfHudState } from './hud'
import type { DfInput } from './input'
import type { DfPrompt } from './prompt'
import { DF_SND } from './sounds'

// The local player's side of salvage, the workbench, crafted gear, upgrade
// kits and killstreaks: the bench (tap F for the next item, hold F to make
// it), placing gear (hold Q to aim, release to place), calling in support
// (hold X or 4 to mark, release to call it in), taking upgrade kits off the
// ground, the HUD state and the callouts. The server decides; nothing here
// changes value on its own.

export interface DfArsenalClientOpts {
    ctx: DfRenderContext
    net: DfNet
    me: number
    hud: DfHudState
    input: DfInput
    collision: () => DfCollisionWorld
    /** The local player's feet. */
    feet: () => Vec3
    /** The aim direction (unit). */
    aim: (out: Vec3) => Vec3
    announce: (title: string, sub: string, tone: 'gold' | 'red' | 'pale') => void
}

export interface DfArsenalClient {
    /** What the bench is set to make (for its prompt). */
    readonly pick: DfBenchPick
    /** 0..1 the bench hold bar. */
    readonly holdProgress: number
    /** An upgrade kit on the ground in reach and in front, as a prompt (null: none). */
    prompt(me: DfPlayerSnap, world: DfWorldSnap): DfPrompt | null
    /** Keys for this frame (call while alive and acting). */
    input(now: number, prompt: DfPrompt | null, me: DfPlayerSnap | null, world: DfWorldSnap | null): void
    /** HUD state and the aiming markers. */
    frame(dt: number, me: DfPlayerSnap | null, world: DfWorldSnap | null): void
    /** Events as they arrive (callouts and sounds for the local player). */
    onEvent(ev: DfEvent): void
    /** Facts for the first-match hints. */
    facts(me: DfPlayerSnap | null, world: DfWorldSnap | null): { salvage: number, equip: string | null, reward: string | null, benchNear: boolean, canCraft: boolean }
    dispose(): void
}

const TAP = 0.28
const HOLD = 0.6

function ringMaterial(color: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
}

export function createDfArsenalClient(o: DfArsenalClientOpts): DfArsenalClient {
    const { ctx, net, me, hud, input } = o
    registerDfArsenalSounds(ctx.audio)
    let pick: DfBenchPick = 'sentry'
    let benchAt: number | null = null
    let benchSent = false
    let holdProgress = 0
    let aiming: 'deploy' | 'callin' | null = null
    let aimOk = false
    let flashUntil = 0
    let clock = 0
    let lastBench = ''
    let benchKey = ''
    const target = new THREE.Vector3()
    const aimV = { x: 0, y: 0, z: -1 }

    // markers on the ground while aiming: a ring (gear, the barrage) or a strip along the line (the flyers)
    const ringGeo = new THREE.RingGeometry(0.8, 1, 48)
    ringGeo.rotateX(-Math.PI / 2)
    const stripGeo = new THREE.PlaneGeometry(1, 1)
    stripGeo.rotateX(-Math.PI / 2)
    const okMat = ringMaterial(0x7cff8a)
    const badMat = ringMaterial(0xff5a3a)
    const strikeMat = ringMaterial(0xff3a2a)
    const ring = new THREE.Mesh(ringGeo, okMat)
    const strip = new THREE.Mesh(stripGeo, strikeMat)
    ring.visible = strip.visible = false
    ring.renderOrder = strip.renderOrder = 5
    ctx.scene.add(ring, strip)

    const send = (op: Parameters<DfNet['send']>[0]) => net.send(op)
    const deny = () => ctx.audio.play(DF_SND.denied, { volume: 0.7 })
    const say = (text: string) => {
        hud.arsenal.targeting = text
        flashUntil = clock + 1.8
    }
    const mineOf = (world: DfWorldSnap | null) => world?.arsenal?.players.find(p => p.pid === me) ?? null

    /** Where the aim lands on a floor, within `range` (horizontal) of the feet. */
    const aimPoint = (range: number, out: THREE.Vector3): boolean => {
        const world = o.collision()
        const eye = ctx.camera.position
        o.aim(aimV)
        const hit = dfRaycast(world, eye, aimV, range + 4)
        let x: number
        let y: number
        let z: number
        if (hit) {
            // a wall: step back off it and find the floor below
            const back = hit.normal.y > 0.6 ? 0 : 0.35
            x = hit.point.x - aimV.x * back
            z = hit.point.z - aimV.z * back
            y = hit.point.y
        } else {
            x = eye.x + aimV.x * range
            y = eye.y + aimV.y * range
            z = eye.z + aimV.z * range
        }
        const feet = o.feet()
        const dx = x - feet.x
        const dz = z - feet.z
        const d = Math.hypot(dx, dz)
        if (d > range) {
            x = feet.x + (dx / d) * range
            z = feet.z + (dz / d) * range
        }
        const g = dfGroundHeight(world, x, z, Math.max(y, feet.y) + 0.6)
        out.set(x, g, z)
        return Math.abs(g - feet.y) < 6
    }

    const nearestKit = (meP: DfPlayerSnap, world: DfWorldSnap): DfKitDropSnap | null => {
        const feet = o.feet()
        o.aim(aimV)
        let best: DfKitDropSnap | null = null
        let bd = Infinity
        for (const k of world.arsenal?.kits ?? []) {
            const dx = k.pos.x - feet.x
            const dz = k.pos.z - feet.z
            const d = Math.hypot(dx, dz)
            if (d > DF_KIT.reach || Math.abs(k.pos.y - feet.y) > 1.6) continue
            const fl = Math.hypot(aimV.x, aimV.z) || 1
            const facing = d < 0.6 ? 1 : (dx * aimV.x + dz * aimV.z) / (d * fl)
            if (facing < 0.3) continue
            if (d < bd) {
                bd = d
                best = k
            }
        }
        return meP.life === 'alive' ? best : null
    }

    const callout = (title: string, sub: string, tone: 'gold' | 'red' | 'pale' = 'gold') => o.announce(title, sub, tone)

    return {
        get pick() {
            return pick
        },
        get holdProgress() {
            return holdProgress
        },

        prompt(meP, world) {
            const k = nearestKit(meP, world)
            return k ? dfKitPrompt(k, meP) : null
        },

        input(now, prompt, meP, world) {
            // ---- the workbench: tap F for the next item, hold F to make it
            if (prompt?.kind === 'bench' && meP && world) {
                if (prompt.id !== lastBench) {
                    lastBench = prompt.id
                    benchAt = null
                }
                if (input.pressed('KeyF')) {
                    benchAt = now
                    benchSent = false
                }
                if (benchAt !== null && input.has('KeyF') && !benchSent) {
                    holdProgress = Math.max(0, Math.min(1, (now - benchAt - 0.12) / (HOLD - 0.12)))
                    if (holdProgress >= 1) {
                        benchSent = true
                        holdProgress = 0
                        const item = dfBenchItem(pick, { world, me: meP }, true)
                        if (!item.ok) {
                            deny()
                            if (hud.prompt) hud.prompt.denyKey++
                        } else if (pick === 'upgrade') {
                            const w = dfHeldOf(meP)
                            if (w) send({ t: 'arsenal', op: { k: 'upgrade', bench: prompt.id, slot: meP.slot, from: dfClampRarity(w.rarity) } })
                        } else {
                            send({ t: 'arsenal', op: { k: 'craft', bench: prompt.id, item: pick } })
                        }
                    }
                }
                if (input.released('KeyF')) {
                    if (benchAt !== null && !benchSent && now - benchAt < TAP) {
                        pick = DF_BENCH_PICKS[(DF_BENCH_PICKS.indexOf(pick) + 1) % DF_BENCH_PICKS.length]!
                        ctx.audio.play(DF_SND.reviveTick, { volume: 0.8, rate: 1.3 })
                    }
                    benchAt = null
                    holdProgress = 0
                }
            } else {
                benchAt = null
                holdProgress = 0
                lastBench = ''
            }

            // ---- an upgrade kit on the ground
            if (prompt?.kind === 'kit' && input.pressed('KeyF')) {
                if (prompt.ok) send({ t: 'arsenal', op: { k: 'kit', id: Number(prompt.id.slice(4)) } })
                else {
                    deny()
                    if (hud.prompt) hud.prompt.denyKey++
                }
            }

            const mine = mineOf(world)
            // ---- gear: hold Q to aim, release to place
            if (input.pressed('KeyQ')) {
                if (!mine?.equip) {
                    deny()
                    say('No gear to place · craft some at a workbench')
                } else {
                    aiming = 'deploy'
                }
            }
            // ---- support: hold X (or 4) to mark, release to call it in
            if (input.pressed('KeyX') || input.pressed('Digit4')) {
                if (!mine?.rewards.length) {
                    deny()
                    const next = dfNextReward(mine?.streak ?? 0)
                    say(`No support yet · ${next.at - (mine?.streak ?? 0)} more kills for the ${DF_REWARDS[next.id].name}`)
                } else {
                    aiming = 'callin'
                }
            }
            if (aiming === 'deploy' && mine?.equip) {
                const range = mine.equip === 'sentry' ? DF_SENTRY.placeRange : DF_DECOY.placeRange
                aimOk = aimPoint(range, target)
                if (input.released('KeyQ') || !input.has('KeyQ')) {
                    aiming = null
                    if (aimOk) send({ t: 'arsenal', op: { k: 'deploy', pos: { x: target.x, y: target.y, z: target.z }, yaw: Math.atan2(target.x - o.feet().x, target.z - o.feet().z) } })
                    else deny()
                }
            } else if (aiming === 'callin' && mine?.rewards.length) {
                aimOk = aimPoint(DF_KILLSTREAK.range - 2, target)
                const held = input.has('KeyX') || input.has('Digit4')
                if (!held) {
                    aiming = null
                    o.aim(aimV)
                    if (aimOk) {
                        send({ t: 'arsenal', op: { k: 'callin', at: { x: target.x, y: target.y, z: target.z }, dir: { x: aimV.x, y: 0, z: aimV.z } } })
                        ctx.audio.play(DF_ARSENAL_SND.callin, { volume: 0.9 })
                    } else {
                        deny()
                    }
                }
            } else if (aiming) {
                aiming = null
            }
        },

        frame(dt, meP, world) {
            clock += dt
            // down or dead: whatever was being aimed is dropped, not placed on the way back up
            if (!meP) aiming = null
            const a = hud.arsenal
            const ars = world?.arsenal
            const mine = mineOf(world)
            if (ars) {
                if ((ars.scrap ?? 0) !== a.scrap) a.scrap = ars.scrap ?? 0
                if ((ars.parts ?? 0) !== a.parts) a.parts = ars.parts ?? 0
                const ch = ars.challenge
                if (!ch) a.challenge = null
                else if (!a.challenge || a.challenge.text !== ch.text || a.challenge.n !== ch.n || a.challenge.done !== ch.done || a.challenge.goal !== ch.goal) {
                    a.challenge = { text: ch.text, n: ch.n, goal: ch.goal, done: ch.done }
                }
            }
            if (mine) {
                const armor = Math.min(1, mine.armor / DF_ARMOR.max)
                if (Math.abs(armor - a.armor) > 0.004) a.armor = armor
                if (a.equip !== mine.equip) a.equip = mine.equip
                if (a.kit !== mine.kit) a.kit = mine.kit
                if (a.streak !== mine.streak) a.streak = mine.streak
                const next = dfNextReward(mine.streak)
                if (a.next.at !== next.at || a.next.from !== next.from) a.next = { name: DF_REWARDS[next.id].name, at: next.at, from: next.from }
                const rk = mine.rewards.join(',')
                if (a.rewards.map(r => r.id).join(',') !== rk) a.rewards = mine.rewards.map(id => ({ id, name: DF_REWARDS[id].name }))
            }
            // the bench list while one is in front of us
            const benchPrompt = hud.prompt && meP && world && lastBench
            if (benchPrompt) {
                const items = dfBenchList({ world: world!, me: meP! }, pick)
                const key = items.map(i => `${i.key}${i.ok ? 1 : 0}${i.selected ? 1 : 0}${i.name}${i.why}`).join('|')
                if (!a.bench || benchKey !== key) {
                    benchKey = key
                    a.bench = { items, hold: holdProgress }
                } else {
                    a.bench.hold = holdProgress
                }
            } else if (a.bench) {
                a.bench = null
                benchKey = ''
            }
            // aiming markers and their line
            if (aiming === 'deploy' && mine?.equip) {
                ring.visible = true
                strip.visible = false
                ring.material = aimOk ? okMat : badMat
                ring.position.set(target.x, target.y + 0.04, target.z)
                ring.scale.setScalar(mine.equip === 'sentry' ? 0.55 : 0.8)
                a.targeting = `Release Q to place the ${DF_RECIPES[mine.equip].name}`
            } else if (aiming === 'callin' && mine?.rewards.length) {
                const reward = mine.rewards[mine.rewards.length - 1]!
                ring.material = aimOk ? strikeMat : badMat
                strip.material = ring.material
                if (reward === 'barrage') {
                    ring.visible = true
                    strip.visible = false
                    ring.position.set(target.x, target.y + 0.05, target.z)
                    ring.scale.setScalar(DF_STRIKE.barrage.spread)
                } else {
                    ring.visible = false
                    strip.visible = true
                    const len = reward === 'zeppelin' ? DF_STRIKE.zeppelin.length : DF_STRIKE.strafe.length
                    strip.position.set(target.x, target.y + 0.05, target.z)
                    o.aim(aimV)
                    strip.rotation.set(0, Math.atan2(aimV.x, aimV.z), 0)
                    strip.scale.set(reward === 'zeppelin' ? 4.5 : 3, 1, len)
                }
                const pulse = 0.45 + 0.25 * Math.sin(clock * 10)
                ;(ring.material as THREE.MeshBasicMaterial).opacity = pulse
                a.targeting = `Release X to call in the ${DF_REWARDS[reward].name}`
            } else {
                ring.visible = strip.visible = false
                if (clock > flashUntil && a.targeting) a.targeting = null
            }
        },

        onEvent(ev) {
            switch (ev.k) {
                case 'salvage':
                    if (ev.p === me) hud.arsenal.salvageKey++
                    return
                case 'reward':
                    if (ev.p !== me) return
                    ctx.audio.play(DF_ARSENAL_SND.reward, { volume: 1 })
                    callout(`${DF_REWARDS[ev.reward].name} ready`, `${ev.n} kills without going down · hold X to mark, release to call it in`)
                    return
                case 'strike':
                    if (ev.p !== me) ctx.audio.play(DF_ARSENAL_SND.callin, { volume: 0.5 })
                    callout(`${DF_REWARDS[ev.reward as DfRewardId].name} inbound`, ev.p === me ? 'Keep clear of the mark · it won\'t hurt the squad' : 'Support is on its way', 'red')
                    return
                case 'craft':
                    if (ev.p !== me) return
                    if (ev.item === 'sentry' || ev.item === 'decoy') say(`Hold Q to aim, release to place the ${DF_RECIPES[ev.item].name}`)
                    else if (ev.item === 'plate') ctx.audio.play(DF_ARSENAL_SND.plate, { volume: 0.8 })
                    return
                case 'armor':
                    if (ev.p === me && ev.broken) {
                        ctx.audio.play(DF_ARSENAL_SND.plateBreak, { volume: 0.9 })
                        say('Your trench plate broke')
                    }
                    return
                case 'rarity': {
                    if (ev.p !== me) return
                    const r = dfRarity(ev.rarity)
                    ctx.audio.play(DF_ARSENAL_SND.challengeDone, { volume: 0.7, rate: 0.9 + ev.rarity * 0.08 })
                    if (ev.how !== 'box') callout(`${r.name} ${dfWeaponDisplayName(ev.weapon)}`, ev.how === 'kit' ? 'Upgrade kit applied' : 'Upgraded at the workbench', 'gold')
                    return
                }
                case 'kitDrop':
                    if (ev.p === me) say('Already that good · the kit is on the ground for later (2 min)')
                    return
                case 'challenge':
                    if (ev.what === 'new') {
                        ctx.audio.play(DF_ARSENAL_SND.challenge, { volume: 0.7 })
                    } else if (ev.what === 'done') {
                        ctx.audio.play(DF_ARSENAL_SND.challengeDone, { volume: 0.9 })
                        callout('Challenge complete', `${ev.text} · salvage and points for everyone`, 'gold')
                    }
            }
        },

        facts(meP, world) {
            const mine = mineOf(world)
            const reward = mine?.rewards.length ? DF_REWARDS[mine.rewards[mine.rewards.length - 1]!].name : null
            let benchNear = false
            let canCraft = false
            if (meP && world) {
                const feet = o.feet()
                canCraft = DF_BENCH_PICKS.some(k => dfBenchItem(k, { world, me: meP }, false).ok)
                benchNear = (DF_MAP.benches ?? []).some((b) => {
                    const u = dfBenchUsePoint(b)
                    return Math.hypot(u.x - feet.x, u.z - feet.z) < 7 && Math.abs(u.y - feet.y) < 2
                })
            }
            return { salvage: (world?.arsenal?.scrap ?? 0) + (world?.arsenal?.parts ?? 0), equip: mine?.equip ?? null, reward, benchNear, canCraft }
        },

        dispose() {
            ring.removeFromParent()
            strip.removeFromParent()
            ringGeo.dispose()
            stripGeo.dispose()
            okMat.dispose()
            badMat.dispose()
            strikeMat.dispose()
        }
    }
}
