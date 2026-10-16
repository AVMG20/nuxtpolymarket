import type {
    HackerzDeployableId, HackerzEnemyId, HackerzTurretId, HackerzUpgradeLevels, HackerzWeaponId
} from '#shared/utils/gamelogic/hackerz'
import type { HackerzGame } from './hackerz-engine/hackerz-game'

/**
 * The Database's demos: a fixed script per entry (a deployable, a gun, a
 * turret, an ability, a piece of the firewall) that plays out on a real,
 * quiet game board (see `HackerzGame.mountDemo`) and loops. Everything is
 * authored — where each hostile appears and the path it walks, what the
 * player does and when, where the camera looks — and the board runs on a
 * fixed clock and a seeded roll, so every loop is identical.
 *
 * Field units: `u` across the lane (±400), `d` out from the fence (0 at the fence).
 */

export interface DemoStep {
    /** Ms from the start of the script, on the board's own fixed clock. */
    at: number
    /** The terminal line shown under the board from this step on. */
    say?: string
    run?: (game: HackerzGame) => void
}

/** What the board is fitted with for a scene: the gun on the rail, the turrets on the mounts, the upgrades bought. */
export interface DemoGear {
    weapon?: HackerzWeaponId
    turrets?: HackerzTurretId[]
    levels?: Partial<HackerzUpgradeLevels>
}

export interface DemoScript {
    /** Ms before the board is cleared and the script starts over. */
    length: number
    steps: DemoStep[]
    gear?: DemoGear
    /** The scene is about held ground: its hostiles feel the blue bite, as in play. */
    ground?: boolean
}

interface Point {
    u: number
    d: number
}

/** Hostiles that appear at their start point and walk straight for the fence. */
function march(id: HackerzEnemyId, starts: Point[]) {
    return (game: HackerzGame) => {
        for (const start of starts) game.demoSpawn(id, [start, { u: start.u, d: 0 }])
    }
}

/** Holds the camera on one spot for the scene, pulled back by `zoom`. */
function look(at: Point, zoom = 1) {
    return (game: HackerzGame) => game.demoLook(at, zoom)
}

/** The rail opens fire: on the hostile nearest the fence, or on the outermost hacked node. */
function fire(at: 'lead' | 'node' | null = 'lead') {
    return (game: HackerzGame) => game.demoFire(at)
}

/** The view for a scene about the guns: the fence and its mounts in the foreground, the lane beyond. */
const GUNS_VIEW = look({ u: 0, d: 330 }, 1.9)

/** A pack of daemons spread across the lane, for the guns to work on. */
const PACK: Point[] = [
    { u: -120, d: 760 }, { u: -40, d: 720 }, { u: 40, d: 740 }, { u: 120, d: 780 },
    { u: -80, d: 860 }, { u: 0, d: 840 }, { u: 80, d: 880 }
]

/**
 * Daemons leading Siege Tanks single file down one line, for the piercing
 * guns. Bodies are solid, so the spacing follows their length: a Daemon is
 * about 20 long, a tank about 210.
 */
const COLUMN: [HackerzEnemyId, Point[]][] = [
    ['grunt', [560, 600, 640].map(d => ({ u: 0, d }))],
    ['tank', [765, 985].map(d => ({ u: 0, d }))]
]

/** A gun's scene: it is put on the rail, a pack walks in, and it opens up on them. */
function gunScene(weapon: HackerzWeaponId, intro: string, hostiles: [HackerzEnemyId, Point[]][], note: string, length = 12_000, view = GUNS_VIEW): DemoScript {
    return {
        length,
        gear: { weapon },
        steps: [
            { at: 0, say: intro, run: all(view, ...hostiles.map(([id, at]) => march(id, at))) },
            { at: 1200, say: '> rail opens fire', run: fire() },
            { at: 4000, say: note }
        ]
    }
}

/** A turret's scene: two of them on the wall, a pack walking into their reach. */
function turretScene(turret: HackerzTurretId, intro: string, hostiles: [HackerzEnemyId, Point[]][], note: string, length = 13_000): DemoScript {
    return {
        length,
        gear: { turrets: [turret, turret] },
        steps: [
            // The camera rides with the pack: the turrets' rounds come in over it and land in view.
            { at: 0, say: intro, run: all(game => game.demoLook(null, 1.5), ...hostiles.map(([id, at]) => march(id, at))) },
            { at: 3000, say: note }
        ]
    }
}

