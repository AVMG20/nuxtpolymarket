import { DF_COSTS, DF_MAX_PERKS, DF_SOLO_SECONDWIND_MAX, dfPapCost } from '#shared/utils/dead-front/constants'
import { DF_BARRICADE_PLANKS } from '#shared/utils/dead-front/map'
import type { DfInteractable, DfMapDef } from '#shared/utils/dead-front/map'
import { DF_PERKS } from '#shared/utils/dead-front/perks'
import { DF_TRAP } from '#shared/utils/dead-front/specials'
import type { DfHeldWeapon, DfPlayerSnap, DfWorldSnap } from '#shared/utils/dead-front/protocol'
import { dfEggRodSpots } from './objective'
import { dfKitName, dfRarity } from '#shared/utils/dead-front/rarity'
import { dfBenchPrompt } from './arsenal-prompt'
import type { DfBenchPick } from './arsenal-prompt'
import type { Vec3 } from '#shared/utils/dead-front/types'
import { DF_WEAPONS, dfWeaponStats } from '#shared/utils/dead-front/weapons'

// Interaction prompts built from the live snapshot (pure, tested), and the
// nearest-interactable search.

export interface DfPrompt {
    /** Interactable id for `use`, or `revive:<pid>`. */
    id: string
    kind: DfInteractable['kind'] | 'revive' | 'kit' | 'crate'
    /** Text before the cost, e.g. "Hold F to clear the debris". */
    text: string
    /** Optional second line (door label, weapon detail). */
    sub?: string
    cost: number | null
    /** False when the player can't afford it or it isn't available. */
    ok: boolean
    /** What pressing F does. */
    action: 'use' | 'revive' | 'none'
    /** Re-send `use` while held (barricades). */
    repeat: boolean
    pid?: number
    /** Colour of the text: the rarity of what is on offer. */
    tint?: string
}

export interface DfPromptCtx {
    map: DfMapDef
    world: DfWorldSnap
    me: DfPlayerSnap
    solo: boolean
    /** What the workbench is set to make (the engine's selection). */
    benchPick?: DfBenchPick
}

/** Price to refill a weapon at its wall-buy; Pack-a-Punched ammo costs more. */
export function dfWallAmmoCost(weapon: DfHeldWeapon['id'], pap: number): number {
    const base = DF_WEAPONS[weapon].ammoCost ?? Math.round((DF_WEAPONS[weapon].wallCost ?? 1000) / 2)
    return pap > 0 ? DF_COSTS.papAmmo : base
}

/** The weapon in hand; one sitting in the Pack-a-Punch (`away`) isn't. */
function heldWeapon(me: DfPlayerSnap): DfHeldWeapon | null {
    const w = me.weapons[me.slot]
    if (w) return w.away ? null : w
    return me.weapons.find(x => !x.away) ?? null
}

function weaponName(id: DfHeldWeapon['id'], pap = 0): string {
    return pap > 0 ? DF_WEAPONS[id].papNames[Math.min(3, pap) - 1] ?? DF_WEAPONS[id].name : DF_WEAPONS[id].name
}

function buyPrompt(id: string, kind: DfPrompt['kind'], text: string, cost: number, points: number, sub?: string): DfPrompt {
    const ok = points >= cost
    // short of points: say how many more (after the label, if there is one)
    const need = ok ? '' : `Need ${(cost - points).toLocaleString('en-US')} more points`
    return { id, kind, text, sub: ok ? sub : sub ? `${sub} · ${need}` : need, cost, ok, action: 'use', repeat: false }
}

function info(id: string, kind: DfPrompt['kind'], text: string, sub?: string): DfPrompt {
    return { id, kind, text, sub, cost: null, ok: false, action: 'none', repeat: false }
}

