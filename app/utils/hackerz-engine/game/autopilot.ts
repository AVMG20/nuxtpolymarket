import type { HackerzAutopilotView } from '#shared/utils/gamelogic/hackerz-autopilot'
import {
    HACKERZ_HACKER_ID, hackerzDeployable, hackerzIsAirborne, type HackerzDeployableId
} from '#shared/utils/gamelogic/hackerz'
import type { EnemyEntity } from '../types'
import { PING_COOLDOWN_MS } from './tuning'
import { enemyCentreY } from './bodies'
import type { HackerzGame } from '../hackerz-game'
import { centroid } from '../math'

/** Auto-play offers Laya this many hostiles to choose between, and counts this close to the wall as near. */
const AUTOPILOT_CONTACTS = 5
const AUTOPILOT_NEAR = 250

/** How far ahead of a pack (toward the wall) auto-play puts each deployable that waits for it. */
const AUTOPILOT_DEPLOY_AHEAD: Partial<Record<HackerzDeployableId, number>> = { honeypot: 120, proxy: 90, bomb: 60, surge: 0 }

/**
 * The units within `AUTOPILOT_PACK_RADIUS` of whichever of them has the most
 * neighbours: the densest pack. Empty when there are none.
 */
function densestGroup(units: EnemyEntity[]) {
    let centre: EnemyEntity | null = null
    let most = 0
    for (const unit of units) {
        let count = 0
        for (const other of units) {
            if (Math.hypot(other.u - unit.u, other.d - unit.d) <= AUTOPILOT_PACK_RADIUS) count++
        }
        if (count > most) {
            most = count
            centre = unit
        }
    }
    if (!centre) return []
    const at = centre
    return units.filter(o => Math.hypot(o.u - at.u, o.d - at.d) <= AUTOPILOT_PACK_RADIUS)
}

/** Hostiles this close together count as one pack, for where auto-play puts a deployable. */
const AUTOPILOT_PACK_RADIUS = 140

/**
 * What auto-play (Laya) sees of the board, and how its calls are carried
 * out on it.
 */
export class AutopilotBridge {
    constructor(private readonly game: HackerzGame) {}

    /**
     * The board as auto-play tells it to Laya (see `hackerz-autopilot`), with
     * the hostiles it may pick keyed `e0`, `e1`… in `contacts`: hackers at
     * work first, then whatever is closest to the wall. Nothing that cannot be
     * locked on is offered.
     */
    view(): { view: HackerzAutopilotView, contacts: Map<string, EnemyEntity> } {
        const loadout = this.game.loadout
        const chips = this.game.pathChips?.chips ?? []
        const live = this.game.enemies.filter(e => e.hp > 0 && !e.turned && !e.decoy && !this.game.combat.untargetable(e))
        live.sort((a, b) => Number(b.hacking) - Number(a.hacking) || Number(!!b.def.boss) - Number(!!a.def.boss) || a.d - b.d)
        const picked = live.slice(0, AUTOPILOT_CONTACTS)
        const contacts = new Map(picked.map((enemy, i) => [`e${i}`, enemy]))
        const hostile = this.game.enemies.filter(e => e.hp > 0 && !e.turned)
        return {
            contacts,
            view: {
                wave: this.game.wave,
                wall: this.game.bastion.wallMaxHp > 0 ? this.game.bastion.wallHp / this.game.bastion.wallMaxHp : 0,
                held: chips.filter(chip => chip.state === 'hacked').length,
                nodes: chips.length,
                contacts: picked.map((enemy, i) => ({
                    key: `e${i}`,
                    name: enemy.def.name,
                    boss: !!enemy.def.boss,
                    hacking: enemy.hacking,
                    hacker: enemy.def.id === HACKERZ_HACKER_ID,
                    d: enemy.d,
                    health: enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 0,
                    plated: !!enemy.def.armored
                })),
                near: hostile.filter(e => e.d < AUTOPILOT_NEAR).length,
                hidden: hostile.filter(e => this.game.combat.inTheDark(e) || (!!e.def.cloaked && !e.decloaked && e.revealMs <= 0)).length,
                total: hostile.length,
                pulseReady: !!loadout?.pulseUnlocked && this.game.abilities.pulseCharge >= loadout.pulseCooldownMs,
                pingReady: this.game.abilities.pingCharge >= PING_COOLDOWN_MS,
                overclockReady: !!loadout?.overclockUnlocked && this.game.abilities.overclockLeft <= 0 && this.game.abilities.overclockCharge >= loadout.overclockCooldownMs
            }
        }
    }

