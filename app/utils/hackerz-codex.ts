import {
    HACKERZ_DEPLOYABLE_MAX, HACKERZ_DEPLOYABLES, HACKERZ_ENEMIES, HACKERZ_EVENTS, HACKERZ_TURRETS, HACKERZ_UPGRADES, HACKERZ_WEAPONS,
    hackerzDeployableStats, hackerzEmptyMainframe, hackerzMainframe, hackerzMainframeEffects,
    type HackerzDeployableId, type HackerzEnemyId, type HackerzMainframeId, type HackerzProjectile
} from '#shared/utils/gamelogic/hackerz'
import type { ModelId } from './hackerz-engine/models'
import { turretProjectile } from './hackerz-engine/fx'
import { HACKERZ_DEMO_SCRIPTS } from './hackerz-demo-scripts'

/**
 * The Hackerz database: what every hostile is and how it gets in (the threat
 * database), and what every piece of the defence does (hardening tools). The
 * numbers come straight from the game's own definitions; this file only adds
 * the words around them.
 */

export interface CodexStat {
    label: string
    value: string
}

export interface CodexEntry {
    id: string
    name: string
    icon: string
    /** CSS colour for the entry's accent. */
    color: string
    /** Short classification line, e.g. the attack vector. */
    kicker: string
    summary: string
    /** How it behaves on the board. */
    notes: string[]
    /** How to deal with it, or how to get the most out of it. */
    tip?: string
    stats: CodexStat[]
    /** The 3D model shown on the turntable beside the entry, if it has one. */
    model?: CodexModel
    /** The script (see `HACKERZ_DEMO_SCRIPTS`) a demo board plays to show this entry at work. */
    demo?: string
}

/**
 * What the turntable needs to animate an entry exactly as the game does: the
 * hostile it is (its speed, height and attack timing), or a gun's fire rate.
 */
export interface CodexModel {
    id: ModelId
    hex: number
    kind: 'walker' | 'flyer' | 'turret'
    /** A hostile: animated from its own definition. */
    enemy?: HackerzEnemyId
    /** A gun: ms between shots. */
    fireMs?: number
    /** The rail itself (a weapon entry): it recoils by the round it fires. */
    railProjectile?: HackerzProjectile
    /** The round a gun fires, drawn flying out of it when it shoots. */
    projectile?: HackerzProjectile
}

