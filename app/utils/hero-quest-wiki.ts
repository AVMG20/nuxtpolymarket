import {
    BASE_ATTACK_INTERVAL_SECONDS,
    BASE_HP,
    CRIT_CHANCE_PER_POINT,
    CRIT_DAMAGE_PER_POINT,
    EHP_DEF_CONSTANT,
    GPN_DISPLAY_SCALE,
    HP_PER_VIT,
    K,
    MAX_EVASION,
    MIN_ATTACK_INTERVAL_SECONDS,
    MIN_COOLDOWN_SECONDS,
    MIN_DAMAGE,
    OVERFLOW_CONVERSION_RATE,
    SPD_ATTACK_RATE_PER_POINT
} from '#shared/utils/hero-quest/constants'
import type { HqStatKey } from '#shared/utils/hero-quest/types'

/**
 * The glossary the wiki and every info tooltip read from (session-1 playtest, finding 6:
 * "a new player currently has no idea what each skill or stat means").
 *
 * **One definition per concept, in one place.** A tooltip on the battle screen and a wiki entry
 * describing the same stat differently is worse than having neither, because the player cannot
 * tell which one is out of date. Both render from these tables.
 *
 * **Every number is interpolated from `constants.ts`, never typed out.** That is the whole
 * reason this is a module rather than prose in a template: constants move during tuning (many
 * are still `// UNTUNED ╧`), and a wiki that quietly keeps quoting the old value is worse than
 * no wiki. Prose describes *shape*; numbers come from the
 * source of truth or are not stated.
 *
 * What this cannot do is know *which* constants are still untuned — that lives in a comment, not
 * in a value. The wiki says so once, prominently, rather than pretending to a precision it
 * does not have.
 */

/** `0.01` → `1%`, without the float dust `0.1 * 100` would print. */
function pct(fraction: number, decimals = 0): string {
    return `${(fraction * 100).toFixed(decimals)}%`
}

export interface HqStatDoc {
    key: HqStatKey
    /** Player-facing name. The three-letter key is what the UI has room for. */
    name: string
    /** One sentence, for a tooltip. No numbers — those go in `formula`. */
    short: string
    /** A paragraph for the wiki: what it does, and what it is worth caring about. */
    detail: string
    /** The actual rule, with live values. */
    formula: string
}

export const HQ_STAT_DOCS: readonly HqStatDoc[] = [
    {
        key: 'pwr',
        name: 'Power',
        short: 'How hard you hit, and how far through enemy armour you get.',
        detail: 'The damage number. Power does double duty in a party: each unit swings its own '
            + 'Power, but the party pools all of it to decide how much of the enemy\'s Defence it '
            + 'cuts through. A weak Champion therefore adds its own damage *and* thins the armour '
            + 'for everyone else, which is why filling a party slot is always worth something.',
        formula: `damage = PWR × (1 − mitigation) × ability multiplier, never below ${MIN_DAMAGE}`
    },
    {
        key: 'def',
        name: 'Defence',
        short: 'Cuts incoming damage, up to a hard ceiling.',
        detail: 'Defence is a clamped ratio against the attacker\'s Power, not a curve that '
            + 'approaches immunity. Once your Defence reaches K times the attacker\'s Power, '
            + 'mitigation is exactly 100% — and even then damage does not reach zero, it floors. '
            + 'Nothing in the game is unkillable by armour alone.',
        formula: `mitigation = min(100%, DEF ÷ (attacker PWR × ${K})); a fully mitigated hit still deals ${MIN_DAMAGE}`
    },
    {
        key: 'vit',
        name: 'Vitality',
        short: 'Your health pool.',
        detail: 'The only source of HP. Everyone starts with a flat base regardless of build, so '
            + 'Vitality is what separates a body that survives a boss opener from one that does '
            + 'not — it is not what keeps you alive against a wall you have already out-scaled.',
        formula: `HP = ${BASE_HP.toLocaleString('en-US')} + VIT × ${HP_PER_VIT}`
    },
    {
        key: 'spd',
        name: 'Speed',
        short: 'Attack rate and skill cooldowns — one stat, both jobs.',
        detail: 'Speed shortens the gap between basic attacks and shortens every skill cooldown, '
            + 'on the same curve. Levelling up speeds up basic attacks only: cooldowns count just '
            + 'the Speed from your class, gear, skills, artifacts and buffs. Rarer skills and '
            + 'deeper classes have longer cooldowns and hit proportionally harder.',
        formula: `attack every ${BASE_ATTACK_INTERVAL_SECONDS}s ÷ (1 + SPD × ${SPD_ATTACK_RATE_PER_POINT}), `
            + `floored at ${MIN_ATTACK_INTERVAL_SECONDS.toFixed(2)}s; cooldowns use the same divisor without level growth, floored at ${MIN_COOLDOWN_SECONDS}s`
    },
    {
        key: 'lck',
        name: 'Luck',
        short: 'Crit chance — and once that caps, crit damage.',
        detail: 'Luck converts linearly into crit chance until it hits 100%. Past that it is not '
            + 'wasted: the surplus overflows into bonus crit damage at a much lower rate. That '
            + 'makes Luck the one stat with no dead zone, but the conversion past the cap is poor '
            + 'enough that piling into it is rarely the best use of a slot.',
        formula: `crit chance = min(100%, LCK × ${pct(CRIT_CHANCE_PER_POINT)}); `
            + `every point past the cap adds ${pct(OVERFLOW_CONVERSION_RATE)} crit damage`
    },
    {
        key: 'imp',
        name: 'Impact',
        short: 'How much a critical hit is worth.',
        detail: 'Impact does nothing on its own — it multiplies critical hits only. It is the '
            + 'partner stat to Luck, and stacking it without the Luck to land crits is the most '
            + 'common way to build a character that reads strong and hits weak.',
        formula: `crit multiplier = 1 + IMP × ${pct(CRIT_DAMAGE_PER_POINT)} (+ Luck overflow)`
    }
]