/** The prompt for one interactable, or null when there's nothing to do with it right now. */
export function dfPromptFor(it: DfInteractable, c: DfPromptCtx): DfPrompt | null {
    const { world, me, map } = c
    const pts = me.points
    if (me.life !== 'alive') return null
    switch (it.kind) {
        case 'door': {
            if (world.doors.includes(it.ref ?? it.id)) return null
            const door = map.doors.find(d => d.id === (it.ref ?? it.id))
            if (!door) return null
            return buyPrompt(it.id, 'door', 'Hold F to clear the debris', door.cost, pts, door.label)
        }
        case 'wallbuy': {
            const wid = it.ref as DfHeldWeapon['id'] | undefined
            if (!wid || !DF_WEAPONS[wid]) return null
            const def = DF_WEAPONS[wid]
            // the weapon a lent launcher stands in for is still yours (its ammo, not a second copy)
            const stash = world.arsenal?.players.find(x => x.pid === me.pid)?.stash
            const owned = me.weapons.find(w => w.id === wid) ?? (stash?.id === wid ? stash : undefined)
            if (owned?.away) return info(it.id, 'wallbuy', 'In the Pack-a-Punch', weaponName(wid, owned.pap))
            if (owned) {
                const stats = dfWeaponStats(wid, owned.pap, owned.attachments)
                // the server's cap includes reserve perks (Bandolier, Deep Crates)
                const max = owned.maxReserve ?? Math.round(stats.reserve)
                const full = owned.reserve >= max && owned.mag >= stats.magSize
                if (full) return info(it.id, 'wallbuy', 'Ammo full', weaponName(wid, owned.pap))
                return buyPrompt(it.id, 'wallbuy', 'Hold F for ammo', dfWallAmmoCost(wid, owned.pap), pts, weaponName(wid, owned.pap))
            }
            return buyPrompt(it.id, 'wallbuy', `Hold F to buy ${def.name}`, def.wallCost ?? 1000, pts)
        }
        case 'perk': {
            const perk = it.ref as keyof typeof DF_PERKS | undefined
            if (!perk || !DF_PERKS[perk]) return null
            const def = DF_PERKS[perk]
            if (me.perks.includes(perk)) return info(it.id, 'perk', def.name, 'Already owned')
            const soloRevive = c.solo && perk === 'secondwind'
            if (soloRevive && (me.windBuys ?? 0) >= DF_SOLO_SECONDWIND_MAX) return info(it.id, 'perk', 'Sold out', def.name)
            if (!world.power && !soloRevive) return info(it.id, 'perk', 'Requires power', def.name)
            if (me.perks.length >= DF_MAX_PERKS) return info(it.id, 'perk', 'Perk limit reached', def.name)
            const cost = soloRevive ? DF_COSTS.secondwindSolo : def.cost
            return buyPrompt(it.id, 'perk', `Hold F for ${def.name}`, cost, pts)
        }
        case 'box': {
            const spot = map.boxSpots[world.box.spot]
            if (!spot || spot.id !== it.id) return null
            const b = world.box
            if (b.state === 'idle') return buyPrompt(it.id, 'box', 'Hold F for a random weapon', DF_COSTS.box, pts)
            if (b.state === 'ready' && b.owner === me.pid && b.kit) {
                return { id: it.id, kind: 'box', text: `Hold F to take the ${dfKitName(b.kit)}`, sub: 'Raises the weapon in hand to its tier', cost: null, ok: true, action: 'use', repeat: false, tint: dfRarity(b.kit).color }
            }
            if (b.state === 'ready' && b.owner === me.pid && b.weapon) {
                const rar = dfRarity(b.rarity)
                return { id: it.id, kind: 'box', text: `Hold F to take ${DF_WEAPONS[b.weapon].name}`, sub: (b.rarity ?? 0) > 0 ? rar.name : undefined, cost: null, ok: true, action: 'use', repeat: false, tint: (b.rarity ?? 0) > 0 ? rar.color : undefined }
            }
            if (b.state === 'moving') return info(it.id, 'box', 'The box is moving')
            // someone else's roll or offer: say so instead of going quiet
            if (b.owner !== undefined && b.owner !== me.pid) return info(it.id, 'box', 'In use')
            return null
        }
        case 'pap': {
            const p = world.pap
            if (p.state !== 'idle' && p.owner !== undefined && p.owner !== me.pid) return info(it.id, 'pap', 'In use')
            if (p.state === 'ready') {
                if (p.owner !== me.pid || !p.weapon) return null
                return { id: it.id, kind: 'pap', text: `Hold F to take ${weaponName(p.weapon, p.tier ?? 1)}`, cost: null, ok: true, action: 'use', repeat: false }
            }
            if (p.state === 'working') return null
            if (!world.power) return info(it.id, 'pap', 'Requires power')
            const held = heldWeapon(me)
            if (!held) return null
            if (DF_WEAPONS[held.id]?.temporary) return info(it.id, 'pap', 'It won\'t take a borrowed launcher', 'Switch to your own weapon')
            const cost = dfPapCost(held.pap)
            if (cost === null) return info(it.id, 'pap', 'Maximum upgrade', weaponName(held.id, held.pap))
            return buyPrompt(it.id, 'pap', 'Hold F to Pack-a-Punch', cost, pts, weaponName(held.id, held.pap))
        }
        case 'power': {
            if (world.power) return null
            return { id: it.id, kind: 'power', text: 'Hold F to throw the power lever', cost: null, ok: true, action: 'use', repeat: false }
        }
        case 'fuse': {
            if (world.egg.fusesFound.includes(it.ref ?? it.id)) return null
            if (world.egg.step === 'power') return info(it.id, 'fuse', 'A dead Tesla fuse', 'Restore the power first')
            if (world.egg.step !== 'fuses') return null
            return { id: it.id, kind: 'fuse', text: 'Hold F to pick up the Tesla fuse', cost: null, ok: true, action: 'use', repeat: false }
        }
        case 'generator': {
            const egg = world.egg
            if (egg.step === 'install') {
                return { id: it.id, kind: 'generator', text: 'Hold F to install the Tesla fuses', cost: null, ok: true, action: 'use', repeat: false }
            }
            if (egg.step === 'fuses') return info(it.id, 'generator', `Tesla fuses ${egg.fusesFound.length}/${map.egg.fuses.length || 3}`, 'The Arc Generator needs its fuses')
            if (egg.step === 'power') return info(it.id, 'generator', 'The Arc Generator lies dead', 'Restore the power')
            if (egg.step === 'charge') return info(it.id, 'generator', `Charge ${egg.charge}/${egg.chargeNeeded}`, 'Kill zombies near the generator')
            if (egg.step === 'rods') return info(it.id, 'generator', 'The Arc Generator is charged', 'Throw the three lightning-rod switches')
            return null
        }
        case 'pedestal': {
            const step = world.egg.step
            if (step === 'power' || step === 'fuses' || step === 'install' || step === 'charge') return info(it.id, 'pedestal', 'An empty pedestal', 'Charge the Arc Generator')
            if (step === 'rods') return info(it.id, 'pedestal', 'An empty pedestal', 'Ground the Arc: throw the lightning rods')
            if (step !== 'claim') return null
            return { id: it.id, kind: 'pedestal', text: 'Hold F to claim the wonder weapon', cost: null, ok: true, action: 'use', repeat: false }
        }
        case 'rod':
            return rodPrompt(it, world, dfEggRodSpots(map).length || 3)
        case 'barricade': {
            const boards = world.planks[it.ref ?? it.id] ?? DF_BARRICADE_PLANKS
            if (boards >= DF_BARRICADE_PLANKS) return null
            return { id: it.id, kind: 'barricade', text: 'Hold F to rebuild the barrier', cost: null, ok: true, action: 'use', repeat: true }
        }
        case 'trap':
            return trapPrompt(it, c)
        case 'bench':
            return dfBenchPrompt(it, c, c.benchPick ?? 'sentry')
    }
    return null
}

