/**
 * The 10 worlds a prestige run walks through.
 *
 * **Names and themes only.** Nothing here affects a single number: every stat comes from
 * `settle.enemyStatsAt`, which knows only the run index. Regular enemies have no kits, so a roster
 * here is a name and an art brief, not a mechanic; the bosses' specials are `boss-specials.ts`.
 *
 * **The arc is a walk toward the source.** The archmage of Duskspire (World 6) opened a door
 * to the Void, and the cracks it left spread outward through the kingdom. A run starts at the
 * farthest frontier, where the damage is only feral hedgerows, and walks inward — through places
 * the Void has hollowed a little more each time — past the door itself and out through the edge
 * of the world into **The Void** (World 10). Void Shards are named after it
 * (`economy-and-currencies.md` §3), which is also the lore of a prestige: reach the end, and
 * start again stronger.
 *
 * **Naming rules the UI depends on:**
 * - `hordeName` names a whole pack ("Bramble Warband ×5"), so it reads as a group, never
 *   pluralised.
 * - Boss names never start with "The", because sentences read "Fight Old Gnarlhide" and
 *   "Old Gnarlhide blocks the way".
 * - No name reuses a Champion given name or title, so a boss is never mistaken for a pull.
 *
 * The fixed pool never re-themes between prestiges (`core-progression-and-prestige.md` §5) —
 * difficulty is communicated entirely through the stat curve, which is what keeps art scope
 * flat no matter how many prestiges a player stacks up.
 */

import { STAGES_PER_WORLD, WORLD_COUNT } from '../constants'
import { stageArchetype } from '../settle'
import type { StageArchetype } from '../types'

/** The four fighting styles a world's roster covers. */
export const ENEMY_STYLES = ['melee', 'heavy', 'ranged', 'caster'] as const
export type EnemyStyle = typeof ENEMY_STYLES[number]

export interface WorldDefinition {
    /** Stable string ID — save data references this, never the array index. */
    id: string
    /** 1-based, and equal to this entry's position in the play order. */
    index: number
    name: string
    /** One line of setting — the brief the world's background and roster art are drawn from. */
    theme: string
    /** What a wave of trash and elites is called as a whole: shown over the pack. */
    hordeName: string
    /**
     * The four creatures a wave draws from, one per fighting style (the client draws them on the
     * sword, axe, bow and staff rigs). Flavour only: stats come from the curve, not the creature.
     */
    roster: Readonly<Record<EnemyStyle, string>>
    bossName: string
    superBossName: string
}