export interface CodexSection {
    id: string
    title: string
    entries: CodexEntry[]
}

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`

interface ThreatLore {
    vector: string
    icon: string
    summary: string
    notes: string[]
    tip: string
}

const THREATS: Record<HackerzEnemyId, ThreatLore> = {
    crawler: {
        vector: 'Credential stuffing · lateral movement',
        icon: 'i-lucide-bug',
        summary: 'The hackers. Fragile, fast and relentless: the only hostiles that go for your path nodes, and the portal keeps a pack of them on the board at all times.',
        notes: [
            'Hacks path nodes from a floating terminal; more hackers on one node take it faster, up to four at a time.',
            'Zaps sideways onto another data line to dodge incoming rounds.',
            'Immune to Tesla arcs, and to splash on its own: only a direct hit lands. But a crew hacking one node together takes splash as one: catch any of them and the whole crew is hit.',
            'From wave 10 a bodyguard marches in front of each one; when the first node is full, the rest push ahead with a hostage as a shield.'
        ],
        tip: 'Rail them yourself — your turrets leave hackers for last. Shoot hacked nodes to take them back.'
    },
    grunt: {
        vector: 'Brute-force daemon · memory leak',
        icon: 'i-lucide-cpu',
        summary: 'Rank-and-file background processes. Slow and soft, but they come in numbers, soak rounds meant for something worse, and leak memory all over your fence.',
        notes: [
            'Every hit on the fence, it pulls a leaked block out of the disc on its back and heaves it onto a pile at the fence\'s foot. Each block keeps draining the fence a little every second, quietly: no alarm and no broken chain.',
            'Piles cap out at twelve blocks. The purge collects every one of them.',
            'Falls back to red ground to heal below half health; healthier units hold the line to cover the retreat.',
            'Often drafted as a hacker\'s bodyguard or a node\'s defender.'
        ],
        tip: 'Aim the rail at a pile to shoot it clean, one block a round; turrets ignore them. Kill a Daemon mid-heave and the block goes down with it.'
    },
    sapper: {
        vector: 'Logic bomb · fork bomb',
        icon: 'i-lucide-bomb',
        summary: 'A payload in a spiked cage. Rolls at the fence and detonates on contact for heavy integrity damage, blowing its spikes in every direction.',
        notes: [
            'Moves faster than the rules say and only feels every second tick in your blue ground.',
            'Pours in by the dozen while the hackers fight for the first nodes — a distraction by design.'
        ],
        tip: 'Kill them before the fence. A Fragmenter or a Needler line cleans up a sapper rush.'
    },
    drone: {
        vector: 'Packet sniffer · session repair',
        icon: 'i-lucide-radio',
        summary: 'Small airborne sniffers that never touch the fence: they hunt down the most damaged hostile and beam it back to health, a tick at a time.',
        notes: [
            'Several Wisps converge on the same patient, and their heals stack: a pack of them can keep a tank standing.',
            'Once nothing but Wisps is left, they dive the fence and self-destruct like a weak Sapper.',
            'Flies over the Tarpit Grid and proxy walls.'
        ],
        tip: 'Kill the healers first, or your damage on the big ones goes nowhere. Energy weapons hit unarmoured fliers for +25%.'
    },
    brute: {
        vector: 'Hardened rootkit shell',
        icon: 'i-lucide-shield',
        summary: 'Bulwarks: armoured tanks that walk straight into your blue ground. When a dark zone opens they become shield bearers.',
        notes: [
            'As shield bearers they form a wall in front of the frontier nodes; the wounded heal behind them.',
            'A bearer whose node is taken back disintegrates on the spot.'
        ],
        tip: 'Kinetic rounds deal +25% to plating. Reclaim the node behind a shield wall and the wall dissolves.'
    },
    spitter: {
        vector: 'Cross-site scripting',
        icon: 'i-lucide-crosshair',
        summary: 'Lancers: ranged injectors that stop well short of the fence and lob payloads at it.',
        notes: ['Sets up out at its range and keeps firing; steps aside so it never parks on a node.'],
        tip: 'A Rail Lance or Longbore reaches them before they settle in.'
    },
    warden: {
        vector: 'Privilege escalation',
        icon: 'i-lucide-key-round',
        summary: 'An armoured sysadmin-turned-traitor. Tough, steady, and happy to walk through your blue ground to reach the wall.',
        notes: [
            'Its tower shield has half the Warden\'s own health and takes every hit first; a white hex field flashes round it each time.',
            'While it still carries the shield your blue ground does not bite it. Once the shield shatters, the Warden takes the damage, and the ground\'s ticks too.',
            'At the wall it jabs an electric cattle prod into the fence, discharging on every blow.'
        ],
        tip: 'Kinetic, and lots of it: break the shield first, then it is just armour.'
    },
    tank: {
        vector: 'Brute-force cracking rig',
        icon: 'i-lucide-truck',
        summary: 'The Siege Tank: a slow, enormously durable armoured car that drives up to the fence and hammers it with a hydraulic ramming plate.',
        notes: [
            'At the wall its pistons slam the plate into the fence, again and again.',
            'Your turrets focus the tankiest target in their lane — that is usually this.'
        ],
        tip: 'Stack kinetic turrets on its lane and let the rail handle the fast stuff.'
    },
    artillery: {
        vector: 'Amplification attack',
        icon: 'i-lucide-rocket',
        summary: 'Howitzers set up beyond every turret\'s reach but their own and shell the wall in volleys.',
        notes: ['Longest range of any hostile: it fires from where most of your battery cannot answer.'],
        tip: 'Drop everything to kill it. A Rail Lance or the Longbore is the answer.'
    },
    gunship: {
        vector: 'Botnet command & control',
        icon: 'i-lucide-plane',
        summary: 'Armoured airborne C2 nodes that strafe the wall in bursts.',
        notes: ['Airborne and armoured; fires three-round bursts from range.'],
        tip: 'Kinetic turrets with range. It ignores everything on the ground.'
    },
    phantom: {
        vector: 'Fileless malware',
        icon: 'i-lucide-ghost',
        summary: 'Cloaked. You cannot see or hit a phantom until a radar ping lights it up — or until it strikes the wall and decloaks for good.',
        notes: [
            'Leaves only a faint shimmer on the grid while cloaked.',
            'At the wall it draws crystals out of its chest, whirls them round itself on crossing orbits and fires them at the fence in an unbroken ribbon.',
            'Quarantined, not killed: the syslog says so.'
        ],
        tip: 'Ping often. Right click sends the radar sweep.'
    },
    titan: {
        vector: 'Kernel-mode rootkit',
        icon: 'i-lucide-skull',
        summary: 'ROOTKIT, the first boss. Burrows under the grid and resurfaces closer to the wall.',
        notes: [
            'Untouchable while burrowed: it melts into the floor and climbs back out somewhere else.',
            'Its two small forelegs inject spiderlings into the ground as it comes.',
            'It infects the hacked nodes it passes: an infected node hatches a spiderling every few seconds until ROOTKIT is dead.'
        ],
        tip: 'Save the ICE Pulse for when it surfaces, and kill it fast: every second it lives, the brood grows.'
    },
    leviathan: {
        vector: 'Firmware implant',
        icon: 'i-lucide-snowflake',
        summary: 'BLACK ICE freezes your turrets solid as it comes, and spits black ice that piles up into walls.',
        notes: [
            'Its globs land ahead of it and freeze into walls of black crystal. Every round through a wall is slowed to a crawl, so what stands behind it is hard to hit.',
            'Every third glob is aimed at your rail. A hit lags the whole board, as in PACKET LOSS.',
            'A wall melts a while after its last glob, and the purge melts them all.',
            'A frozen turret stops firing until it thaws — or until you click it free.'
        ],
        tip: 'Click frozen turrets to thaw them early, and shoot around the walls, not through them.'
    },
    zeroday: {
        vector: 'Zero-day exploit',
        icon: 'i-lucide-biohazard',
        summary: 'ZERO DAY, the last boss. Splits into decoys; only the real one bleeds data.',
        notes: [
            'At the wall its body explodes: the blocks queue up either side of the green gem in its chest and above it, and fire at the fence in a barrage. Then it regrows from the gem.',
            'Decoys die fast and pay nothing.',
            'The real one drips green data as it walks.'
        ],
        tip: 'Watch for the drip. Everything else is noise.'
    },
    spiderling: {
        vector: 'Self-replicating worm',
        icon: 'i-lucide-bug',
        summary: 'ROOTKIT\'s brood: tiny, fast and fragile. They run for the fence, latch on and drain it, and every drain feeds them.',
        notes: [
            'Injected by ROOTKIT\'s forelegs, and hatched from the hacked nodes it has infected.',
            'Each drain bites harder than the last; the spiderling grows with it and heals on what it takes.',
            'It sinks its fangs into the fence, the ICE Barrier or a proxy wall in its way. Honeypots do not fool it.',
            'They pay almost nothing: they are a tax, not a prize.'
        ],
        tip: 'Kill them on the way in. One left draining the fence for long becomes a real problem.'
    }
}

function threatEntries(): CodexEntry[] {
    return HACKERZ_ENEMIES.map((def) => {
        const lore = THREATS[def.id]
        const stats: CodexStat[] = [
            { label: 'Integrity', value: String(def.hp) },
            { label: 'Speed', value: String(def.speed) },
            { label: 'Hit', value: String(def.damage) },
            { label: 'Plating', value: def.armored ? 'armoured' : 'none' },
            { label: 'Seen from', value: def.boss ? 'boss wave' : `wave ${def.fromWave}` }
        ]
        if (def.range) stats.push({ label: 'Range', value: String(def.range) })
        if (def.altitude) stats.push({ label: 'Class', value: 'airborne' })
        if (def.cloaked) stats.push({ label: 'Class', value: 'cloaked' })
        return {
            id: def.id,
            name: def.name,
            icon: lore.icon,
            color: css(def.hex),
            kicker: lore.vector,
            summary: lore.summary,
            notes: lore.notes,
            tip: lore.tip,
            stats,
            model: { id: def.id, hex: def.hex, kind: def.altitude ? 'flyer' : 'walker', enemy: def.id }
        }
    })
}

const WEAPON_LORE: Record<string, { summary: string, tip: string }> = {
    rail: { summary: 'Your stock rifle: accurate, quick and dependable. Hold on a hostile to track it.', tip: 'A fine all-rounder the whole run.' },
    flak: { summary: 'Sprays a fan of pellets — a shotgun for crowds and sapper rushes.', tip: 'Best up close against swarms.' },
    arc: {
        summary: 'Each round arcs on from what it hits to three more hostiles, losing a tenth of its power at every jump. Superconductor, bought at the uplink once you own the coil, cuts that loss to as little as a twentieth.',
        tip: 'Hackers are grounded against arcs: aim the first hit at them.'
    },
    missile: { summary: 'Homing warheads that burst on impact.', tip: 'Splash leaves a lone hacker alone, but a crew hacking one node together takes it as one.' },
    sniper: {
        summary: 'A railgun on a track across the wall: it cannot turn, so it glides left and right under your cursor and fires dead straight down the lane, punching through a line of hostiles.',
        tip: 'Slide it under a column coming down one line and let a single round pierce the lot.'
    }
}

const TURRET_LORE: Record<string, string> = {
    gun: 'A steady mid-range gun. Cheap and reliable.',
    needler: 'Fires a constant stream of light rounds. Shreds unarmoured swarms.',
    warhead: 'Lobs splash warheads into crowds.',
    lance: 'Long-reach piercing rail. The answer to Howitzers.'
}

function hardeningSections(): CodexSection[] {
    const upgrade = (id: string) => HACKERZ_UPGRADES.find(u => u.id === id)!
    const firewall: CodexEntry[] = [
        {
            id: 'fence',
            name: 'The Firewall',
            icon: 'i-lucide-brick-wall',
            color: '#22d3ee',
            kicker: 'Core defence',
            summary: 'The glowing fence across the lane. Every hostile that reaches it chips its integrity; at zero the run is over.',
            notes: ['Your rail sits dead centre behind it.', `${upgrade('integrity').name} adds integrity; the Patch Daemon repairs it between waves.`],
            stats: []
        },
        {
            id: 'barrier',
            name: upgrade('shield').name,
            icon: upgrade('shield').icon,
            color: '#7dd3fc',
            kicker: 'Absorbing shield',
            summary: 'A regenerating barrier that soaks hits before the wall takes them.',
            notes: ['It lights up where it is struck; when it collapses, the syslog says so.'],
            stats: []
        },
        {
            id: 'grid',
            name: upgrade('spikes').name,
            icon: upgrade('spikes').icon,
            color: '#38bdf8',
            kicker: 'Area denial',
            summary: 'Electrifies the band in front of the wall: ground hostiles standing on it take damage every tick.',
            notes: [
                'Runs off your gun\'s magazine: one round buys one second of the grid biting, on top of your shots. With nothing on it, it costs nothing.',
                'Dead while the gun reloads.',
                'Fliers pass over it.',
                'Keeps the gate itself yours even when every node has fallen.'
            ],
            stats: []
        },
        {
            id: 'blue',
            name: 'Held ground',
            icon: 'i-lucide-square-dashed',
            color: '#3b82f6',
            kicker: 'Territory',
            summary: 'Blue ground is yours. Only armoured hostiles walk into it willingly, and it bites everything that does.',
            notes: ['Red ground is theirs: hostiles move at double speed there, grow a one-hit shield and heal.', 'Orange is contested.'],
            stats: []
        }
    ]

    const weapons = HACKERZ_WEAPONS.map(def => ({
        id: def.id,
        name: def.name,
        icon: def.icon,
        color: css(def.hex),
        kicker: `${def.damageType} · ${def.tag}`,
        summary: WEAPON_LORE[def.id]?.summary ?? '',
        notes: [],
        tip: WEAPON_LORE[def.id]?.tip,
        stats: [
            { label: 'Damage', value: def.pellets ? `${def.damage} ×${def.pellets}` : String(def.damage) },
            { label: 'Fire', value: `${(1000 / def.fireIntervalMs).toFixed(1)}/s` },
            { label: 'Magazine', value: String(def.magazine) },
            { label: 'Unlocks', value: `wave ${def.unlockWave}` },
            { label: 'Cost', value: def.cost ? `${def.cost} cr` : 'stock' }
        ],
        // Every gun goes on the same rail mount; the colour tells them apart.
        model: { id: 'turret-rail' as const, hex: def.hex, kind: 'turret' as const, fireMs: def.fireIntervalMs, railProjectile: def.projectile, projectile: def.projectile }
    }))

    const turrets = HACKERZ_TURRETS.map(def => ({
        id: def.id,
        name: def.name,
        icon: def.icon,
        color: css(def.hex),
        kicker: `${def.damageType} · ${def.tag}`,
        summary: TURRET_LORE[def.id] ?? '',
        notes: ['Turrets cover their own lane first, go for the tankiest target there, and leave hackers for last.'],
        stats: [
            { label: 'Damage', value: String(def.damage) },
            { label: 'Fire', value: `${(1000 / def.intervalMs).toFixed(1)}/s` },
            { label: 'Range', value: String(def.range) },
            { label: 'Unlocks', value: `wave ${def.unlockWave}` },
            { label: 'Cost', value: `${def.cost} cr` }
        ],
        model: { id: `turret-${def.id}` as const, hex: def.hex, kind: 'turret' as const, fireMs: def.intervalMs, projectile: turretProjectile(def) }
    }))

    const deployables: CodexEntry[] = HACKERZ_DEPLOYABLES.map(def => ({
        id: def.id,
        name: def.name,
        icon: def.icon,
        color: css(def.hex),
        kicker: `Deployable · key ${def.key}${def.instant ? ' · fires at once' : ''}`,
        summary: def.description,
        notes: DEPLOYABLE_LORE[def.id].notes,
        tip: DEPLOYABLE_LORE[def.id].tip,
        stats: [
            ...DEPLOYABLE_LORE[def.id].stats,
            { label: 'Cost', value: `${def.cost} cr` },
            { label: 'Carry', value: `up to ${HACKERZ_DEPLOYABLE_MAX}` }
        ]
    }))

    const abilities: CodexEntry[] = [
        {
            id: 'ping',
            name: 'Radar ping',
            icon: 'i-lucide-radar',
            color: '#a3e635',
            kicker: 'Right click',
            summary: 'A sweep from the rail that lights up everything it passes: cloaked phantoms, and anything hiding in the dark.',
            notes: ['Lit hostiles stay visible for a few seconds.'],
            stats: []
        },
        {
            id: 'pulse',
            name: upgrade('pulse').name,
            icon: upgrade('pulse').icon,
            color: '#67e8f9',
            kicker: 'Space',
            summary: 'A shockwave that slams the front of the field and shoves hostiles back.',
            notes: [],
            stats: []
        },
        {
            id: 'overclock',
            name: upgrade('overclock').name,
            icon: upgrade('overclock').icon,
            color: '#f97316',
            kicker: 'Q',
            summary: 'Runs your rail and every turret hot for a few seconds.',
            notes: [],
            stats: []
        }
    ]

    const intel: CodexEntry[] = [
        {
            id: 'nodes',
            name: 'Path nodes',
            icon: 'i-lucide-microchip',
            color: '#f43f5e',
            kicker: 'The board',
            summary: 'Chips scattered across the board. Every node the hackers take turns more of the ground red; shoot a hacked node three times to take it back.',
            notes: [
                'Nodes out by the portal fall fast; the closer to the fence, the longer one holds out.',
                'Three hacked nodes close together put the lights out: a dark zone only a ping can see into.',
                'Nothing in the dark can be locked on, but rounds fired blind still hit, and light up what they hit for a moment.'
            ],
            stats: []
        },
        {
            id: 'damage',
            name: 'Damage types',
            icon: 'i-lucide-swords',
            color: '#fbbf24',
            kicker: 'Kinetic vs energy',
            summary: 'Kinetic deals +25% to plated targets, energy +25% to unarmoured ones. The wrong type is never penalised.',
            notes: [],
            stats: []
        },
        ...HACKERZ_EVENTS.map(event => ({
            id: event.id,
            name: event.name,
            icon: event.icon,
            color: css(event.hex),
            kicker: 'Bonus round',
            summary: event.tagline,
            notes: ['Skippable. Hold the wall above the line for double credits; the wall is restored afterwards.'],
            stats: []
        }))
    ]

    const sections: CodexSection[] = [
        { id: 'firewall', title: 'Firewall', entries: firewall },
        { id: 'weapons', title: 'Weapons', entries: weapons },
        { id: 'turrets', title: 'Turrets', entries: turrets },
        { id: 'deployables', title: 'Deployables', entries: deployables },
        { id: 'abilities', title: 'Abilities', entries: abilities },
        { id: 'intel', title: 'Intel', entries: intel }
    ]
    // Every entry with a scripted scene shows it playing on a demo board.
    return sections.map(section => ({
        ...section,
        entries: section.entries.map(entry => HACKERZ_DEMO_SCRIPTS[entry.id] ? { ...entry, demo: entry.id } : entry)
    }))
}

interface DeployableLore {
    notes: string[]
    tip: string
    stats: CodexStat[]
}

/** What a Mainframe track does to a deployable, from none bought to maxed: "15 s → 30 s". */
function mainframeRange(id: HackerzMainframeId, show: (effects: ReturnType<typeof hackerzMainframeEffects>) => string) {
    const base = hackerzEmptyMainframe()
    const maxed = { ...base, [id]: hackerzMainframe(id).max }
    return { label: hackerzMainframe(id).name, value: `${show(hackerzMainframeEffects(base))} → ${show(hackerzMainframeEffects(maxed))}` }
}

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`