/** An electric trap's lever: needs the power, runs a while, then cools down. */
function trapPrompt(it: DfInteractable, c: DfPromptCtx): DfPrompt | null {
    const id = it.ref ?? it.id
    const trap = c.map.traps?.find(t => t.id === id)
    if (!trap) return null
    const run = c.world.traps?.find(t => t.id === id)
    if (run?.state === 'active') return info(it.id, 'trap', 'Electric trap running', `${trap.label} · ${Math.ceil(run.timer)} s`)
    if (run?.state === 'cooldown') return info(it.id, 'trap', 'Electric trap cooling down', `${trap.label} · ${Math.ceil(run.timer)} s`)
    if (!c.world.power) return info(it.id, 'trap', 'Requires power', trap.label)
    return buyPrompt(it.id, 'trap', 'Hold F to activate the electric trap', DF_TRAP.cost, c.me.points, trap.label)
}

/** A lightning-rod switch: thrown during the `rods` step, otherwise it explains itself or stays quiet. */
function rodPrompt(it: DfInteractable, world: DfWorldSnap, total: number): DfPrompt | null {
    const egg = world.egg
    const id = it.ref ?? it.id
    const on = (egg.rodsOn ?? []).includes(id)
    if (egg.step === 'rods') {
        if (on) return info(it.id, it.kind, 'Already thrown', rodsLine(egg, total))
        return { id: it.id, kind: it.kind, text: 'Hold F to throw the lightning-rod switch', sub: rodsLine(egg, total), cost: null, ok: true, action: 'use', repeat: false }
    }
    if (egg.step === 'claim' || egg.step === 'done') return on ? info(it.id, it.kind, 'Already thrown') : null
    return info(it.id, it.kind, 'A dead lightning rod', 'Charge the Arc Generator first')
}