export const WORLDS: readonly WorldDefinition[] = [
    {
        id: 'world_thornwick_vale',
        index: 1,
        name: 'Thornwick Vale',
        theme: 'Frontier farmland at the edge of the kingdom, where the first cracks have turned the hedgerows feral.',
        hordeName: 'Bramble Warband',
        roster: { melee: 'Bramble Goblin', heavy: 'Thornhide Hobgoblin', ranged: 'Scarecrow Stalker', caster: 'Hedge-Witch' },
        bossName: 'Old Gnarlhide',
        superBossName: 'Gorsecrown, King of Hedges'
    },
    {
        id: 'world_mirewood',
        index: 2,
        name: 'Mirewood',
        theme: 'A drowned forest of black water and hanging moss, rotting from the roots up.',
        hordeName: 'Mire Brood',
        roster: { melee: 'Bog Lurker', heavy: 'Peat Brute', ranged: 'Reed Spitter', caster: 'Bog Crone' },
        bossName: 'Mother Leech',
        superBossName: 'Rotheart, the Sunken Elder'
    },
    {
        id: 'world_cinderpass',
        index: 3,
        name: 'Cinderpass',
        theme: 'A volcanic mountain pass choked with ash, held by kobold clans and the thing they worship.',
        hordeName: 'Cinder Clan',
        roster: { melee: 'Cinder Kobold', heavy: 'Slag Golem', ranged: 'Ash Imp', caster: 'Salamander Firecaller' },
        bossName: 'Slagjaw',
        superBossName: 'Pyrrhax, the Molten Wyrm'
    },
    {
        id: 'world_rimeholt',
        index: 4,
        name: 'Rimeholt',
        theme: 'A frozen northern hold whose raiders swore themselves to a cold that does not end.',
        hordeName: 'Frost Host',
        roster: { melee: 'Frostbound Raider', heavy: 'Rime Troll', ranged: 'Snowfield Huntress', caster: 'Rune Skald' },
        bossName: 'Jarl Hrimgar',
        superBossName: 'Vinterhel, the Glacier Titan'
    },
    {
        id: 'world_sunken_amarath',
        index: 5,
        name: 'Sunken Amarath',
        theme: 'The drowned capital of a sea-empire, its dead still keeping the tides.',
        hordeName: 'Drowned Crew',
        roster: { melee: 'Drowned Sailor', heavy: 'Barnacle Brute', ranged: 'Harpoon Siren', caster: 'Tide Priestess' },
        bossName: 'Tidecaller Nerine',
        superBossName: 'Queen Maerith of the Deep'
    },
    {
        id: 'world_duskspire',
        index: 6,
        name: 'Duskspire',
        theme: 'A city of mage-towers held at twilight since its archmage opened a door to the Void.',
        hordeName: 'Hollow Conclave',
        roster: { melee: 'Hollow Acolyte', heavy: 'Spire Gargoyle', ranged: 'Spellbound Construct', caster: 'Riftbound Magus' },
        bossName: 'Magister Halvane',
        superBossName: 'Archmage Ithren, the Door-Opener'
    },
    {
        id: 'world_the_bonefields',
        index: 7,
        name: 'The Bonefields',
        theme: 'An ancient battlefield where the fallen of a forgotten war rise to fight it again.',
        hordeName: 'Restless Legion',
        roster: { melee: 'Restless Legionnaire', heavy: 'Barrow Ghoul', ranged: 'Bone Archer', caster: 'Ossuary Priest' },
        bossName: 'Grave Marshal Korr',
        superBossName: 'Ossuar, the Thousand-Bone Host'
    },
    {
        id: 'world_the_shattered_sky',
        index: 8,
        name: 'The Shattered Sky',
        theme: 'Islands of torn-loose stone adrift in a storm the Void has unmoored.',
        hordeName: 'Storm Swarm',
        roster: { melee: 'Skyshard Wisp', heavy: 'Thunderhead Golem', ranged: 'Harpy Raider', caster: 'Squall Caller' },
        bossName: 'Stormcrown Roc',
        superBossName: 'Zephyrax, Breaker of Heavens'
    },
    {
        id: 'world_the_brink',
        index: 9,
        name: 'The Brink',
        theme: 'The last ground at the edge of the world, where the storm has burned out, the sky has gone to stars and everything left is falling toward the Void.',
        hordeName: 'Unravelled Host',
        roster: { melee: 'Unravelled Knight', heavy: 'Tethered Brute', ranged: 'Starfall Archer', caster: 'Last Seer' },
        bossName: 'Sister Vesper, the Forgotten',
        superBossName: 'Liminus, the Last Door'
    },
    {
        id: 'world_the_void',
        index: 10,
        name: 'The Void',
        theme: 'Nothing, pressing in — where every crack leads, and where each run ends before it begins again.',
        hordeName: 'Void Horde',
        roster: { melee: 'Void Thrall', heavy: 'Void Maw', ranged: 'Starved Wraith', caster: 'Void Augur' },
        bossName: 'Void Herald',
        superBossName: 'Nihil, the Hunger at the End'
    }
]

export const WORLD_BY_INDEX: Readonly<Record<number, WorldDefinition>> = Object.fromEntries(
    WORLDS.map(world => [world.index, world])
)

export function getWorld(index: number): WorldDefinition {
    const world = WORLD_BY_INDEX[index]
    if (!world) throw new Error(`Unknown world index: ${index}`)
    return world
}

/**
 * Display name for whatever is being fought at a position — the archetype picks which of the
 * world's names applies. A trash or elite stage shows the horde's name: a wave mixes the
 * world's roster, and elites *are* that roster, stat-buffed (`core-progression-and-prestige.md`
 * §1); the client marks them as elite rather than renaming them.
 */
export function enemyNameAt(world: number, stage: number): { name: string; archetype: StageArchetype } {
    const archetype = stageArchetype(stage)
    const definition = getWorld(world)
    switch (archetype) {
        case 'boss':
            return { name: definition.bossName, archetype }
        case 'super_boss':
            return { name: definition.superBossName, archetype }
        default:
            return { name: definition.hordeName, archetype }
    }
}

/** Position along the run as a 1-based stage count, for progress bars. `WORLD_COUNT × STAGES_PER_WORLD` at the end. */
export function runProgress(world: number, stage: number): { cleared: number; total: number } {
    return {
        cleared: (world - 1) * STAGES_PER_WORLD + (stage - 1),
        total: WORLD_COUNT * STAGES_PER_WORLD
    }
}