/** Deployable numbers at wave 1; the ones that hit scale up with the wave like the hostiles do. */
const DEPLOY_STATS = hackerzDeployableStats(1)

const DEPLOYABLE_LORE: Record<HackerzDeployableId, DeployableLore> = {
    honeypot: {
        notes: [
            'Drops onto the nearest data line, where the hostiles ride.',
            'Anything inside its lure radius turns on it instead of the wall, flyers included.',
            'When it is broken or its timer runs out it detonates on whoever it drew in.'
        ],
        tip: 'Put it just ahead of a pack, then keep firing into the crowd it gathers: the blast finishes what you wounded.',
        stats: [
            { label: 'Lure radius', value: String(DEPLOY_STATS.honeypot.lureRadius) },
            { label: 'Lasts', value: seconds(DEPLOY_STATS.honeypot.lifeMs) },
            { label: 'Blast', value: `${DEPLOY_STATS.honeypot.blastDamage} +70/wave` }
        ]
    },
    bomb: {
        notes: [
            'Arms half a second after it lands, then the first ground hostile to step on it sets it off.',
            'Dropped on a node you hold or contest, it wires in: hackers no longer trip it, and it blows when the node falls.',
            'Flyers never set it off.'
        ],
        tip: 'Wire it onto the next node the hackers want: they gather to work it, and the bomb takes the whole crew when it falls.',
        stats: [
            { label: 'Trigger', value: String(DEPLOY_STATS.bomb.triggerRadius) },
            { label: 'Blast radius', value: String(DEPLOY_STATS.bomb.blastRadius) },
            { label: 'Blast', value: `${DEPLOY_STATS.bomb.damage} +85/wave` }
        ]
    },
    proxy: {
        notes: [
            'A barrier across part of the lane. Ground walkers stop at it and have to break it down.',
            'Ranged units that stop short of it and flyers ignore it.',
            'It fades once its time is up, broken or not.'
        ],
        tip: 'A held pack is a still target: drop it where your turrets overlap and let them chew on the queue.',
        stats: [
            { label: 'Width', value: String(DEPLOY_STATS.proxy.halfWidth * 2) },
            { label: 'Health', value: `${DEPLOY_STATS.proxy.hp} +130/wave` },
            { label: 'Lasts', value: seconds(DEPLOY_STATS.proxy.lifeMs) }
        ]
    },
    portscan: {
        notes: [
            'Fires a radar ping the moment its key is pressed: nothing to aim.',
            'Every time the contacts fade it pings again half a second later, for as long as it runs.',
            'Cloaked phantoms and anything in a dark zone stay targetable while it sweeps.'
        ],
        tip: 'Save it for a Phantom-heavy wave or a Blackout: a single ping fades just as the shooting starts.',
        stats: [mainframeRange('scanner', effects => seconds(effects.portscanMs))]
    },
    blip: {
        notes: [
            'Fires the moment its key is pressed, and flips hacked nodes back at random.',
            'With no hacked node on the board it does nothing, and is kept.',
            'It cannot touch a board a DDoS flood has locked.'
        ],
        tip: 'Use it when a node far out is out of your line of fire: a rail round can reclaim the near ones.',
        stats: [mainframeRange('blip', effects => `${effects.blipNodes} node${effects.blipNodes === 1 ? '' : 's'}`)]
    },
    whitehat: {
        notes: [
            'Arm it, then click a hostile: it switches sides, drops whatever job it had and fights its own until it falls.',
            'With the Mainframe upgrade the nearest hostiles around it are turned too.',
            'Never a boss, and never a copy.'
        ],
        tip: 'Turn the toughest thing in a pack: a Bulwark on your side holds the line while you shoot past it.',
        stats: [mainframeRange('whitehat', effects => `${effects.whitehatTargets} hostile${effects.whitehatTargets === 1 ? '' : 's'}`)]
    },
    surge: {
        notes: [
            'Overloads a patch of the grid: lightning arcs into a few hostiles inside it, several times a second.',
            'It hits flyers and walkers alike, but never anything a White Hat turned.'
        ],
        tip: 'Lay it on a line just ahead of a pack, or under a held proxy wall where they stand still.',
        stats: [
            { label: 'Radius', value: String(DEPLOY_STATS.surge.radius) },
            { label: 'Arcs', value: `${DEPLOY_STATS.surge.arcs} × ${DEPLOY_STATS.surge.damage} every ${DEPLOY_STATS.surge.arcMs} ms` },
            mainframeRange('surge', effects => seconds(effects.surgeMs))
        ]
    }
}