    /** Auto-play locks the rail on `target` and holds the trigger, or lets go with none. */
    aim(target: EnemyEntity | null) {
        const live = !!target && target.hp > 0 && this.game.enemies.includes(target)
        this.game.rail.hold(live ? target : null)
    }

    /**
     * The densest pack of ground hostiles: its centre, its size, the one in it
     * closest to the wall, and the one a White Hat would best turn. Null with
     * nothing on the ground.
     */
    private pack() {
        const best = densestGroup(this.game.enemies.filter(e => e.hp > 0 && !e.turned && !hackerzIsAirborne(e.def) && !this.game.combat.untouchable(e)))
        if (!best.length) return null
        const { u, d } = centroid(best)
        const lead = best.reduce((top, e) => e.d < top.d ? e : top)
        const convert = best.filter(e => this.game.whiteHats.turnable(e)).sort((a, b) => b.maxHp - a.maxHp)[0] ?? null
        return { u, d, size: best.length, lead, convert }
    }

    /** Auto-play's deployable stock and the pack it would be used on. */
    stock() {
        const pack = this.pack()
        return {
            stock: { ...this.game.deployer.stock },
            pack: pack ? { size: pack.size, d: pack.d } : null,
            held: (this.game.pathChips?.chips ?? []).filter(chip => chip.state === 'hacked').length
        }
    }

    /**
     * Auto-play uses a deployable where it does the most: a Power Surge on the
     * densest pack, a Honeypot, Proxy Wall or Logic Bomb just ahead of it on
     * its way to the wall, a White Hat on the toughest hostile in it that can
     * be turned; Portscan and Cosmic Blip simply go off. True when one was spent.
     */
    deploy(id: HackerzDeployableId) {
        if (!this.game.running || this.game.purging || this.game.paused || this.game.deployer.stock[id] <= 0) return false
        const before = this.game.deployer.stock[id]
        if (hackerzDeployable(id).instant) {
            this.game.deployer.useInstant(id)
            return this.game.deployer.stock[id] < before
        }
        const pack = this.pack()
        if (!pack) return false
        if (id === 'whitehat') {
            if (pack.convert) this.game.deployer.useWhiteHat(pack.convert)
            return this.game.deployer.stock[id] < before
        }
        this.game.rail.aimAt(pack.u, pack.d - (AUTOPILOT_DEPLOY_AHEAD[id] ?? 0))
        const spot = this.game.deployer.deploySpot(id)
        this.game.deployer.drop(id, spot.u, spot.d, spot.chip)
        return true
    }

    /**
     * Auto-play fires blind: with nothing to lock on but hostiles hidden in
     * the dark, the rail holds its trigger on the middle of the densest of
     * them — where a player would spray. A cloaked unit is not aimed at: a
     * round passes through it. True when it is firing.
     */
    blindFire() {
        const pack = densestGroup(this.game.enemies.filter(e => e.hp > 0 && !e.turned && !this.game.combat.untouchable(e) && this.game.combat.inTheDark(e)))
        if (!pack.length) return false
        this.game.rail.holdOn({
            ...centroid(pack),
            y: pack.reduce((sum, e) => sum + enemyCentreY(e), 0) / pack.length
        })
        return true
    }

    /** Auto-play fires an ability; each does nothing when it is not ready. */
    ability(id: 'pulse' | 'ping' | 'overclock') {
        if (id === 'pulse') this.game.abilities.firePulse()
        else if (id === 'ping') this.game.abilities.firePing()
        else this.game.abilities.fireOverclock()
    }
}