/** Puts a deployable down at an exact spot (for a White Hat: on the hostile nearest it). */
function deploy(id: HackerzDeployableId, at: Point = { u: 0, d: 0 }) {
    return (game: HackerzGame) => game.demoDeploy(id, at.u, at.d)
}

function all(...runs: ((game: HackerzGame) => void)[]) {
    return (game: HackerzGame) => runs.forEach(run => run(game))
}

/** Keyed by the Database entry each one illustrates. */
export const HACKERZ_DEMO_SCRIPTS: Record<string, DemoScript> = {
    // ─── The firewall ───────────────────────────────────────────────────────
    fence: {
        length: 11_000,
        steps: [
            { at: 0, say: '> 4 daemons inbound for the fence', run: all(
                look({ u: 0, d: 200 }, 1.5),
                march('grunt', [{ u: -150, d: 520 }, { u: -50, d: 560 }, { u: 50, d: 540 }, { u: 150, d: 580 }])
            ) },
            { at: 5200, say: '> every blow that lands chips its integrity' },
            { at: 8200, say: '> at zero the run is over: keep them off it' }
        ]
    },
    barrier: {
        length: 11_000,
        gear: { levels: { shield: 4 } },
        steps: [
            { at: 0, say: '> 4 daemons inbound for the fence', run: all(
                look({ u: 0, d: 200 }, 1.5),
                march('grunt', [{ u: -150, d: 520 }, { u: -50, d: 560 }, { u: 50, d: 540 }, { u: 150, d: 580 }])
            ) },
            { at: 5200, say: '> the barrier soaks their blows before the wall feels them' },
            { at: 8200, say: '> a few quiet seconds and it builds back up' }
        ]
    },
    grid: {
        length: 15_000,
        gear: { levels: { spikes: 5 } },
        steps: [
            { at: 0, say: '> daemons inbound, a bulwark among them', run: all(
                look({ u: 0, d: 220 }, 1.5),
                march('grunt', [{ u: -150, d: 520 }, { u: -50, d: 560 }, { u: 50, d: 540 }, { u: 150, d: 580 }]),
                march('brute', [{ u: 0, d: 600 }])
            ) },
            { at: 4600, say: '> the band in front of the wall is live: every tick bites' },
            { at: 7000, say: '> the bulwark is plated: it takes longer, but the grid grinds it too' },
            { at: 11_000, say: '> flyers pass over it; walkers have to cross it' }
        ]
    },
    blue: {
        length: 11_000,
        ground: true,
        steps: [
            { at: 0, say: '> every node is still ours: the whole lane is blue', run: all(
                look({ u: 0, d: 520 }, 1.3),
                march('grunt', [{ u: -150, d: 820 }, { u: -50, d: 860 }, { u: 50, d: 840 }, { u: 150, d: 880 }])
            ) },
            { at: 2400, say: '> hostiles on held ground take a bite every tick' },
            { at: 6000, say: '> take nodes back to keep the lane blue' }
        ]
    },

    // ─── Weapons ────────────────────────────────────────────────────────────
    rail: gunScene('rail', '> a pack inbound: the packet rail meets them', [['grunt', PACK]], '> steady energy rounds, one target at a time'),
    flak: gunScene('flak', '> a crowd inbound: the fragmenter meets them',
        [['crawler', PACK.map(p => ({ u: p.u * 0.6, d: p.d - 120 }))]], '> each blast sprays a fan of pellets into the crowd'),
    // In close on the pack: the arcs jumping between bodies are the point.
    arc: gunScene('arc', '> a pack inbound: the tesla coil meets them', [['grunt', PACK]],
        '> each hit jumps on to the next hostile, losing a tenth of its power each jump', 12_000, game => game.demoLook(null, 1.1)),
    missile: gunScene('missile', '> bulwarks inbound: the seeker pod meets them',
        [
            // A bulwark leading, daemons packed in behind it and a bulwark at
            // each shoulder: every warhead on the leader catches the lot.
            ['brute', [{ u: 0, d: 700 }, { u: -130, d: 740 }, { u: 130, d: 740 }]],
            ['grunt', [{ u: -35, d: 775 }, { u: 35, d: 775 }, { u: 0, d: 800 }]]
        ],
        '> homing warheads, and the blast catches the ones beside'),
    sniper: gunScene('sniper', '> daemons leading siege tanks down one line: the longbore meets them',
        COLUMN,
        '> each round punches through the daemons and on into the tanks', 7000),

    // ─── Turrets ────────────────────────────────────────────────────────────
    gun: turretScene('gun', '> a pack inbound: two sentries on the wall', [['grunt', PACK]], '> steady fire at the toughest in their lane'),
    needler: turretScene('needler', '> a swarm inbound: two needlers on the wall',
        [['crawler', PACK]], '> a constant stream of light rounds shreds the swarm'),
    warhead: turretScene('warhead', '> a crowd inbound: two warhead racks on the wall',
        [['grunt', PACK.map(p => ({ u: p.u * 0.5, d: p.d }))]], '> warheads lobbed into the crowd, splash and all'),
    lance: turretScene('lance', '> daemons leading siege tanks down one line: two rail lances on the wall',
        COLUMN,
        '> long reach, and every round punches through the daemons and on into the tanks', 9000),

    // ─── Abilities ──────────────────────────────────────────────────────────
    ping: {
        length: 11_000,
        steps: [
            { at: 0, say: '> 3 phantoms inbound, cloaked: nothing to shoot at', run: all(
                look({ u: 0, d: 560 }),
                march('phantom', [{ u: -180, d: 820 }, { u: 0, d: 860 }, { u: 180, d: 820 }])
            ) },
            { at: 2600, say: '> ping: the sweep lights them up for a few seconds', run: game => game.demoAbility('ping') },
            { at: 3000, say: '> lit, they can be shot', run: fire() }
        ]
    },
    pulse: {
        length: 16_000,
        gear: { levels: { pulse: 1 } },
        steps: [
            { at: 0, say: '> the intrusion holds six nodes; bulwarks at the fence', run: all(
                // After the hack, which would otherwise point the camera at the hacked nodes alone.
                game => game.demoHack(6),
                look({ u: 0, d: 330 }, 2.4),
                march('brute', [{ u: -110, d: 200 }, { u: 0, d: 180 }, { u: 110, d: 200 }])
            ) },
            { at: 3000, say: '> ICE pulse: hostiles hurled back, the nearest hacked node turns blue', run: game => game.demoAbility('pulse') },
            { at: 5600, say: '> the next node is two thirds back, the one after a third' },
            { at: 8000, say: '> a daemon takes up guard on the next hacked node', run: game => game.demoSpawnFree('grunt', 0, 820) },
            { at: 12_000, say: '> pulse again: the wash runs on to the guarded node, breaks there, and its defender dies', run: game => game.demoAbility('pulse') }
        ]
    },
    overclock: {
        length: 13_000,
        gear: { turrets: ['gun', 'gun'], levels: { overclock: 3 } },
        steps: [
            { at: 0, say: '> a pack inbound; the rail and two sentries open up', run: all(
                GUNS_VIEW,
                march('grunt', PACK),
                march('brute', [{ u: -60, d: 900 }, { u: 60, d: 920 }]),
                fire()
            ) },
            { at: 3600, say: '> overclock: the rail and every turret run hot', run: game => game.demoAbility('overclock') },
            { at: 6000, say: '> faster fire, harder rounds, for a few seconds' }
        ]
    },

    // ─── The board ──────────────────────────────────────────────────────────
    nodes: {
        length: 16_000,
        steps: [
            { at: 0, say: '> two hackers inbound for the outermost node', run: all(
                look({ u: 0, d: 700 }, 1.8),
                game => game.demoSpawnFree('crawler', -60, 1000),
                game => game.demoSpawnFree('crawler', 60, 1010)
            ) },
            { at: 2500, say: '> they ring the node and hack it from their terminals' },
            { at: 9000, say: '> taken: three hits on a hacked node take it back', run: fire('node') },
            { at: 12_500, say: '> reclaimed: the ground around it turns blue again' }
        ]
    },

    // ─── Deployables ────────────────────────────────────────────────────────
    honeypot: {
        length: 14_000,
        steps: [
            { at: 0, say: '> 4 daemons inbound for the fence', run: all(
                look({ u: 0, d: 500 }),
                march('grunt', [{ u: -150, d: 760 }, { u: -50, d: 800 }, { u: 50, d: 780 }, { u: 150, d: 820 }])
            ) },
            { at: 1200, say: '> honeypot dropped in their path', run: deploy('honeypot', { u: 0, d: 420 }) },
            { at: 3200, say: '> in its lure radius they turn on the fake core' },
            { at: 10_200, say: '> out of time, it blows up in their faces' }
        ]
    },
    bomb: {
        length: 9000,
        steps: [
            { at: 0, say: '> 4 daemons inbound for the fence', run: all(
                look({ u: 0, d: 480 }),
                march('grunt', [{ u: -25, d: 700 }, { u: 25, d: 700 }, { u: -25, d: 760 }, { u: 25, d: 760 }])
            ) },
            { at: 800, say: '> logic bomb armed on the grid', run: deploy('bomb', { u: 0, d: 400 }) },
            { at: 3000, say: '> the first one to step on it sets it off' }
        ]
    },
    proxy: {
        length: 23_000,
        steps: [
            { at: 0, say: '> daemons and a bulwark inbound', run: all(
                look({ u: 0, d: 440 }),
                march('grunt', [{ u: -90, d: 700 }, { u: 0, d: 720 }, { u: 90, d: 700 }]),
                march('brute', [{ u: 0, d: 640 }])
            ) },
            { at: 500, say: '> proxy wall thrown across the lane', run: deploy('proxy', { u: 0, d: 380 }) },
            { at: 4000, say: '> walkers stop at it and have to break it down' },
            { at: 12_000, say: '> every second it holds is a second of free shots' },
            { at: 19_000, say: '> broken down at last, they walk on' }
        ]
    },
    portscan: {
        length: 14_000,
        steps: [
            { at: 0, say: '> 3 phantoms inbound, cloaked: nothing to shoot at', run: all(
                look({ u: 0, d: 560 }),
                march('phantom', [{ u: -180, d: 820 }, { u: 0, d: 860 }, { u: 180, d: 820 }])
            ) },
            { at: 2600, say: '> portscan: a sweep lights them up', run: deploy('portscan') },
            { at: 5600, say: '> it pings again each time the contacts fade' }
        ]
    },
    blip: {
        length: 8000,
        steps: [
            { at: 0, say: '> the intrusion holds three nodes', run: game => game.demoHack(3) },
            { at: 2400, say: '> cosmic blip: one hacked node flips straight back', run: deploy('blip') },
            { at: 5200, say: '> one more blip, one more node', run: deploy('blip') }
        ]
    },
    whitehat: {
        length: 13_000,
        steps: [
            { at: 0, say: '> a bulwark leads 4 daemons in', run: all(
                look({ u: 0, d: 520 }),
                march('brute', [{ u: 0, d: 620 }]),
                march('grunt', [
                    { u: -40, d: 700 }, { u: 40, d: 700 },
                    { u: -25, d: 750 }, { u: 25, d: 750 }
                ])
            ) },
            { at: 1800, say: '> white hat on the bulwark: it switches sides', run: deploy('whitehat', { u: 0, d: 560 }) },
            { at: 3600, say: '> it turns on its own pack until it falls' }
        ]
    },
    surge: {
        length: 6500,
        steps: [
            { at: 0, say: '> 5 daemons inbound for the fence', run: all(
                look({ u: 0, d: 470 }),
                march('grunt', [
                    { u: -30, d: 680 }, { u: 30, d: 680 },
                    { u: -60, d: 760 }, { u: 0, d: 760 }, { u: 60, d: 760 }
                ])
            ) },
            { at: 600, say: '> power surge laid across their path', run: deploy('surge', { u: 0, d: 420 }) },
            { at: 1300, say: '> lightning arcs through everything that walks in' }
        ]
    }
}