export const HQ_STAT_DOC_BY_KEY: Readonly<Record<string, HqStatDoc>> = Object.fromEntries(
    HQ_STAT_DOCS.map(doc => [doc.key, doc])
)

/**
 * The Global Power Number (`global-power-number.md`) — one glossary entry, read by the battle
 * screen's tooltip and the wiki's Combat page, on the same one-definition rule as the stats.
 */
export const HQ_POWER_DOC = {
    name: 'Global Power',
    short: 'Your whole fielded party\'s strength, as one number.',
    detail: 'Global Power reads the real stats your party fights with — damage per second and '
        + 'effective health — and combines them. Everything that makes the party stronger moves '
        + 'it: levels, Champions fielded and owned, equipped and collected Gear, Skills and '
        + 'Artifacts. It is a live reading, so benching a strong Champion or unequipping an '
        + 'Artifact lowers it. Because the two multiply, a party that is all damage and no '
        + 'health — or the reverse — scores lower than a balanced one with the same totals.',
    formula: `power = √(party DPS × party effective HP) × ${GPN_DISPLAY_SCALE}; `
        + `effective HP = HP × (1 + DEF ÷ ${EHP_DEF_CONSTANT}) ÷ (1 − evasion, at most ${pct(MAX_EVASION)})`
} as const

/**
 * Currencies, and — deliberately — which of them this build actually has.
 *
 * Some currencies (`economy-and-currencies.md`) belong to systems a build may not have yet. A wiki that describes all eleven as
 * though they work is a wiki that sends players hunting for a currency they cannot earn, so the
 * unbuilt ones are listed and marked rather than hidden — a player who reads about Raids in a
 * design doc should find out here that they are not in yet.
 */
export interface HqCurrencyDoc {
    name: string
    /** Where it comes from. */
    source: string
    /** What it is for. */
    sink: string
    /** False for currencies whose system ships in a later phase. */
    live: boolean
    /** True when the balance is shared with every other game on the platform. */
    shared?: boolean
}

export const HQ_CURRENCY_DOCS: readonly HqCurrencyDoc[] = [
    {
        name: 'Gold',
        source: 'Every kill, at a rate set by how deep the run is.',
        sink: 'Buying extra Seals, on a price ladder that resets daily.',
        live: true,
        shared: true
    },
    {
        name: 'Gems',
        source: 'Milestones. Shared with the rest of the platform.',
        sink: 'Extra Loadout slots and Trait save slots.',
        live: true,
        shared: true
    },
    {
        name: 'Void Shards',
        source: 'Prestige, and nothing else — a full clear of World 10, Stage 10.',
        sink: 'The prestige shop: offline time, party slots, skill slots, artifact slots.',
        live: true
    },
    {
        name: 'Seals (four kinds)',
        source: 'Boss and world-clear milestones, prestige, or bought with Gold.',
        sink: 'Pulls. Each gacha has its own Seal and they are never interchangeable.',
        live: true
    },
    {
        name: 'Essence (four kinds)',
        source: 'Duplicates of a copy that is already fully maxed. There is no other source.',
        sink: 'Crafting one specific item outright — the way past bad luck.',
        live: true
    },
    {
        name: 'Trait Gems',
        source: 'Shardcaller Beast, the Trait Raid, and some login-calendar days.',
        sink: 'Rolling Traits, and storing or loading a Trait board.',
        live: true
    },
    { name: 'Raid Keys', source: 'A daily allowance per raid.', sink: 'Raid entries.', live: false },
    { name: 'Arena Medals', source: 'Winning Arena attacks.', sink: 'The Arena shop.', live: false }
]