/** How the intrusion fights as a group, rather than any one hostile: opened the first time each is seen. */
const TACTICS: CodexEntry[] = [
    {
        id: 'defender',
        name: 'Node defender',
        icon: 'i-lucide-shield-half',
        color: '#fb7185',
        kicker: 'Tactic · guards what they took',
        summary: 'Every node the intrusion has hacked keeps a guard: the least tanky hostile within reach steps out and stands just in front of it, toward the fence.',
        notes: [
            'One defender per hacked node, never a hacker. It holds the post until it dies, the node is taken back, or the final push sends everything in; then the next weakest nearby steps up.',
            'A defender throws itself in front of an ICE pulse: the wash stops at its node, and the defender dies in it.',
            'A hacker pushing past the first node while it still stands drags the nearest defender along as its shield.',
            'Nobody guards a locked board, or anything in a bonus round.'
        ],
        tip: 'Drop the defender, then put three rounds into the node: with its guard gone, nothing stands in the way of the reclaim.',
        stats: [
            { label: 'Per node', value: '1' },
            { label: 'Drawn from', value: 'within 300' }
        ]
    },
    {
        id: 'bodyguard',
        name: 'Bodyguard',
        icon: 'i-lucide-users',
        color: '#67e8f9',
        kicker: 'Tactic · escorts the hackers',
        summary: 'Late in a run every hacker brings Daemons to keep it alive: they keep themselves between their hacker and your rail and soak the fire meant for it.',
        notes: [
            'A round that hits a bodyguard is spent there: no splash and no arc reaches the hacker behind it.',
            'A fallen bodyguard is replaced by the nearest free weakling, or by a fresh Daemon from the portal (half the credits, no coins).',
            'Bodyguards move faster than their charge, so they can always get back in front.',
            'Earlier than that, a hacker pushing past the first node still takes a node defender along as a hostage shield.'
        ],
        tip: 'Break the guard and the hacker behind it is bare: a burst drops the Daemon, then one clean hit takes the hacker.',
        stats: [
            { label: 'From wave 10', value: '1 per hacker' },
            { label: 'From wave 20', value: '2 per hacker' }
        ]
    }
]

/** The threat database: one entry per hostile, then how they fight together, bosses last. */
export function hackerzThreatCodex(): CodexSection[] {
    const all = threatEntries()
    const bosses = HACKERZ_ENEMIES.filter(def => def.boss).map(def => def.id as string)
    return [
        { id: 'threats', title: 'Threats', entries: all.filter(e => !bosses.includes(e.id)) },
        { id: 'tactics', title: 'Tactics', entries: TACTICS },
        { id: 'bosses', title: 'Boss-class', entries: all.filter(e => bosses.includes(e.id)) }
    ]
}

/** Hardening tools: everything on your side of the fence, explained. */
export function hackerzHardeningCodex(): CodexSection[] {
    return hardeningSections()
}