function rodsLine(egg: DfWorldSnap['egg'], total: number): string {
    const n = (egg.rodsOn ?? []).length
    return egg.rodTimer > 0 ? `Rods ${n}/${total} · ${Math.ceil(egg.rodTimer)} s` : `Rods ${n}/${total}`
}

/** Revive prompt for a downed teammate. */
export function dfRevivePrompt(target: DfPlayerSnap, me: DfPlayerSnap): DfPrompt | null {
    if (me.life !== 'alive' || target.life !== 'down' || target.pid === me.pid) return null
    return { id: `revive:${target.pid}`, kind: 'revive', text: `Hold F to revive ${target.name}`, cost: null, ok: true, action: 'revive', repeat: false, pid: target.pid }
}

/**
 * Picks the best interactable: within `range` of the eye (horizontally, with
 * a vertical allowance) and roughly in front of the camera. Score favours
 * close and centred targets. Returns the index into `list` or -1.
 */
export function dfPickInteractable(list: readonly { pos: Vec3 }[], eye: Vec3, fx: number, fz: number, range: number, skip?: (i: number) => boolean): number {
    let best = -1
    let bestScore = Infinity
    const fl = Math.sqrt(fx * fx + fz * fz) || 1
    const ux = fx / fl
    const uz = fz / fl
    for (let i = 0; i < list.length; i++) {
        const p = list[i]!.pos
        const dx = p.x - eye.x
        const dz = p.z - eye.z
        const feet = eye.y - 1.6
        const dy = p.y - feet
        if (dy < -1.4 || dy > 2.4) continue
        const d = Math.sqrt(dx * dx + dz * dz)
        if (d > range) continue
        const facing = d < 0.6 ? 1 : (dx * ux + dz * uz) / d
        if (facing < 0.25) continue
        if (skip?.(i)) continue
        const score = d * (1.6 - facing)
        if (score < bestScore) {
            bestScore = score
            best = i
        }
    }
    return best
}
